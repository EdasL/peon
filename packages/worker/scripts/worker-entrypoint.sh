#!/bin/bash
set -e

# Container entrypoint script for Peon Worker
echo "🚀 Starting Peon Worker..."

# Function to handle cleanup on exit
cleanup() {
    echo "📦 Container shutting down, performing cleanup..."

    # Kill OpenClaw gateway if running
    if [ -n "${OPENCLAW_PID:-}" ] && kill -0 "$OPENCLAW_PID" 2>/dev/null; then
        echo "  Stopping OpenClaw gateway (PID: $OPENCLAW_PID)..."
        kill "$OPENCLAW_PID" 2>/dev/null || true
    fi

    # Kill all tmux sessions and the tmux server (not managed by shell jobs)
    tmux kill-server 2>/dev/null || true

    # Kill any other background processes
    jobs -p | xargs -r kill || true

    # Give processes time to exit gracefully
    sleep 2

    echo "✅ Cleanup completed"
    exit 0
}

# Setup signal handlers for graceful shutdown
trap cleanup SIGTERM SIGINT

echo "🔍 Environment variables provided by orchestrator:"
echo "  - USER_ID: ${USER_ID:-not set}" 
echo "  - CHANNEL_ID: ${CHANNEL_ID:-not set}"
echo "  - REPOSITORY_URL: ${REPOSITORY_URL:-not set}"
echo "  - DEPLOYMENT_NAME: ${DEPLOYMENT_NAME:-not set}"

# Basic validation for critical variables
if [[ -z "${USER_ID:-}" ]]; then
    echo "❌ Error: USER_ID is required"
    exit 1
fi

if [[ -z "${DEPLOYMENT_NAME:-}" ]]; then
    echo "❌ Error: DEPLOYMENT_NAME is required"
    exit 1
fi

# Setup workspace directory
echo "📁 Setting up workspace directory..."
WORKSPACE_DIR="/workspace"

# Workspace permissions are fixed by gateway before container starts
# Just verify we can write to it
if [ ! -w "$WORKSPACE_DIR" ]; then
    echo "❌ Error: Cannot write to workspace directory $WORKSPACE_DIR"
    exit 1
fi

# Route temp files and cache to workspace-backed paths.
# Keep /tmp mounted for compatibility with tools that ignore TMPDIR.
export TMPDIR="${TMPDIR:-$WORKSPACE_DIR/.tmp}"
export TMP="${TMP:-$TMPDIR}"
export TEMP="${TEMP:-$TMPDIR}"
export XDG_CACHE_HOME="${XDG_CACHE_HOME:-$WORKSPACE_DIR/.cache}"
mkdir -p "$TMPDIR" "$XDG_CACHE_HOME"

# Clean up stale tmux sockets from previous container runs.
# A dead socket causes "no server running on ..." errors.
tmux kill-server 2>/dev/null || true
rm -f /tmp/tmux-*/default 2>/dev/null || true

cd "$WORKSPACE_DIR"

echo "✅ Workspace directory ready: $WORKSPACE_DIR"

# Log container information
echo "📊 Container Information:"
echo "  - Session Key: $SESSION_KEY"
echo "  - Repository: $REPOSITORY_URL"
echo "  - Working Directory: $(pwd)"
echo "  - Container Hostname: $(hostname)"
echo "  - Container Memory Limit: $(cat /sys/fs/cgroup/memory.max 2>/dev/null || echo 'unknown')"
echo "  - Container CPU Limit: $(cat /sys/fs/cgroup/cpu.max 2>/dev/null || echo 'unknown')"

# Setup git global configuration
echo "⚙️ Setting up git configuration..."
git config --global user.name "Peon Worker"
git config --global user.email "peon@noreply.github.com"
git config --global init.defaultBranch main
git config --global pull.rebase false
git config --global safe.directory '*'

# Configure GitHub access if GH_TOKEN is available
if [ -n "${GH_TOKEN:-}" ]; then
    echo "🔐 Setting up GitHub authentication..."
    # Rewrite HTTPS github URLs to embed the token for git push/clone/fetch
    git config --global url."https://x-access-token:${GH_TOKEN}@github.com/".insteadOf "https://github.com/"
    # gh CLI picks up GH_TOKEN from the environment automatically
