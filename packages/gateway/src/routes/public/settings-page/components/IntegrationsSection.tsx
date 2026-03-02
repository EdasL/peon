import { useSignal } from "@preact/signals";
import { useRef } from "preact/hooks";
import * as api from "../api";
import { useSettings } from "../app";
import { Section } from "./Section";

interface IntegrationSearchResult {
  id: string;
  name: string;
  description: string;
  installs?: number;
  type: "skill" | "mcp";
}

export function IntegrationsSection() {
  const ctx = useSettings();
  const integrationSearch = useSignal("");
  const integrationSearchResults = useSignal<IntegrationSearchResult[]>([]);
  const integrationSearchVisible = useSignal(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const mcpServerIds = Object.keys(ctx.mcpServers.value);
  const totalCount = ctx.skills.value.length + mcpServerIds.length;

  function mcpIdFromUrl(url: string): string {
    try {
      return new URL(url).hostname.replace(/\./g, "-");
    } catch {
      return url
        .replace(/[^a-zA-Z0-9-]/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "");
    }
  }

  function getMcpDescription(mcpId: string): string {
    const config = ctx.mcpServers.value[mcpId];
    if (!config) return "";
    if (config.description) return config.description;
    if (config.url) return config.url;
    if (config.command)
      return `${config.command} ${(config.args || []).join(" ")}`;
    return "";
  }

  function formatInstalls(num?: number): string {
    if (!num) return "0";
    if (num >= 1000) return `${(num / 1000).toFixed(1)}k`;
    return num.toString();
  }

  function isIntegrationAdded(result: IntegrationSearchResult): boolean {
    if (result.type === "skill") {
      return ctx.skills.value.some((sk) => sk.repo === result.id);
    }
    return result.id in ctx.mcpServers.value;
  }

  async function handleSearchInput(query: string) {
    integrationSearch.value = query;
    if (searchTimer.current) clearTimeout(searchTimer.current);

    if (!query.trim()) {
      integrationSearchVisible.value = false;
      integrationSearchResults.value = [];
      return;
    }

    // Auto-detect URL
    if (
      query.startsWith("http://") ||
      query.startsWith("https://") ||
      query.includes("://")
    ) {
      const id = mcpIdFromUrl(query);
      await addMcp(id, query);
      integrationSearch.value = "";
      integrationSearchVisible.value = false;
      integrationSearchResults.value = [];
      return;
    }

    searchTimer.current = setTimeout(async () => {
      integrationSearchVisible.value = true;
      try {
        const data = await api.fetchIntegrationsRegistry(query.trim());
        const skills = (data.skills || []).map((s) => ({
          id: s.id || s.repo,
          name: s.name,
          description: s.description,
          installs: s.installs,
          type: "skill" as const,
        }));
        const mcps = (data.mcps || []).map((m) => ({
          id: m.id,
          name: m.name,
          description: m.description,
          type: "mcp" as const,
        }));
        integrationSearchResults.value = [...skills, ...mcps];
      } catch {
        integrationSearchResults.value = [];
      }
    }, 300);
  }

  async function addSkill(repo: string) {
    ctx.skillsLoading.value = true;
    ctx.skillsError.value = "";
    try {
      const fetched = await api.fetchSkillContent(repo);
      ctx.skills.value = [
        ...ctx.skills.value,
        {
          repo: fetched.repo,
          name: fetched.name,
          description: fetched.description,
          enabled: true,
          content: fetched.content,
          contentFetchedAt: fetched.fetchedAt,
        },
      ];
    } catch (e: unknown) {
      ctx.skillsError.value = e instanceof Error ? e.message : "Failed";
    } finally {
      ctx.skillsLoading.value = false;
    }
  }

  function toggleSkill(repo: string) {
    ctx.skills.value = ctx.skills.value.map((s) =>
      s.repo === repo ? { ...s, enabled: !s.enabled } : s
    );
  }

  function removeSkill(repo: string) {
    ctx.skills.value = ctx.skills.value.filter((s) => s.repo !== repo);
  }

  function addMcp(mcpId: string, customUrl: string | null) {
    const mcpConfig: Record<string, unknown> = { enabled: true };
    if (customUrl) mcpConfig.url = customUrl;
    ctx.mcpServers.value = { ...ctx.mcpServers.value, [mcpId]: mcpConfig };
  }

  function toggleMcp(mcpId: string) {
    const config = ctx.mcpServers.value[mcpId];
    if (!config) return;
    ctx.mcpServers.value = {
      ...ctx.mcpServers.value,
      [mcpId]: { ...config, enabled: config.enabled === false },
    };
  }

  function removeMcp(mcpId: string) {
    const updated = { ...ctx.mcpServers.value };
    delete updated[mcpId];
    ctx.mcpServers.value = updated;
  }

  async function addIntegrationFromSearch(result: IntegrationSearchResult) {
    if (isIntegrationAdded(result)) return;
    if (result.type === "skill") {
      await addSkill(result.id);
    } else {
      await addMcp(result.id, null);
    }
    integrationSearch.value = "";
    integrationSearchVisible.value = false;
    integrationSearchResults.value = [];
  }

  const badge =
    totalCount > 0 ? (
      <span class="text-xs text-gray-400">({totalCount})</span>
    ) : undefined;

  const loadingBadge =
    ctx.skillsLoading.value || ctx.mcpsLoading.value ? (
      <span class="animate-spin text-slate-600">&#8635;</span>
    ) : undefined;

  return (
    <Section
      id="integrations"
      title="Skills and MCP"
      icon="&#128268;"
      badge={
        <>
          {loadingBadge}
          {badge}
        </>
      }
    >
      <div class="space-y-3">
        {ctx.skillsError.value && (
          <div class="bg-red-100 text-red-800 px-3 py-2 rounded-lg text-xs">
            {ctx.skillsError.value}
          </div>
        )}
        {ctx.mcpsError.value && (
          <div class="bg-red-100 text-red-800 px-3 py-2 rounded-lg text-xs">
            {ctx.mcpsError.value}
          </div>
        )}

        <div class="space-y-2">
          {ctx.skills.value.length === 0 && mcpServerIds.length === 0 && (
            <p class="text-xs text-gray-500">
              No skills or MCP servers configured yet.
            </p>
          )}
          {ctx.skills.value.map((skill) => (
            <div
              key={`skill-${skill.repo}`}
              class="flex items-center justify-between p-2 bg-white rounded border border-gray-100"
            >
              <div class="flex items-center gap-2 flex-1 min-w-0">
                <span class="text-[9px] uppercase font-bold px-1.5 py-0.5 rounded bg-purple-100 text-purple-700 shrink-0">
                  skill
                </span>
                <div class="min-w-0">
                  <a
                    href={`https://clawhub.ai/skills/${encodeURIComponent(skill.repo)}`}
                    onClick={(e) => {
                      e.preventDefault();
                      ctx.openExternal(
                        `https://clawhub.ai/skills/${encodeURIComponent(skill.repo)}`
                      );
                    }}
                    class="text-xs font-medium text-slate-700 hover:text-slate-900 hover:underline truncate block cursor-pointer"
                  >
                    {skill.name}
                  </a>
                  {skill.description && (
                    <p class="text-xs text-gray-500 truncate">
                      {skill.description}
                    </p>
                  )}
                </div>
              </div>
              <div class="flex items-center gap-2 ml-2 flex-shrink-0">
                <button
                  type="button"
                  onClick={() => toggleSkill(skill.repo)}
                  class={`px-2 py-1 text-xs rounded ${skill.enabled ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-500"}`}
                >
                  {skill.enabled ? "Enabled" : "Disabled"}
                </button>
                <button
                  type="button"
                  onClick={() => removeSkill(skill.repo)}
                  class="px-2 py-1 text-xs rounded bg-red-100 text-red-700 hover:bg-red-200"
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
          {mcpServerIds.map((mcpId) => (
            <div
              key={`mcp-${mcpId}`}
              class="flex items-center justify-between p-2 bg-white rounded border border-gray-100"
            >
              <div class="flex items-center gap-2 flex-1 min-w-0">
                <span class="text-[9px] uppercase font-bold px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 shrink-0">
                  mcp
                </span>
                <div class="min-w-0">
                  <p class="text-xs font-medium text-gray-800 truncate">
                    {mcpId}
                  </p>
                  {getMcpDescription(mcpId) && (
                    <p class="text-xs text-gray-500 truncate">
                      {getMcpDescription(mcpId)}
                    </p>
                  )}
                </div>
              </div>
              <div class="flex items-center gap-2 ml-2 flex-shrink-0">
                <button
                  type="button"
                  onClick={() => toggleMcp(mcpId)}
                  class={`px-2 py-1 text-xs rounded ${ctx.mcpServers.value[mcpId]?.enabled !== false ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-500"}`}
                >
                  {ctx.mcpServers.value[mcpId]?.enabled !== false
                    ? "Enabled"
                    : "Disabled"}
                </button>
                <button
                  type="button"
                  onClick={() => removeMcp(mcpId)}
                  class="px-2 py-1 text-xs rounded bg-red-100 text-red-700 hover:bg-red-200"
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* Unified Search */}
        <div class="border-t border-gray-100 pt-2">
          <div class="relative mb-2">
            <input
              type="text"
              value={integrationSearch.value}
              onInput={(e) =>
                handleSearchInput((e.target as HTMLInputElement).value)
              }
              onFocus={() => {
                const q = integrationSearch.value.trim();
                if (q && !q.startsWith("http") && !q.includes("://"))
                  integrationSearchVisible.value = true;
              }}
              placeholder="Search skills/MCP or paste MCP URL..."
              class="w-full px-3 py-2 border border-gray-200 rounded-lg text-xs focus:border-slate-600 focus:ring-1 focus:ring-slate-200 outline-none"
            />
            {integrationSearchVisible.value && (
              <div class="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                {integrationSearchResults.value.map((result) => (
                  <button
                    key={`${result.type}-${result.id}`}
                    type="button"
                    class="w-full text-left p-2 hover:bg-gray-50 cursor-pointer border-b border-gray-100 last:border-b-0"
                    onClick={() => addIntegrationFromSearch(result)}
                  >
                    <div class="flex items-center justify-between">
                      <div class="flex items-center gap-2 flex-1 min-w-0">
                        <span
                          class={`text-[9px] uppercase font-bold px-1.5 py-0.5 rounded shrink-0 ${result.type === "skill" ? "bg-purple-100 text-purple-700" : "bg-blue-100 text-blue-700"}`}
                        >
                          {result.type}
                        </span>
                        <div class="min-w-0">
                          <p class="text-xs font-medium text-gray-800 truncate">
                            {result.name}
                          </p>
                          {result.description && (
                            <p class="text-xs text-gray-500 truncate">
                              {result.description}
                            </p>
                          )}
                        </div>
                      </div>
                      <div class="flex items-center gap-2 ml-2">
                        {result.type === "skill" && result.installs ? (
                          <span class="text-xs text-gray-400">
                            {formatInstalls(result.installs)}
                          </span>
                        ) : null}
                        <span
                          class={`text-xs ${isIntegrationAdded(result) ? "text-green-600" : "text-slate-600"}`}
                        >
                          {isIntegrationAdded(result) ? "Added" : "+ Add"}
                        </span>
                      </div>
                    </div>
                  </button>
                ))}
                {integrationSearchResults.value.length === 0 && (
                  <div class="p-2 text-xs text-gray-500">
                    No skills or MCP servers found
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Curated chips */}
          {ctx.skills.value.length === 0 && mcpServerIds.length === 0 && (
            <div class="mb-2">
              <div class="flex flex-wrap gap-1">
                {ctx.curatedSkills.value.map((cs) => {
                  const added = ctx.skills.value.some(
                    (sk) => sk.repo === cs.repo
                  );
                  return (
                    <button
                      key={`cs-${cs.repo}`}
                      type="button"
                      onClick={() => !added && addSkill(cs.repo)}
                      class={`px-2 py-1 text-xs rounded-full bg-purple-50 text-slate-800 border border-purple-200 ${added ? "opacity-50 cursor-not-allowed" : "cursor-pointer hover:bg-purple-100"}`}
                      disabled={added}
                      title={added ? "Already added" : cs.description}
                    >
                      {cs.name}
                    </button>
                  );
                })}
                {ctx.curatedMcps.value.map((cm) => {
                  const added = cm.id in ctx.mcpServers.value;
                  return (
                    <button
                      key={`cm-${cm.id}`}
                      type="button"
                      onClick={() => !added && addMcp(cm.id, null)}
                      class={`px-2 py-1 text-xs rounded-full bg-blue-50 text-slate-800 border border-blue-200 ${added ? "opacity-50 cursor-not-allowed" : "cursor-pointer hover:bg-blue-100"}`}
                      disabled={added}
                      title={added ? "Already added" : cm.description}
                    >
                      {cm.name}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <p class="text-xs text-gray-400 mt-1">
            Extend your agent with{" "}
            <a
              href="https://clawhub.ai/skills"
              onClick={(e) => {
                e.preventDefault();
                ctx.openExternal("https://clawhub.ai/skills");
              }}
              class="text-blue-600 hover:underline cursor-pointer"
            >
              skills from ClawHub
            </a>{" "}
            and MCP servers.
          </p>
        </div>
      </div>
    </Section>
  );
}
