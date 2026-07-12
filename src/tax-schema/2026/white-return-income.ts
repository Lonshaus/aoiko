// 白色申告における事業所得の補正計算。
//
// 専従者給与・貸倒引当金繰入額は白色申告の収支内訳書・確定申告書のどちらにも
// そのまま転記できない（専従者給与は実額ではなく続柄で決まる定額の専従者控除に
// 置き換わり、貸倒引当金繰入額は白色申告の制度上対応が無い）。しかし aoiko の
// pl.netIncome はこれらを通常の経費として控除済みのため、そのまま所得として
// 使うと除外した科目の分だけ過小になる。この補正は KOA020（事業所得）・KOA110
// （専従者控除前の所得金額）の両方で必要なため、共通化する。

import { D, type Decimal } from '../../lib/decimal';
import type { PLReport } from '../../domain/reports';

export const WHITE_RETURN_UNMAPPABLE_EXPENSE_ACCOUNTS = new Set(['専従者給与', '貸倒引当金繰入額']);

export function whiteReturnAdjustedNetIncome(pl: PLReport): Decimal {
  const excluded = pl.expense
    .filter((r) => WHITE_RETURN_UNMAPPABLE_EXPENSE_ACCOUNTS.has(r.accountName))
    .reduce((sum, r) => sum.plus(D(r.amount)), D(0));
  return D(pl.netIncome).plus(excluded);
}