fi

# In development mode, ensure core package can find its dependencies
# The packages/ dir is mounted as a volume which may contain node_modules from host
if [ "${NODE_ENV}" = "development" ]; then
    # Remove any existing node_modules that aren't symlinks (non-fatal on read-only rootfs)
    if [ -e "/app/packages/core/node_modules" ] && [ ! -L "/app/packages/core/node_modules" ]; then
        echo "🗑️  Removing host node_modules from /app/packages/core/"
        rm -rf /app/packages/core/node_modules 2>/dev/null || true
    fi
    if [ ! -e "/app/packages/core/node_modules" ]; then
        echo "🔗 Creating symlink for core package dependencies..."
        ln -sf /app/node_modules /app/packages/core/node_modules 2>/dev/null || true
    fi

    # Also for worker package if needed (non-fatal on read-only rootfs)
    if [ -e "/app/packages/worker/node_modules" ] && [ ! -L "/app/packages/worker/node_modules" ]; then
        rm -rf /app/packages/worker/node_modules 2>/dev/null || true
    fi
    if [ ! -e "/app/packages/worker/node_modules" ]; then
        ln -sf /app/node_modules /app/packages/worker/node_modules 2>/dev/null || true
    fi
fi

# Source Nix profile if installed (non-interactive shells don't source /etc/profile.d)
if [ -f /home/worker/.nix-profile/etc/profile.d/nix.sh ]; then
    . /home/worker/.nix-profile/etc/profile.d/nix.sh
    # Set NIX_PATH for nix-shell -p to find nixpkgs
    export NIX_PATH="nixpkgs=/home/worker/.nix-defexpr/channels/nixpkgs"
fi

# Docker fallback: persist Nix store on workspace PVC via symlinks
# (K8s uses init container + subPath mounts instead, detected by .nix-pvc-mounted marker)
if [ -n "${NIX_PACKAGES:-}${NIX_FLAKE_URL:-}" ] && [ ! -d "/nix/store/.nix-pvc-mounted" ]; then
    NIX_PVC_STORE="/workspace/.nix-store"
    NIX_PVC_VAR="/workspace/.nix-var"
    MARKER="/workspace/.nix-bootstrapped"
    if [ ! -f "$MARKER" ]; then
        echo "Bootstrapping Nix store to PVC..."
        cp -a /nix/store "$NIX_PVC_STORE"
        cp -a /nix/var "$NIX_PVC_VAR"
        touch "$MARKER"
    fi
    rm -rf /nix/store /nix/var
    ln -sf "$NIX_PVC_STORE" /nix/store
    ln -sf "$NIX_PVC_VAR" /nix/var
    echo "Nix store linked to PVC"
fi

# Nix environment activation
# Priority: API env vars > repo files
activate_nix_env() {
    local cmd="$1"

    # Check if Nix is installed
    if ! command -v nix &> /dev/null; then
        echo "⚠️  Nix not installed, skipping environment activation"
        exec $cmd
    fi

    # 1. API-provided flake URL takes highest priority
    if [ -n "${NIX_FLAKE_URL:-}" ]; then
        echo "🔧 Activating Nix flake environment: $NIX_FLAKE_URL"
        exec nix develop "$NIX_FLAKE_URL" --command $cmd
    fi

    # 2. API-provided packages list
    if [ -n "${NIX_PACKAGES:-}" ]; then
        # Convert comma-separated to space-separated
        local packages="${NIX_PACKAGES//,/ }"
        echo "🔧 Activating Nix packages: $packages"
        exec nix-shell -p $packages --command "$cmd"
    fi

    # 3. Check for nix files in workspace (git-based config)
    if [ -f "$WORKSPACE_DIR/flake.nix" ]; then
        echo "🔧 Detected flake.nix in workspace, activating..."
        exec nix develop "$WORKSPACE_DIR" --command $cmd
    fi

    if [ -f "$WORKSPACE_DIR/shell.nix" ]; then
        echo "🔧 Detected shell.nix in workspace, activating..."
        exec nix-shell "$WORKSPACE_DIR/shell.nix" --command "$cmd"
    fi

    # 4. Check for simple .nix-packages file (one package per line)
    if [ -f "$WORKSPACE_DIR/.nix-packages" ]; then
        local packages=$(cat "$WORKSPACE_DIR/.nix-packages" | tr '\n' ' ')
        echo "🔧 Detected .nix-packages file, activating: $packages"
        exec nix-shell -p $packages --command "$cmd"
    fi

    # No nix config found, run directly
    exec $cmd
}

