// 白色申告における事業所得の補正計算。
//
// 専従者給与は白色申告の収支内訳書・確定申告書のどちらにもそのまま転記できない
// （実額ではなく続柄で決まる定額の専従者控除に置き換わる）。貸倒引当金繰入額は
// 一括評価（所得税法52条2項）と個別評価（52条1項）で扱いが異なる：52条2項は
// 「青色申告書を提出する居住者」限定なので一括評価のみ白色では認められないが、
// 52条1項に青色の限定は無く、個別評価は白色でも通常どおり必要経費になる
// （国税庁『令和7年分 白色申告者の決算の手引き（一般用）』§34）。しかし aoiko の
// pl.netIncome はこれらを通常の経費として控除済みのため、そのまま所得として
// 使うと除外した科目の分だけ過小になる。この補正は KOA020（事業所得）・KOA110
// （専従者控除前の所得金額）の両方で必要なため、共通化する。

import { D, type Decimal } from '../../lib/decimal';
import type { PLReport } from '../../domain/reports';

export const WHITE_RETURN_UNMAPPABLE_EXPENSE_ACCOUNTS = new Set([
  '専従者給与',
  '貸倒引当金繰入額（一括評価）',
]);

export function whiteReturnAdjustedNetIncome(pl: PLReport): Decimal {
  const excluded = pl.expense
    .filter((r) => WHITE_RETURN_UNMAPPABLE_EXPENSE_ACCOUNTS.has(r.accountName))
    .reduce((sum, r) => sum.plus(D(r.amount)), D(0));
  return D(pl.netIncome).plus(excluded);
}
