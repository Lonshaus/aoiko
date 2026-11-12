import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { db } from '../db/db';
import { toIndexable } from '../lib/decimal';
import { newId } from '../lib/id';
import { computeInventoryValuation, loadYearDataWithInventory } from './inventory';
import { loadYearData } from './reports';
import { countsTowardTotals } from './journal';
import type { Account, JournalEntry, JournalLine } from '../db/types';

const TEST_ACCOUNTS: Account[] = [
  { code: '1130', year: 2026, name: '普通預金', category: 'asset', displayOrder: 130 },
  { code: '4110', year: 2026, name: '売上高', category: 'revenue', displayOrder: 110 },
  { code: '5020', year: 2026, name: '仕入', category: 'expense', displayOrder: 20 },
];

async function addEntry(opts: {
  date: string;
  lines: Array<{
    side: 'debit' | 'credit';
    accountCode: string;
    amount: string;
    itemId?: string;
    quantity?: string;
  }>;
  status?: 'confirmed' | 'reversed';
  originalEntryId?: string;
}): Promise<string> {
  const entryId = newId();
  const now = Date.now();
  await db.transaction('rw', [db.journalEntries, db.journalLines], async () => {
    await db.journalEntries.add({
      id: entryId,
      date: opts.date,
      year: Number(opts.date.slice(0, 4)),
      description: 'テスト',
      status: opts.status ?? 'confirmed',
      source: 'manual',
      createdAt: now,
      confirmedAt: now,
      ...(opts.originalEntryId ? { originalEntryId: opts.originalEntryId } : {}),
    });
    const lines: JournalLine[] = opts.lines.map((l) => ({
      id: newId(),
      entryId,
      side: l.side,
      accountCode: l.accountCode,
      amount: l.amount,
      amountIndexed: toIndexable(l.amount),
      taxRate: 0,
      taxIncluded: true,
      invoiceCompliant: false,
      ...(l.itemId ? { itemId: l.itemId } : {}),
      ...(l.quantity ? { quantity: l.quantity } : {}),
    }));
    await db.journalLines.bulkAdd(lines);
  });
  return entryId;
}

beforeEach(async () => {
  await db.delete();
  await db.open();
  await db.accounts.bulkAdd(TEST_ACCOUNTS);
});

afterEach(async () => {
  await db.delete();
});

