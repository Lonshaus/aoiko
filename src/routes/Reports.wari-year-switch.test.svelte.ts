import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { db } from '../db/db';
import { ACCOUNTS_2026 } from '../tax-schema/2026';
import { setSetting, type StoredWariBaseAdjustments } from '../lib/settings';
import { ledger } from '../stores/ledger.svelte';
import { m } from '../paraglide/messages';
import type { Account } from '../db/types';

vi.mock('../lib/save-file', () => ({
  saveTextFile: vi.fn(async () => 'saved' as const),
}));

type Op = 'get' | 'put' | 'load';
type Rule = {
  op: Op;
  key: string;
  arg: unknown;
  when: 'before' | 'after';
  skip: number;
  times: number;
  hold: Promise<void>;
  error: Error | undefined;
  reach: () => void;
};

const gate = vi.hoisted(() => {
  const rules: Rule[] = [];
  function take(op: Op, key: string, arg: unknown): Rule | undefined {
    for (const rule of rules) {
      if (rule.op !== op || rule.key !== key || rule.times <= 0) {
        continue;
      }
      if (rule.arg !== undefined && rule.arg !== arg) {
        continue;
      }
      if (rule.skip > 0) {
        rule.skip -= 1;
        return undefined;
      }
      rule.times -= 1;
      return rule;
    }
    return undefined;
  }
  async function intercept<T>(op: Op, key: string, arg: unknown, run: () => Promise<T>) {
    const rule = take(op, key, arg);
    if (rule === undefined) {
      return run();
    }
    let result: T | undefined;
    if (rule.when === 'after') {
      result = await run();
    }
    rule.reach();
    await rule.hold;
    if (rule.error !== undefined) {
      throw rule.error;
    }
    return rule.when === 'after' ? (result as T) : run();
  }
  return { rules, intercept };
});

vi.mock('../lib/settings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/settings')>();
  return {
    ...actual,
    getSetting: ((key: string) =>
      gate.intercept('get', key, undefined, () =>
        actual.getSetting(key as never),
      )) as unknown as typeof actual.getSetting,
    setSetting: ((key: string, value: never) =>
      gate.intercept('put', key, undefined, () =>
        actual.setSetting(key as never, value),
      )) as unknown as typeof actual.setSetting,
    loadWariStoredAmounts: (year: number) =>
      gate.intercept('load', 'wari', year, () => actual.loadWariStoredAmounts(year)),
    loadInterimPriorPeriodMonths: (year: number) =>
      gate.intercept('load', 'months', year, () => actual.loadInterimPriorPeriodMonths(year)),
  };
});

vi.mock('../domain/budget', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../domain/budget')>();
  return {
    ...actual,
    setBudget: (budget: Parameters<typeof actual.setBudget>[0]) =>
      gate.intercept('put', 'budget', undefined, () => actual.setBudget(budget)),
  };
});

const { default: Reports } = await import('./Reports.svelte');

type ArmOptions = {
  when?: 'before' | 'after';
  skip?: number;
  times?: number;
  arg?: unknown;
  error?: Error;
  hold?: boolean;
};

function arm(op: Op, key: string, options: ArmOptions = {}) {
  let release = (): void => {};
  let reach = (): void => {};
  const reached = new Promise<void>((r) => {
    reach = () => {
      setTimeout(r, 0);
    };
  });
  const hold =
    options.hold === false
      ? Promise.resolve()
      : new Promise<void>((r) => {
          release = r;
        });
  gate.rules.push({
    op,
    key,
    arg: options.arg,
    when: options.when ?? 'before',
    skip: options.skip ?? 0,
    times: options.times ?? 1,
    hold,
    error: options.error,
    reach,
  });
  return { reached, release: () => release() };
}

type RejectionListener = (reason: unknown) => void;
const nodeProcess = (
  globalThis as unknown as {
    process: {
      listeners(event: string): RejectionListener[];
      removeAllListeners(event: string): void;
      on(event: string, listener: RejectionListener): void;
      off(event: string, listener: RejectionListener): void;
    };
  }
).process;
const rejections: unknown[] = [];
const onRejection: RejectionListener = (reason) => {
  rejections.push(reason);
};
let runnerListeners: RejectionListener[] = [];

