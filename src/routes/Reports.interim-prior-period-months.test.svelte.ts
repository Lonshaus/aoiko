// Reports.svelte の中間申告義務判定が、設定経由の直前課税期間月数
// （interimPriorPeriodMonths）を実際に使っていることをマウント済みコンポーネントで見る。
// 2027年分に月数3を記録し前年確定税額150,000を入力すると年1回の義務、
// 記録の無い2028年分は同額でも月数12のまま判定され義務が無いことを確認する。
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { mount, unmount } from 'svelte';
import { db } from '../db/db';
import { ACCOUNTS_2026 } from '../tax-schema/2026';
import { setSetting } from '../lib/settings';
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
