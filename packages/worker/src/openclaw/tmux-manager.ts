import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

export async function createSession(sessionName: string, cwd: string): Promise<void> {
  await execAsync(`tmux kill-session -t ${sessionName} 2>/dev/null || true`);
  try {
    await execAsync(`tmux new-session -d -s ${sessionName} -c ${cwd}`);
  } catch {
    // Stale socket from a dead server — nuke it and retry
    await execAsync(`tmux kill-server 2>/dev/null || true`);
    await execAsync(`rm -f /tmp/tmux-*/default 2>/dev/null || true`);
    await execAsync(`tmux new-session -d -s ${sessionName} -c ${cwd}`);
  }
}

export async function sendKeys(sessionName: string, keys: string): Promise<void> {
  // Escape single quotes for shell safety
  const escaped = keys.replace(/'/g, "'\\''");
  await execAsync(`tmux send-keys -t ${sessionName} '${escaped}' Enter`);
}

export async function capturePane(sessionName: string): Promise<string> {
  const { stdout } = await execAsync(`tmux capture-pane -t ${sessionName} -p -S -1000`);
  return stdout;
}

export async function waitForReady(sessionName: string, timeoutMs = 30000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const output = await capturePane(sessionName).catch(() => "");
    if (
      output.includes("ready") ||
      output.includes(">") ||
      output.includes("Human:")
    ) {
      return true;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

export async function killSession(sessionName: string): Promise<void> {
  await execAsync(`tmux kill-session -t ${sessionName} 2>/dev/null || true`);
}

export async function hasSession(sessionName: string): Promise<boolean> {
  try {
    await execAsync(`tmux has-session -t ${sessionName} 2>/dev/null`);
    return true;
  } catch {
    return false;
  }
}
