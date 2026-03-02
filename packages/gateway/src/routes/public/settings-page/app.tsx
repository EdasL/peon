import { type Signal, useSignal } from "@preact/signals";
import { createContext, render } from "preact";
import { useContext, useEffect, useRef } from "preact/hooks";
import * as api from "./api";
import { Header } from "./components/Header";
import { InstructionsSection } from "./components/InstructionsSection";
import { IntegrationsSection } from "./components/IntegrationsSection";
import { MessageBanners } from "./components/MessageBanners";
import { NixPackagesSection } from "./components/NixPackagesSection";
import { PermissionsSection } from "./components/PermissionsSection";
import { ProviderSection } from "./components/ProviderSection";
import { RemindersSection } from "./components/RemindersSection";
import { SecretsSection } from "./components/SecretsSection";
import type {
  CatalogProvider,
  CuratedMcp,
  CuratedSkill,
  McpConfig,
  ModelOption,
  PermissionGrant,
  PrefillMcp,
  PrefillSkill,
  ProviderInfo,
  ProviderState,
  Schedule,
  SecretRow,
  SettingsSnapshot,
  SettingsState,
  Skill,
} from "./types";

declare global {
  interface Window {
    __SETTINGS_STATE__: SettingsState;
    Telegram?: {
      WebApp?: {
        initData?: string;
        ready(): void;
        expand(): void;
        openLink(url: string): void;
      };
    };
  }
}

// ─── Context ───────────────────────────────────────────────────────────────

export interface SettingsContextValue {
  agentId: string;
  PROVIDERS: Record<string, ProviderInfo>;
  providerModels: Record<string, ModelOption[]>;
  catalogProviders: Signal<CatalogProvider[]>;
  providerOrder: Signal<string[]>;
  primaryProvider: Signal<string>;
  providerState: Signal<Record<string, ProviderState>>;
  showCatalog: Signal<boolean>;
  pendingProvider: Signal<(CatalogProvider & { success?: boolean }) | null>;
  deviceCodePollTimer: Signal<ReturnType<typeof setInterval> | null>;

  agentName: Signal<string>;
  agentDescription: Signal<string>;
  initialAgentName: Signal<string>;
  initialAgentDescription: Signal<string>;
  savingIdentity: Signal<boolean>;
  hasChannelId: boolean;

  successMsg: Signal<string>;
  errorMsg: Signal<string>;
  saving: Signal<boolean>;

  verboseLogging: Signal<boolean>;
  identityMd: Signal<string>;
  soulMd: Signal<string>;
  userMd: Signal<string>;

  skills: Signal<Skill[]>;
  skillsLoading: Signal<boolean>;
  skillsError: Signal<string>;
  curatedSkills: Signal<CuratedSkill[]>;

  mcpServers: Signal<Record<string, McpConfig>>;
  mcpsLoading: Signal<boolean>;
  mcpsError: Signal<string>;
  curatedMcps: Signal<CuratedMcp[]>;

  secrets: Signal<SecretRow[]>;
  nextSecretId: Signal<number>;

  nixPackages: Signal<string[]>;

  permissionGrants: Signal<PermissionGrant[]>;
  permissionsLoading: Signal<boolean>;

  schedules: Signal<Schedule[]>;
  schedulesLoading: Signal<boolean>;
  schedulesError: Signal<string>;

  prefillSkills: Signal<PrefillSkill[]>;
  prefillMcpServers: Signal<PrefillMcp[]>;
  prefillGrants: Signal<string[]>;
  prefillNixPackages: Signal<string[]>;
  prefillEnvVars: Signal<string[]>;
  prefillBannerDismissed: Signal<boolean>;
  approvingPrefills: Signal<boolean>;

  openSections: Signal<Record<string, boolean>>;

  initialSettingsSnapshot: Signal<SettingsSnapshot | null>;

  // Server-injected display data
  platform: string;
  userId: string;
  channelId?: string;
  teamId?: string;
  message?: string;
  showSwitcher: boolean;
  agents: SettingsState["agents"];
  providerIconUrls: Record<string, string>;

  // Actions
  toggleSection(id: string): void;
  openExternal(url: string): void;
  hasPendingSettingsChanges(): boolean;
  buildSettingsSnapshot(): SettingsSnapshot;
  addSecret(key: string, value: string): void;
  removeSecret(id: number): void;
  normalizeSecretKey(key: string): string;
  buildCurrentEnvVars(): Record<string, string>;
}

const SettingsContext = createContext<SettingsContextValue>(null!);

