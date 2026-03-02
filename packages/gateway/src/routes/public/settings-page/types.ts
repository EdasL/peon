export interface ProviderInfo {
  name: string;
  authType: "oauth" | "device-code" | "api-key";
  supportedAuthTypes: ("oauth" | "device-code" | "api-key")[];
  apiKeyInstructions: string;
  apiKeyPlaceholder: string;
}

export interface CatalogProvider {
  id: string;
  name: string;
  iconUrl: string;
  authType: "oauth" | "device-code" | "api-key";
  supportedAuthTypes: ("oauth" | "device-code" | "api-key")[];
  apiKeyInstructions: string;
  apiKeyPlaceholder: string;
}

export interface ModelOption {
  label: string;
  value: string;
}

export interface SecretRow {
  id: number;
  key: string;
  value: string;
  reveal: boolean;
}

export interface Skill {
  repo: string;
  name: string;
  description: string;
  enabled: boolean;
  content?: string;
  contentFetchedAt?: string;
}

export interface McpConfig {
  enabled?: boolean;
  url?: string;
  command?: string;
  args?: string[];
  type?: string;
  description?: string;
}

export interface Schedule {
  scheduleId: string;
  task: string;
  scheduledFor: string;
  status: "pending" | "triggered" | "cancelled";
  isRecurring?: boolean;
  cron?: string;
  iteration?: number;
  maxIterations?: number;
}

export interface PrefillSkill {
  repo: string;
  name?: string;
  description?: string;
}

export interface PrefillMcp {
  id: string;
  name?: string;
  url?: string;
  type?: string;
  command?: string;
  args?: string[];
  envVars?: string[];
}

export interface ProviderState {
  status: string;
  connected: boolean;
  userConnected: boolean;
  systemConnected: boolean;
  showAuthFlow: boolean;
  showCodeInput: boolean;
  showDeviceCode: boolean;
  showApiKeyInput: boolean;
  activeAuthTab: string;
  activeAuthType?: string | null;
  authMethods?: string[];
  code: string;
  apiKey: string;
  userCode: string;
  verificationUrl: string;
  pollStatus: string;
  deviceAuthId: string;
  selectedModel: string;
  modelQuery: string;
  showModelDropdown: boolean;
}

export interface PermissionGrant {
  pattern: string;
  expiresAt: number | null;
  denied?: boolean;
  grantedAt?: number;
}

export interface CuratedSkill {
  id: string;
  repo: string;
  name: string;
  description: string;
  installs?: number;
}

export interface CuratedMcp {
  id: string;
  name: string;
  description: string;
}

export interface AgentInfo {
  agentId: string;
  name: string;
  isWorkspaceAgent?: boolean;
  channelCount: number;
  description?: string;
}

export interface SettingsState {
  agentId: string;
  PROVIDERS: Record<string, ProviderInfo>;
  providerOrder: string[];
  providerModels: Record<string, ModelOption[]>;
  catalogProviders: CatalogProvider[];
  initialSkills: Skill[];
  initialMcpServers: Record<string, McpConfig>;
  prefillSkills: PrefillSkill[];
  prefillMcpServers: PrefillMcp[];
  prefillGrants: string[];
  prefillNixPackages: string[];
  prefillEnvVars: string[];
  initialSecrets: { key: string; value: string }[];
  initialNixPackages: string[];
  agentName: string;
  agentDescription: string;
  hasChannelId: boolean;
  verboseLogging: boolean;
  identityMd: string;
  soulMd: string;
  userMd: string;
  // Injected by the server into the HTML shell
  platform: string;
  userId: string;
  channelId?: string;
  teamId?: string;
  message?: string;
  showSwitcher: boolean;
  agents: AgentInfo[];
  hasNoProviders: boolean;
  // Provider icon URLs for rendering
  providerIconUrls: Record<string, string>;
}

export interface SettingsSnapshot {
  identityMd: string;
  soulMd: string;
  userMd: string;
  verboseLogging: boolean;
  primaryProvider: string;
  providerOrder: string;
  nixPackages: string;
  envVars: string;
  skills: string;
  mcpServers: string;
  permissions: string;
}
