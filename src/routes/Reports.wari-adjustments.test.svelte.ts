// Reports.svelte の2割／3割特例の基礎調整欄（売上対価の返還等）が
// 設定へ保存され、再マウント（＝再読込相当）後も保持されることを見る。
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { db } from '../db/db';
import { ACCOUNTS_2026 } from '../tax-schema/2026';
import { getSetting } from '../lib/settings';
import { m } from '../paraglide/messages';
import type { Account } from '../db/types';

vi.mock('../lib/save-file', () => ({
  saveTextFile: vi.fn(async () => 'saved' as const),
}));

const { default: Reports } = await import('./Reports.svelte');

async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 4000,
): Promise<void> {
  const start = Date.now();
  while (!(await predicate())) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('waitFor タイムアウト');
    }
    await new Promise((r) => setTimeout(r, 10));
  }
}

async function seedAccounts(year: number): Promise<void> {
  const accs: Account[] = ACCOUNTS_2026.map((a) => ({ ...a, year }));
  await db.accounts.bulkPut(accs);
}

let container: HTMLElement | undefined;
let instance: Record<string, unknown> | undefined;

beforeEach(async () => {
  await db.delete();
  await db.open();
  await seedAccounts(2026);
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

function findInputByLabelText(el: HTMLElement, labelText: string): HTMLInputElement {
  const label = Array.from(el.querySelectorAll('label')).find((l) =>
    (l.textContent ?? '').includes(labelText),
  );
  if (label === undefined) {
    throw new Error(`label "${labelText}" not found`);
  }
  const input = label.querySelector('input');
  if (input === null) {
    throw new Error(`input under label "${labelText}" not found`);
  }
  return input;
}

describe('wariSalesReturnTax78/624 の設定保存と再読込後の保持', () => {
  test('入力して change すると設定へ保存され、再マウント後も同じ値が表示される', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    instance = mount(Reports, { target: container, props: {} });

    await waitFor(() =>
      Array.from(container!.querySelectorAll('label')).some((l) =>
        (l.textContent ?? '').includes('売上対価の返還等に係る消費税額（税率7.8%分）'),
      ),
    );
    const input = findInputByLabelText(container, '売上対価の返還等に係る消費税額（税率7.8%分）');
    input.value = '10000';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));

    await waitFor(() => {
      // liveQuery/非同期保存が終わるまで待つ
      return true;
    }, 50);
    const saved = await new Promise<Record<number, { salesReturnTax78?: string }> | undefined>(
      (resolve) => {
        const check = async () => {
          const v = await getSetting('wariBaseAdjustments');
          if (v?.[2026]?.salesReturnTax78 === '10000') {
            resolve(v);
          } else {
            setTimeout(check, 10);
          }
        };
        check();
      },
    );
    expect(saved?.[2026]?.salesReturnTax78).toBe('10000');

    unmount(instance);
    instance = undefined;
    container.remove();
    container = document.createElement('div');
    document.body.appendChild(container);
    instance = mount(Reports, { target: container, props: {} });
    await waitFor(() =>
      Array.from(container!.querySelectorAll('label')).some((l) =>
        (l.textContent ?? '').includes('売上対価の返還等に係る消費税額（税率7.8%分）'),
      ),
    );
    await waitFor(() => {
      const reloaded = findInputByLabelText(
        container!,
        '売上対価の返還等に係る消費税額（税率7.8%分）',
      );
      return reloaded.value === '10000';
    });
    const reloaded = findInputByLabelText(
      container,
      '売上対価の返還等に係る消費税額（税率7.8%分）',
    );
    expect(reloaded.value).toBe('10000');
  });
});

describe('interimPriorPeriodMonths の設定保存と再読込後の保持', () => {
  test('直前課税期間の月数を入力すると設定へ保存され、再マウント後も保持される', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    instance = mount(Reports, { target: container, props: {} });

    await waitFor(() =>
      Array.from(container!.querySelectorAll('label')).some((l) =>
        (l.textContent ?? '').includes('直前の課税期間の月数'),
      ),
    );
    const input = findInputByLabelText(container, '直前の課税期間の月数');
    input.value = '3';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));

    const saved = await new Promise<Record<number, number> | undefined>((resolve) => {
      const check = async () => {
        const v = await getSetting('interimPriorPeriodMonths');
        if (v?.[2026] === 3) {
          resolve(v);
        } else {
          setTimeout(check, 10);
        }
      };
      check();
    });
    expect(saved?.[2026]).toBe(3);

    unmount(instance);
    instance = undefined;
    container.remove();
    container = document.createElement('div');
    document.body.appendChild(container);
    instance = mount(Reports, { target: container, props: {} });
    await waitFor(() => {
      const found = Array.from(container!.querySelectorAll('label')).find((l) =>
        (l.textContent ?? '').includes('直前の課税期間の月数'),
      );
      return found?.querySelector('input')?.value === '3';
    });
    const reloaded = findInputByLabelText(container, '直前の課税期間の月数');
    expect(reloaded.value).toBe('3');
  });
});

