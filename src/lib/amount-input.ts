import { D, type Decimal } from './decimal';
import { m } from '../paraglide/messages';
// 全角数字・全角カンマは IME の入力モードの差、桁区切りと前後の空白は書き方の差でしかないため吸収する
export function normalizeAmountInput(raw: string): string {
  return raw.normalize('NFKC').replace(/,/g, '').trim();
}
// 0 以上の数だけを金額として読む（allowNegative なら負も読む）。D() が通す指数・16 進表記は金額欄の入力として扱わない
export function parseAmountInput(
  raw: unknown,
  options: { allowNegative?: boolean } = {},
): Decimal | undefined {
  if (typeof raw !== 'string') {
    return undefined;
  }
  const s = normalizeAmountInput(raw);
  const pattern = options.allowNegative === true ? /^-?\d+(\.\d+)?$/ : /^\d+(\.\d+)?$/;
  return pattern.test(s) ? D(s) : undefined;
}
// 書き方だけを見る。.xtx の「未記入」判定のように、読める値の大きさを問わない箇所はこちらを使う
export function isAmountInputMalformed(raw: unknown): boolean {
  if (typeof raw !== 'string') {
    return true;
  }
  return normalizeAmountInput(raw) !== '' && parseAmountInput(raw) === undefined;
}
// 円単位の金額欄なので小数部分のある値は書き方が正しくても誤りとする（1234.0 のように小数部分が 0 なら整数として通す）
function hasFraction(raw: unknown): boolean {
  const parsed = parseAmountInput(raw);
  return parsed !== undefined && !parsed.isInteger();
}
// 保存してはいけない値：書き方が正しくない、または 100 兆円以上（索引の 14 桁と .xtx の 15 桁に収まらない）
export function isAmountInputInvalid(raw: unknown): boolean {
  return isAmountInputMalformed(raw) || hasFraction(raw) || isJournalAmountTooLarge(raw);
}
// 欄に出す理由。有効なら空文字
export function amountInputError(raw: unknown): string {
  if (isAmountInputMalformed(raw)) {
    return m.common_amount_invalid();
  }
  if (isJournalAmountTooLarge(raw)) {
    return m.common_amount_too_large();
  }
  return hasFraction(raw) ? m.common_amount_invalid() : '';
}
// 有効 28 桁の toString() は指数 -1000〜1000 なら 35 文字以内に収まる
const MAX_NON_PLAIN_LENGTH = 64;
const EXPONENT_LIMIT = 1000;
// 保存済みの文字列を数として読む。1e3・0x10 のような書き方も D() に任せるが、D() は長い 16 進文字列で
// 時間がかかり、巨大な指数は toFixed で桁数分の文字列を作るため、長さと指数の範囲で弾く。投げない
export function parseStoredDecimal(
  v: unknown,
  options: { allowNegative: boolean },
): Decimal | undefined {
  if (typeof v !== 'string') {
    return undefined;
  }
  if (!/^-?\d+(\.\d+)?$/.test(v) && v.length > MAX_NON_PLAIN_LENGTH) {
    return undefined;
  }
  let d: Decimal;
  try {
    d = D(v);
  } catch {
    return undefined;
  }
  if (!d.isFinite() || !(d.e >= -EXPONENT_LIMIT && d.e <= EXPONENT_LIMIT)) {
    return undefined;
  }
  if (!options.allowNegative && d.isNegative()) {
    return undefined;
  }
  return d;
}
// 保存済みの値（復元された値を含む）を読む。投げない
export function readStoredAmount(v: unknown): Decimal | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) {
    return D(v);
  }
  return parseStoredDecimal(v, { allowNegative: true });
}
// 旧バージョンの仕訳明細の金額は type="number" の欄の値をそのまま保存していた（1e3・.5 など）。
// 読むのはその書き方だけ。長さを先に見るのは、この正規表現が長い数字列で後戻りを繰り返すため
export function parseLegacyLineAmount(v: string): Decimal | undefined {
  if (v.length > MAX_NON_PLAIN_LENGTH) {
    return undefined;
  }
  if (!/^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(v)) {
    return undefined;
  }
  return parseStoredDecimal(v, { allowNegative: false });
}
// 仕訳明細の金額は toIndexable の範囲（14 桁）に収める必要がある
export function isJournalAmountTooLarge(raw: unknown): boolean {
  const d = parseAmountInput(raw);
  return d !== undefined && d.gte('1e14');
}
// 整数欄用。読めない・範囲外・空欄はすべて undefined
export function parseIntegerInput(
  raw: unknown,
  range: { min: number; max: number },
): number | undefined {
  if (typeof raw !== 'string') {
    return undefined;
  }
  const s = normalizeAmountInput(raw);
  if (!/^-?\d+$/.test(s)) {
    return undefined;
  }
  const n = Number(s);
  return Number.isSafeInteger(n) && n >= range.min && n <= range.max ? n : undefined;
}
// 保存済みの値を入力欄の文字列にする。復元された値は数値や別の型でありうる
export function storedToInputText(v: unknown): string {
  if (typeof v === 'string') {
    return v;
  }
  return typeof v === 'number' && Number.isFinite(v) ? String(v) : '';
}
// 保存済みの金額の表示。formatJPY は toNumber を通して大きな整数や小数を丸めるため、桁区切りと小数は文字列のまま組み立てる
export function formatStoredAmount(v: unknown): string {
  const d = readStoredAmount(v);
  if (d === undefined) {
    return m.common_stored_amount_unreadable();
  }
  const [int = '0', frac = ''] = d.abs().toFixed().split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${d.isNegative() ? '-' : ''}¥${grouped}${frac === '' ? '' : `.${frac}`}`;
}
