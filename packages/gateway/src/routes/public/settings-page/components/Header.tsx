import { useSignal } from "@preact/signals";
import * as api from "../api";
import { useSettings } from "../app";

export function Header() {
  const ctx = useSettings();
  const switcherOpen = useSignal(false);
  const switching = useSignal(false);
  const creatingInSwitcher = useSignal(false);
  const switcherNewName = useSignal("");
  const editingIdentity = useSignal(false);
  const showDeleteConfirm = useSignal(false);
  const deleteConfirmText = useSignal("");
  const deleting = useSignal(false);

  async function handleSwitchAgent(agentId: string) {
    switching.value = true;
    try {
      await api.switchAgent(agentId, ctx.platform, ctx.channelId!, ctx.teamId);
      window.location.reload();
    } catch (e: unknown) {
      ctx.errorMsg.value =
        e instanceof Error ? e.message : "Failed to switch agent";
      switching.value = false;
    }
  }

  async function handleCreateAgent(name: string) {
    if (!name?.trim()) return;
    const trimmed = name.trim();
    let agentId = trimmed
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    if (agentId.length > 40) agentId = agentId.substring(0, 40);
    if (agentId.length < 3 || !/^[a-z]/.test(agentId)) {
      ctx.errorMsg.value =
        "Invalid agent name (must start with a letter, at least 3 characters)";
      return;
    }
    switching.value = true;
    try {
      await api.createAgent(agentId, trimmed, ctx.channelId);
      window.location.reload();
    } catch (e: unknown) {
      ctx.errorMsg.value =
        e instanceof Error ? e.message : "Failed to create agent";
      switching.value = false;
    }
  }

  async function handleSaveIdentity() {
    ctx.savingIdentity.value = true;
    ctx.successMsg.value = "";
    ctx.errorMsg.value = "";
    try {
      const body: Record<string, string> = {};
      if (ctx.agentName.value !== ctx.initialAgentName.value)
        body.name = ctx.agentName.value;
      if (ctx.agentDescription.value !== ctx.initialAgentDescription.value)
        body.description = ctx.agentDescription.value;
      await api.updateAgentIdentity(ctx.agentId, body);
      ctx.initialAgentName.value = ctx.agentName.value;
      ctx.initialAgentDescription.value = ctx.agentDescription.value;
      ctx.successMsg.value = "Agent identity updated!";
      editingIdentity.value = false;
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e: unknown) {
      ctx.errorMsg.value = e instanceof Error ? e.message : "Failed to update";
      window.scrollTo({ top: 0, behavior: "smooth" });
    } finally {
      ctx.savingIdentity.value = false;
    }
  }

  async function handleDeleteAgent() {
    deleting.value = true;
    try {
      await api.deleteAgent(ctx.agentId);
      if (ctx.hasChannelId) {
        window.location.reload();
      } else {
        document.body.innerHTML =
          '<div style="display:flex;align-items:center;justify-content:center;min-height:100vh"><div style="text-align:center;color:white"><p style="font-size:1.5rem;margin-bottom:0.5rem">Agent deleted</p><p style="font-size:0.875rem;opacity:0.7">This agent has been permanently removed.</p></div></div>';
      }
    } catch (e: unknown) {
      ctx.errorMsg.value =
        e instanceof Error ? e.message : "Failed to delete agent";
      window.scrollTo({ top: 0, behavior: "smooth" });
      deleting.value = false;
    }
  }

  const editBtn = (
    <button
      type="button"
      onClick={() => {
        switcherOpen.value = false;
        editingIdentity.value = true;
      }}
      class="p-1 text-slate-400 hover:text-slate-600 transition-colors"
      title="Edit"
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
          d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
        />
      </svg>
    </button>
  );

  const deleteBtn = (
    <button
      type="button"
      onClick={() => {
        switcherOpen.value = false;
        showDeleteConfirm.value = true;
      }}
      class="p-1 text-slate-400 hover:text-red-500 transition-colors"
      title="Delete"
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
  );

  return (
    <div class="mb-5">
      <div class="text-center mb-3">
        <div class="text-4xl mb-1">&#129438;</div>

        {!editingIdentity.value && (
          <>
            <div class="relative inline-block">
              {ctx.showSwitcher ? (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      switcherOpen.value = !switcherOpen.value;
                    }}
                    class="inline-flex items-center gap-1.5 text-xl font-bold text-slate-900 hover:text-slate-700 transition-colors"
                    title={ctx.agentId}
                  >
                    <span>{ctx.agentName.value || "Agent Settings"}</span>
                    <svg
                      class="w-4 h-4 text-slate-400"
                      viewBox="0 0 20 20"
                      fill="currentColor"
                      aria-hidden="true"
                    >
                      <path
                        fill-rule="evenodd"
                        d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
                        clip-rule="evenodd"
                      />
                    </svg>
                  </button>

                  {switcherOpen.value && (
                    <div
                      class="absolute left-1/2 -translate-x-1/2 mt-2 w-72 bg-white border border-slate-200 rounded-lg shadow-lg overflow-hidden z-20"
                      role="listbox"
                      onClick={(e) => e.stopPropagation()}
                      onKeyDown={(e) => e.stopPropagation()}
                    >
                      <div class="max-h-48 overflow-y-auto">
                        {ctx.agents.map((agent) => (
                          <button
                            key={agent.agentId}
                            type="button"
                            class={`w-full flex items-center justify-between px-3 py-2 text-left ${agent.agentId !== ctx.agentId ? "hover:bg-slate-50 cursor-pointer" : "bg-slate-50"} transition-colors border-b border-slate-100 last:border-b-0`}
                            onClick={
                              agent.agentId !== ctx.agentId
                                ? () => handleSwitchAgent(agent.agentId)
                                : undefined
                            }
                          >
                            <div class="min-w-0">
                              <p
                                class="text-sm font-medium text-gray-800"
                                title={agent.agentId}
                              >
                                {agent.name}
                                {agent.isWorkspaceAgent && (
                                  <span class="text-xs text-slate-500">
                                    {" "}
                                    (workspace)
                                  </span>
                                )}
                              </p>
                            </div>
                            {agent.agentId === ctx.agentId && (
                              <div class="flex items-center gap-1 flex-shrink-0 ml-2">
                                <span class="text-xs text-slate-600">
                                  Current
                                </span>
                                {editBtn}
                                {deleteBtn}
                              </div>
                            )}
                          </button>
                        ))}
                      </div>

                      {/* Create new agent in switcher */}
                      <div class="border-t border-slate-200">
                        {!creatingInSwitcher.value ? (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              creatingInSwitcher.value = true;
                            }}
                            class="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-slate-50 transition-colors text-slate-600"
                          >
                            <svg
                              class="w-4 h-4"
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
                            <span class="text-sm font-medium">
                              Create new agent
                            </span>
                          </button>
                        ) : (
                          <div
                            class="px-3 py-2 space-y-2"
                            role="none"
                            onClick={(e) => e.stopPropagation()}
                            onKeyDown={(e) => e.stopPropagation()}
                          >
                            <input
                              type="text"
                              value={switcherNewName.value}
                              onInput={(e) => {
                                switcherNewName.value = (
                                  e.target as HTMLInputElement
                                ).value;
                              }}
                              placeholder="Agent name"
                              maxLength={100}
                              class="w-full px-2 py-1.5 border border-gray-200 rounded-lg text-xs focus:border-slate-600 focus:ring-1 focus:ring-slate-200 outline-none"
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  e.preventDefault();
                                  if (switcherNewName.value.trim())
                                    handleCreateAgent(switcherNewName.value);
                                }
                              }}
                            />
                            <div class="flex gap-2">
                              <button
                                type="button"
                                onClick={() => {
                                  creatingInSwitcher.value = false;
                                  switcherNewName.value = "";
                                }}
                                class="flex-1 px-2 py-1.5 text-xs font-medium rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200 transition-all"
                              >
                                Cancel
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  handleCreateAgent(switcherNewName.value)
                                }
                                disabled={
                                  !switcherNewName.value.trim() ||
                                  switching.value
                                }
                                class="flex-1 px-2 py-1.5 text-xs font-medium rounded-lg bg-slate-600 text-white hover:bg-slate-700 transition-all disabled:opacity-60"
                              >
                                {switching.value ? "Creating..." : "Create"}
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div class="inline-flex items-center gap-2">
                  <h1
                    class="text-xl font-bold text-slate-900"
                    title={ctx.agentId}
                  >
                    {ctx.agentName.value || "Agent Settings"}
                  </h1>
                  {editBtn}
                  {deleteBtn}
                </div>
              )}
            </div>

            {ctx.agentDescription.value && (
              <p class="text-xs text-gray-500 mt-0.5">
                {ctx.agentDescription.value}
              </p>
            )}
            <p class="text-xs text-gray-500 mt-1">
              {ctx.platform ? (
                <span class="inline">{ctx.userId}</span>
              ) : (
                <span>{ctx.userId}</span>
              )}{" "}
              <a
                href={`/agent/${ctx.agentId}/history`}
                class="ml-2 text-slate-500 hover:text-slate-700"
              >
                History &rarr;
              </a>
            </p>
          </>
        )}

        {/* Inline identity edit */}
        {editingIdentity.value && (
          <div class="space-y-2 mb-3">
            <input
              type="text"
              value={ctx.agentName.value}
              onInput={(e) => {
                ctx.agentName.value = (e.target as HTMLInputElement).value;
              }}
              maxLength={100}
              placeholder="Agent name"
              class="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:border-slate-600 focus:ring-1 focus:ring-slate-200 outline-none"
            />
            <input
              type="text"
              value={ctx.agentDescription.value}
              onInput={(e) => {
                ctx.agentDescription.value = (
                  e.target as HTMLInputElement
                ).value;
              }}
              maxLength={200}
              placeholder="Short description"
              class="w-full px-3 py-2 border border-gray-200 rounded-lg text-xs focus:border-slate-600 focus:ring-1 focus:ring-slate-200 outline-none"
            />
            <div class="flex gap-2 justify-center">
              <button
                type="button"
                onClick={() => {
                  editingIdentity.value = false;
                  ctx.agentName.value = ctx.initialAgentName.value;
                  ctx.agentDescription.value =
                    ctx.initialAgentDescription.value;
                }}
                class="px-3 py-1.5 text-xs font-medium rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200 transition-all"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveIdentity}
                disabled={
                  ctx.savingIdentity.value ||
                  (ctx.agentName.value === ctx.initialAgentName.value &&
                    ctx.agentDescription.value ===
                      ctx.initialAgentDescription.value)
                }
                class="px-3 py-1.5 text-xs font-medium rounded-lg bg-slate-600 text-white hover:bg-slate-700 transition-all disabled:opacity-60"
              >
                {ctx.savingIdentity.value ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        )}

        {/* Delete confirmation */}
        {showDeleteConfirm.value && (
          <div class="mt-2 space-y-2">
            <p class="text-xs text-gray-600 text-center">
              Type <strong class="font-mono">{ctx.agentId}</strong> to confirm
              deletion:
            </p>
            <input
              type="text"
              value={deleteConfirmText.value}
              onInput={(e) => {
                deleteConfirmText.value = (e.target as HTMLInputElement).value;
              }}
              placeholder={ctx.agentId}
              class="w-full px-3 py-2 border border-red-200 rounded-lg text-xs font-mono focus:border-red-400 focus:ring-1 focus:ring-red-200 outline-none"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  if (deleteConfirmText.value === ctx.agentId)
                    handleDeleteAgent();
                }
              }}
            />
            <div class="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  showDeleteConfirm.value = false;
                  deleteConfirmText.value = "";
                }}
                class="flex-1 px-3 py-1.5 text-xs font-medium rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200 transition-all"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDeleteAgent}
                disabled={
                  deleteConfirmText.value !== ctx.agentId || deleting.value
                }
                class="flex-1 px-3 py-1.5 text-xs font-medium rounded-lg bg-red-600 text-white hover:bg-red-700 transition-all disabled:opacity-60"
              >
                {deleting.value ? "Deleting..." : "Delete"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
