import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { db } from '../db/db';
import { m } from '../paraglide/messages';

const { default: JournalEntryForm } = await import('./JournalEntryForm.svelte');

let container: HTMLElement | undefined;
let instance: Record<string, unknown> | undefined;

function field(name: string): HTMLInputElement {
  return container!.querySelector<HTMLInputElement>(`input[name="${name}"]`)!;
}

function type(name: string, value: string): void {
  const el = field(name);
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
}

function submitButton(): HTMLButtonElement {
  return Array.from(container!.querySelectorAll('button')).find(
    (b) => b.textContent?.trim() === m.journal_form_submit(),
  )!;
}

function fillAccounts(): void {
  for (const name of ['debit-account-0', 'credit-account-0']) {
    const select = container!.querySelector<HTMLSelectElement>(`select[name="${name}"]`)!;
    const option = document.createElement('option');
    option.value = name === 'debit-account-0' ? '1110' : '4110';
    select.appendChild(option);
    select.value = option.value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  }
  flushSync();
}

beforeEach(async () => {
  await db.delete();
  await db.open();
  container = document.createElement('div');
  document.body.appendChild(container);
  instance = mount(JournalEntryForm, { target: container, props: {} });
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

describe('仕訳フォームの金額欄', () => {
  test.each(['1e3', '.5e1'])('%j は欄の下に誤りが出て、保存できない', (bad) => {
    type('debit-amount-0', bad);
    type('credit-amount-0', bad);
    expect(container!.textContent).toContain(m.common_amount_invalid());
    expect(submitButton().disabled).toBe(true);
  });

  test.each(['100000000000000', '1000000000000000000000'])(
    '%j は過大と示し、保存できない',
    (big) => {
      type('debit-amount-0', big);
      type('credit-amount-0', big);
      expect(container!.textContent).toContain(m.common_amount_too_large());
      expect(submitButton().disabled).toBe(true);
    },
  );

  test('桁区切りの金額は合計に数え、例外を投げない', () => {
    type('debit-amount-0', '1,000');
    type('credit-amount-0', '1,000');
    expect(container!.textContent).not.toContain(m.common_amount_invalid());
    expect(submitButton().disabled).toBe(false);
  });

  test('1,000 は 1000 として保存される', async () => {
    fillAccounts();
    type('debit-amount-0', '1,000');
    type('credit-amount-0', '1,000');
    container!.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    await new Promise((r) => setTimeout(r, 100));
    const lines = await db.journalLines.toArray();
    expect(lines.map((l) => [l.side, l.amount, l.amountIndexed]).sort()).toEqual([
      ['credit', '1000', '00000000001000.00'],
      ['debit', '1000', '00000000001000.00'],
    ]);
  });
});

describe('在庫数量の欄（R13）', () => {
  test('在庫数量 -5 は案内を出し、保存しない', async () => {
    await db.inventoryItems.add({ id: 'item1', name: '商品A' });
    for (const name of ['debit-account-0', 'credit-account-0']) {
      const select = container!.querySelector<HTMLSelectElement>(`select[name="${name}"]`)!;
      const option = document.createElement('option');
      option.value = name === 'debit-account-0' ? '5020' : '1110';
      select.appendChild(option);
      select.value = option.value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }
    flushSync();
    const start = Date.now();
    let itemSelect: HTMLSelectElement | null = null;
    while (Date.now() - start < 3000) {
      itemSelect = container!.querySelector<HTMLSelectElement>(
        `select[aria-label="${m.journal_form_inventory_item_select()}"]`,
      );
      if (itemSelect && itemSelect.options.length > 1) {
        break;
      }
      await new Promise((r) => setTimeout(r, 10));
    }
    // happy-dom では選んだ option が :checked に当たらず、bind は無効でない最初の option を読むため、空の選択肢を無効にする
    itemSelect!.options[0]!.disabled = true;
    itemSelect!.value = 'item1';
    itemSelect!.dispatchEvent(new Event('change', { bubbles: true }));
    flushSync();
    type('debit-amount-0', '1000');
    type('credit-amount-0', '1000');
    type('debit-quantity-0', '-5');
    expect(container!.textContent).toContain(m.common_amount_invalid());
    expect(submitButton().disabled).toBe(true);
    container!.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    await new Promise((r) => setTimeout(r, 100));
    expect(await db.journalLines.count()).toBe(0);
  });
});