describe('特定少額資産の譲渡行は入力して change すると保存され、再マウント後も保持される', () => {
  function named(name: string): HTMLInputElement {
    const el = container!.querySelector<HTMLInputElement>(`[name="${name}"]`);
    if (el === null) {
      throw new Error(`${name} が見付からない`);
    }
    return el;
  }
  function commit(name: string, value: string): void {
    const el = named(name);
    el.dispatchEvent(new FocusEvent('focus'));
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    flushSync();
  }
  async function mountReports(): Promise<void> {
    container = document.createElement('div');
    document.body.appendChild(container);
    instance = mount(Reports, { target: container, props: {} });
    await waitFor(() => container!.querySelector('input[name="wariSalesReturnTax78"]') !== null);
  }
  async function remount(): Promise<void> {
    unmount(instance!);
    instance = undefined;
    container!.remove();
    await mountReports();
  }
  function addButton(): HTMLButtonElement {
    const hint = Array.from(container!.querySelectorAll('p')).find(
      (p) => (p.textContent ?? '').trim() === m.reports_wari_specified_small_asset_transfers_hint(),
    );
    const b = Array.from(hint?.parentElement?.querySelectorAll('button') ?? []).find(
      (x) => (x.textContent ?? '').trim() === m.settings_action_add(),
    );
    if (b === undefined) {
      throw new Error('追加ボタンが見付からない');
    }
    return b;
  }
  function removeButtons(): HTMLButtonElement[] {
    return Array.from(container!.querySelectorAll('button')).filter(
      (b) => (b.textContent ?? '').trim() === m.income_deductions_dependent_remove(),
    );
  }
  async function addRow(index: number, date: string, netTax: string): Promise<void> {
    addButton().click();
    flushSync();
    await waitFor(
      () => container!.querySelector(`input[name="wariTransfer-netTax-${index}"]`) !== null,
    );
    commit(`wariTransfer-date-${index}`, date);
    commit(`wariTransfer-netTax-${index}`, netTax);
  }
  async function storedTransfers() {
    return (await getSetting('wariBaseAdjustments'))?.[2026]?.specifiedSmallAssetTransfers;
  }

  test('追加した行を入力して change すると保存され、再マウント後も同じ日付と金額が表示される', async () => {
    await mountReports();
    await addRow(0, '2026-03-01', '5000');
    await waitFor(async () => (await storedTransfers())?.[0]?.netTax === '5000');
    expect(await storedTransfers()).toEqual([{ date: '2026-03-01', rate: 0.1, netTax: '5000' }]);

    await remount();
    await waitFor(() => container!.querySelector('input[name="wariTransfer-netTax-0"]') !== null);
    await waitFor(() => named('wariTransfer-netTax-0').value === '5000');
    expect(named('wariTransfer-date-0').value).toBe('2026-03-01');
    expect(named('wariTransfer-netTax-0').value).toBe('5000');
    await db.settings.toArray();
  });

  test('2行を保存した状態で先頭の行を消すと、保存済みの配列には後ろの行だけが残る', async () => {
    await mountReports();
    await addRow(0, '2026-03-01', '5000');
    await addRow(1, '2026-04-01', '7000');
    await waitFor(async () => (await storedTransfers())?.length === 2);

    removeButtons()[0]!.click();
    flushSync();
    await waitFor(async () => (await storedTransfers())?.length === 1);
    expect(await storedTransfers()).toEqual([{ date: '2026-04-01', rate: 0.1, netTax: '7000' }]);
    await db.settings.toArray();
  });

  test('カンマ付き・数値でない金額は入力のまま保存され、再マウントで正規化して表示され、次の保存で正規化値になる', async () => {
    await mountReports();
    await addRow(0, '2026-03-01', '5,000');
    await addRow(1, '2026-04-01', 'abc');
    await waitFor(async () => (await storedTransfers())?.[1]?.netTax === 'abc');
    expect((await storedTransfers())?.map((t) => t.netTax)).toEqual(['5,000', 'abc']);

    await remount();
    await waitFor(() => container!.querySelector('input[name="wariTransfer-netTax-1"]') !== null);
    expect(named('wariTransfer-netTax-0').value).toBe('5000');
    expect(named('wariTransfer-netTax-1').value).toBe('0');
    expect(container!.querySelector('input[name="wariSalesReturnTax78"]')).not.toBeNull();

    commit('wariSalesReturnTax78', '100');
    await waitFor(async () => (await storedTransfers())?.[0]?.netTax === '5000');
    expect((await storedTransfers())?.map((t) => t.netTax)).toEqual(['5000', '0']);
    await db.settings.toArray();
  });
});
