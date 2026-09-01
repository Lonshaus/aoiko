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

// 右端を止めないと、1 桁多く読まれたときに先頭 13 桁を切り出して通してしまう（実測）。
// 形式が合っているぶん、利用者は誤りに気付けない。桁数が違うなら空欄にする。
const INVOICE_NUMBER_RE = /(?<!\d)T\d{13}(?!\d)/;
// 登録番号を名乗る行の見出し。行を限らないと、別の 13 桁を登録番号に化けさせる。
const INVOICE_LABELS = ['登録番号', 'インボイス'];
const BARE_INVOICE_NUMBER_RE = /(?<!\d)\d{13}(?!\d)/;
// 年は 19xx / 20xx に限る。市外局番から始まる電話番号が「0499 年 99 月 99 日」のように
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
// OCR は字間に空白を挟むことがある（実測の `合 計 ¥460`）。潰してから見ないと見出しの
// 一致が外れ、合計が後備へ落ちて番号を掴む。
function includesAny(text: string, words: string[]): boolean {
  const flat = text.replace(/\s+/g, '');
  return words.some((w) => flat.includes(w));
}
// 金額の印。番号の類には付かないので、語で決められないときの裏付けに使う。
const CURRENCY_MARK_RE = /[¥￥\\]|円/;
const TOTAL_KEYWORDS_INCLUDE = ['合計', 'お買上げ', 'お買上', '総額', 'ご請求'];
// 語による判定が空振りしたときの保険で使う。合計ではないと確実に判る行を落とすためだけの
// 一覧なので、主の判定より広く取る。
const NOT_A_TOTAL = [
  '小計',
  '税率',
  '対象',
  '消費税',
  '税合計',
  '商品代金',
  '値引',
  '割引',
  'お預り',
  'お預かり',
  'お釣',
  '釣銭',
  '現金',
  'ポイント',
  '還元',
  '番号',
  // クレジット控えの見出し。番号は桁数が多く、少額決済では実額より大きくなる。
  '会社名',
  '承認',
  '取引日',
  '伝票',
  '一括',
  'AID',
];
const TOTAL_KEYWORDS_EXCLUDE = [
  '小計',
  // 消費税の合計。合計を含むのに合計ではない（実測の「（税合計 ¥11）」）。
  '税合計',
  // 値引きの合計。同じく合計を含むが合計ではない（実測の「（値引合計 -20）」）。
  '値引合計',
  '割引合計',
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

// 先頭の `T` が落ちて返ることがある（実測。自信度は最大なので誤りと分からない）。
// 候補を持たない素のテキスト経路だけの補い方で、版面経路は候補から選ぶ。
function recoverInvoiceNumber(lines: string[]): string | undefined {
  for (const line of lines) {
    if (!includesAny(line, INVOICE_LABELS)) {
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
    if (includesAny(line, TOTAL_KEYWORDS_EXCLUDE)) {
      continue;
    }
    if (!includesAny(line, TOTAL_KEYWORDS_INCLUDE)) {
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

// 金額の末尾の 0 が大文字の O として返ることがある（実測の `¥460` → `f46O`）。
// 数字が途中で切れて金額が一桁少なくなり、しかも空欄ではなく誤った値が入る。
// 数字に挟まれた位置と、数字の後の語尾だけを直す。`責No.999` のような見出しは
// O の前が数字でないため触らない。
const OCR_ZERO_AS_LETTER_RE = /(?<=\d)[Oo〇Ｏ](?=\d|$)/g;

function parseAmounts(raw: string): number[] {
  const s = raw.replace(OCR_ZERO_AS_LETTER_RE, '0');
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
  /// 文字の基線の傾き（この正規化座標での dy/dx）。向きを返せる引擎だけが入れる。
  /// 角度ではなく傾きで渡すのは、角度からの換算に画素の縦横比が要り、それを知っている
  /// のはネイティブ側だけのため。
  slope?: number;
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
// 軽減税率の印など、品名そのものではない頭の記号。
const ITEM_NAME_NOISE = /^[\s*＊#＃!！・:：]+/;
const ITEM_NAME_TAIL = /[\s¥￥\\*＊]+$/;
// 値引きの符号。長音符は入れない。カタカナの品名が長音符で終わると全部これに掛かる。
const DISCOUNT_SIGN = /[-−－▲△]\s*$/;
// 合計欄より上に並ぶ集計行。金額が右に立つ形は品目と同じなので、語で外す。
const NOT_AN_ITEM = [
  '小計',
  '消費税',
  '税率',
  '対象',
  '商品代金',
  '合計',
  'お預り',
  'お釣',
  '釣銭',
];
// 数字どうしが区切りで繋がる形。電話番号・時刻がこれに当たる。
const DIGIT_SEPARATED_RE = /\d[-ー–—:：]\d/;

// 幅の狭い語は基線が短く、傾きが出ない。短い語では 0 がそのまま返ることが多く、
// 混ぜると中央値が 0 へ寄る。
const SKEW_MIN_WORD_WIDTH = 0.05;
// これを下回る傾きは補正しない。手持ちで撮った実写は 2 度ほど傾いており、そこまで直すと
// 別の劣化（ぼかし）で店名を取り違えた。浅い傾きは直さないほうが総じて良い、という
// 実測に基づく値。5 度の傾きは 0.03 を超えるので拾える。
const SKEW_DEAD_ZONE = 0.03;
const SKEW_MIN_SAMPLES = 5;
// ネイティブ側の行組み立ては文字線が水平である前提で、傾けて撮ると左右で列が割れる
// （実測 5 度で品名と金額が別の行になった）。語まで戻し、紙面の傾きを見込んで組み直す。
export function regroupWithSkew(layout: OcrLayout): OcrLayout {
  const words = layout.lines.flatMap((l) => l.words);
  if (words.length === 0) {
    return layout;
  }
  const separator = detectSeparator(layout);
  const slope = pageSkew(words);
  const key = (w: OcrWord): number => w.y + w.height / 2 - slope * (w.x + w.width / 2);
  // 傾いた文字を軸に平行な矩形で囲むと、横に長い語ほど枠が縦に伸びる。伸びた分を引かない
  // と閾値が広がり、上下の別の行まで吸い込む。伸びを引き切って 0 にはしない。
  const band = (w: OcrWord): number => Math.max(w.height - w.width * Math.abs(slope), w.height / 3);
  const sorted = [...words].sort((a, b) => key(a) - key(b));
  const rows: OcrWord[][] = [];
  for (const w of sorted) {
    const head = rows[rows.length - 1]?.[0];
    if (head && Math.abs(key(head) - key(w)) <= Math.max(band(head), band(w)) / 2) {
      rows[rows.length - 1]!.push(w);
      continue;
    }
    rows.push([w]);
  }
  const lines: OcrLine[] = [];
  for (const row of rows) {
    const ordered = [...row].sort((a, b) => a.x - b.x);
    const text = ordered.map((w) => w.text).join(separator);
    if (text === '') {
      continue;
    }
    const left = Math.min(...ordered.map((w) => w.x));
    const top = Math.min(...ordered.map((w) => w.y));
    lines.push({
      text,
      words: ordered,
      x: left,
      y: top,
      width: Math.max(...ordered.map((w) => w.x + w.width)) - left,
      height: Math.max(...ordered.map((w) => w.y + w.height)) - top,
    });
  }
  return { lines, text: lines.map((l) => l.text).join('\n') };
}
// 語ごとの傾きの中央値。平均だと 1 語の誤りで紙面全体がずれる。
function pageSkew(words: OcrWord[]): number {
  const samples = words
    .filter((w) => w.slope !== undefined && w.width > SKEW_MIN_WORD_WIDTH)
    .map((w) => w.slope!)
    .sort((a, b) => a - b);
  if (samples.length < SKEW_MIN_SAMPLES) {
    return 0;
  }
  const mid = Math.floor(samples.length / 2);
  const value = samples.length % 2 === 1 ? samples[mid]! : (samples[mid - 1]! + samples[mid]!) / 2;
  return Math.abs(value) < SKEW_DEAD_ZONE ? 0 : value;
}
// 語の接合符は環境で違う（1 語 = 1 文字で返す環境では空文字で繋がれている）。
// ネイティブが組んだ行と語を突き合わせれば判るので、橋渡しに欄を足さずに済む。
// 1 語の行では区別が付かないため、2 語以上の行だけで多数決を取る。
function detectSeparator(layout: OcrLayout): string {
  let spaced = 0;
  let joined = 0;
  for (const line of layout.lines) {
    if (line.words.length < 2) {
      continue;
    }
    const texts = line.words.map((w) => w.text);
    if (line.text === texts.join(' ')) {
      spaced += 1;
    } else if (line.text === texts.join('')) {
      joined += 1;
    }
  }
  return joined > spaced ? '' : ' ';
}

export function extractFromOcrLayout(input: OcrLayout): ReceiptExtracted {
  const layout = regroupWithSkew(input);
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
    if (includesAny(text, NOT_A_VENDOR)) {
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
    if (includesAny(text, INVOICE_LABELS)) {
      return i;
    }
    // 文中の数字では頭は終わらない。店名や住所に数字が混じるだけで店名が取れなくなる
    // （実測。商標が `3` と読まれ `3セブン-イレブン` になった）。
    if (extractDate(text) !== '' || hasAmountOnTheRight(lines[i]!)) {
      return i;
    }
  }
  return lines.length;
}
// 除外語を先に見るのは「（税合計」のように合計を含んで合計でない行があるため。
function findTotalRow(lines: OcrLine[]): number {
  for (let i = 0; i < lines.length; i += 1) {
    const text = lines[i]!.text;
    if (includesAny(text, TOTAL_KEYWORDS_EXCLUDE)) {
      continue;
    }
    // 金額の無い行は合計ではない。語だけで見ると「お買上明細は上記のとおりです。」の
    // ような案内文を掴む（実測）。
    if (includesAny(text, TOTAL_KEYWORDS_INCLUDE) && parseAmounts(text).length > 0) {
      return i;
    }
  }
  return totalRowWithoutKeyword(lines);
}
// 合計の語が読めないことがある（実測。「合 計」を「言十」と読み、金額だけが
// 正しく残った）。語で見つからないときだけ、合計ではないと判る行を落としてから最大額を取る。
function totalRowWithoutKeyword(lines: OcrLine[]): number {
  let found = lines.length;
  let largest = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    if (includesAny(line.text, NOT_A_TOTAL) || !hasAmountOnTheRight(line)) {
      continue;
    }
    // 語で決められない以上、金額であることの裏付けが要る。番号に通貨記号は付かない。
    if (!CURRENCY_MARK_RE.test(line.text)) {
      continue;
    }
    const amounts = parseAmounts(line.text);
    const amount = amounts[amounts.length - 1];
    if (amount !== undefined && amount > largest) {
      largest = amount;
      found = i;
    }
  }
  return found;
}
// 行末の金額を取る。「合計／ 1点 ¥248」のように点数が並ぶ書式で取り違えないため。
// 単語からは取らない。1 単語 = 1 文字で返す環境では右端が数字の断片になる（実測。
// 「合計 ¥532」が 2 として通った）。行の文字列は環境ごとの正しい区切りで繋がれている。
function totalFromRow(line: OcrLine | undefined): string {
  if (!line) {
    return '';
  }
  const amounts = parseAmounts(line.text);
  return amounts.length === 0 ? '' : String(amounts[amounts.length - 1]);
}
// 行末の金額。単語からは組み立てない。1 単語 = 1 文字で返す環境があり、そこでは
// 「最後の単語」が数字の断片になって電話番号が金額に化ける（実測。`0422ー29ー0051`
// の末尾が `51` として通った）。行の文字列は環境ごとの正しい区切りで繋がれている。
const TRAILING_AMOUNT_RE =
  /^(.*?)[\s]*([¥￥\\]?\s*\d{1,3}(?:[,.]+\d{3})*|[¥￥\\]?\s*\d+)[\s軽減※*＊#＃]*$/;
// 軽減税率の印は金額の直後に付く（実測の `¥138軽`）。数字で終わることを求めると、
// 食品を買ったレシートの品目が行ごと落ちる。印の書式に定めは無く、店ごとに
// 軽 / 軽減 / ※ / * が使われる。括弧付きは数字を含む欄と紛れるので入れない。
const TAX_RATE_MARK_TAIL = /[\s軽減※*＊#＃]+$/;
// 印だけが独立した単語で返る環境がある（`¥162 軽`）。右端を見る前に落とす。
const TAX_RATE_MARK_ONLY = /^[\s軽減※*＊#＃]+$/;

// 頭より下・合計より上で、左に品名・右に金額。電話番号やレジ番号も同じ形で並ぶため、
// 数字の直前に区切りがある物と、左が日付・数字だけの行は外す。取り違えるくらいなら拾わない。
function extractItems(lines: OcrLine[], header: number, totalRow: number): ReceiptItem[] {
  const items: ReceiptItem[] = [];
  for (const line of lines.slice(header + 1, totalRow)) {
    if (line.words.length < 2 || !hasAmountOnTheRight(line)) {
      continue;
    }
    if (includesAny(line.text, NOT_AN_ITEM)) {
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
    const name = head
      .replace(ITEM_NAME_NOISE, '')
      .replace(DISCOUNT_SIGN, '')
      .replace(ITEM_NAME_TAIL, '')
      .trim();
    if (name === '' || extractDate(name) !== '' || /^[\d\s,.]+$/.test(name)) {
      continue;
    }
    // 符号を落とすと値引きが消費として入る（実測の「値引額 -20」が +20 になった）。
    const signed = DISCOUNT_SIGN.test(head)
      ? -amounts[amounts.length - 1]!
      : amounts[amounts.length - 1]!;
    items.push({ description: name, amount: String(signed) });
  }
  return items;
}
// 金額が右の欄にあることは座標で確かめる。行の文字列だけで見ると、文中の数字を
// 拾ってしまう。
function hasAmountOnTheRight(line: OcrLine): boolean {
  const ordered = [...line.words].sort((a, b) => a.x - b.x);
  while (ordered.length > 1 && TAX_RATE_MARK_ONLY.test(ordered[ordered.length - 1]!.text)) {
    ordered.pop();
  }
  const last = ordered[ordered.length - 1]!;
  // 金額だけの欄であることまで見る。文中に数字があるだけの行を金額の行と取ると、
  // 店名が頭から外れる（実測。商標が `3` と読まれ `3セブン-イレブン` になった）。
  return /^[¥￥\\*＊\s]*[-−－▲△]?\s*[\d,.]+$/.test(last.text.replace(TAX_RATE_MARK_TAIL, ''));
}
// 先頭の候補が誤っていても次が正しいことがある（実測。しかも自信度は最大）。
// 形式に合う候補が 1 つも無ければ空にする。桁数の違う番号を通すと利用者は気付けない。
function invoiceFromCandidates(lines: OcrLine[]): string | undefined {
  for (const line of lines) {
    for (const word of line.words) {
      for (const candidate of [word.text, ...(word.alternates ?? [])]) {
        const hit = INVOICE_NUMBER_RE.exec(candidate)?.[0];
        if (hit) {
          return hit;
        }
      }
    }
    // `T` が「登録番号T」のように見出しの末尾へくっつく書式は、繋いでからでないと
    // 揃わない。見出しのある行に限らないと、`T` で終わる単語と 13 桁が隣り合った
    // だけで番号を作ってしまう（伝票番号や取引 ID が該当する）。
    if (!INVOICE_LABELS.some((k) => line.text.includes(k))) {
      continue;
    }
    const joined = INVOICE_NUMBER_RE.exec(line.text.replace(/\s+/g, ''))?.[0];
    if (joined) {
      return joined;
    }
  }
  return undefined;
}
