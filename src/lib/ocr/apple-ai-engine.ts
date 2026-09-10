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
  5: m.ocr_apple_ai_error_5,
  6: m.ocr_apple_ai_error_6,
  7: m.ocr_apple_ai_error_7,
};

// aoiko_ai_availability 専用の表。extract の理由コードとは別の意味体系（1 端末非対応 /
// 2 機能無効 / 3 モデル準備中 / 4 OS が古い / 5 不明）なので、番号が同じでも
// ERROR_MESSAGES とは混ぜない。混ぜると code 2 が「文字が読めない」に誤訳される。
const AVAILABILITY_MESSAGES: Record<number, () => string> = {
  1: m.ocr_apple_ai_unavailable_device,
  2: m.ocr_apple_ai_unavailable_disabled,
  3: m.ocr_apple_ai_unavailable_downloading,
  4: m.ocr_apple_ai_unavailable_os,
  5: m.ocr_apple_ai_unavailable_unknown,
};

const INVOICE_NUMBER_WITH_T_RE = /^T\d{13}$/;
const INVOICE_NUMBER_WITHOUT_T_RE = /^\d{13}$/;

export function createAppleAiReceiptExtractor(): ReceiptExtractor {
  return {
    external: false,
    destinationHost: '',
    engine: 'apple-ai',
    async extract(image: LlmImageInput) {
      await checkAvailability();
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
      return toReceiptExtracted(parseAppleReceipt(raw));
    },
  };
}

// 判定できない場合は常に抽出へ進む：この確認は良いメッセージを出すためのものであって、
// 機能の門番ではない。ここを門番にすると、確認自体が使えない環境で機能ごと壊れる。
async function checkAvailability(): Promise<void> {
  const availability = nativeBridge()?.appleAiAvailability;
  if (typeof availability !== 'function') {
    return;
  }
  let code: number;
  try {
    code = await availability();
  } catch {
    return;
  }
  if (code === 0) {
    return;
  }
  const toMessage = AVAILABILITY_MESSAGES[code] ?? m.ocr_apple_ai_unavailable_unknown;
  throw new Error(toMessage());
}

function parseAppleReceipt(raw: string): AppleReceipt {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(m.ocr_apple_ai_error_3());
  }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !Array.isArray((parsed as { items?: unknown }).items)
  ) {
    throw new Error(m.ocr_apple_ai_error_3());
  }
  return parsed as AppleReceipt;
}

// Vision が先頭の T を落として返すのは receipt-text-extract.ts の recoverInvoiceNumber
// と同じ既知の癖（実測、自信度は最大）。ここは新しい後処理層ではなく、その既知の欠落を
// この経路でも同じように埋めるだけの修復。
function recoverInvoiceNumber(value: string): string | undefined {
  if (INVOICE_NUMBER_WITH_T_RE.test(value)) {
    return value;
  }
  if (INVOICE_NUMBER_WITHOUT_T_RE.test(value)) {
    return `T${value}`;
  }
  return undefined;
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
  const invoiceNumber = recoverInvoiceNumber(receipt.invoiceNumber);
  if (invoiceNumber !== undefined) {
    result.invoiceNumber = invoiceNumber;
  }
  // amount8 / amount10 は税率ごとの課税対象額であって、ReceiptExtracted 側に
  // 対応する項目が無い（taxAmount は消費税額そのもの、taxRate は単一の推定値）。
  // 推測で taxRate を作らず、ここでは受け取るだけに留める。
  return result;
}
