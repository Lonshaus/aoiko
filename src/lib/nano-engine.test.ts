import { afterEach, describe, expect, test, vi } from 'vitest';
import { NanoAdapter, createNanoAdapter, createNanoReceiptExtractor } from './nano-engine';

const IMAGE = { base64: 'QUJD', mimeType: 'image/png' };

afterEach(() => {
  vi.unstubAllGlobals();
});

function receipt(overrides: Partial<Record<string, unknown>> = {}) {
  return JSON.stringify({
    date: '2026-08-21',
    vendorName: 'あおい商店',
    totalAmount: '1500',
    invoiceNumber: 'T1234567890123',
    taxAmount: '150',
    items: [{ description: 'お茶', amount: '150' }],
    ...overrides,
  });
}
// 9 つの既知コードそれぞれで別の文言になること。集合の所属で判定するため、
// 既知コード以外の文字列は拒否コードとして扱わずフォールバックへ回る（区別できる形で確認）。
const REJECT_CASES: Array<[string, RegExp]> = [
  ['unavailable', /使えない状態/],
  ['too-long', /情報量が多すぎて/],
  ['busy', /混み合っています/],
  ['background', /バックグラウンドになったため/],
  ['quota', /利用上限に達しました/],
  ['bad-input', /入力データを処理できませんでした/],
  ['unsupported-account', /端末内 AI では分類できません/],
  ['unsupported', /Android でのみ使えます/],
  ['failed', /処理に失敗しました/],
];

