import { useState, useEffect, useRef, useCallback } from "react";
import type { ChatMessage, ContentBlock } from "@/lib/api";
import * as api from "@/lib/api";

type StableMessage = ChatMessage & { _stableKey?: string };

export interface TeamActivityEvent {
  tool: string;
  text: string;
  agentName?: string;
  timestamp: number;
  loading: boolean;
}

const MAX_TEAM_ACTIVITY = 10;
const STALE_THRESHOLD_MS = 30_000;
const BACKOFF_INITIAL_MS = 1_000;
const BACKOFF_MAX_MS = 30_000;

interface AgentActivitySSE {
  type: "tool_start" | "tool_end" | "thinking" | "turn_end" | "error";
  tool?: string;
  text?: string;
  filePath?: string;
  command?: string;
  message?: string;
  agentName?: string;
  timestamp: number;
}

export function useChat(projectId: string) {
  const [messages, setMessages] = useState<StableMessage[]>([]);
  const [sending, setSending] = useState(false);
  const [streamingContent, setStreamingContent] = useState<string | null>(null);
  const [streamingTarget, setStreamingTarget] = useState<string | null>(null);
  const [streamingBlocks, setStreamingBlocks] = useState<ContentBlock[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [teamActivity, setTeamActivity] = useState<TeamActivityEvent[]>([]);
  const eventSourceRef = useRef<EventSource | null>(null);
  const lastEventTimeRef = useRef<number>(0);
  const backoffRef = useRef<number>(BACKOFF_INITIAL_MS);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const staleCheckRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const cancelledRef = useRef(false);

  // Mutable ref for tool blocks accumulated during streaming
  const blocksRef = useRef<ContentBlock[]>([]);
  const toolIdCounterRef = useRef(0);

  // Typewriter effect: buffer the full accumulated text from SSE and reveal
  // it gradually so the output feels smooth rather than jumping in chunks.
  const targetTextRef = useRef("");
  const revealedLenRef = useRef(0);
  const rafRef = useRef<number | null>(null);

  // Smooth typewriter: reveal text gradually.  We vary speed based on how
  // far behind the reveal cursor is — fast enough to keep up with real-time
  // streaming but slow enough to look like typing when text arrives in bursts.
  const tickTypewriter = useCallback(() => {
    rafRef.current = null;
    const target = targetTextRef.current;
    const current = revealedLenRef.current;
    if (current >= target.length) return;

    // How much unrevealed text is buffered
    const pending = target.length - current;
    // 2-4 chars/frame when close to caught up (typing feel),
    // scales up to 12 when buffer grows so we don't fall behind.
    const speed = Math.min(2 + Math.floor(pending / 40), 12);
    const next = Math.min(current + speed, target.length);
    revealedLenRef.current = next;
    setStreamingContent(target.slice(0, next));

    if (next < target.length) {
      rafRef.current = requestAnimationFrame(tickTypewriter);
    }
  }, []);

  const flushBlocks = useCallback(() => {
    setStreamingBlocks([...blocksRef.current]);
  }, []);

  const resetStreaming = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    blocksRef.current = [];
    targetTextRef.current = "";
    revealedLenRef.current = 0;
    setStreamingBlocks([]);
    setStreamingContent(null);
    setStreamingTarget(null);
  }, []);

  const clearReconnectTimer = () => {
    if (reconnectTimerRef.current !== null) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  };

  const connectSSE = useCallback(
    (isReconnect: boolean) => {
      if (cancelledRef.current) return;

      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }

      const es = new EventSource(`/api/projects/${projectId}/chat/stream`, {
        withCredentials: true,
      });
      eventSourceRef.current = es;

      es.onopen = () => {
        if (cancelledRef.current) return;
        backoffRef.current = BACKOFF_INITIAL_MS;
        lastEventTimeRef.current = Date.now();
        setConnected(true);
        setError(null);

        if (isReconnect) {
          api
            .getChatHistory(projectId)
            .then((d) => {
              if (cancelledRef.current) return;
              setMessages(d.messages);
              const lastMsg = d.messages[d.messages.length - 1];
              if (lastMsg?.role === "assistant") {
                resetStreaming();
              }
            })
            .catch(() => {});
        }
      };

      es.onerror = () => {
        if (cancelledRef.current) return;
        setConnected(false);
        es.close();
        eventSourceRef.current = null;

        clearReconnectTimer();
        const delay = backoffRef.current;
        backoffRef.current = Math.min(backoffRef.current * 2, BACKOFF_MAX_MS);
        reconnectTimerRef.current = setTimeout(() => {
          if (!cancelledRef.current) connectSSE(true);
        }, delay);
      };

      const markEvent = () => {
        lastEventTimeRef.current = Date.now();
        setConnected(true);
      };

      es.addEventListener("ping", markEvent);

      es.addEventListener("message", (e) => {
        markEvent();
        const msg = JSON.parse(e.data) as ChatMessage;
        if (msg.role === "assistant") {
          // Merge streamed tool blocks into the final message if
          // the backend didn't already include them.
          const toolBlocks = blocksRef.current
            .filter((b) => b.type === "tool_use")
            .map((b) => ({ ...b, _loading: false }));
          if (toolBlocks.length > 0) {
            const existing = msg.contentBlocks ?? [];
            const alreadyHasTools = existing.some((b) => b.type === "tool_use");
            if (!alreadyHasTools) {
              const textBlocks = existing.length > 0
                ? existing
                : msg.content ? [{ type: "text" as const, text: msg.content }] : [];
              // Text first, then tools — matches natural reading order.
              msg.contentBlocks = [...textBlocks, ...toolBlocks];
            }
          }
          resetStreaming();
          setTeamActivity([]);
        }
        setMessages((prev) => {
          if (prev.some((m) => m.id === msg.id)) return prev;
          if (msg.role === "user") {
            const idx = prev.findIndex(
              (m) =>
                m.id.startsWith("optimistic-") && m.content === msg.content,
            );
            if (idx >= 0) {
              const updated = [...prev];
              updated[idx] = {
                ...msg,
                _stableKey: prev[idx]._stableKey ?? prev[idx].id,
              };
              return updated;
            }
          }
          // Insert in chronological order to handle out-of-order arrivals.
          const next = [...prev, msg];
          next.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
          return next;
        });
      });

      es.addEventListener("chat_delta", (e) => {
        markEvent();
        const { accumulated } = JSON.parse(e.data) as { accumulated: string };
        targetTextRef.current = accumulated;
        setStreamingTarget(accumulated);
        if (rafRef.current === null && revealedLenRef.current < accumulated.length) {
          rafRef.current = requestAnimationFrame(tickTypewriter);
        }
      });

      es.addEventListener("chat_status", (e) => {
        markEvent();
        const { state } = JSON.parse(e.data);
        if (state === "thinking") {
          setStreamingContent("Thinking...");
        }
      });

      es.addEventListener("agent_activity", (e) => {
        markEvent();
        let data: AgentActivitySSE;
        try {
          data = JSON.parse(e.data) as AgentActivitySSE;
        } catch {
          return;
        }

        if (data.type === "tool_start" && data.tool) {
          const input: Record<string, unknown> = {};
          if (data.filePath) input.file_path = data.filePath;
          if (data.command) input.command = data.command;
          if (data.text) input._description = data.text;

          blocksRef.current.push({
            type: "tool_use",
            id: `streaming-tool-${++toolIdCounterRef.current}`,
            name: data.tool,
            input,
            _loading: true,
          });
          flushBlocks();

          // Also track as background team activity (visible when orchestrator isn't streaming)
          setTeamActivity((prev) => [
            ...prev.slice(-(MAX_TEAM_ACTIVITY - 1)),
            { tool: data.tool!, text: data.text || data.filePath || data.command || "", agentName: data.agentName, timestamp: data.timestamp, loading: true },
          ]);
        } else if (data.type === "tool_end" && data.tool) {
          for (let i = blocksRef.current.length - 1; i >= 0; i--) {
            const b = blocksRef.current[i];
            if (b.type === "tool_use" && b._loading && b.name === data.tool) {
              b._loading = false;
              break;
            }
          }
          flushBlocks();

          // Mark the most recent matching tool as done in team activity
          setTeamActivity((prev) => {
            const updated = [...prev];
            for (let i = updated.length - 1; i >= 0; i--) {
              if (updated[i].tool === data.tool && updated[i].loading) {
                updated[i] = { ...updated[i], loading: false };
                break;
              }
            }
            return updated;
          });
        }
      });

      es.addEventListener("delegation_complete", (e) => {
        markEvent();
        // Clear team activity — the orchestrator will start a new turn to report
        setTeamActivity([]);
        setStreamingContent("Reviewing team results...");
      });

      es.addEventListener("task_update", markEvent);
      es.addEventListener("project_status", markEvent);
    },
    [projectId, flushBlocks, resetStreaming, tickTypewriter],
  );

  useEffect(() => {
    cancelledRef.current = false;

    setLoading(true);
    api
      .getChatHistory(projectId)
      .then((d) => {
        if (!cancelledRef.current) {
          setMessages(d.messages);
          setError(null);
        }
      })
      .catch((err: unknown) => {
        if (!cancelledRef.current) {
          const msg =
            err instanceof Error ? err.message : "Failed to load chat history";
          setError(msg);
        }
      })
      .finally(() => {
        if (!cancelledRef.current) setLoading(false);
      });

    connectSSE(false);

    staleCheckRef.current = setInterval(() => {
      if (cancelledRef.current) return;
      const elapsed = Date.now() - lastEventTimeRef.current;
      if (elapsed > STALE_THRESHOLD_MS && eventSourceRef.current) {
        setConnected(false);
        eventSourceRef.current.close();
        eventSourceRef.current = null;
        clearReconnectTimer();
        const delay = backoffRef.current;
        backoffRef.current = Math.min(backoffRef.current * 2, BACKOFF_MAX_MS);
        reconnectTimerRef.current = setTimeout(() => {
          if (!cancelledRef.current) connectSSE(true);
        }, delay);
      }
    }, STALE_THRESHOLD_MS);

    return () => {
      cancelledRef.current = true;
      clearReconnectTimer();
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      if (staleCheckRef.current !== null) {
        clearInterval(staleCheckRef.current);
        staleCheckRef.current = null;
      }
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    };
  }, [projectId, connectSSE]);

  const send = useCallback(
    async (content: string) => {
      setSending(true);
      setError(null);

      const optimisticId = `optimistic-${Date.now()}`;
      const optimisticMsg: ChatMessage = {
        id: optimisticId,
        projectId,
        role: "user",
        content,
        createdAt: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, optimisticMsg]);

      try {
        const { message } = await api.sendChatMessage(projectId, content);
        setMessages((prev) => {
          if (prev.some((m) => m.id === message.id)) {
            return prev.filter((m) => m.id !== optimisticId);
          }
          return prev.map((m) =>
            m.id === optimisticId
              ? { ...message, _stableKey: optimisticId }
              : m,
          );
        });
        setStreamingContent("Thinking...");
      } catch (err: unknown) {
        setMessages((prev) => prev.filter((m) => m.id !== optimisticId));
        const msg =
          err instanceof Error ? err.message : "Failed to send message";
        setError(msg);
      } finally {
        setSending(false);
      }
    },
    [projectId],
  );

  return {
    messages,
    send,
    sending,
    streamingContent,
    streamingTarget,
    streamingBlocks,
    teamActivity,
    loading,
    error,
    connected,
  };
}
