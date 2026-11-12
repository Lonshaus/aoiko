import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { db } from '../db/db';
import { buildLedgerRows, ledger } from './ledger.svelte';
import type { Account, JournalEntry, JournalLine } from '../db/types';

function acc(code: string, year: number, name: string): Account {
  return { code, year, name, category: 'expense', displayOrder: Number(code) };
}

function entry(id: string, year: number, date: string): JournalEntry {
  return {
    id,
    date,
    year,
    description: 'テスト仕訳',
    status: 'confirmed',
    source: 'manual',
    createdAt: Date.now(),
    confirmedAt: Date.now(),
  };
}
// liveQuery は非同期に反映されるため、条件成立までポーリングで待つ。
// 上限は CI の負荷を見込んで広めに取る（2 秒では import に数十秒かかる runner で
// 偽陽性が出た）。条件が成立しないケースは待っても成立しないので、広げても
// 壊れたときの検出力は落ちない。
async function waitFor(predicate: () => boolean, label: string, timeoutMs = 10_000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(`waitFor タイムアウト（${label}）`);
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
  await waitFor(
    () => ledger.currentYear === 1900 && ledger.accounts.every((a) => a.year === 1900),
    '初期化',
  );
});

afterEach(async () => {
  vi.restoreAllMocks();
  ledger.switchYear(2026);
  await db.delete();
});

describe('ledger.switchYear', () => {
  test('年度を切り替えると currentYear と年度スコープの科目が張り替わる', async () => {
    ledger.switchYear(2026);
    expect(ledger.currentYear).toBe(2026);
    await waitFor(() => ledger.accounts.map((a) => a.code).join() === '5130', '2026 の科目');

    ledger.switchYear(2027);
    expect(ledger.currentYear).toBe(2027);
    await waitFor(() => ledger.accounts.map((a) => a.code).join() === '5140', '2027 の科目');
  });

  test('同一年度への切替は冪等（currentYear もデータも変わらない）', async () => {
    ledger.switchYear(2027);
    await waitFor(() => ledger.accounts.map((a) => a.code).join() === '5140', '2027 の科目');
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
      await waitFor(() => ledger.lastError !== null, 'lastError が設定される');
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
    await waitFor(() => ledger.lastError !== null, 'lastError が設定される');
    for (const spy of spies) {
      spy.mockRestore();
    }
    ledger.switchYear(2027);
    await waitFor(() => ledger.lastError === null, 'lastError がクリアされる');
    expect(ledger.lastError).toBeNull();
  });
});

describe('currentYear 設定の liveQuery 追従（復元対応）', () => {
  test('settings テーブルの currentYear が書き換わると自動で切り替わる', async () => {
    ledger.switchYear(2026);
    await waitFor(() => ledger.currentYear === 2026, '2026 への切替');
    // restore.ts が行うのと同様に settings テーブルを直接書き換える（手動リロード無しで反映されるべき）
    await db.settings.put({ key: 'currentYear', value: 2027, updatedAt: Date.now() });
    await waitFor(() => ledger.currentYear === 2027, 'currentYear の自動追従');
    await waitFor(() => ledger.accounts.map((a) => a.code).join() === '5140', '2027 の科目');
  });
});

describe('computeRecentRows の年度フィルタ', () => {
  test('現在年度以外の仕訳は recentLedgerRows に含まれない', async () => {
    await db.journalEntries.bulkAdd([
      entry('e2026', 2026, '2026-04-01'),
      entry('e2027', 2027, '2027-04-01'),
    ]);
    ledger.switchYear(2026);
    await waitFor(
      () => ledger.recentLedgerRows.some((r) => r.entry.id === 'e2026'),
      '2026 の仕訳が反映される',
    );
    expect(ledger.recentLedgerRows.some((r) => r.entry.id === 'e2027')).toBe(false);
  });
});