const hiddenRow = { date: '', rate: 0.1 as const, netTax: '111' };
const SEED_2026: StoredWariBaseAdjustments = {
  salesReturnTax78: '20',
  salesReturnTax624: '30',
  specifiedSmallAssetTransfers: [hiddenRow, { date: '2026-02-01', rate: 0.1, netTax: '100' }],
};
const SEED_2027: StoredWariBaseAdjustments = {
  salesReturnTax78: '50',
  salesReturnTax624: '60',
  specifiedSmallAssetTransfers: [
    { date: '2027-01-01', rate: 0.1, netTax: '11' },
    { date: '2027-02-01', rate: 0.08, netTax: '22' },
    { date: '2027-03-01', rate: 0.1, netTax: '33' },
    { date: '2027-04-01', rate: 0.08, netTax: '44' },
  ],
};

async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 3000,
): Promise<void> {
  const start = Date.now();
  while (!(await predicate())) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('waitFor タイムアウト');
    }
    await new Promise((r) => setTimeout(r, 10));
  }
}

const settle = (ms = 80) => new Promise((r) => setTimeout(r, ms));

let container: HTMLElement | undefined;
let instance: Record<string, unknown> | undefined;

beforeEach(async () => {
  gate.rules.length = 0;
  rejections.length = 0;
  runnerListeners = nodeProcess.listeners('unhandledRejection');
  nodeProcess.removeAllListeners('unhandledRejection');
  nodeProcess.on('unhandledRejection', onRejection);
  await db.delete();
  await db.open();
  for (const year of [2026, 2027]) {
    const accs: Account[] = ACCOUNTS_2026.map((a) => ({ ...a, year }));
    await db.accounts.bulkPut(accs);
  }
  await setSetting('currentYear', 2026);
  await waitFor(() => ledger.currentYear === 2026);
  await setSetting('wariBaseAdjustments', { 2026: SEED_2026, 2027: SEED_2027 });
  await setSetting('interimPriorPeriodMonths', { 2026: 4, 2027: 6 });
});

afterEach(async () => {
  for (const rule of gate.rules) {
    rule.times = 0;
  }
  if (instance !== undefined) {
    unmount(instance);
    instance = undefined;
  }
  if (container !== undefined) {
    container.remove();
    container = undefined;
  }
  nodeProcess.off('unhandledRejection', onRejection);
  for (const listener of runnerListeners) {
    nodeProcess.on('unhandledRejection', listener);
  }
  await db.delete();
  vi.clearAllMocks();
});

function named(name: string): HTMLInputElement {
  const el = container!.querySelector<HTMLInputElement>(`input[name="${name}"]`);
  if (el === null) {
    throw new Error(`input ${name} not found`);
  }
  return el;
}

function input(el: HTMLInputElement, value: string): void {
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
}

function commit(name: string, value: string): void {
  const el = named(name);
  el.dispatchEvent(new FocusEvent('focus'));
  input(el, value);
  el.dispatchEvent(new Event('change', { bubbles: true }));
  flushSync();
}

function switchYear(year: number): void {
  input(named('reportNen'), String(year));
}

function mountNow(): void {
  container = document.createElement('div');
  document.body.appendChild(container);
  instance = mount(Reports, { target: container, props: {} });
  flushSync();
}

function shows2026(): boolean {
  return (
    container!.querySelector('input[name="wariTransfer-netTax-0"]') !== null &&
    named('wariSalesReturnTax78').value === '20' &&
    named('wariTransfer-netTax-0').value === '100'
  );
}

function shows2027(): boolean {
  return (
    container!.querySelector('input[name="wariTransfer-netTax-3"]') !== null &&
    named('wariSalesReturnTax78').value === '50'
  );
}

async function mountAt2026(): Promise<void> {
  mountNow();
  await waitFor(() => container!.querySelector('input[name="wariSalesReturnTax78"]') !== null);
  await waitFor(shows2026);
  await waitFor(() => named('interimPriorPeriodMonths').value === '4');
}

async function stored(): Promise<Record<number, StoredWariBaseAdjustments | undefined>> {
  const row = await db.settings.get('wariBaseAdjustments');
  return row?.value as Record<number, StoredWariBaseAdjustments | undefined>;
}

async function storedMonths(): Promise<Record<number, number>> {
  const row = await db.settings.get('interimPriorPeriodMonths');
  return row?.value as Record<number, number>;
}

