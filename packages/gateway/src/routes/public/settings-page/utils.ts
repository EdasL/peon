import { platformRegistry } from "../../../platform";

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function formatUserId(userId: string): string {
  if (userId.startsWith("+")) return userId;
  if (userId.includes("@")) {
    const parts = userId.split("@");
    const id = parts[0] || "";
    const domain = parts[1] || "";
    if (domain === "lid") return `ID: ${id.slice(0, 8)}...`;
    if (domain === "s.whatsapp.net") return `+${id}`;
    return userId;
  }
  return userId;
}

export function getPlatformDisplay(platform: string): {
  icon: string;
  name: string;
} {
  const adapter = platformRegistry.get(platform);
  if (adapter?.getDisplayInfo) {
    const info = adapter.getDisplayInfo();
    const icon = info.icon.includes('class="')
      ? info.icon.replace('class="', 'class="w-4 h-4 inline-block ')
      : info.icon.replace("<svg", '<svg class="w-4 h-4 inline-block"');
    return { icon, name: info.name };
  }
  return {
    icon: '<svg class="w-4 h-4 inline-block" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"/></svg>',
    name: platform || "API",
  };
}
