import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { db } from '../db/db';
import { D, toIndexable } from '../lib/decimal';
import { newId } from '../lib/id';
import { ACCOUNTS_2026 } from '../tax-schema/2026';
import {
  applyCarryover,
  computeCarryover,
  detectStaleCarryover,
  removeCarryover,
} from './carryover';
import { reverseEntry } from './reverse';
import { buildBS } from './reports';
import { todayISO } from '../lib/date';
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
    expect(p.assets).toEqual([{ accountCode: '1130', accountName: '普通預金', amount: '100000' }]);
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
    expect(p.assets).toEqual([{ accountCode: '1130', accountName: '普通預金', amount: '140000' }]);
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

  test('reverseEntry による訂正は繰越に影響しない（成対排除）', async () => {
    await seedAccounts(2025);
    await seedEntry({
      date: '2025-01-01',
      description: '開業',
      pairs: [
        { side: 'debit', accountCode: '1130', amount: '100000' },
        { side: 'credit', accountCode: '3110', amount: '100000' },
      ],
    });
    // 誤った経費 5,000 を計上し、reverseEntry で訂正する
    const wrongId = await seedEntry({
      date: '2025-07-01',
      description: '誤計上',
      pairs: [
        { side: 'debit', accountCode: '5200', amount: '5000' },
        { side: 'credit', accountCode: '1130', amount: '5000' },
      ],
    });
    await reverseEntry(wrongId);

    const p = await computeCarryover(2026);
    // 訂正ペアは正味ゼロ：開業仕訳だけが繰越される
    expect(p.assets).toEqual([{ accountCode: '1130', accountName: '普通預金', amount: '100000' }]);
    expect(p.priorNetIncome).toBe('0');
    expect(p.capitalAmount).toBe('100000');
  });

  test('訂正仕訳（鏡像側）も翌年の繰越に幻の残高を作らない', async () => {
    // 鏡像は「今日」の年度に記帳されるため、その翌年の繰越で混入しないことを確認する
    const mirrorYear = Number(todayISO().slice(0, 4));
    await seedAccounts(2025);
    await seedAccounts(mirrorYear);
    const wrongId = await seedEntry({
      date: '2025-07-01',
      description: '誤計上',
      pairs: [
        { side: 'debit', accountCode: '5200', amount: '5000' },
        { side: 'credit', accountCode: '1130', amount: '5000' },
      ],
    });
    await reverseEntry(wrongId);

    const p = await computeCarryover(mirrorYear + 1);
    expect(p.assets).toEqual([]);
    expect(p.liabilities).toEqual([]);
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
    const debit = lines.filter((l) => l.side === 'debit').reduce((s, l) => s.plus(l.amount), D(0));
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
  async function seedPriorYear(): Promise<void> {
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
  }

  test('確定仕訳は削除せず、打消し仕訳で相殺する', async () => {
    await seedPriorYear();
    const applied = await applyCarryover(2026);
    const originalId = 'entryId' in applied ? applied.entryId : '';
    expect(originalId).not.toBe('');

    const r = await removeCarryover(2026);
    expect(r.removed).toBe(true);

    // 原仕訳は残り、reversed になる
    const orig = await db.journalEntries.get(originalId);
    expect(orig?.status).toBe('reversed');
    expect(orig?.reversedByEntryId).toBeDefined();

    // 打消し仕訳は同じ期首日・同じ年度に、原仕訳を指して作られる
    const reversal = await db.journalEntries.get(orig!.reversedByEntryId!);
    expect(reversal?.originalEntryId).toBe(originalId);
    expect(reversal?.date).toBe(orig?.date);
    expect(reversal?.year).toBe(2026);

    // 明細は貸借が反転している
    const origLines = await db.journalLines.where('entryId').equals(originalId).toArray();
    const revLines = await db.journalLines.where('entryId').equals(reversal!.id).toArray();
    expect(revLines).toHaveLength(origLines.length);
    for (const ol of origLines) {
      const match = revLines.find(
        (rl) => rl.accountCode === ol.accountCode && rl.amount === ol.amount,
      );
      expect(match?.side).toBe(ol.side === 'debit' ? 'credit' : 'debit');
    }
  });

  test('打消し後は繰越をやり直せる（already-exists にならない）', async () => {
    await seedPriorYear();
    await applyCarryover(2026);
    await removeCarryover(2026);
    const redo = await applyCarryover(2026);
    expect('entryId' in redo).toBe(true);
  });

  test('対象が無ければ removed=false', async () => {
    await seedPriorYear();
    const r = await removeCarryover(2026);
    expect(r.removed).toBe(false);
  });

  test('やり直しても B/S は繰越 1 回分と同じ（成対排除が効く）', async () => {
    await seedPriorYear();
    await applyCarryover(2026);
    const once = await buildBS(2026);
    await removeCarryover(2026);
    await applyCarryover(2026);
    const twice = await buildBS(2026);
    expect(twice.totalAssets).toBe(once.totalAssets);
    expect(twice.totalLiabilitiesAndEquity).toBe(once.totalLiabilitiesAndEquity);
  });
});

