import { db } from '../db/db';
import { D } from '../lib/decimal';
import { buildBS, buildPL } from './reports';
import type { PLData } from '../db/types';

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
  hasChange: boolean;
}
// 申告済み年度の filed スナップショットと現在の集計結果を比較し、
// 訂正仕訳によってどれだけ数値が変わったかを返す。
// 修正申告（amended return）の提出要否判断・提出用差分把握に使う。
export async function getAmendmentDiff(year: number): Promise<AmendmentDiff | null> {
  const snap = await db.reportSnapshots
    .where('[year+type+status]')
    .equals([year, 'pl', 'filed'])
    .first();
  if (!snap || snap.payload.type !== 'pl') {
    return null;
  }
  const filed = snap.payload.data as PLData;

  const current = await buildPL(year);

  const delta = D(current.netIncome).minus(filed.netIncome);
  const revDelta = D(current.totalRevenue).minus(filed.totalRevenue);
  const expDelta = D(current.totalExpense).minus(filed.totalExpense);

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
    hasChange: !delta.isZero() || !revDelta.isZero() || !expDelta.isZero(),
  };
}

export type AmendmentChecklistKey =
  | 'unlock'
  | 'reverse'
  | 'review'
  | 'submit'
  | 'relock';

export interface AmendmentChecklistItem {
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