function saveButton(): HTMLButtonElement {
  const el = Array.from(container!.querySelectorAll('button')).find(
    (b) => (b.textContent ?? '').trim() === m.reports_budget_save(),
  );
  if (el === undefined) {
    throw new Error('budget save button not found');
  }
  return el;
}

async function budgetRows(year: number) {
  const rows = await db.budgets.where('year').equals(year).sortBy('month');
  return rows.map(({ month, revenueBudget, expenseBudget }) => ({
    month,
    revenueBudget,
    expenseBudget,
  }));
}

describe('2割／3割特例の保存と年度の切り替え', () => {
  test('隠れた行がある年度の保存中に年度を切り替えても、新しい年度の行は増えず内容も変わらない', async () => {
    await mountAt2026();
    const put = arm('put', 'wariBaseAdjustments');
    commit('wariSalesReturnTax78', '7');
    await put.reached;
    switchYear(2027);
    await settle();
    put.release();
    await waitFor(shows2027);
    await waitFor(async () => (await stored())[2026]?.salesReturnTax78 === '7');
    await settle();

    commit('wariSalesReturnTax78', '9');
    await waitFor(async () => (await stored())[2027]?.salesReturnTax78 === '9');
    await settle();
    expect((await stored())[2027]).toEqual({ ...SEED_2027, salesReturnTax78: '9' });
    expect((await stored())[2026]).toEqual({ ...SEED_2026, salesReturnTax78: '7' });
  });

  test('保存の開始後に年度を切り替えると、値は元の年度に入り、新しい年度の設定は変わらない', async () => {
    await mountAt2026();
    const read = arm('get', 'wariBaseAdjustments');
    commit('wariSalesReturnTax78', '7');
    await read.reached;
    switchYear(2027);
    await settle();
    read.release();
    await waitFor(shows2027);
    await waitFor(async () => (await stored())[2026]?.salesReturnTax78 === '7');
    await settle();

    expect((await stored())[2026]).toEqual({ ...SEED_2026, salesReturnTax78: '7' });
    expect((await stored())[2027]).toEqual(SEED_2027);
    expect(named('wariSalesReturnTax78').value).toBe('50');
  });

  test('保存の待ち行列に続けて入れた2回の保存は、どちらも元の年度に入る', async () => {
    await mountAt2026();
    const read = arm('get', 'wariBaseAdjustments');
    commit('wariSalesReturnTax78', '7');
    await read.reached;
    commit('wariSalesReturnTax624', '8');
    switchYear(2027);
    await settle();
    read.release();
    await waitFor(shows2027);
    await waitFor(async () => (await stored())[2026]?.salesReturnTax624 === '8');
    await settle();

    expect((await stored())[2026]).toEqual({
      ...SEED_2026,
      salesReturnTax78: '7',
      salesReturnTax624: '8',
    });
    expect((await stored())[2027]).toEqual(SEED_2027);
    expect(named('wariSalesReturnTax78').value).toBe('50');
    expect(named('wariSalesReturnTax624').value).toBe('60');
  });

  test('年度を切り替えたあと新しい年度の読込が終わる前に画面の欄を変えても、元の年度に保存される', async () => {
    await mountAt2026();
    const load = arm('load', 'wari', { when: 'after', arg: 2027 });
    switchYear(2027);
    await load.reached;
    commit('wariSalesReturnTax78', '7');
    await waitFor(async () => (await stored())[2026]?.salesReturnTax78 === '7');
    load.release();
    await waitFor(shows2027);
    await settle();

    expect((await stored())[2026]).toEqual({ ...SEED_2026, salesReturnTax78: '7' });
    expect((await stored())[2027]).toEqual(SEED_2027);
    expect(named('wariSalesReturnTax78').value).toBe('50');
  });

  test('保存の途中で別の年度へ移りすぐ戻すと、保存した値が表示され、次の保存でも残る', async () => {
    await mountAt2026();
    const put = arm('put', 'wariBaseAdjustments');
    commit('wariSalesReturnTax78', '7');
    await put.reached;
    switchYear(2027);
    switchYear(2026);
    await settle();
    put.release();
    await waitFor(async () => (await stored())[2026]?.salesReturnTax78 === '7');
    await waitFor(() => named('wariSalesReturnTax78').value === '7');
    await settle();
    expect(named('wariSalesReturnTax78').value).toBe('7');

    commit('wariSalesReturnTax624', '8');
    await waitFor(async () => (await stored())[2026]?.salesReturnTax624 === '8');
    await settle();
    expect((await stored())[2026]).toEqual({
      ...SEED_2026,
      salesReturnTax78: '7',
      salesReturnTax624: '8',
    });
  });

  test('最初の読込が終わる前の保存は何も書かず、保存済みの行は変わらない', async () => {
    const load = arm('load', 'wari', { when: 'after' });
    mountNow();
    await waitFor(() => container!.querySelector('input[name="wariSalesReturnTax78"]') !== null);
    await load.reached;
    commit('wariSalesReturnTax78', '7');
    await settle();
    expect(await stored()).toEqual({ 2026: SEED_2026, 2027: SEED_2027 });

    load.release();
    await waitFor(shows2026);
    await settle();
    expect(await stored()).toEqual({ 2026: SEED_2026, 2027: SEED_2027 });
  });

  test('読込のあいだに入った保存の結果は、画面に表示した値をその前の値へ戻さない', async () => {
    await mountAt2026();
    const load = arm('load', 'wari', { when: 'after', arg: 2026 });
    switchYear(2027);
    switchYear(2026);
    await load.reached;
    commit('wariSalesReturnTax78', '7');
    await waitFor(async () => (await stored())[2026]?.salesReturnTax78 === '7');
    load.release();
    await settle(150);
    expect(named('wariSalesReturnTax78').value).toBe('7');

    commit('wariSalesReturnTax624', '8');
    await waitFor(async () => (await stored())[2026]?.salesReturnTax624 === '8');
    await settle();
    expect((await stored())[2026]).toEqual({
      ...SEED_2026,
      salesReturnTax78: '7',
      salesReturnTax624: '8',
    });
  });

  test('元の年度の保存が失敗して年度を切り替えても、エラーは1回だけ通知され新しい年度の保存は動く', async () => {
    await mountAt2026();
    const put = arm('put', 'wariBaseAdjustments', { error: new Error('wari-write-failed') });
    commit('wariSalesReturnTax78', '7');
    await put.reached;
    switchYear(2027);
    await settle();
    put.release();
    await waitFor(shows2027);
    await settle();
    expect(rejections.map((e) => (e as Error).message)).toEqual(['wari-write-failed']);
    expect(await stored()).toEqual({ 2026: SEED_2026, 2027: SEED_2027 });

    commit('wariSalesReturnTax78', '9');
    await waitFor(async () => (await stored())[2027]?.salesReturnTax78 === '9');
    await settle();
    expect((await stored())[2027]).toEqual({ ...SEED_2027, salesReturnTax78: '9' });
    expect((await stored())[2026]).toEqual(SEED_2026);
    expect(rejections).toHaveLength(1);
  });
});

