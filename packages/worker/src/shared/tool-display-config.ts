/**
 * Shared tool display configuration for progress processors.
 * Maps tool names to emoji and description formatting.
 */

export interface ToolDisplayEntry {
  emoji: string;
  action: string;
  getParam: (params: Record<string, unknown>) => string;
}

const TOOL_DISPLAY_CONFIG: Record<string, ToolDisplayEntry> = {
  Write: {
    emoji: "✏️",
    action: "Writing",
    getParam: (p) => `\`${p.file_path || ""}\``,
  },
  Edit: {
    emoji: "✏️",
    action: "Editing",
    getParam: (p) => `\`${p.file_path || ""}\``,
  },
  Bash: {
    emoji: "👾",
    action: "Running",
    getParam: (p) => {
      const cmd = String(p.command || p.description || "command");
      return `\`${cmd.length > 50 ? `${cmd.substring(0, 50)}...` : cmd}\``;
    },
  },
  Read: {
    emoji: "📖",
    action: "Reading",
    getParam: (p) => `\`${p.file_path || p.path || ""}\``,
  },
  Grep: {
    emoji: "🔍",
    action: "Searching",
    getParam: (p) => `\`${p.pattern || ""}\``,
  },
  Glob: {
    emoji: "🔍",
    action: "Finding",
    getParam: (p) => `\`${p.pattern || ""}\``,
  },
  TodoWrite: {
    emoji: "📝",
    action: "Updating task list",
    getParam: () => "",
  },
  WebFetch: {
    emoji: "🌐",
    action: "Fetching",
    getParam: (p) => `\`${p.url || ""}\``,
  },
  WebSearch: {
    emoji: "🔎",
    action: "Searching web",
    getParam: (p) => `\`${p.query || ""}\``,
  },
  DelegateToProject: {
    emoji: "🚀",
    action: "Setting up project",
    getParam: (p) => p.task ? String(p.task).slice(0, 60) : "with Claude Code team",
  },
  CreateProjectTasks: {
    emoji: "📋",
    action: "Planning tasks",
    getParam: (p) => {
      const tasks = p.tasks as unknown[] | undefined;
      return tasks?.length ? `(${tasks.length} task${tasks.length > 1 ? "s" : ""})` : "";
    },
  },
  UpdateTaskStatus: {
    emoji: "📋",
    action: "Updating task",
    getParam: (p) => p.status ? String(p.status).replace(/_/g, " ") : "",
  },
  ListProjectTasks: {
    emoji: "📋",
    action: "Reviewing tasks",
    getParam: () => "",
  },
  DeleteTask: {
    emoji: "🗑️",
    action: "Removing task",
    getParam: () => "",
  },
  CheckTeamStatus: {
    emoji: "👥",
    action: "Checking team",
    getParam: () => "",
  },
  GetTeamResult: {
    emoji: "👥",
    action: "Getting results",
    getParam: () => "",
  },
  UploadUserFile: {
    emoji: "📤",
    action: "Sharing file",
    getParam: (p) => p.file_path ? `\`${p.file_path}\`` : "",
  },
  ScheduleReminder: {
    emoji: "⏰",
    action: "Scheduling",
    getParam: (p) => p.task ? String(p.task).slice(0, 50) : "reminder",
  },
  CancelReminder: {
    emoji: "⏰",
    action: "Cancelling reminder",
    getParam: () => "",
  },
  ListReminders: {
    emoji: "⏰",
    action: "Checking reminders",
    getParam: () => "",
  },
  SearchExtensions: {
    emoji: "🧩",
    action: "Searching extensions",
    getParam: (p) => p.query ? `\`${p.query}\`` : "",
  },
  InstallExtension: {
    emoji: "🧩",
    action: "Installing extension",
    getParam: (p) => p.id ? `\`${p.id}\`` : "",
  },
  GetSettingsLink: {
    emoji: "⚙️",
    action: "Opening settings",
    getParam: () => "",
  },
  GetSettingsLinkForDomain: {
    emoji: "⚙️",
    action: "Opening settings",
    getParam: () => "",
  },
  GenerateAudio: {
    emoji: "🔊",
    action: "Generating audio",
    getParam: () => "",
  },
  GetChannelHistory: {
    emoji: "💬",
    action: "Loading history",
    getParam: () => "",
  },
  AskUserQuestion: {
    emoji: "❓",
    action: "Asking question",
    getParam: (p) => p.question ? String(p.question).slice(0, 50) : "",
  },
};

/**
 * Look up tool display config, case-insensitively.
 * OpenClaw uses lowercase tool names (bash, read, write, etc.)
 * while some agents use PascalCase (Bash, Read, Write, etc.).
 */
export function getToolDisplayConfig(
  toolName: string
): ToolDisplayEntry | undefined {
  return (
    TOOL_DISPLAY_CONFIG[toolName] ??
    TOOL_DISPLAY_CONFIG[toolName.charAt(0).toUpperCase() + toolName.slice(1)]
  );
}
