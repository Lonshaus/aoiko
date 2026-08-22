import { db } from '../db/db';
import { D } from '../lib/decimal';
import { buildBS, buildPL } from './reports';
import type { BSData, PLData } from '../db/types';

interface AmendmentBSAccountChange {
  accountCode: string;
  filedAmount: string;
  currentAmount: string;
}

export interface AmendmentDiff {
  year: number;
  filedAt: number;
  filedNetIncome: string;
  currentNetIncome: string;
  netIncomeDelta: string;
  filedTotalRevenue: string;
  currentTotalRevenue: string;
  filedTotalExpense: string;
  currentTotalExpense: string;
  // null = 当該年度の filed 時点で bs スナップショットが保存されていない（旧仕様で申告した年度）。
  // 空配列 = baseline はあるが差分なし。
  bsChanges: AmendmentBSAccountChange[] | null;
  hasChange: boolean;
}
// filed/superseded の bs スナップショットを資産・負債・純資産の科目コード→金額へまとめる。
function flattenBS(data: BSData): Map<string, string> {
  const map = new Map<string, string>();
  for (const row of [...data.assets, ...data.liabilities, ...data.equity]) {
    map.set(row.accountCode, row.amount);
  }
  return map;
}
// 申告済み年度の filed スナップショットと現在の集計結果を比較し、
// 訂正仕訳によってどれだけ数値が変わったかを返す。
// 修正申告（amended return）の提出要否判断・提出用差分把握に使う。
export async function getAmendmentDiff(year: number): Promise<AmendmentDiff | null> {
  // 当初申告の基準スナップショット。ロック中は 'filed'、ロック解除後（修正申告中）は
  // 'superseded' になっているため、どちらも基準として採用する。複数あれば最新の申告を使う。
  const candidates = await db.reportSnapshots
    .where('year')
    .equals(year)
    .filter((s) => s.type === 'pl' && (s.status === 'filed' || s.status === 'superseded'))
    .toArray();
  const snap = candidates.sort(
    (a, b) => (b.filedAt ?? b.generatedAt) - (a.filedAt ?? a.generatedAt),
  )[0];
  if (!snap || snap.payload.type !== 'pl') {
    return null;
  }
  const filed = snap.payload.data as PLData;

  const current = await buildPL(year);

  const delta = D(current.netIncome).minus(filed.netIncome);
  const revDelta = D(current.totalRevenue).minus(filed.totalRevenue);
  const expDelta = D(current.totalExpense).minus(filed.totalExpense);
  // BS は PL と別スナップショット（旧仕様で申告した年度には保存されていない）。
  // 同じ filed/superseded 選定ロジックを bs 型に対して繰り返す。
  const bsCandidates = await db.reportSnapshots
    .where('year')
    .equals(year)
    .filter((s) => s.type === 'bs' && (s.status === 'filed' || s.status === 'superseded'))
    .toArray();
  const bsSnap = bsCandidates.sort(
    (a, b) => (b.filedAt ?? b.generatedAt) - (a.filedAt ?? a.generatedAt),
  )[0];

  let bsChanges: AmendmentBSAccountChange[] | null = null;
  if (bsSnap && bsSnap.payload.type === 'bs') {
    const filedBS = flattenBS(bsSnap.payload.data);
    const bsReport = await buildBS(year);
    const currentBS = flattenBS({
      assets: bsReport.assets.map((r) => ({ accountCode: r.accountCode, amount: r.balance })),
      liabilities: bsReport.liabilities.map((r) => ({
        accountCode: r.accountCode,
        amount: r.balance,
      })),
      equity: bsReport.equity.map((r) => ({ accountCode: r.accountCode, amount: r.balance })),
    });
    const codes = new Set([...filedBS.keys(), ...currentBS.keys()]);
    bsChanges = [];
    for (const code of codes) {
      const filedAmount = filedBS.get(code) ?? '0';
      const currentAmount = currentBS.get(code) ?? '0';
      if (!D(filedAmount).equals(currentAmount)) {
        bsChanges.push({ accountCode: code, filedAmount, currentAmount });
      }
    }
    bsChanges.sort((a, b) => a.accountCode.localeCompare(b.accountCode));
  }

  return {
    year,
    filedAt: snap.filedAt ?? snap.generatedAt,
    filedNetIncome: filed.netIncome,
    currentNetIncome: current.netIncome,
    netIncomeDelta: delta.toString(),
    filedTotalRevenue: filed.totalRevenue,
    currentTotalRevenue: current.totalRevenue,
    filedTotalExpense: filed.totalExpense,
    currentTotalExpense: current.totalExpense,
    bsChanges,
    hasChange:
      !delta.isZero() || !revDelta.isZero() || !expDelta.isZero() || (bsChanges?.length ?? 0) > 0,
  };
}

export type AmendmentChecklistKey = 'unlock' | 'reverse' | 'review' | 'submit' | 'relock';

interface AmendmentChecklistItem {
  key: AmendmentChecklistKey;
}
// 修正申告の標準的な手順 key 列。ラベル本文は UI 層で i18n 経由解決。
export function amendmentChecklist(): AmendmentChecklistItem[] {
  return [
    { key: 'unlock' },
    { key: 'reverse' },
    { key: 'review' },
    { key: 'submit' },
    { key: 'relock' },
  ];
}
