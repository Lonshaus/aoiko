import type { ReceiptExtracted } from './ocr';
// Tesseract（純ローカル OCR）が吐く生テキストから領収書の構造化情報を
// 確定性ベースで取り出す純関数。ブラウザ非依存・Vitest で網羅可能。
//
// 設計方針：
// - 自動入力は確実なものだけ。怪しい時は欄を空にして利用者に委ねる
//   （vision LLM 路の `parseOcrResponse` が throw する条件でも、本関数は throw しない）
// - 全文は notes に詰めてプレフィル。利用者が眼で見て補正できる
// - 店名・品目の弱推定は行わない。誤誘導を避けるため空のまま返す
//
// 抽出対象：
//   invoiceNumber : /T\d{13}/（適格請求書発行事業者登録番号、確定性高）
//   date          : 西暦 YYYY[/-.年]M[...]D / 和暦 令和N年M月D日 を最初に見つけた行
//   totalAmount   : 「合計 / お買上げ / 総額 / ご請求」を含み、
//                   「小計 / お預り / お釣り / 釣銭 / 現金 / ポイント / 還元」
//                   を含まない行から金額 token を抽出
//   notes         : OCR 全文（プレフィル）

const INVOICE_NUMBER_RE = /T\d{13}/;
const WESTERN_DATE_RE = /(\d{4})\s*[/\-.年]\s*(\d{1,2})\s*[/\-.月]\s*(\d{1,2})\s*日?/;
const REIWA_DATE_RE =
  /(?:令和|R)\s*(元|\d{1,2})\s*[/\-.年]?\s*(\d{1,2})\s*[/\-.月]\s*(\d{1,2})\s*日?/;
// 金額 token：¥1,500 / ￥1,500 / 1,500 / 1500円 / \1,500 等。
// 整数部のみ採用（小数表記レシートは想定外）。
const AMOUNT_TOKEN_RE = /(?:[¥￥\\])?\s*(\d{1,3}(?:,\d{3})+|\d+)(?:\s*円)?/g;
const TOTAL_KEYWORDS_INCLUDE = ['合計', 'お買上げ', 'お買上', '総額', 'ご請求'];
const TOTAL_KEYWORDS_EXCLUDE = [
  '小計',
  'お預り',
  'お預かり',
  'お釣り',
  '釣銭',
  '現金',
  'ポイント',
  '還元',
];

export function extractFromOcrText(text: string): ReceiptExtracted {
  const lines = text.split(/\r?\n/);
  const result: ReceiptExtracted = {
    date: extractDate(text),
    vendorName: '',
    totalAmount: extractTotal(lines),
    items: [],
    notes: text,
  };
  const invoice = INVOICE_NUMBER_RE.exec(text)?.[0];
  if (invoice) {
    result.invoiceNumber = invoice;
  }
  return result;
}

function extractDate(text: string): string {
  const reiwa = REIWA_DATE_RE.exec(text);
  if (reiwa) {
    const yToken = reiwa[1]!;
    const reiwaYear = yToken === '元' ? 1 : Number(yToken);
    if (reiwaYear >= 1 && reiwaYear <= 99) {
      const y = 2018 + reiwaYear;
      const m = Number(reiwa[2]!);
      const d = Number(reiwa[3]!);
      if (isValidYmd(y, m, d)) {
        return formatYmd(y, m, d);
      }
    }
  }
  const western = WESTERN_DATE_RE.exec(text);
  if (western) {
    const y = Number(western[1]!);
    const m = Number(western[2]!);
    const d = Number(western[3]!);
    if (isValidYmd(y, m, d)) {
      return formatYmd(y, m, d);
    }
  }
  return '';
}

function extractTotal(lines: string[]): string {
  const candidates: number[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      continue;
    }
    if (TOTAL_KEYWORDS_EXCLUDE.some((k) => line.includes(k))) {
      continue;
    }
    if (!TOTAL_KEYWORDS_INCLUDE.some((k) => line.includes(k))) {
      continue;
    }
    const amounts = parseAmounts(line);
    if (amounts.length > 0) {
      // 同一行に複数金額がある場合は最後（キーワード後ろ）を優先
      candidates.push(amounts[amounts.length - 1]!);
    }
  }
  if (candidates.length === 0) {
    return '';
  }
  // 複数行で抽出できた場合は最大値（割引・税抜小計より税込合計が大きい想定）
  return String(Math.max(...candidates));
}

function parseAmounts(s: string): number[] {
  const result: number[] = [];
  AMOUNT_TOKEN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = AMOUNT_TOKEN_RE.exec(s)) !== null) {
    const n = Number(m[1]!.replace(/,/g, ''));
    if (Number.isFinite(n) && n > 0) {
      result.push(n);
    }
  }
  return result;
}

function isValidYmd(y: number, m: number, d: number): boolean {
  if (y < 1900 || y > 2100) {
    return false;
  }
  if (m < 1 || m > 12) {
    return false;
  }
  if (d < 1 || d > 31) {
    return false;
  }
  return true;
}

function formatYmd(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
