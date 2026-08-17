<script lang="ts">
  import { DISCLAIMER_VERSION, setSetting } from '../lib/settings';
  import { m } from '../paraglide/messages';
  import PolicyDocViewer from './PolicyDocViewer.svelte';

  type Props = {
    onaccept: () => void;
  };
  let { onaccept }: Props = $props();

  let accepting = $state(false);

  async function accept() {
    accepting = true;
    try {
      await setSetting('disclaimerAcceptedAt', Date.now());
      await setSetting('disclaimerAcceptedVersion', DISCLAIMER_VERSION);
      onaccept();
    } finally {
      accepting = false;
    }
  }
</script>

<!-- viewport-fit=cover なので inset-0 は安全領域まで覆う。避けないと iPhone のステータスバーに隠れる（#457） -->
<div
  class="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4 pt-[calc(1rem+env(safe-area-inset-top))] pb-[calc(1rem+env(safe-area-inset-bottom))]"
  role="dialog"
  aria-modal="true"
  aria-labelledby="disclaimer-title"
>
  <div
    class="bg-card text-card-foreground rounded-2xl max-w-2xl w-full max-h-full overflow-y-auto overscroll-contain p-8 space-y-6 shadow-xl"
  >
    <header class="space-y-2">
      <h2 id="disclaimer-title" class="text-2xl font-bold">{m.disclaimer_welcome_title()}</h2>
      <p class="text-sm text-muted-foreground">
        {@html m.disclaimer_intro_html()}
      </p>
    </header>

    <section class="space-y-3 text-sm">
      <div
        class="rounded border border-amber-500/40 bg-amber-50 dark:bg-amber-950/30 text-amber-900 dark:text-amber-200 px-4 py-3"
      >
        <p class="font-medium">{@html m.disclaimer_prototype_title_html()}</p>
        <p class="text-xs mt-1">{m.disclaimer_prototype_subtitle()}</p>
      </div>

      <ul class="space-y-2 list-disc list-inside">
        <li>{@html m.disclaimer_bullet_accuracy_html()}</li>
        <li>{@html m.disclaimer_bullet_tax_law_html()}</li>
        <li>{@html m.disclaimer_bullet_xtx_html()}</li>
        <li>{@html m.disclaimer_bullet_llm_html()}</li>
        <li>{@html m.disclaimer_bullet_storage_html()}</li>
        <li>{@html m.disclaimer_bullet_liability_html()}</li>
      </ul>

      <div class="text-xs text-muted-foreground pt-2 border-t space-y-1">
        <p>
          {m.disclaimer_docs_prefix()}
          <PolicyDocViewer doc="DISCLAIMER" label="DISCLAIMER.md" />
          ／
          <PolicyDocViewer doc="PRIVACY" label="PRIVACY.md" />
          ／
          <PolicyDocViewer doc="SECURITY" label="SECURITY.md" />
          ／
          <PolicyDocViewer doc="LICENSE" label="LICENSE (AGPL-3.0)" />
          ／
          <PolicyDocViewer doc="THIRD_PARTY" label="THIRD_PARTY_LICENSES.txt" />
        </p>
      </div>
    </section>

    <footer class="flex justify-end pt-2">
      <button
        type="button"
        onclick={accept}
        disabled={accepting}
        data-testid="disclaimer-accept"
        class="px-6 py-3 bg-primary text-primary-foreground rounded-lg hover:opacity-90 disabled:opacity-50 font-medium"
      >
        {accepting ? m.disclaimer_accept_button_saving() : m.disclaimer_accept_button()}
      </button>
    </footer>
  </div>
</div>
