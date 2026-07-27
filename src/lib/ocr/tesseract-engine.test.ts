import { afterEach, describe, expect, test, vi } from 'vitest';

const recognize = vi.fn(
  async (_image: string, _lang: string, _options: Record<string, unknown>) => ({
    data: { text: '合計 1,500円' },
  }),
);

vi.mock('tesseract.js', () => ({ recognize }));

afterEach(() => {
  recognize.mockClear();
});

async function runExtract(langPath?: string) {
  const { createTesseractReceiptExtractor } = await import('./tesseract-engine');
  const extractor = createTesseractReceiptExtractor(langPath);
  await extractor.extract({ base64: 'QUJD', mimeType: 'image/png' });
  return recognize.mock.calls[0] as unknown as [string, string, Record<string, unknown>];
}

describe('createTesseractReceiptExtractor', () => {
  test('engine ラベルと送信先（端末外に出ない）', async () => {
    const { createTesseractReceiptExtractor } = await import('./tesseract-engine');
    const extractor = createTesseractReceiptExtractor();
    expect(extractor.engine).toBe('tesseract');
    expect(extractor.external).toBe(false);
    expect(extractor.destinationHost).toBe('');
  });
  // 既定値のままだと worker とコアを jsDelivr から importScripts しようとして
  // CSP（script-src に外部オリジン無し）にブロックされるため、自己ホストを渡す。
  test('worker とコアは同一オリジンの自己ホストパスを渡す', async () => {
    const [, , options] = await runExtract();
    expect(options.workerPath).toBe('/tesseract/worker.min.js');
    expect(options.corePath).toBe('/tesseract/core');
  });

  // 既定のままだと traineddata を jsDelivr から取りに行き、オフライン運用も
  // 「端末外に出ない」という説明も成立しなくなるため、同梱分を指す。
  test('langPath 未指定なら同梱した traineddata を指す', async () => {
    const [, , options] = await runExtract();
    expect(options.langPath).toBe('/tesseract/lang');
  });

  test('langPath 指定時はそのまま渡す（別の取得元を使いたい場合）', async () => {
    const [, , options] = await runExtract('https://example.test/tessdata');
    expect(options.langPath).toBe('https://example.test/tessdata');
  });

  test('画像は data URL にして jpn+eng で認識する', async () => {
    const [image, lang] = await runExtract();
    expect(image).toBe('data:image/png;base64,QUJD');
    expect(lang).toBe('jpn+eng');
  });

  test('認識テキストは構造化して返す', async () => {
    const { createTesseractReceiptExtractor } = await import('./tesseract-engine');
    const result = await createTesseractReceiptExtractor().extract({
      base64: 'QUJD',
      mimeType: 'image/png',
    });
    expect(result.totalAmount).toBe('1500');
  });
});
