import { baseLocale, type Locale } from '../paraglide/runtime';
import {
  buildLocaleRegistry,
  getPolicyDoc,
  isExternalLink,
  POLICY_DOC_NAMES,
  stripLanguageNav,
  type PolicyDocName,
} from './policy-docs';

export { stripLanguageNav };

const modules = import.meta.glob('../../docs/manual/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

export const INDEX_SLUG = 'README';

export function slugFromPath(path: string): string {
  const clean = path.replace(/[#?].*$/, '');
  if (clean === '/manual' || clean === '/manual/') {
    return INDEX_SLUG;
  }
  return decodeURIComponent(clean.slice('/manual/'.length).replace(/\/$/, ''));
}

const registry = buildLocaleRegistry(modules);

export function chapterSlugs(): string[] {
  return [...registry.keys()].filter((s) => s !== INDEX_SLUG).sort();
}
// 条文は章ではないので registry には入れない。chapterSlugs() が registry 由来なので、
// これだけでサイドバーと前後章ナビから外れる。
function isPolicySlug(slug: string): slug is PolicyDocName {
  return POLICY_DOC_NAMES.includes(slug as PolicyDocName);
}

export function hasChapter(slug: string): boolean {
  return registry.has(slug) || isPolicySlug(slug);
}

export function getManualContent(slug: string, locale: Locale): string | null {
  if (isPolicySlug(slug)) {
    return getPolicyDoc(slug, locale) || null;
  }
  const byLocale = registry.get(slug);
  if (!byLocale) {
    return null;
  }
  return byLocale.get(locale) ?? byLocale.get(baseLocale) ?? null;
}
// 見出しをプレーンテキストで出す箇所向け。アンカー id は元テキストから算出するので影響しない。
export function stripInline(text: string): string {
  return text
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
}

export function extractTitle(markdown: string): string {
  const match = markdown.match(/^#\s+(.+)$/m);
  return stripInline(match?.[1]?.trim() ?? '');
}

export function adjacentChapters(slug: string): { prev: string | null; next: string | null } {
  const slugs = chapterSlugs();
  const i = slugs.indexOf(slug);
  if (i === -1) {
    return { prev: null, next: null };
  }
  return {
    prev: i > 0 ? (slugs[i - 1] ?? null) : null,
    next: i < slugs.length - 1 ? (slugs[i + 1] ?? null) : null,
  };
}
// 章間の相対リンクを SPA ルートへ。`../../README.md` 等が対象外になるのは
// [A-Za-z0-9-] が `.` で止まるため。
export function rewriteLinks(markdown: string): string {
  return markdown.replace(
    /\]\((?:\.\/)?([A-Za-z0-9-]+)(?:_(?:en|zh-TW))?\.md(#[^)]*)?\)/g,
    (_full, name: string, hash?: string) => {
      const target = name === INDEX_SLUG ? '/manual' : `/manual/${name}`;
      return `](${target}${hash ?? ''})`;
    },
  );
}
// markdown ソースは GitHub でそのまま読めるよう repo ルート相対。アプリ内は常に `/` 相対で
// 配信されるので、描画前に絶対パスへ直す。
export function rewriteImagePaths(markdown: string): string {
  return markdown.replace(/\.\.\/\.\.\/src\/assets\/logo-wordmark\.png/g, '/logo-wordmark.png');
}

const GITHUB_BLOB_BASE = 'https://github.com/Lonshaus/aoiko/blob/master/';

interface ResolvedManualLink {
  href: string;
  external: boolean;
}
// 同意済みの条文へのリンク。オフラインでも読めるようアプリ内へ解決する。言語別ファイルを
// 同一 slug へ寄せるのは、表示言語を UI 設定に追従させ、踏んだリンクで決めさせないため。
const POLICY_DOC_LINK = /^(?:\.\.\/)+(DISCLAIMER|PRIVACY|SECURITY)(?:_(?:en|zh-TW))?\.md$/;
// href を marked の描画時に解決する。同梱していない開発者向けファイル（CONTRIBUTING 等）だけは
// GitHub 上の実体を指す絶対 URL へ寄せる。
export function resolveManualLink(href: string): ResolvedManualLink {
  if (href.startsWith('#') || href.startsWith('/manual')) {
    return { href, external: false };
  }
  if (isExternalLink(href)) {
    return { href, external: true };
  }
  const policy = POLICY_DOC_LINK.exec(href);
  if (policy) {
    return { href: `/manual/${policy[1]}`, external: false };
  }
  const repoPath = href.replace(/^(\.\.\/)+/, '');
  return { href: `${GITHUB_BLOB_BASE}${repoPath}`, external: true };
}
// GitHub 互換の見出し slug。既存の章間 `#アンカー` と一致させる必要がある。空白を 1 個ずつ
// '-' に置くのもそのため——記号除去で生じた連続空白を潰すと形が変わる。
export function slugifyHeading(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N} -]/gu, '')
    .replace(/ /g, '-');
}

interface Heading {
  level: number;
  text: string;
  id: string;
}
export function extractHeadings(markdown: string): Heading[] {
  const headings: Heading[] = [];
  let inFence = false;
  for (const line of markdown.split('\n')) {
    if (line.startsWith('```')) {
      inFence = !inFence;
      continue;
    }
    if (inFence) {
      continue;
    }
    const m = line.match(/^(#{2,3})\s+(.+)$/);
    if (m?.[1] && m[2]) {
      const raw = m[2].trim();
      headings.push({ level: m[1].length, text: stripInline(raw), id: slugifyHeading(raw) });
    }
  }
  return headings;
}

interface SearchHit {
  slug: string;
  title: string;
  snippet: string;
}

function makeSnippet(content: string, idx: number, len: number): string {
  const start = Math.max(0, idx - 30);
  const end = Math.min(content.length, idx + len + 40);
  const body = content
    .slice(start, end)
    .replace(/[#*`|>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return `${start > 0 ? '…' : ''}${body}${end < content.length ? '…' : ''}`;
}
export function searchManual(query: string, locale: Locale): SearchHit[] {
  const q = query.trim().toLowerCase();
  if (q.length === 0) {
    return [];
  }
  const hits: SearchHit[] = [];
  for (const slug of [INDEX_SLUG, ...chapterSlugs()]) {
    const content = getManualContent(slug, locale);
    if (!content) {
      continue;
    }
    const idx = content.toLowerCase().indexOf(q);
    if (idx === -1) {
      continue;
    }
    hits.push({
      slug,
      title: extractTitle(content) || slug,
      snippet: makeSnippet(content, idx, q.length),
    });
  }
  return hits;
}
