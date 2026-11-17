import type { XtxSchema } from './xtx-schema';
import { D, Decimal } from '../../lib/decimal';
import { readStoredAmount } from '../../lib/amount-input';
import { m } from '../../paraglide/messages';
// KOA110／KOA210 共通：追加科目欄へ出す前の科目名整形。
// 末尾の全角括弧付き分類（個別評価／一括評価／不動産等）は科目名の様式欄には不要な
// 内部区分のため取り除く。取り除いても文字数上限を超える場合のみ slice で
// 切り詰める（呼び出し側のバックストップ）。
export function stripClassificationSuffix(name: string): string {
  return name.replace(/（[^（）]*）$/, '');
}
// 繰り返し欄の行数上限は様式 schema の maxOccurs が唯一の根拠。mapping 側に数値を持たない。
export function maxOccursOf(schema: XtxSchema, tag: string): number {
  const element = schema.refTree.find((e) => e.tag === tag);
  if (!element) {
    throw new Error(`様式 schema に ${tag} がありません`);
  }
  return element.maxOccurs === 'unbounded' ? Number.POSITIVE_INFINITY : element.maxOccurs;
}
// 明細欄の上限を超えて .xtx へ出せなかった行（xtx.ts の xtxDetailOverflow が帳票 ID を付けて返す）。
export type XtxDetailOverflowSection =
  | 'depreciation'
  | 'realEstateProperty'
  | 'rentPaid'
  | 'loanInterestPaid'
  | 'professionalFee'
  | 'familyEmployee';

export interface XtxDetailOverflowRow {
  section: XtxDetailOverflowSection;
  // 資産名・物件所在地・支払先氏名・専従者氏名。空白のときは空文字（表示側で amount を使う）
  label: string;
  amount: string;
}
export class XtxAmountOutOfRangeError extends Error {
  readonly tag: string;
  constructor(tag: string) {
    super(m.xtx_amount_out_of_range({ tag }));
    this.name = 'XtxAmountOutOfRangeError';
    this.tag = tag;
  }
}
// gen:kingaku は 15 桁までの整数（General.xsd）。読めない値・桁あふれを黙って省くと申告書の欄が空になるため、
// 欄の tag 付きで投げる。文字列は保存済みの値の検査（readStoredAmount・validateFixedAsset）と同じ読み方にする
export function toKingaku(value: unknown, tag: string): string {
  let d: Decimal;
  if (value instanceof Decimal) {
    d = value;
  } else if (typeof value === 'number' && Number.isFinite(value)) {
    d = D(value);
  } else if (typeof value === 'string') {
    const t = value.replace(/,/g, '').trim();
    if (t === '') {
      return '';
    }
    const read = readStoredAmount(t);
    if (read === undefined) {
      throw new XtxAmountOutOfRangeError(tag);
    }
    d = read;
  } else {
    throw new XtxAmountOutOfRangeError(tag);
  }
  if (!d.isFinite() || !d.abs().lt('1e15')) {
    throw new XtxAmountOutOfRangeError(tag);
  }
  const truncated = d.trunc();
  if (truncated.isZero()) {
    return '0';
  }
  const s = truncated.toFixed(0);
  if (!/^-?\d{1,15}$/.test(s)) {
    throw new XtxAmountOutOfRangeError(tag);
  }
  return s;
}
