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
//                   T が落ちた場合のみ、同じ行に「登録番号」等がある 13 桁を補う
//   date          : 西暦 YYYY[/-.年]M[...]D / 和暦 令和N年M月D日 を最初に見つけた行
//   totalAmount   : 「合計 / お買上げ / 総額 / ご請求」を含み、
//                   「小計 / お預り / お釣り / 釣銭 / 現金 / ポイント / 還元」
//                   を含まない行から金額 token を抽出
//   notes         : OCR 全文（プレフィル）

const INVOICE_NUMBER_RE = /T\d{13}/;
// OS 内蔵の文字認識は `T1234567890123` の先頭 1 文字を落として返すことがある
// （実測。しかも自信度は最大で、誤りとして扱えない）。同じ行に「登録番号」等がある
// 13 桁だけを補う。行を限らないと領収書番号のような別の 13 桁を登録番号に化けさせる。
const INVOICE_CONTEXT = ['登録番号', 'インボイス'];
const BARE_INVOICE_NUMBER_RE = /(?<!\d)\d{13}(?!\d)/;
// 年は 19xx / 20xx に限る。電話番号 `0422-29-0051` が「0422 年 29 月 00 日」として
// 先に命中し、日付を見つけられなくなる（実測。店の電話が日付より前にある領収書は多い）。
// g を付けて最初の 1 件で諦めないのも同じ理由で、妥当な日付が出るまで後ろを見る。
const WESTERN_DATE_RE = /((?:19|20)\d{2})\s*[/\-.年]\s*(\d{1,2})\s*[/\-.月]\s*(\d{1,2})\s*日?/g;
const REIWA_DATE_RE =
  /(?:令和|R)\s*(元|\d{1,2})\s*[/\-.年]?\s*(\d{1,2})\s*[/\-.月]\s*(\d{1,2})\s*日?/g;
// 金額 token：¥1,500 / ￥1,500 / 1,500 / 1500円 / \1,500 等。
// 整数部のみ採用（小数表記レシートは想定外）。
// 桁区切りを `[,.]` の 1 文字以上として扱う。OCR は小さな `,` を安定して読めず、
// 同じ画像でも出方が変わる（実測：`合計 2,200円` が `2.200` になったり `2.,200` に
// なったりする）。1 文字しか許さないと `2.,200` が `2` と `200` に割れ、行内最後の
// `200` を合計と誤認する。3 桁ちょうどの群に限れば、円には補助単位が無いので
// 小数との取り違えは起きない。
const AMOUNT_TOKEN_RE = /(?:[¥￥\\])?\s*(\d{1,3}(?:[,.]+\d{3})+|\d+)(?:\s*円)?/g;
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
  const invoice = INVOICE_NUMBER_RE.exec(text)?.[0] ?? recoverInvoiceNumber(lines);
  if (invoice) {
    result.invoiceNumber = invoice;
  }
  return result;
}

function recoverInvoiceNumber(lines: string[]): string | undefined {
  for (const line of lines) {
    if (!INVOICE_CONTEXT.some((k) => line.includes(k))) {
      continue;
    }
    const digits = BARE_INVOICE_NUMBER_RE.exec(line)?.[0];
    if (digits) {
      return `T${digits}`;
    }
  }
  return undefined;
}

function extractDate(text: string): string {
  for (const reiwa of text.matchAll(REIWA_DATE_RE)) {
    const yToken = reiwa[1]!;
    const reiwaYear = yToken === '元' ? 1 : Number(yToken);
    if (reiwaYear < 1 || reiwaYear > 99) {
      continue;
    }
    const y = 2018 + reiwaYear;
    const m = Number(reiwa[2]!);
    const d = Number(reiwa[3]!);
    if (isValidYmd(y, m, d)) {
      return formatYmd(y, m, d);
    }
  }
  for (const western of text.matchAll(WESTERN_DATE_RE)) {
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
    const n = Number(m[1]!.replace(/[,.]/g, ''));
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
