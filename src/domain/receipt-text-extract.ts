import type { ReceiptExtracted, ReceiptItem } from './ocr';
// Tesseract（純ローカル OCR）が吐く生テキストから領収書の構造化情報を
// 確定性ベースで取り出す純関数。ブラウザ非依存・Vitest で網羅可能。
//
// 設計方針：
// - 自動入力は確実なものだけ。怪しい時は欄を空にして利用者に委ねる
//   （vision LLM 路の `parseOcrResponse` が throw する条件でも、本関数は throw しない）
// - 全文は notes に詰めてプレフィル。利用者が眼で見て補正できる
// - 店名・品目は座標がある経路（extractFromOcrLayout）だけで取る。素のテキストでは
//   当てずっぽうになる
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
// 年は 19xx / 20xx に限る。市外局番から始まる電話番号が「0422 年 29 月 00 日」のように
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
  // 消費税の合計。合計を含むのに合計ではない（実測の「（税合計 ¥11）」）。
  '税合計',
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

/// 座標は 0..1 の正規化・左上原点・y 下向き。環境差はネイティブ側で吸収済み。
export type OcrWord = {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  confidence?: number;
  /// 第 2 候補以降。確からしい順。
  alternates?: string[];
};

export type OcrLine = {
  text: string;
  words: OcrWord[];
  x: number;
  y: number;
  width: number;
  height: number;
};

