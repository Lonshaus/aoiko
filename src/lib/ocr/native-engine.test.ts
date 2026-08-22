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

  test('返ってきた版面を確定性抽出へ渡す', async () => {
    const recognizeText = vi.fn(async () => layout());
    vi.stubGlobal('window', { __aoikoNative: { recognizeText } });
    const result = await createNativeReceiptExtractor().extract(IMAGE);
    expect(recognizeText).toHaveBeenCalledWith('QUJD');
    expect(result.date).toBe('2026-08-21');
    expect(result.totalAmount).toBe('1500');
    expect(result.invoiceNumber).toBe('T1234567890123');
  });

  // 座標を素通しにすると店名が空のまま返る。ここが繋がっているかを見る。
  test('版面から店名も取り出す', async () => {
    vi.stubGlobal('window', { __aoikoNative: { recognizeText: async () => layout() } });
    const result = await createNativeReceiptExtractor().extract(IMAGE);
    expect(result.vendorName).toBe('あおい商店');
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

// 行の順は上から下。店名は頭でいちばん大きい行。
function layout() {
  const line = (text: string, y: number, height: number) => ({
    text,
    words: [{ text, x: 0.1, y, width: 0.5, height }],
    x: 0.1,
    y,
    width: 0.5,
    height,
  });
  const lines = [
    line('あおい商店', 0.02, 0.05),
    line('2026/08/21', 0.12, 0.02),
    line('登録番号 T1234567890123', 0.18, 0.02),
    line('合計 1,500円', 0.4, 0.02),
  ];
  return { lines, text: lines.map((l) => l.text).join('\n') };
}
