// tesseract-wasm（WASM）完全ローカル OCR のラッパー。
// engine 選択時のみ動的 import される（バンドル肥大化を避ける）。
//
// 役割は薄い：
//   1) base64 を ImageBitmap に復号して tesseract-wasm に渡す
//   2) 生テキストを receipt-text-extract に渡して構造化する
//
// 前処理（リサイズ・二値化等）は現時点の最小限の実装には含めていない。精度が問題になれば後追い。
// 画像は端末外に出ない。worker・コア WASM・日本語モデルは同一オリジンから配る
// （web 版は初回の解析時だけ通信し、以降は Service Worker がキャッシュから返す。
// native 版はアプリに同梱するため通信自体が発生しない）。
import { OCRClient } from 'tesseract-wasm';
import { extractFromOcrText } from '../../domain/receipt-text-extract';
import type { LlmImageInput } from '../../domain/llm';
import type { ReceiptExtractor } from '../receipt-extractor';
import { isOffline } from '../network-status';
import { m } from '../../paraglide/messages';
const WORKER_URL = '/tesseract/tesseract-worker.js';
const MODEL_URL = '/tesseract/jpn.traineddata';
// data URL を fetch すると connect-src（'self' のみ）に阻まれるため自前で復号する。
function toBlob(image: LlmImageInput): Blob {
  const binary = atob(image.base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: image.mimeType });
}

export function createTesseractReceiptExtractor(): ReceiptExtractor {
  return {
    external: false,
    destinationHost: '',
    downscale: false,
    engine: 'tesseract',
    async extract(image: LlmImageInput) {
      // 画像の復号はブラウザに任せる（tesseract-wasm 自身は復号器を持たない）。
      // 対応外の形式ならここで例外になり、無言で空文字が返ることはない。
      const bitmap = await createImageBitmap(toBlob(image));
      const client = new OCRClient({ workerURL: WORKER_URL });
      try {
        // worker・コア・モデルは同一オリジンだが precache 対象外なので、初回だけ
        // 取得が要る。オフラインだと素の fetch 失敗が出るため、原因が分かる文言に変換する。
        try {
          await client.loadModel(MODEL_URL);
        } catch (e) {
          if (isOffline()) {
            throw new Error(m.common_offline_error(), { cause: e });
          }
          throw e;
        }
        await client.loadImage(bitmap);
        return extractFromOcrText(await client.getText());
      } finally {
        bitmap.close();
        // worker を残すと WASM のヒープが解放されない（tesseract-wasm の既知の制約）。
        await client.destroy();
      }
    },
  };
}
