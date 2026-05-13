// 消費税納付額の計算。
// 4 方式に対応：本則課税 / 簡易課税 / 2 割特例 / 3 割特例。
// 国税分（消費税申告書ベース）と地方消費税分を別個に算出、合計も出す。
// 経過措置：適格請求書なしの仕入は取引日に応じた控除率（80/70/50/30/0%）を適用。
//
// 仕訳分類：
//   売上税額 = revenue category、credit 側、taxRate > 0
//   仕入税額 = expense or asset category（事業主貸 1610 を除外）、debit 側、taxRate > 0
//
// 注意：実申告書（消費税申告書 + 付表 2-3 等）出力は対象外。本計算は概算 + 比較用途。
import { db } from '../db/db';
import { D, type Decimal } from '../lib/decimal';
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
}

// 取引金額から国税相当の消費税額を計算。
// taxIncluded=true: amount は税込価格、国税 = amount × 7.8/110（標準）
// taxIncluded=false: amount は税抜価格、税込 = amount × (1 + taxRate)、国税は税込から逆算
function nationalPortion(
  amount: Decimal,
  taxRate: number,
  taxIncluded: boolean
): Decimal {
  if (taxRate === 0) {
    return D(0);
  }
  const priceInclusive = taxIncluded ? amount : amount.times(1 + taxRate);
  if (taxRate === 0.1) {
    return priceInclusive.times('7.8').dividedBy(110);
  }
  if (taxRate === 0.08) {
    return priceInclusive.times('6.24').dividedBy(108);
  }
  // 想定外税率はゼロ扱い
  return D(0);
}

function toLocal(national: Decimal): Decimal {
  return national.times(22).dividedBy(78);
}

function asBreakdown(national: Decimal): ConsumptionTaxBreakdown {
  const localD = toLocal(national);
  return {
    national: national.toDecimalPlaces(0).toString(),
    local: localD.toDecimalPlaces(0).toString(),
    total: national.plus(localD).toDecimalPlaces(0).toString(),
  };
}

interface ProcessedYearLines {
  /** 売上税額（国税分） */
  output: Decimal;
  /** 仕入税額（国税分、経過措置適用前） */
  inputRaw: Decimal;
  /** 仕入税額（国税分、経過措置適用後 = 控除対象） */
  input: Decimal;
}

async function processYear(year: number): Promise<ProcessedYearLines> {
  const entries = await db.journalEntries
    .where('year')
    .equals(year)
    .filter((e) => e.status === 'confirmed')
    .toArray();
  if (entries.length === 0) {
    return { output: D(0), inputRaw: D(0), input: D(0) };
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
    // 売上：revenue × credit 側
    if (acc.category === 'revenue' && line.side === 'credit') {
      output = output.plus(national);
      continue;
    }
    // 仕入：expense / asset × debit 側（事業主貸を除外）
    if (
      line.side === 'debit' &&
      (acc.category === 'expense' || acc.category === 'asset') &&
      acc.code !== OWNER_WITHDRAW_CODE
    ) {
      inputRaw = inputRaw.plus(national);
      if (line.invoiceCompliant) {
        input = input.plus(national);
      } else {
        const date = entryDateMap.get(line.entryId) ?? `${year}-01-01`;
        const rate = transitionalCreditRate(date);
        input = input.plus(national.times(rate));
      }
    }
  }
  return { output, inputRaw, input };
}

// 本則課税：売上税額 − 控除対象仕入税額。
// 負の場合は還付（aoiko は概算表示のみ、申告書出力はしない）。
export async function computeGeneral(
  year: number
): Promise<ConsumptionTaxResult> {
  const { output, inputRaw, input } = await processYear(year);
  const net = output.minus(input);
  return {
    year,
    method: 'general',
    outputTax: asBreakdown(output),
    inputTaxRaw: asBreakdown(inputRaw),
    inputTax: asBreakdown(input),
    netTax: asBreakdown(net),
  };
}

// 簡易課税：売上税額 × (1 − みなし仕入率)。
// 仕入実額は無関係、事業区分が決まれば結果は確定。
export async function computeSimplified(
  year: number,
  category: SimplifiedTaxCategory
): Promise<ConsumptionTaxResult> {
  const { output, inputRaw } = await processYear(year);
  const rate = deemedInputRate(category);
  const deemedInput = output.times(rate);
  const net = output.minus(deemedInput);
  return {
    year,
    method: 'simplified',
    outputTax: asBreakdown(output),
    inputTaxRaw: asBreakdown(inputRaw),
    inputTax: asBreakdown(deemedInput),
    netTax: asBreakdown(net),
  };
}

// 2 割特例：売上税額 × 80% を控除、納付は売上税額の 20%。
// 2023/10/01〜2026/09/30 の課税期間限定（インボイス制度の経過措置）。
export async function computeTwoWari(
  year: number
): Promise<ConsumptionTaxResult> {
  const { output, inputRaw } = await processYear(year);
  const inputDeducted = output.times('0.8');
  const net = output.times('0.2');
  return {
    year,
    method: 'two-wari',
    outputTax: asBreakdown(output),
    inputTaxRaw: asBreakdown(inputRaw),
    inputTax: asBreakdown(inputDeducted),
    netTax: asBreakdown(net),
  };
}

// 3 割特例：売上税額 × 70% を控除、納付は売上税額の 30%。
// 令和 9・10（2027・2028）の課税期間限定、令和 8 年度税制改正で新設。
export async function computeThreeWari(
  year: number
): Promise<ConsumptionTaxResult> {
  const { output, inputRaw } = await processYear(year);
  const inputDeducted = output.times('0.7');
  const net = output.times('0.3');
  return {
    year,
    method: 'three-wari',
    outputTax: asBreakdown(output),
    inputTaxRaw: asBreakdown(inputRaw),
    inputTax: asBreakdown(inputDeducted),
    netTax: asBreakdown(net),
  };
}

// 4 方式を一括計算して比較できる形で返す。
export async function compareAll(
  year: number,
  simplifiedCategory: SimplifiedTaxCategory
): Promise<ConsumptionTaxResult[]> {
  return Promise.all([
    computeGeneral(year),
    computeSimplified(year, simplifiedCategory),
    computeTwoWari(year),
    computeThreeWari(year),
  ]);
}