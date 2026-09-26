// Reports.svelte の「.xtx を書き出す」経路が、設定の cashBasisElection と
// db.personalDeductions の priorPriorBusinessRevenue を実際に XtxContext へ渡しているかを見る。
// 修正前は cashBasis を一切 xtxCtx に載せていなかったため、この場合の電子区分は
// 65万円になる（cashBasis が効けば10万円）。fake-indexeddb・実 Dexie API でデータを積み、
// Reports を実際にマウントしてボタンを押させ、buildXtx2026 に渡された実際の ctx を捕まえる。

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { mount, unmount } from 'svelte';
import { db } from '../db/db';
import { setSetting } from '../lib/settings';
import { newId } from '../lib/id';
import { toIndexable } from '../lib/decimal';
import type { Account, JournalLine } from '../db/types';
import type { XtxContext } from '../tax-schema/2026/xtx';
import { mapKoa020LeafValues } from '../tax-schema/2026/xtx-mapping-koa020';
import { mapKoa210Values } from '../tax-schema/2026/xtx-mapping-koa210';
import { mapKoa220Values } from '../tax-schema/2026/xtx-mapping-koa220';

const captured: { ctx: XtxContext | undefined } = { ctx: undefined };

vi.mock('../lib/save-file', () => ({
  saveTextFile: vi.fn(async () => 'saved' as const),
}));

vi.mock('../tax-schema/2026/xtx', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../tax-schema/2026/xtx')>();
  return {
    ...actual,
    buildXtx2026: (ctx: XtxContext) => {
      captured.ctx = ctx;
      return actual.buildXtx2026(ctx);
    },
  };
});

const { default: Reports } = await import('./Reports.svelte');

async function waitFor(predicate: () => boolean, timeoutMs = 4000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('waitFor タイムアウト');
    }
    await new Promise((r) => setTimeout(r, 10));
  }
}

const TEST_ACCOUNTS: Account[] = [
  { code: '1130', year: 2026, name: '普通預金', category: 'asset', displayOrder: 130 },
  { code: '4110', year: 2026, name: '売上高', category: 'revenue', displayOrder: 110 },
];

async function addEntry(): Promise<void> {
  const entryId = newId();
  const now = Date.now();
  await db.transaction('rw', [db.journalEntries, db.journalLines], async () => {
    await db.journalEntries.add({
      id: entryId,
      date: '2026-05-01',
      year: 2026,
      description: 'テスト売上',
      status: 'confirmed',
      source: 'manual',
      createdAt: now,
      confirmedAt: now,
    });
    const lines: JournalLine[] = [
      {
        id: newId(),
        entryId,
        side: 'debit',
        accountCode: '1130',
        amount: '2000000',
        amountIndexed: toIndexable('2000000'),
        taxRate: 0,
        taxIncluded: true,
        invoiceCompliant: false,
      },
      {
        id: newId(),
        entryId,
        side: 'credit',
        accountCode: '4110',
        amount: '2000000',
        amountIndexed: toIndexable('2000000'),
        taxRate: 0,
        taxIncluded: true,
        invoiceCompliant: false,
      },
    ];
    await db.journalLines.bulkAdd(lines);
  });
}

let container: HTMLElement | undefined;
let instance: Record<string, unknown> | undefined;

beforeEach(async () => {
  await db.delete();
  await db.open();
  captured.ctx = undefined;
});

afterEach(async () => {
  if (instance !== undefined) {
    unmount(instance);
    instance = undefined;
  }
  if (container !== undefined) {
    container.remove();
    container = undefined;
  }
  await db.delete();
  vi.clearAllMocks();
});

describe('cashBasisElection・priorPriorBusinessRevenue が Reports の .xtx ctx に渡る', () => {
  test('electronic + cashBasisElection=true なら控除は10万円（65万円ではない）', async () => {
    await db.accounts.bulkAdd(TEST_ACCOUNTS);
    await addEntry();
    await setSetting('userRiyoshaId', '1234567890123456');
    await setSetting('userFilerName', '青井 太郎');
    await setSetting('userFilerZip', '1800001');
    await setSetting('userFilerAddress', '東京都武蔵野市〇〇1-2-3');
    await setSetting('userZeimushoCode', '01101');
    await setSetting('userZeimushoName', '麹町');
    await setSetting('filingType', 'blue');
    await setSetting('aoiroDeductionKind', 'electronic');
    await setSetting('cashBasisElection', true);
    await db.personalDeductions.put({
      year: 2026,
      socialInsurancePaid: '0',
      smallBusinessMutualAidPaid: '0',
      lifeInsurance: {},
      earthquakeInsurancePaid: '0',
      oldLongTermInsurancePaid: '0',
      medicalExpensePaid: '0',
      medicalInsuranceReimbursement: '0',
      donationAmount: '0',
      casualtyLossDeduction: '0',
      isDisabled: false,
      isSpecialDisabled: false,
      isSingleParent: false,
      isWidow: false,
      isWorkingStudent: false,
      dependents: [],
      priorPriorBusinessRevenue: '12000000',
      updatedAt: Date.now(),
    });

    container = document.createElement('div');
    document.body.appendChild(container);
    instance = mount(Reports, { target: container, props: {} });
    const el = container;

    await waitFor(() =>
      Array.from(el.querySelectorAll('button')).some((b) =>
        (b.textContent ?? '').includes('.xtx を書き出す'),
      ),
    );
    const button = Array.from(el.querySelectorAll('button')).find((b) =>
      (b.textContent ?? '').includes('.xtx を書き出す'),
    );
    if (button === undefined) {
      throw new Error('.xtx を書き出すボタンが見つからない');
    }
    button.click();
    await waitFor(() => captured.ctx !== undefined);

    const ctx = captured.ctx!;
    // 修正前はここが undefined のままで、電子区分は65万円になっていた。
    expect(ctx.cashBasis).toBe(true);
    expect(ctx.personalDeductions?.priorPriorBusinessRevenue?.toString()).toBe('12000000');

    const koa020 = mapKoa020LeafValues(ctx);
    expect(koa020.ABB00800).toBe('100000');
    const koa210Deduction = Number(mapKoa210Values(ctx).AMF00510 ?? '0');
    const koa220Deduction = Number(mapKoa220Values(ctx).ANF00260 ?? '0');
    expect(koa210Deduction + koa220Deduction).toBe(100000);
  });
});
