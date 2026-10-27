import { db } from '../db/db';
import { D } from '../lib/decimal';
import { readStoredAmount } from '../lib/amount-input';
import { buildMonthly } from './reports';
import type { Budget } from '../db/types';

interface MonthlyBudgetRow {
  month: number;
  revenueBudget: string;
  revenueActual: string;
  revenueDiff: string; // 実績 - 予算（収入は正なら予算超過達成）。予算を読めないときは ''
  expenseBudget: string;
  expenseActual: string;
  expenseDiff: string; // 実績 - 予算（支出は正なら予算オーバー）。予算を読めないときは ''
}

export interface BudgetVsActualReport {
  year: number;
  months: MonthlyBudgetRow[];
}
// 予算 vs 実際。実績は既存の buildMonthly をそのまま使い回す
// （月別売上/経費の集計ロジックを重複させない）。
export async function computeBudgetVsActual(year: number): Promise<BudgetVsActualReport> {
  const monthly = await buildMonthly(year);
  const budgetRows = await db.budgets.where('year').equals(year).toArray();
  const budgetMap = new Map(budgetRows.map((b) => [b.month, b]));

  const months = monthly.months.map((m, i): MonthlyBudgetRow => {
    const month = i + 1;
    const b = budgetMap.get(month);
    const revenueBudget = b?.revenueBudget ?? '0';
    const expenseBudget = b?.expenseBudget ?? '0';
    return {
      month,
      revenueBudget,
      revenueActual: m.sales,
      revenueDiff: diffOrEmpty(m.sales, revenueBudget),
      expenseBudget,
      expenseActual: m.expense,
      expenseDiff: diffOrEmpty(m.expense, expenseBudget),
    };
  });

  return { year, months };
}
// 復元された予算は金額を検査していないため、読めない予算の月だけ差異を出さない
function diffOrEmpty(actual: string, budget: unknown): string {
  const b = readStoredAmount(budget);
  return b === undefined ? '' : D(actual).minus(b).toString();
}

export async function setBudget(budget: Budget): Promise<void> {
  await db.budgets.put(budget);
}

export async function getBudgets(year: number): Promise<Budget[]> {
  return db.budgets.where('year').equals(year).sortBy('month');
}
