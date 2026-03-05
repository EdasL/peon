#!/usr/bin/env python3
"""
Claude Code hook event forwarder.

Called by Claude Code hooks (PreToolUse, PostToolUse, etc.) to POST
hook events to the gateway, which maps them to agent status updates
and broadcasts via SSE.

Adapted from disler/claude-code-hooks-multi-agent-observability pattern.

Usage:
  python3 send_event.py --event-type PreToolUse --source-app <agentId>

Reads hook context from stdin (JSON), forwards relevant fields to gateway.
"""

import argparse
import json
import os
import sys
import urllib.request
import urllib.error


def main():
    parser = argparse.ArgumentParser(description="Forward Claude Code hook events to gateway")
    parser.add_argument("--event-type", required=True, help="Hook event type (PreToolUse, PostToolUse, etc.)")
    parser.add_argument("--source-app", required=True, help="Agent identifier")
    parser.add_argument("--gateway-url", default=None, help="Gateway URL (overrides GATEWAY_URL env)")
    parser.add_argument("--worker-token", default=None, help="Worker token (overrides WORKER_TOKEN env)")
    parser.add_argument("--project-id", default=None, help="Project ID to include in payload")
    args = parser.parse_args()

    # Read hook context from stdin
    hook_context = {}
    try:
        raw = sys.stdin.read()
        if raw.strip():
            hook_context = json.loads(raw)
    except (json.JSONDecodeError, IOError):
        pass

    # Build payload
    payload = {
        "eventType": args.event_type,
        "agentId": args.source_app,
        "timestamp": int(__import__("time").time() * 1000),
    }

    # Forward useful fields from hook context
    if "tool_name" in hook_context:
        payload["toolName"] = hook_context["tool_name"]
    if "tool_use_id" in hook_context:
        payload["toolUseId"] = hook_context["tool_use_id"]
    if "tool_input" in hook_context and isinstance(hook_context["tool_input"], dict):
        payload["toolInput"] = hook_context["tool_input"]
    if "notification_type" in hook_context:
        payload["notificationType"] = hook_context["notification_type"]
    if "error" in hook_context:
        payload["error"] = str(hook_context["error"])[:500]
    # TaskCompleted hook fields
    if "task_id" in hook_context:
        payload["taskId"] = hook_context["task_id"]
    if "task_subject" in hook_context:
        payload["taskSubject"] = hook_context["task_subject"]
    if "task_description" in hook_context:
        payload["taskDescription"] = hook_context["task_description"]
    if "teammate_name" in hook_context:
        payload["teammateName"] = hook_context["teammate_name"]
    if args.project_id:
        payload["projectId"] = args.project_id

    # Gateway URL: CLI arg > env var > default
    gateway_url = args.gateway_url or os.environ.get("GATEWAY_URL", "http://localhost:8080")
    worker_token = args.worker_token or os.environ.get("WORKER_TOKEN", "")

    url = f"{gateway_url}/internal/hook-events"

    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {worker_token}",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=5) as resp:
            pass  # Fire and forget, status 2xx is fine
    except (urllib.error.URLError, urllib.error.HTTPError, OSError):
        # Don't block Claude Code if gateway is unreachable
        pass

    # Write a sentinel file so the worker can detect completion without
    # parsing terminal output. The worker polls for this file.
    if args.event_type in ("Stop", "SessionEnd") and args.project_id:
        sentinel = f"/tmp/peon-team-done-{args.project_id}"
        try:
            with open(sentinel, "w") as f:
                f.write(str(int(__import__("time").time() * 1000)))
        except OSError:
            pass


if __name__ == "__main__":
    main()
