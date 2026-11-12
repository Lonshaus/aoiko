import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import Encoding from 'encoding-japanese';
import { db } from '../db/db';
import { parseCsv } from '../lib/csv';
import { D } from '../lib/decimal';
import { setSetting } from '../lib/settings';
import { ACCOUNTS_2026 } from '../tax-schema/2026';
import { buildYayoiCsvRows, exportYayoiCsvParts } from './accountant-export';
import { generateDisposalEntry } from './asset-disposal';
import { correctEntryDate } from './entry-date-fix';
import type { FixedAsset, JournalEntry } from '../db/types';

function decodeSjis(bytes: Uint8Array): string {
  return Encoding.convert(Array.from(bytes), { to: 'UNICODE', from: 'SJIS', type: 'string' });
}

function lumpSumSale(overrides: Partial<FixedAsset> & { id: string }): FixedAsset {
  return {
    name: 'ノートPC',
    acquisitionDate: '2026-01-10',
    acquisitionCost: '150000',
    usefulLifeYears: 3,
    depreciationMethod: 'lump-sum',
    accountCode: '1510',
    disposalType: 'sale',
    disposedDate: '2026-06-01',
    salePrice: '110000',
    essentialToBusiness: true,
    ...overrides,
  };
}

async function sell(asset: FixedAsset): Promise<void> {
  await db.fixedAssets.add(asset);
  const result = await generateDisposalEntry(asset.id);
  expect(result.created).toBe(true);
}

async function exportRows(): Promise<{ rows: string[][]; reasons: string[][] }> {
  const { parts, notices } = await exportYayoiCsvParts(2026);
  const rows = parts.flatMap((p) => parseCsv(decodeSjis(p)));
  return { rows, reasons: notices.map((n) => n.reasons) };
}

async function currentBehaviorRows(): Promise<string[][]> {
  const entries = await db.journalEntries.where('year').equals(2026).toArray();
  const lines = await db.journalLines.toArray();
  const accounts = await db.accounts.where({ year: 2026 }).toArray();
  return buildYayoiCsvRows(entries, lines, accounts, [], {
    taxFilingMethod: 'general',
    simplifiedTaxCategory: 4,
  });
}

function expectBalanced(rows: string[][]): void {
  const debit = rows.reduce((sum, r) => sum.plus(D(r[8] || 0)), D(0));
  const credit = rows.reduce((sum, r) => sum.plus(D(r[14] || 0)), D(0));
  expect(debit.toString()).toBe(credit.toString());
}

function expectSynthesizedOnOwnerContribution(rows: string[][]): void {
  expect(rows).toHaveLength(2);
  expect(rows[1]![4]).toBe('事業主借');
  expect(rows[1]![10]).toBe('事業主借');
  expect(rows[1]![13]).toBe('課税売上込10%');
}

beforeEach(async () => {
  await db.delete();
  await db.open();
  await db.accounts.bulkAdd(ACCOUNTS_2026);
});

afterEach(async () => {
  await db.delete();
});

