import { db } from '../db/db';
import { D, type Decimal } from '../lib/decimal';
import { readStoredAmount } from '../lib/amount-input';
import { buildBS, buildPL } from './reports';

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
  // 空配列 = 基準スナップショットはあるが差分なし。
  bsChanges: AmendmentBSAccountChange[] | null;
  hasChange: boolean;
  // 申告時のスナップショットを読めず比較できない。「変更なし」とは別の状態として示す
  unreadable: boolean;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}
// 復元されたスナップショットは主キーしか検査していないため、形と金額をここで確かめる
function readFiledPL(
  data: unknown,
): { netIncome: string; totalRevenue: string; totalExpense: string } | undefined {
  if (!isRecord(data)) {
    return undefined;
  }
  const netIncome = readSnapshotAmount(data.netIncome);
  const totalRevenue = readSnapshotAmount(data.totalRevenue);
  const totalExpense = readSnapshotAmount(data.totalExpense);
  if (netIncome === undefined || totalRevenue === undefined || totalExpense === undefined) {
    return undefined;
  }
  return { netIncome, totalRevenue, totalExpense };
}
// 表示は保存されたままの文字列を使う。数値で保存されていたものだけ文字列にする
function readSnapshotAmount(v: unknown): string | undefined {
  const d: Decimal | undefined = readStoredAmount(v);
  if (d === undefined) {
    return undefined;
  }
  return typeof v === 'string' ? v : d.toString();
}
// filed/superseded の bs スナップショットを資産・負債・純資産の科目コード→金額へまとめる。読めなければ undefined
function flattenBS(data: unknown): Map<string, string> | undefined {
  if (!isRecord(data)) {
    return undefined;
  }
  const { assets, liabilities, equity } = data;
  if (!Array.isArray(assets) || !Array.isArray(liabilities) || !Array.isArray(equity)) {
    return undefined;
  }
  const map = new Map<string, string>();
  for (const row of [...assets, ...liabilities, ...equity] as unknown[]) {
    if (!isRecord(row) || typeof row.accountCode !== 'string') {
      return undefined;
    }
    const amount = readSnapshotAmount(row.amount);
    if (amount === undefined) {
      return undefined;
    }
    map.set(row.accountCode, amount);
  }
  return map;
}

function unreadableDiff(year: number, filedAt: number): AmendmentDiff {
  return {
    year,
    filedAt,
    filedNetIncome: '',
    currentNetIncome: '',
    netIncomeDelta: '',
    filedTotalRevenue: '',
    currentTotalRevenue: '',
    filedTotalExpense: '',
    currentTotalExpense: '',
    bsChanges: null,
    hasChange: false,
    unreadable: true,
  };
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
  if (!snap) {
    return null;
  }
  const filedAt = snap.filedAt ?? snap.generatedAt;
  const payload = snap.payload as unknown;
  if (isRecord(payload) && payload.type !== 'pl') {
    return null;
  }
  const filed = isRecord(payload) ? readFiledPL(payload.data) : undefined;
  if (filed === undefined) {
    return unreadableDiff(year, filedAt);
  }

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
  const bsPayload = bsSnap?.payload as unknown;
  if (bsSnap && !(isRecord(bsPayload) && bsPayload.type !== 'bs')) {
    const filedBS = isRecord(bsPayload) ? flattenBS(bsPayload.data) : undefined;
    if (filedBS === undefined) {
      return unreadableDiff(year, filedAt);
    }
    const bsReport = await buildBS(year);
    const currentBS = flattenBS({
      assets: bsReport.assets.map((r) => ({ accountCode: r.accountCode, amount: r.balance })),
      liabilities: bsReport.liabilities.map((r) => ({
        accountCode: r.accountCode,
        amount: r.balance,
      })),
      equity: bsReport.equity.map((r) => ({ accountCode: r.accountCode, amount: r.balance })),
    })!;
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
    filedAt,
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
    unreadable: false,
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
