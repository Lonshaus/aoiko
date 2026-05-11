import Decimal from 'decimal.js';

Decimal.set({ precision: 28, rounding: Decimal.ROUND_HALF_UP });

export { Decimal };

export type DecimalLike = Decimal | string | number;

export function D(value: DecimalLike): Decimal {
  return new Decimal(value);
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
  const fixed = d.toFixed(FRAC_DIGITS);
  const [intPart = '0', fracPart = ''] = fixed.split('.');
  return `${intPart.padStart(INT_DIGITS, '0')}.${fracPart.padEnd(FRAC_DIGITS, '0')}`;
}

export function fromIndexable(s: string): Decimal {
  return new Decimal(s);
}

const JPY_FORMATTER = new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 0 });

export function formatJPY(value: DecimalLike): string {
  const d = D(value);
  if (d.isNegative()) {
    return '-¥' + JPY_FORMATTER.format(d.abs().toNumber());
  }
  return '¥' + JPY_FORMATTER.format(d.toNumber());
}