export function useSettings(): SettingsContextValue {
  return useContext(SettingsContext);
}

// ─── App ───────────────────────────────────────────────────────────────────

function App() {
  const state = window.__SETTINGS_STATE__;

  // Init signals from server state
  const agentName = useSignal(state.agentName || "");
  const agentDescription = useSignal(state.agentDescription || "");
  const initialAgentName = useSignal(state.agentName || "");
  const initialAgentDescription = useSignal(state.agentDescription || "");
  const savingIdentity = useSignal(false);

  const successMsg = useSignal("");
  const errorMsg = useSignal("");
  const saving = useSignal(false);

  const verboseLogging = useSignal(!!state.verboseLogging);
  const identityMd = useSignal(state.identityMd || "");
  const soulMd = useSignal(state.soulMd || "");
  const userMd = useSignal(state.userMd || "");

  // Providers
  const providerOrder = useSignal<string[]>(
    Array.isArray(state.providerOrder) ? state.providerOrder.slice() : []
  );
  const primaryProvider = useSignal(
    providerOrder.value.length ? providerOrder.value[0] : ""
  );
  const catalogProviders = useSignal<CatalogProvider[]>(
    state.catalogProviders || []
  );
  const showCatalog = useSignal(false);
  const pendingProvider = useSignal<
    (CatalogProvider & { success?: boolean }) | null
  >(null);
  const deviceCodePollTimer = useSignal<ReturnType<typeof setInterval> | null>(
    null
  );

  // Init provider state
  const initProviderState: Record<string, ProviderState> = {};
  for (const pid of providerOrder.value) {
    const pInfo = state.PROVIDERS[pid] || ({} as ProviderInfo);
    const authTypes = pInfo.supportedAuthTypes || [pInfo.authType || "oauth"];
    initProviderState[pid] = {
      status: "Checking...",
      connected: false,
      userConnected: false,
      systemConnected: false,
      showAuthFlow: false,
      showCodeInput: false,
      showDeviceCode: false,
      showApiKeyInput: false,
      activeAuthTab: authTypes[0] || "oauth",
      code: "",
      apiKey: "",
      userCode: "",
      verificationUrl: "",
      pollStatus: "Waiting for authorization...",
      deviceAuthId: "",
      selectedModel: "",
      modelQuery: "",
      showModelDropdown: false,
    };
  }
  const providerState =
    useSignal<Record<string, ProviderState>>(initProviderState);

  // Skills
  const skills = useSignal<Skill[]>(state.initialSkills || []);
  const skillsLoading = useSignal(false);
  const skillsError = useSignal("");
  const curatedSkills = useSignal<CuratedSkill[]>([]);

  // MCPs
  const mcpServers = useSignal<Record<string, McpConfig>>(
    state.initialMcpServers || {}
  );
  const mcpsLoading = useSignal(false);
  const mcpsError = useSignal("");
  const curatedMcps = useSignal<CuratedMcp[]>([]);

  // Secrets
  const initSecrets: SecretRow[] = Array.isArray(state.initialSecrets)
    ? state.initialSecrets.map((s, idx) => ({
        id: idx + 1,
        key: s?.key || "",
        value: s?.value || "",
        reveal: false,
      }))
    : [];
  const secrets = useSignal<SecretRow[]>(initSecrets);
  const nextSecretId = useSignal(initSecrets.length + 1);

  // Nix
  const nixPackages = useSignal<string[]>(
    Array.isArray(state.initialNixPackages)
      ? state.initialNixPackages.slice()
      : []
  );

  // Permissions
  const permissionGrants = useSignal<PermissionGrant[]>([]);
  const permissionsLoading = useSignal(true);

  // Schedules
  const schedules = useSignal<Schedule[]>([]);
  const schedulesLoading = useSignal(false);
  const schedulesError = useSignal("");

  // Prefills
  const prefillSkills = useSignal<PrefillSkill[]>(state.prefillSkills || []);
  const prefillMcpServers = useSignal<PrefillMcp[]>(
    state.prefillMcpServers || []
  );
  const prefillGrants = useSignal<string[]>(state.prefillGrants || []);
  const prefillNixPackages = useSignal<string[]>(
    state.prefillNixPackages || []
  );
  const prefillEnvVars = useSignal<string[]>(state.prefillEnvVars || []);
  const prefillBannerDismissed = useSignal(
    new URL(window.location.href).searchParams.has("dismissed")
  );
  const approvingPrefills = useSignal(false);

  // Sections
  const openSections = useSignal<Record<string, boolean>>({});
  const initialSettingsSnapshot = useSignal<SettingsSnapshot | null>(null);

  // ─── Helpers ─────────────────────────────────────────────────────────

  function normalizeSecretKey(key: string): string {
    return (key || "").trim();
  }

  function buildCurrentEnvVars(): Record<string, string> {
    const envVars: Record<string, string> = {};
    for (const secret of secrets.value) {
      const key = normalizeSecretKey(secret?.key);
      if (!key) continue;
      if (envVars[key] === undefined) {
        envVars[key] = secret?.value || "";
      }
    }
    return envVars;
  }

  function envVarsSignature(envVars: Record<string, string>): string {
    return Object.keys(envVars)
      .sort()
      .map((key) => `${key}=${envVars[key] || ""}`)
      .join("\n");
  }

  function nixPackagesSignature(): string {
    return nixPackages.value
      .map((pkg) => (pkg || "").trim())
      .filter(Boolean)
      .join("\n");
  }

  function skillsSignature(): string {
    return JSON.stringify(
      skills.value.map((s) => ({ repo: s.repo, enabled: s.enabled }))
    );
  }

  function mcpServersSignature(): string {
    return JSON.stringify(
      Object.entries(mcpServers.value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([id, cfg]) => ({
          id,
          enabled: cfg.enabled !== false,
          url: cfg.url || "",
        }))
    );
  }

  function permissionsSignature(): string {
    return JSON.stringify(
      permissionGrants.value
        .slice()
        .sort((a, b) => a.pattern.localeCompare(b.pattern))
        .map((g) => ({
          pattern: g.pattern,
          expiresAt: g.expiresAt,
          denied: !!g.denied,
        }))
    );
  }

  function buildSettingsSnapshot(): SettingsSnapshot {
    const envVars = buildCurrentEnvVars();
    return {
      identityMd: identityMd.value || "",
      soulMd: soulMd.value || "",
      userMd: userMd.value || "",
      verboseLogging: !!verboseLogging.value,
      primaryProvider: primaryProvider.value || "",
      providerOrder: providerOrder.value.join(","),
      nixPackages: nixPackagesSignature(),
      envVars: envVarsSignature(envVars),
      skills: skillsSignature(),
      mcpServers: mcpServersSignature(),
      permissions: permissionsSignature(),
    };
  }

  function hasPendingSettingsChanges(): boolean {
    if (!initialSettingsSnapshot.value) return false;
    const current = buildSettingsSnapshot();
    return (
      JSON.stringify(current) !== JSON.stringify(initialSettingsSnapshot.value)
    );
  }

  function toggleSection(id: string) {
    openSections.value = {
      ...openSections.value,
      [id]: !openSections.value[id],
    };
    updateSectionsUrl();
  }

  function updateSectionsUrl() {
    const ids = Object.keys(openSections.value).filter(
      (k) => openSections.value[k]
    );
    const url = new URL(window.location.href);
    if (ids.length > 0) {
      url.searchParams.set("open", ids.join(","));
    } else {
      url.searchParams.delete("open");
    }
    window.history.replaceState({}, "", url.toString());
  }

  function openExternal(url: string) {
    if (window.Telegram?.WebApp?.openLink) {
      window.Telegram.WebApp.openLink(url);
    } else {
      window.open(url, "_blank");
    }
  }

  function addSecret(key: string, value: string) {
    secrets.value = [
      ...secrets.value,
      {
        id: nextSecretId.value,
        key: normalizeSecretKey(key),
        value: value || "",
        reveal: false,
      },
    ];
    nextSecretId.value++;
  }

  function removeSecret(id: number) {
    secrets.value = secrets.value.filter((s) => s.id !== id);
  }

  // ─── Init ────────────────────────────────────────────────────────────

  const initialized = useRef(false);
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    // Restore open sections from URL
    const urlParams = new URLSearchParams(window.location.search);
    const openParam = urlParams.get("open");
    if (openParam) {
      const sections: Record<string, boolean> = {};
      for (const id of openParam.split(",")) {
        sections[id] = true;
      }
      openSections.value = sections;
    }

    // Auto-open model section when no providers
    if (state.hasNoProviders && !openParam) {
      openSections.value = { ...openSections.value, model: true };
    }

    // Check providers
    api
      .checkProviders(state.agentId)
      .then((providers) => {
        const updated = { ...providerState.value };
        for (const [provider, info] of Object.entries(providers)) {
          if (!updated[provider]) continue;
          updated[provider] = {
            ...updated[provider],
            connected: !!info.connected,
            userConnected: !!info.userConnected,
            systemConnected: !!info.systemConnected,
            activeAuthType: info.activeAuthType || null,
            authMethods: info.authMethods || [],
            status: !info.connected
              ? "Not connected"
              : info.userConnected
                ? `Connected (${info.activeAuthType || "unknown"})`
                : "Using system key",
          };
        }
        providerState.value = updated;
      })
      .catch(() => {
        // noop
      });

    // Load curated integrations
    api
      .fetchIntegrationsRegistry()
      .then((data) => {
        curatedSkills.value = (data.skills || []).map((s) => ({
          id: s.id,
          repo: s.repo || s.id,
          name: s.name,
          description: s.description,
          installs: s.installs,
        }));
        curatedMcps.value = (data.mcps || []).map((m) => ({
          id: m.id,
          name: m.name,
          description: m.description,
        }));
      })
      .catch(() => {
        // noop
      });

    // Load permissions
    api
      .fetchGrants(state.agentId)
      .then((grants) => {
        permissionGrants.value = grants.map((g) => ({
          pattern: g.pattern,
          expiresAt: g.expiresAt,
          denied: !!g.denied,
          grantedAt: g.grantedAt,
        }));
      })
      .catch(() => {
        // noop
      })
      .finally(() => {
        permissionsLoading.value = false;
        // Snapshot after permissions load so it captures the initial state
        initialSettingsSnapshot.value = buildSettingsSnapshot();
      });

    // Load schedules
    schedulesLoading.value = true;
    api
      .fetchSchedules(state.agentId)
      .then((data) => {
        schedules.value = data as Schedule[];
      })
      .catch(() => {
        schedulesError.value = "Failed to load scheduled reminders.";
      })
      .finally(() => {
        schedulesLoading.value = false;
      });

    // Telegram WebApp
    if (window.Telegram?.WebApp?.initData) {
      window.Telegram.WebApp.ready();
      window.Telegram.WebApp.expand();
    }
  }, []);

  // ─── Context Value ───────────────────────────────────────────────────

  const ctx: SettingsContextValue = {
    agentId: state.agentId,
    PROVIDERS: state.PROVIDERS,
    providerModels: state.providerModels || {},
    catalogProviders,
    providerOrder,
    primaryProvider,
    providerState,
    showCatalog,
    pendingProvider,
    deviceCodePollTimer,

    agentName,
    agentDescription,
    initialAgentName,
    initialAgentDescription,
    savingIdentity,
    hasChannelId: state.hasChannelId,

    successMsg,
    errorMsg,
    saving,

    verboseLogging,
    identityMd,
    soulMd,
    userMd,

    skills,
    skillsLoading,
    skillsError,
    curatedSkills,

    mcpServers,
    mcpsLoading,
    mcpsError,
    curatedMcps,

    secrets,
    nextSecretId,

    nixPackages,

    permissionGrants,
    permissionsLoading,

    schedules,
    schedulesLoading,
    schedulesError,

    prefillSkills,
    prefillMcpServers,
    prefillGrants,
    prefillNixPackages,
    prefillEnvVars,
    prefillBannerDismissed,
    approvingPrefills,

    openSections,
    initialSettingsSnapshot,

    platform: state.platform,
    userId: state.userId,
    channelId: state.channelId,
    teamId: state.teamId,
    message: state.message,
    showSwitcher: state.showSwitcher,
    agents: state.agents,
    providerIconUrls: state.providerIconUrls || {},

    toggleSection,
    openExternal,
    hasPendingSettingsChanges,
    buildSettingsSnapshot,
    addSecret,
    removeSecret,
    normalizeSecretKey,
    buildCurrentEnvVars,
  };

  return (
    <SettingsContext.Provider value={ctx}>
      <Header />
      <MessageBanners />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          handleSave(ctx);
        }}
        onKeyDown={(e) => {
          const target = e.target as HTMLElement;
          if (
            e.key === "Enter" &&
            target.tagName !== "TEXTAREA" &&
            (target as HTMLInputElement).type !== "submit"
          ) {
            e.preventDefault();
          }
        }}
        class="space-y-3"
      >
        <ProviderSection />
        <InstructionsSection />
        <IntegrationsSection />
        <RemindersSection />
        <PermissionsSection />
        <NixPackagesSection />
        <SecretsSection />

        {/* Verbose toggle */}
        <div class="bg-gray-50 rounded-lg p-3">
          <label class="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={ctx.verboseLogging.value}
              onChange={(e) => {
                ctx.verboseLogging.value = (
                  e.target as HTMLInputElement
                ).checked;
              }}
              class="w-4 h-4 text-slate-600 rounded focus:ring-slate-500"
            />
            <span class="text-sm font-medium text-gray-800">
              Verbose logging
            </span>
          </label>
          <p class="text-xs text-gray-500 mt-1 ml-6">
            Show tool calls, reasoning tokens, and detailed output
          </p>
        </div>

        {/* Submit */}
        <button
          type="submit"
          disabled={ctx.saving.value || !hasPendingSettingsChanges()}
          class="w-full py-3 bg-gradient-to-r from-slate-700 to-slate-800 text-white text-sm font-semibold rounded-lg hover:shadow-lg hover:-translate-y-0.5 active:translate-y-0 transition-all disabled:opacity-60 disabled:cursor-not-allowed disabled:transform-none"
        >
          {ctx.saving.value
            ? "Saving..."
            : hasPendingSettingsChanges()
              ? "Save Settings"
              : "No Changes"}
        </button>
      </form>
    </SettingsContext.Provider>
  );
}