describe('computeInventoryValuation', () => {
  test('仕入で数量加算・直近単価を記録する', async () => {
    await addEntry({
      date: '2026-03-01',
      lines: [
        { side: 'debit', accountCode: '5020', amount: '10000', itemId: 'item-a', quantity: '10' },
        { side: 'credit', accountCode: '1130', amount: '10000' },
      ],
    });
    const result = await computeInventoryValuation('2026-12-31');
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.quantity.toString()).toBe('10');
    expect(result.items[0]?.unitCost.toString()).toBe('1000');
    expect(result.totalValue.toString()).toBe('10000');
  });

  test('売上で数量を減算し、単価には影響しない', async () => {
    await addEntry({
      date: '2026-03-01',
      lines: [
        { side: 'debit', accountCode: '5020', amount: '10000', itemId: 'item-a', quantity: '10' },
        { side: 'credit', accountCode: '1130', amount: '10000' },
      ],
    });
    await addEntry({
      date: '2026-04-01',
      lines: [
        { side: 'debit', accountCode: '1130', amount: '3000' },
        { side: 'credit', accountCode: '4110', amount: '3000', itemId: 'item-a', quantity: '3' },
      ],
    });
    const result = await computeInventoryValuation('2026-12-31');
    expect(result.items[0]?.quantity.toString()).toBe('7');
    expect(result.items[0]?.unitCost.toString()).toBe('1000');
    expect(result.totalValue.toString()).toBe('7000');
  });

  test('売上返品（借方売上高）は在庫を戻す', async () => {
    await addEntry({
      date: '2026-03-01',
      lines: [
        { side: 'debit', accountCode: '5020', amount: '10000', itemId: 'item-a', quantity: '10' },
        { side: 'credit', accountCode: '1130', amount: '10000' },
      ],
    });
    await addEntry({
      date: '2026-04-01',
      lines: [
        { side: 'debit', accountCode: '1130', amount: '3000' },
        { side: 'credit', accountCode: '4110', amount: '3000', itemId: 'item-a', quantity: '3' },
      ],
    });
    await addEntry({
      date: '2026-05-01',
      lines: [
        { side: 'debit', accountCode: '4110', amount: '1000', itemId: 'item-a', quantity: '1' },
        { side: 'credit', accountCode: '1130', amount: '1000' },
      ],
    });
    // 仕入10 − 販売3 + 返品1 = 8
    const result = await computeInventoryValuation('2026-12-31');
    expect(result.items[0]?.quantity.toString()).toBe('8');
    expect(result.totalValue.toString()).toBe('8000');
  });

  test('仕入返品（貸方仕入）は在庫を減らし、直近仕入単価を上書きしない', async () => {
    await addEntry({
      date: '2026-03-01',
      lines: [
        { side: 'debit', accountCode: '5020', amount: '10000', itemId: 'item-a', quantity: '10' },
        { side: 'credit', accountCode: '1130', amount: '10000' },
      ],
    });
    await addEntry({
      date: '2026-04-01',
      lines: [
        { side: 'debit', accountCode: '1130', amount: '2000' },
        { side: 'credit', accountCode: '5020', amount: '2000', itemId: 'item-a', quantity: '2' },
      ],
    });
    const result = await computeInventoryValuation('2026-12-31');
    expect(result.items[0]?.quantity.toString()).toBe('8');
    expect(result.items[0]?.unitCost.toString()).toBe('1000');
    expect(result.totalValue.toString()).toBe('8000');
  });

  test('最終仕入原価法：直近の仕入単価を使う（過去の単価は無視）', async () => {
    await addEntry({
      date: '2026-01-01',
      lines: [
        { side: 'debit', accountCode: '5020', amount: '10000', itemId: 'item-a', quantity: '10' },
        { side: 'credit', accountCode: '1130', amount: '10000' },
      ],
    });
    await addEntry({
      date: '2026-06-01',
      lines: [
        { side: 'debit', accountCode: '5020', amount: '6600', itemId: 'item-a', quantity: '5' },
        { side: 'credit', accountCode: '1130', amount: '6600' },
      ],
    });
    const result = await computeInventoryValuation('2026-12-31');
    // 数量は累積 10+5=15、単価は直近仕入（6600/5=1320）を使う
    expect(result.items[0]?.quantity.toString()).toBe('15');
    expect(result.items[0]?.unitCost.toString()).toBe('1320');
    expect(result.totalValue.toString()).toBe('19800');
  });

  test('asOfDate より後の仕入は含めない', async () => {
    await addEntry({
      date: '2026-03-01',
      lines: [
        { side: 'debit', accountCode: '5020', amount: '10000', itemId: 'item-a', quantity: '10' },
        { side: 'credit', accountCode: '1130', amount: '10000' },
      ],
    });
    await addEntry({
      date: '2027-01-15',
      lines: [
        { side: 'debit', accountCode: '5020', amount: '5000', itemId: 'item-a', quantity: '5' },
        { side: 'credit', accountCode: '1130', amount: '5000' },
      ],
    });
    const result = await computeInventoryValuation('2026-12-31');
    expect(result.items[0]?.quantity.toString()).toBe('10');
  });

  test('itemId/quantity の無い行は無視する', async () => {
    await addEntry({
      date: '2026-03-01',
      lines: [
        { side: 'debit', accountCode: '5020', amount: '5000' },
        { side: 'credit', accountCode: '1130', amount: '5000' },
      ],
    });
    const result = await computeInventoryValuation('2026-12-31');
    expect(result.items).toHaveLength(0);
    expect(result.totalValue.toString()).toBe('0');
  });

  test('reversed（訂正済み原仕訳）は集計から除外する', async () => {
    const originalId = await addEntry({
      date: '2026-03-01',
      lines: [
        { side: 'debit', accountCode: '5020', amount: '10000', itemId: 'item-a', quantity: '10' },
        { side: 'credit', accountCode: '1130', amount: '10000' },
      ],
    });
    await db.journalEntries.update(originalId, { status: 'reversed' });
    await addEntry({
      date: '2026-03-02',
      originalEntryId: originalId,
      lines: [
        { side: 'credit', accountCode: '5020', amount: '10000', itemId: 'item-a', quantity: '10' },
        { side: 'debit', accountCode: '1130', amount: '10000' },
      ],
    });
    const result = await computeInventoryValuation('2026-12-31');
    expect(result.items).toHaveLength(0);
  });

  test('日付が空の仕訳（旧バージョンの読み取り）は数量に含めない', async () => {
    await addEntry({
      date: '',
      lines: [
        { side: 'debit', accountCode: '5020', amount: '10000', itemId: 'item-a', quantity: '10' },
        { side: 'credit', accountCode: '1130', amount: '10000' },
      ],
    });
    const result = await computeInventoryValuation('2026-12-31');
    expect(result.items).toHaveLength(0);
  });

  test('在庫がマイナスになった場合は評価額を0とする', async () => {
    await addEntry({
      date: '2026-03-01',
      lines: [
        { side: 'debit', accountCode: '1130', amount: '3000' },
        { side: 'credit', accountCode: '4110', amount: '3000', itemId: 'item-a', quantity: '3' },
      ],
    });
    const result = await computeInventoryValuation('2026-12-31');
    expect(result.items[0]?.quantity.toString()).toBe('-3');
    expect(result.items[0]?.value.toString()).toBe('0');
  });
});