describe('直前の課税期間の月数の保存と年度の切り替え', () => {
  test('月数の保存の開始後に年度を切り替えると、値は元の年度に入り、新しい年度の月数は変わらない', async () => {
    await mountAt2026();
    const read = arm('get', 'interimPriorPeriodMonths');
    commit('interimPriorPeriodMonths', '5');
    await read.reached;
    switchYear(2027);
    await settle();
    read.release();
    await waitFor(() => named('interimPriorPeriodMonths').value === '6');
    await waitFor(async () => (await storedMonths())[2026] === 5);
    await settle();

    expect(await storedMonths()).toEqual({ 2026: 5, 2027: 6 });
    expect(named('interimPriorPeriodMonths').value).toBe('6');
  });

  test('月数の書き込みが1回失敗するとエラーが1回通知され、その後の保存は書き込まれる', async () => {
    await mountAt2026();
    arm('put', 'interimPriorPeriodMonths', {
      error: new Error('months-write-failed'),
      hold: false,
    });
    commit('interimPriorPeriodMonths', '5');
    await waitFor(() => rejections.length > 0);
    await settle();
    expect(rejections.map((e) => (e as Error).message)).toEqual(['months-write-failed']);
    expect(await storedMonths()).toEqual({ 2026: 4, 2027: 6 });

    commit('interimPriorPeriodMonths', '7');
    await waitFor(async () => (await storedMonths())[2026] === 7);
    await settle();
    expect(await storedMonths()).toEqual({ 2026: 7, 2027: 6 });
    expect(rejections).toHaveLength(1);
  });
});

