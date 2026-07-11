import { D, Decimal, toIndexable } from '../lib/decimal';
import { db } from '../db/db';
import { newId } from '../lib/id';
import type { DepreciationMethod, FixedAsset, JournalEntry, JournalLine } from '../db/types';

const KAIGYOHI_CODE = '1530'; // 開業費
const CAPITAL_CODE = '3110'; // 元入金
const DEPRECIATION_EXPENSE_CODE = '5210'; // 減価償却費（繰延資産の償却もここに計上）
// 非業務用（私用）資産を業務の用に供した場合の未償却残高計算（所得税法施行令第135条・136条準拠）。
// 国税庁タックスアンサー No.2108「中古資産を非業務用から業務用に転用した場合の減価償却」に基づく。
// 手順：①耐用年数×1.5 の年数で旧定額法償却率を引く ②非業務期間（6ヶ月未満切り捨て・6ヶ月以上は1年）
// に応じた減価の額を計算 ③取得価額から控除した額が転用時点の未償却残高。
// 旧定額法償却率表（耐用年数 2〜50 年、国税庁「減価償却資産の償却率等表」より）。
const OLD_STRAIGHT_LINE_RATE: Record<number, string> = {
  2: '0.500',
  3: '0.333',
  4: '0.250',
  5: '0.200',
  6: '0.166',
  7: '0.142',
  8: '0.125',
  9: '0.111',
  10: '0.100',
  11: '0.090',
  12: '0.083',
  13: '0.076',
  14: '0.071',
  15: '0.066',
  16: '0.062',
  17: '0.058',
  18: '0.055',
  19: '0.052',
  20: '0.050',
  21: '0.048',
  22: '0.046',
  23: '0.044',
  24: '0.042',
  25: '0.040',
  26: '0.039',
  27: '0.037',
  28: '0.036',
  29: '0.035',
  30: '0.034',
};
// 耐用年数×1.5 は 1 年未満切り捨て（国税庁の年数の丸め方に準拠）。
function extendedUsefulLife(usefulLifeYears: number): number {
  return Math.floor(usefulLifeYears * 1.5);
}
export function oldStraightLineRate(usefulLifeYears: number): Decimal {
  const rate = OLD_STRAIGHT_LINE_RATE[usefulLifeYears];
  if (rate === undefined) {
    throw new Error(`旧定額法償却率が未定義の耐用年数です：${usefulLifeYears}`);
  }
  return D(rate);
}
interface YMD {
  y: number;
  m: number;
  d: number;
}
function parseYMD(iso: string): YMD {
  const [y, m, d] = iso.split('-').map(Number);
  return { y: y ?? 0, m: m ?? 0, d: d ?? 0 };
}
// 取得日から供用日までの満了月数。応当日（取得日の「日」）に達していない月は満了に数えない。
// 応当日が存在しない月（例：1/31 取得の 2 月）は民法の期間計算に従いその月の末日を満期日とする。
function elapsedFullMonths(acq: YMD, start: YMD): number {
  let months = (start.y - acq.y) * 12 + (start.m - acq.m);
  // 供用日の属する月の末日（1 始まりの月をそのまま渡すと翌月 0 日＝当月末日になる）。
  const lastDayOfStartMonth = new Date(start.y, start.m, 0).getDate();
  const anniversaryDay = Math.min(acq.d, lastDayOfStartMonth);
  if (start.d < anniversaryDay) {
    months -= 1;
  }
  return months;
}
// 非業務期間の年数。6ヶ月未満切り捨て、6ヶ月以上は1年に切り上げ。
function nonBusinessPeriodYears(acquisitionDate: string, businessStartDate: string): number {
  const totalMonths = elapsedFullMonths(parseYMD(acquisitionDate), parseYMD(businessStartDate));
  const years = Math.floor(totalMonths / 12);
  const remainderMonths = totalMonths % 12;
  return remainderMonths >= 6 ? years + 1 : years;
}
export interface ConvertedAssetBasis {
  nonBusinessDepreciation: Decimal;
  businessStartBasis: Decimal;
}
// 私用資産を事業供用日時点の未償却残高に変換する。
export function computeConvertedAssetBasis(
  acquisitionDate: string,
  businessStartDate: string,
  acquisitionCost: string,
  usefulLifeYears: number
): ConvertedAssetBasis {
  const extendedLife = extendedUsefulLife(usefulLifeYears);
  const rate = oldStraightLineRate(extendedLife);
  const years = nonBusinessPeriodYears(acquisitionDate, businessStartDate);
  const cost = D(acquisitionCost);
  const nonBusinessDepreciation = cost
    .times('0.9')
    .times(rate)
    .times(years)
    .toDecimalPlaces(0, Decimal.ROUND_DOWN);
  const businessStartBasis = cost.minus(nonBusinessDepreciation);
  return { nonBusinessDepreciation, businessStartBasis };
}

