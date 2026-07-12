import { db } from '../db/db';
import { D, type Decimal } from '../lib/decimal';
import { countsTowardTotals, plContribution } from './journal';
import type { Account, AccountCategory, IncomeType, JournalEntry, JournalLine } from '../db/types';
// 売上原価・仕入（accounts.ts code 5020）。月別「仕入金額」欄に算入する科目。
// 期首/期末商品棚卸高（5010/5030）は年末調整項目のため月別仕入には含めない。
const PURCHASES_ACCOUNT_CODE = '5020';

export interface MonthlyTotal {
  month: number;
  sales: string;
  expense: string;
  // 月別の仕入金額（売上原価・仕入 5020 のみ）。決算書 月別ページの「仕入金額」欄用。
  // expense（経費合計）とは別物（仕入以外の経費を仕入欄に混入させないため分離）。
  purchases: string;
}

export interface MonthlyReport {
  year: number;
  months: MonthlyTotal[];
  totalSales: string;
  totalExpense: string;
}

export interface PLRow {
  accountCode: string;
  accountName: string;
  category: AccountCategory;
  amount: string;
  displayOrder: number;
}

export interface PLReport {
  year: number;
  revenue: PLRow[];
  expense: PLRow[];
  totalRevenue: string;
  totalExpense: string;
  netIncome: string;
  entryCount: number;
}
// 取引先別 / 補助科目別 / 部門別の集計。指定した軸（vendor / subAccount / department）で
// 各勘定科目内の取引を分解する。経費分析・実績把握に使う。
export type BreakdownAxis = 'vendor' | 'subAccount' | 'department';

export interface BreakdownEntry {
  key: string; // vendorId / subAccountId / '' (未分類)
  label: string; // 表示名
  amount: string;
  count: number; // 含まれる仕訳行数
}

export interface BreakdownGroup {
  accountCode: string;
  accountName: string;
  category: AccountCategory;
  total: string;
  entries: BreakdownEntry[];
}

export interface BreakdownReport {
  year: number;
  axis: BreakdownAxis;
  groups: BreakdownGroup[];
}

export async function buildBreakdown(
  year: number,
  axis: BreakdownAxis,
  data?: YearData,
): Promise<BreakdownReport> {
  const { entries, lines, accounts } = data ?? (await loadYearData(year));
  const accountMap = new Map(accounts.map((a) => [a.code, a]));
  const entryMap = new Map(entries.map((e) => [e.id, e]));
  const entryIds = new Set(entries.map((e) => e.id));

  const vendors = axis === 'vendor' ? await db.vendors.toArray() : [];
  const subAccounts = axis === 'subAccount' ? await db.subAccounts.toArray() : [];
  const vendorMap = new Map(vendors.map((v) => [v.id, v.name]));
  const subMap = new Map(subAccounts.map((s) => [s.id, s.name]));
  // accountCode → key → { amount, count }
  const matrix = new Map<string, Map<string, { amount: Decimal; count: number }>>();

  for (const line of lines) {
    if (!entryIds.has(line.entryId)) {
      continue;
    }
    const acc = accountMap.get(line.accountCode);
    if (!acc) {
      continue;
    }
    let contrib = plContribution(acc.category, line);
    if (contrib === null) {
      if (acc.category === 'asset' && line.side === 'debit') {
        contrib = D(line.amount);
      } else if (acc.category === 'liability' && line.side === 'credit') {
        contrib = D(line.amount);
      }
    }
    if (contrib === null || contrib.isZero()) {
      continue;
    }
    const key =
      axis === 'vendor'
        ? (line.vendorId ?? '')
        : axis === 'subAccount'
          ? (line.subAccountId ?? '')
          : (entryMap.get(line.entryId)?.department ?? '');
    let inner = matrix.get(line.accountCode);
    if (!inner) {
      inner = new Map();
      matrix.set(line.accountCode, inner);
    }
    const cur = inner.get(key) ?? { amount: D(0), count: 0 };
    inner.set(key, { amount: cur.amount.plus(contrib), count: cur.count + 1 });
  }

  const labelFor = (key: string): string => {
    if (!key) {
      return '（未分類）';
    }
    if (axis === 'vendor') {
      return vendorMap.get(key) ?? '（不明な取引先）';
    }
    if (axis === 'subAccount') {
      return subMap.get(key) ?? '（不明な補助科目）';
    }
    return key;
  };

  const groups: BreakdownGroup[] = [];
  for (const acc of accounts) {
    const inner = matrix.get(acc.code);
    if (!inner) {
      continue;
    }
    const entries: BreakdownEntry[] = [];
    let total = D(0);
    for (const [key, v] of inner) {
      entries.push({ key, label: labelFor(key), amount: v.amount.toString(), count: v.count });
      total = total.plus(v.amount);
    }
    if (total.isZero()) {
      continue;
    }
    entries.sort((a, b) => {
      const cmp = D(b.amount).minus(a.amount).toNumber();
      if (cmp !== 0) {
        return cmp;
      }
      return a.label.localeCompare(b.label);
    });
    groups.push({
      accountCode: acc.code,
      accountName: acc.name,
      category: acc.category,
      total: total.toString(),
      entries,
    });
  }
  groups.sort((a, b) => a.accountCode.localeCompare(b.accountCode));

  return { year, axis, groups };
}
// 月別 PL：勘定科目 × 月（12 ヶ月）のマトリックス。
export interface MonthlyPLRow {
  accountCode: string;
  accountName: string;
  category: AccountCategory;
  displayOrder: number;
  monthly: string[]; // 長さ 12
  total: string;
}