# Write credential files if OAuth or API key env vars are set.
if [ -n "${CLAUDE_CODE_OAUTH_TOKEN:-}" ]; then
    echo "🔐 Writing OAuth credentials..."

    # Claude Code CLI credentials
    CLAUDE_CONFIG_DIR="${HOME:-/workspace}/.claude"
    mkdir -p "$CLAUDE_CONFIG_DIR"
    cat > "$CLAUDE_CONFIG_DIR/.credentials.json" << CREDEOF
{
  "claudeAiOauth": {
    "accessToken": "${CLAUDE_CODE_OAUTH_TOKEN}",
    "refreshToken": "${CLAUDE_CODE_OAUTH_REFRESH_TOKEN:-}",
    "expiresAt": "9999999999999",
    "scopes": "${CLAUDE_CODE_OAUTH_SCOPES:-user:inference}"
  }
}
CREDEOF
    chmod 600 "$CLAUDE_CONFIG_DIR/.credentials.json"
    echo "  Claude CLI credentials written to $CLAUDE_CONFIG_DIR/.credentials.json"

    # OpenClaw shared auth store — agent-registry.ts copies this to each project agent
    OPENCLAW_AUTH_DIR="${HOME:-/workspace}/.openclaw"
    mkdir -p "$OPENCLAW_AUTH_DIR"
    cat > "$OPENCLAW_AUTH_DIR/auth-profiles.json" << AUTHEOF
{
  "version": 1,
  "profiles": {
    "anthropic:default": {
      "type": "token",
      "provider": "anthropic",
      "token": "${CLAUDE_CODE_OAUTH_TOKEN}"
    }
  },
  "lastGood": {
    "anthropic": "anthropic:default"
  }
}
AUTHEOF
    chmod 600 "$OPENCLAW_AUTH_DIR/auth-profiles.json"
    echo "  OpenClaw auth-profiles.json written to $OPENCLAW_AUTH_DIR/auth-profiles.json"

elif [ -n "${ANTHROPIC_API_KEY:-}" ]; then
    echo "🔐 Writing API key credentials..."

    OPENCLAW_AUTH_DIR="${HOME:-/workspace}/.openclaw"
    mkdir -p "$OPENCLAW_AUTH_DIR"
    cat > "$OPENCLAW_AUTH_DIR/auth-profiles.json" << AUTHEOF
{
  "version": 1,
  "profiles": {
    "anthropic:default": {
      "type": "token",
      "provider": "anthropic",
      "token": "${ANTHROPIC_API_KEY}"
    }
  },
  "lastGood": {
    "anthropic": "anthropic:default"
  }
}
AUTHEOF
    chmod 600 "$OPENCLAW_AUTH_DIR/auth-profiles.json"
    echo "  OpenClaw auth-profiles.json written"
fi

# Write Claude Code settings.json with required plugins and model config
echo "  Writing Claude Code settings..."
CLAUDE_CONFIG_DIR="${HOME:-/workspace}/.claude"
mkdir -p "$CLAUDE_CONFIG_DIR"
cat > "$CLAUDE_CONFIG_DIR/settings.json" << 'SETTINGSEOF'
{
  "model": "opus",
  "theme": "dark",
  "hasCompletedOnboarding": true,
  "teammateMode": "in-process",
  "enabledPlugins": {
    "frontend-design@claude-plugins-official": true,
    "context7@claude-plugins-official": true,
    "code-review@claude-plugins-official": true,
    "github@claude-plugins-official": true,
    "feature-dev@claude-plugins-official": true,
    "code-simplifier@claude-plugins-official": true,
    "playwright@claude-plugins-official": true,
    "typescript-lsp@claude-plugins-official": true,
    "superpowers@claude-plugins-official": true,
    "figma@claude-plugins-official": true
  },
  "skipDangerousModePermissionPrompt": true,
  "env": {
    "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1"
  }
}
SETTINGSEOF
chmod 644 "$CLAUDE_CONFIG_DIR/settings.json"
echo "  Claude Code settings.json written to $CLAUDE_CONFIG_DIR/settings.json"

