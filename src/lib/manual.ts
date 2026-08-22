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
// 条文は章ではないので registry には入れない。chapterSlugs() は registry から
// 導出されるため、サイドバーと前後章ナビゲーションには自動的に現れない
// （「次の章：PRIVACY」のような並びにならない）。ルートとしてだけ解決できればよい。
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
// 見出しをプレーンテキスト表示する箇所（サイドバー・前後章・検索結果・章内目次）向けに
// インライン記法（`code`・太字・斜体・リンク）を除去する。アンカー id は元テキストから算出するため影響しない。
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
// マニュアル章間の相対リンク（例 `02-journal_zh-TW.md`、`08-depreciation.md`）を
// SPA ルート `/manual/02-journal` に書き換える。README は目次ルート `/manual` へ。
// `../../README.md` のようなマニュアル外リンクは [A-Za-z0-9-] が `.` で止まるため対象外。
export function rewriteLinks(markdown: string): string {
  return markdown.replace(
    /\]\((?:\.\/)?([A-Za-z0-9-]+)(?:_(?:en|zh-TW))?\.md(#[^)]*)?\)/g,
    (_full, name: string, hash?: string) => {
      const target = name === INDEX_SLUG ? '/manual' : `/manual/${name}`;
      return `](${target}${hash ?? ''})`;
    },
  );
}
// GitHub 上でそのまま表示できるよう、markdown ソースは repo ルート相対パス（例 `../../src/assets/logo-wordmark.png`）
// を使う。アプリ内はルーティング階層に関わらず常に `/` 相対で配信されるため、レンダリング前に絶対パスへ書き換える。
export function rewriteImagePaths(markdown: string): string {
  return markdown.replace(/\.\.\/\.\.\/src\/assets\/logo-wordmark\.png/g, '/logo-wordmark.png');
}

const GITHUB_BLOB_BASE = 'https://github.com/Lonshaus/aoiko/blob/master/';

interface ResolvedManualLink {
  href: string;
  external: boolean;
}
// 利用者が同意した条文への相対リンク。オフラインでも読めるようアプリ内へ解決する。
// 言語別ファイル（`_en` / `_zh-TW`）は同一 slug へ寄せる。表示言語は UI 設定に
// 追従させるべきで、どのリンクを踏んだかで決まるべきではないため。
const POLICY_DOC_LINK = /^(?:\.\.\/)+(DISCLAIMER|PRIVACY|SECURITY)(?:_(?:en|zh-TW))?\.md$/;
// マニュアル内リンクの href を marked のレンダリング時に解決する。
// `#アンカー`・`rewriteLinks` 済みの `/manual/...` はアプリ内遷移のためそのまま。
// `http(s)://` は外部リンク。条文は上記のとおりアプリ内へ。
// それ以外（`../../CONTRIBUTING.md`・原始碼等、開発者向けで同梱する意味がないもの）は
// GitHub 上の実体を指す絶対 URL に書き換え、外部リンク扱いにする。
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
// GitHub 互換の見出し slug。既存の章間 `#アンカー` リンクと一致させる必要があるため
// 小文字化・記号除去・空白→ハイフン・CJK 保持で揃える。
// 空白は 1 個ずつ '-' に置換（GitHub anchor と同形にするため、記号除去で生じた連続空白を潰さない）。
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
// h2 / h3 のみを章内目次として抽出する。コードブロック内は対象外。
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
// 全マニュアルを対象に大文字小文字を無視して全文検索する。索引（README）を先頭に章番号順。
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
