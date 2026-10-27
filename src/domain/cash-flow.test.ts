import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { db } from '../db/db';
import {
  addArApEntry,
  computeCashFlowForecast,
  InvalidPaymentAmountError,
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
  test('当初金額から入金済み・支払済みの額を引く', () => {
    const e: ArApEntry = {
      id: '1',
      type: 'receivable',
      description: '',
      dueDate: '2026-08-01',
      originalAmount: '100000',
      paidAmount: '30000',
      createdAt: 0,
    };
    expect(remainingBalance(e)?.toString()).toBe('70000');
  });

  test('復元された 1e3・1e-7 は読み、読めない値は undefined', () => {
    const base: ArApEntry = {
      id: '1',
      type: 'receivable',
      description: '',
      dueDate: '2026-08-01',
      originalAmount: '1e3',
      paidAmount: '0',
      createdAt: 0,
    };
    expect(remainingBalance(base)?.toString()).toBe('1000');
    expect(remainingBalance({ ...base, originalAmount: '1e-7' })?.toString()).toBe('1e-7');
    expect(remainingBalance({ ...base, originalAmount: 'abc' })).toBeUndefined();
    expect(remainingBalance({ ...base, paidAmount: 'abc' })).toBeUndefined();
  });
});

describe('addArApEntry / recordPayment', () => {
  test('新規登録は paidAmount=0 で作成される', async () => {
    await addArApEntry({
      type: 'receivable',
      description: 'A社',
      dueDate: '2026-08-01',
      originalAmount: '50000',
    });
    const rows = await db.arApEntries.toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.paidAmount).toBe('0');
  });

  test('入金を記録すると paidAmount が加算される', async () => {
    await addArApEntry({
      type: 'receivable',
      description: 'A社',
      dueDate: '2026-08-01',
      originalAmount: '50000',
    });
    const row = (await db.arApEntries.toArray())[0]!;
    await recordPayment(row.id, '20000');
    const updated = await db.arApEntries.get(row.id);
    expect(updated!.paidAmount).toBe('20000');
  });

  test('残高を超える入金は例外を投げる', async () => {
    await addArApEntry({
      type: 'payable',
      description: 'B社',
      dueDate: '2026-08-01',
      originalAmount: '10000',
    });
    const row = (await db.arApEntries.toArray())[0]!;
    await expect(recordPayment(row.id, '20000')).rejects.toThrow(OverpaymentError);
  });

  test('負の額・数値として読めない額は例外を投げ、paidAmount を変えない', async () => {
    await addArApEntry({
      type: 'receivable',
      description: 'C社',
      dueDate: '2026-08-01',
      originalAmount: '10000',
    });
    const row = (await db.arApEntries.toArray())[0]!;
    await recordPayment(row.id, '3000');
    for (const amount of ['-5000', '－5000', 'abc', '1e3', '5,000円']) {
      await expect(recordPayment(row.id, amount)).rejects.toThrow(InvalidPaymentAmountError);
    }
    expect((await db.arApEntries.get(row.id))!.paidAmount).toBe('3000');
  });

  test('保存済みの paidAmount を読めないときは名前付きの例外を投げ、書き込まない', async () => {
    await db.arApEntries.add({
      id: 'bad',
      type: 'receivable',
      description: '壊れた売掛',
      dueDate: '2026-08-01',
      originalAmount: '10000',
      paidAmount: 'abc',
      createdAt: 0,
    });
    await expect(recordPayment('bad', '100')).rejects.toThrow('壊れた売掛');
    expect((await db.arApEntries.get('bad'))?.paidAmount).toBe('abc');
  });

  test('全角・カンマ付きの額は値として消し込む', async () => {
    await addArApEntry({
      type: 'payable',
      description: 'D社',
      dueDate: '2026-08-01',
      originalAmount: '10000',
    });
    const row = (await db.arApEntries.toArray())[0]!;
    await recordPayment(row.id, '５，０００');
    expect((await db.arApEntries.get(row.id))!.paidAmount).toBe('5000');
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

  test('期日の月ごとに売掛/買掛の残高をバケットへ集計する', () => {
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
    const entries = [
      entry({ dueDate: '2026-07-15', originalAmount: '10000', paidAmount: '10000' }),
    ];
    const r = computeCashFlowForecast(entries, '2026-07-01', 1);
    expect(r.months[0]!.expectedInflow).toBe('0');
  });

  test('予測期間より先の期日分は対象外', () => {
    const entries = [entry({ dueDate: '2027-01-01', originalAmount: '10000' })];
    const r = computeCashFlowForecast(entries, '2026-07-01', 1);
    expect(r.months[0]!.expectedInflow).toBe('0');
  });

  test('金額を読めない行は予測に含めず件数を返す', () => {
    const entries = [
      entry({ id: 'a', dueDate: '2026-07-10', originalAmount: '1e3' }),
      entry({ id: 'b', dueDate: '2026-07-10', originalAmount: '1e-7' }),
      entry({ id: 'c', dueDate: '2026-07-10', originalAmount: 'abc' }),
    ];
    const r = computeCashFlowForecast(entries, '2026-07-01', 1);
    expect(r.months[0]!.expectedInflow).toBe('1000.0000001');
    expect(r.unreadableCount).toBe(1);
  });

  test('年をまたぐ月バケットも正しく生成される', () => {
    const entries = [entry({ dueDate: '2027-01-10', originalAmount: '5000' })];
    const r = computeCashFlowForecast(entries, '2026-11-01', 4);
    expect(r.months.map((m) => m.yearMonth)).toEqual(['2026-11', '2026-12', '2027-01', '2027-02']);
    expect(r.months[2]!.expectedInflow).toBe('5000');
  });
});

describe('computeCashFlowForecast の読めない行（R22）', () => {
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

  test('期日が数値・種別が不明の行は除いて数え、ほかの行は予測する', () => {
    const r = computeCashFlowForecast(
      [
        entry({ id: 'ok', dueDate: '2026-07-10', originalAmount: '100' }),
        entry({ id: 'num', dueDate: 20261231 as never }),
        entry({ id: 'type', type: 'x' as never }),
        entry({ id: 'bad', dueDate: '2026-13-01' }),
      ],
      '2026-07-01',
      3,
    );
    expect(r.unreadableCount).toBe(3);
    expect(r.months[0]!.expectedInflow).toBe('100');
    expect(r.months.every((m) => m.expectedOutflow === '0')).toBe(true);
  });

  test('期日なし（""）の請求書はこれまでどおり最初の月に入れる', () => {
    const r = computeCashFlowForecast(
      [entry({ dueDate: '', originalAmount: '700' })],
      '2026-07-01',
      2,
    );
    expect(r.unreadableCount).toBe(0);
    expect(r.months[0]!.expectedInflow).toBe('700');
  });
});
