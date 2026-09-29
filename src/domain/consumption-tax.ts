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
import { deemedInputRate, type SimplifiedTaxCategory } from '../tax-schema/2026/simplified-tax';
import type { Account, JournalLine, TaxFilingMethod } from '../db/types';

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
  taxIncluded: boolean,
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
function nationalPortion(amount: Decimal, taxRate: number, taxIncluded: boolean): Decimal {
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
function floorToUnit(value: Decimal, unit: number): Decimal {
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
  taxableBase8Raw: Decimal,
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

interface ProcessedYearLines {
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
  /** taxableTransferConsideration が設定された行の課税標準額（税率別、税抜）。
   * 簡易課税の事業区分別計算（第四種）で使うため taxableBase10/8 から分離して保持する */
  markedTransferBase10: Decimal;
  markedTransferBase8: Decimal;
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
    markedTransferBase10: D(0),
    markedTransferBase8: D(0),
  };
}
// period 指定時は仮決算（中間申告）用：年内の一部期間（start〜end、両端含む ISO 日付）
// のみを集計する。未指定（既定）は年間全体（確定申告）。
interface ConsumptionTaxPeriod {
  start: string;
  end: string;
}
// 未設定は少額特例を適用しない（従来どおり）
export interface SmallAmountSpecialInputs {
  basePeriodSales?: Decimal;
  specifiedPeriodSales?: Decimal;
}

export interface ProcessYearOptions {
  smallAmountSpecial?: SmallAmountSpecialInputs;
}
// 附則53条の2：五年施行日から6年を経過する日まで
const SMALL_AMOUNT_SPECIAL_START = '2023-10-01';
const SMALL_AMOUNT_SPECIAL_END = '2029-09-30';
const TRANSITIONAL_START = '2023-10-01';
// 附則53条の2 は基準期間1億円以下「又は」特定期間5千万円以下
export function isSmallAmountSpecialPeriod(inputs: SmallAmountSpecialInputs = {}): boolean {
  const byBase =
    inputs.basePeriodSales !== undefined && inputs.basePeriodSales.lessThanOrEqualTo(100_000_000);
  const bySpecified =
    inputs.specifiedPeriodSales !== undefined &&
    inputs.specifiedPeriodSales.lessThanOrEqualTo(50_000_000);
  return byBase || bySpecified;
}
// 平成30年政令第135号附則24条の2第1項（税込1万円未満）
export function isSmallAmountPurchase(transactionInclusive: Decimal, date: string): boolean {
  return (
    transactionInclusive.lessThan(10_000) &&
    date >= SMALL_AMOUNT_SPECIAL_START &&
    date <= SMALL_AMOUNT_SPECIAL_END
  );
}
// 附則90条3項：令和8年10月1日以後開始の課税期間から1億円、それより前は10億円
export function transitionalCapAmount(year: number): Decimal {
  return D(year >= 2027 ? 100_000_000 : 1_000_000_000);
}

export function taxInclusiveAmount(line: JournalLine): Decimal {
  const amount = D(line.amount);
  return line.taxIncluded ? amount : amount.times(1 + line.taxRate);
}
export function isNonInvoicePurchaseLine(line: JournalLine, acc: Account): boolean {
  if (line.taxableTransferConsideration !== undefined) {
    return false;
  }
  const cat = line.taxCategory ?? acc.taxCategory;
  if (
    cat === 'badDebtRecovery' ||
    cat === 'importTax10' ||
    cat === 'importTax8' ||
    cat === 'reverseCharge' ||
    cat === 'badDebt'
  ) {
    return false;
  }
  if (acc.category === 'revenue' || line.taxRate === 0 || line.invoiceCompliant) {
    return false;
  }
  if (line.side !== 'debit') {
    return false;
  }
  return (
    acc.category === 'expense' || (acc.category === 'asset' && acc.code !== OWNER_WITHDRAW_CODE)
  );
}

export interface TransitionalCapItem {
  lineId: string;
  entryId: string;
  date: string;
  vendorId?: string;
  inclusiveAmount: Decimal;
}
// vendorId の無い行は相手を特定できないため、どの群にも合算せず1行ずつ判定する
export function transitionalCapExcess(
  cap: Decimal,
  items: readonly TransitionalCapItem[],
): Map<string, Decimal> {
  const sorted = [...items].sort((a, b) => {
    if (a.date !== b.date) {
      return a.date < b.date ? -1 : 1;
    }
    if (a.entryId !== b.entryId) {
      return a.entryId < b.entryId ? -1 : 1;
    }
    return a.lineId < b.lineId ? -1 : a.lineId > b.lineId ? 1 : 0;
  });
  const totals = new Map<string, Decimal>();
  const excess = new Map<string, Decimal>();
  for (const item of sorted) {
    const key = item.vendorId === undefined ? `line:${item.lineId}` : `vendor:${item.vendorId}`;
    const before = totals.get(key) ?? D(0);
    const after = before.plus(item.inclusiveAmount);
    totals.set(key, after);
    if (after.greaterThan(cap)) {
      const over = after.minus(Decimal.max(before, cap));
      if (over.greaterThan(0)) {
        excess.set(item.lineId, over);
      }
    }
  }
  return excess;
}

export interface NonInvoicePurchaseClassification {
  smallAmountLineIds: Set<string>;
  capExcess: Map<string, Decimal>;
}
// 少額特例の対象行は「前二条の規定は、適用しない」ため上限の累計にも入れない
export function classifyNonInvoicePurchases(
  year: number,
  entryDateMap: ReadonlyMap<string, string>,
  lines: readonly JournalLine[],
  accountMap: ReadonlyMap<string, Account>,
  smallAmountSpecial: SmallAmountSpecialInputs = {},
): NonInvoicePurchaseClassification {
  const candidates = lines.filter((line) => {
    const acc = accountMap.get(line.accountCode);
    return acc !== undefined && isNonInvoicePurchaseLine(line, acc);
  });
  const smallAmountLineIds = new Set<string>();
  if (isSmallAmountSpecialPeriod(smallAmountSpecial)) {
    // 1回の取引の税込額で判定する（商品ごとではない）ため仕訳単位で合計する
    const perEntry = new Map<string, Decimal>();
    for (const line of candidates) {
      perEntry.set(
        line.entryId,
        (perEntry.get(line.entryId) ?? D(0)).plus(taxInclusiveAmount(line)),
      );
    }
    for (const line of candidates) {
      const date = entryDateMap.get(line.entryId) ?? `${year}-01-01`;
      const total = perEntry.get(line.entryId) ?? D(0);
      if (isSmallAmountPurchase(total, date)) {
        smallAmountLineIds.add(line.id);
      }
    }
  }
  const items: TransitionalCapItem[] = [];
  for (const line of candidates) {
    const date = entryDateMap.get(line.entryId) ?? `${year}-01-01`;
    if (smallAmountLineIds.has(line.id) || date < TRANSITIONAL_START) {
      continue;
    }
    items.push({
      lineId: line.id,
      entryId: line.entryId,
      date,
      ...(line.vendorId !== undefined ? { vendorId: line.vendorId } : {}),
      inclusiveAmount: taxInclusiveAmount(line),
    });
  }
  return {
    smallAmountLineIds,
    capExcess: transitionalCapExcess(transitionalCapAmount(year), items),
  };
}

export async function processYear(
  year: number,
  period?: ConsumptionTaxPeriod,
  options: ProcessYearOptions = {},
): Promise<ProcessedYearLines> {
  // 控除上限は年単位の累計なので、期間集計でも年間の仕訳から判定する
  const yearEntries = await db.journalEntries
    .where('year')
    .equals(year)
    .filter((e) => countsTowardTotals(e))
    .toArray();
  const entries = period
    ? yearEntries.filter((e) => e.date >= period.start && e.date <= period.end)
    : yearEntries;
  if (entries.length === 0) {
    return emptyProcessedYearLines();
  }
  const yearLines = await db.journalLines
    .where('entryId')
    .anyOf(yearEntries.map((e) => e.id))
    .toArray();
  const inPeriod = new Set(entries.map((e) => e.id));
  const lines = yearLines.filter((l) => inPeriod.has(l.entryId));
  const accounts = await db.accounts.where('year').equals(year).toArray();
  const accountMap = new Map(accounts.map((a) => [a.code, a]));
  const entryDateMap = new Map(yearEntries.map((e) => [e.id, e.date]));
  const { smallAmountLineIds, capExcess } = classifyNonInvoicePurchases(
    year,
    entryDateMap,
    yearLines,
    accountMap,
    options.smallAmountSpecial,
  );

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
    markedTransferBase10,
    markedTransferBase8,
  } = acc0;
  // 個別対応方式の用途区分別に控除対象仕入税額を積み上げる（taxableOnly は input からの差分で導出するため個別集計不要）
  function accumulateUsage(
    line: (typeof lines)[number],
    deducted: Decimal,
    rate: 0.1 | 0.08,
  ): void {
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
    // 課税資産の譲渡等の行単位の印：科目区分を問わずこの対価を課税売上として集計する
    // （固定資産の譲渡等）。収入科目の売上経路とは重複させず、仕入としても扱わない
    if (line.taxableTransferConsideration !== undefined && line.taxRate !== 0) {
      const consideration = D(line.taxableTransferConsideration);
      const national = nationalPortion(consideration, line.taxRate, line.taxIncluded);
      const base = taxExcludedPortion(consideration, line.taxRate, line.taxIncluded);
      output = output.plus(national);
      if (line.taxRate === 0.1) {
        taxableBase10 = taxableBase10.plus(base);
        markedTransferBase10 = markedTransferBase10.plus(base);
      } else if (line.taxRate === 0.08) {
        taxableBase8 = taxableBase8.plus(base);
        markedTransferBase8 = markedTransferBase8.plus(base);
      }
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
      if (!line.invoiceCompliant && !smallAmountLineIds.has(line.id)) {
        const date = entryDateMap.get(line.entryId) ?? `${year}-01-01`;
        const rate = transitionalCreditRate(date);
        deducted = signed.times(rate);
        const over = capExcess.get(line.id);
        if (over) {
          deducted = deducted.times(D(1).minus(over.dividedBy(taxInclusiveAmount(line))));
        }
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
    markedTransferBase10,
    markedTransferBase8,
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
  nonTaxableSalesBase: Decimal,
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

export interface DeductibleInputTax {
  /** 控除対象仕入税額（税率7.8%適用分。特定課税仕入れ分を含む）、1円未満切捨て済 */
  rate78: Decimal;
  /** 控除対象仕入税額（税率6.24%適用分）、1円未満切捨て済 */
  rate624: Decimal;
  /** 合計 = rate78 + rate624（申告書④・付表1-3(4)・付表2-3⑯いずれもこの値を使う） */
  total: Decimal;
}
// 控除対象仕入税額の算定に必要な税率別の生の内訳（経過措置適用後、切捨て前）。
// processYear の結果（本則の通常申告）・GeneralMappingInput（.xtx マッピング）の
// 双方が同じフィールド名を持つため、どちらからもそのまま渡せる。
interface DeductibleInputTaxInputs {
  input10: Decimal;
  input8: Decimal;
  inputCommon10: Decimal;
  inputCommon8: Decimal;
  inputNonTaxableOnly10: Decimal;
  inputNonTaxableOnly8: Decimal;
  /** 特定課税仕入れ（リバースチャージ）の消費税額。常に7.8%側へ合算。非適用時は 0 を渡す */
  reverseChargeTax: Decimal;
  reverseChargeCommonTax: Decimal;
  reverseChargeNonTaxableOnlyTax: Decimal;
}
// 控除対象仕入税額を税率別に算定する唯一の実装（画面表示・.xtx 出力共通）。
// 付表2-3 の列構成（6.24%適用分／7.8%適用分／合計）に対応し、各税率で 1 円未満切捨てを
// 行ってから合算する（先に合算してから丸めると .xtx の付表と一致しなくなる）。
// 課税売上高5億円超・課税売上割合95%未満の場合のみ attributionMethod を参照する：
//   個別対応方式：課税対応分は全額＋共通対応分×課税売上割合（非課税対応分は控除不可）
//   一括比例配分方式：課税仕入れ等の税額の合計額×課税売上割合
export function computeDeductibleInputTax(
  inputs: DeductibleInputTaxInputs,
  salesRatio: TaxableSalesRatio,
  attributionMethod: ConsumptionTaxAttributionMethod,
): DeductibleInputTax {
  const raw78 = inputs.input10.plus(inputs.reverseChargeTax).toDecimalPlaces(0, Decimal.ROUND_DOWN);
  const raw624 = inputs.input8.toDecimalPlaces(0, Decimal.ROUND_DOWN);

  if (isFullDeductionEligible(salesRatio)) {
    return { rate78: raw78, rate624: raw624, total: raw78.plus(raw624) };
  }
  if (attributionMethod === 'proportional') {
    const rate78 = raw78.times(salesRatio.ratio).toDecimalPlaces(0, Decimal.ROUND_DOWN);
    const rate624 = raw624.times(salesRatio.ratio).toDecimalPlaces(0, Decimal.ROUND_DOWN);
    return { rate78, rate624, total: rate78.plus(rate624) };
  }
  const common78 = inputs.inputCommon10.plus(inputs.reverseChargeCommonTax);
  const nonTaxableOnly78 = inputs.inputNonTaxableOnly10.plus(inputs.reverseChargeNonTaxableOnlyTax);
  const taxableOnly78 = raw78.minus(common78).minus(nonTaxableOnly78);
  const rate78 = taxableOnly78
    .plus(common78.times(salesRatio.ratio))
    .toDecimalPlaces(0, Decimal.ROUND_DOWN);

  const common624 = inputs.inputCommon8;
  const nonTaxableOnly624 = inputs.inputNonTaxableOnly8;
  const taxableOnly624 = raw624.minus(common624).minus(nonTaxableOnly624);
  const rate624 = taxableOnly624
    .plus(common624.times(salesRatio.ratio))
    .toDecimalPlaces(0, Decimal.ROUND_DOWN);

  return { rate78, rate624, total: rate78.plus(rate624) };
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
  period?: ConsumptionTaxPeriod,
  options: ProcessYearOptions = {},
): Promise<ConsumptionTaxResult> {
  const processed = await processYear(year, period, options);
  const { output, inputRaw, taxableBase10, taxableBase8 } = processed;
  const { tax: badDebtTax, recovery: badDebtRecovery } = badDebtTotals(processed);
  const salesRatio = computeTaxableSalesRatio(
    taxableBase10,
    taxableBase8,
    processed.exportExemptSalesBase,
    processed.nonTaxableSalesBase,
  );
  // 特定課税仕入れは一般課税かつ課税売上割合95%未満のときのみ、売上側（課税標準）と
  // 控除側の双方へ対称に配線する。適用時は 95%未満のため全額控除には入らない。
  const rcApplies = reverseChargeApplies(salesRatio);
  const rcTax = rcApplies ? processed.reverseChargeTax : D(0);
  const rcBase = rcApplies ? processed.reverseChargeBase : D(0);
  const rcCommon = rcApplies ? processed.reverseChargeCommonTax : D(0);
  const rcNonTaxableOnly = rcApplies ? processed.reverseChargeNonTaxableOnlyTax : D(0);
  const deductible = computeDeductibleInputTax(
    {
      input10: processed.input10,
      input8: processed.input8,
      inputCommon10: processed.inputCommon10,
      inputCommon8: processed.inputCommon8,
      inputNonTaxableOnly10: processed.inputNonTaxableOnly10,
      inputNonTaxableOnly8: processed.inputNonTaxableOnly8,
      reverseChargeTax: rcTax,
      reverseChargeCommonTax: rcCommon,
      reverseChargeNonTaxableOnlyTax: rcNonTaxableOnly,
    },
    salesRatio,
    attributionMethod,
  );
  const effectiveOutput = output.plus(rcTax);
  const effectiveInputRaw = inputRaw.plus(rcTax);
  const net = effectiveOutput.plus(badDebtRecovery).minus(deductible.total).minus(badDebtTax);
  const official = computeOfficialOutputTax(taxableBase10.plus(rcBase), taxableBase8);
  // 控除対象仕入税額は税率ごとに1円未満切捨て済（deductible.total）を申告書ベースの売上税額から控除
  const filingNet = official.outputTax
    .plus(badDebtRecovery)
    .minus(deductible.total)
    .minus(badDebtTax);
  return {
    year,
    method: 'general',
    outputTax: asBreakdown(effectiveOutput),
    inputTaxRaw: asBreakdown(effectiveInputRaw),
    inputTax: asBreakdown(deductible.total),
    netTax: asBreakdown(net),
    taxableBase: official.taxableBase.toString(),
    filingRounded: filingBreakdown(filingNet),
  };
}
// 施行令57条2項（原則）：兼業時の控除対象仕入税額＝Σ(各区分の消費税額×みなし仕入率)
// （④＝Σ区分税額のため④による比例配分は代数的に消える）。
// 施行令57条3項（75%特例）：一区分が75%以上ならその区分の率を全体に適用。二区分しかない
// aoiko の兼業（設定区分＋印の付いた行の第四種）では、どちらも75%未満のケースの二区分特例は
// 各区分が自身の率を適用する式と代数的に一致するため、原則計算と同値になる。
// 概算（filingRounded を伴わない）方式：税率別に分けず合計のみで算定する。
export function simplifiedDeductionTotal(
  category: SimplifiedTaxCategory,
  mainBase: Decimal,
  markedBase: Decimal,
): Decimal {
  const mainRate = D(deemedInputRate(category));
  const markedRate = D(deemedInputRate(4));
  const principle = mainBase.times(mainRate).plus(markedBase.times(markedRate));
  if (markedBase.isZero()) {
    return principle;
  }
  const totalBase = mainBase.plus(markedBase);
  if (totalBase.isZero()) {
    return D(0);
  }
  const mainRatio = mainBase.dividedBy(totalBase);
  const markedRatio = markedBase.dividedBy(totalBase);
  const special = mainRatio.greaterThanOrEqualTo('0.75')
    ? totalBase.times(mainRate)
    : markedRatio.greaterThanOrEqualTo('0.75')
      ? totalBase.times(markedRate)
      : principle;
  return Decimal.max(principle, special);
}

export interface SimplifiedCategoryDeduction {
  principle10: Decimal;
  principle8: Decimal;
  principleTotal: Decimal;
  special10: Decimal;
  special8: Decimal;
  specialTotal: Decimal;
  // 特例（75%ルール）がどちらの区分の単一適用で成立したか。二区分（合計75%）の場合は
  // 'combo'、印の付いた行が無い場合は undefined
  specialCategory?: SimplifiedTaxCategory | 4 | 'combo';
  deduction10: Decimal;
  deduction8: Decimal;
  deductionTotal: Decimal;
}
// 付表5-3 相当：原則・特例のいずれも税率ごとに1円未満切り捨てしてから合算する
// （申告書の記載単位に合わせる。印の付いた行が無い場合＝markedTax10/8が0のときは、
// 従来どおり税率別に切り捨てて合算した値と完全に一致する＝回帰なし）。
export function computeSimplifiedCategoryDeduction(
  category: SimplifiedTaxCategory,
  mainTax10: Decimal,
  mainTax8: Decimal,
  markedTax10: Decimal,
  markedTax8: Decimal,
): SimplifiedCategoryDeduction {
  const mainRate = D(deemedInputRate(category));
  const markedRate = D(deemedInputRate(4));
  const principle10Raw = mainTax10.times(mainRate).plus(markedTax10.times(markedRate));
  const principle8Raw = mainTax8.times(mainRate).plus(markedTax8.times(markedRate));
  const markedTotal = markedTax10.plus(markedTax8);
  let special10Raw = principle10Raw;
  let special8Raw = principle8Raw;
  let specialCategory: SimplifiedTaxCategory | 4 | 'combo' | undefined;
  if (!markedTotal.isZero()) {
    const mainTotal = mainTax10.plus(mainTax8);
    const totalBase = mainTotal.plus(markedTotal);
    const mainRatio = totalBase.isZero() ? D(0) : mainTotal.dividedBy(totalBase);
    const markedRatio = totalBase.isZero() ? D(0) : markedTotal.dividedBy(totalBase);
    if (mainRatio.greaterThanOrEqualTo('0.75')) {
      special10Raw = mainTax10.plus(markedTax10).times(mainRate);
      special8Raw = mainTax8.plus(markedTax8).times(mainRate);
      specialCategory = category;
    } else if (markedRatio.greaterThanOrEqualTo('0.75')) {
      special10Raw = mainTax10.plus(markedTax10).times(markedRate);
      special8Raw = mainTax8.plus(markedTax8).times(markedRate);
      specialCategory = 4;
    } else {
      specialCategory = 'combo';
    }
  }
  const principle10 = principle10Raw.toDecimalPlaces(0, Decimal.ROUND_DOWN);
  const principle8 = principle8Raw.toDecimalPlaces(0, Decimal.ROUND_DOWN);
  const special10 = special10Raw.toDecimalPlaces(0, Decimal.ROUND_DOWN);
  const special8 = special8Raw.toDecimalPlaces(0, Decimal.ROUND_DOWN);
  const principleTotal = principle10.plus(principle8);
  const specialTotal = special10.plus(special8);
  const usePrinciple = principleTotal.greaterThanOrEqualTo(specialTotal);
  return {
    principle10,
    principle8,
    principleTotal,
    special10,
    special8,
    specialTotal,
    ...(specialCategory !== undefined ? { specialCategory } : {}),
    deduction10: usePrinciple ? principle10 : special10,
    deduction8: usePrinciple ? principle8 : special8,
    deductionTotal: usePrinciple ? principleTotal : specialTotal,
  };
}
// 簡易課税：控除対象仕入税額＝(売上税額＋貸倒回収)×みなし仕入率（貸倒回収は控除計算の
// 基礎にも算入される。国税庁「簡易課税用申告の手引き」の基準消費税額の定義どおり）。
// 貸倒れ税額は控除計算とは別枠で最後に差し引く。
// 特定課税仕入れは経過措置（附則44②）で簡易課税の課税期間は「なかったもの」とされるため、
// processYear が output に混入しないことで自動的に集計から除外される。
// taxableTransferConsideration の印の付いた行（消基通13-2-9で第四種）が有る場合、施行令57条の
// 兼業計算（原則・75%特例のうち大きい方）で控除対象仕入税額を算定する。無い場合は単一区分の
// 従来計算と完全に同じ式のまま（既存データ不変原則）。
export async function computeSimplified(
  year: number,
  category: SimplifiedTaxCategory,
  period?: ConsumptionTaxPeriod,
): Promise<ConsumptionTaxResult> {
  const processed = await processYear(year, period);
  const {
    output,
    inputRaw,
    taxableBase10,
    taxableBase8,
    markedTransferBase10,
    markedTransferBase8,
  } = processed;
  const { tax: badDebtTax, recovery: badDebtRecovery } = badDebtTotals(processed);
  const rate = deemedInputRate(category);
  const official = computeOfficialOutputTax(taxableBase10, taxableBase8);
  const hasMarkedTransfer = !markedTransferBase10.isZero() || !markedTransferBase8.isZero();
  let deemedInput: Decimal;
  let deemedInputOfficial: Decimal;
  if (!hasMarkedTransfer) {
    const basicBase = output.plus(badDebtRecovery);
    deemedInput = basicBase.times(rate);
    const officialBasicBase = official.outputTax.plus(badDebtRecovery);
    deemedInputOfficial = officialBasicBase.times(rate).toDecimalPlaces(0, Decimal.ROUND_DOWN);
  } else {
    const officialMarked = computeOfficialOutputTax(markedTransferBase10, markedTransferBase8);
    const markedTaxRaw = markedTransferBase10
      .times('0.078')
      .plus(markedTransferBase8.times('0.0624'));
    const mainBaseRaw = output.minus(markedTaxRaw).plus(badDebtRecovery);
    deemedInput = simplifiedDeductionTotal(category, mainBaseRaw, markedTaxRaw);
    const officialMain10 = official.tax10
      .minus(officialMarked.tax10)
      .plus(processed.badDebtRecoveryTax10);
    const officialMain8 = official.tax8
      .minus(officialMarked.tax8)
      .plus(processed.badDebtRecoveryTax8);
    deemedInputOfficial = computeSimplifiedCategoryDeduction(
      category,
      officialMain10,
      officialMain8,
      officialMarked.tax10,
      officialMarked.tax8,
    ).deductionTotal;
  }
  const net = output.plus(badDebtRecovery).minus(deemedInput).minus(badDebtTax);
  const filingNet = official.outputTax
    .plus(badDebtRecovery)
    .minus(deemedInputOfficial)
    .minus(badDebtTax);
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
export interface WariBaseAdjustments {
  // 集計は返品・値引を課税標準額へネット済みのため、ここにはネットしていない分だけを渡す
  // （税率別。付表6の返還等対価に係る消費税額欄と同じ区分）
  salesReturnTax78?: Decimal;
  salesReturnTax624?: Decimal;
  specifiedSmallAssetTransfers?: ReadonlyArray<{ date: string; rate: 0.1 | 0.08; netTax: Decimal }>;
}
// 附則90条2項の読替えで、この期間の特定少額資産の譲渡は3割特例の基礎から除かれない
export function isSpecifiedSmallAssetExclusionSuspended(date: string): boolean {
  return date >= '2026-10-01' && date <= '2028-03-31';
}
function combinedSalesReturnTax(adjustments: WariBaseAdjustments): Decimal {
  return (adjustments.salesReturnTax78 ?? D(0)).plus(adjustments.salesReturnTax624 ?? D(0));
}
// 附則51条の2第2項・51条の3第2項。貸倒回収は付表6と同じく基礎に含める。
// 税率をまたいだ概算値（filingRounded を伴わない比較用）のため、税率別には分けない。
export function wariSpecialDeductionBase(
  method: 'two-wari' | 'three-wari',
  outputTax: Decimal,
  badDebtRecovery: Decimal,
  adjustments: WariBaseAdjustments = {},
): Decimal {
  let base = outputTax.plus(badDebtRecovery).minus(combinedSalesReturnTax(adjustments));
  if (method === 'three-wari') {
    for (const t of adjustments.specifiedSmallAssetTransfers ?? []) {
      if (!isSpecifiedSmallAssetExclusionSuspended(t.date)) {
        base = base.minus(t.netTax);
      }
    }
  }
  return base;
}
// 申告書相当額（filingRounded）用：付表6と同じく税率ごとに基礎を出し、各々を1円未満切り捨て
// してから特別控除税額を算定する（合算後に一括切り捨てすると付表6の額と1円以上ずれ得る）。
function wariSpecialDeductionBaseByRate(
  method: 'two-wari' | 'three-wari',
  official: OfficialOutputTax,
  badDebtRecoveryTax10: Decimal,
  badDebtRecoveryTax8: Decimal,
  adjustments: WariBaseAdjustments = {},
): { base78: Decimal; base624: Decimal } {
  let base78 = official.tax10.plus(badDebtRecoveryTax10).minus(adjustments.salesReturnTax78 ?? 0);
  let base624 = official.tax8.plus(badDebtRecoveryTax8).minus(adjustments.salesReturnTax624 ?? 0);
  if (method === 'three-wari') {
    for (const t of adjustments.specifiedSmallAssetTransfers ?? []) {
      if (isSpecifiedSmallAssetExclusionSuspended(t.date)) {
        continue;
      }
      if (t.rate === 0.1) {
        base78 = base78.minus(t.netTax);
      } else {
        base624 = base624.minus(t.netTax);
      }
    }
  }
  return { base78, base624 };
}
// 特定課税仕入れは経過措置で「なかったもの」とされ、processYear が output に入れない
async function computeWariException(
  year: number,
  method: 'two-wari' | 'three-wari',
  inputDeductionRate: string,
  period?: ConsumptionTaxPeriod,
  adjustments: WariBaseAdjustments = {},
): Promise<ConsumptionTaxResult> {
  const netRate = D(1).minus(inputDeductionRate);
  const processed = await processYear(year, period);
  const { output, inputRaw, taxableBase10, taxableBase8 } = processed;
  const { tax: badDebtTax, recovery: badDebtRecovery } = badDebtTotals(processed);
  const salesReturnTax = combinedSalesReturnTax(adjustments);
  const basicBase = output.plus(badDebtRecovery).minus(salesReturnTax);
  const specialBase = wariSpecialDeductionBase(method, output, badDebtRecovery, adjustments);
  const inputDeducted = specialBase.times(inputDeductionRate);
  // 除外が無ければ従来の basicBase × (1 − 控除率) と同じ値になる形で計算する
  const net = basicBase.minus(specialBase).plus(specialBase.times(netRate)).minus(badDebtTax);
  const official = computeOfficialOutputTax(taxableBase10, taxableBase8);
  const officialBasicBase = official.outputTax.plus(badDebtRecovery).minus(salesReturnTax);
  // 申告書相当額は付表6と同じく税率ごとに基礎を出し、各々1円未満切捨てしてから合算する
  const { base78, base624 } = wariSpecialDeductionBaseByRate(
    method,
    official,
    processed.badDebtRecoveryTax10,
    processed.badDebtRecoveryTax8,
    adjustments,
  );
  const specialDeduction78 = base78
    .times(inputDeductionRate)
    .toDecimalPlaces(0, Decimal.ROUND_DOWN);
  const specialDeduction624 = base624
    .times(inputDeductionRate)
    .toDecimalPlaces(0, Decimal.ROUND_DOWN);
  const specialDeductionOfficial = specialDeduction78.plus(specialDeduction624);
  const filingNet = officialBasicBase.minus(specialDeductionOfficial).minus(badDebtTax);
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
  period?: ConsumptionTaxPeriod,
  adjustments: WariBaseAdjustments = {},
): Promise<ConsumptionTaxResult> {
  return computeWariException(year, 'two-wari', '0.8', period, adjustments);
}
export function computeThreeWari(
  year: number,
  period?: ConsumptionTaxPeriod,
  adjustments: WariBaseAdjustments = {},
): Promise<ConsumptionTaxResult> {
  return computeWariException(year, 'three-wari', '0.7', period, adjustments);
}
// 未設定の項目は除外事由なしとして扱う（公開済みの利用者を入力欠落で不適用にしない）
export interface WariEligibilityInputs {
  registrationStartDate?: string;
  taxableElection?: { fromYear: number; toYear?: number };
  inheritanceDate?: string;
  adjustedFixedAssetDate?: string;
  shortenedPeriod?: { from: string; to?: string };
  foreignWithoutDomesticPe?: boolean;
  basePeriodSales?: Decimal;
  corporation?: boolean;
}
// 3割特例は附則51条の3第1項が「前条第一項第二号から第四号まで」だけを引くため一号を見ない
function isWariExcluded(
  year: number,
  inputs: WariEligibilityInputs,
  includeItem1: boolean,
): boolean {
  const periodStart = `${year}-01-01`;
  const periodEnd = `${year}-12-31`;
  if (inputs.foreignWithoutDomesticPe === true) {
    return true;
  }
  if (inputs.registrationStartDate !== undefined && inputs.registrationStartDate > periodEnd) {
    return true;
  }
  // 基準期間1千万円超は登録等が無くても免除されないため本文括弧を満たさない
  if (inputs.basePeriodSales !== undefined && inputs.basePeriodSales.greaterThan(10_000_000)) {
    return true;
  }
  const election = inputs.taxableElection;
  // 一号：五年施行日（2023-10-01）前から選択届出の効力が続く、同日の属する課税期間
  if (
    includeItem1 &&
    year === 2023 &&
    election !== undefined &&
    election.fromYear <= 2023 &&
    (election.toYear === undefined || election.toYear >= 2023)
  ) {
    return true;
  }
  // 二号：取得の翌課税期間から、取得期間の初日以後3年を経過する日の属する課税期間まで
  if (inputs.adjustedFixedAssetDate !== undefined) {
    const assetYear = Number(inputs.adjustedFixedAssetDate.slice(0, 4));
    if (year > assetYear && year <= assetYear + 2) {
      return true;
    }
  }
  // 三号は登録開始日の前日までの相続に限るため、登録開始日が無ければ判定できない
  if (
    inputs.inheritanceDate !== undefined &&
    inputs.registrationStartDate !== undefined &&
    inputs.inheritanceDate < inputs.registrationStartDate &&
    Number(inputs.inheritanceDate.slice(0, 4)) === year
  ) {
    return true;
  }
  // 四号：19条2項・4項で一の課税期間とみなされる期間も含む
  const shortened = inputs.shortenedPeriod;
  if (
    shortened !== undefined &&
    shortened.from <= periodEnd &&
    (shortened.to === undefined || shortened.to >= periodStart)
  ) {
    return true;
  }
  return false;
}
// 2 割特例の適用年度：課税期間 2023/10〜2026/9。個人（暦年）は令和5〜8年分（〜2026）。
export function isTwoWariEligibleYear(year: number, inputs: WariEligibilityInputs = {}): boolean {
  return year <= 2026 && !isWariExcluded(year, inputs, true);
}
// 3 割特例の適用年度：令和9・10年分（2027・2028）の個人事業者限定。
export function isThreeWariEligibleYear(year: number, inputs: WariEligibilityInputs = {}): boolean {
  return (
    (year === 2027 || year === 2028) &&
    inputs.corporation !== true &&
    !isWariExcluded(year, inputs, false)
  );
}
// 個人事業者の消費税の確定申告期限は翌年3月31日（措法86条の4）
function specialTargetFilingDeadline(targetYear: number): string {
  return `${targetYear + 1}-03-31`;
}
// 附則51条の2第6項・51条の3第5項。2026-10-01 前に終了する特例対象課税期間は改正前の「翌課税期間中」（附則90条1項）
export function deemedSimplifiedElectionFiledDate(
  targetYear: number,
  filedDate: string,
  priorYearMethod?: TaxFilingMethod,
): string {
  const priorStartEve = `${targetYear - 1}-12-31`;
  if (priorYearMethod !== 'two-wari' && priorYearMethod !== 'three-wari') {
    return filedDate;
  }
  if (filedDate <= priorStartEve) {
    return filedDate;
  }
  const targetEnd = `${targetYear}-12-31`;
  const deadline = targetEnd >= '2026-10-01' ? specialTargetFilingDeadline(targetYear) : targetEnd;
  return filedDate <= deadline ? priorStartEve : filedDate;
}
export function isSimplifiedElectionEffective(
  year: number,
  filedDate: string,
  priorYearMethod?: TaxFilingMethod,
): boolean {
  const deemed = deemedSimplifiedElectionFiledDate(year, filedDate, priorYearMethod);
  return deemed <= `${year - 1}-12-31`;
}

export interface CompareAllOptions {
  eligibility?: WariEligibilityInputs;
  smallAmountSpecial?: SmallAmountSpecialInputs;
  simplifiedElectionFiledDate?: string;
  priorYearMethod?: TaxFilingMethod;
  wariAdjustments?: WariBaseAdjustments;
}
// 適用できない方式は提示しない（誤選択させない）。簡易課税は届出日が未入力なら従来どおり常に含める
export async function compareAll(
  year: number,
  simplifiedCategory: SimplifiedTaxCategory,
  attributionMethod: ConsumptionTaxAttributionMethod = 'proportional',
  options: CompareAllOptions = {},
): Promise<ConsumptionTaxResult[]> {
  const eligibility = options.eligibility ?? {};
  const tasks: Promise<ConsumptionTaxResult>[] = [
    computeGeneral(
      year,
      attributionMethod,
      undefined,
      options.smallAmountSpecial ? { smallAmountSpecial: options.smallAmountSpecial } : {},
    ),
  ];
  if (
    options.simplifiedElectionFiledDate === undefined ||
    isSimplifiedElectionEffective(
      year,
      options.simplifiedElectionFiledDate,
      options.priorYearMethod,
    )
  ) {
    tasks.push(computeSimplified(year, simplifiedCategory));
  }
  if (isTwoWariEligibleYear(year, eligibility)) {
    tasks.push(computeTwoWari(year, undefined, options.wariAdjustments ?? {}));
  }
  if (isThreeWariEligibleYear(year, eligibility)) {
    tasks.push(computeThreeWari(year, undefined, options.wariAdjustments ?? {}));
  }
  return Promise.all(tasks);
}
