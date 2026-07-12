<script lang="ts">
  import { DISCLAIMER_VERSION, setSetting } from '../lib/settings';
  import { m } from '../paraglide/messages';

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

<div
  class="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4"
  role="dialog"
  aria-modal="true"
  aria-labelledby="disclaimer-title"
>
  <div
    class="bg-card text-card-foreground rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto p-8 space-y-6 shadow-xl"
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

      <p class="text-xs text-muted-foreground pt-2 border-t">
        {m.disclaimer_docs_prefix()}<a
          href="https://github.com/Lonshaus/aoiko/blob/master/DISCLAIMER.md"
          target="_blank"
          rel="noopener noreferrer"
          class="underline hover:text-foreground">DISCLAIMER.md</a
        >
        ／
        <a
          href="https://github.com/Lonshaus/aoiko/blob/master/PRIVACY.md"
          target="_blank"
          rel="noopener noreferrer"
          class="underline hover:text-foreground">PRIVACY.md</a
        >
        ／
        <a
          href="https://github.com/Lonshaus/aoiko/blob/master/SECURITY.md"
          target="_blank"
          rel="noopener noreferrer"
          class="underline hover:text-foreground">SECURITY.md</a
        >
        ／
        <a
          href="https://github.com/Lonshaus/aoiko/blob/master/LICENSE"
          target="_blank"
          rel="noopener noreferrer"
          class="underline hover:text-foreground">LICENSE (AGPL-3.0)</a
        >
      </p>
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