async function handleSave(ctx: SettingsContextValue) {
  ctx.saving.value = true;
  ctx.successMsg.value = "";
  ctx.errorMsg.value = "";

  try {
    // Reorder providers
    if (ctx.providerOrder.value.length > 0 && ctx.primaryProvider.value) {
      const orderedIds = [
        ctx.primaryProvider.value,
        ...ctx.providerOrder.value.filter(
          (pid) => pid !== ctx.primaryProvider.value
        ),
      ];
      try {
        await api.reorderProviders(ctx.agentId, orderedIds);
      } catch {
        // Non-fatal
      }
    }

    // Core settings
    const settings: Record<string, unknown> = {
      model: "",
      identityMd: ctx.identityMd.value || "",
      soulMd: ctx.soulMd.value || "",
      userMd: ctx.userMd.value || "",
      verboseLogging: !!ctx.verboseLogging.value,
    };

    const nixPkgs = ctx.nixPackages.value
      .map((pkg) => (pkg || "").trim())
      .filter(Boolean);
    settings.nixConfig = nixPkgs.length ? { packages: nixPkgs } : null;
    settings.envVars = ctx.buildCurrentEnvVars();

    await api.saveSettings(ctx.agentId, settings);

    const snap = ctx.initialSettingsSnapshot.value;
    const currentSnap = ctx.buildSettingsSnapshot();

    // Save skills (only if changed)
    if (!snap || snap.skills !== currentSnap.skills) {
      await api.saveSkills(ctx.agentId, ctx.skills.value);
    }

    // Save MCPs (only if changed)
    if (!snap || snap.mcpServers !== currentSnap.mcpServers) {
      await api.saveMcpServers(ctx.agentId, ctx.mcpServers.value);
    }

    // Save permissions (only if changed)
    if (snap && snap.permissions !== currentSnap.permissions) {
      // Fetch server state to diff against
      const serverGrants = await api.fetchGrants(ctx.agentId);
      const currentPerms = ctx.permissionGrants.value;

      const serverByPattern = new Map(serverGrants.map((g) => [g.pattern, g]));
      const currentByPattern = new Map(currentPerms.map((g) => [g.pattern, g]));

      // Remove grants that were deleted locally
      for (const [pattern] of serverByPattern) {
        if (!currentByPattern.has(pattern)) {
          await api.removeGrant(ctx.agentId, pattern);
        }
      }

      // Add or update grants
      for (const [pattern, g] of currentByPattern) {
        const server = serverByPattern.get(pattern);
        if (
          !server ||
          server.expiresAt !== g.expiresAt ||
          !!server.denied !== !!g.denied
        ) {
          // Remove first if it exists with different properties
          if (server) await api.removeGrant(ctx.agentId, pattern);
          await api.addGrant(ctx.agentId, pattern, g.expiresAt, g.denied);
        }
      }
    }

    ctx.successMsg.value = "Settings saved!";
    ctx.initialSettingsSnapshot.value = ctx.buildSettingsSnapshot();
    window.scrollTo({ top: 0, behavior: "smooth" });
  } catch (e: unknown) {
    ctx.errorMsg.value = e instanceof Error ? e.message : "Failed to save";
    window.scrollTo({ top: 0, behavior: "smooth" });
  } finally {
    ctx.saving.value = false;
  }
}

render(<App />, document.getElementById("app")!);
