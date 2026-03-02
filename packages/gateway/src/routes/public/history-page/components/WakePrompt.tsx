import { useSignal } from "@preact/signals";

export function WakePrompt({
  agentId,
  onWake,
}: {
  agentId: string;
  onWake: () => void;
}) {
  const polling = useSignal(false);
  const error = useSignal<string | null>(null);

  async function handleWake() {
    polling.value = true;
    error.value = null;

    // Poll status until connected
    const maxAttempts = 30;
    for (let i = 0; i < maxAttempts; i++) {
      try {
        const resp = await fetch(`/api/v1/agents/${agentId}/history/status`);
        if (resp.ok) {
          const data = await resp.json();
          if (data.connected && data.hasHttpServer) {
            polling.value = false;
            onWake();
            return;
          }
        }
      } catch {
        // retry
      }
      await new Promise((r) => setTimeout(r, 2000));
    }

    polling.value = false;
    error.value =
      "Agent did not come online. Try sending a message to wake it.";
  }

  return (
    <div class="flex flex-col items-center justify-center py-24 px-4">
      <div class="w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center mb-4">
        <svg
          aria-hidden="true"
          class="w-8 h-8 text-gray-400"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"
          />
        </svg>
      </div>
      <h2 class="text-lg font-medium text-gray-700 mb-1">Agent is offline</h2>
      <p class="text-sm text-gray-500 mb-6 text-center max-w-sm">
        The agent worker is currently scaled down. Send a message to wake it up,
        then come back to view the conversation history.
      </p>

      {polling.value ? (
        <div class="flex items-center gap-2 text-sm text-gray-500">
          <div class="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-500"></div>
          Waiting for agent to come online...
        </div>
      ) : (
        <button
          type="button"
          onClick={handleWake}
          class="px-4 py-2 bg-blue-500 text-white rounded-lg text-sm font-medium hover:bg-blue-600 transition-colors"
        >
          Check Status
        </button>
      )}

      {error.value && <p class="mt-4 text-sm text-red-500">{error.value}</p>}
    </div>
  );
}
