import * as api from "../api";
import { type SettingsContextValue, useSettings } from "../app";
import type { CatalogProvider, ProviderState } from "../types";
import { Section } from "./Section";

// ─── Shared auth helpers ──────────────────────────────────────────────────

type UpdatePS = (u: Partial<ProviderState>) => void;

function handleAuthSuccess(
  ctx: SettingsContextValue,
  providerId: string,
  providerName: string
) {
  if (ctx.pendingProvider.value?.id === providerId) {
    ctx.pendingProvider.value = { ...ctx.pendingProvider.value, success: true };
    setTimeout(async () => {
      ctx.pendingProvider.value = null;
      try {
        await api.installProvider(ctx.agentId, providerId);
        ctx.successMsg.value = "Provider added and connected!";
        window.scrollTo({ top: 0, behavior: "smooth" });
        setTimeout(() => window.location.reload(), 800);
      } catch (e: unknown) {
        ctx.errorMsg.value =
          e instanceof Error ? e.message : "Failed to install provider";
      }
    }, 800);
    return;
  }
  ctx.providerState.value = {
    ...ctx.providerState.value,
    [providerId]: {
      ...ctx.providerState.value[providerId],
      connected: true,
      userConnected: true,
      systemConnected: false,
      status: "Connected",
    },
  };
  ctx.successMsg.value = `Connected to ${providerName}!`;
}

async function handleSubmitOAuth(
  ctx: SettingsContextValue,
  providerId: string,
  ps: ProviderState,
  updatePS: UpdatePS,
  providerName: string
) {
  const code = (ps.code || "").trim();
  if (!code) {
    ctx.errorMsg.value = "Please enter the authentication code";
    return;
  }
  try {
    await api.submitOAuthCode(providerId, code);
    updatePS({ showCodeInput: false, showAuthFlow: false, code: "" });
    handleAuthSuccess(ctx, providerId, providerName);
  } catch (e: unknown) {
    ctx.errorMsg.value = e instanceof Error ? e.message : "Failed";
  }
}

async function handleSubmitKey(
  ctx: SettingsContextValue,
  providerId: string,
  ps: ProviderState,
  updatePS: UpdatePS,
  providerName: string
) {
  const key = (ps.apiKey || "").trim();
  if (!key) return;
  try {
    await api.submitApiKey(providerId, key, ctx.agentId, "");
    updatePS({ showApiKeyInput: false, showAuthFlow: false, apiKey: "" });
    handleAuthSuccess(ctx, providerId, providerName);
  } catch (e: unknown) {
    ctx.errorMsg.value = e instanceof Error ? e.message : "Failed";
  }
}

// ─── Components ───────────────────────────────────────────────────────────

export function ProviderSection() {
  const ctx = useSettings();

  return (
    <Section id="model" title="Models" icon="&#129302;">
      <div id="provider-list">
        {ctx.providerOrder.value.length === 0 && (
          <div class="text-center py-6 text-gray-500">
            <p class="text-sm font-medium text-gray-700 mb-1">
              No model providers configured
            </p>
            <p class="text-xs">Add a provider below to get started.</p>
          </div>
        )}
        {ctx.providerOrder.value.map((pid, i) => (
          <ProviderCard key={pid} providerId={pid} index={i} />
        ))}
      </div>
      <ProviderCatalog />
      <PendingProviderAuth />
    </Section>
  );
}

