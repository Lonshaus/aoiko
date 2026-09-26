import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { ACCOUNTS_2026, DEPRECIABLE_ASSET_ACCOUNTS, defaultAssetCategory } from './accounts';

describe('無形固定資産の科目', () => {
  test('1516 無形固定資産が displayOrder 516 で存在する', () => {
    const intangible = ACCOUNTS_2026.find((a) => a.code === '1516');
    expect(intangible).toMatchObject({
      name: '無形固定資産',
      category: 'asset',
      displayOrder: 516,
    });
  });

  test('科目コードは重複しない', () => {
    const codes = ACCOUNTS_2026.map((a) => a.code);
    expect(new Set(codes).size).toBe(codes.length);
  });
});

describe('固定資産の登録に使う科目', () => {
  test('選択肢はすべて ACCOUNTS_2026 に存在し、1516 を含み、土地と減価償却累計額を含まない', () => {
    const known = new Set(ACCOUNTS_2026.map((a) => a.code));
    const codes = DEPRECIABLE_ASSET_ACCOUNTS.map((a) => a.code);
    expect(codes.every((c) => known.has(c))).toBe(true);
    expect(codes).toEqual(['1510', '1511', '1512', '1513', '1514', '1516']);
  });

  test('設定画面・開業精霊の科目選択は科目表から作り、存在しないコードを書いていない', () => {
    for (const file of ['src/routes/Settings.svelte', 'src/routes/OpeningSetup.svelte']) {
      const text = readFileSync(file, 'utf8');
      expect(text, file).toContain('DEPRECIABLE_ASSET_ACCOUNTS');
      expect(text, file).not.toMatch(/<option value="15\d\d">/);
    }
  });

  test('科目から所令6条の号を推定する', () => {
    expect(defaultAssetCategory('1510')).toBe(7);
    expect(defaultAssetCategory('1511')).toBe(1);
    expect(defaultAssetCategory('1512')).toBe(1);
    expect(defaultAssetCategory('1514')).toBe(6);
    expect(defaultAssetCategory('1516')).toBe(8);
    expect(defaultAssetCategory('9999')).toBeUndefined();
  });
});
