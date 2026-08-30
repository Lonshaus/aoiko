import { LlmError, type LlmAdapter, type LlmImageInput } from './llm';
import { todayISO } from '../lib/date';
import { m } from '../paraglide/messages';
// 領収書 OCR：画像 → 構造化された取引データ。
// Gemini Vision を使用。BYOK モデル、ユーザー API キー必須。

export interface ReceiptItem {
  description: string;
  amount: string;
}

export interface ReceiptExtracted {
  /** YYYY-MM-DD、判別不能なら今日 */
  date: string;
  /** 店名 / 取引先 */
  vendorName: string;
  /** 合計金額（税込）、Decimal 字串 */
  totalAmount: string;
  /** 内訳（任意、店舗による） */
  items: ReceiptItem[];
  /** 消費税額（任意、領収書に明示があれば） */
  taxAmount?: string;
  /** 税率（0.08 / 0.1 等、推測値） */
  taxRate?: number;
  /** 適格請求書発行事業者の登録番号（任意） */
  invoiceNumber?: string;
  /** その他のメモ */
  notes?: string;
}

export async function extractReceipt(
  adapter: LlmAdapter,
  image: LlmImageInput,
): Promise<ReceiptExtracted> {
  const prompt = buildOcrPrompt();
  const raw = await adapter.generateJson(prompt, image);
  return parseOcrResponse(raw);
}

export function buildOcrPrompt(): string {
  return [
    'あなたは日本の領収書・レシートから取引情報を抽出する AI です。',
    '画像を読み取り、以下の JSON 形式で返答してください：',
    '',
    '{',
    '  "date": "YYYY-MM-DD",  // 取引日。判読不能なら空文字',
    '  "vendorName": "店名・取引先",  // 判読不能なら空文字',
    '  "totalAmount": "合計（税込・整数文字列）",  // 必須',
    '  "items": [{ "description": "品目名", "amount": "金額" }],  // 内訳、無ければ空配列',
    '  "taxAmount": "消費税額",  // 任意',
    '  "taxRate": 0.1,  // 0.08 / 0.1 / 0、推定可',
    '  "invoiceNumber": "T1234567890123",  // 適格請求書発行事業者番号、明示時のみ',
    '  "notes": "備考"  // 任意の追加情報',
    '}',
    '',
    '注意：',
    '- 金額は半角数字・カンマなし・小数なしの整数文字列で（例："1500"、"12345"）',
    '- 日付は西暦 YYYY-MM-DD 形式（和暦は西暦に変換）',
    '- 判読不能な項目は空文字 "" を使い、null は使わないこと',
    '- レスポンスは JSON のみ、説明テキストは含めないこと',
  ].join('\n');
}

function parseOcrResponse(raw: unknown): ReceiptExtracted {
  if (!raw || typeof raw !== 'object') {
    throw new LlmError(m.error_ocr_response_shape());
  }
  const r = raw as Record<string, unknown>;
  // 形式まで見る。YYYY-MM-DD でない値は <input type="date"> が空表示にするため、
  // 利用者は「日付が読めなかった」ことに気付けないまま保存へ進んでしまう。
  const date =
    typeof r.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.date) ? r.date : todayISO();
  const vendorName = typeof r.vendorName === 'string' ? r.vendorName : '';
  const totalAmount = typeof r.totalAmount === 'string' ? sanitizeAmount(r.totalAmount) : '';
  if (!totalAmount) {
    throw new LlmError(m.error_ocr_total_missing());
  }

  const items: ReceiptItem[] = [];
  if (Array.isArray(r.items)) {
    for (const item of r.items) {
      if (!item || typeof item !== 'object') {
        continue;
      }
      const it = item as Record<string, unknown>;
      const desc = typeof it.description === 'string' ? it.description : '';
      const amt = typeof it.amount === 'string' ? sanitizeAmount(it.amount) : '';
      if (desc && amt) {
        items.push({ description: desc, amount: amt });
      }
    }
  }

  const result: ReceiptExtracted = {
    date,
    vendorName,
    totalAmount,
    items,
  };
  if (typeof r.taxAmount === 'string') {
    const t = sanitizeAmount(r.taxAmount);
    if (t) {
      result.taxAmount = t;
    }
  }
  if (typeof r.taxRate === 'number' && r.taxRate >= 0 && r.taxRate <= 1) {
    result.taxRate = r.taxRate;
  }
  if (typeof r.invoiceNumber === 'string' && /^T\d{13}$/.test(r.invoiceNumber)) {
    result.invoiceNumber = r.invoiceNumber;
  }
  if (typeof r.notes === 'string' && r.notes.length > 0) {
    result.notes = r.notes;
  }
  return result;
}

function sanitizeAmount(s: string): string {
  const cleaned = s.replace(/[¥￥,\s]/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) {
    return '';
  }
  // 整数部のみ
  return cleaned.split('.')[0] ?? '';
}
// File / Blob を base64 文字列に変換（data URL prefix を除去）。
// 1 バイトずつ文字列連結すると 15MB の写真で 1500 万回のループと巨大な中間文字列に
// なるため、ブラウザ側で一括変換する FileReader に任せる。
export async function fileToBase64(file: Blob): Promise<{ base64: string; mimeType: string }> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('ファイルを読み込めませんでした'));
    reader.readAsDataURL(file);
  });
  return {
    base64: dataUrl.slice(dataUrl.indexOf(',') + 1),
    mimeType: file.type || 'image/jpeg',
  };
}
