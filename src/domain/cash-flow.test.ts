import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { db } from '../db/db';
import {
  addArApEntry,
  computeCashFlowForecast,
  OverpaymentError,
  recordPayment,
  remainingBalance,
} from './cash-flow';
import type { ArApEntry } from '../db/types';

beforeEach(async () => {
  await db.delete();
  await db.open();
});

afterEach(async () => {
  await db.delete();
});

describe('remainingBalance', () => {
  test('原始金額から既収/既払を引く', () => {
    const e: ArApEntry = {
      id: '1',
      type: 'receivable',
      description: '',
      dueDate: '2026-08-01',
      originalAmount: '100000',
      paidAmount: '30000',
      createdAt: 0,
    };
    expect(remainingBalance(e).toString()).toBe('70000');
  });
});

describe('addArApEntry / recordPayment', () => {
  test('新規登録は paidAmount=0 で作成される', async () => {
    await addArApEntry({ type: 'receivable', description: 'A社', dueDate: '2026-08-01', originalAmount: '50000' });
    const rows = await db.arApEntries.toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.paidAmount).toBe('0');
  });

  test('入金を記録すると paidAmount が加算される', async () => {
    await addArApEntry({ type: 'receivable', description: 'A社', dueDate: '2026-08-01', originalAmount: '50000' });
    const row = (await db.arApEntries.toArray())[0]!;
    await recordPayment(row.id, '20000');
    const updated = await db.arApEntries.get(row.id);
    expect(updated!.paidAmount).toBe('20000');
  });

  test('残高を超える入金は throw', async () => {
    await addArApEntry({ type: 'payable', description: 'B社', dueDate: '2026-08-01', originalAmount: '10000' });
    const row = (await db.arApEntries.toArray())[0]!;
    await expect(recordPayment(row.id, '20000')).rejects.toThrow(OverpaymentError);
  });
});

describe('computeCashFlowForecast', () => {
  function entry(over: Partial<ArApEntry>): ArApEntry {
    return {
      id: over.id ?? 'x',
      type: over.type ?? 'receivable',
      description: '',
      dueDate: over.dueDate ?? '2026-08-01',
      originalAmount: over.originalAmount ?? '10000',
      paidAmount: over.paidAmount ?? '0',
      createdAt: 0,
    };
  }

  test('到期月ごとに売掛/買掛の残高をバケットへ集計する', () => {
    const entries = [
      entry({ id: 'r1', type: 'receivable', dueDate: '2026-07-10', originalAmount: '100000' }),
      entry({ id: 'p1', type: 'payable', dueDate: '2026-07-20', originalAmount: '30000' }),
      entry({ id: 'r2', type: 'receivable', dueDate: '2026-08-05', originalAmount: '50000' }),
    ];
    const r = computeCashFlowForecast(entries, '2026-07-01', 3);
    expect(r.months.map((m) => m.yearMonth)).toEqual(['2026-07', '2026-08', '2026-09']);
    expect(r.months[0]!.expectedInflow).toBe('100000');
    expect(r.months[0]!.expectedOutflow).toBe('30000');
    expect(r.months[0]!.netChange).toBe('70000');
    expect(r.months[1]!.expectedInflow).toBe('50000');
    expect(r.months[2]!.expectedInflow).toBe('0');
  });

  test('期限超過分は最初のバケットに繰り入れる', () => {
    const entries = [entry({ dueDate: '2026-05-01', originalAmount: '20000' })];
    const r = computeCashFlowForecast(entries, '2026-07-01', 2);
    expect(r.months[0]!.expectedInflow).toBe('20000');
  });

  test('完済済み（残高0）は集計から除外', () => {
    const entries = [entry({ dueDate: '2026-07-15', originalAmount: '10000', paidAmount: '10000' })];
    const r = computeCashFlowForecast(entries, '2026-07-01', 1);
    expect(r.months[0]!.expectedInflow).toBe('0');
  });

  test('予測期間より先の到期分は対象外', () => {
    const entries = [entry({ dueDate: '2027-01-01', originalAmount: '10000' })];
    const r = computeCashFlowForecast(entries, '2026-07-01', 1);
    expect(r.months[0]!.expectedInflow).toBe('0');
  });

  test('年をまたぐ月バケットも正しく生成される', () => {
    const entries = [entry({ dueDate: '2027-01-10', originalAmount: '5000' })];
    const r = computeCashFlowForecast(entries, '2026-11-01', 4);
    expect(r.months.map((m) => m.yearMonth)).toEqual(['2026-11', '2026-12', '2027-01', '2027-02']);
    expect(r.months[2]!.expectedInflow).toBe('5000');
  });
});