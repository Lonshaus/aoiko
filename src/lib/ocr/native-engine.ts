// OS 内蔵の文字認識の包装層。engine 選択時のみ動的 import される。
//
// 認識はネイティブ側が持つ。画像は端末外に出ない。
// 返るのは座標付きの版面。抽出は差し替えられる（extraction-stage）。
import { ruleExtractionStage, type ExtractionStage } from './extraction-stage';
import type { LlmImageInput } from '../../domain/llm';
import type { ReceiptExtractor } from '../receipt-extractor';
import { nativeBridge } from '../native-bridge';
import { m } from '../../paraglide/messages';

export function createNativeReceiptExtractor(
  stage: ExtractionStage = ruleExtractionStage,
): ReceiptExtractor {
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
      return stage({ layout: await recognize(image.base64) });
    },
  };
}
