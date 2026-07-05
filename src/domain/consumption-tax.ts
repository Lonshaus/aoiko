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
function taxExcludedPortion(
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
  /** 売上税額（国税分） */
  output: Decimal;
  /** 仕入税額（国税分、経過措置適用前） */
  inputRaw: Decimal;
  /** 仕入税額（国税分、経過措置適用後 = 控除対象） */
  input: Decimal;
  /** 控除対象仕入税額（国税分、標準税率10%＝7.8%分） */
  input10: Decimal;
  /** 控除対象仕入税額（国税分、軽減税率8%＝6.24%分） */
  input8: Decimal;
  /** 課税標準額の基礎（税抜課税売上高の純額、標準税率10%分） */
  taxableBase10: Decimal;
  /** 課税標準額の基礎（税抜課税売上高の純額、軽減税率8%分） */
  taxableBase8: Decimal;
}

export async function processYear(year: number): Promise<ProcessedYearLines> {
  const entries = await db.journalEntries
    .where('year')
    .equals(year)
    .filter(countsTowardTotals)
    .toArray();
  if (entries.length === 0) {
    return {
      output: D(0),
      inputRaw: D(0),
      input: D(0),
      input10: D(0),
      input8: D(0),
      taxableBase10: D(0),
      taxableBase8: D(0),
    };
  }
  const lines = await db.journalLines
    .where('entryId')
    .anyOf(entries.map((e) => e.id))
    .toArray();
  const accounts = await db.accounts.where('year').equals(year).toArray();
  const accountMap = new Map(accounts.map((a) => [a.code, a]));
  const entryDateMap = new Map(entries.map((e) => [e.id, e.date]));

  let output = D(0);
  let inputRaw = D(0);
  let input = D(0);
  let input10 = D(0);
  let input8 = D(0);
  let taxableBase10 = D(0);
  let taxableBase8 = D(0);

  for (const line of lines) {
    if (line.taxRate === 0) {
      continue;
    }
    const acc = accountMap.get(line.accountCode);
    if (!acc) {
      continue;
    }
    const national = nationalPortion(
      D(line.amount),
      line.taxRate,
      line.taxIncluded
    );
    // 売上：revenue は両建てネット（debit ＝ 売上値引・返品は課税標準から控除）
    if (acc.category === 'revenue') {
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
    // 仕入：expense は両建てネット（credit ＝ 返金は仕入対価の返還）、
    // asset は debit 側のみ（事業主貸を除外。credit 側は通常 決済行や資産譲渡で、仕入控除の対象外）
    const isInput =
      acc.category === 'expense' ||
      (acc.category === 'asset' && line.side === 'debit' && acc.code !== OWNER_WITHDRAW_CODE);
    if (isInput) {
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
      } else if (line.taxRate === 0.08) {
        input8 = input8.plus(deducted);
      }
    }
  }
  return { output, inputRaw, input, input10, input8, taxableBase10, taxableBase8 };
}
// 本則課税：売上税額 − 控除対象仕入税額。
// 負の場合は還付（aoiko は概算表示のみ、申告書出力はしない）。
export async function computeGeneral(
  year: number
): Promise<ConsumptionTaxResult> {
  const { output, inputRaw, input, taxableBase10, taxableBase8 } =
    await processYear(year);
  const net = output.minus(input);
  const official = computeOfficialOutputTax(taxableBase10, taxableBase8);
  // input は既に１円未満切り捨て済（既存の控除対象仕入税額）を官庁側の売上税額から控除
  const filingNet = official.outputTax.minus(input);
  return {
    year,
    method: 'general',
    outputTax: asBreakdown(output),
    inputTaxRaw: asBreakdown(inputRaw),
    inputTax: asBreakdown(input),
    netTax: asBreakdown(net),
    taxableBase: official.taxableBase.toString(),
    filingRounded: filingBreakdown(filingNet),
  };
}
// 簡易課税：売上税額 × (1 − みなし仕入率)。
// 仕入実額は無関係、事業区分が決まれば結果は確定。
export async function computeSimplified(
  year: number,
  category: SimplifiedTaxCategory
): Promise<ConsumptionTaxResult> {
  const { output, inputRaw, taxableBase10, taxableBase8 } =
    await processYear(year);
  const rate = deemedInputRate(category);
  const deemedInput = output.times(rate);
  const net = output.minus(deemedInput);
  const official = computeOfficialOutputTax(taxableBase10, taxableBase8);
  const deemedInputOfficial = official.outputTax
    .times(rate)
    .toDecimalPlaces(0, Decimal.ROUND_DOWN);
  const filingNet = official.outputTax.minus(deemedInputOfficial);
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
// 2 割・3 割特例共通：売上税額 × (1 − 控除率) を納付する方式。
// 2割特例＝控除率80%（2023/10/01〜2026/09/30 の課税期間限定、インボイス制度の経過措置）。
// 3割特例＝控除率70%（令和9・10〔2027・2028〕の課税期間限定、令和8年度税制改正で新設）。
async function computeWariException(
  year: number,
  method: 'two-wari' | 'three-wari',
  inputDeductionRate: string
): Promise<ConsumptionTaxResult> {
  const netRate = D(1).minus(inputDeductionRate);
  const { output, inputRaw, taxableBase10, taxableBase8 } =
    await processYear(year);
  const inputDeducted = output.times(inputDeductionRate);
  const net = output.times(netRate);
  const official = computeOfficialOutputTax(taxableBase10, taxableBase8);
  const filingNet = official.outputTax.times(netRate);
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
export function computeTwoWari(year: number): Promise<ConsumptionTaxResult> {
  return computeWariException(year, 'two-wari', '0.8');
}
export function computeThreeWari(year: number): Promise<ConsumptionTaxResult> {
  return computeWariException(year, 'three-wari', '0.7');
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
  simplifiedCategory: SimplifiedTaxCategory
): Promise<ConsumptionTaxResult[]> {
  const tasks: Promise<ConsumptionTaxResult>[] = [
    computeGeneral(year),
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