export interface MonthlyPLReport {
  year: number;
  revenue: MonthlyPLRow[];
  expense: MonthlyPLRow[];
  monthlyRevenueTotals: string[];
  monthlyExpenseTotals: string[];
  monthlyNetIncomes: string[];
  totalRevenue: string;
  totalExpense: string;
  netIncome: string;
}

export interface BSRow {
  accountCode: string;
  accountName: string;
  category: AccountCategory;
  balance: string;
}

export interface BSReport {
  year: number;
  asOf: string;
  assets: BSRow[];
  liabilities: BSRow[];
  equity: BSRow[];
  netIncome: string; // 当期純利益（PL 由来、純資産に算入）
  totalAssets: string;
  totalLiabilitiesAndEquity: string;
  balanced: boolean;
}
// 訂正は成対排除方式：原仕訳（status='reversed'）と訂正仕訳（originalEntryId 持ち）を
// 両方とも集計から除外する（countsTowardTotals）。片方だけ算入すると正味が −1×原仕訳 になり、
// B/S・繰越に幻の残高が生じるため、必ずペアで除外すること。
// 期締め後の訂正処理（修正申告ロジック）は reportSnapshots の filed フラグ機構で対応予定。

type YearData = { entries: JournalEntry[]; lines: JournalLine[]; accounts: Account[] };

async function loadYearData(year: number): Promise<YearData> {
  const entries = await db.journalEntries
    .where('year')
    .equals(year)
    .filter(countsTowardTotals)
    .toArray();
  if (entries.length === 0) {
    return { entries: [], lines: [], accounts: [] as Account[] };
  }
  const lines = await db.journalLines
    .where('entryId')
    .anyOf(entries.map((e) => e.id))
    .toArray();
  const accounts = await db.accounts.where({ year }).toArray();
  return { entries, lines, accounts };
}

export interface AllReports {
  monthly: MonthlyReport;
  pl: PLReport;
  bs: BSReport;
  monthlyPL: MonthlyPLReport;
  breakdown: BreakdownReport;
}
// 同一年度の全レポートを 1 回の loadYearData で計算する。
// 各 buildX を個別に呼ぶと同じ年度データを 5 回読み込むため、共有して IDB アクセスを削減する。
export async function buildAll(year: number, breakdownAxis: BreakdownAxis): Promise<AllReports> {
  const data = await loadYearData(year);
  return {
    monthly: await buildMonthly(year, data),
    pl: await buildPL(year, data),
    bs: await buildBS(year, data),
    monthlyPL: await buildMonthlyPL(year, data),
    breakdown: await buildBreakdown(year, breakdownAxis, data),
  };
}

