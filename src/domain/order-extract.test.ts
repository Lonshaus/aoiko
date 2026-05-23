import { describe, expect, test } from 'vitest';
import { LlmError } from './llm';
import { buildOrderPrompt, parseOrderResponse } from './order-extract';

describe('buildOrderPrompt', () => {
  test('returns a non-empty JSON-instruction prompt', () => {
    const p = buildOrderPrompt();
    expect(p.length).toBeGreaterThan(100);
    expect(p).toContain('"date"');
    expect(p).toContain('"items"');
    expect(p).toContain('"totalAmount"');
  });
});

describe('parseOrderResponse', () => {
  test('正常ケース：date / vendor / orderNumber / items / total を返す', () => {
    const r = parseOrderResponse({
      date: '2026-05-03',
      vendor: 'Amazon.co.jp',
      orderNumber: '250-1234567-1234567',
      items: [
        { description: 'USB-C ハブ', amount: '2580' },
        { description: '配送料', amount: '420' },
      ],
      totalAmount: '3000',
    });
    expect(r.date).toBe('2026-05-03');
    expect(r.vendor).toBe('Amazon.co.jp');
    expect(r.orderNumber).toBe('250-1234567-1234567');
    expect(r.items).toHaveLength(2);
    expect(r.items[0]).toEqual({ description: 'USB-C ハブ', amount: '2580' });
    expect(r.items[1]).toEqual({ description: '配送料', amount: '420' });
    expect(r.totalAmount).toBe('3000');
  });

  test('orderNumber 無しは undefined（空文字でもキー無しでも）', () => {
    expect(
      parseOrderResponse({
        date: '2026-05-03',
        vendor: 'X',
        orderNumber: '',
        items: [{ description: 'a', amount: '100' }],
        totalAmount: '100',
      }).orderNumber
    ).toBeUndefined();

    expect(
      parseOrderResponse({
        date: '2026-05-03',
        vendor: 'X',
        items: [{ description: 'a', amount: '100' }],
        totalAmount: '100',
      }).orderNumber
    ).toBeUndefined();
  });

  test('値引行は負値 amount をそのまま保持', () => {
    const r = parseOrderResponse({
      date: '2026-05-03',
      vendor: '楽天市場',
      items: [
        { description: '商品 A', amount: '3000' },
        { description: 'クーポン値引', amount: '-500' },
      ],
      totalAmount: '2500',
    });
    expect(r.items[1]?.amount).toBe('-500');
  });

  test('金額のカンマ・通貨記号を除去して整数化', () => {
    const r = parseOrderResponse({
      date: '2026-05-03',
      vendor: 'X',
      items: [{ description: 'a', amount: '¥1,234' }],
      totalAmount: '￥1,234',
    });
    expect(r.items[0]?.amount).toBe('1234');
    expect(r.totalAmount).toBe('1234');
  });

  test('description / amount 不正の item はスキップ', () => {
    const r = parseOrderResponse({
      date: '2026-05-03',
      vendor: 'X',
      items: [
        { description: '正常', amount: '100' },
        { description: '', amount: '50' },
        { description: '金額不正', amount: 'abc' },
        null,
        { description: 'もう一個正常', amount: '200' },
      ],
      totalAmount: '300',
    });
    expect(r.items).toHaveLength(2);
    expect(r.items[0]?.description).toBe('正常');
    expect(r.items[1]?.description).toBe('もう一個正常');
  });

  test('totalAmount 取れない時は LlmError', () => {
    expect(() =>
      parseOrderResponse({
        date: '2026-05-03',
        vendor: 'X',
        items: [{ description: 'a', amount: '100' }],
        totalAmount: '',
      })
    ).toThrow(LlmError);
  });

  test('items が空 / 1 件も抽出できない時は LlmError', () => {
    expect(() =>
      parseOrderResponse({
        date: '2026-05-03',
        vendor: 'X',
        items: [],
        totalAmount: '100',
      })
    ).toThrow(LlmError);

    expect(() =>
      parseOrderResponse({
        date: '2026-05-03',
        vendor: 'X',
        items: [{ description: '', amount: '50' }],
        totalAmount: '100',
      })
    ).toThrow(LlmError);
  });

  test('null / 非オブジェクトは LlmError', () => {
    expect(() => parseOrderResponse(null)).toThrow(LlmError);
    expect(() => parseOrderResponse('string')).toThrow(LlmError);
    expect(() => parseOrderResponse(42)).toThrow(LlmError);
  });

  test('date / vendor 欠落は空文字に降格（throw しない）', () => {
    const r = parseOrderResponse({
      items: [{ description: 'a', amount: '100' }],
      totalAmount: '100',
    });
    expect(r.date).toBe('');
    expect(r.vendor).toBe('');
  });
});