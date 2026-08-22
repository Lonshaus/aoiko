import { afterEach, describe, expect, test, vi } from 'vitest';
import { createNativeReceiptExtractor } from './native-engine';

const IMAGE = { base64: 'QUJD', mimeType: 'image/png' };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('createNativeReceiptExtractor', () => {
  test('engine ラベルと送信先（端末外に出ない）', () => {
    const extractor = createNativeReceiptExtractor();
    expect(extractor.engine).toBe('native');
    expect(extractor.external).toBe(false);
    expect(extractor.destinationHost).toBe('');
  });

  test('返ってきた素のテキストを確定性抽出へ渡す', async () => {
    const recognizeText = vi.fn(async () => '2026/08/21\n登録番号 T1234567890123\n合計 1,500円');
    vi.stubGlobal('window', { __aoikoNative: { recognizeText } });
    const result = await createNativeReceiptExtractor().extract(IMAGE);
    expect(recognizeText).toHaveBeenCalledWith('QUJD');
    expect(result.date).toBe('2026-08-21');
    expect(result.totalAmount).toBe('1500');
    expect(result.invoiceNumber).toBe('T1234567890123');
  });

  // 設定はバックアップに乗って別の端末へ渡る。落とさずに下の LLM へ流れると、
  // 端末内で読むつもりの画像が外へ出る。
  test('橋渡しが無ければ拒否する', async () => {
    vi.stubGlobal('window', {});
    await expect(createNativeReceiptExtractor().extract(IMAGE)).rejects.toThrow();
  });

  test('橋渡しはあっても文字認識が無ければ拒否する', async () => {
    vi.stubGlobal('window', { __aoikoNative: { saveFile: async () => true } });
    await expect(createNativeReceiptExtractor().extract(IMAGE)).rejects.toThrow();
  });
});
