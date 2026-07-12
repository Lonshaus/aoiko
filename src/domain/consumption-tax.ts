// 消費税納付額の計算。
// 4 方式に対応：本則課税 / 簡易課税 / 2 割特例 / 3 割特例。
// 国税分（消費税申告書ベース）と地方消費税分を別個に算出、合計も出す。
// 経過措置：適格請求書なしの仕入は取引日に応じた控除率（80/70/50/30/0%）を適用。
//
// 仕訳分類：
//   売上税額 = revenue category、taxRate > 0。credit がプラス、debit（売上値引・返品）はマイナス
//   仕入税額 = expense category（debit プラス / credit＝返金はマイナス）
//            + asset category の debit 側（事業主貸 1610 を除外）、taxRate > 0
//
// 各 ConsumptionTaxResult は 2 系統の数値を持つ：
//   円単位（outputTax/inputTax/netTax 等）：方式比較用の概算。円未満切捨てのみ
//   filingRounded/taxableBase：実際の申告書の端数処理（課税標準額は税率ごとに
//     千円未満切捨て・税額は1円未満切捨て・差引/地方税額は百円未満切捨て）を模した
//     「申告書相当額」。ただし付表 2-3 等の正式な申告書そのものは生成しない。
import { db } from '../db/db';
import { D, Decimal } from '../lib/decimal';
import { countsTowardTotals } from './journal';
import { transitionalCreditRate } from '../tax-schema/2026/invoice-transitional';
import {
  deemedInputRate,
  type SimplifiedTaxCategory,
} from '../tax-schema/2026/simplified-tax';
import type { TaxFilingMethod } from '../db/types';

const OWNER_WITHDRAW_CODE = '1610'; // 事業主貸
// 国税分の率（消費税法 第 29 条 + 第 72 条）
// 10% 標準：国税 7.8% + 地方 2.2%（地方は国税 × 22/78）
// 8% 軽減：国税 6.24% + 地方 1.76%（地方は国税 × 22/78）

export interface ConsumptionTaxBreakdown {
  /** 国税分（消費税申告書ベース） */
  national: string;
  /** 地方消費税分 = 国税 × 22/78 */
  local: string;
  /** 国税 + 地方 */
  total: string;
}

export interface ConsumptionTaxResult {
  year: number;
  method: TaxFilingMethod;
  /** 売上税額（国税分） */
  outputTax: ConsumptionTaxBreakdown;
  /** 控除対象仕入税額（経過措置適用後） */
  inputTax: ConsumptionTaxBreakdown;
  /** 経過措置適用前の総仕入税額（本則のみ参考、簡易・特例では output × みなし or 80/70% と同じ値） */
  inputTaxRaw: ConsumptionTaxBreakdown;
  /** 納付税額（負なら還付、本則のみありうる） */
  netTax: ConsumptionTaxBreakdown;
  /** 課税標準額（税率ごとに千円未満切り捨て後の合計。申告書相当額の算定基礎） */
  taxableBase: string;
  /** 申告書相当額（課税標準額の千円未満切捨て・税額の1円未満切捨て・差引/地方税額の百円未満切捨てを模した概算） */
  filingRounded: ConsumptionTaxBreakdown;
}
// 取引金額（税込 or 税抜）から税抜金額（課税標準額の基礎）を計算。
export function taxExcludedPortion(
  amount: Decimal,
  taxRate: number,
  taxIncluded: boolean
): Decimal {
  if (taxRate === 0) {
    return D(0);
  }
  const priceInclusive = taxIncluded ? amount : amount.times(1 + taxRate);
  return priceInclusive.dividedBy(1 + taxRate);
}
// 取引金額から国税相当の消費税額を計算。
// taxIncluded=true: amount は税込価格、国税 = amount × 7.8/110（標準）
// taxIncluded=false: amount は税抜価格、税込 = amount × (1 + taxRate)、国税は税込から逆算
function nationalPortion(
  amount: Decimal,
  taxRate: number,
  taxIncluded: boolean
): Decimal {
  const base = taxExcludedPortion(amount, taxRate, taxIncluded);
  if (taxRate === 0.1) {
    return base.times('0.078');
  }
  if (taxRate === 0.08) {
    return base.times('0.0624');
  }
  // 想定外税率はゼロ扱い
  return D(0);
}

