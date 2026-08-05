<script lang="ts">
  import { getLocale } from '../paraglide/runtime';
  import { m } from '../paraglide/messages';
  import type { PolicyDocName } from '../lib/policy-docs';

  type Props = {
    doc: PolicyDocName | 'LICENSE';
    label: string;
  };
  let { doc, label }: Props = $props();

  let open = $state(false);
  let html = $state<string | null>(null);
  let plainText = $state<string | null>(null);
  let loading = $state(false);
  // オフライン時も自己完結で全文を読めるようにする（旧: GitHub への外部リンクのみ）。
  // LICENSE は年号・字下げを保つ固定書式のプレーンテキストで、他 3 文書は marked で描画する。
  // どちらも初回展開時まで import しない：DisclaimerConsent は起動時に必ず描画されるため、
  // marked や文書本文をここで常時バンドルすると初回起動が重くなる。
  async function toggle() {
    if (open) {
      open = false;
      return;
    }
    open = true;
    if (html !== null || plainText !== null) {
      return;
    }
    loading = true;
    try {
      if (doc === 'LICENSE') {
        const { getLicenseText } = await import('../lib/policy-docs');
        plainText = getLicenseText();
        return;
      }
      const [{ getPolicyDoc, isExternalLink }, { Marked }] = await Promise.all([
        import('../lib/policy-docs'),
        import('marked'),
      ]);
      const content = getPolicyDoc(doc, getLocale());
      // marked は共有シングルトンなので marked.use() で書き換えると、同一セッション内で
      // Manual.svelte が登録した独自 renderer（/manual 遷移前提）と競合する。
      // 独立インスタンスを作って影響を閉じる。
      const renderer = new Marked({
        renderer: {
          link(token) {
            const inner = this.parser.parseInline(token.tokens);
            // 文書間の相対リンク（例 DISCLAIMER.md 内の [LICENSE](LICENSE)）はこのビューアの
            // スコープ外なのでリンクを外してテキストのみ残す。http(s) はブラウザで開く。
            return isExternalLink(token.href)
              ? `<a href="${token.href}" target="_blank" rel="noopener noreferrer" class="underline">${inner}</a>`
              : inner;
          },
        },
      });
      html = renderer.parse(content, { async: false }) as string;
    } finally {
      loading = false;
    }
  }
</script>

<button type="button" onclick={toggle} class="underline hover:text-foreground">{label}</button>
{#if open}
  <div
    class="mt-2 max-h-64 overflow-y-auto overscroll-contain rounded border bg-background p-3 text-left"
  >
    {#if loading}
      <p class="text-xs text-muted-foreground">{m.policy_doc_loading()}</p>
    {:else if plainText !== null}
      <pre class="whitespace-pre-wrap text-[11px] leading-relaxed font-mono">{plainText}</pre>
    {:else if html !== null}
      <div class="policy-doc-body text-xs space-y-2">{@html html}</div>
    {/if}
  </div>
{/if}

<style>
  .policy-doc-body :global(h1),
  .policy-doc-body :global(h2),
  .policy-doc-body :global(h3) {
    font-weight: 600;
    margin-top: 0.5rem;
  }
  .policy-doc-body :global(ul),
  .policy-doc-body :global(ol) {
    list-style: disc;
    list-style-position: inside;
  }
  .policy-doc-body :global(table) {
    border-collapse: collapse;
  }
  .policy-doc-body :global(th),
  .policy-doc-body :global(td) {
    border: 1px solid var(--border);
    padding: 0.25rem 0.5rem;
  }
</style>
