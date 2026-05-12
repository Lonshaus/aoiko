<script lang="ts">
  import { onMount } from 'svelte';
  import { registerSW } from 'virtual:pwa-register';
  import { m } from '../paraglide/messages';

  let updateAvailable = $state(false);
  let offlineReady = $state(false);
  let dismissOffline = $state(false);
  let updateFn: ((reloadPage?: boolean) => Promise<void>) | null = null;

  onMount(() => {
    updateFn = registerSW({
      onNeedRefresh() {
        updateAvailable = true;
      },
      onOfflineReady() {
        offlineReady = true;
      },
    });
  });

  async function refresh() {
    if (updateFn) {
      await updateFn(true);
    }
  }
</script>

{#if updateAvailable}
  <div
    class="fixed bottom-4 right-4 z-50 bg-card text-card-foreground border rounded-lg shadow-lg p-4 max-w-sm"
  >
    <p class="text-sm font-medium mb-1">{m.update_available_title()}</p>
    <p class="text-xs text-muted-foreground mb-3">
      {m.update_available_hint()}
    </p>
    <div class="flex gap-2 justify-end">
      <button
        type="button"
        onclick={() => (updateAvailable = false)}
        class="px-3 py-1 text-xs border rounded hover:bg-accent"
      >
        {m.update_action_later()}
      </button>
      <button
        type="button"
        onclick={refresh}
        class="px-3 py-1 text-xs bg-primary text-primary-foreground rounded hover:opacity-90"
      >
        {m.update_action_now()}
      </button>
    </div>
  </div>
{:else if offlineReady && !dismissOffline}
  <div
    class="fixed bottom-4 right-4 z-50 bg-card text-card-foreground border rounded-lg shadow-sm p-3 max-w-sm flex items-center gap-3"
  >
    <span class="text-xs text-muted-foreground">
      {m.update_offline_ready()}
    </span>
    <button
      type="button"
      onclick={() => (dismissOffline = true)}
      aria-label={m.common_close()}
      class="text-muted-foreground hover:text-foreground"
    >
      ×
    </button>
  </div>
{/if}