describe('予算の保存と年度の切り替え', () => {
  const seed2027 = { month: 1, revenueBudget: '777', expenseBudget: '0' };

  beforeEach(async () => {
    await db.budgets.put({ year: 2027, ...seed2027 });
  });

  function typeBudget(name: string, value: string): void {
    input(named(name), value);
  }

  async function mountBudgetAt2026(): Promise<void> {
    mountNow();
    await waitFor(() => container!.querySelector('input[name="budget-revenue-3"]') !== null);
    await waitFor(() => container!.querySelector('input[name="wariSalesReturnTax78"]') !== null);
    typeBudget('budget-revenue-3', '5000');
  }

  async function expectSavedTo2026(): Promise<void> {
    const rows = await budgetRows(2026);
    expect(rows).toHaveLength(12);
    expect(rows.find((r) => r.month === 3)?.revenueBudget).toBe('5000');
    expect(await budgetRows(2027)).toEqual([seed2027]);
  }

  test('保存の途中で年度を切り替えても、12か月すべてが元の年度に入り、新しい年度には書き込まれない', async () => {
    await mountBudgetAt2026();
    const write = arm('put', 'budget', { skip: 3 });
    saveButton().click();
    await write.reached;
    switchYear(2027);
    await waitFor(() => named('budget-revenue-1').value === '777');
    write.release();
    await waitFor(async () => (await budgetRows(2026)).length === 12);
    await settle();
    await expectSavedTo2026();
  });

  test('年度を切り替えて新しい年度の報告書の取得が終わる前に保存しても、12か月すべてが元の年度に入る', async () => {
    await mountBudgetAt2026();
    const query = arm('get', 'taxRegistration');
    switchYear(2027);
    await query.reached;
    saveButton().click();
    await waitFor(async () => (await budgetRows(2026)).length === 12);
    await settle();
    query.release();
    await waitFor(() => named('budget-revenue-1').value === '777');
    await settle();
    await expectSavedTo2026();
  });

  test('年度を切り替えて新しい年度の報告書の取得が失敗したあとに保存しても、12か月すべてが元の年度に入る', async () => {
    await mountBudgetAt2026();
    arm('get', 'taxRegistration', { error: new Error('report-failed'), hold: false });
    switchYear(2027);
    await settle(150);
    expect(named('budget-revenue-3').value).toBe('5000');
    saveButton().click();
    await waitFor(async () => (await budgetRows(2026)).length === 12);
    await settle();
    await expectSavedTo2026();
  });
});

function type(name: string, value: string): void {
  const el = named(name);
  el.dispatchEvent(new FocusEvent('focus'));
  input(el, value);
}

async function putCount(key: string, run: () => Promise<void>): Promise<number> {
  const spy = vi.spyOn(db.settings, 'put');
  try {
    await run();
    return spy.mock.calls.filter(([row]) => (row as { key: string }).key === key).length;
  } finally {
    spy.mockRestore();
  }
}

