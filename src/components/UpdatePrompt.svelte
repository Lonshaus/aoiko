<script lang="ts">
  import { onMount } from 'svelte';
  import { registerSW } from 'virtual:pwa-register';

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
    <p class="text-sm font-medium mb-1">新しいバージョンがあります</p>
    <p class="text-xs text-muted-foreground mb-3">
      仕訳の入力中は次回起動時に更新するのをおすすめします。
    </p>
    <div class="flex gap-2 justify-end">
      <button
        type="button"
        onclick={() => (updateAvailable = false)}
        class="px-3 py-1 text-xs border rounded hover:bg-accent"
      >
        後で
      </button>
      <button
        type="button"
        onclick={refresh}
        class="px-3 py-1 text-xs bg-primary text-primary-foreground rounded hover:opacity-90"
      >
        更新する
      </button>
    </div>
  </div>
{:else if offlineReady && !dismissOffline}
  <div
    class="fixed bottom-4 right-4 z-50 bg-card text-card-foreground border rounded-lg shadow-sm p-3 max-w-sm flex items-center gap-3"
  >
    <span class="text-xs text-muted-foreground">
      ✓ オフラインで利用可能になりました
    </span>
    <button
      type="button"
      onclick={() => (dismissOffline = true)}
      aria-label="閉じる"
      class="text-muted-foreground hover:text-foreground"
    >
      ×
    </button>
  </div>
{/if}