export async function buildMonthly(year: number, data?: YearData): Promise<MonthlyReport> {
  const { entries, lines, accounts } = data ?? (await loadYearData(year));
  const accountMap = new Map(accounts.map((a) => [a.code, a]));
  const entryMonthMap = new Map(entries.map((e) => [e.id, Number(e.date.slice(5, 7))]));

  const months: MonthlyTotal[] = Array.from({ length: 12 }, (_, i) => ({
    month: i + 1,
    sales: '0',
    expense: '0',
    purchases: '0',
  }));
  const sales: Decimal[] = Array.from({ length: 12 }, () => D(0));
  const expense: Decimal[] = Array.from({ length: 12 }, () => D(0));
  const purchases: Decimal[] = Array.from({ length: 12 }, () => D(0));

  for (const line of lines) {
    const m = entryMonthMap.get(line.entryId);
    if (!m) {
      continue;
    }
    const idx = m - 1;
    const acc = accountMap.get(line.accountCode);
    if (!acc) {
      continue;
    }
    const contrib = plContribution(acc.category, line);
    if (contrib === null) {
      continue;
    }
    if (acc.category === 'revenue') {
      sales[idx] = (sales[idx] ?? D(0)).plus(contrib);
    } else {
      expense[idx] = (expense[idx] ?? D(0)).plus(contrib);
      // 仕入（売上原価・仕入 5020）は月別「仕入金額」欄用に別途集計
      if (acc.code === PURCHASES_ACCOUNT_CODE) {
        purchases[idx] = (purchases[idx] ?? D(0)).plus(contrib);
      }
    }
  }

  let totalSales = D(0);
  let totalExpense = D(0);
  for (let i = 0; i < 12; i++) {
    const s = sales[i] ?? D(0);
    const e = expense[i] ?? D(0);
    const month = months[i]!;
    month.sales = s.toString();
    month.expense = e.toString();
    month.purchases = (purchases[i] ?? D(0)).toString();
    totalSales = totalSales.plus(s);
    totalExpense = totalExpense.plus(e);
  }

  return {
    year,
    months,
    totalSales: totalSales.toString(),
    totalExpense: totalExpense.toString(),
  };
}
// 貸借対照表（B/S）。年度末時点で各勘定科目の残高を計算する。
// 資産は借方残、負債・純資産は貸方残として算出。
// 当期純利益（PL から）を純資産に加算して表示する。
export async function buildBS(year: number, data?: YearData): Promise<BSReport> {
  const { entries, lines, accounts } = data ?? (await loadYearData(year));
  const accountMap = new Map(accounts.map((a) => [a.code, a]));
  const entryMap = new Map(entries.map((e) => [e.id, e]));
  const asOf = `${year}-12-31`;
  // 年度内仕訳のみを集計（簡易：開始残高 = 0 前提。実運用では前年繰越が必要だが Phase 2 ではスキップ）
  const balances = new Map<string, Decimal>();
  for (const line of lines) {
    const entry = entryMap.get(line.entryId);
    if (!entry) {
      continue;
    }
    if (entry.date > asOf) {
      continue;
    }
    const acc = accountMap.get(line.accountCode);
    if (!acc) {
      continue;
    }
    if (acc.category !== 'asset' && acc.category !== 'liability' && acc.category !== 'equity') {
      continue;
    }
    const amount = D(line.amount);
    const cur = balances.get(line.accountCode) ?? D(0);
    if (acc.category === 'asset') {
      // 借方残＝プラス
      balances.set(line.accountCode, line.side === 'debit' ? cur.plus(amount) : cur.minus(amount));
    } else {
      // 負債・純資産：貸方残＝プラス
      balances.set(line.accountCode, line.side === 'credit' ? cur.plus(amount) : cur.minus(amount));
    }
  }

  const buildRows = (cat: AccountCategory): BSRow[] =>
    accounts
      .filter((a) => a.category === cat)
      .map<BSRow>((a) => ({
        accountCode: a.code,
        accountName: a.name,
        category: a.category,
        balance: (balances.get(a.code) ?? D(0)).toString(),
      }))
      .filter((r) => !D(r.balance).isZero())
      .sort((a, b) => a.accountCode.localeCompare(b.accountCode));

  const assets = buildRows('asset');
  const liabilities = buildRows('liability');
  const equity = buildRows('equity');
  // 当期純利益（純資産に加算）は全 incomeType 合算。buildPL は incomeType 単位のため、
  // 不動産所得の収益・費用が B/S 純資産から漏れて貸借不一致になる。合算 B/S に合わせて全業務を集計する。
  let netIncome = D(0);
  for (const line of lines) {
    const acc = accountMap.get(line.accountCode);
    if (!acc) {
      continue;
    }
    const contrib = plContribution(acc.category, line);
    if (contrib === null) {
      continue;
    }
    // plContribution は収益・費用とも符号正で返すため、費用は差し引く（純利益＝収益−費用）
    netIncome = acc.category === 'revenue' ? netIncome.plus(contrib) : netIncome.minus(contrib);
  }

  const totalAssets = assets.reduce((s, r) => s.plus(r.balance), D(0));
  const totalLiab = liabilities.reduce((s, r) => s.plus(r.balance), D(0));
  const totalEq = equity.reduce((s, r) => s.plus(r.balance), D(0)).plus(netIncome);
  const totalLE = totalLiab.plus(totalEq);

  return {
    year,
    asOf,
    assets,
    liabilities,
    equity,
    netIncome: netIncome.toString(),
    totalAssets: totalAssets.toString(),
    totalLiabilitiesAndEquity: totalLE.toString(),
    balanced: totalAssets.equals(totalLE),
  };
}

