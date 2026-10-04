import { describe, expect, test } from 'vitest';
import { extractReceipt, buildOcrPrompt } from './ocr';
import { todayISO } from '../lib/date';
import type { LlmAdapter } from './llm';

function fakeAdapter(response: unknown): LlmAdapter {
  return {
    external: false,
    destinationHost: '',
    generateJson: async () => response,
  };
}

describe('buildOcrPrompt', () => {
  test('特定の項目を持つ JSON 出力を求める', () => {
    const p = buildOcrPrompt();
    expect(p).toContain('date');
    expect(p).toContain('vendorName');
    expect(p).toContain('totalAmount');
    expect(p).toContain('YYYY-MM-DD');
  });
});

describe('extractReceipt', () => {
  test('正しい形式の応答を解析する', async () => {
    const adapter = fakeAdapter({
      date: '2026-05-08',
      vendorName: 'ローソン',
      totalAmount: '350',
      items: [
        { description: 'おにぎり', amount: '120' },
        { description: 'コーヒー', amount: '230' },
      ],
      taxAmount: '32',
      taxRate: 0.1,
    });
    const r = await extractReceipt(adapter, { base64: 'x', mimeType: 'image/jpeg' });
    expect(r.date).toBe('2026-05-08');
    expect(r.vendorName).toBe('ローソン');
    expect(r.totalAmount).toBe('350');
    expect(r.items).toHaveLength(2);
    expect(r.taxAmount).toBe('32');
    expect(r.taxRate).toBe(0.1);
  });

  test('カンマと円記号の付いた金額を整える', async () => {
    const adapter = fakeAdapter({
      date: '2026-05-08',
      vendorName: '紀伊國屋',
      totalAmount: '￥2,200',
      items: [],
    });
    const r = await extractReceipt(adapter, { base64: 'x', mimeType: 'image/jpeg' });
    expect(r.totalAmount).toBe('2200');
  });

  test('日付が無ければ今日を使う', async () => {
    const adapter = fakeAdapter({
      date: '',
      vendorName: 'X',
      totalAmount: '100',
      items: [],
    });
    const r = await extractReceipt(adapter, { base64: 'x', mimeType: 'image/jpeg' });
    expect(r.date).toBe(todayISO());
  });

  test('日付が YYYY-MM-DD でなければ今日を使う', async () => {
    const adapter = fakeAdapter({
      date: '2026年5月8日',
      vendorName: 'X',
      totalAmount: '100',
      items: [],
    });
    const r = await extractReceipt(adapter, { base64: 'x', mimeType: 'image/jpeg' });
    expect(r.date).toBe(todayISO());
  });

  test('金額が不正な品目は飛ばす', async () => {
    const adapter = fakeAdapter({
      date: '2026-05-08',
      vendorName: 'X',
      totalAmount: '500',
      items: [
        { description: '正常', amount: '500' },
        { description: '壊れた', amount: 'abc' },
        { description: '空', amount: '' },
      ],
    });
    const r = await extractReceipt(adapter, { base64: 'x', mimeType: 'image/jpeg' });
    expect(r.items).toHaveLength(1);
    expect(r.items[0]?.description).toBe('正常');
  });

  test('登録番号の形式を検証する', async () => {
    const valid = fakeAdapter({
      date: '2026-05-08',
      vendorName: 'X',
      totalAmount: '100',
      items: [],
      invoiceNumber: 'T1234567890123',
    });
    const r1 = await extractReceipt(valid, { base64: 'x', mimeType: 'image/jpeg' });
    expect(r1.invoiceNumber).toBe('T1234567890123');

    const invalid = fakeAdapter({
      date: '2026-05-08',
      vendorName: 'X',
      totalAmount: '100',
      items: [],
      invoiceNumber: 'X12345',
    });
    const r2 = await extractReceipt(invalid, { base64: 'x', mimeType: 'image/jpeg' });
    expect(r2.invoiceNumber).toBeUndefined();
  });

  test('totalAmount を解析できなければ例外を投げる', async () => {
    const adapter = fakeAdapter({
      date: '2026-05-08',
      vendorName: 'X',
      totalAmount: 'invalid',
      items: [],
    });
    await expect(extractReceipt(adapter, { base64: 'x', mimeType: 'image/jpeg' })).rejects.toThrow(
      /合計金額/,
    );
  });

  test('taxRate を有効範囲に収める', async () => {
    const adapter = fakeAdapter({
      date: '2026-05-08',
      vendorName: 'X',
      totalAmount: '100',
      items: [],
      taxRate: 1.5,
    });
    const r = await extractReceipt(adapter, { base64: 'x', mimeType: 'image/jpeg' });
    expect(r.taxRate).toBeUndefined();
  });
});
