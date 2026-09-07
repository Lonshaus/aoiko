// OS 内蔵の AI の包装層。engine 選択時のみ動的 import される。
//
// 認識も構造化もネイティブ側で完結する。画像は端末外に出ない。native-engine と違い、
// 返るのは既に構造化済みの JSON なので、receipt-text-extract の確定性抽出は通さない。
import type { LlmImageInput } from '../../domain/llm';
import type { ReceiptExtracted, ReceiptItem } from '../../domain/ocr';
import type { ReceiptExtractor } from '../receipt-extractor';
import { nativeBridge } from '../native-bridge';
import { m } from '../../paraglide/messages';

type AppleReceiptItem = {
  name: string;
  amount: string;
};

type AppleReceipt = {
  vendor: string;
  date: string;
  total: string;
  invoiceNumber: string;
  amount8: string;
  amount10: string;
  items: AppleReceiptItem[];
};

const ERROR_MESSAGES: Record<number, () => string> = {
  1: m.ocr_apple_ai_error_1,
  2: m.ocr_apple_ai_error_2,
  3: m.ocr_apple_ai_error_3,
  4: m.ocr_apple_ai_error_4,
};

export function createAppleAiReceiptExtractor(): ReceiptExtractor {
  return {
    external: false,
    destinationHost: '',
    engine: 'apple-ai',
    async extract(image: LlmImageInput) {
      // 設定はバックアップに乗って別の環境へ渡る。ここで落とさずに下の LLM へ流すと、
      // 端末内で読むつもりの利用者の画像が外へ出る。黙って引擎を差し替えない。
      const extract = nativeBridge()?.appleAiExtract;
      if (typeof extract !== 'function') {
        throw new Error(m.ocr_apple_ai_error_4());
      }
      let raw: string;
      try {
        raw = await extract(image.base64);
      } catch (code) {
        const toMessage = typeof code === 'number' ? ERROR_MESSAGES[code] : undefined;
        throw new Error(toMessage?.() ?? m.ocr_apple_ai_error_3());
      }
      return toReceiptExtracted(JSON.parse(raw) as AppleReceipt);
    },
  };
}

function toReceiptExtracted(receipt: AppleReceipt): ReceiptExtracted {
  const items: ReceiptItem[] = receipt.items
    .filter((item) => item.name !== '' && item.amount !== '')
    .map((item) => ({ description: item.name, amount: item.amount }));

  const result: ReceiptExtracted = {
    date: receipt.date,
    vendorName: receipt.vendor,
    totalAmount: receipt.total,
    items,
  };
  if (receipt.invoiceNumber !== '') {
    result.invoiceNumber = receipt.invoiceNumber;
  }
  // amount8 / amount10 は税率ごとの課税対象額であって、ReceiptExtracted 側に
  // 対応する項目が無い（taxAmount は消費税額そのもの、taxRate は単一の推定値）。
  // 推測で taxRate を作らず、ここでは受け取るだけに留める。
  return result;
}
