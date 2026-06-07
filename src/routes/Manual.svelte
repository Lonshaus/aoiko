<script module lang="ts">
  import { marked } from 'marked'
  import { slugifyHeading } from '../lib/manual'
  // 見出しに id を付与し、章間 `#アンカー` と章内目次のジャンプ先を一致させる。
  marked.use({
    renderer: {
      heading(token) {
        const inner = this.parser.parseInline(token.tokens)
        return `<h${token.depth} id="${slugifyHeading(token.text)}">${inner}</h${token.depth}>`
      },
    },
  })
</script>

<script lang="ts">
  import { onMount, tick } from 'svelte'
  import { router, link } from '../router.svelte'
  import { getLocale } from '../paraglide/runtime'
  import { m } from '../paraglide/messages'
  import {
    INDEX_SLUG,
    slugFromPath,
    chapterSlugs,
    getManualContent,
    extractTitle,
    extractHeadings,
    adjacentChapters,
    rewriteLinks,
    stripLanguageNav,
    searchManual,
  } from '../lib/manual'

  const locale = getLocale()

  let query = $state('')
  const results = $derived(searchManual(query, locale))
  const searching = $derived(query.trim().length > 0)

  const slug = $derived(slugFromPath(router.path))
  const isIndex = $derived(slug === INDEX_SLUG)
  const content = $derived(getManualContent(slug, locale))
  const html = $derived(
    content === null ? null : (marked.parse(rewriteLinks(stripLanguageNav(content)), { async: false }) as string),
  )
  const headings = $derived(content === null ? [] : extractHeadings(stripLanguageNav(content)))
  const adjacent = $derived(adjacentChapters(slug))

  function titleOf(s: string): string {
    return extractTitle(getManualContent(s, locale) ?? '') || s
  }

  const chapters = chapterSlugs().map((s) => ({ slug: s, title: titleOf(s) }))

  function scrollToHash(hash: string) {
    if (!hash) {
      return
    }
    document.getElementById(decodeURIComponent(hash))?.scrollIntoView()
  }

  onMount(() => {
    scrollToHash(window.location.hash.slice(1))
  })

  // {@html} 内・章内目次のリンクを SPA 遷移／アンカージャンプに変換する。
  function onContentClick(e: MouseEvent) {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) {
      return
    }
    const anchor = (e.target as HTMLElement | null)?.closest('a')
    if (!anchor) {
      return
    }
    const href = anchor.getAttribute('href')
    if (!href) {
      return
    }
    if (href.startsWith('#')) {
      e.preventDefault()
      scrollToHash(href.slice(1))
      return
    }
    if (href.startsWith('/manual')) {
      e.preventDefault()
      const [path, hash] = href.split('#')
      router.goto(path ?? '/manual')
      void tick().then(() => scrollToHash(hash ?? ''))
    }
  }

  function go(path: string) {
    query = ''
    router.goto(path)
  }
</script>

<div class="md:grid md:grid-cols-[14rem_1fr] md:gap-8">
  <aside class="mb-6 md:mb-0">
    <div class="sticky top-8 space-y-3">
      <input
        type="search"
        bind:value={query}
        placeholder={m.manual_search()}
        class="w-full rounded-md border bg-background px-3 py-1.5 text-sm"
      />
      <nav class="space-y-1 text-sm">
        <a
          href="/manual"
          use:link
          class="block rounded px-2 py-1 hover:bg-muted {isIndex && !searching
            ? 'font-semibold text-foreground'
            : 'text-muted-foreground'}"
        >
          {m.manual_contents()}
        </a>
        {#each chapters as ch (ch.slug)}
          <a
            href="/manual/{ch.slug}"
            use:link
            class="block rounded px-2 py-1 hover:bg-muted {ch.slug === slug && !searching
              ? 'font-semibold text-foreground'
              : 'text-muted-foreground'}"
          >
            {ch.title}
          </a>
        {/each}
      </nav>
    </div>
  </aside>

  <div class="min-w-0">
    {#if searching}
      {#if results.length === 0}
        <p class="text-muted-foreground">{m.manual_no_results()}</p>
      {:else}
        <ul class="space-y-4">
          {#each results as r (r.slug)}
            <li>
              <a
                href={r.slug === INDEX_SLUG ? '/manual' : `/manual/${r.slug}`}
                use:link
                onclick={() => go(r.slug === INDEX_SLUG ? '/manual' : `/manual/${r.slug}`)}
                class="font-medium text-primary hover:underline"
              >
                {r.title}
              </a>
              <p class="mt-1 text-sm text-muted-foreground">{r.snippet}</p>
            </li>
          {/each}
        </ul>
      {/if}
    {:else if html === null}
      <div class="space-y-4">
        <p class="text-muted-foreground">{m.manual_not_found()}</p>
        <a href="/manual" use:link class="text-primary hover:underline">{m.manual_contents()}</a>
      </div>
    {:else}
      {#if !isIndex && headings.length > 1}
        <nav class="mb-6 rounded-md border bg-muted/40 p-4 text-sm">
          <p class="mb-2 font-medium">{m.manual_on_this_page()}</p>
          <ul class="space-y-1">
            {#each headings as h (h.id)}
              <li class={h.level === 3 ? 'ml-4' : ''}>
                <a href="#{h.id}" class="text-muted-foreground hover:text-foreground" onclick={onContentClick}>
                  {h.text}
                </a>
              </li>
            {/each}
          </ul>
        </nav>
      {/if}
      <article class="manual">
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
  </div>
</div>

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
    scroll-margin-top: 2rem;
  }
  .manual :global(h3) {
    font-size: 1.1rem;
    font-weight: 600;
    margin: 1.5rem 0 0.5rem;
    scroll-margin-top: 2rem;
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