// 設定（ocrEngine）から領収書 OCR の実体を生成するファクトリ。
//
// 4 つの引擎（gemini / openai-compatible / tesseract / native）を共通の
// ReceiptExtractor インターフェースで包む。
// - gemini / openai-compatible：vision LLM。既存の createLlmAdapter+extractReceipt を包装
// - tesseract：純ローカル WASM OCR（tesseract-wasm）。動的 import で読み込み、確定性抽出層に渡す
// - native：OS 内蔵の文字認識。ネイティブ側の橋渡しを呼び、同じ確定性抽出層に渡す
//
// 送信先（external / destinationHost）は確認ダイアログ（CloudSendConfirmDialog）の
// 表示要否判定に使う。tesseract と native は常に external=false。

import { extractReceipt, type ReceiptExtracted } from '../domain/ocr';
import type { LlmImageInput } from '../domain/llm';
import { createLlmAdapter } from './llm-adapter';
import { getSetting, type OcrEngine } from './settings';

export interface ReceiptExtractor {
  /** 端末外へデータを送るか（クラウド = true、ローカル = false） */
  readonly external: boolean;
  /** 送信先ホスト（確認ダイアログ表示用） */
  readonly destinationHost: string;
  /** 引擎ラベル（UI 表示・分岐用） */
  readonly engine: OcrEngine;
  extract(image: LlmImageInput): Promise<ReceiptExtracted>;
}

export async function createReceiptExtractor(): Promise<ReceiptExtractor> {
  const engine = (await getSetting('ocrEngine')) ?? 'gemini';

  if (engine === 'tesseract') {
    const { createTesseractReceiptExtractor } = await import('./ocr/tesseract-engine');
    return createTesseractReceiptExtractor();
  }

  if (engine === 'native') {
    // 判定は build 時に畳む。実行時だけの分岐にすると、この引擎を持たない web にも
    // 包装層が丸ごと入り、産物に文言が残る（購入画面と同じ理由）。
    if (__NATIVE__) {
      const { createNativeReceiptExtractor } = await import('./ocr/native-engine');
      return createNativeReceiptExtractor();
    }
    // 設定はバックアップに乗って別の環境へ渡る。ここで落とさずに下の LLM へ流すと、
    // 端末内で読むつもりの利用者の画像が外へ出る。黙って引擎を差し替えない。
    // 文言はカタログから引かない。引くと、この経路を持たない側の産物にも文字列が残る。
    throw new Error('native OCR is unavailable in this build');
  }

  const adapter = await createLlmAdapter('ocr');
  return {
    external: adapter.external,
    destinationHost: adapter.destinationHost,
    engine,
    extract: (image) => extractReceipt(adapter, image),
  };
}
