import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { mount, unmount } from 'svelte';
import { db } from '../db/db';
import { m } from '../paraglide/messages';

const { default: OpeningSetup } = await import('./OpeningSetup.svelte');

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

async function tick(): Promise<void> {
  await new Promise((r) => setTimeout(r, 20));
}

function setValue(el: HTMLInputElement, value: string): void {
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

function buttonByText(root: ParentNode, text: string): HTMLButtonElement | undefined {
  return [...root.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.textContent?.trim() === text,
  );
}

let container: HTMLElement | undefined;
let instance: Record<string, unknown> | undefined;

async function render(): Promise<void> {
  container = document.createElement('div');
  document.body.appendChild(container);
  instance = mount(OpeningSetup, { target: container, props: {} });
  await waitFor(() => container!.querySelector('input[name="jigyoStartDate"]') !== null);
  const dateInputs = [...container.querySelectorAll<HTMLInputElement>('input[type="date"]')];
  setValue(dateInputs[0]!, '2026-07-01');
}

async function addExpense(name: string, amount: string): Promise<void> {
  setValue(
    container!.querySelector<HTMLInputElement>(
      `input[placeholder="${m.opening_expense_name_placeholder()}"]`,
    )!,
    name,
  );
  const amountInput = container!.querySelector<HTMLInputElement>(
    `input[placeholder="${m.opening_amount_placeholder()}"]`,
  )!;
  setValue(amountInput, amount);
  amountInput.closest('form')!.querySelector<HTMLButtonElement>('button[type="submit"]')!.click();
  await tick();
}

beforeEach(async () => {
  await db.delete();
  await db.open();
});

afterEach(async () => {
  if (instance !== undefined) {
    unmount(instance);
    instance = undefined;
  }
  container?.remove();
  container = undefined;
  await db.delete();
});

describe('開業設定の金額入力', () => {
  test('名前だけで金額が空の開業費は、黙って無視せず案内を出す', async () => {
    await render();
    await addExpense('名刺', '');
    expect(container!.textContent).toContain(m.common_amount_invalid());
    expect(container!.textContent).not.toContain('名刺（');
    expect(container!.querySelector('ul')).toBeNull();
  });

  test.each(['1e3', '100000000000000'])('開業費 %j は追加されず案内が出る', async (bad) => {
    await render();
    await addExpense('名刺', bad);
    expect(container!.querySelector('ul')).toBeNull();
    expect(container!.textContent).toContain(
      bad === '1e3' ? m.common_amount_invalid() : m.common_amount_too_large(),
    );
  });

  test('作り直しは、合計が大きすぎるとき既存の開業仕訳を打ち消さない', async () => {
    await render();
    await addExpense('名刺', '100000');
    buttonByText(container!, m.opening_action_preview())!.click();
    await tick();
    buttonByText(container!, m.opening_action_confirm())!.click();
    await waitFor(async () => (await db.journalEntries.count()) === 2);

    unmount(instance!);
    container!.remove();
    await render();
    await addExpense('名刺', '100000');
    buttonByText(container!, m.opening_action_preview())!.click();
    await tick();
    buttonByText(container!, m.opening_action_confirm())!.click();
    await waitFor(() => buttonByText(container!, m.opening_redo_button()) !== undefined);

    buttonByText(container!, m.opening_action_back())!.click();
    await tick();
    await addExpense('車', '60000000000000');
    await addExpense('家', '60000000000000');
    buttonByText(container!, m.opening_action_preview())!.click();
    await tick();
    buttonByText(container!, m.opening_redo_button())!.click();
    await waitFor(() => buttonByText(document.body, m.opening_redo_confirm_action()) !== undefined);
    buttonByText(document.body, m.opening_redo_confirm_action())!.click();

    await waitFor(() => (container!.textContent ?? '').includes(m.common_amount_too_large()));
    await new Promise((r) => setTimeout(r, 100));
    expect(await db.journalEntries.count()).toBe(2);
    const originals = await db.journalEntries.toArray();
    expect(originals.every((e) => e.originalEntryId === undefined)).toBe(true);
  });
});

describe('転用資産の入力（R13・R15）', () => {
  function assetInput(name: string): HTMLInputElement {
    return container!.querySelector<HTMLInputElement>(`input[name="${name}"]`)!;
  }

  function listed(): boolean {
    return [...container!.querySelectorAll('li')].some((li) => li.textContent?.includes('私用 PC'));
  }

  async function addAsset(cost: string, life: string): Promise<void> {
    setValue(assetInput('convertedAssetTitle'), '私用 PC');
    setValue(assetInput('convertedAssetAcquisitionDate'), '2020-01-01');
    setValue(assetInput('convertedAssetAcquisitionCost'), cost);
    setValue(assetInput('convertedAssetUsefulLife'), life);
    await tick();
    assetInput('convertedAssetTitle')
      .closest('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await tick();
  }

  test.each([
    ['-5', '4', m.common_amount_invalid()],
    ['100000000000000', '4', m.common_amount_too_large()],
    ['300000', '1', m.opening_asset_life_unsupported()],
    ['300000', '68', m.opening_asset_life_unsupported()],
  ])('取得価額 %j・耐用年数 %j は案内を出して加えない', async (cost, life, message) => {
    await render();
    await addAsset(cost, life);
    expect(container!.textContent).toContain(message);
    expect(listed()).toBe(false);
    expect(await db.fixedAssets.count()).toBe(0);
  });

  test('耐用年数 67 は加えられ、未償却残高を示す', async () => {
    await render();
    await addAsset('300000', '67');
    expect(container!.textContent).not.toContain(m.opening_asset_life_unsupported());
    expect(listed()).toBe(true);
  });
});
