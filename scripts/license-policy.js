// 新しい種別は人が確かめてから足す。表記の揺れも別の種別として扱い、見落としを防ぐ。
export const ALLOWED_LICENSES = [
  'MIT',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-2-Clause（Leptonica 独自の文面）',
  'MIT License（本文から判定）',
  'OFL-1.1',
];

export function disallowedLicenses(entries) {
  return entries.filter((e) => !ALLOWED_LICENSES.includes(e.license));
}
