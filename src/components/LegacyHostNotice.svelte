<script lang="ts">
  import { isLegacyHost, LEGACY_HOST_END_DATE, NEW_ORIGIN } from '../lib/legacy-host';
  import { legacyHostNotice } from '../lib/legacy-host-notice.svelte';
  import { link } from '../router.svelte';
  import { stashSettingsTarget } from '../lib/settings-target';
  import { m } from '../paraglide/messages';
  import { getLocale } from '../paraglide/runtime';

  interface Props {
    endDate?: string | null;
  }

  let { endDate = LEGACY_HOST_END_DATE }: Props = $props();

  const visible = $derived(isLegacyHost(window.location.hostname) && !legacyHostNotice.dismissed);
  // 文言の中の新しい URL だけをリンクにするため、目印で文言を前後に分ける。
  const URL_MARK = '\u0000';
  const message = $derived.by(() => {
    const parts = endDate?.split('-');
    if (parts === undefined || parts.length !== 2) {
      return m.legacy_host_notice({ newUrl: URL_MARK });
    }
    const [year = '', month = ''] = parts;
    // 英語は月名で書く。UTC の 1 日で組むので、時差で前月にずれない。
    const when =
      getLocale() === 'en'
        ? new Intl.DateTimeFormat('en', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
            Date.UTC(Number(year), Number(month) - 1, 1),
          )
        : `${year}/${month}`;
    return m.legacy_host_notice_dated({ when, newUrl: URL_MARK });
  });
  const before = $derived(message.split(URL_MARK)[0] ?? '');
  const after = $derived(message.split(URL_MARK)[1] ?? '');
</script>

{#if visible}
  <div
    class="relative flex flex-col gap-1 text-xs border border-destructive/50 rounded-lg pl-3 pr-8 py-2 bg-card text-card-foreground"
  >
    <span class="text-muted-foreground">
      {before}<a
        href={NEW_ORIGIN}
        target="_blank"
        rel="noopener noreferrer"
        class="text-primary hover:underline"
      >
        {NEW_ORIGIN}
      </a>{after}
    </span>
    <a
      href="/settings"
      use:link
      onclick={() => stashSettingsTarget('backup')}
      class="self-end text-primary hover:underline whitespace-nowrap"
    >
      {m.legacy_host_action_backup()}
    </a>
    <button
      type="button"
      onclick={() => legacyHostNotice.dismiss()}
      aria-label={m.common_close()}
      class="absolute top-1 right-2 px-1 text-muted-foreground hover:text-destructive"
    >
      ×
    </button>
  </div>
{/if}
