import { D, type Decimal } from './decimal';
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

export function isAmountInputInvalid(raw: unknown): boolean {
  if (typeof raw !== 'string') {
    return true;
  }
  return normalizeAmountInput(raw) !== '' && parseAmountInput(raw) === undefined;
}
// 保存済みの値（復元された値を含む）を読む。1e3・0x10 のような旧い書き方も読むが、
// D() は長い 16 進文字列や巨大な指数で固まるため、長さと指数の範囲で先に弾く。投げない
export function readStoredAmount(v: unknown): Decimal | undefined {
  let d: Decimal;
  try {
    if (typeof v === 'string') {
      if (/^-?\d+(\.\d+)?$/.test(v)) {
        d = D(v);
      } else if (v.length <= 64) {
        d = D(v);
      } else {
        return undefined;
      }
    } else if (typeof v === 'number' && Number.isFinite(v)) {
      d = D(v);
    } else {
      return undefined;
    }
  } catch {
    return undefined;
  }
  if (!d.isFinite() || !(d.e >= -1000 && d.e <= 1000)) {
    return undefined;
  }
  return d;
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
