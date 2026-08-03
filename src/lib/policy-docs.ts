import type { Locale } from '../paraglide/runtime';
import { baseLocale, locales } from '../paraglide/runtime';

export const POLICY_DOC_NAMES = ['DISCLAIMER', 'PRIVACY', 'SECURITY'] as const;

export type PolicyDocName = (typeof POLICY_DOC_NAMES)[number];
// manual.ts の eager glob（全マニュアル章）とは切り離す。DisclaimerConsent は
// 初回起動時に必ず描画されるため、そちらを import すると全章分がバンドルへ混入する。
const modules = import.meta.glob(
  ['../../DISCLAIMER*.md', '../../PRIVACY*.md', '../../SECURITY*.md'],
  { query: '?raw', import: 'default', eager: true },
) as Record<string, string>;
// ロケール接尾辞付きファイル名（例 `PRIVACY_en.md`）から slug と locale を切り出す。
// manual.ts の章ファイルとも共通の命名規則のため、ここに置いて両者から使う。
function parseFilename(path: string): { slug: string; locale: Locale } {
  const base = (path.split('/').pop() ?? '').replace(/\.md$/, '');
  for (const loc of locales) {
    if (loc === baseLocale) {
      continue;
    }
    const suffix = `_${loc}`;
    if (base.endsWith(suffix)) {
      return { slug: base.slice(0, -suffix.length), locale: loc };
    }
  }
  return { slug: base, locale: baseLocale };
}
// import.meta.glob の結果を slug → locale → 本文 のレジストリへ組み立てる。
export function buildLocaleRegistry<K extends string = string>(
  modules: Record<string, string>,
): Map<K, Map<Locale, string>> {
  const registry = new Map<K, Map<Locale, string>>();
  for (const [path, content] of Object.entries(modules)) {
    const { slug, locale } = parseFilename(path);
    let byLocale = registry.get(slug as K);
    if (!byLocale) {
      byLocale = new Map();
      registry.set(slug as K, byLocale);
    }
    byLocale.set(locale, content);
  }
  return registry;
}

const registry = buildLocaleRegistry<PolicyDocName>(modules);
// 各文書冒頭の言語切替行（GitHub 閲覧用）はアプリ内では言語設定に追従するため不要。
export function stripLanguageNav(markdown: string): string {
  return markdown.replace(/^\*\*Language\*\*:.*$\n?/m, '');
}

export function getPolicyDoc(doc: PolicyDocName, locale: Locale): string {
  const byLocale = registry.get(doc);
  const content = byLocale?.get(locale) ?? byLocale?.get(baseLocale) ?? '';
  return stripLanguageNav(content);
}
// manual.ts の resolveManualLink とも共通の外部リンク判定。
export function isExternalLink(href: string): boolean {
  return /^https?:\/\//.test(href);
}

export interface ResolvedPolicyLink {
  href: string;
  external: boolean;
}
// 文書内リンクの href を marked のレンダリング時に解決する。http(s) は外部リンクとして
// 新規タブで開く。それ以外（例 DISCLAIMER.md 内の [LICENSE](LICENSE)）はこのビューアの
// スコープ外の文書を指すため、リンクを解決できない旨を external: false で伝える
// （呼出側はリンクを外してテキストのみ残す）。
export function resolvePolicyLink(href: string): ResolvedPolicyLink {
  if (isExternalLink(href)) {
    return { href, external: true };
  }
  return { href, external: false };
}
// LICENSE は年号や字下げを保つ固定書式のプレーンテキストであり、他文書のような
// マークダウンではない。翻訳もない（単一言語で配布される著作権文書のため）。
// メタ文字の無い literal パスは picomatch がパターンとして受け付けないため、
// マッチ対象を LICENSE 1 件だけに絞ったうえで glob 形式にする。
const licenseModules = import.meta.glob('../../LICENSE*', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

export function getLicenseText(): string {
  return Object.values(licenseModules)[0] ?? '';
}
