import { describe, expect, test } from 'vitest';
import { arApDisplayDescription } from './ar-ap-description';

const ID = '3f2a9c1e-5b7d-4e8a-9c0f-1a2b3c4d5e6f';
const vendors = new Map([[ID, { name: '株式会社テスト' }]]);

describe('arApDisplayDescription', () => {
  test('旧形式（番号（取引先 ID））は取引先名に置き換える', () => {
    expect(arApDisplayDescription({ description: `INV-2026-0001（${ID}）` }, vendors)).toBe(
      'INV-2026-0001（株式会社テスト）',
    );
  });

  test('取引先が見つからなければ番号だけを返し、ID は出さない', () => {
    expect(arApDisplayDescription({ description: `INV-2026-0001（${ID}）` }, new Map())).toBe(
      'INV-2026-0001',
    );
  });

  test('ID が大文字でも解決する', () => {
    expect(
      arApDisplayDescription({ description: `INV-2026-0001（${ID.toUpperCase()}）` }, vendors),
    ).toBe('INV-2026-0001（株式会社テスト）');
  });

  test('新形式と手入力の摘要はそのまま返す', () => {
    expect(
      arApDisplayDescription({ description: 'INV-2026-0002（株式会社テスト）' }, vendors),
    ).toBe('INV-2026-0002（株式会社テスト）');
    expect(arApDisplayDescription({ description: '家賃（4月分）' }, vendors)).toBe('家賃（4月分）');
  });
});
