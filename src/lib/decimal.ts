import Decimal from 'decimal.js';
import { m } from '../paraglide/messages';

Decimal.set({ precision: 28, rounding: Decimal.ROUND_HALF_UP });

export { Decimal };

type DecimalLike = Decimal | string | number;

export function D(value: DecimalLike): Decimal {
  return new Decimal(value);
}

export class AmountTooLargeError extends Error {
  constructor() {
    super(m.common_amount_too_large());
    this.name = 'AmountTooLargeError';
  }
}
// 仕訳金額の保存形。toString() は 1e+21 や 1e-7 のような指数表記を返し、復元時の検証が拒むため使わない
export function toAmountString(d: Decimal): string {
  if (!d.isFinite() || !(d.e >= -1000 && d.e <= 1000)) {
    throw new AmountTooLargeError();
  }
  return d.toFixed();
}

const INT_DIGITS = 14;
const FRAC_DIGITS = 2;
// IndexedDB の辞書順インデックス用、14+2 桁ゼロパディングの固定幅文字列。
// 範囲：0 〜 99,999,999,999,999.99。非負前提（符号は借方/貸方で表現）。
export function toIndexable(value: DecimalLike): string {
  const d = D(value);
  if (d.isNegative()) {
    throw new Error(`toIndexable: negative amount not supported (${d.toString()})`);
  }
  // toFixed は巨大な指数だと桁数分の文字列を作ってしまうため、先に大きさで弾く
  if (!d.isFinite() || d.abs().gte('1e14')) {
    throw new AmountTooLargeError();
  }
  const fixed = d.toFixed(FRAC_DIGITS);
  const [intPart = '0', fracPart = ''] = fixed.split('.');
  if (intPart.length > INT_DIGITS) {
    throw new AmountTooLargeError();
  }
  return `${intPart.padStart(INT_DIGITS, '0')}.${fracPart.padEnd(FRAC_DIGITS, '0')}`;
}

const JPY_FORMATTER = new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 0 });

export function formatJPY(value: DecimalLike): string {
  const d = D(value);
  if (d.isNegative()) {
    return '-¥' + JPY_FORMATTER.format(d.abs().toNumber());
  }
  return '¥' + JPY_FORMATTER.format(d.toNumber());
}
