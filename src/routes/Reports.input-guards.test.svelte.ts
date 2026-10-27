import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { db } from '../db/db';
import { ACCOUNTS_2026 } from '../tax-schema/2026';
import { setSetting } from '../lib/settings';
import { m } from '../paraglide/messages';
import type { Account } from '../db/types';

vi.mock('../lib/save-file', () => ({
  saveTextFile: vi.fn(async () => 'saved' as const),
}));

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

let container: HTMLElement | undefined;
let instance: Record<string, unknown> | undefined;

function text(): string {
  return container!.textContent ?? '';
}

function field(name: string): HTMLInputElement {
  return container!.querySelector<HTMLInputElement>(`input[name="${name}"]`)!;
}

function type(name: string, value: string): void {
  const el = field(name);
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  flushSync();
}

beforeEach(async () => {
  await db.delete();
  await db.open();
  const accs: Account[] = ACCOUNTS_2026.map((a) => ({ ...a, year: 2027 }));
  await db.accounts.bulkPut(accs);
  await setSetting('currentYear', 2027);
  container = document.createElement('div');
  document.body.appendChild(container);
  instance = mount(Reports, { target: container, props: {} });
  await waitFor(() => field('interimPriorNenAmount') !== null);
});

afterEach(async () => {
  if (instance !== undefined) {
    unmount(instance);
    instance = undefined;
  }
  container?.remove();
  container = undefined;
  await db.delete();
  vi.clearAllMocks();
});

describe('期中申告の入力', () => {
  test('前年税額が読めない間は 0 に置き換えた結果を出さず、案内を出す', async () => {
    type('interimPriorNenAmount', '150000');
    await waitFor(() => text().includes('中間申告義務'));
    type('interimPriorNenAmount', 'abc');
    expect(text()).toContain(m.reports_interim_inputs_invalid());
    expect(text()).not.toContain('中間申告義務はありません');
    expect(text()).not.toContain('中間申告義務があります');
  });

  test('月数が読めない間も結果を出さない', () => {
    type('interimPriorPeriodMonths', 'abc');
    expect(text()).toContain(m.reports_interim_inputs_invalid());
  });
});

describe('報表年度と現金流量の整数欄', () => {
  test.each(['1999', '2.5', '', '2100'])('報表年度 %j は誤りとして示す', (bad) => {
    type('reportNen', bad);
    expect(text()).toContain(m.common_integer_invalid({ min: 2020, max: 2099 }));
  });

  test('範囲内の年度なら誤りは消える', () => {
    type('reportNen', '1999');
    type('reportNen', '2027');
    expect(text()).not.toContain(m.common_integer_invalid({ min: 2020, max: 2099 }));
  });

  test.each(['0', '-1', '25', ''])('現金流量の月数 %j は誤りで、実行ボタンが使えない', (bad) => {
    type('cashFlowHorizon', bad);
    expect(text()).toContain(m.common_integer_invalid({ min: 1, max: 24 }));
    const run = Array.from(container!.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === m.reports_cashflow_run(),
    )!;
    expect(run.disabled).toBe(true);
  });

  test('基準日が空白なら実行ボタンが使えない', () => {
    type('cashFlowAsOfDate', '');
    const run = Array.from(container!.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === m.reports_cashflow_run(),
    )!;
    expect(run.disabled).toBe(true);
  });
});

describe('売掛・買掛の新規入力', () => {
  function submit(): void {
    field('arapAmount')
      .closest('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    flushSync();
  }

  test('1e3 は提示して書き込まない', async () => {
    type('arapDescription', '売掛A');
    type('arapAmount', '1e3');
    expect(text()).toContain(m.common_amount_invalid());
    submit();
    await new Promise((r) => setTimeout(r, 50));
    expect(await db.arApEntries.count()).toBe(0);
  });

  test('1,000 は 1000 として保存される', async () => {
    type('arapDescription', '売掛A');
    type('arapAmount', '1,000');
    submit();
    await waitFor(() => text().includes('売掛A'));
    expect((await db.arApEntries.toArray()).map((e) => e.originalAmount)).toEqual(['1000']);
  });
});
