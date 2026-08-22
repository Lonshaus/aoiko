import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const loadModel = vi.fn(async (_model: string) => {});
const loadImage = vi.fn(async (_image: unknown) => {});
const getText = vi.fn(async () => '合計 1,500円');
const destroy = vi.fn(async () => {});
const constructed: { workerURL?: string }[] = [];

vi.mock('tesseract-wasm', () => ({
  OCRClient: class {
    constructor(init: { workerURL?: string }) {
      constructed.push(init);
    }
    loadModel = loadModel;
    loadImage = loadImage;
    getText = getText;
    destroy = destroy;
  },
}));

const close = vi.fn();
const createImageBitmap = vi.fn(async (blob: Blob) => ({ blob, close }));

beforeEach(() => {
  vi.stubGlobal('createImageBitmap', createImageBitmap);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  constructed.length = 0;
});

async function extract(image = { base64: 'QUJD', mimeType: 'image/png' }) {
  const { createTesseractReceiptExtractor } = await import('./tesseract-engine');
  return createTesseractReceiptExtractor().extract(image);
}

describe('createTesseractReceiptExtractor', () => {
  test('engine ラベルと送信先（端末外に出ない）', async () => {
    const { createTesseractReceiptExtractor } = await import('./tesseract-engine');
    const extractor = createTesseractReceiptExtractor();
    expect(extractor.engine).toBe('tesseract');
    expect(extractor.external).toBe(false);
    expect(extractor.destinationHost).toBe('');
  });

  // 外部オリジンを指すと wrapper 版の CSP（connect-src 'self'）で必ず失敗する。
  test('worker とモデルは同一オリジンの自己ホストパスを使う', async () => {
    await extract();
    expect(constructed[0]?.workerURL).toBe('/tesseract/tesseract-worker.js');
    expect(loadModel).toHaveBeenCalledWith('/tesseract/jpn.traineddata');
  });

  test('base64 は Blob へ復号してから ImageBitmap にする', async () => {
    await extract();
    const blob = createImageBitmap.mock.calls[0]?.[0];
    expect(blob?.type).toBe('image/png');
    expect(await blob?.text()).toBe('ABC');
    expect(loadImage).toHaveBeenCalledWith(await createImageBitmap.mock.results[0]?.value);
  });

  test('認識テキストは構造化して返す', async () => {
    expect((await extract()).totalAmount).toBe('1500');
  });

  test('worker と ImageBitmap は必ず解放する', async () => {
    await extract();
    expect(destroy).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
  });

  // モデルは precache 対象外なので、初回だけオフラインで落ちうる。
  // 素の fetch 失敗のままだと設定ミスと区別が付かない。
  test('オフラインでモデルを取得できない時は原因の分かる文言に変換する', async () => {
    const { m } = await import('../../paraglide/messages');
    vi.stubGlobal('navigator', { onLine: false });
    loadModel.mockRejectedValueOnce(new Error('Failed to fetch'));
    await expect(extract()).rejects.toThrow(m.common_offline_error());
    expect(destroy).toHaveBeenCalledOnce();
  });

  test('オンラインでの取得失敗はそのまま投げる', async () => {
    vi.stubGlobal('navigator', { onLine: true });
    loadModel.mockRejectedValueOnce(new Error('Failed to fetch'));
    await expect(extract()).rejects.toThrow('Failed to fetch');
  });

  test('認識が失敗しても worker と ImageBitmap を解放する', async () => {
    getText.mockRejectedValueOnce(new Error('boom'));
    await expect(extract()).rejects.toThrow('boom');
    expect(destroy).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
  });
});