function toLocal(national: Decimal): Decimal {
  return national.times(22).dividedBy(78);
}
// 消費税は端数切捨て（納税者に不利な切上げはしない）。
// 注意：本関数は円未満切捨てのみ（方式比較用の概算）。実申告書相当の
// 千円/百円未満切捨ては filingRounded（別途 filingBreakdown で算出）を参照。
function asBreakdown(national: Decimal): ConsumptionTaxBreakdown {
  const localD = toLocal(national);
  const n = national.toDecimalPlaces(0, Decimal.ROUND_DOWN);
  const l = localD.toDecimalPlaces(0, Decimal.ROUND_DOWN);
  return {
    national: n.toString(),
    local: l.toString(),
    total: n.plus(l).toString(),
  };
}
// value を unit（1000 や 100）未満切り捨て。マイナスは 0 方向へ切り捨て
// （既存 asBreakdown と同じ ROUND_DOWN 規約に合わせる）。
export function floorToUnit(value: Decimal, unit: number): Decimal {
  return value.dividedBy(unit).toDecimalPlaces(0, Decimal.ROUND_DOWN).times(unit);
}
// 申告書ベースの端数処理手順（国税庁タックスアンサー No.6371・No.6383）：
//  ① 課税標準額 = 税率ごとの税抜課税売上高（純額）を税率ごとに千円未満切り捨てし合算
//     （合算してから一括切り捨てではない。10%分・8%分をそれぞれ切り捨てる）
//  ② 課税標準額に対する消費税額 = ①の税率ごとの額 × 7.8%/6.24% を税率ごとに1円未満切り捨てし合算
// 全方式（本則・簡易・2割・3割）で共通の基礎（課税標準額・売上に係る消費税額は方式に依らない）。
// 税率別の内訳（base10/base8・tax10/tax8）は付表6 等 .xtx 出力の税率別欄で必要なため公開する。
export interface OfficialOutputTax {
  /** 課税標準額（税率ごとに千円未満切り捨て後の合計） */
  taxableBase: Decimal;
  /** 課税標準額に対する消費税額（国税分、税率ごとに1円未満切り捨て後の合計） */
  outputTax: Decimal;
  /** 課税標準額（標準税率10%＝国税7.8%分、千円未満切り捨て後） */
  base10: Decimal;
  /** 課税標準額（軽減税率8%＝国税6.24%分、千円未満切り捨て後） */
  base8: Decimal;
  /** 消費税額（標準税率10%＝国税7.8%分、1円未満切り捨て後） */
  tax10: Decimal;
  /** 消費税額（軽減税率8%＝国税6.24%分、1円未満切り捨て後） */
  tax8: Decimal;
}

export function computeOfficialOutputTax(
  taxableBase10Raw: Decimal,
  taxableBase8Raw: Decimal
): OfficialOutputTax {
  const base10 = floorToUnit(taxableBase10Raw, 1000);
  const base8 = floorToUnit(taxableBase8Raw, 1000);
  const tax10 = base10.times('0.078').toDecimalPlaces(0, Decimal.ROUND_DOWN);
  const tax8 = base8.times('0.0624').toDecimalPlaces(0, Decimal.ROUND_DOWN);
  return {
    taxableBase: base10.plus(base8),
    outputTax: tax10.plus(tax8),
    base10,
    base8,
    tax10,
    tax8,
  };
}
//  ③ 差引（納付）税額 = ②－控除対象仕入税額、百円未満切り捨て
//  ④ 地方消費税額 = ③（の消費税相当額）× 22/78、百円未満切り捨て
export function filingBreakdown(nationalNetRaw: Decimal): ConsumptionTaxBreakdown {
  const nationalRounded = floorToUnit(nationalNetRaw, 100);
  const localRaw = nationalRounded.times(22).dividedBy(78);
  const localRounded = floorToUnit(localRaw, 100);
  return {
    national: nationalRounded.toString(),
    local: localRounded.toString(),
    total: nationalRounded.plus(localRounded).toString(),
  };
}

