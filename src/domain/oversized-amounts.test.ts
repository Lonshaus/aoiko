import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { db } from '../db/db';
import { newId } from '../lib/id';
import { setSetting } from '../lib/settings';
import { findOversizedAmounts, findUnreadableReversedAmounts } from './oversized-amounts';
import { exportCorrectionHistoryCsv, exportGenericCsv, exportYayoiCsv } from './accountant-export';
import { reverseEntry } from './reverse';
import type { JournalEntry } from '../db/types';

async function seedEntry(
  amount: unknown,
  opts: { description?: string; status?: JournalEntry['status'] } = {},
): Promise<string> {
  const entryId = newId();
  await db.journalEntries.add({
    id: entryId,
    date: '2026-03-01',
    year: 2026,
    description: opts.description ?? '大きな取引',
    status: opts.status ?? 'confirmed',
    source: 'manual',
    createdAt: 1,
    confirmedAt: 1,
  });
  await db.journalLines.bulkAdd(
    (['debit', 'credit'] as const).map((side) => ({
      id: newId(),
      entryId,
      side,
      accountCode: side === 'debit' ? '5150' : '1130',
      amount: amount as string,
      amountIndexed: '00000000000000.00',
      taxRate: 0,
      taxIncluded: true,
      invoiceCompliant: false,
    })),
  );
  return entryId;
}

beforeEach(async () => {
  await db.delete();
  await db.open();
  await db.accounts.bulkAdd([
    { code: '1130', year: 2026, name: '普通預金', category: 'asset', displayOrder: 130 },
    { code: '5150', year: 2026, name: '通信費', category: 'expense', displayOrder: 150 },
  ]);
});

afterEach(async () => {
  await db.delete();
});

describe('findOversizedAmounts', () => {
  test('1e15 の確定仕訳の明細を日付・摘要付きで返す', async () => {
    await seedEntry('1e15');
    const r = await findOversizedAmounts({ year: 2026 });
    expect(r.total).toBe(2);
    expect(r.items[0]).toEqual({
      kind: 'line',
      date: '2026-03-01',
      description: '大きな取引',
      amount: '1e15',
    });
  });

  test('訂正仕訳で打ち消すと返さない', async () => {
    const id = await seedEntry('1000000000000000');
    await reverseEntry(id);
    expect((await findOversizedAmounts({ year: 2026 })).total).toBe(0);
  });

  test('対の訂正仕訳が無い reversed の仕訳も集計外なので返さない', async () => {
    await seedEntry('1e15', { status: 'reversed' });
    expect((await findOversizedAmounts()).total).toBe(0);
  });

  test('文字列でない金額・指数が範囲外の金額は返し、例外にしない', async () => {
    await seedEntry(5000);
    await seedEntry('1e-5000');
    await seedEntry('0x' + 'f'.repeat(200000));
    expect((await findOversizedAmounts()).total).toBe(6);
  });

  test('復元された 1e3・0x10・1e-7 は返さない', async () => {
    await seedEntry('1e3');
    await seedEntry('0x10');
    await seedEntry('1e-7');
    expect((await findOversizedAmounts()).total).toBe(0);
  });

  test('取得価額が 1e14 以上の固定資産を返す', async () => {
    await db.fixedAssets.add({
      id: 'a1',
      name: '巨大な機械',
      acquisitionDate: '2026-01-01',
      acquisitionCost: '100000000000000',
      usefulLifeYears: 4,
      depreciationMethod: 'straight-line',
      accountCode: '1510',
    });
    const r = await findOversizedAmounts({ year: 2026 });
    expect(r.items).toEqual([
      { kind: 'asset', date: '2026-01-01', description: '巨大な機械', amount: '100000000000000' },
    ]);
  });

  test('金額は先頭 40 文字だけ、一覧は 20 件まで、件数は全部', async () => {
    for (let i = 0; i < 11; i++) {
      await seedEntry('1' + '0'.repeat(100));
    }
    const r = await findOversizedAmounts();
    expect(r.total).toBe(22);
    expect(r.items).toHaveLength(20);
    expect(r.items[0]?.amount).toHaveLength(40);
  });
});

describe('会計士向け CSV の出力前の検査', () => {
  test('打ち消していない 1e15 の明細があれば弥生・汎用は止まり、打ち消すと出力できる', async () => {
    const id = await seedEntry('1000000000000000');
    await expect(exportYayoiCsv(2026)).rejects.toThrow('大きな取引');
    await expect(exportGenericCsv(2026)).rejects.toThrow('大きな取引');
    await reverseEntry(id);
    await expect(exportYayoiCsv(2026)).resolves.toBeInstanceOf(Uint8Array);
    await expect(exportGenericCsv(2026)).resolves.toBeInstanceOf(Uint8Array);
  });

  test('訂正履歴は打ち消した 1e15 の仕訳も出力し、その行を含む', async () => {
    const id = await seedEntry('1000000000000000');
    await reverseEntry(id);
    const csv = new TextDecoder().decode(await exportCorrectionHistoryCsv(2026));
    expect(csv).toContain('1000000000000000');
  });

  test.each([5000, 'abc'])(
    '打ち消し済みの仕訳の明細が %j なら訂正履歴は止まって一覧を示す',
    async (amount) => {
      await seedEntry(amount, { status: 'reversed', description: '壊れた原仕訳' });
      expect((await findUnreadableReversedAmounts(2026)).total).toBe(2);
      await expect(exportCorrectionHistoryCsv(2026)).rejects.toThrow('壊れた原仕訳');
    },
  );

  test('基準期間の課税売上高が数値で保存されていれば弥生 CSV は設定名を示して止まる', async () => {
    await setSetting('basePeriodTaxableSales', 20000000 as unknown as string);
    await expect(exportYayoiCsv(2026)).rejects.toThrow('基準期間');
  });
});
