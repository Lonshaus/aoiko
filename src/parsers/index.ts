import type { CsvParser } from './types';

export type { CsvParser, ParsedTransaction, ParserEncoding } from './types';
export type { JsonParserConfig } from './json-config';
export { defineParser } from './json-config';
// Auto-discovery：./xxx.ts または ./xxx/xxx.ts に default export された CsvParser を全件収集する。
// 新しい parser を追加するには：
//   1. src/parsers/my-bank.ts（フラット）または src/parsers/my-bank/my-bank.ts（フォルダ、fixture 同梱）を作成、
//      `export default { ... satisfies CsvParser }` する
//   2. テスト + fixture を追加
//   3. PR を投げる
// _ で始まるファイル・フォルダ（_template など）は除外される。
const modules = import.meta.glob<{ default: CsvParser }>(
  [
    './**/*.ts',
    '!./_*/**',
    '!./**/_*.ts',
    '!./**/*.test.ts',
    '!./index.ts',
    '!./types.ts',
    '!./json-config.ts',
    '!./_helpers.ts',
  ],
  { eager: true },
);

function isCsvParser(obj: unknown): obj is CsvParser {
  if (!obj || typeof obj !== 'object') {
    return false;
  }
  const p = obj as Partial<CsvParser>;
  return (
    typeof p.name === 'string' &&
    typeof p.displayName === 'string' &&
    typeof p.accountCode === 'string' &&
    (p.encoding === 'utf-8' || p.encoding === 'shift_jis') &&
    typeof p.parse === 'function'
  );
}

const discovered: CsvParser[] = [];
for (const [path, mod] of Object.entries(modules)) {
  const candidate = mod.default;
  if (isCsvParser(candidate)) {
    discovered.push(candidate);
  } else {
    // 開発時に型ミスマッチをすぐ気付けるよう警告（型定義違反の parser を放置しない）
    if (typeof console !== 'undefined') {
      console.warn(`[parsers] ${path}: default export が CsvParser 形式ではありません`);
    }
  }
}
// 銀行 → カード → 電子マネー の順で並べる。同種は displayName 50 音順
const KIND_ORDER: Record<string, number> = {
  '1110': 0,
  '1120': 0,
  '1130': 0,
  '1140': 0, // 預金
  '2120': 1, // 未払金（カード）
};

export const PARSERS: readonly CsvParser[] = discovered.sort((a, b) => {
  const ka = KIND_ORDER[a.accountCode] ?? 9;
  const kb = KIND_ORDER[b.accountCode] ?? 9;
  if (ka !== kb) {
    return ka - kb;
  }
  return a.displayName.localeCompare(b.displayName, 'ja');
});

export function findParser(name: string): CsvParser | undefined {
  return PARSERS.find((p) => p.name === name);
}
