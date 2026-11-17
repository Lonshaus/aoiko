import { db } from '../db/db';
import { newId } from '../lib/id';
import type { ConsumptionTaxSnapshotData, ReportSnapshot, ReportSnapshotData } from '../db/types';
// 申告時の集計と申告記録の書き込みを一つの取引で行う。ほかのタブの仕訳の書き込みは、申告が確定してから走る。
export function runFilingTransaction<T>(fn: () => Promise<T>): Promise<T> {
  return db.transaction(
    'rw',
    [db.journalEntries, db.journalLines, db.accounts, db.settings, db.reportSnapshots],
    fn,
  );
}
// 年度を「申告済み」としてロックする。
// PL / BS / 月別売上（と課税事業者の年は消費税の確定額）のスナップショットを
// `status='filed'` で記録する。以降その年度への書き込みは確認を経たものだけ通し（db/filed-year-guard）、請求書の発行・取消は確認があっても拒否する。
export async function markYearFiled(
  year: number,
  payloads: {
    monthlySales: ReportSnapshotData & { type: 'monthly-sales' };
    pl: ReportSnapshotData & { type: 'pl' };
    bs?: ReportSnapshotData & { type: 'bs' };
    consumptionTax?: ReportSnapshotData & { type: 'consumption-tax' };
  },
  generatedFromEntriesUpTo: string,
): Promise<void> {
  const legacy = await usesLegacyPurchaseAssetRule(year);
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
  // 印は書き込む前の記録で決める。同じ取引の中の消費税の計算も、この時点の記録を読んでいる
  if (!legacy) {
    for (const r of records) {
      r.excludesNonPurchaseAssets = true;
    }
  }
  await db.reportSnapshots.bulkAdd(records);
}
// 申告済みの年分は申告時の仕入判定を保つ。損益計算書の記録に印の無いものが 1 件でもあれば、
// 現金・預金・金銭債権の借方も仕入に含めていた時期に申告した年分として扱う
export async function usesLegacyPurchaseAssetRule(year: number): Promise<boolean> {
  const records = await db.reportSnapshots
    .where('[year+type+status]')
    .anyOf([
      [year, 'pl', 'filed'],
      [year, 'pl', 'superseded'],
    ])
    .toArray();
  return records.some((r) => r.excludesNonPurchaseAssets !== true);
}
// 指定年度の確定消費税額スナップショットを取得する（中間申告義務判定の基準用）。
// superseded（修正申告でロック解除済み）は対象外——当初申告ではなく「今も有効な
// 確定額」を返す必要があるため。
export async function getConsumptionTaxSnapshot(
  year: number,
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
