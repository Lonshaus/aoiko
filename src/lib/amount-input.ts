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

export function isAmountInputInvalid(raw: string): boolean {
  return normalizeAmountInput(raw) !== '' && parseAmountInput(raw) === undefined;
}
