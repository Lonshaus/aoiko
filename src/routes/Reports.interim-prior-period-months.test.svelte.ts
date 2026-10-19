// Reports.svelte の中間申告義務判定が、設定経由の直前課税期間月数
// （interimPriorPeriodMonths）を実際に使っていることをマウント済みコンポーネントで見る。
// 2027年分に月数3を記録し前年確定税額150,000を入力すると年1回の義務、
// 記録の無い2028年分は同額でも月数12のまま判定され義務が無いことを確認する。
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { db } from '../db/db';
import { ACCOUNTS_2026 } from '../tax-schema/2026';
import { getSetting, setSetting } from '../lib/settings';
import { hasUnsavedChanges } from '../router.svelte';
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

async function seedAccounts(year: number): Promise<void> {
  const accs: Account[] = ACCOUNTS_2026.map((a) => ({ ...a, year }));
  await db.accounts.bulkPut(accs);
}

function containsText(el: HTMLElement, text: string): boolean {
  return (el.textContent ?? '').includes(text);
}

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

function setInputValue(input: HTMLInputElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

let container: HTMLElement | undefined;
let instance: Record<string, unknown> | undefined;

beforeEach(async () => {
  await db.delete();
  await db.open();
  await seedAccounts(2027);
  await seedAccounts(2028);
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

describe('設定経由の直前課税期間月数が中間申告義務判定に使われる（Reports画面）', () => {
  test('2027年分：月数3・前年確定税額150,000 → 年1回。2028年分：記録無し・同額 → 無義務', async () => {
    await setSetting('interimPriorPeriodMonths', { 2027: 3 });
    await setSetting('currentYear', 2027);

    container = document.createElement('div');
    document.body.appendChild(container);
    instance = mount(Reports, { target: container, props: {} });
    // 2027年分の前年（2026年分）確定消費税額欄が出るまで待つ（year切替の反映確認）
    await waitFor(() => containsText(container!, '2026年分の確定消費税額（国税分）'));
    const amountInput2027 = findInputByLabelText(container, '2026年分の確定消費税額（国税分）');
    setInputValue(amountInput2027, '150000');
    // ÷3か月で判定される：150,000×6/3=300,000 > 240,000 なので年1回の義務になる
    // （÷12のままなら150,000×6/12=75,000 < 240,000 で無義務のまま）
    await waitFor(() =>
      containsText(container!, '年 1 回の中間申告義務があります（予定申告方式の按分額）。'),
    );
    // 2028年分へ切り替える（記録が無いので月数は12のまま）
    await setSetting('currentYear', 2028);
    await waitFor(() => containsText(container!, '2027年分の確定消費税額（国税分）'));
    const amountInput2028 = findInputByLabelText(container, '2027年分の確定消費税額（国税分）');
    setInputValue(amountInput2028, '150000');

    await waitFor(() =>
      containsText(container!, '前年確定消費税額が48万円以下のため、中間申告義務はありません。'),
    );
  });
});

describe('直前課税期間の月数は change まで未保存として登録される', () => {
  test('input だけでは未保存・保存値は不変、change で解除され従来どおり保存される', async () => {
    await setSetting('currentYear', 2027);
    container = document.createElement('div');
    document.body.appendChild(container);
    instance = mount(Reports, { target: container, props: {} });
    await waitFor(
      () => container!.querySelector('input[name="interimPriorPeriodMonths"]') !== null,
    );
    const input = container.querySelector<HTMLInputElement>(
      'input[name="interimPriorPeriodMonths"]',
    )!;
    await waitFor(() => input.value === '12');
    expect(hasUnsavedChanges()).toBe(false);

    input.dispatchEvent(new FocusEvent('focus'));
    input.value = '7';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    expect(hasUnsavedChanges()).toBe(true);
    expect(await getSetting('interimPriorPeriodMonths')).toBeUndefined();

    input.dispatchEvent(new Event('change', { bubbles: true }));
    flushSync();
    expect(hasUnsavedChanges()).toBe(false);
    let saved = await getSetting('interimPriorPeriodMonths');
    for (let i = 0; i < 200 && saved?.[2027] !== 7; i++) {
      await new Promise((r) => setTimeout(r, 10));
      saved = await getSetting('interimPriorPeriodMonths');
    }
    expect(saved?.[2027]).toBe(7);
  });

  test('元の値へ戻すと（blur なしで）解除され、blur だけでは解除されず、アンマウントで登録は残らない', async () => {
    await setSetting('currentYear', 2027);
    container = document.createElement('div');
    document.body.appendChild(container);
    instance = mount(Reports, { target: container, props: {} });
    await waitFor(
      () => container!.querySelector('input[name="interimPriorPeriodMonths"]') !== null,
    );
    const input = container.querySelector<HTMLInputElement>(
      'input[name="interimPriorPeriodMonths"]',
    )!;
    await waitFor(() => input.value === '12');
    input.dispatchEvent(new FocusEvent('focus'));
    input.value = '5';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    expect(hasUnsavedChanges()).toBe(true);
    input.value = '12';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    expect(hasUnsavedChanges()).toBe(false);
    input.value = '6';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    expect(hasUnsavedChanges()).toBe(true);
    input.dispatchEvent(new FocusEvent('blur'));
    flushSync();
    expect(hasUnsavedChanges()).toBe(true);
    unmount(instance);
    instance = undefined;
    expect(hasUnsavedChanges()).toBe(false);
  });
});

describe('直前課税期間の月数の全角入力と読めない入力', () => {
  async function mountMonths(initial = '12'): Promise<HTMLInputElement> {
    await setSetting('currentYear', 2027);
    container = document.createElement('div');
    document.body.appendChild(container);
    instance = mount(Reports, { target: container, props: {} });
    await waitFor(
      () => container!.querySelector('input[name="interimPriorPeriodMonths"]') !== null,
    );
    const input = container.querySelector<HTMLInputElement>(
      'input[name="interimPriorPeriodMonths"]',
    )!;
    await waitFor(() => input.value === initial);
    return input;
  }

  function commit(input: HTMLInputElement, value: string): void {
    input.dispatchEvent(new FocusEvent('focus'));
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    flushSync();
  }

  test('全角の「６」は6か月として保存され、欄も半角で表示される', async () => {
    const input = await mountMonths();
    commit(input, '６');
    let saved = await getSetting('interimPriorPeriodMonths');
    for (let i = 0; i < 200 && saved?.[2027] !== 6; i++) {
      await new Promise((r) => setTimeout(r, 10));
      saved = await getSetting('interimPriorPeriodMonths');
    }
    expect(saved?.[2027]).toBe(6);
    expect(input.value).toBe('6');
    expect(hasUnsavedChanges()).toBe(false);
    expect(container!.textContent).not.toContain(m.reports_interim_prior_period_months_invalid());
  });

  test('1〜12の整数でない月数は保存せず、欄の下に入力の誤りを示して未保存の確認を残す', async () => {
    await setSetting('interimPriorPeriodMonths', { 2027: 6 });
    const input = await mountMonths('6');
    for (const v of ['13', 'abc', '0', '6.5']) {
      commit(input, v);
      await new Promise((r) => setTimeout(r, 30));
      expect(container!.textContent).toContain(m.reports_interim_prior_period_months_invalid());
      expect(hasUnsavedChanges()).toBe(true);
      expect((await getSetting('interimPriorPeriodMonths'))?.[2027]).toBe(6);
    }
    commit(input, '３');
    let saved = await getSetting('interimPriorPeriodMonths');
    for (let i = 0; i < 200 && saved?.[2027] !== 3; i++) {
      await new Promise((r) => setTimeout(r, 10));
      saved = await getSetting('interimPriorPeriodMonths');
    }
    expect(saved?.[2027]).toBe(3);
    expect(hasUnsavedChanges()).toBe(false);
    expect(container!.textContent).not.toContain(m.reports_interim_prior_period_months_invalid());
  });

  test('読めない月数は、入力し直して同じ文字列に戻しても未保存の確認が残り、読める値を保存すると消える', async () => {
    await setSetting('interimPriorPeriodMonths', { 2027: 6 });
    const input = await mountMonths('6');
    commit(input, '13');
    await new Promise((r) => setTimeout(r, 30));
    expect((await getSetting('interimPriorPeriodMonths'))?.[2027]).toBe(6);
    expect(hasUnsavedChanges()).toBe(true);

    input.dispatchEvent(new FocusEvent('focus'));
    input.value = '131';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.value = '13';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new FocusEvent('blur'));
    flushSync();
    expect(input.value).toBe('13');
    expect(container!.textContent).toContain(m.reports_interim_prior_period_months_invalid());
    expect(hasUnsavedChanges()).toBe(true);

    commit(input, '3');
    let saved = await getSetting('interimPriorPeriodMonths');
    for (let i = 0; i < 200 && saved?.[2027] !== 3; i++) {
      await new Promise((r) => setTimeout(r, 10));
      saved = await getSetting('interimPriorPeriodMonths');
    }
    expect(saved?.[2027]).toBe(3);
    expect(hasUnsavedChanges()).toBe(false);
  });

  test('全角で保存した直後、欄が半角に書き戻された値へ入力し直すと、blur なしで未保存の確認が消える', async () => {
    const input = await mountMonths();
    commit(input, '７');
    let saved = await getSetting('interimPriorPeriodMonths');
    for (let i = 0; i < 200 && saved?.[2027] !== 7; i++) {
      await new Promise((r) => setTimeout(r, 10));
      saved = await getSetting('interimPriorPeriodMonths');
    }
    expect(saved?.[2027]).toBe(7);
    expect(input.value).toBe('7');
    expect(hasUnsavedChanges()).toBe(false);

    input.value = '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    expect(hasUnsavedChanges()).toBe(true);
    input.value = '7';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    expect(hasUnsavedChanges()).toBe(false);
    input.dispatchEvent(new FocusEvent('blur'));
    flushSync();
    expect(hasUnsavedChanges()).toBe(false);
    expect((await getSetting('interimPriorPeriodMonths'))?.[2027]).toBe(7);
  });
});
