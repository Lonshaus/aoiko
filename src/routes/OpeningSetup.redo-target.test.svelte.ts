import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { mount, unmount } from 'svelte';
import { db } from '../db/db';
import { generateOpeningEntries, removeOpeningEntries } from '../domain/business-opening';
import { filedYearGuard } from '../lib/filed-year-guard.svelte';
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

let container: HTMLElement | undefined;
let instance: Record<string, unknown> | undefined;

function text(): string {
  return container?.textContent ?? '';
}

function bodyText(): string {
  return document.body.textContent ?? '';
}

function buttonByText(root: ParentNode, label: string): HTMLButtonElement | undefined {
  return [...root.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.textContent?.trim() === label,
  );
}

function input(name: string): HTMLInputElement {
  return container!.querySelector<HTMLInputElement>(`input[name="${name}"]`)!;
}

function setValue(el: HTMLInputElement, value: string): void {
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

async function render(): Promise<void> {
  container = document.createElement('div');
  document.body.appendChild(container);
  instance = mount(OpeningSetup, { target: container, props: {} });
  await waitFor(() => container!.querySelector('input[name="jigyoStartDate"]') !== null);
}

async function setStart(start: string): Promise<void> {
  setValue(input('jigyoStartDate'), start);
  setValue(input('jigyoCloseDate'), '');
  await tick();
}

async function addExpense(): Promise<void> {
  setValue(input('openingKeihiTitle'), '名刺');
  setValue(input('openingKeihiAmount'), '10000');
  input('openingKeihiAmount')
    .closest('form')!
    .querySelector<HTMLButtonElement>('button[type="submit"]')!
    .click();
  await tick();
}

async function preview(): Promise<void> {
  buttonByText(container!, m.opening_action_preview())!.click();
  await tick();
}

function confirmButton(): HTMLButtonElement {
  return buttonByText(container!, m.opening_action_confirm())!;
}

async function seedOpening(start: string): Promise<void> {
  await generateOpeningEntries(
    {
      businessStartDate: start,
      expenses: [{ name: '名刺', amount: '10000' }],
      expenseAmortization: 'immediate',
      convertedAssets: [],
      customItems: [],
    },
    { allowFiledYear: true },
  );
}

async function openingEntries(year: number, status: 'confirmed' | 'reversed' = 'confirmed') {
  return (await db.journalEntries.where('year').equals(year).toArray()).filter(
    (e) => e.source === 'opening' && e.status === status && e.originalEntryId === undefined,
  );
}

async function reachAlreadyExists(start: string): Promise<void> {
  await render();
  await setStart(start);
  await addExpense();
  await preview();
  confirmButton().click();
  await waitFor(() => buttonByText(container!, m.opening_redo_button()) !== undefined);
}

beforeEach(async () => {
  filedYearGuard.pending = null;
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
  filedYearGuard.pending = null;
  await db.delete();
});

describe('作り直しで打ち消す年は、そのときのデータから決める（G9）', () => {
  test('既存の開業仕訳で止まった後にフォームへ戻って別の年にすると、作り直しを出さず、作成はほかの年の選択を通す', async () => {
    await seedOpening('2026-07-01');
    const seeded = (await openingEntries(2026)).length;
    await reachAlreadyExists('2026-07-01');
    buttonByText(container!, m.opening_action_back())!.click();
    await tick();
    await setStart('2025-10-01');
    await preview();
    expect(buttonByText(container!, m.opening_redo_button())).toBeUndefined();
    expect(text()).not.toContain(m.opening_already_exists());

    confirmButton().click();
    await waitFor(() => bodyText().includes(m.opening_cross_year_change({ year: 2026 })));
    buttonByText(document.body, m.common_cancel())!.click();
    await waitFor(() => !bodyText().includes(m.opening_cross_year_change({ year: 2026 })));
    expect(await openingEntries(2025)).toHaveLength(0);
    expect(await openingEntries(2026)).toHaveLength(seeded);
  });

  test('作り直しを押した時点でその年の開業仕訳が無くなっていれば、打ち消す確認を出さずにそのまま作る', async () => {
    await seedOpening('2026-07-01');
    await reachAlreadyExists('2026-07-01');
    await removeOpeningEntries(2026, { allowFiledYear: true });
    buttonByText(container!, m.opening_redo_button())!.click();
    await waitFor(() => text().includes(m.opening_done_message()));
    expect(bodyText()).not.toContain(
      m.opening_redo_confirm_desc({ reverseYear: 2026, createYear: 2026 }),
    );
    expect(await openingEntries(2026)).toHaveLength(2);
    expect(await openingEntries(2026, 'reversed')).toHaveLength(2);
  });

  test('日付が読めない開業仕訳でも、その年（year）に開業仕訳があればほかの年の選択を出し、開業日の変更ならその年を打ち消す', async () => {
    await db.journalEntries.add({
      id: 'bad',
      date: '2026-02-30',
      year: 2026,
      description: '開業費計上（開業設定）',
      status: 'confirmed',
      source: 'opening',
      createdAt: 1,
      confirmedAt: 1,
    });
    await render();
    await setStart('2025-10-01');
    await addExpense();
    await preview();
    confirmButton().click();
    await waitFor(
      () => buttonByText(document.body, m.opening_cross_year_change({ year: 2026 })) !== undefined,
    );
    buttonByText(document.body, m.opening_cross_year_change({ year: 2026 }))!.click();
    const desc = m.opening_redo_confirm_desc({ reverseYear: 2026, createYear: 2025 });
    await waitFor(() => bodyText().includes(desc));
    buttonByText(document.body, m.opening_redo_confirm_action())!.click();
    await waitFor(() => text().includes(m.opening_done_message()));
    expect(await openingEntries(2026)).toHaveLength(0);
    expect(await openingEntries(2026, 'reversed')).toHaveLength(1);
    expect((await openingEntries(2025)).length).toBeGreaterThan(0);
  });
});
