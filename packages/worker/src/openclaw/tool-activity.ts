/**
 * Shared helper: generate human-readable activity text for tool calls.
 *
 * Used by both:
 *   - OpenClawWorker (main session tool_start events via WebSocket)
 *   - peon-gateway plugin (subprocess stream-json tool_use events)
 *
 * Examples:
 *   Read  { file_path: "src/App.tsx" }            → "Reading src/App.tsx"
 *   Edit  { file_path: "src/App.tsx" }            → "Editing src/App.tsx"
 *   Write { file_path: "src/App.tsx" }            → "Writing src/App.tsx"
 *   Bash  { command: "npm test" }                 → "Running npm test"
 *   Grep  { pattern: "useState", path: "src" }    → "Searching 'useState' in src"
 *   Glob  { pattern: "**\/*.ts" }                 → "Globbing **\/*.ts"
 *   TaskCreate { subject: "Fix login" }           → "Creating task: Fix login"
 *   TaskUpdate { status: "in_progress" }          → "Updating task (in_progress)"
 */
export function buildToolActivityText(
  toolName: string,
  input: Record<string, unknown>
): string | undefined {
  const filePath = (input.file_path ?? input.path) as string | undefined;
  const shortPath = filePath
    ? filePath.split("/").slice(-2).join("/")
    : undefined;

  switch (toolName.toLowerCase()) {
    case "read":
      return shortPath ? `Reading ${shortPath}` : "Reading file";
    case "edit":
    case "multiedit":
    case "streplace":
      return shortPath ? `Editing ${shortPath}` : "Editing file";
    case "write":
      return shortPath ? `Writing ${shortPath}` : "Writing file";

    case "bash":
    case "exec":
    case "shell": {
      const cmd = (input.command as string | undefined) ?? "";
      return cmd ? `Running ${cmd.slice(0, 100)}` : "Running command";
    }

    case "grep": {
      const pattern = (input.pattern as string | undefined) ?? "";
      const inPath = (input.path as string | undefined) ?? "";
      if (pattern && inPath)
        return `Searching '${pattern.slice(0, 40)}' in ${inPath.split("/").slice(-2).join("/")}`;
      if (pattern) return `Searching '${pattern.slice(0, 40)}'`;
      return "Searching";
    }

    case "glob": {
      const pattern = (input.pattern ?? input.glob_pattern) as string | undefined;
      return pattern ? `Globbing ${pattern.slice(0, 60)}` : "Listing files";
    }

    case "webfetch":
    case "websearch": {
      const target = (input.url ?? input.query ?? input.search_term) as string | undefined;
      return target ? `Fetching ${String(target).slice(0, 60)}` : "Fetching web";
    }

    case "taskcreate": {
      const subject = (input.subject as string | undefined) ?? "";
      return subject ? `Creating task: ${subject.slice(0, 60)}` : "Creating task";
    }

    case "taskupdate": {
      const status = (input.status as string | undefined) ?? "";
      const taskId = (input.taskId as string | undefined) ?? "";
      if (status && taskId) return `Updating task ${taskId} → ${status}`;
      if (status) return `Updating task (${status})`;
      return "Updating task";
    }

    case "tasklist":
      return "Listing tasks";

    case "todowrite":
      return "Updating tasks";

    case "task":
      return "Launching task";

    default: {
      // Generic fallback: use most useful available field
      if (shortPath) return shortPath;
      if (input.command) return String(input.command).slice(0, 80);
      if (input.query) return String(input.query).slice(0, 60);
      if (input.subject) return String(input.subject).slice(0, 60);
      return undefined;
    }
  }
}