describe('change が来ないまま年度が切り替わったときの未保存の入力（Firefox の年スピナー）', () => {
  test('2割／3割特例の欄に input だけを送って年度を切り替えると、値は元の年度に入り、新しい年度は変わらない', async () => {
    await mountAt2026();
    type('wariSalesReturnTax78', '7');
    switchYear(2027);
    await waitFor(shows2027);
    await settle(150);

    expect((await stored())[2026]).toEqual({ ...SEED_2026, salesReturnTax78: '7' });
    expect((await stored())[2027]).toEqual(SEED_2027);
    expect(named('wariSalesReturnTax78').value).toBe('50');
  });

  test('月数の欄に input だけを送って年度を切り替えると、値は元の年度に入り、新しい年度は変わらない', async () => {
    await mountAt2026();
    type('interimPriorPeriodMonths', '5');
    switchYear(2027);
    await waitFor(() => named('interimPriorPeriodMonths').value === '6');
    await settle(150);

    expect(await storedMonths()).toEqual({ 2026: 5, 2027: 6 });
    expect(named('interimPriorPeriodMonths').value).toBe('6');
  });

  test('特定少額資産の譲渡の税額欄に input だけを送って年度を切り替えると、値は元の年度に入り、新しい年度は変わらない', async () => {
    await mountAt2026();
    type('wariTransfer-netTax-0', '555');
    switchYear(2027);
    await waitFor(shows2027);
    await settle(150);

    expect((await stored())[2026]).toEqual({
      ...SEED_2026,
      specifiedSmallAssetTransfers: [hiddenRow, { date: '2026-02-01', rate: 0.1, netTax: '555' }],
    });
    expect((await stored())[2027]).toEqual(SEED_2027);
    expect(named('wariSalesReturnTax78').value).toBe('50');
  });

  test('別のタブが currentYear を直接書き換えて年度が変わっても、入力済みの値は元の年度に入り、新しい年度は変わらない', async () => {
    await mountAt2026();
    type('wariSalesReturnTax78', '7');
    type('interimPriorPeriodMonths', '5');
    await setSetting('currentYear', 2027);
    await waitFor(shows2027);
    await waitFor(() => named('interimPriorPeriodMonths').value === '6');
    await settle(150);

    expect((await stored())[2026]).toEqual({ ...SEED_2026, salesReturnTax78: '7' });
    expect((await stored())[2027]).toEqual(SEED_2027);
    expect(await storedMonths()).toEqual({ 2026: 5, 2027: 6 });
  });

  test.each(['abc', '100000000000000'])(
    '2割／3割特例の欄に読めない値 %j を input だけで送って年度を切り替えても、どちらの年度も書き換わらない',
    async (bad) => {
      await mountAt2026();
      type('wariSalesReturnTax78', bad);
      switchYear(2027);
      await waitFor(shows2027);
      await settle(150);

      expect(await stored()).toEqual({ 2026: SEED_2026, 2027: SEED_2027 });
      expect(named('wariSalesReturnTax78').value).toBe('50');
    },
  );

  test('月数の欄に読めない値を input だけで送って年度を切り替えても、どちらの年度も書き換わらない', async () => {
    await mountAt2026();
    type('interimPriorPeriodMonths', 'abc');
    switchYear(2027);
    await waitFor(() => named('interimPriorPeriodMonths').value === '6');
    await settle(150);

    expect(await storedMonths()).toEqual({ 2026: 4, 2027: 6 });
  });

  test('change で保存済みの欄は、年度を切り替えても書き込みが増えない（2割／3割特例）', async () => {
    await mountAt2026();
    const writes = await putCount('wariBaseAdjustments', async () => {
      commit('wariSalesReturnTax78', '7');
      await waitFor(async () => (await stored())[2026]?.salesReturnTax78 === '7');
      switchYear(2027);
      await waitFor(shows2027);
      await settle(150);
    });

    expect(writes).toBe(1);
    expect((await stored())[2026]).toEqual({ ...SEED_2026, salesReturnTax78: '7' });
    expect((await stored())[2027]).toEqual(SEED_2027);
  });

  test('change で保存済みの欄は、年度を切り替えても書き込みが増えない（月数）', async () => {
    await mountAt2026();
    const writes = await putCount('interimPriorPeriodMonths', async () => {
      commit('interimPriorPeriodMonths', '5');
      await waitFor(async () => (await storedMonths())[2026] === 5);
      switchYear(2027);
      await waitFor(() => named('interimPriorPeriodMonths').value === '6');
      await settle(150);
    });

    expect(writes).toBe(1);
    expect(await storedMonths()).toEqual({ 2026: 5, 2027: 6 });
  });
});

describe('月数の読込と、読込のあいだに入った保存', () => {
  test('A→B→A の最後の読込が値を読んだあとで止まっていても、そのあいだに保存した月数が欄に残る', async () => {
    await mountAt2026();
    const held = arm('load', 'months', { when: 'after', arg: 2026 });
    switchYear(2027);
    switchYear(2026);
    await held.reached;
    commit('interimPriorPeriodMonths', '5');
    await waitFor(async () => (await storedMonths())[2026] === 5);
    held.release();
    await settle(150);

    expect(named('interimPriorPeriodMonths').value).toBe('5');
    expect(await storedMonths()).toEqual({ 2026: 5, 2027: 6 });
  });
});