describe('detectStaleCarryover', () => {
  test('繰越仕訳が存在しなければ null', async () => {
    await seedAccounts(2025);
    await seedAccounts(2026);
    expect(await detectStaleCarryover(2026)).toBeNull();
  });

  test('前年度残高と一致していれば null', async () => {
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
    expect(await detectStaleCarryover(2026)).toBeNull();
  });

  test('繰越後に前年度が訂正されるとズレを検出する', async () => {
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
    // 繰越確定後に前年度の漏れていた経費を追加（前年度残高が変わる）
    await seedEntry({
      date: '2025-11-01',
      description: '漏れていた経費',
      pairs: [
        { side: 'debit', accountCode: '5200', amount: '20000' },
        { side: 'credit', accountCode: '1130', amount: '20000' },
      ],
    });
    const r = await detectStaleCarryover(2026);
    expect(r).not.toBeNull();
    const byCode = new Map(r!.differences.map((d) => [d.accountCode, d]));
    // 普通預金：繰越済みは100000のまま、現在の再計算は80000
    expect(byCode.get('1130')).toEqual({
      accountCode: '1130',
      carried: '100000',
      current: '80000',
    });
    // 元入金：繰越済みは100000のまま、現在の再計算は80000（純利益減少分を吸収）
    expect(byCode.get('3110')).toEqual({
      accountCode: '3110',
      carried: '100000',
      current: '80000',
    });
  });

  test('#332 の反対仕訳方式：反転済み原仕訳と反転仕訳を無視し、現に有効な仕訳だけ比較する', async () => {
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

    // やり直し前の古い（誤った）繰越仕訳：既に反転済み（status='reversed'）
    const staleId = newId();
    const reversalId = newId();
    const liveId = newId();
    const now = Date.now();
    await db.transaction('rw', db.journalEntries, db.journalLines, async () => {
      await db.journalEntries.add({
        id: staleId,
        date: '2026-01-01',
        year: 2026,
        description: '前期繰越（誤り・反転済み）',
        status: 'reversed',
        source: 'carryover',
        reversedByEntryId: reversalId,
        createdAt: now,
        confirmedAt: now,
      });
      await db.journalLines.bulkAdd([
        {
          id: newId(),
          entryId: staleId,
          side: 'debit',
          accountCode: '1130',
          amount: '999999',
          amountIndexed: toIndexable('999999'),
          taxRate: 0,
          taxIncluded: false,
          invoiceCompliant: false,
        },
        {
          id: newId(),
          entryId: staleId,
          side: 'credit',
          accountCode: '3110',
          amount: '999999',
          amountIndexed: toIndexable('999999'),
          taxRate: 0,
          taxIncluded: false,
          invoiceCompliant: false,
        },
      ]);
      // 反転仕訳（原仕訳の反対側）
      await db.journalEntries.add({
        id: reversalId,
        date: '2026-01-01',
        year: 2026,
        description: '[訂正] 前期繰越（誤り・反転済み）',
        status: 'confirmed',
        originalEntryId: staleId,
        source: 'carryover',
        createdAt: now,
        confirmedAt: now,
      });
      await db.journalLines.bulkAdd([
        {
          id: newId(),
          entryId: reversalId,
          side: 'credit',
          accountCode: '1130',
          amount: '999999',
          amountIndexed: toIndexable('999999'),
          taxRate: 0,
          taxIncluded: false,
          invoiceCompliant: false,
        },
        {
          id: newId(),
          entryId: reversalId,
          side: 'debit',
          accountCode: '3110',
          amount: '999999',
          amountIndexed: toIndexable('999999'),
          taxRate: 0,
          taxIncluded: false,
          invoiceCompliant: false,
        },
      ]);
      // 現に有効な繰越仕訳（正しい金額）
      await db.journalEntries.add({
        id: liveId,
        date: '2026-01-01',
        year: 2026,
        description: '前期繰越（2025年から）',
        status: 'confirmed',
        source: 'carryover',
        createdAt: now,
        confirmedAt: now,
      });
      await db.journalLines.bulkAdd([
        {
          id: newId(),
          entryId: liveId,
          side: 'debit',
          accountCode: '1130',
          amount: '100000',
          amountIndexed: toIndexable('100000'),
          taxRate: 0,
          taxIncluded: false,
          invoiceCompliant: false,
        },
        {
          id: newId(),
          entryId: liveId,
          side: 'credit',
          accountCode: '3110',
          amount: '100000',
          amountIndexed: toIndexable('100000'),
          taxRate: 0,
          taxIncluded: false,
          invoiceCompliant: false,
        },
      ]);
    });

    // 現に有効な繰越仕訳（100000）は前年度残高（100000）と一致しているため null。
    // 反転済みの誤った仕訳（999999）が混入していれば誤検出になるはず。
    expect(await detectStaleCarryover(2026)).toBeNull();
  });
});