function ProviderCard({
  providerId,
  index,
}: {
  providerId: string;
  index: number;
}) {
  const ctx = useSettings();
  const pInfo = ctx.PROVIDERS[providerId];
  const ps = ctx.providerState.value[providerId];
  if (!pInfo || !ps) return null;

  const iconUrl = ctx.providerIconUrls[providerId] || "";
  const models = ctx.providerModels[providerId] || [];

  function updatePS(update: Partial<ProviderState>) {
    ctx.providerState.value = {
      ...ctx.providerState.value,
      [providerId]: { ...ctx.providerState.value[providerId], ...update },
    };
  }

  function connectProvider() {
    const authTypes = pInfo.supportedAuthTypes || [pInfo.authType || "oauth"];
    const hasMultiAuth = authTypes.length > 1;
    const activeTab = hasMultiAuth
      ? ps.activeAuthTab || authTypes[0]
      : pInfo.authType;

    updatePS({ showAuthFlow: true });

    if (activeTab === "api-key") {
      updatePS({
        activeAuthTab: "api-key",
        showApiKeyInput: true,
        status: "Enter your API key...",
      });
    } else if (activeTab === "device-code") {
      updatePS({ activeAuthTab: "device-code" });
      startDeviceCode(providerId);
    } else {
      updatePS({
        activeAuthTab: "oauth",
        showCodeInput: true,
        status: "Click Login to start authentication.",
      });
    }
  }

  async function startDeviceCode(pid: string) {
    updatePS({ status: "Starting..." });
    try {
      const data = await api.startDeviceCode(pid, ctx.agentId, "");
      updatePS({
        userCode: data.userCode,
        verificationUrl:
          data.verificationUrl || "https://auth.openai.com/codex/device",
        deviceAuthId: data.deviceAuthId,
        showDeviceCode: true,
        status: "Waiting for authorization...",
        pollStatus: "Waiting for authorization...",
      });
      const interval = Math.max((data.interval || 5) * 1000, 3000);
      const timer = setInterval(() => pollDeviceCodeToken(pid), interval);
      ctx.deviceCodePollTimer.value = timer;
    } catch (e: unknown) {
      updatePS({
        status: `Error: ${e instanceof Error ? e.message : "Unknown"}`,
      });
    }
  }

  async function pollDeviceCodeToken(pid: string) {
    const pState = ctx.providerState.value[pid];
    if (!pState) return;
    try {
      const data = await api.pollDeviceCode(pid, {
        deviceAuthId: pState.deviceAuthId,
        userCode: pState.userCode,
        agentId: ctx.agentId,
        token: "",
      });
      if (data.status === "success") {
        if (ctx.deviceCodePollTimer.value) {
          clearInterval(ctx.deviceCodePollTimer.value);
          ctx.deviceCodePollTimer.value = null;
        }
        updatePS({ showDeviceCode: false, showAuthFlow: false });
        handleAuthSuccess(ctx, pid, pInfo.name || pid);
      } else if (data.error) {
        if (ctx.deviceCodePollTimer.value) {
          clearInterval(ctx.deviceCodePollTimer.value);
          ctx.deviceCodePollTimer.value = null;
        }
        ctx.providerState.value = {
          ...ctx.providerState.value,
          [pid]: {
            ...ctx.providerState.value[pid],
            pollStatus: `Error: ${data.error}`,
          },
        };
      }
    } catch {
      // ignore poll errors
    }
  }

  async function handleDisconnect(profileId?: string) {
    if (!confirm(`Disconnect from ${pInfo.name || providerId}?`)) return;
    await api.disconnectProvider(providerId, ctx.agentId, "", profileId);
    updatePS({
      showAuthFlow: false,
      showCodeInput: false,
      showDeviceCode: false,
      showApiKeyInput: false,
    });
    // Re-check providers
    const providers = await api.checkProviders(ctx.agentId);
    const info = providers[providerId];
    if (info) {
      ctx.providerState.value = {
        ...ctx.providerState.value,
        [providerId]: {
          ...ctx.providerState.value[providerId],
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
        },
      };
    }
  }

  async function handleUninstall() {
    if (
      !confirm(
        `Remove ${pInfo.name || providerId}? This will also remove saved credentials.`
      )
    )
      return;
    try {
      await api.uninstallProvider(ctx.agentId, providerId);
      ctx.successMsg.value = "Provider removed! Refreshing...";
      window.scrollTo({ top: 0, behavior: "smooth" });
      setTimeout(() => window.location.reload(), 800);
    } catch (e: unknown) {
      ctx.errorMsg.value =
        e instanceof Error ? e.message : "Failed to remove provider";
    }
  }

  const authTypes = pInfo.supportedAuthTypes || [pInfo.authType];
  const hasMultiAuth = authTypes.length > 1;

  // Filtered models for dropdown
  const filteredModels = models.filter(
    (o) =>
      !ps.modelQuery ||
      o.label.toLowerCase().includes(ps.modelQuery.toLowerCase()) ||
      o.value.toLowerCase().includes(ps.modelQuery.toLowerCase())
  );

  return (
    <div class={index > 0 ? "mt-3 pt-3 border-t border-gray-200" : ""}>
      <div class="flex items-center justify-between gap-2">
        <div class="flex items-center gap-3 min-w-0">
          <label
            class="inline-flex items-center cursor-pointer"
            title="Set as primary provider"
          >
            <input
              type="radio"
              name="primaryProvider"
              value={providerId}
              checked={ctx.primaryProvider.value === providerId}
              onChange={() => {
                ctx.primaryProvider.value = providerId;
              }}
              class="w-4 h-4 accent-slate-600 cursor-pointer"
            />
          </label>
          {iconUrl && (
            <img src={iconUrl} alt={pInfo.name} class="w-5 h-5 rounded" />
          )}
          <div class="min-w-0">
            <p class="text-sm font-medium text-gray-800">{pInfo.name}</p>
            <p
              class={`text-xs truncate max-w-[120px] sm:max-w-none ${
                ps.connected
                  ? ps.userConnected
                    ? "text-emerald-600"
                    : "text-amber-600"
                  : "text-gray-500"
              }`}
            >
              {ps.status || "Checking..."}
            </p>
          </div>
        </div>
        <div class="flex items-center gap-2 flex-shrink-0">
          {ps.connected && (
            <div class="sm:flex-none relative">
              <input
                type="text"
                value={ps.modelQuery}
                onInput={(e) => {
                  const val = (e.target as HTMLInputElement).value;
                  updatePS({
                    modelQuery: val,
                    showModelDropdown: true,
                    selectedModel: val,
                  });
                }}
                onFocus={() => updatePS({ showModelDropdown: true })}
                onKeyDown={(e) => {
                  if (e.key === "Escape")
                    updatePS({ showModelDropdown: false });
                  if (e.key === "Enter") {
                    e.preventDefault();
                    updatePS({ showModelDropdown: false });
                  }
                }}
                placeholder={ps.selectedModel || "Auto model"}
                class="w-36 sm:w-44 px-3 py-1.5 border border-gray-200 rounded-lg text-xs focus:border-slate-600 focus:ring-1 focus:ring-slate-200 outline-none bg-white placeholder-gray-500"
              />
              {ps.showModelDropdown && (
                <div class="absolute z-20 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                  <button
                    type="button"
                    onClick={() =>
                      updatePS({
                        selectedModel: "",
                        modelQuery: "",
                        showModelDropdown: false,
                      })
                    }
                    class="w-full text-left px-3 py-1.5 text-xs hover:bg-gray-100 text-gray-500"
                  >
                    Auto model
                  </button>
                  {filteredModels.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() =>
                        updatePS({
                          selectedModel: opt.value,
                          modelQuery: opt.label,
                          showModelDropdown: false,
                        })
                      }
                      class="w-full text-left px-3 py-1.5 text-xs hover:bg-gray-100 text-gray-800"
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          {!ps.authMethods?.length && (
            <button
              type="button"
              onClick={() =>
                ps.userConnected ? handleDisconnect() : connectProvider()
              }
              class={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all ${
                ps.userConnected
                  ? "bg-red-100 text-red-700 hover:bg-red-200"
                  : "bg-slate-100 text-slate-800 hover:bg-slate-200"
              }`}
            >
              {ps.userConnected ? "Disconnect" : "Connect"}
            </button>
          )}
          <button
            type="button"
            onClick={handleUninstall}
            title={`Remove ${pInfo.name}`}
            class="p-1.5 text-xs rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition-all"
          >
            <svg
              class="w-3.5 h-3.5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
              />
            </svg>
          </button>
        </div>
      </div>

      {/* Auth flow */}
      {ps.showAuthFlow && (
        <div class="mt-3 pt-3 border-t border-gray-200">
          {hasMultiAuth && (
            <div class="flex gap-1 mb-3 border-b border-gray-200">
              {authTypes.map((at) => (
                <button
                  key={at}
                  type="button"
                  onClick={() => updatePS({ activeAuthTab: at })}
                  class={`px-3 py-1.5 text-xs font-medium rounded-t-lg transition-all border-b-2 -mb-px ${
                    ps.activeAuthTab === at
                      ? "border-slate-600 text-slate-800 bg-white"
                      : "border-transparent text-gray-500 hover:text-gray-700"
                  }`}
                >
                  {at === "api-key"
                    ? "API Key"
                    : at === "device-code"
                      ? "Device Auth"
                      : "OAuth"}
                </button>
              ))}
            </div>
          )}
          <AuthFlowContent
            providerId={providerId}
            ps={ps}
            pInfo={pInfo}
            updatePS={updatePS}
            onSubmitOAuth={() =>
              handleSubmitOAuth(
                ctx,
                providerId,
                ps,
                updatePS,
                pInfo.name || providerId
              )
            }
            onSubmitApiKey={() =>
              handleSubmitKey(
                ctx,
                providerId,
                ps,
                updatePS,
                pInfo.name || providerId
              )
            }
            openExternal={ctx.openExternal}
          />
        </div>
      )}
    </div>
  );
}

function AuthFlowContent({
  providerId,
  ps,
  pInfo,
  updatePS,
  onSubmitOAuth,
  onSubmitApiKey,
  openExternal,
}: {
  providerId: string;
  ps: ProviderState;
  pInfo: {
    name: string;
    authType: string;
    supportedAuthTypes: string[];
    apiKeyInstructions: string;
    apiKeyPlaceholder: string;
  };
  updatePS: (u: Partial<ProviderState>) => void;
  onSubmitOAuth: () => void;
  onSubmitApiKey: () => void;
  openExternal: (url: string) => void;
}) {
  const authTypes = pInfo.supportedAuthTypes || [pInfo.authType];
  const hasMultiAuth = authTypes.length > 1;

  const showOAuth = hasMultiAuth
    ? ps.activeAuthTab === "oauth" && ps.showCodeInput
    : ps.showCodeInput;
  const showDeviceCode = hasMultiAuth
    ? ps.activeAuthTab === "device-code" && ps.showDeviceCode
    : ps.showDeviceCode;
  const showApiKey = hasMultiAuth
    ? ps.activeAuthTab === "api-key"
    : ps.showApiKeyInput;

  return (
    <>
      {showOAuth && (
        <div>
          <div class="mb-3 text-center">
            <a
              href={`/api/v1/auth/${providerId}/login`}
              onClick={(e) => {
                e.preventDefault();
                openExternal(`/api/v1/auth/${providerId}/login`);
              }}
              class="inline-block px-4 py-2 text-xs font-medium rounded-lg bg-slate-600 text-white hover:bg-slate-700 transition-all cursor-pointer"
            >
              Login with {pInfo.name}
            </a>
          </div>
          <p class="text-xs text-gray-600 mb-2">
            Paste the authentication code from {pInfo.name}:
          </p>
          <div class="flex gap-2">
            <input
              type="text"
              value={ps.code}
              onInput={(e) =>
                updatePS({ code: (e.target as HTMLInputElement).value })
              }
              placeholder="CODE#STATE"
              class="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-xs font-mono focus:border-slate-600 focus:ring-1 focus:ring-slate-200 outline-none"
            />
            <button
              type="button"
              onClick={onSubmitOAuth}
              class="px-3 py-2 text-xs font-medium rounded-lg bg-slate-600 text-white hover:bg-slate-700 transition-all"
            >
              Submit
            </button>
          </div>
          <p class="text-xs text-gray-400 mt-1">
            Format: CODE#STATE (copy the entire code shown after login)
          </p>
        </div>
      )}
      {showDeviceCode && (
        <div class="text-center">
          <p class="text-xs text-gray-600 mb-2">
            Enter this code at the verification page:
          </p>
          <p class="text-2xl font-mono font-bold text-slate-800 mb-2">
            {ps.userCode || ""}
          </p>
          <a
            href={ps.verificationUrl || "https://auth.openai.com/codex/device"}
            onClick={(e) => {
              e.preventDefault();
              openExternal(
                ps.verificationUrl || "https://auth.openai.com/codex/device"
              );
            }}
            class="inline-block px-4 py-2 text-xs font-medium rounded-lg bg-slate-600 text-white hover:bg-slate-700 transition-all mb-2 cursor-pointer"
          >
            Login
          </a>
          <p class="text-xs text-gray-400">
            {ps.pollStatus || "Waiting for authorization..."}
          </p>
        </div>
      )}
      {showApiKey && (
        <div>
          <p class="text-xs text-gray-600 mb-2">{pInfo.apiKeyInstructions}</p>
          <div class="flex gap-2">
            <input
              type="password"
              value={ps.apiKey}
              onInput={(e) =>
                updatePS({ apiKey: (e.target as HTMLInputElement).value })
              }
              placeholder={pInfo.apiKeyPlaceholder}
              class="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-xs font-mono focus:border-slate-600 focus:ring-1 focus:ring-slate-200 outline-none"
            />
            <button
              type="button"
              onClick={onSubmitApiKey}
              class="px-3 py-2 text-xs font-medium rounded-lg bg-slate-600 text-white hover:bg-slate-700 transition-all"
            >
              Save
            </button>
          </div>
        </div>
      )}
    </>
  );
}

function ProviderCatalog() {
  const ctx = useSettings();
  if (ctx.catalogProviders.value.length === 0) return null;

  function handleAddProvider(cp: CatalogProvider) {
    ctx.showCatalog.value = false;
    ctx.pendingProvider.value = cp;

    const authTypes = cp.supportedAuthTypes || [cp.authType];
    const primaryAuth = authTypes[0] || cp.authType;

    const newState: ProviderState = {
      status: "Connecting...",
      connected: false,
      userConnected: false,
      systemConnected: false,
      showAuthFlow: true,
      showCodeInput: false,
      showDeviceCode: false,
      showApiKeyInput: false,
      activeAuthTab: primaryAuth,
      code: "",
      apiKey: "",
      userCode: "",
      verificationUrl: "",
      pollStatus: "",
      deviceAuthId: "",
      selectedModel: "",
      modelQuery: "",
      showModelDropdown: false,
    };

    if (primaryAuth === "api-key") {
      newState.showApiKeyInput = true;
      newState.status = "Enter your API key...";
    } else if (primaryAuth === "device-code") {
      // Will be started when PendingProviderAuth renders
    } else {
      newState.showCodeInput = true;
      newState.status = "Click Login to start authentication.";
    }

    ctx.providerState.value = { ...ctx.providerState.value, [cp.id]: newState };
  }

  return (
    <div class="mt-3 pt-3 border-t border-gray-200">
      <div class="relative">
        <button
          type="button"
          onClick={() => {
            ctx.showCatalog.value = !ctx.showCatalog.value;
          }}
          class="w-full px-3 py-2 text-xs font-medium rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200 transition-all flex items-center justify-center gap-2"
        >
          <svg
            class="w-3.5 h-3.5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M12 6v6m0 0v6m0-6h6m-6 0H6"
            />
          </svg>
          Add Provider
        </button>
        {ctx.showCatalog.value && (
          <div class="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
            {ctx.catalogProviders.value.map((cp) => (
              <button
                key={cp.id}
                type="button"
                class="w-full text-left p-2 hover:bg-gray-50 cursor-pointer border-b border-gray-100 last:border-b-0"
                onClick={() => handleAddProvider(cp)}
              >
                <div class="flex items-center gap-2">
                  <img src={cp.iconUrl} alt={cp.name} class="w-4 h-4 rounded" />
                  <div class="flex-1 min-w-0">
                    <p class="text-xs font-medium text-gray-800">{cp.name}</p>
                  </div>
                  <div class="flex flex-wrap gap-1 justify-end">
                    {(cp.supportedAuthTypes || [cp.authType]).map((at) => (
                      <span
                        key={at}
                        class="text-[9px] uppercase font-bold px-1.5 py-0.5 rounded bg-gray-100 text-gray-400 border border-gray-100"
                      >
                        {at}
                      </span>
                    ))}
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function PendingProviderAuth() {
  const ctx = useSettings();
  const pp = ctx.pendingProvider.value;
  if (!pp) return null;

  const ps = ctx.providerState.value[pp.id];
  if (!ps) return null;

  function cancelPending() {
    if (ctx.deviceCodePollTimer.value) {
      clearInterval(ctx.deviceCodePollTimer.value);
      ctx.deviceCodePollTimer.value = null;
    }
    const updated = { ...ctx.providerState.value };
    delete updated[pp?.id];
    ctx.providerState.value = updated;
    ctx.pendingProvider.value = null;
  }

  const pendingUpdatePS: UpdatePS = (u) => {
    ctx.providerState.value = {
      ...ctx.providerState.value,
      [pp.id]: { ...ctx.providerState.value[pp.id], ...u },
    };
  };

  const authTypes = pp.supportedAuthTypes || [pp.authType];
  const hasMultiAuth = authTypes.length > 1;

  return (
    <div class="mt-3 pt-3 border-t border-gray-200">
      <div class="bg-white border border-slate-200 rounded-lg p-3">
        <div class="flex items-center justify-between mb-3">
          <div class="flex items-center gap-2">
            {pp.iconUrl && (
              <img src={pp.iconUrl} alt={pp.name} class="w-5 h-5 rounded" />
            )}
            <p class="text-sm font-medium text-gray-800">Connect {pp.name}</p>
          </div>
          <button
            type="button"
            onClick={cancelPending}
            class="px-2 py-1 text-xs font-medium rounded-lg text-gray-500 hover:text-red-600 hover:bg-red-50 transition-all"
          >
            Cancel
          </button>
        </div>

        {pp.success ? (
          <div class="text-center py-4">
            <svg
              class="w-8 h-8 mx-auto text-emerald-500 mb-2"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M5 13l4 4L19 7"
              />
            </svg>
            <p class="text-sm font-medium text-emerald-700">Connected!</p>
          </div>
        ) : (
          <>
            {hasMultiAuth && (
              <div class="flex gap-1 mb-3 border-b border-gray-200">
                {authTypes.map((at) => (
                  <button
                    key={at}
                    type="button"
                    onClick={() => {
                      ctx.providerState.value = {
                        ...ctx.providerState.value,
                        [pp.id]: {
                          ...ctx.providerState.value[pp.id],
                          activeAuthTab: at,
                        },
                      };
                    }}
                    class={`px-3 py-1.5 text-xs font-medium rounded-t-lg transition-all border-b-2 -mb-px ${
                      ps.activeAuthTab === at
                        ? "border-slate-600 text-slate-800 bg-white"
                        : "border-transparent text-gray-500 hover:text-gray-700"
                    }`}
                  >
                    {at}
                  </button>
                ))}
              </div>
            )}
            <AuthFlowContent
              providerId={pp.id}
              ps={ps}
              pInfo={pp}
              updatePS={pendingUpdatePS}
              onSubmitOAuth={() =>
                handleSubmitOAuth(ctx, pp.id, ps, pendingUpdatePS, pp.name)
              }
              onSubmitApiKey={() =>
                handleSubmitKey(ctx, pp.id, ps, pendingUpdatePS, pp.name)
              }
              openExternal={ctx.openExternal}
            />
          </>
        )}
      </div>
    </div>
  );
}
