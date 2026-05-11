import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { db } from '../db/db';
import { D, toIndexable } from '../lib/decimal';
import { newId } from '../lib/id';
import { ACCOUNTS_2026 } from '../tax-schema/2026';
import { applyCarryover, computeCarryover, removeCarryover } from './carryover';
import type { Account, EntrySource, LineSide } from '../db/types';

async function seedAccounts(year: number): Promise<void> {
  const accs: Account[] = ACCOUNTS_2026.map((a) => ({ ...a, year }));
  await db.accounts.bulkPut(accs);
}

interface Pair {
  side: LineSide;
  accountCode: string;
  amount: string;
}

async function seedEntry(opts: {
  date: string;
  description: string;
  pairs: Pair[];
  source?: EntrySource;
}): Promise<string> {
  const entryId = newId();
  const now = Date.now();
  await db.transaction('rw', db.journalEntries, db.journalLines, async () => {
    await db.journalEntries.add({
      id: entryId,
      date: opts.date,
      year: Number(opts.date.slice(0, 4)),
      description: opts.description,
      status: 'confirmed',
      source: opts.source ?? 'manual',
      createdAt: now,
      confirmedAt: now,
    });
    await db.journalLines.bulkAdd(
      opts.pairs.map((p) => ({
        id: newId(),
        entryId,
        side: p.side,
        accountCode: p.accountCode,
        amount: p.amount,
        amountIndexed: toIndexable(p.amount),
        taxRate: 0,
        taxIncluded: false,
        invoiceCompliant: false,
      }))
    );
  });
  return entryId;
}

beforeEach(async () => {
  await db.delete();
  await db.open();
});

afterEach(async () => {
  await db.delete();
});

describe('computeCarryover', () => {
  test('前年に仕訳がなければ空のプレビュー', async () => {
    await seedAccounts(2025);
    const p = await computeCarryover(2026);
    expect(p.year).toBe(2026);
    expect(p.priorYear).toBe(2025);
    expect(p.openingDate).toBe('2026-01-01');
    expect(p.assets).toEqual([]);
    expect(p.liabilities).toEqual([]);
    expect(p.capitalAmount).toBe('0');
  });

  test('資産残高をそのまま繰越', async () => {
    await seedAccounts(2025);
    // 元入金 100,000 / 普通預金 100,000 開業仕訳
    await seedEntry({
      date: '2025-01-01',
      description: '開業',
      pairs: [
        { side: 'debit', accountCode: '1130', amount: '100000' },
        { side: 'credit', accountCode: '3110', amount: '100000' },
      ],
    });
    const p = await computeCarryover(2026);
    expect(p.assets).toEqual([
      { accountCode: '1130', accountName: '普通預金', amount: '100000' },
    ]);
    expect(p.liabilities).toEqual([]);
    expect(p.capitalAmount).toBe('100000');
  });

  test('純利益が元入金に吸収される', async () => {
    await seedAccounts(2025);
    // 開業：普通預金 / 元入金 100,000
    await seedEntry({
      date: '2025-01-01',
      description: '開業',
      pairs: [
        { side: 'debit', accountCode: '1130', amount: '100000' },
        { side: 'credit', accountCode: '3110', amount: '100000' },
      ],
    });
    // 売上：普通預金 / 売上高 50,000
    await seedEntry({
      date: '2025-06-01',
      description: '売上',
      pairs: [
        { side: 'debit', accountCode: '1130', amount: '50000' },
        { side: 'credit', accountCode: '4110', amount: '50000' },
      ],
    });
    // 経費：消耗品費 / 普通預金 10,000
    await seedEntry({
      date: '2025-07-01',
      description: '消耗品',
      pairs: [
        { side: 'debit', accountCode: '5200', amount: '10000' },
        { side: 'credit', accountCode: '1130', amount: '10000' },
      ],
    });
    const p = await computeCarryover(2026);
    // 普通預金 = 100000 + 50000 - 10000 = 140000
    expect(p.assets).toEqual([
      { accountCode: '1130', accountName: '普通預金', amount: '140000' },
    ]);
    expect(p.priorNetIncome).toBe('40000');
    // 元入金 = 100000 + 40000 = 140000
    expect(p.capitalAmount).toBe('140000');
  });

  test('事業主貸・事業主借を元入金へ吸収', async () => {
    await seedAccounts(2025);
    // 元入金 200,000 開業
    await seedEntry({
      date: '2025-01-01',
      description: '開業',
      pairs: [
        { side: 'debit', accountCode: '1130', amount: '200000' },
        { side: 'credit', accountCode: '3110', amount: '200000' },
      ],
    });
    // 生活費引き出し：事業主貸 / 普通預金 30,000
    await seedEntry({
      date: '2025-05-01',
      description: '生活費',
      pairs: [
        { side: 'debit', accountCode: '1610', amount: '30000' },
        { side: 'credit', accountCode: '1130', amount: '30000' },
      ],
    });
    // 私的資金注入：普通預金 / 事業主借 50,000
    await seedEntry({
      date: '2025-08-01',
      description: '注入',
      pairs: [
        { side: 'debit', accountCode: '1130', amount: '50000' },
        { side: 'credit', accountCode: '3120', amount: '50000' },
      ],
    });
    const p = await computeCarryover(2026);
    // 普通預金 = 200000 - 30000 + 50000 = 220000
    expect(p.assets.find((a) => a.accountCode === '1130')?.amount).toBe('220000');
    // 事業主貸は資産リストから除外（元入金に吸収）
    expect(p.assets.find((a) => a.accountCode === '1610')).toBeUndefined();
    // 元入金 = 200000 + 0 (純利益) + 50000 (事業主借) - 30000 (事業主貸) = 220000
    expect(p.capitalAmount).toBe('220000');
    expect(p.priorOwnerWithdrawals).toBe('30000');
    expect(p.priorOwnerContributions).toBe('50000');
  });

  test('負債を繰越', async () => {
    await seedAccounts(2025);
    // 仕入：消耗品費 / 買掛金 30,000
    await seedEntry({
      date: '2025-12-25',
      description: '仕入',
      pairs: [
        { side: 'debit', accountCode: '5200', amount: '30000' },
        { side: 'credit', accountCode: '2110', amount: '30000' },
      ],
    });
    const p = await computeCarryover(2026);
    expect(p.liabilities).toEqual([
      { accountCode: '2110', accountName: '買掛金', amount: '30000' },
    ]);
    // 純利益 -30000、元入金 0 + (-30000) = -30000
    expect(p.priorNetIncome).toBe('-30000');
    expect(p.capitalAmount).toBe('-30000');
  });

  test('reversed の仕訳は集計対象外', async () => {
    await seedAccounts(2025);
    const id = await seedEntry({
      date: '2025-01-01',
      description: '誤計上',
      pairs: [
        { side: 'debit', accountCode: '1130', amount: '100000' },
        { side: 'credit', accountCode: '3110', amount: '100000' },
      ],
    });
    await db.journalEntries.update(id, { status: 'reversed' });
    const p = await computeCarryover(2026);
    expect(p.assets).toEqual([]);
    expect(p.capitalAmount).toBe('0');
  });
});

