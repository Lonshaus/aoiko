import { describe, expect, test } from 'vitest';
import { extractReceipt } from '../../domain/ocr';
import { classifyWithLlm } from '../../domain/llm-classify';
import { parseOrderResponse } from '../../domain/order-extract';
import type { LlmAdapter } from '../../domain/llm';
import { CLASSIFY_SCHEMA } from './classify-schema';
import { ORDER_SCHEMA } from './order-schema';
import { RECEIPT_SCHEMA } from './receipt-schema';

// object schema のプロパティ集合を、fixture の全プロパティが含まれているか確かめる。
// schema からプロパティが抜けると responseConstraint がその欄を返さなくなるため、
// ここが赤くなる必要がある。
function assertAllowsProperties(schema: { properties: Record<string, unknown> }, obj: object) {
  for (const key of Object.keys(obj)) {
    expect(Object.keys(schema.properties), `schema に "${key}" が無い`).toContain(key);
  }
}

function stubAdapter(response: unknown): LlmAdapter {
  return {
    external: false,
    destinationHost: '',
    generateJson: async () => response,
  };
}

describe('RECEIPT_SCHEMA', () => {
  test('parseOcrResponse が受け取る全欄を許す', async () => {
    const fixture = {
      date: '2026-01-02',
      vendorName: '店名',
      totalAmount: '1000',
      items: [{ description: '品目', amount: '500' }],
      taxAmount: '100',
      taxRate: 0.1,
      invoiceNumber: 'T1234567890123',
      notes: '備考',
    };
    const result = await extractReceipt(stubAdapter(fixture), {
      base64: '',
      mimeType: 'image/jpeg',
    });
    expect(result).toEqual(fixture);

    assertAllowsProperties(RECEIPT_SCHEMA, fixture);
    const itemSchema = RECEIPT_SCHEMA.properties.items.items as {
      properties: Record<string, unknown>;
    };
    for (const item of fixture.items) {
      assertAllowsProperties(itemSchema, item);
    }
  });
});

describe('CLASSIFY_SCHEMA', () => {
  test('parseResponse が受け取る全欄を許す', async () => {
    const fixture = {
      classifications: [{ ref: 'r1', accountCode: '6110', confidence: 'high', reason: '理由' }],
    };
    const result = await classifyWithLlm(
      stubAdapter(fixture),
      [{ ref: 'r1', description: '摘要', amount: '1000' }],
      {
        knownAccountCode: '1010',
        knownSide: 'credit',
        candidateAccounts: [{ code: '6110', name: '通信費', category: 'expense' } as never],
      },
    );
    expect(result).toEqual([
      { ref: 'r1', accountCode: '6110', confidence: 'high', reason: '理由' },
    ]);

    const listSchema = CLASSIFY_SCHEMA.properties.classifications.items as {
      properties: Record<string, unknown>;
    };
    for (const c of fixture.classifications) {
      assertAllowsProperties(listSchema, c);
    }
  });
});

describe('ORDER_SCHEMA', () => {
  test('parseOrderResponse が受け取る全欄を許す', () => {
    const fixture = {
      date: '2026-05-03',
      vendor: 'Amazon.co.jp',
      orderNumber: '123-4567890',
      items: [{ description: 'USB-C ハブ', amount: '2580' }],
      totalAmount: '2580',
    };
    const result = parseOrderResponse(fixture);
    expect(result).toEqual(fixture);

    assertAllowsProperties(ORDER_SCHEMA, fixture);
    const itemSchema = ORDER_SCHEMA.properties.items.items as {
      properties: Record<string, unknown>;
    };
    for (const item of fixture.items) {
      assertAllowsProperties(itemSchema, item);
    }
  });
});
