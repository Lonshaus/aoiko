// 認識と抽出の接ぎ目。認識器は版面か素のテキストを返し、抽出段がそれを領収書へ落とす。
// ここで切っておかないと、OS 内蔵 AI のような別の抽出段を後から挿せない。
import {
  extractFromOcrLayout,
  extractFromOcrText,
  type OcrLayout,
} from '../../domain/receipt-text-extract';
import type { ReceiptExtracted } from '../../domain/ocr';

// 環境によって、版面を返す認識器と素のテキストしか返さない認識器がある。
// 模型はどちらでも文字として受け取れる（版面は `text` を持つ）。
export type Recognized = { layout: OcrLayout } | { text: string };

// 規則の抽出は同期だが模型は非同期。呼ぶ側を揃えるため Promise に寄せる。
export type ExtractionStage = (recognized: Recognized) => Promise<ReceiptExtracted>;

export const ruleExtractionStage: ExtractionStage = async (recognized) =>
  'layout' in recognized
    ? extractFromOcrLayout(recognized.layout)
    : extractFromOcrText(recognized.text);