describe('departments', () => {
  test('空白だけの部門は候補に含めない', async () => {
    const withDepartment = (id: string, department: string): JournalEntry => ({
      ...entry(id, 2026, '2026-04-01'),
      department,
    });
    await db.journalEntries.bulkAdd([
      withDepartment('d1', '  '),
      withDepartment('d2', '\u3000'),
      withDepartment('d3', ''),
      withDepartment('d4', '営業'),
    ]);
    await waitFor(() => ledger.departments.includes('営業'), '部門の反映');
    expect(ledger.departments).toEqual(['営業']);
  });
});

function line(
  id: string,
  entryId: string,
  side: 'debit' | 'credit',
  code: string,
  amount: unknown,
) {
  return {
    id,
    entryId,
    side,
    accountCode: code,
    amount,
    amountIndexed: '00000000000000.00',
    taxRate: 0,
    taxIncluded: true,
    invoiceCompliant: false,
  } as JournalLine;
}

describe('読めない金額の明細', () => {
  test('buildLedgerRows は借方に読めない金額があるとき totalAmount が null になり、他の仕訳の合計は正しい', async () => {
    const e1 = entry('e-ok', 2026, '2026-04-01');
    const e2 = entry('e-bad', 2026, '2026-04-02');
    const e3 = entry('e-half', 2026, '2026-04-03');
    await db.journalEntries.bulkAdd([e1, e2, e3]);
    await db.journalLines.bulkAdd([
      line('l1', 'e-ok', 'debit', '5130', '1500'),
      line('l2', 'e-ok', 'credit', '5140', '1500'),
      line('l3', 'e-bad', 'debit', '5130', 'abc'),
      line('l4', 'e-bad', 'credit', '5140', '1000'),
      line('l5', 'e-half', 'debit', '5130', '0.5'),
      line('l6', 'e-half', 'debit', '5130', '1e3'),
      line('l7', 'e-half', 'credit', '5140', '1000.5'),
    ]);
    const rows = await buildLedgerRows([e1, e2, e3], 2026);
    expect(rows.map((r) => r.totalAmount)).toEqual(['1500', null, '1000.5']);
  });

  test('借方が読めなくても lastError は設定されず、月次合計は読めない件数を返して他の明細を合計する', async () => {
    const now = new Date();
    const year = now.getFullYear();
    const date = `${year}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    await db.accounts.bulkAdd([
      { code: '4110', year, name: '売上高', category: 'revenue', displayOrder: 1 },
      { code: '5150', year, name: '雑費', category: 'expense', displayOrder: 2 },
      { code: '1110', year, name: '現金', category: 'asset', displayOrder: 3 },
    ]);
    await db.journalEntries.bulkAdd([
      entry('m-ok', year, date),
      entry('m-bad', year, date),
      entry('m-bad2', year, date),
    ]);
    await db.journalLines.bulkAdd([
      line('m1', 'm-ok', 'debit', '1110', '3000'),
      line('m2', 'm-ok', 'credit', '4110', '3000'),
      line('m3', 'm-bad', 'debit', '5150', 'abc'),
      line('m4', 'm-bad', 'credit', '1110', 'abc'),
      line('m5', 'm-bad2', 'debit', '1110', '700'),
      line('m6', 'm-bad2', 'credit', '4110', { nested: true }),
    ]);
    ledger.switchYear(year);
    await waitFor(() => ledger.monthlyOverview.entryCount === 3, '月次合計の反映');
    expect(ledger.lastError).toBeNull();
    expect(ledger.monthlyOverview.unreadableCount).toBe(2);
    expect(ledger.monthlyOverview.revenue).toBe('3000');
    expect(ledger.monthlyOverview.expense).toBe('0');
    await waitFor(() => ledger.recentLedgerRows.length === 3, '直近の仕訳の反映');
    expect(ledger.lastError).toBeNull();
    const totals = Object.fromEntries(
      ledger.recentLedgerRows.map((r) => [r.entry.id, r.totalAmount]),
    );
    expect(totals).toEqual({ 'm-ok': '3000', 'm-bad': null, 'm-bad2': '700' });
  });
});
