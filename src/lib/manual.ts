import { baseLocale, locales, type Locale } from '../paraglide/runtime'

const modules = import.meta.glob('../../docs/manual/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

export const INDEX_SLUG = 'README'

export function slugFromPath(path: string): string {
  const clean = path.replace(/[#?].*$/, '')
  if (clean === '/manual' || clean === '/manual/') {
    return INDEX_SLUG
  }
  return decodeURIComponent(clean.slice('/manual/'.length).replace(/\/$/, ''))
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

// GitHub 互換の見出し slug。既存の章間 `#アンカー` リンクと一致させる必要があるため
// 小文字化・記号除去・空白→ハイフン・CJK 保持で揃える。
export function slugifyHeading(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N} -]/gu, '')
    .replace(/ +/g, '-')
}

export interface Heading {
  level: number
  text: string
  id: string
}

// h2 / h3 のみを章内目次として抽出する。コードブロック内は対象外。
export function extractHeadings(markdown: string): Heading[] {
  const headings: Heading[] = []
  let inFence = false
  for (const line of markdown.split('\n')) {
    if (line.startsWith('```')) {
      inFence = !inFence
      continue
    }
    if (inFence) {
      continue
    }
    const m = line.match(/^(#{2,3})\s+(.+)$/)
    if (m?.[1] && m[2]) {
      const text = m[2].trim()
      headings.push({ level: m[1].length, text, id: slugifyHeading(text) })
    }
  }
  return headings
}

export interface SearchHit {
  slug: string
  title: string
  snippet: string
}

function makeSnippet(content: string, idx: number, len: number): string {
  const start = Math.max(0, idx - 30)
  const end = Math.min(content.length, idx + len + 40)
  const body = content
    .slice(start, end)
    .replace(/[#*`|>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return `${start > 0 ? '…' : ''}${body}${end < content.length ? '…' : ''}`
}

// 全マニュアルを対象に大文字小文字を無視して全文検索する。索引（README）を先頭に章番号順。
export function searchManual(query: string, locale: Locale): SearchHit[] {
  const q = query.trim().toLowerCase()
  if (q.length === 0) {
    return []
  }
  const hits: SearchHit[] = []
  for (const slug of [INDEX_SLUG, ...chapterSlugs()]) {
    const content = getManualContent(slug, locale)
    if (!content) {
      continue
    }
    const idx = content.toLowerCase().indexOf(q)
    if (idx === -1) {
      continue
    }
    hits.push({ slug, title: extractTitle(content) || slug, snippet: makeSnippet(content, idx, q.length) })
  }
  return hits
}