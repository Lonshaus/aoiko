import { LlmError } from './llm';
// EC サイト（Amazon、楽天等）の注文ページの貼り付けテキストから、
// LLM で品目内訳を抽出する純ロジック。DOM scraping を使わないため
// サイト改修に強い。Phase 3：「Chrome 拡張」案を本方式に置き換え。

export interface OrderItem {
  /** 品目名（型番・規格含む） */
  description: string;
  /** 金額（円、整数文字列、カンマ・通貨記号なし） */
  amount: string;
}

export interface OrderExtracted {
  /** 注文日（YYYY-MM-DD） */
  date: string;
  /** 取引先表示名（例：'Amazon.co.jp'、'楽天市場 - ヨドバシ.com'） */
  vendor: string;
  /** 注文番号（任意） */
  orderNumber?: string;
  /** 品目内訳（配送料・手数料・値引も独立行として含む） */
  items: OrderItem[];
  /** 支払総額（配送料・税込・値引適用後） */
  totalAmount: string;
}

export function buildOrderPrompt(): string {
  return [
    'あなたは EC サイト（Amazon、楽天市場、Yahoo!ショッピング 等）の注文ページの',
    '貼り付けテキストから注文情報を抽出する AI です。',
    '画面のヘッダ・ナビ・レコメンド等の不要部分は無視し、',
    '注文サマリ（日付・店舗名・品目内訳・合計）のみ拾います。',
    '',
    '以下の JSON 形式で返答してください：',
    '',
    '{',
    '  "date": "YYYY-MM-DD",          // 注文日（和暦は西暦に変換）。判読不能なら空文字',
    '  "vendor": "サイト - 店舗名",   // 例："Amazon.co.jp"、"楽天市場 - ヨドバシ.com"',
    '  "orderNumber": "注文番号",     // 任意。無ければ空文字',
    '  "items": [',
    '    { "description": "品目名（型番・規格含む）", "amount": "金額" }',
    '  ],',
    '  "totalAmount": "支払総額"      // 必須。配送料・税込・値引適用後',
    '}',
    '',
    '注意：',
    '- 金額は半角数字、カンマ・通貨記号なしの整数文字列（例："1580"、"12345"）',
    '- 配送料・送料・手数料は items の独立行として末尾に追加（description: "配送料" 等）',
    '- 値引・クーポンが商品行に紐づく場合は description に "（クーポン -300円）" 等の注記',
    '- 値引が独立した行の場合は items に独立行として入れ、amount は負値（"-300"）',
    '- 判読不能な項目は空文字 ""、null は使わない',
    '- 複数注文が含まれていたら最初の注文のみ抽出',
    '- レスポンスは JSON のみ、説明テキストは含めない',
  ].join('\n');
}

export function parseOrderResponse(raw: unknown): OrderExtracted {
  if (!raw || typeof raw !== 'object') {
    throw new LlmError('注文解析レスポンスが想定外の形式');
  }
  const r = raw as Record<string, unknown>;

  const date = typeof r.date === 'string' ? r.date : '';
  const vendor = typeof r.vendor === 'string' ? r.vendor : '';
  const totalAmount =
    typeof r.totalAmount === 'string' ? sanitizeAmount(r.totalAmount) : '';
  if (!totalAmount) {
    throw new LlmError('注文の合計金額を抽出できませんでした');
  }

  const items: OrderItem[] = [];
  if (Array.isArray(r.items)) {
    for (const item of r.items) {
      if (!item || typeof item !== 'object') {
        continue;
      }
      const it = item as Record<string, unknown>;
      const desc = typeof it.description === 'string' ? it.description : '';
      const amt =
        typeof it.amount === 'string' ? sanitizeAmount(it.amount, true) : '';
      if (desc && amt !== '') {
        items.push({ description: desc, amount: amt });
      }
    }
  }
  if (items.length === 0) {
    throw new LlmError('注文の品目を 1 件も抽出できませんでした');
  }

  const result: OrderExtracted = {
    date,
    vendor,
    items,
    totalAmount,
  };
  if (typeof r.orderNumber === 'string' && r.orderNumber.length > 0) {
    result.orderNumber = r.orderNumber;
  }
  return result;
}
// 金額文字列をサニタイズ。allowNegative=true なら負値を保持（値引行用）。
function sanitizeAmount(s: string, allowNegative: boolean = false): string {
  const cleaned = s.replace(/[¥￥,\s]/g, '');
  const pattern = allowNegative ? /^-?\d+(\.\d+)?$/ : /^\d+(\.\d+)?$/;
  if (!pattern.test(cleaned)) {
    return '';
  }
  return cleaned.split('.')[0] ?? '';
}