export interface ProcessedYearLines {
  /** 売上税額（国税分。特定課税仕入れの自認課税分は含まない。経過措置判定は集計後） */
  output: Decimal;
  /** 仕入税額（国税分、経過措置適用前） */
  inputRaw: Decimal;
  /** 仕入税額（国税分、経過措置適用後 = 控除対象。輸入消費税分を含む。特定課税仕入れ分は含まない） */
  input: Decimal;
  /** 控除対象仕入税額（国税分、標準税率10%＝7.8%分。特定課税仕入れ分は含まない） */
  input10: Decimal;
  /** 控除対象仕入税額（国税分、軽減税率8%＝6.24%分） */
  input8: Decimal;
  /** 課税標準額の基礎（税抜課税売上高の純額、標準税率10%分） */
  taxableBase10: Decimal;
  /** 課税標準額の基礎（税抜課税売上高の純額、軽減税率8%分） */
  taxableBase8: Decimal;
  /** 免税売上高（税抜、輸出等。課税売上割合の分子に算入） */
  exportExemptSalesBase: Decimal;
  /** 非課税売上高（住宅家賃・利子等。課税売上割合の分母のみに算入） */
  nonTaxableSalesBase: Decimal;
  /** 個別対応方式：課税売上げと非課税売上げに共通して要する仕入税額（税率別、経過措置適用後） */
  inputCommon10: Decimal;
  inputCommon8: Decimal;
  /** 個別対応方式：非課税売上げにのみ要する仕入税額（税率別、経過措置適用後） */
  inputNonTaxableOnly10: Decimal;
  inputNonTaxableOnly8: Decimal;
  /** 課税貨物に係る消費税額（輸入消費税、税率別。.xtx 付表の内訳表示用） */
  importTax10: Decimal;
  importTax8: Decimal;
  /** 特定課税仕入れ（リバースチャージ）に係る支払対価の額・消費税額（常に標準税率） */
  reverseChargeBase: Decimal;
  reverseChargeTax: Decimal;
  /** 特定課税仕入れのうち個別対応方式の用途区分別内訳（常に標準税率＝7.8%分のみ）。
   * inputUsageCategory が common/nonTaxableOnly の行の税額。既定 taxableOnly はどちらにも入らない */
  reverseChargeCommonTax: Decimal;
  reverseChargeNonTaxableOnlyTax: Decimal;
  /** 貸倒れに係る税額（税率別。その行の taxRate で税込金額から逆算） */
  badDebtTax10: Decimal;
  badDebtTax8: Decimal;
  /** 貸倒回収に係る消費税額（税率別） */
  badDebtRecoveryTax10: Decimal;
  badDebtRecoveryTax8: Decimal;
}

function emptyProcessedYearLines(): ProcessedYearLines {
  return {
    output: D(0),
    inputRaw: D(0),
    input: D(0),
    input10: D(0),
    input8: D(0),
    taxableBase10: D(0),
    taxableBase8: D(0),
    exportExemptSalesBase: D(0),
    nonTaxableSalesBase: D(0),
    inputCommon10: D(0),
    inputCommon8: D(0),
    inputNonTaxableOnly10: D(0),
    inputNonTaxableOnly8: D(0),
    importTax10: D(0),
    importTax8: D(0),
    reverseChargeBase: D(0),
    reverseChargeTax: D(0),
    reverseChargeCommonTax: D(0),
    reverseChargeNonTaxableOnlyTax: D(0),
    badDebtTax10: D(0),
    badDebtTax8: D(0),
    badDebtRecoveryTax10: D(0),
    badDebtRecoveryTax8: D(0),
  };
}

// period 指定時は仮決算（中間申告）用：年内の一部期間（start〜end、両端含む ISO 日付）
// のみを集計する。未指定（既定）は年間全体（確定申告）。
export interface ConsumptionTaxPeriod {
  start: string;
  end: string;
}

