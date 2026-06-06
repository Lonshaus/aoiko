<script lang="ts">
  import { marked } from 'marked'
  import { router, link } from '../router.svelte'
  import { getLocale } from '../paraglide/runtime'
  import { m } from '../paraglide/messages'
  import {
    INDEX_SLUG,
    slugFromPath,
    getManualContent,
    extractTitle,
    adjacentChapters,
    rewriteLinks,
    stripLanguageNav,
  } from '../lib/manual'

  const locale = getLocale()

  const slug = $derived(slugFromPath(router.path))

  const isIndex = $derived(slug === INDEX_SLUG)

  const content = $derived(getManualContent(slug, locale))

  const html = $derived(
    content === null ? null : (marked.parse(rewriteLinks(stripLanguageNav(content)), { async: false }) as string),
  )

  const chapterTitle = $derived(content === null ? '' : extractTitle(content))

  const adjacent = $derived(adjacentChapters(slug))

  function titleOf(s: string): string {
    return extractTitle(getManualContent(s, locale) ?? '') || s
  }

  // {@html} 内のリンクには use:link が効かないため、クリックを委譲して SPA 遷移に変換する。
  function onContentClick(e: MouseEvent) {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) {
      return
    }
    const anchor = (e.target as HTMLElement | null)?.closest('a')
    if (!anchor) {
      return
    }
    const href = anchor.getAttribute('href')
    if (!href || !href.startsWith('/manual')) {
      return
    }
    e.preventDefault()
    router.goto(href)
  }
</script>

{#if html === null}
  <div class="space-y-4">
    <p class="text-muted-foreground">{m.manual_not_found()}</p>
    <a href="/manual" use:link class="text-primary hover:underline">{m.manual_back_to_index()}</a>
  </div>
{:else}
  {#if !isIndex}
    <a href="/manual" use:link class="text-sm text-muted-foreground hover:text-foreground transition-colors">
      ← {m.manual_back_to_index()}
    </a>
  {/if}
  <article class="manual mt-4">
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <div onclick={onContentClick}>{@html html}</div>
  </article>
  {#if !isIndex}
    <nav class="mt-10 flex justify-between gap-4 border-t pt-6 text-sm">
      {#if adjacent.prev}
        <a href="/manual/{adjacent.prev}" use:link class="text-primary hover:underline">
          ← {m.manual_prev()}：{titleOf(adjacent.prev)}
        </a>
      {:else}
        <span></span>
      {/if}
      {#if adjacent.next}
        <a href="/manual/{adjacent.next}" use:link class="text-primary hover:underline text-right">
          {m.manual_next()}：{titleOf(adjacent.next)} →
        </a>
      {:else}
        <span></span>
      {/if}
    </nav>
  {/if}
{/if}

<style>
  .manual :global(h1) {
    font-size: 1.6rem;
    font-weight: 700;
    margin: 0 0 1rem;
  }
  .manual :global(h2) {
    font-size: 1.3rem;
    font-weight: 700;
    margin: 2rem 0 0.75rem;
    padding-bottom: 0.3rem;
    border-bottom: 1px solid rgb(128 128 128 / 0.25);
  }
  .manual :global(h3) {
    font-size: 1.1rem;
    font-weight: 600;
    margin: 1.5rem 0 0.5rem;
  }
  .manual :global(p),
  .manual :global(li) {
    line-height: 1.8;
  }
  .manual :global(p) {
    margin: 0.75rem 0;
  }
  .manual :global(ul),
  .manual :global(ol) {
    margin: 0.75rem 0;
    padding-left: 1.5rem;
  }
  .manual :global(ul) {
    list-style: disc;
  }
  .manual :global(ol) {
    list-style: decimal;
  }
  .manual :global(li) {
    margin: 0.25rem 0;
  }
  .manual :global(a) {
    color: hsl(var(--primary));
    text-decoration: underline;
  }
  .manual :global(code) {
    font-family: ui-monospace, monospace;
    font-size: 0.875em;
    background: rgb(128 128 128 / 0.15);
    padding: 0.1em 0.35em;
    border-radius: 0.25rem;
  }
  .manual :global(pre) {
    background: rgb(128 128 128 / 0.12);
    padding: 0.9rem 1rem;
    border-radius: 0.5rem;
    overflow-x: auto;
    margin: 1rem 0;
  }
  .manual :global(pre code) {
    background: none;
    padding: 0;
  }
  .manual :global(blockquote) {
    border-left: 3px solid rgb(128 128 128 / 0.4);
    padding-left: 1rem;
    margin: 1rem 0;
    color: hsl(var(--muted-foreground));
  }
  .manual :global(table) {
    width: 100%;
    border-collapse: collapse;
    margin: 1rem 0;
    font-size: 0.9rem;
  }
  .manual :global(th),
  .manual :global(td) {
    border: 1px solid rgb(128 128 128 / 0.3);
    padding: 0.4rem 0.6rem;
    text-align: left;
  }
  .manual :global(th) {
    background: rgb(128 128 128 / 0.1);
    font-weight: 600;
  }
  .manual :global(hr) {
    border: none;
    border-top: 1px solid rgb(128 128 128 / 0.25);
    margin: 1.5rem 0;
  }
</style>