// 不動産所得（B7 part2）の損益計算補正。
//
// aoiko の PL 計算自体（buildPL）は incomeType: 'realEstate' の仕訳から損益を出す。
// このファイルは、その損益に対して不動産所得特有の3つの補正を掛ける：
//  1. 事業的規模でない場合の専従者給与（不動産）の全額不算入
//     （事業所得の白色申告専従者控除とは別物。事業的規模でなければ実額を使った
//     専従者給与そのものが認められない。国税庁タックスアンサー No.1370 参照）
//  2. 事業所得と不動産所得を合算した場合の青色申告特別控除（65/55/10万）の
//     単一共有枠での配分（不動産所得から先に控除、残りを事業所得から控除）。
//     事業的規模でない不動産所得は単独では65/55万の対象外（10万が上限）だが、
//     事業所得側が単独で65万等の資格を満たしていれば、その枠は不動産所得にも及ぶ
//     （国税庁タックスアンサー No.2072、事業所得が無ければ不動産所得側の
//     事業的規模の有無だけで上限が決まる）
//  3. 不動産所得が赤字のとき、土地等を取得するために要した負債の利子の額に
//     相当する部分は他の所得と損益通算できない（措法41条の4）。按分計算は
//     複雑なため確定額を直接入力する方針（RealEstateIncomeInput 参照）。

import { D, type Decimal } from '../../lib/decimal';
import type { PLReport } from '../../domain/reports';
import type {
  RealEstateLoanInterestPaidDetail,
  RealEstateProfessionalFeeDetail,
  RealEstateRentPaidDetail,
} from '../../db/types';
import {
  aoiroDeductionAmount,
  aoiroDeductionLimit,
  type AoiroDeductionKind,
} from './aoiro-deduction';

export const REAL_ESTATE_SENJUSHA_ACCOUNT_NAME = '専従者給与（不動産）';

// XtxContext 側で使う不動産所得の入力形状。支払先明細（地代家賃・借入金利子・
// 税理士等報酬）は KOA220/KOA130 へそのまま転記するだけの確定額のため、計算対象の
// landLoanInterestAmount 以外は DB 保存形状（文字列）のまま持つ（putRow 側で直接使う、
// xtx-mapping-koa110.ts の FixedAsset.acquisitionCost と同じ扱い）。
export interface RealEstateIncomeCtx {
  businessScale: boolean;
  landLoanInterestAmount?: Decimal;
  rentPaid?: RealEstateRentPaidDetail[];
  loanInterestPaid?: RealEstateLoanInterestPaidDetail[];
  professionalFeesPaid?: RealEstateProfessionalFeeDetail[];
}

export interface CombinedBusinessRealEstateIncome {
  /** 事業所得の所得金額（青色控除後）。赤字ならマイナス */
  businessIncome: Decimal;
  /** 不動産所得の所得金額（青色控除後）。赤字ならマイナス */
  realEstateIncomeAfterDeduction: Decimal;
  /** 他の所得と損益通算できる不動産所得（土地等負債利子額による制限後）。0以下 */
  realEstateOffsettable: Decimal;
  /** 事業所得 + 損益通算できる不動産所得（合計所得金額の算定に使う） */
  combinedIncome: Decimal;
}

// 事業所得と不動産所得（あれば）を合わせた所得金額。青色申告特別控除の共有枠配分・
// 土地等負債利子額による損益通算制限まで含めて算定する。realEstatePl/realEstateInput が
// 無ければ不動産所得ゼロ扱い（既存の単一事業所得の計算結果と完全に一致する）。
export function computeCombinedBusinessRealEstateIncome(
  year: number,
  aoiroKind: AoiroDeductionKind,
  hasBusinessIncome: boolean,
  businessPreDeductionIncome: Decimal,
  realEstatePl: PLReport | undefined,
  realEstateInput: RealEstateIncomeCtx | undefined,
): CombinedBusinessRealEstateIncome {
  if (!realEstatePl || !realEstateInput) {
    const deduction = aoiroDeductionAmount(year, aoiroKind, businessPreDeductionIncome);
    const businessIncome = businessPreDeductionIncome.minus(deduction);
    return {
      businessIncome,
      realEstateIncomeAfterDeduction: D(0),
      realEstateOffsettable: D(0),
      combinedIncome: businessIncome,
    };
  }
  const realEstatePreIncome = realEstatePreDeductionIncome(
    realEstatePl,
    realEstateInput.businessScale,
  );
  const allocation = allocateAoiroDeduction(
    year,
    aoiroKind,
    hasBusinessIncome,
    realEstateInput.businessScale,
    businessPreDeductionIncome,
    realEstatePreIncome,
  );
  const businessIncome = businessPreDeductionIncome.minus(allocation.businessDeduction);
  const realEstateIncomeAfterDeduction = realEstatePreIncome.minus(allocation.realEstateDeduction);
  const realEstateOffsettable = offsettableRealEstateLoss(
    realEstateIncomeAfterDeduction,
    realEstateInput.landLoanInterestAmount ?? D(0),
  );
  return {
    businessIncome,
    realEstateIncomeAfterDeduction,
    realEstateOffsettable,
    combinedIncome: businessIncome.plus(realEstateOffsettable),
  };
}

