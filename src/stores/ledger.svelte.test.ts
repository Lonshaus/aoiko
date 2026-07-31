import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { db } from '../db/db';
import { ledger } from './ledger.svelte';
import type { Account } from '../db/types';

function acc(code: string, year: number, name: string): Account {
  return { code, year, name, category: 'expense', displayOrder: Number(code) };
}
// liveQuery は非同期に反映されるため、条件成立までポーリングで待つ。
async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('waitFor タイムアウト');
    }
    await new Promise((r) => setTimeout(r, 10));
  }
}

beforeEach(async () => {
  await db.delete();
  await db.open();
  await db.accounts.bulkAdd([acc('5130', 2026, '水道光熱費'), acc('5140', 2027, '通信費')]);
  // 各テストの1回目の switchYear が確実に再購読するよう、対象と異なる年度を基準に置く
  ledger.switchYear(1900);
  await waitFor(() => ledger.accounts.length === 0);
});

afterEach(async () => {
  ledger.switchYear(2026);
  await db.delete();
});

describe('ledger.switchYear', () => {
  test('年度を切り替えると currentYear と年度スコープの科目が張り替わる', async () => {
    ledger.switchYear(2026);
    expect(ledger.currentYear).toBe(2026);
    await waitFor(() => ledger.accounts.map((a) => a.code).join() === '5130');

    ledger.switchYear(2027);
    expect(ledger.currentYear).toBe(2027);
    await waitFor(() => ledger.accounts.map((a) => a.code).join() === '5140');
  });

  test('同一年度への切替は冪等（currentYear もデータも変わらない）', async () => {
    ledger.switchYear(2027);
    await waitFor(() => ledger.accounts.map((a) => a.code).join() === '5140');
    ledger.switchYear(2027);
    expect(ledger.currentYear).toBe(2027);
    expect(ledger.accounts.map((a) => a.code)).toEqual(['5140']);
  });
});

describe('liveQuery 購読の失敗', () => {
  // switchYear は年度スコープの購読を3本（allAccounts/recentRows/monthlyOverview）
  // 同時に張り直す。1本だけ失敗させても残り2本が成功して lastError を null に上書きして
  // しまうため、テストでは3本すべての起点となるクエリを reject させて確実に失敗させる。
  // 年度非依存の購読（constructor 時点で張られる）は beforeEach の db.delete()/open() より
  // 前に生成されており、テスト用に再オープンした db には追従しないため対象にできない。
  function fakeRejectingChain(message: string): () => unknown {
    const reject = () => Promise.reject(new Error(message));
    const handler: ProxyHandler<object> = {
      get(_target, prop) {
        return prop === 'toArray' || prop === 'sortBy' ? reject : () => proxy;
      },
    };
    const proxy = new Proxy({}, handler);
    return () => proxy;
  }

  function makeYearScopedSubsThrow(message: string) {
    return [
      vi
        .spyOn(db.accounts, 'where')
        .mockImplementation(fakeRejectingChain(message) as typeof db.accounts.where),
      vi
        .spyOn(db.journalEntries, 'orderBy')
        .mockImplementation(fakeRejectingChain(message) as typeof db.journalEntries.orderBy),
      vi
        .spyOn(db.journalEntries, 'where')
        .mockImplementation(fakeRejectingChain(message) as typeof db.journalEntries.where),
    ];
  }

  test('購読が失敗すると ledger.lastError に記録される', async () => {
    expect(ledger.lastError).toBeNull();
    const spies = makeYearScopedSubsThrow('boom-accounts');
    try {
      ledger.switchYear(2026);
      await waitFor(() => ledger.lastError !== null);
      expect(ledger.lastError).toContain('boom-accounts');
    } finally {
      for (const spy of spies) {
        spy.mockRestore();
      }
    }
  });

  test('失敗後に成功すると lastError はクリアされる', async () => {
    const spies = makeYearScopedSubsThrow('boom-accounts-2');
    ledger.switchYear(2026);
    await waitFor(() => ledger.lastError !== null);
    for (const spy of spies) {
      spy.mockRestore();
    }
    ledger.switchYear(2027);
    await waitFor(() => ledger.lastError === null);
    expect(ledger.lastError).toBeNull();
  });
});
