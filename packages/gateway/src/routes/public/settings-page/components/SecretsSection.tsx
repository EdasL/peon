import { useSettings } from "../app";
import { Section } from "./Section";

export function SecretsSection() {
  const ctx = useSettings();

  function updateSecret(id: number, field: "key" | "value", val: string) {
    ctx.secrets.value = ctx.secrets.value.map((s) =>
      s.id === id ? { ...s, [field]: val } : s
    );
  }

  function setReveal(id: number, reveal: boolean) {
    ctx.secrets.value = ctx.secrets.value.map((s) =>
      s.id === id ? { ...s, reveal } : s
    );
  }

  return (
    <Section id="envvars" title="Secrets" icon="&#128203;">
      <div class="space-y-2">
        {ctx.secrets.value.length === 0 && (
          <p class="text-xs text-gray-400 italic">No secrets configured.</p>
        )}
        {ctx.secrets.value.map((secret) => (
          <div
            key={secret.id}
            class="bg-white border border-gray-200 rounded-lg p-2"
          >
            <div class="flex items-center gap-2">
              <input
                type="text"
                value={secret.key}
                onInput={(e) =>
                  updateSecret(
                    secret.id,
                    "key",
                    (e.target as HTMLInputElement).value
                  )
                }
                placeholder="API_KEY"
                class="w-40 px-2 py-1.5 border border-gray-200 rounded text-xs font-mono focus:border-slate-600 focus:ring-1 focus:ring-slate-200 outline-none"
              />
              <span class="text-xs font-mono text-gray-500 select-none">=</span>
              <input
                type={secret.reveal ? "text" : "password"}
                value={secret.value}
                onInput={(e) =>
                  updateSecret(
                    secret.id,
                    "value",
                    (e.target as HTMLInputElement).value
                  )
                }
                onFocus={() => setReveal(secret.id, true)}
                onBlur={() => setReveal(secret.id, false)}
                placeholder="secret value"
                class="flex-1 px-2 py-1.5 border border-gray-200 rounded text-xs font-mono focus:border-slate-600 focus:ring-1 focus:ring-slate-200 outline-none"
                autocomplete="new-password"
              />
              <button
                type="button"
                onClick={() => ctx.removeSecret(secret.id)}
                class="px-2.5 py-1.5 text-xs font-medium bg-transparent border-0 text-red-700 hover:text-red-800 transition-colors"
              >
                Remove
              </button>
            </div>
          </div>
        ))}
        <button
          type="button"
          onClick={() => ctx.addSecret("", "")}
          class="text-xs text-slate-600 hover:text-slate-800 font-medium"
        >
          + Add secret
        </button>
      </div>
    </Section>
  );
}
