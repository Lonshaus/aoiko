// OS 内蔵の文字認識の包装層。engine 選択時のみ動的 import される。
//
// tesseract-engine と同じく、生テキストを receipt-text-extract に渡すだけ。
// 認識そのものはネイティブ側が持ち、こちらは橋渡しを呼ぶのみ。画像は端末外に出ない。
import { extractFromOcrText } from '../../domain/receipt-text-extract';
import type { LlmImageInput } from '../../domain/llm';
import type { ReceiptExtractor } from '../receipt-extractor';
import { nativeBridge } from '../native-bridge';
import { m } from '../../paraglide/messages';

export function createNativeReceiptExtractor(): ReceiptExtractor {
  return {
    external: false,
    destinationHost: '',
    engine: 'native',
    async extract(image: LlmImageInput) {
      // 設定はバックアップに乗って別の環境へ渡る。ここで落とさずに下の LLM へ流すと、
      // 端末内で読むつもりの利用者の画像が外へ出る。黙って引擎を差し替えない。
      const recognize = nativeBridge()?.recognizeText;
      if (typeof recognize !== 'function') {
        throw new Error(m.ocr_native_unavailable());
      }
      return extractFromOcrText(await recognize(image.base64));
    },
  };
}
