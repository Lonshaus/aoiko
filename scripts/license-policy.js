// 新しい種別は人が確かめてから足す。表記の揺れも別の種別として扱い、見落としを防ぐ。
export const ALLOWED_LICENSES = [
  'MIT',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-2-Clause（Leptonica 独自の文面）',
  'MIT License（本文から判定）',
  'OFL-1.1',
];
// ネイティブ版のクレートが宣言するライセンスの表記。cargo metadata の license 欄を一覧に出す文字列のまま照合する。
export const ALLOWED_NATIVE_LICENSES = [
  '(Apache-2.0 OR MIT) AND BSD-3-Clause',
  '(MIT OR Apache-2.0) AND Unicode-3.0',
  '0BSD OR MIT OR Apache-2.0',
  'Apache-2.0',
  'Apache-2.0 / MIT',
  'Apache-2.0 AND MIT',
  'Apache-2.0 OR BSL-1.0',
  'Apache-2.0 OR MIT',
  'Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT',
  'Apache-2.0（aoiko 用に修正：src-tauri/patches/tao/MODIFICATIONS.md）',
  'Apache-2.0/MIT',
  'BSD-3-Clause',
  'BSD-3-Clause AND MIT',
  'BSD-3-Clause/MIT',
  'CC0-1.0 OR MIT-0 OR Apache-2.0',
  'MIT',
  'MIT OR Apache-2.0',
  'MIT OR Apache-2.0 OR Zlib',
  'MIT OR Zlib OR Apache-2.0',
  'MIT/Apache-2.0',
  'MPL-2.0',
  'Unicode-3.0',
  'Unlicense OR MIT',
  'Unlicense/MIT',
  'Zlib',
  'Zlib OR Apache-2.0 OR MIT',
];

export function disallowedLicenses(entries, allowed = ALLOWED_LICENSES) {
  return entries.filter((e) => !allowed.includes(e.license));
}