export async function buildMonthlyPL(year: number, data?: YearData): Promise<MonthlyPLReport> {
  const { entries, lines, accounts } = data ?? (await loadYearData(year));
  const accountMap = new Map(accounts.map((a) => [a.code, a]));
  const entryMonthMap = new Map(entries.map((e) => [e.id, Number(e.date.slice(5, 7))]));
  // accountCode → [12 ヶ月分の Decimal]
  const matrix = new Map<string, Decimal[]>();
  const ensureRow = (code: string): Decimal[] => {
    let row = matrix.get(code);
    if (!row) {
      row = Array.from({ length: 12 }, () => D(0));
      matrix.set(code, row);
    }
    return row;
  };

  for (const line of lines) {
    const m = entryMonthMap.get(line.entryId);
    if (!m) {
      continue;
    }
    const acc = accountMap.get(line.accountCode);
    if (!acc) {
      continue;
    }
    const contrib = plContribution(acc.category, line);
    if (contrib === null) {
      continue;
    }
    const row = ensureRow(line.accountCode);
    row[m - 1] = (row[m - 1] ?? D(0)).plus(contrib);
  }

  const buildRows = (cat: AccountCategory): MonthlyPLRow[] =>
    accounts
      .filter((a) => a.category === cat && matrix.has(a.code))
      .map<MonthlyPLRow>((a) => {
        const row = matrix.get(a.code)!;
        return {
          accountCode: a.code,
          accountName: a.name,
          category: a.category,
          displayOrder: a.displayOrder,
          monthly: row.map((d) => d.toString()),
          total: row.reduce((s, d) => s.plus(d), D(0)).toString(),
        };
      })
      .filter((r) => !D(r.total).isZero())
      .sort((a, b) => a.displayOrder - b.displayOrder);

  const revenue = buildRows('revenue');
  const expense = buildRows('expense');

  const sumByMonth = (rows: MonthlyPLRow[]): string[] => {
    const totals = Array.from({ length: 12 }, () => D(0));
    for (const r of rows) {
      for (let i = 0; i < 12; i++) {
        totals[i] = totals[i]!.plus(r.monthly[i] ?? '0');
      }
    }
    return totals.map((d) => d.toString());
  };

  const monthlyRevenueTotals = sumByMonth(revenue);
  const monthlyExpenseTotals = sumByMonth(expense);
  const monthlyNetIncomes = monthlyRevenueTotals.map((r, i) =>
    D(r)
      .minus(monthlyExpenseTotals[i] ?? '0')
      .toString(),
  );

  const totalRevenue = monthlyRevenueTotals.reduce((s, v) => s.plus(v), D(0)).toString();
  const totalExpense = monthlyExpenseTotals.reduce((s, v) => s.plus(v), D(0)).toString();
  const netIncome = D(totalRevenue).minus(totalExpense).toString();

  return {
    year,
    revenue,
    expense,
    monthlyRevenueTotals,
    monthlyExpenseTotals,
    monthlyNetIncomes,
    totalRevenue,
    totalExpense,
    netIncome,
  };
}

// incomeType 未指定は 'business' 扱い（既存データ互換、db/types.ts の Account.incomeType 参照）。
export async function buildPL(
  year: number,
  data?: YearData,
  incomeType: IncomeType = 'business',
): Promise<PLReport> {
  const { entries, lines, accounts } = data ?? (await loadYearData(year));
  const accountMap = new Map(accounts.map((a) => [a.code, a]));

  const totals = new Map<string, Decimal>();
  for (const line of lines) {
    const acc = accountMap.get(line.accountCode);
    if (!acc || (acc.incomeType ?? 'business') !== incomeType) {
      continue;
    }
    const contrib = plContribution(acc.category, line);
    if (contrib === null) {
      continue;
    }
    totals.set(line.accountCode, (totals.get(line.accountCode) ?? D(0)).plus(contrib));
  }

  const buildRows = (cat: AccountCategory): PLRow[] =>
    accounts
      .filter((a) => a.category === cat && (a.incomeType ?? 'business') === incomeType)
      .map<PLRow>((a) => ({
        accountCode: a.code,
        accountName: a.name,
        category: a.category,
        amount: (totals.get(a.code) ?? D(0)).toString(),
        displayOrder: a.displayOrder,
      }))
      .filter((r) => !D(r.amount).isZero())
      .sort((a, b) => a.accountCode.localeCompare(b.accountCode));

  const revenue = buildRows('revenue');
  const expense = buildRows('expense');
  const totalRevenue = revenue.reduce((s, r) => s.plus(r.amount), D(0)).toString();
  const totalExpense = expense.reduce((s, r) => s.plus(r.amount), D(0)).toString();
  const netIncome = D(totalRevenue).minus(totalExpense).toString();

  return {
    year,
    revenue,
    expense,
    totalRevenue,
    totalExpense,
    netIncome,
    entryCount: entries.length,
  };
}
// 複数年度トレンド分析（C8）。PL/BS のみ対応（方案A、AOIKO_FUTURE_IDEAS.md 参照）。
// 各年度の buildPL/buildBS をそのまま呼び出し、科目単位でピボットするだけ
// （既存の単年度計算ロジックをそのまま再利用、按分等の新規計算は行わない）。
export interface MultiYearPLRow {
  accountCode: string;
  accountName: string;
  category: AccountCategory;
  amounts: string[]; // years と同じ長さ・同じ並び順
  total: string;
}

