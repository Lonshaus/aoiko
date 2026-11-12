<script lang="ts">
  import { onMount } from 'svelte';
  import { deleteSetting, getSetting } from '../lib/settings';
  import { isProcessingYear } from '../lib/initial-processing-year';
  import { link } from '../router.svelte';
  import { stashSettingsTarget } from '../lib/settings-target';
  import { m } from '../paraglide/messages';

  let year = $state<number | null>(null);
  let closing = $state(false);

  onMount(() => {
    void load();
  });

  async function load(): Promise<void> {
    try {
      const resetTo = await getSetting('processingYearResetTo');
      if (resetTo === undefined) {
        return;
      }
      const current = await getSetting('currentYear');
      if (isProcessingYear(resetTo) && resetTo === current) {
        year = resetTo;
        return;
      }
      // 復元などで年度が変わった後に、置き換え前の年を知らせ続けないため。
      await deleteSetting('processingYearResetTo');
    } catch {
      // 読めなければ出さない。
    }
  }

  async function close(): Promise<void> {
    if (closing) {
      return;
    }
    closing = true;
    try {
      await deleteSetting('processingYearResetTo');
      year = null;
    } catch {
      // 消せなければ出したままにする。
    }
    closing = false;
  }
</script>

{#if year !== null}
  <div
    class="flex flex-wrap items-center justify-between gap-3 text-xs border rounded-lg px-3 py-2 bg-card text-card-foreground"
  >
    <span class="text-muted-foreground">{m.processing_year_reset_notice({ year })}</span>
    <div class="flex items-center gap-4 whitespace-nowrap">
      <a
        href="/settings"
        use:link
        onclick={() => stashSettingsTarget('basic')}
        class="text-primary hover:underline py-2 -my-2"
        >{m.processing_year_reset_action_settings()}</a
      >
      <button
        type="button"
        onclick={close}
        disabled={closing}
        class="text-primary hover:underline py-2 -my-2 disabled:opacity-50"
        >{m.processing_year_reset_action_close()}</button
      >
    </div>
  </div>
{/if}
