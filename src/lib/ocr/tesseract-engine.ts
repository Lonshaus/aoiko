// Tesseract（WASM）純ローカル OCR の包装層。
// engine 選択時のみ動的 import される（バンドル肥大化を避ける）。
//
// 役割は薄い：
//   1) data URL を作って tesseract.js に渡す
//   2) 生テキストを receipt-text-extract に渡して構造化する
//
// 前処理（リサイズ・二値化等）は本最小版では未実装。精度が問題になれば後追い。
// 画像も traineddata も端末外に出ない。設定で langPath を指定した場合のみ、
// その URL から traineddata を取得する。

import { extractFromOcrText } from '../../domain/receipt-text-extract';
import type { LlmImageInput } from '../../domain/llm';
import type { ReceiptExtractor } from '../receipt-extractor';
// worker とコアは自己ホストする。tesseract.js の既定値は jsDelivr CDN だが、
// blob worker は生成元の CSP を継承するため、script-src に外部オリジンを
// 持たない aoiko では worker 内の importScripts が必ずブロックされる。
// 実体は scripts/copy-tesseract-assets.js が public/tesseract/ へ複製する。
const WORKER_PATH = '/tesseract/worker.min.js';
// ディレクトリを渡すと worker 側が SIMD 対応状況を見てファイル名を連結する。
const CORE_PATH = '/tesseract/core';
// traineddata も同梱する（jpn+eng で 4.8MB）。既定のままだと jsDelivr へ取りに行き、
// 「画像は端末外に出ない」「オフラインで使える」という説明と食い違う。
// precache からは除外してあるため、Tesseract を選んだ利用者だけが取得する。
const LANG_PATH = '/tesseract/lang';

export function createTesseractReceiptExtractor(langPath?: string): ReceiptExtractor {
  return {
    external: false,
    destinationHost: '',
    engine: 'tesseract',
    async extract(image: LlmImageInput) {
      const dataUrl = `data:${image.mimeType};base64,${image.base64}`;
      const Tesseract = await import('tesseract.js');
      const options: Record<string, unknown> = {
        workerPath: WORKER_PATH,
        corePath: CORE_PATH,
        langPath: langPath || LANG_PATH,
      };
      const { data } = await Tesseract.recognize(dataUrl, 'jpn+eng', options);
      return extractFromOcrText(data.text ?? '');
    },
  };
}