export async function processYear(
  year: number,
  period?: ConsumptionTaxPeriod
): Promise<ProcessedYearLines> {
  const entries = await db.journalEntries
    .where('year')
    .equals(year)
    .filter(
      (e) => countsTowardTotals(e) && (!period || (e.date >= period.start && e.date <= period.end))
    )
    .toArray();
  if (entries.length === 0) {
    return emptyProcessedYearLines();
  }
  const lines = await db.journalLines
    .where('entryId')
    .anyOf(entries.map((e) => e.id))
    .toArray();
  const accounts = await db.accounts.where('year').equals(year).toArray();
  const accountMap = new Map(accounts.map((a) => [a.code, a]));
  const entryDateMap = new Map(entries.map((e) => [e.id, e.date]));

  const acc0 = emptyProcessedYearLines();
  let { output, inputRaw, input, input10, input8, taxableBase10, taxableBase8 } = acc0;
  let {
    exportExemptSalesBase,
    nonTaxableSalesBase,
    inputCommon10,
    inputCommon8,
    inputNonTaxableOnly10,
    inputNonTaxableOnly8,
    importTax10,
    importTax8,
    reverseChargeBase,
    reverseChargeTax,
    reverseChargeCommonTax,
    reverseChargeNonTaxableOnlyTax,
    badDebtTax10,
    badDebtTax8,
    badDebtRecoveryTax10,
    badDebtRecoveryTax8,
  } = acc0;

  // 個別対応方式の用途区分別に控除対象仕入税額を積み上げる（taxableOnly は input からの差分で導出するため個別集計不要）
  function accumulateUsage(line: (typeof lines)[number], deducted: Decimal, rate: 0.1 | 0.08): void {
    const usage = line.inputUsageCategory ?? 'taxableOnly';
    if (usage === 'common') {
      if (rate === 0.1) {
        inputCommon10 = inputCommon10.plus(deducted);
      } else {
        inputCommon8 = inputCommon8.plus(deducted);
      }
    } else if (usage === 'nonTaxableOnly') {
      if (rate === 0.1) {
        inputNonTaxableOnly10 = inputNonTaxableOnly10.plus(deducted);
      } else {
        inputNonTaxableOnly8 = inputNonTaxableOnly8.plus(deducted);
      }
    }
  }

  for (const line of lines) {
    const acc = accountMap.get(line.accountCode);
    if (!acc) {
      continue;
    }
    const effectiveTaxCategory = line.taxCategory ?? acc.taxCategory;

    // 貸倒回収：過去に貸倒控除した売掛金等の回収。新たな売上ではないため課税標準額・
    // 課税売上割合には算入せず、その行の taxRate で税込金額から税額のみ逆算する
    if (effectiveTaxCategory === 'badDebtRecovery') {
      const national = nationalPortion(D(line.amount), line.taxRate, line.taxIncluded);
      const signed = line.side === 'credit' ? national : national.negated();
      if (line.taxRate === 0.1) {
        badDebtRecoveryTax10 = badDebtRecoveryTax10.plus(signed);
      } else if (line.taxRate === 0.08) {
        badDebtRecoveryTax8 = badDebtRecoveryTax8.plus(signed);
      }
      continue;
    }

    // 売上：revenue は両建てネット（debit ＝ 売上値引・返品は課税標準から控除）
    if (acc.category === 'revenue') {
      if (line.taxRate === 0) {
        // 免税・非課税売上は税額こそ無いが、課税売上割合の算定基礎として集計する
        const amt = D(line.amount);
        const signed = line.side === 'credit' ? amt : amt.negated();
        if (effectiveTaxCategory === 'exportExempt') {
          exportExemptSalesBase = exportExemptSalesBase.plus(signed);
        } else if (effectiveTaxCategory === 'exempt') {
          nonTaxableSalesBase = nonTaxableSalesBase.plus(signed);
        }
        // 'nontaxable'（課税対象外）・未指定は課税売上割合に算入しない
        continue;
      }
      const national = nationalPortion(D(line.amount), line.taxRate, line.taxIncluded);
      const signed = line.side === 'credit' ? national : national.negated();
      output = output.plus(signed);
      const base = taxExcludedPortion(D(line.amount), line.taxRate, line.taxIncluded);
      const signedBase = line.side === 'credit' ? base : base.negated();
      if (line.taxRate === 0.1) {
        taxableBase10 = taxableBase10.plus(signedBase);
      } else if (line.taxRate === 0.08) {
        taxableBase8 = taxableBase8.plus(signedBase);
      }
      continue;
    }

    // 輸入消費税：金額そのものが税額（税込価格から逆算しない）
    if (effectiveTaxCategory === 'importTax10' || effectiveTaxCategory === 'importTax8') {
      const amt = D(line.amount);
      const signed = line.side === 'debit' ? amt : amt.negated();
      inputRaw = inputRaw.plus(signed);
      input = input.plus(signed);
      const rate: 0.1 | 0.08 = effectiveTaxCategory === 'importTax10' ? 0.1 : 0.08;
      if (rate === 0.1) {
        input10 = input10.plus(signed);
        importTax10 = importTax10.plus(signed);
      } else {
        input8 = input8.plus(signed);
        importTax8 = importTax8.plus(signed);
      }
      accumulateUsage(line, signed, rate);
      continue;
    }

    // 特定課税仕入れ（リバースチャージ）：常に標準税率。経過措置の適用判定
    // （本則課税・課税売上割合95%未満のみ申告義務。95%以上・簡易・2割/3割特例は
    // 当分の間「なかったもの」）は集計後に行うため、ここでは独立集計のみ行う。
    // output・input への混入はせず、用途区分別内訳（reverseChargeApplies 判定後に
    // 控除側へ織り込むため）を別枠で保持する。
    if (effectiveTaxCategory === 'reverseCharge') {
      const national = nationalPortion(D(line.amount), 0.1, line.taxIncluded);
      const signed = line.side === 'debit' ? national : national.negated();
      reverseChargeTax = reverseChargeTax.plus(signed);
      const base = taxExcludedPortion(D(line.amount), 0.1, line.taxIncluded);
      reverseChargeBase = reverseChargeBase.plus(line.side === 'debit' ? base : base.negated());
      const usage = line.inputUsageCategory ?? 'taxableOnly';
      if (usage === 'common') {
        reverseChargeCommonTax = reverseChargeCommonTax.plus(signed);
      } else if (usage === 'nonTaxableOnly') {
        reverseChargeNonTaxableOnlyTax = reverseChargeNonTaxableOnlyTax.plus(signed);
      }
      continue;
    }

    // 貸倒れ：税込の貸倒金額から、その行の taxRate で税額を逆算する。仕入税額控除とは
    // 別枠の控除項目のため isInput 判定・個別対応方式の用途区分には算入しない
    if (effectiveTaxCategory === 'badDebt') {
      const national = nationalPortion(D(line.amount), line.taxRate, line.taxIncluded);
      const signed = line.side === 'debit' ? national : national.negated();
      if (line.taxRate === 0.1) {
        badDebtTax10 = badDebtTax10.plus(signed);
      } else if (line.taxRate === 0.08) {
        badDebtTax8 = badDebtTax8.plus(signed);
      }
      continue;
    }

    if (line.taxRate === 0) {
      continue;
    }
    // 仕入：expense は両建てネット（credit ＝ 返金は仕入対価の返還）、
    // asset は debit 側のみ（事業主貸を除外。credit 側は通常 決済行や資産譲渡で、仕入控除の対象外）
    const isInput =
      acc.category === 'expense' ||
      (acc.category === 'asset' && line.side === 'debit' && acc.code !== OWNER_WITHDRAW_CODE);
    if (isInput) {
      const national = nationalPortion(D(line.amount), line.taxRate, line.taxIncluded);
      const signed = line.side === 'debit' ? national : national.negated();
      inputRaw = inputRaw.plus(signed);
      let deducted = signed;
      if (!line.invoiceCompliant) {
        const date = entryDateMap.get(line.entryId) ?? `${year}-01-01`;
        const rate = transitionalCreditRate(date);
        deducted = signed.times(rate);
      }
      input = input.plus(deducted);
      if (line.taxRate === 0.1) {
        input10 = input10.plus(deducted);
        accumulateUsage(line, deducted, 0.1);
      } else if (line.taxRate === 0.08) {
        input8 = input8.plus(deducted);
        accumulateUsage(line, deducted, 0.08);
      }
    }
  }
  return {
    output,
    inputRaw,
    input,
    input10,
    input8,
    taxableBase10,
    taxableBase8,
    exportExemptSalesBase,
    nonTaxableSalesBase,
    inputCommon10,
    inputCommon8,
    inputNonTaxableOnly10,
    inputNonTaxableOnly8,
    importTax10,
    importTax8,
    reverseChargeBase,
    reverseChargeTax,
    reverseChargeCommonTax,
    reverseChargeNonTaxableOnlyTax,
    badDebtTax10,
    badDebtTax8,
    badDebtRecoveryTax10,
    badDebtRecoveryTax8,
  };
}
// 課税売上割合 = (課税売上高＋免税売上高) ／ (課税売上高＋免税売上高＋非課税売上高)。
// 端数処理：法定の位数指定は無く任意の位で切り捨てが認められる（国税庁質疑応答）。
// aoiko は小数点2桁で切り捨てる（付表2-3 DTD00000 の表示慣例に合わせる）。
export interface TaxableSalesRatio {
  /** 切り捨て前の比率（0〜1） */
  ratio: Decimal;
  /** 表示・.xtx 用（例："92.35"、小数点2桁切り捨て） */
  ratioPercent: string;
  /** 課税売上高（税抜）＋免税売上高 */
  taxableSalesTotal: Decimal;
  /** 上記＋非課税売上高（課税売上割合の分母） */
  totalSalesForRatio: Decimal;
}

