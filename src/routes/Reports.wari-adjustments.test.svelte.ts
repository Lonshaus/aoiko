// Reports.svelte の2割／3割特例の基礎調整欄（売上対価の返還等）が
// 設定へ保存され、再マウント（＝再読込相当）後も保持されることを見る。
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { mount, unmount } from 'svelte';
import { db } from '../db/db';
import { ACCOUNTS_2026 } from '../tax-schema/2026';
import { getSetting } from '../lib/settings';
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
