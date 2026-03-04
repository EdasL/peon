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
    if "notification_type" in hook_context:
        payload["notificationType"] = hook_context["notification_type"]
    if "error" in hook_context:
        payload["error"] = str(hook_context["error"])[:500]

    # Gateway URL from env (set by worker container)
    gateway_url = os.environ.get("GATEWAY_URL", "http://localhost:8080")
    worker_token = os.environ.get("WORKER_TOKEN", "")

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


if __name__ == "__main__":
    main()