export interface OpeningExpenseItem {
  name: string;
  amount: string;
}
export type ExpenseAmortization = 'immediate' | 'five-year';
export interface OpeningConvertedAsset {
  name: string;
  acquisitionDate: string;
  acquisitionCost: string;
  usefulLifeYears: number;
  accountCode: string;
  depreciationMethod: DepreciationMethod;
}
export interface OpeningCustomItem {
  name: string;
  amount: string;
  accountCode: string;
  side: 'debit' | 'credit';
}
export interface OpeningSetupInput {
  businessStartDate: string;
  expenses: OpeningExpenseItem[];
  expenseAmortization: ExpenseAmortization;
  convertedAssets: OpeningConvertedAsset[];
  customItems: OpeningCustomItem[];
}
export interface OpeningSetupResult {
  entryIds: string[];
  assetIds: string[];
}
function newLine(
  entryId: string,
  side: 'debit' | 'credit',
  accountCode: string,
  amount: Decimal,
  memo: string
): JournalLine {
  return {
    id: newId(),
    entryId,
    side,
    accountCode,
    amount: amount.toString(),
    amountIndexed: toIndexable(amount),
    taxRate: 0,
    taxIncluded: false,
    invoiceCompliant: false,
    memo,
  };
}
function newEntry(date: string, description: string): JournalEntry {
  const now = Date.now();
  const year = Number(date.slice(0, 4));
  return {
    id: newId(),
    date,
    year,
    description,
    status: 'confirmed',
    source: 'opening',
    createdAt: now,
    confirmedAt: now,
  };
}
// 開業精霊：開業費・転用資産・自由項目をまとめて仕訳・固定資産登録として書き込む。
// 転用資産は本体（固定資産テーブルへの登録）のみ行い、以後の減価償却は既存の
// 年末一括生成（generateYearEndDepreciation）に委ねる。ここでは開業時点の
// 未償却残高を計上する開業仕訳のみを作る。
export async function generateOpeningEntries(
  input: OpeningSetupInput
): Promise<OpeningSetupResult> {
  const entryIds: string[] = [];
  const assetIds: string[] = [];
  const date = input.businessStartDate;

  await db.transaction('rw', db.journalEntries, db.journalLines, db.fixedAssets, async () => {
    // 開業費（繰延資産）
    const expenseTotal = input.expenses.reduce((sum, e) => sum.plus(D(e.amount)), D(0));
    if (!expenseTotal.isZero()) {
      const entry = newEntry(date, '開業費計上（開業精霊）');
      const lines = [
        newLine(entry.id, 'debit', KAIGYOHI_CODE, expenseTotal, '開業費'),
        newLine(entry.id, 'credit', CAPITAL_CODE, expenseTotal, '開業費（元入金）'),
      ];
      await db.journalEntries.add(entry);
      await db.journalLines.bulkAdd(lines);
      entryIds.push(entry.id);

      const amortized =
        input.expenseAmortization === 'immediate'
          ? expenseTotal
          : expenseTotal.dividedBy(5).toDecimalPlaces(0, Decimal.ROUND_DOWN);
      if (!amortized.isZero()) {
        const amortEntry = newEntry(date, '開業費償却（開業精霊）');
        const amortLines = [
          newLine(amortEntry.id, 'debit', DEPRECIATION_EXPENSE_CODE, amortized, '繰延資産償却'),
          newLine(amortEntry.id, 'credit', KAIGYOHI_CODE, amortized, '開業費償却'),
        ];
        await db.journalEntries.add(amortEntry);
        await db.journalLines.bulkAdd(amortLines);
        entryIds.push(amortEntry.id);
      }
    }

    // 転用資産・自由項目 → 1本の開業仕訳にまとめ、元入金で貸借を合わせる
    const assetLines: Array<{ side: 'debit' | 'credit'; accountCode: string; amount: Decimal; memo: string }> = [];
    for (const asset of input.convertedAssets) {
      const basis = computeConvertedAssetBasis(
        asset.acquisitionDate,
        date,
        asset.acquisitionCost,
        asset.usefulLifeYears
      );
      const fixedAsset: FixedAsset = {
        id: newId(),
        name: asset.name,
        acquisitionDate: date,
        acquisitionCost: basis.businessStartBasis.toString(),
        usefulLifeYears: asset.usefulLifeYears,
        depreciationMethod: asset.depreciationMethod,
        accountCode: asset.accountCode,
      };
      await db.fixedAssets.add(fixedAsset);
      assetIds.push(fixedAsset.id);
      if (!basis.businessStartBasis.isZero()) {
        assetLines.push({
          side: 'debit',
          accountCode: asset.accountCode,
          amount: basis.businessStartBasis,
          memo: `転用資産：${asset.name}`,
        });
      }
    }
    for (const item of input.customItems) {
      const amount = D(item.amount);
      if (amount.isZero()) {
        continue;
      }
      assetLines.push({ side: item.side, accountCode: item.accountCode, amount, memo: item.name });
    }
    if (assetLines.length > 0) {
      const entry = newEntry(date, '開業時資産計上（開業精霊）');
      const netDebit = assetLines.reduce(
        (sum, l) => (l.side === 'debit' ? sum.plus(l.amount) : sum.minus(l.amount)),
        D(0)
      );
      const lines = assetLines.map((l) => newLine(entry.id, l.side, l.accountCode, l.amount, l.memo));
      if (!netDebit.isZero()) {
        const capitalSide = netDebit.isPositive() ? 'credit' : 'debit';
        lines.push(newLine(entry.id, capitalSide, CAPITAL_CODE, netDebit.abs(), '開業（元入金）'));
      }
      await db.journalEntries.add(entry);
      await db.journalLines.bulkAdd(lines);
      entryIds.push(entry.id);
    }
  });

  return { entryIds, assetIds };
}