// 事業的規模でない場合、専従者給与（不動産）は全額不算入（控除前所得に戻す）。
// pl.netIncome は通常の経費として控除済みのため、その分だけ加算し直す。
export function realEstatePreDeductionIncome(pl: PLReport, businessScale: boolean): Decimal {
  const netIncome = D(pl.netIncome);
  if (businessScale) {
    return netIncome;
  }
  const disallowed = pl.expense
    .filter((r) => r.accountName === REAL_ESTATE_SENJUSHA_ACCOUNT_NAME)
    .reduce((sum, r) => sum.plus(D(r.amount)), D(0));
  return netIncome.plus(disallowed);
}

// 事業所得・不動産所得を合算した場合の青色申告特別控除に使う実効区分。
// 事業所得が無く（またはゼロ以下）、かつ不動産所得が事業的規模でない場合、
// 65万/55万は使えず 10万（simple）が上限になる。
export function combinedAoiroDeductionKind(
  kind: AoiroDeductionKind,
  hasBusinessIncome: boolean,
  businessScale: boolean,
): AoiroDeductionKind {
  if (hasBusinessIncome || businessScale || kind === 'none' || kind === 'simple') {
    return kind;
  }
  return 'simple';
}

export interface CombinedAoiroDeductionResult {
  realEstateDeduction: Decimal;
  businessDeduction: Decimal;
  totalDeduction: Decimal;
}

// 単一の共有枠を、不動産所得から先に・残りを事業所得から控除する形で配分する。
// 基準額は両所得の黒字分の合計（赤字は0扱い）。
export function allocateAoiroDeduction(
  year: number,
  kind: AoiroDeductionKind,
  hasBusinessIncome: boolean,
  businessScale: boolean,
  businessPreDeductionIncome: Decimal,
  realEstatePreDeductionIncome: Decimal,
): CombinedAoiroDeductionResult {
  const effectiveKind = combinedAoiroDeductionKind(kind, hasBusinessIncome, businessScale);
  const limit = aoiroDeductionLimit(year, effectiveKind);
  const businessBase = businessPreDeductionIncome.greaterThan(0)
    ? businessPreDeductionIncome
    : D(0);
  const realEstateBase = realEstatePreDeductionIncome.greaterThan(0)
    ? realEstatePreDeductionIncome
    : D(0);
  const combinedBase = businessBase.plus(realEstateBase);
  const totalDeduction = combinedBase.lessThan(limit) ? combinedBase : limit;
  const realEstateDeduction = totalDeduction.lessThan(realEstateBase)
    ? totalDeduction
    : realEstateBase;
  const businessDeduction = totalDeduction.minus(realEstateDeduction);
  return { realEstateDeduction, businessDeduction, totalDeduction };
}

// 不動産所得が赤字のとき、土地等取得に係る負債の利子の額に相当する部分は
// 他の所得と損益通算できない。損益通算可能な金額（0以下）を返す。
export function offsettableRealEstateLoss(
  incomeAfterDeduction: Decimal,
  landLoanInterestAmount: Decimal,
): Decimal {
  if (incomeAfterDeduction.greaterThanOrEqualTo(0)) {
    return incomeAfterDeduction;
  }
  const lossMagnitude = incomeAfterDeduction.abs();
  const excluded = lossMagnitude.lessThan(landLoanInterestAmount)
    ? lossMagnitude
    : landLoanInterestAmount;
  return incomeAfterDeduction.plus(excluded);
}