async function addRawEntry(opts: {
  id: string;
  date: unknown;
  year: number;
  lines: Array<{
    side: 'debit' | 'credit';
    accountCode: string;
    amount: string;
    itemId?: string;
    quantity?: string;
  }>;
}): Promise<void> {
  const now = Date.now();
  await db.journalEntries.add({
    id: opts.id,
    date: opts.date,
    year: opts.year,
    description: 'テスト',
    status: 'confirmed',
    source: 'manual',
    createdAt: now,
    confirmedAt: now,
  } as unknown as JournalEntry);
  await db.journalLines.bulkAdd(
    opts.lines.map((l, i) => ({
      id: `${opts.id}-l${i}`,
      entryId: opts.id,
      side: l.side,
      accountCode: l.accountCode,
      amount: l.amount,
      amountIndexed: toIndexable(l.amount),
      taxRate: 0,
      taxIncluded: true,
      invoiceCompliant: false,
      ...(l.itemId ? { itemId: l.itemId } : {}),
      ...(l.quantity ? { quantity: l.quantity } : {}),
    })),
  );
}

const PURCHASE = (itemId: string, amount: string, quantity: string) => [
  { side: 'debit' as const, accountCode: '5020', amount, itemId, quantity },
  { side: 'credit' as const, accountCode: '1130', amount },
];

function serialize(r: Awaited<ReturnType<typeof computeInventoryValuation>>): unknown {
  return {
    totalValue: r.totalValue.toString(),
    items: r.items.map((i) => ({
      itemId: i.itemId,
      quantity: i.quantity.toString(),
      unitCost: i.unitCost.toString(),
      value: i.value.toString(),
    })),
  };
}

async function expectSameAsLegacy(year: number, asOf: string): Promise<void> {
  const legacy = await computeInventoryValuation(asOf);
  const legacyEntries = (await db.journalEntries.where('date').belowOrEqual(asOf).toArray()).filter(
    countsTowardTotals,
  );
  const loaded = await loadYearDataWithInventory(year, asOf);
  const viaSource = await computeInventoryValuation(asOf, loaded.inventory);
  expect(serialize(viaSource)).toEqual(serialize(legacy));
  expect(loaded.inventory.entries.map((e) => e.id)).toEqual(legacyEntries.map((e) => e.id));
  expect(loaded.inventory.entries).toEqual(legacyEntries);
  const legacyInventoryLines =
    legacyEntries.length > 0
      ? await db.journalLines
          .where('entryId')
          .anyOf(legacyEntries.map((e) => e.id))
          .toArray()
      : [];
  expect(loaded.inventory.lines.map((l) => l.id)).toEqual(legacyInventoryLines.map((l) => l.id));
  expect(loaded.inventory.lines).toEqual(legacyInventoryLines);
  const legacyYear = await loadYearData(year);
  expect(loaded.yearData.entries.map((e) => e.id)).toEqual(legacyYear.entries.map((e) => e.id));
  expect(loaded.yearData.entries).toEqual(legacyYear.entries);
  expect(loaded.yearData.lines.map((l) => l.id)).toEqual(legacyYear.lines.map((l) => l.id));
  expect(loaded.yearData.lines).toEqual(legacyYear.lines);
  expect(loaded.yearData.accounts).toEqual(legacyYear.accounts);
}