export function computeTaxableSalesRatio(
  taxableBase10: Decimal,
  taxableBase8: Decimal,
  exportExemptSalesBase: Decimal,
  nonTaxableSalesBase: Decimal
): TaxableSalesRatio {
  const taxableSalesTotal = taxableBase10.plus(taxableBase8).plus(exportExemptSalesBase);
  const totalSalesForRatio = taxableSalesTotal.plus(nonTaxableSalesBase);
  if (totalSalesForRatio.lessThanOrEqualTo(0)) {
    return { ratio: D(1), ratioPercent: '100.00', taxableSalesTotal, totalSalesForRatio };
  }
  const ratio = taxableSalesTotal.dividedBy(totalSalesForRatio);
  const ratioPercent = ratio.times(100).toDecimalPlaces(2, Decimal.ROUND_DOWN).toFixed(2);
  return { ratio, ratioPercent, taxableSalesTotal, totalSalesForRatio };
}
// 課税売上高5億円以下、かつ課税売上割合95%以上なら全額控除（消費税法30条2項）。
export function isFullDeductionEligible(salesRatio: TaxableSalesRatio): boolean {
  return (
    salesRatio.ratio.greaterThanOrEqualTo('0.95') &&
    salesRatio.taxableSalesTotal.lessThanOrEqualTo(500_000_000)
  );
}
// 特定課税仕入れ（リバースチャージ）の申告義務判定。一般課税かつ課税売上割合95%未満のみ適用。
// 95%以上（平成27年改正法附則42）・簡易課税（附則44②）・2割/3割特例の課税期間は
// 当分の間「なかったものとされる」ため、この関数の呼び出し側は一般課税経路に限る。
export function reverseChargeApplies(salesRatio: TaxableSalesRatio): boolean {
  return salesRatio.ratio.lessThan('0.95');
}
export type ConsumptionTaxAttributionMethod = 'individual' | 'proportional';
// 課税売上高5億円超・課税売上割合95%未満の場合の控除対象仕入税額を算定。
// 個別対応方式：課税対応分は全額＋共通対応分×課税売上割合（非課税対応分は控除不可）。
// 一括比例配分方式：課税仕入れ等の税額の合計額×課税売上割合。
function computeDeductibleInput(
  processed: ProcessedYearLines,
  salesRatio: TaxableSalesRatio,
  attributionMethod: ConsumptionTaxAttributionMethod
): Decimal {
  if (isFullDeductionEligible(salesRatio)) {
    return processed.input;
  }
  if (attributionMethod === 'proportional') {
    return processed.input.times(salesRatio.ratio);
  }
  const common = processed.inputCommon10.plus(processed.inputCommon8);
  const nonTaxableOnly = processed.inputNonTaxableOnly10.plus(processed.inputNonTaxableOnly8);
  const taxableOnly = processed.input.minus(common).minus(nonTaxableOnly);
  return taxableOnly.plus(common.times(salesRatio.ratio));
}
// 貸倒れ税額控除・貸倒回収の合計（税率横断）。消費税法39条は本則・簡易・2割・3割特例の
// いずれにも適用されるため、4方式共通のヘルパーとして分離する。
function badDebtTotals(processed: ProcessedYearLines): { tax: Decimal; recovery: Decimal } {
  return {
    tax: processed.badDebtTax10.plus(processed.badDebtTax8),
    recovery: processed.badDebtRecoveryTax10.plus(processed.badDebtRecoveryTax8),
  };
}
// 本則課税：(売上税額＋貸倒回収) − (控除対象仕入税額＋貸倒れ税額)。
// 負の場合は還付（aoiko は概算表示のみ、申告書出力はしない）。
// attributionMethod は課税売上割合95%未満・課税売上高5億円超のときのみ参照する（既定 proportional）。
export async function computeGeneral(
  year: number,
  attributionMethod: ConsumptionTaxAttributionMethod = 'proportional',
  period?: ConsumptionTaxPeriod
): Promise<ConsumptionTaxResult> {
  const processed = await processYear(year, period);
  const { output, inputRaw, taxableBase10, taxableBase8 } = processed;
  const { tax: badDebtTax, recovery: badDebtRecovery } = badDebtTotals(processed);
  const salesRatio = computeTaxableSalesRatio(
    taxableBase10,
    taxableBase8,
    processed.exportExemptSalesBase,
    processed.nonTaxableSalesBase
  );
  // 特定課税仕入れは一般課税かつ課税売上割合95%未満のときのみ、売上側（課税標準）と
  // 控除側の双方へ対称に配線する。適用時は 95%未満のため全額控除には入らない。
  const rcApplies = reverseChargeApplies(salesRatio);
  const rcTax = rcApplies ? processed.reverseChargeTax : D(0);
  const rcBase = rcApplies ? processed.reverseChargeBase : D(0);
  const effectiveProcessed: ProcessedYearLines = rcApplies
    ? {
        ...processed,
        inputRaw: inputRaw.plus(rcTax),
        input: processed.input.plus(rcTax),
        input10: processed.input10.plus(rcTax),
        inputCommon10: processed.inputCommon10.plus(processed.reverseChargeCommonTax),
        inputNonTaxableOnly10: processed.inputNonTaxableOnly10.plus(
          processed.reverseChargeNonTaxableOnlyTax
        ),
      }
    : processed;
  const input = computeDeductibleInput(effectiveProcessed, salesRatio, attributionMethod);
  const effectiveOutput = output.plus(rcTax);
  const net = effectiveOutput.plus(badDebtRecovery).minus(input).minus(badDebtTax);
  const official = computeOfficialOutputTax(taxableBase10.plus(rcBase), taxableBase8);
  // input は既に１円未満切り捨て済（既存の控除対象仕入税額）を官庁側の売上税額から控除
  const filingNet = official.outputTax.plus(badDebtRecovery).minus(input).minus(badDebtTax);
  return {
    year,
    method: 'general',
    outputTax: asBreakdown(effectiveOutput),
    inputTaxRaw: asBreakdown(effectiveProcessed.inputRaw),
    inputTax: asBreakdown(input),
    netTax: asBreakdown(net),
    taxableBase: official.taxableBase.toString(),
    filingRounded: filingBreakdown(filingNet),
  };
}
// 簡易課税：控除対象仕入税額＝(売上税額＋貸倒回収)×みなし仕入率（貸倒回収は控除計算の
// 基礎にも算入される。国税庁「簡易課税用申告の手引き」の基準消費税額の定義どおり）。
// 貸倒れ税額は控除計算とは別枠で最後に差し引く。
// 特定課税仕入れは経過措置（附則44②）で簡易課税の課税期間は「なかったもの」とされるため、
// processYear が output に混入しないことで自動的に集計から除外される。
export async function computeSimplified(
  year: number,
  category: SimplifiedTaxCategory,
  period?: ConsumptionTaxPeriod
): Promise<ConsumptionTaxResult> {
  const processed = await processYear(year, period);
  const { output, inputRaw, taxableBase10, taxableBase8 } = processed;
  const { tax: badDebtTax, recovery: badDebtRecovery } = badDebtTotals(processed);
  const rate = deemedInputRate(category);
  const basicBase = output.plus(badDebtRecovery);
  const deemedInput = basicBase.times(rate);
  const net = basicBase.minus(deemedInput).minus(badDebtTax);
  const official = computeOfficialOutputTax(taxableBase10, taxableBase8);
  const officialBasicBase = official.outputTax.plus(badDebtRecovery);
  const deemedInputOfficial = officialBasicBase
    .times(rate)
    .toDecimalPlaces(0, Decimal.ROUND_DOWN);
  const filingNet = officialBasicBase.minus(deemedInputOfficial).minus(badDebtTax);
  return {
    year,
    method: 'simplified',
    outputTax: asBreakdown(output),
    inputTaxRaw: asBreakdown(inputRaw),
    inputTax: asBreakdown(deemedInput),
    netTax: asBreakdown(net),
    taxableBase: official.taxableBase.toString(),
    filingRounded: filingBreakdown(filingNet),
  };
}
// 2 割・3 割特例共通：(売上税額＋貸倒回収) × (1 − 控除率) − 貸倒れ税額。
// 2割特例＝控除率80%（2023/10/01〜2026/09/30 の課税期間限定、インボイス制度の経過措置）。
// 3割特例＝控除率70%（令和9・10〔2027・2028〕の課税期間限定、令和8年度税制改正で新設）。
// 特定課税仕入れは 2割/3割特例の課税期間も経過措置で「なかったもの」とされ、
// processYear が output に混入しないことで自動的に集計から除外される。
async function computeWariException(
  year: number,
  method: 'two-wari' | 'three-wari',
  inputDeductionRate: string,
  period?: ConsumptionTaxPeriod
): Promise<ConsumptionTaxResult> {
  const netRate = D(1).minus(inputDeductionRate);
  const processed = await processYear(year, period);
  const { output, inputRaw, taxableBase10, taxableBase8 } = processed;
  const { tax: badDebtTax, recovery: badDebtRecovery } = badDebtTotals(processed);
  const basicBase = output.plus(badDebtRecovery);
  const inputDeducted = basicBase.times(inputDeductionRate);
  const net = basicBase.times(netRate).minus(badDebtTax);
  const official = computeOfficialOutputTax(taxableBase10, taxableBase8);
  const officialBasicBase = official.outputTax.plus(badDebtRecovery);
  const filingNet = officialBasicBase.times(netRate).minus(badDebtTax);
  return {
    year,
    method,
    outputTax: asBreakdown(output),
    inputTaxRaw: asBreakdown(inputRaw),
    inputTax: asBreakdown(inputDeducted),
    netTax: asBreakdown(net),
    taxableBase: official.taxableBase.toString(),
    filingRounded: filingBreakdown(filingNet),
  };
}
export function computeTwoWari(
  year: number,
  period?: ConsumptionTaxPeriod
): Promise<ConsumptionTaxResult> {
  return computeWariException(year, 'two-wari', '0.8', period);
}
export function computeThreeWari(
  year: number,
  period?: ConsumptionTaxPeriod
): Promise<ConsumptionTaxResult> {
  return computeWariException(year, 'three-wari', '0.7', period);
}
// 2 割特例の適用年度：課税期間 2023/10〜2026/9。個人（暦年）は令和5〜8年分（〜2026）。
export function isTwoWariEligibleYear(year: number): boolean {
  return year <= 2026;
}
// 3 割特例の適用年度：令和9・10年分（2027・2028）限定。
export function isThreeWariEligibleYear(year: number): boolean {
  return year === 2027 || year === 2028;
}
// 各方式を一括計算して比較できる形で返す。本則・簡易は常に対象、
// 2 割・3 割特例は適用年度のものだけ含める（適用外の方式を提示して誤選択させない）。
export async function compareAll(
  year: number,
  simplifiedCategory: SimplifiedTaxCategory,
  attributionMethod: ConsumptionTaxAttributionMethod = 'proportional'
): Promise<ConsumptionTaxResult[]> {
  const tasks: Promise<ConsumptionTaxResult>[] = [
    computeGeneral(year, attributionMethod),
    computeSimplified(year, simplifiedCategory),
  ];
  if (isTwoWariEligibleYear(year)) {
    tasks.push(computeTwoWari(year));
  }
  if (isThreeWariEligibleYear(year)) {
    tasks.push(computeThreeWari(year));
  }
  return Promise.all(tasks);
}