export type OcrLayout = {
  lines: OcrLine[];
  text: string;
};
// ここから下は伝票の中身。店名は必ずこれより上にある。
const HEADER_END_KEYWORDS = ['登録番号', 'インボイス'];
// 大きく刷られるので、除かないと字の大きさで店名に勝つ。
const NOT_A_VENDOR = [
  '領収証',
  '領収書',
  'レシート',
  'お問合せ',
  'お問い合わせ',
  '明細',
  '控え',
  'ありがとう',
  'Help',
];
// 右端を止めないと、14 桁から先頭 13 桁を切り出して通してしまう（実測）。
const STRICT_INVOICE_RE = /(?<!\d)T\d{13}(?!\d)/;
// 軽減税率の印など、品名そのものではない頭の記号。
const ITEM_NAME_NOISE = /^[\s*＊#＃!！・:：]+/;
const ITEM_NAME_TAIL = /[\s¥￥\\]+$/;
// 電話番号や時刻を金額と取らないため。単単語の中に区切りがあれば金額ではない。
const NOT_AN_AMOUNT = /[-ー–—:：]/;
// 数字どうしが区切りで繋がる形。電話番号・時刻がこれに当たる。
const DIGIT_SEPARATED_RE = /\d[-ー–—:：]\d/;

export function extractFromOcrLayout(layout: OcrLayout): ReceiptExtracted {
  const result = extractFromOcrText(layout.text);
  const rows = layout.lines;
  const header = headerEnd(rows);
  const totalRow = findTotalRow(rows);

  const vendor = extractVendor(rows, header);
  if (vendor) {
    result.vendorName = vendor;
  }
  const total = totalFromRow(rows[totalRow]);
  if (total) {
    result.totalAmount = total;
  }
  result.items = extractItems(rows, header, totalRow);
  // 版面側が持ち切る。残すと、候補を見て「無し」と決めた後に古い誤りが生き残る。
  const invoice = invoiceFromCandidates(rows);
  if (invoice) {
    result.invoiceNumber = invoice;
  } else {
    delete result.invoiceNumber;
  }
  return result;
}
// 頭でいちばん大きい行。位置の比率では決めない（近接で撮ると頭が紙面の 30% に来る）。
function extractVendor(lines: OcrLine[], end: number): string {
  let best: OcrLine | undefined;
  for (const line of lines.slice(0, end)) {
    const text = line.text.trim();
    if (text.length < 2) {
      continue;
    }
    if (NOT_A_VENDOR.some((k) => text.includes(k))) {
      continue;
    }
    if (!best) {
      best = line;
      continue;
    }
    // 自信度は実測で 3 段しか出ないため、高さが並んだときの決め手にだけ使う。
    if (line.height > best.height + 1e-9) {
      best = line;
    } else if (
      Math.abs(line.height - best.height) < 1e-9 &&
      meanConfidence(line) > meanConfidence(best)
    ) {
      best = line;
    }
  }
  return best ? best.text.trim() : '';
}

function meanConfidence(line: OcrLine): number {
  const scored = line.words.filter((w) => w.confidence !== undefined);
  if (scored.length === 0) {
    return 0;
  }
  return scored.reduce((sum, w) => sum + w.confidence!, 0) / scored.length;
}

function headerEnd(lines: OcrLine[]): number {
  for (let i = 0; i < lines.length; i += 1) {
    const text = lines[i]!.text;
    if (HEADER_END_KEYWORDS.some((k) => text.includes(k))) {
      return i;
    }
    if (extractDate(text) !== '' || parseAmounts(text).length > 0) {
      return i;
    }
  }
  return lines.length;
}
// 除外語を先に見るのは「（税合計」のように合計を含んで合計でない行があるため。
function findTotalRow(lines: OcrLine[]): number {
  for (let i = 0; i < lines.length; i += 1) {
    const text = lines[i]!.text;
    if (TOTAL_KEYWORDS_EXCLUDE.some((k) => text.includes(k))) {
      continue;
    }
    if (TOTAL_KEYWORDS_INCLUDE.some((k) => text.includes(k))) {
      return i;
    }
  }
  return lines.length;
}
// 右端の金額を取る。「合計／ 1点 ¥248」のように点数が並ぶ書式で取り違えないため。
function totalFromRow(line: OcrLine | undefined): string {
  if (!line) {
    return '';
  }
  const amount = rightmostAmount(line);
  return amount === undefined ? '' : String(amount);
}

function rightmostAmount(line: OcrLine): number | undefined {
  for (const word of [...line.words].sort((a, b) => b.x - a.x)) {
    if (NOT_AN_AMOUNT.test(word.text)) {
      continue;
    }
    const amounts = parseAmounts(word.text);
    if (amounts.length > 0) {
      return amounts[amounts.length - 1];
    }
  }
  return undefined;
}
// 行末の金額。単語からは組み立てない。1 単語 = 1 文字で返す環境があり、そこでは
// 「最後の単語」が数字の断片になって電話番号が金額に化ける（実測。`0422ー29ー0051`
// の末尾が `51` として通った）。行の文字列は環境ごとの正しい区切りで繋がれている。
const TRAILING_AMOUNT_RE = /^(.*?)[\s]*([¥￥\\]?\s*\d{1,3}(?:[,.]+\d{3})*|[¥￥\\]?\s*\d+)\s*$/;

// 頭より下・合計より上で、左に品名・右に金額。電話番号やレジ番号も同じ形で並ぶため、
// 数字の直前に区切りがある物と、左が日付・数字だけの行は外す。取り違えるくらいなら拾わない。
function extractItems(lines: OcrLine[], header: number, totalRow: number): ReceiptItem[] {
  const items: ReceiptItem[] = [];
  for (const line of lines.slice(header + 1, totalRow)) {
    if (line.words.length < 2 || !hasAmountOnTheRight(line)) {
      continue;
    }
    const m = TRAILING_AMOUNT_RE.exec(line.text.trim());
    if (!m) {
      continue;
    }
    const head = m[1]!;
    // 電話番号・時刻は数字と数字が区切りで繋がる。直前の 1 文字で見てはいけない。
    // カタカナの品名は長音符で終わることが多く、それを区切りと取ると全部落ちる
    // （`ミネラルウォーター` で踏んだ）。
    if (DIGIT_SEPARATED_RE.test(line.text)) {
      continue;
    }
    // 金額は 0 で始まらない。伝票番号やレジ番号は 0 詰めで並ぶので、ここで落ちる
    // （実測の `責No00891337` が 891337 円の品目になっていた）。単独の 0 は通す。
    if (/^0\d/.test(m[2]!.replace(/[¥￥\\\s]/g, ''))) {
      continue;
    }
    const amounts = parseAmounts(m[2]!);
    if (amounts.length === 0) {
      continue;
    }
    const name = head.replace(ITEM_NAME_NOISE, '').replace(ITEM_NAME_TAIL, '').trim();
    if (name === '' || extractDate(name) !== '' || /^[\d\s,.]+$/.test(name)) {
      continue;
    }
    items.push({ description: name, amount: String(amounts[amounts.length - 1]) });
  }
  return items;
}
// 金額が右の欄にあることは座標で確かめる。行の文字列だけで見ると、文中の数字を
// 拾ってしまう。
function hasAmountOnTheRight(line: OcrLine): boolean {
  const ordered = [...line.words].sort((a, b) => a.x - b.x);
  const last = ordered[ordered.length - 1]!;
  return parseAmounts(last.text).length > 0;
}
// 先頭の候補が誤っていても次が正しいことがある（実測。しかも自信度は最大）。
// 形式に合う候補が 1 つも無ければ空にする。桁数の違う番号を通すと利用者は気付けない。
function invoiceFromCandidates(lines: OcrLine[]): string | undefined {
  for (const line of lines) {
    for (const word of line.words) {
      for (const candidate of [word.text, ...(word.alternates ?? [])]) {
        const hit = STRICT_INVOICE_RE.exec(candidate)?.[0];
        if (hit) {
          return hit;
        }
      }
    }
    // `T` が「登録番号T」のように見出しの末尾へくっつく書式は、繋いでからでないと
    // 揃わない。見出しのある行に限らないと、`T` で終わる単語と 13 桁が隣り合った
    // だけで番号を作ってしまう（伝票番号や取引 ID が該当する）。
    if (!HEADER_END_KEYWORDS.some((k) => line.text.includes(k))) {
      continue;
    }
    const joined = STRICT_INVOICE_RE.exec(line.text.replace(/\s+/g, ''))?.[0];
    if (joined) {
      return joined;
    }
  }
  return undefined;
}