export interface MultiYearPLReport {
  years: number[];
  revenue: MultiYearPLRow[];
  expense: MultiYearPLRow[];
  yearlyTotalRevenue: string[];
  yearlyTotalExpense: string[];
  yearlyNetIncome: string[];
}

export async function buildMultiYearPL(years: number[]): Promise<MultiYearPLReport> {
  const perYear = await Promise.all(years.map((y) => buildPL(y)));

  const pivot = (rows: PLRow[][]): MultiYearPLRow[] => {
    const byCode = new Map<
      string,
      { accountName: string; category: AccountCategory; amounts: Decimal[] }
    >();
    rows.forEach((yearRows, i) => {
      for (const r of yearRows) {
        let entry = byCode.get(r.accountCode);
        if (!entry) {
          entry = {
            accountName: r.accountName,
            category: r.category,
            amounts: years.map(() => D(0)),
          };
          byCode.set(r.accountCode, entry);
        }
        entry.amounts[i] = D(r.amount);
      }
    });
    return [...byCode.entries()]
      .map(([accountCode, v]) => ({
        accountCode,
        accountName: v.accountName,
        category: v.category,
        amounts: v.amounts.map((d) => d.toString()),
        total: v.amounts.reduce((s, d) => s.plus(d), D(0)).toString(),
      }))
      .sort((a, b) => a.accountCode.localeCompare(b.accountCode));
  };

  return {
    years,
    revenue: pivot(perYear.map((p) => p.revenue)),
    expense: pivot(perYear.map((p) => p.expense)),
    yearlyTotalRevenue: perYear.map((p) => p.totalRevenue),
    yearlyTotalExpense: perYear.map((p) => p.totalExpense),
    yearlyNetIncome: perYear.map((p) => p.netIncome),
  };
}

export interface MultiYearBSRow {
  accountCode: string;
  accountName: string;
  category: AccountCategory;
  balances: string[]; // years と同じ長さ・同じ並び順
}

export interface MultiYearBSReport {
  years: number[];
  assets: MultiYearBSRow[];
  liabilities: MultiYearBSRow[];
  equity: MultiYearBSRow[];
  yearlyTotalAssets: string[];
  yearlyTotalLiabilitiesAndEquity: string[];
  yearlyNetIncome: string[];
}

export async function buildMultiYearBS(years: number[]): Promise<MultiYearBSReport> {
  const perYear = await Promise.all(years.map((y) => buildBS(y)));

  const pivot = (rows: BSRow[][]): MultiYearBSRow[] => {
    const byCode = new Map<
      string,
      { accountName: string; category: AccountCategory; balances: Decimal[] }
    >();
    rows.forEach((yearRows, i) => {
      for (const r of yearRows) {
        let entry = byCode.get(r.accountCode);
        if (!entry) {
          entry = {
            accountName: r.accountName,
            category: r.category,
            balances: years.map(() => D(0)),
          };
          byCode.set(r.accountCode, entry);
        }
        entry.balances[i] = D(r.balance);
      }
    });
    return [...byCode.entries()]
      .map(([accountCode, v]) => ({
        accountCode,
        accountName: v.accountName,
        category: v.category,
        balances: v.balances.map((d) => d.toString()),
      }))
      .sort((a, b) => a.accountCode.localeCompare(b.accountCode));
  };

  return {
    years,
    assets: pivot(perYear.map((p) => p.assets)),
    liabilities: pivot(perYear.map((p) => p.liabilities)),
    equity: pivot(perYear.map((p) => p.equity)),
    yearlyTotalAssets: perYear.map((p) => p.totalAssets),
    yearlyTotalLiabilitiesAndEquity: perYear.map((p) => p.totalLiabilitiesAndEquity),
    yearlyNetIncome: perYear.map((p) => p.netIncome),
  };
}