describe('applyCarryover', () => {
  test('空のプレビューでは仕訳を作らない', async () => {
    await seedAccounts(2025);
    await seedAccounts(2026);
    const r = await applyCarryover(2026);
    expect(r).toEqual({ reason: 'empty' });
    const count = await db.journalEntries.count();
    expect(count).toBe(0);
  });

  test('期首振替仕訳を書き込む（借方=貸方）', async () => {
    await seedAccounts(2025);
    await seedAccounts(2026);
    await seedEntry({
      date: '2025-01-01',
      description: '開業',
      pairs: [
        { side: 'debit', accountCode: '1130', amount: '100000' },
        { side: 'credit', accountCode: '3110', amount: '100000' },
      ],
    });
    const r = await applyCarryover(2026);
    if (!('entryId' in r)) {
      throw new Error('expected entryId, got ' + JSON.stringify(r));
    }
    const entry = await db.journalEntries.get(r.entryId);
    expect(entry?.source).toBe('carryover');
    expect(entry?.date).toBe('2026-01-01');
    expect(entry?.year).toBe(2026);

    const lines = await db.journalLines.where('entryId').equals(r.entryId).toArray();
    const debit = lines
      .filter((l) => l.side === 'debit')
      .reduce((s, l) => s.plus(l.amount), D(0));
    const credit = lines
      .filter((l) => l.side === 'credit')
      .reduce((s, l) => s.plus(l.amount), D(0));
    expect(debit.toString()).toBe(credit.toString());
  });

  test('二重実行を防ぐ', async () => {
    await seedAccounts(2025);
    await seedAccounts(2026);
    await seedEntry({
      date: '2025-01-01',
      description: '開業',
      pairs: [
        { side: 'debit', accountCode: '1130', amount: '100000' },
        { side: 'credit', accountCode: '3110', amount: '100000' },
      ],
    });
    await applyCarryover(2026);
    const r = await applyCarryover(2026);
    expect(r).toEqual({ reason: 'already-exists' });
  });
});

describe('removeCarryover', () => {
  test('carryover 仕訳とその明細を削除', async () => {
    await seedAccounts(2025);
    await seedAccounts(2026);
    await seedEntry({
      date: '2025-01-01',
      description: '開業',
      pairs: [
        { side: 'debit', accountCode: '1130', amount: '100000' },
        { side: 'credit', accountCode: '3110', amount: '100000' },
      ],
    });
    await applyCarryover(2026);
    const r = await removeCarryover(2026);
    expect(r.removed).toBe(true);
    const left = await db.journalEntries.where('year').equals(2026).count();
    expect(left).toBe(0);
    const lines = await db.journalLines.count();
    // 元の 2025 仕訳 2 行 + 削除した carryover 0 行
    expect(lines).toBe(2);
  });
});