describe('新しい年度の読込のあいだに入った未保存の入力（change が来ない入力）', () => {
  test('2割／3割特例の欄に input だけを送ったあと、読込が終わる前に別の年度へ切り替えても、値は元の年度に入る', async () => {
    await mountAt2026();
    const held = arm('load', 'wari', { arg: 2027 });
    switchYear(2027);
    await held.reached;
    type('wariSalesReturnTax78', '8');
    switchYear(2028);
    await settle(200);
    held.release();
    await settle(400);

    expect((await stored())[2026]).toEqual({ ...SEED_2026, salesReturnTax78: '8' });
    expect((await stored())[2027]).toEqual(SEED_2027);
    expect(named('wariSalesReturnTax78').value).toBe('');
  });

  test('2割／3割特例の欄に input だけを送ったあと、読込が終わると、値は元の年度に入り、欄には新しい年度の値が出る', async () => {
    await mountAt2026();
    const held = arm('load', 'wari', { arg: 2027 });
    switchYear(2027);
    await held.reached;
    type('wariSalesReturnTax78', '8');
    held.release();
    await settle(400);

    expect((await stored())[2026]).toEqual({ ...SEED_2026, salesReturnTax78: '8' });
    expect((await stored())[2027]).toEqual(SEED_2027);
    expect(named('wariSalesReturnTax78').value).toBe('50');
  });

  test('特定少額資産の譲渡の税額欄に input だけを送ったあと、読込が終わると、値は元の年度の行に入り、隠れた行は変わらない', async () => {
    await mountAt2026();
    const held = arm('load', 'wari', { arg: 2027 });
    switchYear(2027);
    await held.reached;
    type('wariTransfer-netTax-0', '555');
    held.release();
    await settle(400);

    expect((await stored())[2026]).toEqual({
      ...SEED_2026,
      specifiedSmallAssetTransfers: [hiddenRow, { date: '2026-02-01', rate: 0.1, netTax: '555' }],
    });
    expect((await stored())[2027]).toEqual(SEED_2027);
    expect(named('wariSalesReturnTax78').value).toBe('50');
  });

  test('月数の欄に input だけを送ったあと、読込が終わると、値は元の年度に入り、欄には新しい年度の月数が出る', async () => {
    await mountAt2026();
    const held = arm('load', 'months', { arg: 2027 });
    switchYear(2027);
    await held.reached;
    type('interimPriorPeriodMonths', '9');
    held.release();
    await settle(400);

    expect(await storedMonths()).toEqual({ 2026: 9, 2027: 6 });
    expect(named('interimPriorPeriodMonths').value).toBe('6');
  });

  test('月数の欄に input だけを送ったあと、読込が終わる前に別の年度へ切り替えても、値は元の年度に入る', async () => {
    await mountAt2026();
    const held = arm('load', 'months', { arg: 2027 });
    switchYear(2027);
    await held.reached;
    type('interimPriorPeriodMonths', '9');
    switchYear(2028);
    await settle(200);
    held.release();
    await settle(400);

    expect(await storedMonths()).toEqual({ 2026: 9, 2027: 6 });
    expect(named('interimPriorPeriodMonths').value).toBe('12');
  });

  test('A→B→A：2割／3割特例の欄に input だけを送ってから元の年度へ戻すと、値は元の年度に入り、欄にも出る', async () => {
    await mountAt2026();
    const held = arm('load', 'wari', { arg: 2027 });
    switchYear(2027);
    await held.reached;
    type('wariSalesReturnTax78', '8');
    switchYear(2026);
    held.release();
    await settle(400);

    expect((await stored())[2026]).toEqual({ ...SEED_2026, salesReturnTax78: '8' });
    expect((await stored())[2027]).toEqual(SEED_2027);
    expect(named('wariSalesReturnTax78').value).toBe('8');
  });

  test('A→B→A：月数の欄に input だけを送ってから元の年度へ戻すと、値は元の年度に入り、欄にも出る', async () => {
    await mountAt2026();
    const held = arm('load', 'months', { arg: 2027 });
    switchYear(2027);
    await held.reached;
    type('interimPriorPeriodMonths', '9');
    switchYear(2026);
    held.release();
    await settle(400);

    expect(await storedMonths()).toEqual({ 2026: 9, 2027: 6 });
    expect(named('interimPriorPeriodMonths').value).toBe('9');
  });

  test('新しい年度の読込が2回続けて止まっても、それぞれのあいだに送った input がどちらも元の年度に入る', async () => {
    await mountAt2026();
    const first = arm('load', 'wari', { arg: 2027 });
    const second = arm('load', 'wari', { arg: 2027 });
    switchYear(2027);
    await first.reached;
    type('wariSalesReturnTax78', '8');
    first.release();
    const secondTaken = await Promise.race([
      second.reached.then(() => true),
      settle(300).then(() => false),
    ]);
    type('wariSalesReturnTax78', '9');
    second.release();
    await settle(400);

    expect((await stored())[2026]).toEqual({ ...SEED_2026, salesReturnTax78: '9' });
    expect((await stored())[2027]).toEqual(SEED_2027);
    expect(secondTaken).toBe(true);
    expect(named('wariSalesReturnTax78').value).toBe('50');
  });

  test('2割／3割特例の欄に input と change を送ると、読込が終わる前でも値は元の年度に入る', async () => {
    await mountAt2026();
    const held = arm('load', 'wari', { arg: 2027 });
    switchYear(2027);
    await held.reached;
    commit('wariSalesReturnTax78', '8');
    held.release();
    await settle(400);

    expect((await stored())[2026]).toEqual({ ...SEED_2026, salesReturnTax78: '8' });
    expect((await stored())[2027]).toEqual(SEED_2027);
    expect(named('wariSalesReturnTax78').value).toBe('50');
  });

  test('月数の欄に input と change を送ると、読込が終わる前でも値は元の年度に入る', async () => {
    await mountAt2026();
    const held = arm('load', 'months', { arg: 2027 });
    switchYear(2027);
    await held.reached;
    commit('interimPriorPeriodMonths', '9');
    held.release();
    await settle(400);

    expect(await storedMonths()).toEqual({ 2026: 9, 2027: 6 });
    expect(named('interimPriorPeriodMonths').value).toBe('6');
  });

  test.each(['abc', '100000000000000'])(
    '2割／3割特例の欄に読めない値 %j を input だけで送っても、読込が終わったあと、どちらの年度も書き換わらない',
    async (bad) => {
      await mountAt2026();
      const held = arm('load', 'wari', { arg: 2027 });
      switchYear(2027);
      await held.reached;
      type('wariSalesReturnTax78', bad);
      held.release();
      await settle(400);

      expect(await stored()).toEqual({ 2026: SEED_2026, 2027: SEED_2027 });
      expect(named('wariSalesReturnTax78').value).toBe('50');
    },
  );

  test.each(['13', 'abc'])(
    '月数の欄に読めない値 %j を input だけで送っても、読込が終わったあと、どちらの年度の月数も書き換わらない',
    async (bad) => {
      await mountAt2026();
      const held = arm('load', 'months', { arg: 2027 });
      switchYear(2027);
      await held.reached;
      type('interimPriorPeriodMonths', bad);
      held.release();
      await settle(400);

      expect(await storedMonths()).toEqual({ 2026: 4, 2027: 6 });
      expect(named('interimPriorPeriodMonths').value).toBe('6');
    },
  );

  test('読込が止まっているあいだに何も入力しなければ、2割／3割特例の書き込みは増えない', async () => {
    await mountAt2026();
    const writes = await putCount('wariBaseAdjustments', async () => {
      const held = arm('load', 'wari', { arg: 2027 });
      switchYear(2027);
      await held.reached;
      held.release();
      await waitFor(shows2027);
      await settle(200);
    });

    expect(writes).toBe(0);
    expect(await stored()).toEqual({ 2026: SEED_2026, 2027: SEED_2027 });
  });

  test('読込が止まっているあいだに何も入力しなければ、月数の書き込みは増えない', async () => {
    await mountAt2026();
    const writes = await putCount('interimPriorPeriodMonths', async () => {
      const held = arm('load', 'months', { arg: 2027 });
      switchYear(2027);
      await held.reached;
      held.release();
      await waitFor(() => named('interimPriorPeriodMonths').value === '6');
      await settle(200);
    });

    expect(writes).toBe(0);
    expect(await storedMonths()).toEqual({ 2026: 4, 2027: 6 });
  });
});
