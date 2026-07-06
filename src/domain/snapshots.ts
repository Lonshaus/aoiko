import { db } from '../db/db';
import { newId } from '../lib/id';
import type { ConsumptionTaxSnapshotData, ReportSnapshot, ReportSnapshotData } from '../db/types';
// 年度を「申告済み」としてロックする。
// PL / BS / 月別売上 の 3 種類のスナップショットを `status='filed'` で記録し、
// 以降その年度の仕訳を訂正できなくする。
export async function markYearFiled(
  year: number,
  payloads: {
    monthlySales: ReportSnapshotData & { type: 'monthly-sales' };
    pl: ReportSnapshotData & { type: 'pl' };
    bs?: ReportSnapshotData & { type: 'bs' };
    consumptionTax?: ReportSnapshotData & { type: 'consumption-tax' };
  },
  generatedFromEntriesUpTo: string
): Promise<void> {
  const now = Date.now();
  const records: ReportSnapshot[] = [
    {
      id: newId(),
      year,
      type: 'monthly-sales',
      status: 'filed',
      filedAt: now,
      payload: payloads.monthlySales,
      generatedAt: now,
      generatedFromEntriesUpTo,
    },
    {
      id: newId(),
      year,
      type: 'pl',
      status: 'filed',
      filedAt: now,
      payload: payloads.pl,
      generatedAt: now,
      generatedFromEntriesUpTo,
    },
  ];
  if (payloads.bs) {
    records.push({
      id: newId(),
      year,
      type: 'bs',
      status: 'filed',
      filedAt: now,
      payload: payloads.bs,
      generatedAt: now,
      generatedFromEntriesUpTo,
    });
  }
  if (payloads.consumptionTax) {
    records.push({
      id: newId(),
      year,
      type: 'consumption-tax',
      status: 'filed',
      filedAt: now,
      payload: payloads.consumptionTax,
      generatedAt: now,
      generatedFromEntriesUpTo,
    });
  }
  await db.reportSnapshots.bulkAdd(records);
}
// 指定年度の確定消費税額スナップショットを取得する（中間申告義務判定の基準用）。
// superseded（修正申告でロック解除済み）は対象外——当初申告ではなく「今も有効な
// 確定額」を返す必要があるため。
export async function getConsumptionTaxSnapshot(
  year: number
): Promise<ConsumptionTaxSnapshotData | undefined> {
  const filed = await db.reportSnapshots
    .where('[year+type+status]')
    .equals([year, 'consumption-tax', 'filed'])
    .first();
  return filed?.payload.type === 'consumption-tax' ? filed.payload.data : undefined;
}

export async function isYearLocked(year: number): Promise<boolean> {
  const filed = await db.reportSnapshots
    .where('[year+type+status]')
    .equals([year, 'pl', 'filed'])
    .first();
  return !!filed;
}
// 申告ロック解除（誤ロック・修正申告対応の管理者向け）。
// filed スナップショットは削除せず status='superseded' に変更する。
// これにより当初申告の数値が残り、修正申告差分（getAmendmentDiff）の基準として使える。
export async function unlockYear(year: number): Promise<{ removed: number }> {
  const filed = await db.reportSnapshots
    .where('year')
    .equals(year)
    .filter((s) => s.status === 'filed')
    .toArray();
  await db.transaction('rw', db.reportSnapshots, async () => {
    for (const s of filed) {
      await db.reportSnapshots.update(s.id, { status: 'superseded' });
    }
  });
  return { removed: filed.length };
}