describe('事業主借に付いた課税売上を売却した資産の科目で出す', () => {
  test('業務上重要な一括償却資産の売却は、合成する 2 つの欄が資産の科目になり、事業主借は対象外のまま', async () => {
    await sell(lumpSumSale({ id: 'asset-0001' }));

    const { rows, reasons } = await exportRows();
    expect(rows).toHaveLength(2);
    const [first, synthesized] = rows as [string[], string[]];
    expect(first[4]).toBe('現金');
    expect(first[10]).toBe('事業主借');
    expect(first[13]).toBe('対象外');
    expect(synthesized[4]).toBe('工具器具備品');
    expect(synthesized[7]).toBe('対象外');
    expect(synthesized[8]).toBe('110000');
    expect(synthesized[10]).toBe('工具器具備品');
    expect(synthesized[13]).toBe('課税売上込10%');
    expect(synthesized[14]).toBe('110000');
    expect(synthesized[15]).toBe('10000');
    expect(rows.flatMap((r) => [r[4], r[10]])).not.toContain('');
    expectBalanced(rows);
    expect(reasons).toEqual([]);
  });

  test('簡易課税では資産の科目の課税売上が第四種になる', async () => {
    await setSetting('taxFilingMethod', 'simplified');
    await setSetting('simplifiedTaxCategory', 5);
    await sell(lumpSumSale({ id: 'asset-0001' }));

    const { rows, reasons } = await exportRows();
    expect(rows[1]![10]).toBe('工具器具備品');
    expect(rows[1]![13]).toBe('課税売上込四10%');
    expect(reasons).toEqual([]);
  });

  test('資産を削除した後は事業主借で合成し、注意に載る', async () => {
    await sell(lumpSumSale({ id: 'asset-0001' }));
    await db.fixedAssets.delete('asset-0001');

    const { rows, reasons } = await exportRows();
    expectSynthesizedOnOwnerContribution(rows);
    expect(rows).toEqual(await currentBehaviorRows());
    expect(reasons).toEqual([['transfer']]);
  });

  test('id の先頭 8 文字が同じ資産が 2 件あると、資産を決めずに注意に載る', async () => {
    await sell(lumpSumSale({ id: 'samepref-0001' }));
    await db.fixedAssets.add(
      lumpSumSale({ id: 'samepref-0002', accountCode: '1513', disposedDate: '2026-07-01' }),
    );

    const { rows, reasons } = await exportRows();
    expectSynthesizedOnOwnerContribution(rows);
    expect(reasons).toEqual([['transfer']]);
  });

  test('資産名に # と 8 文字が入っていても、摘要の末尾の印で資産を決める', async () => {
    await db.fixedAssets.add(
      lumpSumSale({ id: 'A1234567-decoy', accountCode: '1513', disposalType: 'scrap' }),
    );
    await sell(lumpSumSale({ id: 'target-asset', name: 'PC #A1234567' }));

    const entries = await db.journalEntries.toArray();
    expect(entries.map((e) => e.description)).toEqual(['固定資産売却 PC #A1234567 #target-a']);
    const { rows, reasons } = await exportRows();
    expect(rows[1]![10]).toBe('工具器具備品');
    expect(rows[1]![13]).toBe('課税売上込10%');
    expect(reasons).toEqual([]);
  });

  test('id が 8 文字より短い資産も同じ切り方で引ける', async () => {
    await sell(lumpSumSale({ id: 'ab12', accountCode: '1514' }));

    const entries = await db.journalEntries.toArray();
    expect(entries.map((e) => e.description)).toEqual(['固定資産売却 ノートPC #ab12']);
    const { rows, reasons } = await exportRows();
    expect(rows[1]![4]).toBe('車両運搬具');
    expect(rows[1]![10]).toBe('車両運搬具');
    expect(reasons).toEqual([]);
  });

  test('資産の科目が減価償却資産の科目でないときは事業主借で合成し、注意に載る', async () => {
    await sell(lumpSumSale({ id: 'asset-0001', accountCode: '1340' }));

    const { rows, reasons } = await exportRows();
    expectSynthesizedOnOwnerContribution(rows);
    expect(reasons).toEqual([['transfer']]);
  });

  test('資産の科目がその年度の科目表に無いときは事業主借で合成し、注意に載る', async () => {
    await sell(lumpSumSale({ id: 'asset-0001', accountCode: '1516' }));
    await db.accounts.where({ year: 2026, code: '1516' }).delete();

    const { rows, reasons } = await exportRows();
    expectSynthesizedOnOwnerContribution(rows);
    expect(reasons).toEqual([['transfer']]);
  });

  test('日付を訂正した売却仕訳も資産の科目で出す', async () => {
    await sell(lumpSumSale({ id: 'asset-0001' }));
    const [original] = await db.journalEntries.toArray();
    // 旧バージョンが読めない形の日付で保存した仕訳を再現する
    await db.journalEntries.update(original!.id, { date: '2026/06/01' });
    await correctEntryDate(original!.id, '2026-06-15');

    const corrected = (await db.journalEntries.toArray()).filter(
      (e: JournalEntry) => e.status === 'confirmed' && e.originalEntryId === undefined,
    );
    expect(corrected.map((e) => e.date)).toEqual(['2026-06-15']);
    const { rows, reasons } = await exportRows();
    expect(rows).toHaveLength(2);
    expect(rows[0]![3]).toBe('2026/06/15');
    expect(rows[1]![10]).toBe('工具器具備品');
    expect(rows[1]![13]).toBe('課税売上込10%');
    expect(reasons).toEqual([]);
  });

  test('業務上重要でない一括償却資産の売却は出力が変わらない', async () => {
    await sell(lumpSumSale({ id: 'asset-0001', essentialToBusiness: false }));

    const { rows, reasons } = await exportRows();
    expect(rows).toEqual(await currentBehaviorRows());
    expect(rows).toHaveLength(1);
    expect(rows[0]![10]).toBe('雑収入');
    expect(rows[0]![13]).toBe('課税売上込10%');
    expect(reasons).toEqual([]);
  });

  test('資産の科目に課税売上が付く売却は出力が変わらない', async () => {
    await sell({
      id: 'asset-0001',
      name: '旧什器',
      acquisitionDate: '2022-01-01',
      acquisitionCost: '1000000',
      usefulLifeYears: 4,
      depreciationMethod: 'straight-line',
      accountCode: '1510',
      disposalType: 'sale',
      disposedDate: '2026-06-01',
      salePrice: '110000',
    });

    const { rows, reasons } = await exportRows();
    expect(rows).toEqual(await currentBehaviorRows());
    const synthesized = rows.filter((r) => r[13] === '課税売上込10%');
    expect(synthesized).toHaveLength(1);
    expect(synthesized[0]![10]).toBe('工具器具備品');
    expect(reasons).toEqual([]);
  });
});
