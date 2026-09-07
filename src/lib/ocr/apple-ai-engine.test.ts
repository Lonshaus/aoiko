import { afterEach, describe, expect, test, vi } from 'vitest';
import { createAppleAiReceiptExtractor } from './apple-ai-engine';

const IMAGE = { base64: 'QUJD', mimeType: 'image/png' };

afterEach(() => {
  vi.unstubAllGlobals();
});

function receipt(overrides: Partial<Record<string, unknown>> = {}) {
  return JSON.stringify({
    vendor: 'あおい商店',
    date: '2026-08-21',
    total: '1500',
    invoiceNumber: 'T1234567890123',
    amount8: '',
    amount10: '1500',
    items: [{ name: 'お茶', amount: '150' }],
    ...overrides,
  });
}

describe('createAppleAiReceiptExtractor', () => {
  test('engine ラベルと送信先（端末外に出ない）', () => {
    const extractor = createAppleAiReceiptExtractor();
    expect(extractor.engine).toBe('apple-ai');
    expect(extractor.external).toBe(false);
    expect(extractor.destinationHost).toBe('');
  });

  test('ネイティブの JSON を ReceiptExtracted へ写す', async () => {
    const appleAiExtract = vi.fn(async () => receipt());
    vi.stubGlobal('window', { __aoikoNative: { appleAiExtract } });
    const result = await createAppleAiReceiptExtractor().extract(IMAGE);
    expect(appleAiExtract).toHaveBeenCalledWith('QUJD');
    expect(result).toEqual({
      date: '2026-08-21',
      vendorName: 'あおい商店',
      totalAmount: '1500',
      invoiceNumber: 'T1234567890123',
      items: [{ description: 'お茶', amount: '150' }],
    });
  });

  test('空文字は optional フィールドとして渡さない', async () => {
    vi.stubGlobal('window', {
      __aoikoNative: {
        appleAiExtract: async () =>
          receipt({ invoiceNumber: '', amount8: '', amount10: '', items: [] }),
      },
    });
    const result = await createAppleAiReceiptExtractor().extract(IMAGE);
    expect(result).not.toHaveProperty('invoiceNumber');
    expect(result.items).toEqual([]);
  });

  test('片方だけ空の明細行は落とす', async () => {
    vi.stubGlobal('window', {
      __aoikoNative: {
        appleAiExtract: async () =>
          receipt({
            items: [
              { name: 'お茶', amount: '150' },
              { name: '', amount: '100' },
              { name: '謎の品', amount: '' },
            ],
          }),
      },
    });
    const result = await createAppleAiReceiptExtractor().extract(IMAGE);
    expect(result.items).toEqual([{ description: 'お茶', amount: '150' }]);
  });

  test('橋渡しが無ければ拒否する', async () => {
    vi.stubGlobal('window', {});
    await expect(createAppleAiReceiptExtractor().extract(IMAGE)).rejects.toThrow();
  });

  test('橋渡しはあっても抽出関数が無ければ拒否する', async () => {
    vi.stubGlobal('window', { __aoikoNative: { saveFile: async () => true } });
    await expect(createAppleAiReceiptExtractor().extract(IMAGE)).rejects.toThrow();
  });

  test.each([
    [1, 'context window exceeded'],
    [2, 'no text recognised'],
    [3, 'other failure'],
    [4, 'OS too old'],
  ])('エラーコード %i（%s）はコード別の文言で拒否する', async (code) => {
    vi.stubGlobal('window', {
      __aoikoNative: {
        appleAiExtract: vi.fn(async () => {
          throw code;
        }),
      },
    });
    await expect(createAppleAiReceiptExtractor().extract(IMAGE)).rejects.toThrow(
      expectedMessageFor(code),
    );
  });
});

function expectedMessageFor(code: number): RegExp {
  const texts: Record<number, string> = {
    1: '情報量が多すぎて',
    2: '読み取れませんでした',
    3: '抽出に失敗しました',
    4: 'AI 抽出を使えません',
  };
  return new RegExp(texts[code] ?? '');
}