# Copy plugins to a non-mounted path so permissions are correct.
# On Windows/NTFS bind mounts, everything appears as mode=777 inside the
# container and chmod is a no-op. OpenClaw blocks world-writable plugin paths.
# We mirror the directory structure so relative imports (e.g. ../../tmux-manager.js)
# still resolve correctly.
OPENCLAW_PLUGIN_MIRROR="/tmp/openclaw-plugins"
OPENCLAW_PLUGIN_DIR="$OPENCLAW_PLUGIN_MIRROR/plugins/peon-gateway"
rm -rf "$OPENCLAW_PLUGIN_MIRROR"
mkdir -p "$OPENCLAW_PLUGIN_DIR"
# Copy the plugin itself
cp -a /app/packages/worker/src/openclaw/plugins/peon-gateway/. "$OPENCLAW_PLUGIN_DIR/"
# Copy sibling files the plugin imports via relative paths (../../tmux-manager.js)
cp -a /app/packages/worker/src/openclaw/tmux-manager.ts "$OPENCLAW_PLUGIN_MIRROR/"
# Fix permissions on the whole tree
find "$OPENCLAW_PLUGIN_MIRROR" -type d -exec chmod 755 {} +
find "$OPENCLAW_PLUGIN_MIRROR" -type f -exec chmod 644 {} +
export OPENCLAW_PLUGIN_DIR

# Start the OpenClaw gateway as a background subprocess
echo "🚀 Starting OpenClaw gateway..."
OPENCLAW_PORT="${OPENCLAW_PORT:-18789}"

# Generate bootstrap OpenClaw config BEFORE starting the gateway
echo "📝 Generating OpenClaw bootstrap config..."
cd /app/packages/worker
if bun -e "
import { writeBootstrapConfig } from './src/openclaw/bootstrap-config.ts';
await writeBootstrapConfig({ port: ${OPENCLAW_PORT} });
" 2>&1; then
    echo "  Bootstrap config generated successfully"
else
    echo "⚠️  Bootstrap config generation failed, generating fallback config..."
    mkdir -p "$WORKSPACE_DIR/.openclaw"
    cat > "$WORKSPACE_DIR/.openclaw/openclaw.json" << CFGEOF
{
  "gateway": {
    "mode": "local",
    "port": ${OPENCLAW_PORT},
    "bind": "lan",
    "auth": { "mode": "token", "token": "${OPENCLAW_GATEWAY_TOKEN:-fallback-token}" },
    "controlUi": { "allowedOrigins": ["*"] }
  },
  "agents": {
    "defaults": {
      "model": "anthropic/claude-sonnet-4-20250514"
    },
    "list": []
  },
  "skills": {
    "load": { "extraDirs": ["/app/packages/worker/src/openclaw/skills"] }
  },
  "plugins": {
    "load": { "paths": ["${OPENCLAW_PLUGIN_DIR}"] }
  },
  "tools": { "agentToAgent": { "enabled": true, "allow": ["*"] } }
}
CFGEOF
    echo "  Fallback config written to $WORKSPACE_DIR/.openclaw/openclaw.json"
fi
cd "$WORKSPACE_DIR"

# Ensure a gateway token exists for OpenClaw auth (required for bind=lan)
if [ -z "$OPENCLAW_GATEWAY_TOKEN" ]; then
    OPENCLAW_GATEWAY_TOKEN=$(head -c 32 /dev/urandom | xxd -p | tr -d '\n')
    export OPENCLAW_GATEWAY_TOKEN
fi