describe('loadYearDataWithInventory', () => {
  test('年をまたぐ仕入・売上・返品で、渡した場合と渡さない場合の結果が同じ', async () => {
    await db.accounts.add({ ...TEST_ACCOUNTS[0]!, year: 2025 });
    await addEntry({ date: '2025-06-01', lines: PURCHASE('item-a', '10000', '10') });
    await addEntry({ date: '2025-09-01', lines: PURCHASE('item-b', '6000', '3') });
    await addEntry({ date: '2026-03-01', lines: PURCHASE('item-a', '12000', '10') });
    await addEntry({
      date: '2026-04-01',
      lines: [
        { side: 'debit', accountCode: '1130', amount: '3000' },
        { side: 'credit', accountCode: '4110', amount: '3000', itemId: 'item-a', quantity: '3' },
      ],
    });
    await addEntry({
      date: '2026-05-01',
      lines: [
        { side: 'debit', accountCode: '4110', amount: '1000', itemId: 'item-a', quantity: '1' },
        { side: 'credit', accountCode: '1130', amount: '1000' },
      ],
    });
    await addEntry({
      date: '2026-06-01',
      lines: [
        { side: 'debit', accountCode: '1130', amount: '2400' },
        { side: 'credit', accountCode: '5020', amount: '2400', itemId: 'item-a', quantity: '2' },
      ],
    });
    await addEntry({ date: '2027-01-10', lines: PURCHASE('item-a', '99999', '1') });
    const loaded = await loadYearDataWithInventory(2026, '2026-12-31');
    expect(loaded.inventory.entries).toHaveLength(6);
    expect(loaded.yearData.entries).toHaveLength(4);
    await expectSameAsLegacy(2026, '2026-12-31');
    await expectSameAsLegacy(2025, '2025-12-31');
  });

  test('訂正済みの原仕訳と訂正仕訳は両方の集合から外れる', async () => {
    const originalId = await addEntry({
      date: '2026-03-01',
      lines: PURCHASE('item-a', '10000', '10'),
    });
    await db.journalEntries.update(originalId, { status: 'reversed' });
    await addEntry({
      date: '2026-03-02',
      originalEntryId: originalId,
      lines: [
        { side: 'credit', accountCode: '5020', amount: '10000', itemId: 'item-a', quantity: '10' },
        { side: 'debit', accountCode: '1130', amount: '10000' },
      ],
    });
    await addEntry({ date: '2026-03-03', lines: PURCHASE('item-b', '500', '5') });
    const loaded = await loadYearDataWithInventory(2026, '2026-12-31');
    expect(loaded.inventory.entries).toHaveLength(1);
    expect(loaded.yearData.entries).toHaveLength(1);
    await expectSameAsLegacy(2026, '2026-12-31');
  });

  test('日付が年内でも year が違う行、year が同じで日付が ISO でない行は、各集合に別々に入る', async () => {
    await addRawEntry({
      id: 'e1',
      date: '2026-02-01',
      year: 2025,
      lines: PURCHASE('item-a', '1000', '1'),
    });
    await addRawEntry({
      id: 'e2',
      date: '2026/5/1',
      year: 2026,
      lines: PURCHASE('item-a', '2000', '1'),
    });
    await addRawEntry({
      id: 'e3',
      date: '2026-07-01',
      year: 2026,
      lines: PURCHASE('item-a', '3000', '1'),
    });
    const loaded = await loadYearDataWithInventory(2026, '2026-12-31');
    expect(loaded.yearData.entries.map((e) => e.id)).toEqual(['e2', 'e3']);
    expect(loaded.inventory.entries.map((e) => e.id)).toEqual(['e1', 'e3']);
    expect(loaded.yearData.lines.map((l) => l.entryId)).toEqual(['e2', 'e2', 'e3', 'e3']);
    expect(loaded.inventory.lines.map((l) => l.entryId).sort()).toEqual(['e1', 'e1', 'e3', 'e3']);
    await expectSameAsLegacy(2026, '2026-12-31');
  });

  test('数値の日付の行が 1 件だけで id が文字列日付の行より後でも、同じ結果で TypeError にならない', async () => {
    await addRawEntry({
      id: 'a-str',
      date: '2026-03-01',
      year: 2026,
      lines: PURCHASE('item-a', '1000', '1'),
    });
    await addRawEntry({
      id: 'b-num',
      date: 20260101,
      year: 2026,
      lines: PURCHASE('item-a', '2000', '1'),
    });
    const loaded = await loadYearDataWithInventory(2026, '2026-12-31');
    expect(loaded.inventory.entries.map((e) => e.id)).toEqual(['b-num', 'a-str']);
    await expect(computeInventoryValuation('2026-12-31')).resolves.toBeDefined();
    await expectSameAsLegacy(2026, '2026-12-31');
  });

  test('有効な key でない日付の行は在庫の集合に入らない', async () => {
    await addRawEntry({
      id: 'a',
      date: '2026-03-01',
      year: 2026,
      lines: PURCHASE('item-a', '1000', '1'),
    });
    await addRawEntry({ id: 'b', date: true, year: 2026, lines: PURCHASE('item-a', '2000', '1') });
    await addRawEntry({ id: 'c', date: null, year: 2026, lines: PURCHASE('item-a', '3000', '1') });
    const loaded = await loadYearDataWithInventory(2026, '2026-12-31');
    expect(loaded.inventory.entries.map((e) => e.id)).toEqual(['a']);
    expect(loaded.yearData.entries.map((e) => e.id)).toEqual(['a', 'b', 'c']);
    await expectSameAsLegacy(2026, '2026-12-31');
  });

  test('同じ日付の行は主キーの順に並ぶ', async () => {
    await addRawEntry({
      id: 'z',
      date: '2026-03-01',
      year: 2026,
      lines: PURCHASE('item-a', '1000', '1'),
    });
    await addRawEntry({
      id: 'a',
      date: '2026-03-01',
      year: 2026,
      lines: PURCHASE('item-a', '4000', '1'),
    });
    const loaded = await loadYearDataWithInventory(2026, '2026-12-31');
    expect(loaded.inventory.entries.map((e) => e.id)).toEqual(['a', 'z']);
    await expectSameAsLegacy(2026, '2026-12-31');
  });

  test('年度の仕訳がなければ年度データは空', async () => {
    await addEntry({ date: '2025-03-01', lines: PURCHASE('item-a', '1000', '1') });
    const loaded = await loadYearDataWithInventory(2026, '2026-12-31');
    expect(loaded.yearData).toEqual({ entries: [], lines: [], accounts: [] });
    expect(loaded.inventory.entries).toHaveLength(1);
    await expectSameAsLegacy(2026, '2026-12-31');
  });

  test('読み込み済みの仕訳を渡しても、日付が空の仕訳は数量に含めない', async () => {
    await addRawEntry({
      id: 'a',
      date: '2026-03-01',
      year: 2026,
      lines: PURCHASE('item-a', '1000', '1'),
    });
    await addRawEntry({ id: 'b', date: '', year: 2026, lines: PURCHASE('item-a', '20000', '10') });
    const loaded = await loadYearDataWithInventory(2026, '2026-12-31');
    expect(loaded.inventory.entries.map((e) => e.id)).toContain('b');
    const viaSource = await computeInventoryValuation('2026-12-31', loaded.inventory);
    expect(viaSource.items.map((i) => [i.itemId, i.quantity.toString()])).toEqual([
      ['item-a', '1'],
    ]);
    await expectSameAsLegacy(2026, '2026-12-31');
  });

  test('科目が登録されていない年も、年度データの科目は loadYearData と同じになる', async () => {
    await addEntry({ date: '2027-03-01', lines: PURCHASE('item-a', '1000', '1') });
    const loaded = await loadYearDataWithInventory(2027, '2027-12-31');
    expect(loaded.yearData.accounts.length).toBeGreaterThan(0);
    expect(loaded.yearData.accounts.every((a) => a.year === 2027)).toBe(true);
    await expectSameAsLegacy(2027, '2027-12-31');
  });
});
