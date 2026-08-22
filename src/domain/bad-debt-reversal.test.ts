import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { db } from '../db/db';
import { toIndexable } from '../lib/decimal';
import { newId } from '../lib/id';
import { ACCOUNTS_2026 } from '../tax-schema/2026';
import { applyBadDebtReversal, computeBadDebtReversal } from './bad-debt-reversal';
import { reverseEntry } from './reverse';
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
      })),
    );
  });
  return entryId;
}

// 前年末の繰入仕訳（借方 繰入額／貸方 2170 貸倒引当金）。
async function seedAccrual(year: number, accrualCode: string, amount: string): Promise<string> {
  return seedEntry({
    date: `${year}-12-31`,
    description: '貸倒引当金繰入',
    pairs: [
      { side: 'debit', accountCode: accrualCode, amount },
      { side: 'credit', accountCode: '2170', amount },
    ],
  });
}

beforeEach(async () => {
  await db.delete();
  await db.open();
});

afterEach(async () => {
  await db.delete();
});

describe('computeBadDebtReversal', () => {
  test('前年に仕訳が無ければ空', async () => {
    await seedAccounts(2026);
    const p = await computeBadDebtReversal(2026);
    expect(p.priorYear).toBe(2025);
    expect(p.date).toBe('2026-01-01');
    expect(p.reversals).toEqual([]);
    expect(p.total).toBe('0');
  });

  test('前年に繰入れが無ければ空（他の仕訳はあっても）', async () => {
    await seedAccounts(2025);
    await seedEntry({
      date: '2025-06-01',
      description: '売上',
      pairs: [
        { side: 'debit', accountCode: '1310', amount: '50000' },
        { side: 'credit', accountCode: '4110', amount: '50000' },
      ],
    });
    const p = await computeBadDebtReversal(2026);
    expect(p.reversals).toEqual([]);
  });

  test('一括評価（5810）は 4120 へ戻す', async () => {
    await seedAccounts(2025);
    await seedAccrual(2025, '5810', '30000');
    const p = await computeBadDebtReversal(2026);
    expect(p.reversals).toEqual([{ accountCode: '4120', amount: '30000' }]);
    expect(p.total).toBe('30000');
  });

  test('一括評価と個別評価は同じ 4120 へ合算される', async () => {
    await seedAccounts(2025);
    await seedAccrual(2025, '5810', '30000');
    await seedAccrual(2025, '5811', '12000');
    const p = await computeBadDebtReversal(2026);
    expect(p.reversals).toEqual([{ accountCode: '4120', amount: '42000' }]);
    expect(p.total).toBe('42000');
  });

  test('不動産（5410）は 4230 へ分けて戻す', async () => {
    await seedAccounts(2025);
    await seedAccrual(2025, '5811', '12000');
    await seedAccrual(2025, '5410', '8000');
    const p = await computeBadDebtReversal(2026);
    expect(p.reversals).toEqual([
      { accountCode: '4120', amount: '12000' },
      { accountCode: '4230', amount: '8000' },
    ]);
    expect(p.total).toBe('20000');
  });

  test('訂正済みの繰入れは対象外', async () => {
    await seedAccounts(2025);
    const id = await seedAccrual(2025, '5810', '30000');
    await seedAccrual(2025, '5810', '5000');
    await reverseEntry(id);
    const p = await computeBadDebtReversal(2026);
    expect(p.reversals).toEqual([{ accountCode: '4120', amount: '5000' }]);
  });

  test('前々年の繰入れは対象外（基準は前年のみ）', async () => {
    await seedAccounts(2024);
    await seedAccrual(2024, '5810', '99000');
    const p = await computeBadDebtReversal(2026);
    expect(p.reversals).toEqual([]);
  });
});

describe('applyBadDebtReversal', () => {
  test('戻すものが無ければ empty で仕訳を作らない', async () => {
    await seedAccounts(2026);
    const result = await applyBadDebtReversal(2026);
    expect(result).toEqual({ reason: 'empty' });
    expect(await db.journalEntries.count()).toBe(0);
  });

  test('借方 2170 と貸方の繰戻科目で仕訳を作る', async () => {
    await seedAccounts(2025);
    await seedAccrual(2025, '5811', '12000');
    await seedAccrual(2025, '5410', '8000');

    const result = await applyBadDebtReversal(2026);
    expect('entryId' in result).toBe(true);
    if (!('entryId' in result)) {
      return;
    }

    const entry = await db.journalEntries.get(result.entryId);
    expect(entry?.date).toBe('2026-01-01');
    expect(entry?.year).toBe(2026);
    expect(entry?.source).toBe('badDebtReversal');
    expect(entry?.description).toContain('2025');

    const lines = await db.journalLines.where('entryId').equals(result.entryId).toArray();
    const debits = lines.filter((l) => l.side === 'debit');
    const credits = lines.filter((l) => l.side === 'credit');
    expect(debits).toHaveLength(1);
    expect(debits[0]?.accountCode).toBe('2170');
    expect(debits[0]?.amount).toBe('20000');
    expect(credits.map((l) => [l.accountCode, l.amount]).sort()).toEqual([
      ['4120', '12000'],
      ['4230', '8000'],
    ]);
  });

  test('2回目は already-exists を返し、仕訳を増やさない', async () => {
    await seedAccounts(2025);
    await seedAccrual(2025, '5810', '30000');

    const first = await applyBadDebtReversal(2026);
    expect('entryId' in first).toBe(true);
    const second = await applyBadDebtReversal(2026);
    expect(second).toEqual({ reason: 'already-exists' });

    const generated = await db.journalEntries
      .where('year')
      .equals(2026)
      .filter((e) => e.source === 'badDebtReversal')
      .toArray();
    expect(generated).toHaveLength(1);
  });

  test('訂正した繰戻仕訳は既存判定に数えず、作り直せる', async () => {
    await seedAccounts(2025);
    await seedAccrual(2025, '5810', '30000');

    const first = await applyBadDebtReversal(2026);
    if (!('entryId' in first)) {
      throw new Error('生成されませんでした');
    }
    await reverseEntry(first.entryId);

    const again = await applyBadDebtReversal(2026);
    expect('entryId' in again).toBe(true);
  });

  test('年度が違えば別々に作れる', async () => {
    await seedAccounts(2025);
    await seedAccrual(2025, '5810', '30000');
    await seedAccrual(2026, '5810', '40000');

    const y2026 = await applyBadDebtReversal(2026);
    const y2027 = await applyBadDebtReversal(2027);
    expect('entryId' in y2026).toBe(true);
    expect('entryId' in y2027).toBe(true);
  });
});