# OpenClaw gateway makes direct HTTPS calls to LLM provider APIs
# (api.anthropic.com). Unset the worker HTTP proxy env vars so it
# connects directly instead of routing through the authenticated proxy.
HTTP_PROXY= HTTPS_PROXY= http_proxy= https_proxy= \
  openclaw gateway --port "$OPENCLAW_PORT" --bind lan --token "$OPENCLAW_GATEWAY_TOKEN" &
OPENCLAW_PID=$!
echo "  OpenClaw gateway PID: $OPENCLAW_PID"

# Wait for OpenClaw gateway to be ready (health check via HTTP)
OPENCLAW_READY=false
OPENCLAW_MAX_RETRIES=60
OPENCLAW_RETRY=0
while [ "$OPENCLAW_READY" = "false" ] && [ "$OPENCLAW_RETRY" -lt "$OPENCLAW_MAX_RETRIES" ]; do
    OPENCLAW_RETRY=$((OPENCLAW_RETRY + 1))
    if curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:${OPENCLAW_PORT}/health" 2>/dev/null | grep -q "200"; then
        OPENCLAW_READY=true
        echo "✅ OpenClaw gateway is ready on port $OPENCLAW_PORT"
    else
        # Also check if process is still alive
        if ! kill -0 "$OPENCLAW_PID" 2>/dev/null; then
            echo "❌ OpenClaw gateway process died unexpectedly"
            # Try starting it again
            HTTP_PROXY= HTTPS_PROXY= http_proxy= https_proxy= \
              openclaw gateway --port "$OPENCLAW_PORT" --bind lan --token "$OPENCLAW_GATEWAY_TOKEN" &
            OPENCLAW_PID=$!
            echo "  Restarted OpenClaw gateway PID: $OPENCLAW_PID"
        fi
        sleep 1
    fi
done

if [ "$OPENCLAW_READY" = "false" ]; then
    echo "  OpenClaw gateway did not become ready after ${OPENCLAW_MAX_RETRIES}s, proceeding anyway..."
fi

export OPENCLAW_PORT
export OPENCLAW_PID

# Install OpenClaw skills from ClawHub (requires gateway + network access).
# Bundled skills (coding-agent, github, tmux) are loaded automatically by the
# OpenClaw gateway from the npm package — no install needed.
# Non-bundled skills must be fetched from ClawHub into ~/.openclaw/skills/.
echo "  Installing OpenClaw skills from ClawHub..."
CLAWHUB_SKILLS="summarize oracle"
CLAWHUB_WORKDIR="${HOME:-/workspace}/.openclaw"
mkdir -p "$CLAWHUB_WORKDIR/skills"
for skill in $CLAWHUB_SKILLS; do
    if [ -d "$CLAWHUB_WORKDIR/skills/$skill" ]; then
        echo "  Skill $skill already installed, skipping"
    elif command -v clawhub &>/dev/null; then
        clawhub install "$skill" --workdir "$CLAWHUB_WORKDIR" --no-input 2>&1 \
            || echo "  Warning: Failed to install skill $skill from ClawHub"
    else
        echo "  Warning: clawhub CLI not found, cannot install $skill"
    fi
done
echo "  Verifying loaded skills..."
openclaw skills list 2>&1 | head -30 || true
echo "  OpenClaw skills installation complete"

# Report boot progress: workspace configured (before starting TypeScript)
if [ -n "${DISPATCHER_URL:-}" ] && [ -n "${WORKER_TOKEN:-}" ]; then
    curl -sf -X POST "${DISPATCHER_URL}/internal/boot-progress" \
        -H "Authorization: Bearer ${WORKER_TOKEN}" \
        -H "Content-Type: application/json" \
        -d '{"step":"workspace","label":"Workspace configured"}' \
        --max-time 5 2>/dev/null || true
fi

# Start the worker process
echo "🚀 Executing Worker..."
# Check if we're already in the worker directory
if [ "$(pwd)" != "/app/packages/worker" ]; then
    cd /app/packages/worker || { echo "❌ Failed to cd to /app/packages/worker"; exit 1; }
fi

# Always run from source — Bun handles TypeScript natively and this avoids
# CJS/ESM interop issues with ESM-only dependencies.
activate_nix_env "bun run src/index.ts"