describe('NanoAdapter', () => {
  test('external=false・destinationHost 空（端末外に出ない）', () => {
    const adapter = createNanoAdapter();
    expect(adapter.external).toBe(false);
    expect(adapter.destinationHost).toBe('');
  });

  test('プロンプト経由は拒否する（指示を上書きできる口を作らない）', async () => {
    const adapter = new NanoAdapter();
    await expect(adapter.generateJson('何か')).rejects.toThrow();
  });

  test('runDataTask：task と data をそのまま渡す', async () => {
    const nanoRun = vi.fn(async () => '{"classifications":[]}');
    vi.stubGlobal('window', { __aoikoNative: { nanoRun } });
    const adapter = new NanoAdapter();
    const result = await adapter.runDataTask('classify', { transactions: [] });
    expect(nanoRun).toHaveBeenCalledWith('classify', '{"transactions":[]}');
    expect(result).toEqual({ classifications: [] });
  });

  test('橋渡しが無ければ拒否する（fetch は呼ばれない）', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    vi.stubGlobal('window', {});
    const adapter = new NanoAdapter();
    await expect(adapter.runDataTask('classify', {})).rejects.toThrow();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test('ネイティブから JSON でない文字列が返ったら拒否する', async () => {
    vi.stubGlobal('window', {
      __aoikoNative: { nanoRun: async () => 'not json' },
    });
    const adapter = new NanoAdapter();
    await expect(adapter.runDataTask('classify', {})).rejects.toThrow();
  });

  test.each(REJECT_CASES)(
    '拒否コード %s は他の 8 種と区別できる文言になり、fetch は呼ばれず GeminiAdapter/OpenAICompatibleAdapter も作られない',
    async (code, expected) => {
      const fetchSpy = vi.fn();
      vi.stubGlobal('fetch', fetchSpy);
      vi.stubGlobal('window', {
        __aoikoNative: {
          nanoRun: vi.fn(async () => {
            throw code;
          }),
        },
      });
      // NanoAdapter は runDataTask の中で GeminiAdapter/OpenAICompatibleAdapter を
      // 一切参照しない（クラウドへ差し替えない）。fetch が呼ばれないことがその証拠になる。
      const adapter = new NanoAdapter();
      await expect(adapter.runDataTask('classify', {})).rejects.toThrow(expected);
      expect(fetchSpy).not.toHaveBeenCalled();
    },
  );

  test('未知の文字列での拒否はフォールバックの文言になり、9 種のどれとも一致しない', async () => {
    vi.stubGlobal('window', {
      __aoikoNative: {
        nanoRun: vi.fn(async () => {
          throw 'plugin:aoiko-native.nano_run not allowed';
        }),
      },
    });
    const adapter = new NanoAdapter();
    await expect(adapter.runDataTask('classify', {})).rejects.toThrow(/呼び出せませんでした/);
    for (const [, expected] of REJECT_CASES) {
      await expect(adapter.runDataTask('classify', {})).rejects.not.toThrow(expected);
    }
  });
});

describe('createNanoReceiptExtractor', () => {
  test('engine ラベルと送信先（端末外に出ない）', () => {
    const extractor = createNanoReceiptExtractor();
    expect(extractor.engine).toBe('nano');
    expect(extractor.external).toBe(false);
    expect(extractor.destinationHost).toBe('');
    expect(extractor.downscale).toBe(false);
  });

  test('ネイティブの JSON を ReceiptExtracted へ写す', async () => {
    const nanoExtractReceipt = vi.fn(async () => receipt());
    vi.stubGlobal('window', { __aoikoNative: { nanoExtractReceipt } });
    const result = await createNanoReceiptExtractor().extract(IMAGE);
    expect(nanoExtractReceipt).toHaveBeenCalledWith('QUJD');
    expect(result).toEqual({
      date: '2026-08-21',
      vendorName: 'あおい商店',
      totalAmount: '1500',
      invoiceNumber: 'T1234567890123',
      taxAmount: '150',
      items: [{ description: 'お茶', amount: '150' }],
    });
  });

  test('空文字は optional フィールドとして渡さない', async () => {
    vi.stubGlobal('window', {
      __aoikoNative: {
        nanoExtractReceipt: async () => receipt({ invoiceNumber: '', taxAmount: '', items: [] }),
      },
    });
    const result = await createNanoReceiptExtractor().extract(IMAGE);
    expect(result).not.toHaveProperty('invoiceNumber');
    expect(result).not.toHaveProperty('taxAmount');
    expect(result.items).toEqual([]);
  });

  test('片方だけ空の明細行は落とす', async () => {
    vi.stubGlobal('window', {
      __aoikoNative: {
        nanoExtractReceipt: async () =>
          receipt({
            items: [
              { description: 'お茶', amount: '150' },
              { description: '', amount: '100' },
              { description: '謎の品', amount: '' },
            ],
          }),
      },
    });
    const result = await createNanoReceiptExtractor().extract(IMAGE);
    expect(result.items).toEqual([{ description: 'お茶', amount: '150' }]);
  });

  test('橋渡しが無ければ拒否する', async () => {
    vi.stubGlobal('window', {});
    await expect(createNanoReceiptExtractor().extract(IMAGE)).rejects.toThrow();
  });

  test('橋渡しはあっても抽出関数が無ければ拒否する', async () => {
    vi.stubGlobal('window', { __aoikoNative: { saveFile: async () => true } });
    await expect(createNanoReceiptExtractor().extract(IMAGE)).rejects.toThrow();
  });

  test.each(REJECT_CASES)('拒否コード %s はコード別の文言で拒否する', async (code, expected) => {
    vi.stubGlobal('window', {
      __aoikoNative: {
        nanoExtractReceipt: vi.fn(async () => {
          throw code;
        }),
      },
    });
    await expect(createNanoReceiptExtractor().extract(IMAGE)).rejects.toThrow(expected);
  });

  test('items が配列でなければ拒否する', async () => {
    vi.stubGlobal('window', {
      __aoikoNative: {
        nanoExtractReceipt: async () =>
          JSON.stringify({
            date: '2026-08-21',
            vendorName: 'あおい商店',
            totalAmount: '1500',
            items: 'お茶',
          }),
      },
    });
    await expect(createNanoReceiptExtractor().extract(IMAGE)).rejects.toThrow();
  });

  test('JSON が壊れていれば拒否する', async () => {
    vi.stubGlobal('window', {
      __aoikoNative: { nanoExtractReceipt: async () => '{not json' },
    });
    await expect(createNanoReceiptExtractor().extract(IMAGE)).rejects.toThrow();
  });
});
