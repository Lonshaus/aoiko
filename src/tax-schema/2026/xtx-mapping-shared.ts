import type { XtxSchema } from './xtx-schema';
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
