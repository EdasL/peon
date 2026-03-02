import { useSignal } from "@preact/signals";
import { marked } from "marked";
import type { HistoryMessage } from "../types";

// Configure marked for inline rendering (no wrapping <p> tags for single lines)
marked.setOptions({ breaks: true, gfm: true });

function formatTimestamp(ts: string): string {
  try {
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return ts;
  }
}

function renderContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((block: any) => {
        if (block.type === "text") return block.text;
        if (block.type === "toolCall") return `[Tool: ${block.name}]`;
        if (block.type === "thinking") return "[Thinking...]";
        if (block.type === "image") return "[Image]";
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  if (content && typeof content === "object") {
    return JSON.stringify(content, null, 2);
  }
  return String(content || "");
}

function renderMarkdown(text: string): string {
  return marked.parse(text, { async: false }) as string;
}

function truncateText(
  text: string,
  maxLen: number
): { text: string; truncated: boolean } {
  if (text.length <= maxLen) return { text, truncated: false };
  return { text: text.slice(0, maxLen), truncated: true };
}

export function MessageRow({
  message,
  isFocused,
}: {
  message: HistoryMessage;
  isFocused: boolean;
}) {
  const expanded = useSignal(false);
  const contentText = renderContent(message.content);
  const { text: displayText, truncated } = truncateText(contentText, 1000);

  // System pills for model_change and compaction
  if (message.type === "model_change") {
    return (
      <div class="flex justify-center px-4 py-1">
        <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 text-xs">
          <svg
            aria-hidden="true"
            class="w-3 h-3"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
            />
          </svg>
          Model: {String(message.content)}
        </span>
      </div>
    );
  }

  if (message.type === "compaction") {
    return (
      <div class="flex justify-center px-4 py-1">
        <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-50 text-amber-600 text-xs">
          <svg
            aria-hidden="true"
            class="w-3 h-3"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
            />
          </svg>
          Context compacted
        </span>
      </div>
    );
  }

  const isUser = message.role === "user";
  const isAssistant = message.role === "assistant";
  const isToolResult = message.role === "toolResult";

  // Tool results — collapsible muted block
  if (isToolResult) {
    return (
      <div class={`px-4 py-1 ${isFocused ? "bg-yellow-50" : ""}`}>
        <button
          type="button"
          class="w-full text-left"
          onClick={() => {
            expanded.value = !expanded.value;
          }}
        >
          <div class="flex items-center gap-1 text-xs text-gray-400">
            <svg
              aria-hidden="true"
              class={`w-3 h-3 transition-transform ${expanded.value ? "rotate-90" : ""}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 5l7 7-7 7"
              />
            </svg>
            Tool Result
            <span class="ml-auto">{formatTimestamp(message.timestamp)}</span>
          </div>
        </button>
        {expanded.value && (
          <pre class="mt-1 p-2 bg-gray-50 rounded text-xs text-gray-600 overflow-x-auto whitespace-pre-wrap break-words max-h-96 overflow-y-auto">
            {contentText}
          </pre>
        )}
      </div>
    );
  }

  // User message — right-aligned bubble
  if (isUser) {
    return (
      <div
        class={`flex justify-end px-4 py-2 ${isFocused ? "bg-yellow-50" : ""}`}
      >
        <div class="max-w-[80%]">
          <div class="bg-blue-500 text-white rounded-2xl rounded-br-sm px-4 py-2 text-sm break-words prose prose-sm prose-invert max-w-none">
            <div
              // biome-ignore lint/security/noDangerouslySetInnerHtml: rendering pre-sanitized markdown
              dangerouslySetInnerHTML={{
                __html: renderMarkdown(
                  expanded.value || !truncated ? contentText : displayText
                ),
              }}
            />
            {truncated && !expanded.value && (
              <button
                type="button"
                class="ml-1 text-blue-200 underline text-xs"
                onClick={() => {
                  expanded.value = true;
                }}
              >
                more
              </button>
            )}
          </div>
          <div class="text-right text-xs text-gray-400 mt-0.5 mr-1">
            {formatTimestamp(message.timestamp)}
          </div>
        </div>
      </div>
    );
  }

  // Assistant message — left-aligned block
  if (isAssistant) {
    return (
      <div
        class={`flex justify-start px-4 py-2 ${isFocused ? "bg-yellow-50" : ""}`}
      >
        <div class="max-w-[80%]">
          <div class="bg-white border border-gray-200 rounded-2xl rounded-bl-sm px-4 py-2 text-sm break-words shadow-sm prose prose-sm max-w-none">
            <div
              // biome-ignore lint/security/noDangerouslySetInnerHtml: rendering pre-sanitized markdown
              dangerouslySetInnerHTML={{
                __html: renderMarkdown(
                  expanded.value || !truncated ? contentText : displayText
                ),
              }}
            />
            {truncated && !expanded.value && (
              <button
                type="button"
                class="ml-1 text-blue-500 underline text-xs"
                onClick={() => {
                  expanded.value = true;
                }}
              >
                more
              </button>
            )}
          </div>
          <div class="flex items-center gap-2 text-xs text-gray-400 mt-0.5 ml-1">
            <span>{formatTimestamp(message.timestamp)}</span>
            {message.usage && (
              <span>
                {message.usage.inputTokens?.toLocaleString()}↓{" "}
                {message.usage.outputTokens?.toLocaleString()}↑
              </span>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Fallback for custom_message or unknown types
  return (
    <div class={`px-4 py-2 ${isFocused ? "bg-yellow-50" : ""}`}>
      <div class="bg-gray-50 border border-gray-100 rounded-lg px-3 py-2 text-sm text-gray-600 whitespace-pre-wrap break-words">
        {contentText}
      </div>
      <div class="text-xs text-gray-400 mt-0.5 ml-1">
        {message.type} — {formatTimestamp(message.timestamp)}
      </div>
    </div>
  );
}
