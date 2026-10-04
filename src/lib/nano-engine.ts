// 端末内の Gemini Nano を LlmAdapter / ReceiptExtractor として橋渡しする。
// apple-ai-adapter.ts / ocr/apple-ai-engine.ts と対称。可用性はここでは問わない：
// 可用性は設定画面の選択肢を出すためだけの判定で、経路そのものを塞ぐ門番ではない
// （llm-adapter.ts の他エンジンと同じ理由）。
import { LlmError, type LlmAdapter, type LlmDataTask, type LlmImageInput } from '../domain/llm';
import type { ReceiptExtracted, ReceiptItem } from '../domain/ocr';
import type { ReceiptExtractor } from './receipt-extractor';
import { nativeBridge, type NanoRejectCode } from './native-bridge';
import { m } from '../paraglide/messages';

const REJECT_MESSAGES: Record<NanoRejectCode, () => string> = {
  unavailable: m.error_nano_unavailable,
  'too-long': m.error_nano_too_long,
  busy: m.error_nano_busy,
  background: m.error_nano_background,
  quota: m.error_nano_quota,
  'bad-input': m.error_nano_bad_input,
  'unsupported-account': m.error_nano_unsupported_account,
  unsupported: m.error_nano_unsupported,
  failed: m.error_nano_failed,
};
// 拒否は常に文字列で来る。既知の 9 種類かどうかは typeof ではなく集合の所属で見る
// （文字列であることは既知コードでも配線ミスの文字列でも変わらないため）。
function isNanoRejectCode(reason: unknown): reason is NanoRejectCode {
  return typeof reason === 'string' && reason in REJECT_MESSAGES;
}

function describeRejection(reason: unknown): string {
  if (isNanoRejectCode(reason)) {
    return REJECT_MESSAGES[reason]();
  }
  return m.error_nano_unknown();
}

export class NanoAdapter implements LlmAdapter {
  readonly external = false;
  readonly destinationHost = '';

  async generateJson(_prompt: string, _image?: LlmImageInput): Promise<unknown> {
    throw new LlmError(m.error_nano_prompt_unsupported());
  }

  async runDataTask(task: LlmDataTask, data: unknown): Promise<unknown> {
    const run = nativeBridge()?.nanoRun;
    if (typeof run !== 'function') {
      throw new LlmError(m.error_nano_unsupported());
    }
    let raw: string;
    try {
      raw = await run(task, JSON.stringify(data));
    } catch (reason) {
      throw new LlmError(describeRejection(reason));
    }
    try {
      return JSON.parse(raw);
    } catch (e) {
      throw new LlmError(m.error_llm_response_not_json({ text: raw.slice(0, 200) }), e);
    }
  }
}

export function createNanoAdapter(): LlmAdapter {
  return new NanoAdapter();
}

type NanoReceipt = {
  date: string;
  vendorName: string;
  totalAmount: string;
  invoiceNumber: string;
  taxAmount: string;
  items: Array<{ description: string; amount: string }>;
};

export function createNanoReceiptExtractor(): ReceiptExtractor {
  return {
    external: false,
    destinationHost: '',
    downscale: false,
    engine: 'nano',
    async extract(image: LlmImageInput) {
      const extract = nativeBridge()?.nanoExtractReceipt;
      if (typeof extract !== 'function') {
        throw new Error(m.error_nano_unsupported());
      }
      let raw: string;
      try {
        raw = await extract(image.base64);
      } catch (reason) {
        throw new Error(describeRejection(reason));
      }
      return toReceiptExtracted(parseNanoReceipt(raw));
    },
  };
}

function parseNanoReceipt(raw: string): NanoReceipt {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(m.error_nano_failed());
  }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !Array.isArray((parsed as { items?: unknown }).items)
  ) {
    throw new Error(m.error_nano_failed());
  }
  return parsed as NanoReceipt;
}

function toReceiptExtracted(receipt: NanoReceipt): ReceiptExtracted {
  const items: ReceiptItem[] = receipt.items
    .filter((item) => item.description !== '' && item.amount !== '')
    .map((item) => ({ description: item.description, amount: item.amount }));
  const result: ReceiptExtracted = {
    date: receipt.date,
    vendorName: receipt.vendorName,
    totalAmount: receipt.totalAmount,
    items,
  };
  if (receipt.invoiceNumber !== '') {
    result.invoiceNumber = receipt.invoiceNumber;
  }
  if (receipt.taxAmount !== '') {
    result.taxAmount = receipt.taxAmount;
  }
  return result;
}
