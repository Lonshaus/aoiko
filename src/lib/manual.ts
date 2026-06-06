import { baseLocale, locales, type Locale } from '../paraglide/runtime'

const modules = import.meta.glob('../../docs/manual/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

export const INDEX_SLUG = 'README'

export function slugFromPath(path: string): string {
  if (path === '/manual' || path === '/manual/') {
    return INDEX_SLUG
  }
  return decodeURIComponent(path.slice('/manual/'.length).replace(/\/$/, ''))
}

function parseFilename(path: string): { slug: string; locale: Locale } {
  const base = (path.split('/').pop() ?? '').replace(/\.md$/, '')
  for (const loc of locales) {
    if (loc === baseLocale) {
      continue
    }
    const suffix = `_${loc}`
    if (base.endsWith(suffix)) {
      return { slug: base.slice(0, -suffix.length), locale: loc }
    }
  }
  return { slug: base, locale: baseLocale }
}

const registry = new Map<string, Map<Locale, string>>()
for (const [path, content] of Object.entries(modules)) {
  const { slug, locale } = parseFilename(path)
  let byLocale = registry.get(slug)
  if (!byLocale) {
    byLocale = new Map()
    registry.set(slug, byLocale)
  }
  byLocale.set(locale, content)
}

export function chapterSlugs(): string[] {
  return [...registry.keys()].filter((s) => s !== INDEX_SLUG).sort()
}

export function hasChapter(slug: string): boolean {
  return registry.has(slug)
}

export function getManualContent(slug: string, locale: Locale): string | null {
  const byLocale = registry.get(slug)
  if (!byLocale) {
    return null
  }
  return byLocale.get(locale) ?? byLocale.get(baseLocale) ?? null
}

export function extractTitle(markdown: string): string {
  const match = markdown.match(/^#\s+(.+)$/m)
  return match?.[1]?.trim() ?? ''
}

export function adjacentChapters(slug: string): { prev: string | null; next: string | null } {
  const slugs = chapterSlugs()
  const i = slugs.indexOf(slug)
  if (i === -1) {
    return { prev: null, next: null }
  }
  return {
    prev: i > 0 ? (slugs[i - 1] ?? null) : null,
    next: i < slugs.length - 1 ? (slugs[i + 1] ?? null) : null,
  }
}

// マニュアル章間の相対リンク（例 `02-journal_zh-TW.md`、`08-depreciation.md`）を
// SPA ルート `/manual/02-journal` に書き換える。README は目次ルート `/manual` へ。
// `../../README.md` のようなマニュアル外リンクは [A-Za-z0-9-] が `.` で止まるため対象外。
export function rewriteLinks(markdown: string): string {
  return markdown.replace(
    /\]\((?:\.\/)?([A-Za-z0-9-]+)(?:_(?:en|zh-TW))?\.md(#[^)]*)?\)/g,
    (_full, name: string, hash?: string) => {
      const target = name === INDEX_SLUG ? '/manual' : `/manual/${name}`
      return `](${target}${hash ?? ''})`
    },
  )
}

// アプリ内では言語は UI 設定に追従するため、各 .md 冒頭の言語切替行（GitHub 閲覧用）は不要。
// 行内のリンクが同一ルートへ収束して機能しないため、レンダリング前に取り除く。
export function stripLanguageNav(markdown: string): string {
  return markdown.replace(/^\*\*Language\*\*:.*$\n?/m, '')
}