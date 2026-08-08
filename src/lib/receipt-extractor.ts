// 設定から領収書 OCR の実体を作る。external / destinationHost は送信前確認ダイアログの
// 表示要否に使う——tesseract は端末内で完結するので常に external=false。

import { extractReceipt, type ReceiptExtracted } from '../domain/ocr';
import type { LlmImageInput } from '../domain/llm';
import { createLlmAdapter } from './llm-adapter';
import { getSetting } from './settings';

export interface ReceiptExtractor {
  /** 端末外へデータを送るか（クラウド = true、ローカル = false） */
  readonly external: boolean;
  /** 送信先ホスト（確認ダイアログ表示用） */
  readonly destinationHost: string;
  /** 引擎ラベル（UI 表示・分岐用） */
  readonly engine: 'gemini' | 'openai-compatible' | 'tesseract';
  extract(image: LlmImageInput): Promise<ReceiptExtracted>;
}

export async function createReceiptExtractor(): Promise<ReceiptExtractor> {
  const engine = (await getSetting('ocrEngine')) ?? 'gemini';

  if (engine === 'tesseract') {
    const langPath = (await getSetting('tesseractLangPath'))?.trim() || undefined;
    const { createTesseractReceiptExtractor } = await import('./ocr/tesseract-engine');
    return createTesseractReceiptExtractor(langPath);
  }

  const adapter = await createLlmAdapter('ocr');
  return {
    external: adapter.external,
    destinationHost: adapter.destinationHost,
    engine,
    extract: (image) => extractReceipt(adapter, image),
  };
}
