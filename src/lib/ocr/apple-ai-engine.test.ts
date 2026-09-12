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
    [5, 'timed out'],
    [6, 'previous request still running'],
    [7, 'input too large'],
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

describe('appleAiAvailability', () => {
  test.each([
    [1, '対応していません'],
    [2, '有効になっていません'],
    [3, '準備中です'],
    [4, 'AI 抽出を使えません'],
    [5, '確認できませんでした'],
  ])('code %i は専用の文言で拒否し extract コード2の文言にはならない', async (code, text) => {
    vi.stubGlobal('window', {
      __aoikoNative: {
        appleAiAvailability: vi.fn(async () => code),
        appleAiExtract: vi.fn(async () => receipt()),
      },
    });
    const error = await createAppleAiReceiptExtractor()
      .extract(IMAGE)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(new RegExp(text));
    expect((error as Error).message).not.toMatch(/読み取れませんでした/);
  });

  test('code 0 は抽出へ進む', async () => {
    const appleAiExtract = vi.fn(async () => receipt());
    vi.stubGlobal('window', {
      __aoikoNative: { appleAiAvailability: vi.fn(async () => 0), appleAiExtract },
    });
    const result = await createAppleAiReceiptExtractor().extract(IMAGE);
    expect(appleAiExtract).toHaveBeenCalled();
    expect(result.vendorName).toBe('あおい商店');
  });

  test('橋渡しに appleAiAvailability が無ければ抽出へ進む', async () => {
    const appleAiExtract = vi.fn(async () => receipt());
    vi.stubGlobal('window', { __aoikoNative: { appleAiExtract } });
    const result = await createAppleAiReceiptExtractor().extract(IMAGE);
    expect(result.vendorName).toBe('あおい商店');
  });

  test('appleAiAvailability が reject しても抽出へ進む', async () => {
    const appleAiExtract = vi.fn(async () => receipt());
    vi.stubGlobal('window', {
      __aoikoNative: {
        appleAiAvailability: vi.fn(async () => {
          throw 'permission denied';
        }),
        appleAiExtract,
      },
    });
    const result = await createAppleAiReceiptExtractor().extract(IMAGE);
    expect(result.vendorName).toBe('あおい商店');
  });

  test('1..5 の外の値は「確認できない」文言に丸める', async () => {
    vi.stubGlobal('window', {
      __aoikoNative: {
        appleAiAvailability: vi.fn(async () => 7),
        appleAiExtract: vi.fn(async () => receipt()),
      },
    });
    await expect(createAppleAiReceiptExtractor().extract(IMAGE)).rejects.toThrow(
      /確認できませんでした/,
    );
  });
});

describe('インボイス番号の先頭 T 補修', () => {
  test('T 付きはそのまま', async () => {
    vi.stubGlobal('window', {
      __aoikoNative: { appleAiExtract: async () => receipt({ invoiceNumber: 'T1234567890123' }) },
    });
    const result = await createAppleAiReceiptExtractor().extract(IMAGE);
    expect(result.invoiceNumber).toBe('T1234567890123');
  });

  test('T が落ちていれば補う', async () => {
    vi.stubGlobal('window', {
      __aoikoNative: { appleAiExtract: async () => receipt({ invoiceNumber: '1234567890123' }) },
    });
    const result = await createAppleAiReceiptExtractor().extract(IMAGE);
    expect(result.invoiceNumber).toBe('T1234567890123');
  });

  test('桁数が違えば補わず落とす', async () => {
    vi.stubGlobal('window', {
      __aoikoNative: { appleAiExtract: async () => receipt({ invoiceNumber: '12345' }) },
    });
    const result = await createAppleAiReceiptExtractor().extract(IMAGE);
    expect(result).not.toHaveProperty('invoiceNumber');
  });
});

describe('ネイティブ JSON の防御', () => {
  test('items が配列でなければ拒否する', async () => {
    vi.stubGlobal('window', {
      __aoikoNative: {
        appleAiExtract: async () =>
          JSON.stringify({
            vendor: 'あおい商店',
            date: '2026-08-21',
            total: '1500',
            invoiceNumber: '',
            amount8: '',
            amount10: '1500',
            items: 'お茶',
          }),
      },
    });
    await expect(createAppleAiReceiptExtractor().extract(IMAGE)).rejects.toThrow(
      /抽出に失敗しました/,
    );
  });

  test('JSON が壊れていれば拒否する', async () => {
    vi.stubGlobal('window', {
      __aoikoNative: { appleAiExtract: async () => '{not json' },
    });
    await expect(createAppleAiReceiptExtractor().extract(IMAGE)).rejects.toThrow(
      /抽出に失敗しました/,
    );
  });
});

function expectedMessageFor(code: number): RegExp {
  const texts: Record<number, string> = {
    1: '分けて読み取ってみてください',
    2: '読み取れませんでした',
    3: '抽出に失敗しました',
    4: 'AI 抽出を使えません',
    5: '時間内に読み取れませんでした',
    6: 'まだ終わっていません',
    7: '大きすぎて処理できません',
  };
  return new RegExp(texts[code] ?? '');
}
