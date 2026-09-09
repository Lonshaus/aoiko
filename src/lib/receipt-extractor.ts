// 領収書 OCR の実体を生成するファクトリ。
//
// method='ai' はここに来る前に決まっている aiEngine（gemini / openai-compatible）を
// vision LLM として使う。既存の createLlmAdapter+extractReceipt を包装する。
// method='rule' は ruleEngine で更に分岐する：
// - tesseract：純ローカル WASM OCR（tesseract-wasm）。動的 import で読み込み、確定性抽出層に渡す
// - native：OS 内蔵の文字認識。ネイティブ側の橋渡しを呼び、同じ確定性抽出層に渡す
//
// 送信先（external / destinationHost）は確認ダイアログ（CloudSendConfirmDialog）の
// 表示要否判定に使う。tesseract と native は常に external=false。

import { extractReceipt, type ReceiptExtracted } from '../domain/ocr';
import type { LlmImageInput } from '../domain/llm';
import { createLlmAdapter } from './llm-adapter';
import {
  defaultRuleEngine,
  getSetting,
  type AiEngine,
  type ReceiptMethod,
  type ReceiptRuleEngine,
} from './settings';

export interface ReceiptExtractor {
  /** 端末外へデータを送るか（クラウド = true、ローカル = false） */
  readonly external: boolean;
  /** 送信先ホスト（確認ダイアログ表示用） */
  readonly destinationHost: string;
  /** エンジンラベル（UI 表示・分岐用） */
  readonly engine: AiEngine | ReceiptRuleEngine;
  extract(image: LlmImageInput): Promise<ReceiptExtracted>;
}

export async function createReceiptExtractor(
  method: ReceiptMethod,
  ruleEngine: ReceiptRuleEngine,
): Promise<ReceiptExtractor> {
  if (method === 'ai') {
    const adapter = await createLlmAdapter('ocr');
    const engine: AiEngine = (await getSetting('aiEngine')) ?? 'gemini';
    return {
      external: adapter.external,
      destinationHost: adapter.destinationHost,
      engine,
      extract: (image) => extractReceipt(adapter, image),
    };
  }
  // 未知の値（移行で書かれた旧設定の生値等）は既定へ落とす。落とさず投げると
  // 解析ボタンが常時例外になる。
  const resolvedRuleEngine =
    ruleEngine === 'tesseract' || ruleEngine === 'native'
      ? ruleEngine
      : defaultRuleEngine(__NATIVE__);

  if (resolvedRuleEngine === 'tesseract') {
    const { createTesseractReceiptExtractor } = await import('./ocr/tesseract-engine');
    return createTesseractReceiptExtractor();
  }
  // 判定は build 時に畳む。実行時だけの分岐にすると、このエンジンを持たない web にも
  // 包装層が丸ごと入り、産物に文言が残る（購入画面と同じ理由）。
  if (__NATIVE__) {
    const { createNativeReceiptExtractor } = await import('./ocr/native-engine');
    return createNativeReceiptExtractor();
  }
  // 設定はバックアップに乗って別の環境へ渡る。ここで落とさずに下の LLM へ流すと、
  // 端末内で読むつもりの利用者の画像が外へ出る。黙ってエンジンを差し替えない。
  // 文言はカタログから引かない。引くと、この経路を持たない側の産物にも文字列が残る。
  throw new Error('native OCR is unavailable in this build');
}
