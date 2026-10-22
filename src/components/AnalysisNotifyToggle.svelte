<script lang="ts">
  import { onMount } from 'svelte';
  import {
    analysisNotifyPermission,
    requestAnalysisNotifyPermission,
    type AnalysisNotifyPermission,
  } from '../lib/analysis-notify';
  import { getSetting, setSetting } from '../lib/settings';
  import { m } from '../paraglide/messages';
  // null は問い合わせ中。ネイティブ側の許可状態は OS への問い合わせで分かるため非同期。
  let permission = $state<AnalysisNotifyPermission | null>(null);
  let enabled = $state(false);
  let denied = $state(false);
  const supported = $derived(permission !== null && permission !== 'unsupported');
  // 使えない環境の出し分け。ブラウザは理由を添えて無効のトグルを出す。ネイティブ側の使えない環境は
  // そもそも通知の仕組みが無いので、トグル自体を出さない。
  const shown = $derived(permission !== null && (supported || !__NATIVE__));
  const hint = __NATIVE__
    ? m.settings_analysis_notify_hint_native
    : m.settings_analysis_notify_hint;
  const deniedText = __NATIVE__
    ? m.settings_analysis_notify_denied_native
    : m.settings_analysis_notify_denied;

  onMount(async () => {
    permission = await analysisNotifyPermission();
    if (permission === 'unsupported') {
      return;
    }
    // 保存値がオンでも、OS やブラウザ側で許可が外されていれば表示はオフにする。
    enabled = (await getSetting('analysisNotifyEnabled')) === true && permission === 'granted';
  });
  // 許可の要求は利用者の操作の中で呼んだときしか受け付けられないため、await より前に呼ぶ。
  async function handleChange(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const want = input.checked;
    denied = false;
    if (want && (await requestAnalysisNotifyPermission()) !== 'granted') {
      input.checked = false;
      denied = true;
      return;
    }
    enabled = want;
    await setSetting('analysisNotifyEnabled', want);
  }
</script>

{#if shown}
  <div class="space-y-1 border-t pt-4">
    <label class="flex items-center gap-2 text-sm cursor-pointer">
      <input
        type="checkbox"
        name="analysisNotifyEnabled"
        checked={enabled}
        disabled={!supported}
        onchange={handleChange}
      />
      {m.settings_analysis_notify_label()}
    </label>
    <p class="text-xs text-muted-foreground">{hint()}</p>
    {#if !supported}
      <p class="text-xs text-muted-foreground">{m.settings_analysis_notify_unsupported()}</p>
    {/if}
    {#if denied}
      <p class="text-xs text-destructive" role="alert">{deniedText()}</p>
    {/if}
  </div>
{/if}
