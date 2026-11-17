<script lang="ts">
  import { onMount } from 'svelte';
  import { dataCheck } from '../stores/data-check.svelte';
  import { getSetting, setSetting } from '../lib/settings';
  import { link } from '../router.svelte';
  import { stashSettingsTarget } from '../lib/settings-target';
  import { describeStorageError } from '../lib/storage-error';
  import { m } from '../paraglide/messages';

  let acknowledged = $state<string | null>(null);
  let acknowledgedLoaded = $state(false);
  let saving = $state(false);
  let saveError = $state('');

  const result = $derived(dataCheck.status === 'done' ? dataCheck.result : null);
  const visible = $derived(
    acknowledgedLoaded &&
      result !== null &&
      result.total > 0 &&
      result.fingerprint !== acknowledged,
  );

  onMount(() => {
    void dataCheck.ensureStarted();
    void loadAcknowledged();
  });

  async function loadAcknowledged(): Promise<void> {
    try {
      acknowledged = (await getSetting('dataCheckAcknowledged')) ?? null;
    } catch {
      acknowledged = null;
    }
    acknowledgedLoaded = true;
  }
  // 保存が済むまで隠さない。先に隠すと、すぐ再読み込みされたときに記録が残っておらず、また出る。
  async function acknowledge(): Promise<void> {
    if (result === null || saving) {
      return;
    }
    const fingerprint = result.fingerprint;
    saving = true;
    saveError = '';
    try {
      await setSetting('dataCheckAcknowledged', fingerprint);
      acknowledged = fingerprint;
    } catch (e) {
      saveError = m.data_check_notice_ack_failed({ message: describeStorageError(e) });
    }
    saving = false;
  }
</script>

{#if visible && result !== null}
  <div
    class="flex flex-wrap items-center justify-between gap-3 text-xs border border-destructive/50 rounded-lg px-3 py-2 bg-card"
  >
    <span class="text-destructive">{m.data_check_notice({ count: result.total })}</span>
    <div class="flex items-center gap-4 whitespace-nowrap">
      <a
        href="/settings"
        use:link
        onclick={() => stashSettingsTarget('dataCheck')}
        class="text-primary hover:underline py-2 -my-2">{m.data_check_notice_action_details()}</a
      >
      <button
        type="button"
        onclick={acknowledge}
        disabled={saving}
        class="text-primary hover:underline py-2 -my-2 disabled:opacity-50"
        >{m.data_check_notice_action_ack()}</button
      >
    </div>
    {#if saveError !== ''}
      <p class="basis-full text-destructive">{saveError}</p>
    {/if}
  </div>
{/if}
