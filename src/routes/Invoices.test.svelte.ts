import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { db } from '../db/db';
import { m } from '../paraglide/messages';
import { todayISO } from '../lib/date';
import type { Invoice } from '../db/types';

const { default: Invoices } = await import('./Invoices.svelte');

async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('waitFor タイムアウト');
    }
    await new Promise((r) => setTimeout(r, 10));
  }
}

function draft(): Invoice {
  return {
    id: 'inv-1',
    documentType: 'invoice',
    status: 'draft',
    number: '',
    vendorId: '',
    date: '2026-08-03',
    lineItems: [{ id: 'li-1', name: '保守作業', quantity: '1', unitPrice: '1000', taxRate: 0.1 }],
    createdAt: 1_754_000_000_000,
  };
}
// ロケールはテスト環境の既定（英語）になるため、ラベルは messages 経由で引く。
function button(c: HTMLElement, label: string): HTMLButtonElement | undefined {
  return Array.from(c.querySelectorAll('button')).find((b) => b.textContent?.trim() === label);
}

function itemNames(c: HTMLElement): string[] {
  return Array.from(
    c.querySelectorAll<HTMLInputElement>(`input[placeholder="${m.invoices_form_item_name()}"]`),
  ).map((el) => el.value);
}

function named(c: HTMLElement, name: string): HTMLInputElement {
  const el = c.querySelector<HTMLInputElement>(`[name="${name}"]`);
  if (el === null) {
    throw new Error(`${name} が見つかりません`);
  }
  return el;
}

function typeInto(el: HTMLInputElement, value: string) {
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
}

function printedCells(c: HTMLElement): string[] {
  return Array.from(c.querySelectorAll('tbody td')).map((td) => td.textContent?.trim() ?? '');
}
// happy-dom には印刷が無く、印刷を押すと requestAnimationFrame の中で例外になる。
// 印刷画面が出た時点ではまだ呼ばれていないことがあり、先に戻すとテストの後で例外になるため、呼ばれたことを確かめてから戻す。
function stubPrint(): { printed: () => boolean; restore: () => void } {
  const w = window as unknown as { print?: () => void };
  const original = w.print;
  let printed = false;
  w.print = () => {
    printed = true;
  };
  return {
    printed: () => printed,
    restore: () => {
      if (original === undefined) {
        delete w.print;
      } else {
        w.print = original;
      }
    },
  };
}

async function openDraftEditor(c: HTMLElement, inv: Invoice) {
  await db.invoices.add(inv);
  instance = mount(Invoices, { target: c, props: {} });
  await waitFor(() => button(c, m.invoices_action_edit()) !== undefined);
  button(c, m.invoices_action_edit())?.click();
  await waitFor(() => button(c, m.invoices_action_issue()) !== undefined);
}

let container: HTMLElement | undefined;
let instance: Record<string, unknown> | undefined;

beforeEach(async () => {
  await db.delete();
  await db.open();
  container = document.createElement('div');
  document.body.appendChild(container);
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
});

describe('Invoices: 下書きの編集を開く', () => {
  // 一覧は $state 配列で保持しているため要素は proxy。structuredClone で複製しようとすると
  // DataCloneError で落ち、編集フォームが開かないままエラーバナーだけ出ていた。
  test('編集を押すと、その下書きの内容が入ったフォームが開く', async () => {
    await db.invoices.add(draft());
    const c = container as HTMLElement;
    instance = mount(Invoices, { target: c, props: {} });

    await waitFor(() => button(c, m.invoices_action_edit()) !== undefined);
    button(c, m.invoices_action_edit())?.click();

    await waitFor(() => button(c, m.invoices_action_issue()) !== undefined);
    expect(itemNames(c)).toEqual(['保守作業']);
  });

  test('編集フォームでの変更は、保存するまで保管中の下書きに触れない', async () => {
    await db.invoices.add(draft());
    const c = container as HTMLElement;
    instance = mount(Invoices, { target: c, props: {} });

    await waitFor(() => button(c, m.invoices_action_edit()) !== undefined);
    button(c, m.invoices_action_edit())?.click();
    await waitFor(() => button(c, m.invoices_action_issue()) !== undefined);

    const nameInput = c.querySelector<HTMLInputElement>(
      `input[placeholder="${m.invoices_form_item_name()}"]`,
    );
    if (nameInput === null) {
      throw new Error('明細の品名欄が見つかりません');
    }
    nameInput.value = '書き換え';
    nameInput.dispatchEvent(new Event('input', { bubbles: true }));

    button(c, m.settings_action_cancel())?.click();
    await waitFor(() => button(c, m.invoices_action_edit()) !== undefined);
    const stored = await db.invoices.get('inv-1');
    expect(stored?.lineItems[0]?.name).toBe('保守作業');
  });
});

describe('Invoices: 数量・単価の入力', () => {
  test('数量を空にし、単価を全角や「,」・空白付きで打っても画面は落ちず、入力が残る', async () => {
    const c = container as HTMLElement;
    await openDraftEditor(c, { ...draft(), vendorId: 'v-1' });

    typeInto(named(c, 'invoice-item-li-1-quantity'), '');
    for (const v of ['５０００', '5,', '5,000', ' 5000 ', '－500']) {
      typeInto(named(c, 'invoice-item-li-1-tanka'), v);
    }

    expect(button(c, m.invoices_action_issue())).toBeDefined();
    expect(itemNames(c)).toEqual(['保守作業']);
    expect(named(c, 'invoice-item-li-1-quantity').value).toBe('');
    expect(named(c, 'invoice-item-li-1-tanka').value).toBe('－500');
  });

  test('空欄の数量はその行の下に入力の誤りを表示し、発行できず、フォームは残る', async () => {
    const c = container as HTMLElement;
    await openDraftEditor(c, { ...draft(), vendorId: 'v-1' });
    expect(c.textContent).not.toContain(m.invoices_line_invalid());

    typeInto(named(c, 'invoice-item-li-1-quantity'), '');
    expect(c.textContent).toContain(m.invoices_line_invalid());

    button(c, m.invoices_action_issue())?.click();
    await waitFor(() => (c.textContent?.split(m.invoices_line_invalid()).length ?? 0) === 3);
    expect((await db.invoices.get('inv-1'))?.status).toBe('draft');
    expect(await db.journalEntries.count()).toBe(0);
    expect(itemNames(c)).toEqual(['保守作業']);

    typeInto(named(c, 'invoice-item-li-1-quantity'), '２');
    expect(named(c, 'invoice-item-li-1-quantity').value).toBe('２');
    expect(c.querySelector('p.basis-full')).toBeNull();
  });

  test('請求書の合計が 100 兆円以上なら「金額が大きすぎます」を示して「発行する」を押せず、「下書き保存」は押せる。見積書は対象外', async () => {
    const c = container as HTMLElement;
    const big = {
      ...draft(),
      vendorId: 'v-1',
      lineItems: [{ ...draft().lineItems[0]!, quantity: '1', unitPrice: '100000000000000' }],
    };
    await openDraftEditor(c, big);
    expect(c.textContent).toContain(m.common_amount_too_large());
    expect(button(c, m.invoices_action_issue())?.disabled).toBe(true);
    expect(button(c, m.invoices_action_save_draft())?.disabled).toBe(false);
    unmount(instance!);
    instance = undefined;
    await db.invoices.clear();
    await db.invoices.add({ ...big, documentType: 'quote' });
    instance = mount(Invoices, { target: c, props: {} });
    await waitFor(() => button(c, m.invoices_tab_quote()) !== undefined);
    button(c, m.invoices_tab_quote())?.click();
    await waitFor(() => button(c, m.invoices_action_edit()) !== undefined);
    button(c, m.invoices_action_edit())?.click();
    await waitFor(() => c.querySelector('[name="invoice-item-li-1-quantity"]') !== null);
    expect(c.textContent).not.toContain(m.common_amount_too_large());
  });

  test.each([
    ['1e3', '2'],
    ['0x10', '2'],
    ['2', '1e3'],
  ])(
    '数量 %j・単価 %j が保存されている明細は、その行の下に案内を出し、発行できず、下書きのまま残る',
    async (quantity, unitPrice) => {
      const c = container as HTMLElement;
      await openDraftEditor(c, {
        ...draft(),
        vendorId: 'v-1',
        lineItems: [{ ...draft().lineItems[0]!, quantity, unitPrice }],
      });
      expect(c.textContent).toContain(m.invoices_line_invalid());
      button(c, m.invoices_action_issue())?.click();
      await new Promise((r) => setTimeout(r, 100));
      expect((await db.invoices.get('inv-1'))?.status).toBe('draft');
      expect(await db.journalEntries.count()).toBe(0);
      expect(c.textContent).toContain('¥');
    },
  );

  test('全角の数量・単価で下書き保存すると半角で保存され、一覧の合計も値どおりになる', async () => {
    const c = container as HTMLElement;
    await openDraftEditor(c, { ...draft(), vendorId: 'v-1' });

    typeInto(named(c, 'invoice-item-li-1-quantity'), '１');
    typeInto(named(c, 'invoice-item-li-1-tanka'), '５，０００');
    button(c, m.invoices_action_save_draft())?.click();

    await waitFor(() => button(c, m.invoices_action_edit()) !== undefined);
    const stored = await db.invoices.get('inv-1');
    expect(stored?.lineItems.map((i) => [i.quantity, i.unitPrice])).toEqual([['1', '5000']]);
    await waitFor(() => c.textContent?.includes('¥5,500') === true);
  });

  test('全角の単価で発行した請求書は、印刷画面で例外を投げず半角の値と ¥5,000 を出す', async () => {
    const print = stubPrint();
    try {
      const c = container as HTMLElement;
      await openDraftEditor(c, { ...draft(), vendorId: 'v-1' });

      typeInto(named(c, 'invoice-item-li-1-quantity'), '１');
      typeInto(named(c, 'invoice-item-li-1-tanka'), '５０００');
      button(c, m.invoices_action_issue())?.click();

      await waitFor(() => button(c, m.invoices_action_print()) !== undefined);
      expect((await db.invoices.get('inv-1'))?.lineItems[0]?.unitPrice).toBe('5000');
      button(c, m.invoices_action_print())?.click();

      await waitFor(() => printedCells(c).length > 0);
      expect(printedCells(c)).toEqual(['保守作業', '1', '¥5,000', '10%']);
      expect(c.textContent).toContain('¥5,500');
      await waitFor(print.printed);
    } finally {
      print.restore();
    }
  });

  test('以前のバージョンや復元したバックアップに全角のまま残る発行済みの明細も、一覧と印刷画面で値どおりに出る', async () => {
    const print = stubPrint();
    try {
      const c = container as HTMLElement;
      await db.invoices.add({
        ...draft(),
        status: 'issued',
        number: 'INV-2026-0001',
        vendorId: 'v-1',
        lineItems: [
          { id: 'li-1', name: '保守作業', quantity: '１', unitPrice: '５０００', taxRate: 0.1 },
        ],
      });
      instance = mount(Invoices, { target: c, props: {} });

      await waitFor(() => button(c, m.invoices_action_print()) !== undefined);
      expect(c.textContent).toContain('¥5,500');
      button(c, m.invoices_action_print())?.click();

      await waitFor(() => printedCells(c).length > 0);
      expect(printedCells(c)).toEqual(['保守作業', '１', '¥5,000', '10%']);
      await waitFor(print.printed);
    } finally {
      print.restore();
    }
  });

  test('負の数量の行がある下書きの一覧の合計は変更前と同じ', async () => {
    const c = container as HTMLElement;
    await db.invoices.add({
      ...draft(),
      lineItems: [
        { id: 'li-1', name: '保守作業', quantity: '2', unitPrice: '1000', taxRate: 0.1 },
        { id: 'li-2', name: '値引き', quantity: '-1', unitPrice: '500', taxRate: 0.1 },
      ],
    });
    instance = mount(Invoices, { target: c, props: {} });

    await waitFor(() => c.textContent?.includes('¥1,650') === true);
  });
});

describe('Invoices: 一覧の合計（R21）', () => {
  test('読めない明細のある請求書は、合計を 0 と見せずに読めないと示す', async () => {
    const inv = draft();
    inv.lineItems = [{ ...inv.lineItems[0]!, quantity: 'abc' }];
    await db.invoices.add(inv);
    const c = container as HTMLElement;
    instance = mount(Invoices, { target: c, props: {} });
    await waitFor(() => button(c, m.invoices_action_edit()) !== undefined);
    const row = button(c, m.invoices_action_edit())!.closest('li')!;
    expect(row.textContent).toContain(m.common_stored_amount_unreadable());
    expect(row.textContent).not.toContain('¥0');
  });
});

describe('Invoices: 見積書から請求書への変換', () => {
  test('「請求書に変換」で明細をコピーした入力画面が開き、保存するまで何も書かず、「下書き保存」で請求書の下書きが 1 件増える', async () => {
    const c = container as HTMLElement;
    await db.invoices.add({
      ...draft(),
      id: 'quote-1',
      documentType: 'quote',
      status: 'issued',
      number: 'QT-2026-0001',
      vendorId: 'v-1',
      lineItems: [
        { id: 'li-q', name: '設計', quantity: '１,０００', unitPrice: '２', taxRate: 0.1 },
      ],
    });
    instance = mount(Invoices, { target: c, props: {} });
    await waitFor(() => button(c, m.invoices_tab_quote()) !== undefined);
    button(c, m.invoices_tab_quote())?.click();
    await waitFor(() => button(c, m.invoices_action_convert()) !== undefined);
    button(c, m.invoices_action_convert())?.click();
    await waitFor(() => button(c, m.invoices_action_save_draft()) !== undefined);

    expect(itemNames(c)).toEqual(['設計']);
    expect(c.querySelector<HTMLInputElement>('input[name$="-quantity"]')!.value).toBe('1000');
    expect(c.querySelector<HTMLInputElement>('input[name$="-tanka"]')!.value).toBe('2');
    expect(named(c, 'invoiceDate').value).toBe(todayISO());
    expect(await db.invoices.count()).toBe(1);
    expect(button(c, m.invoices_action_issue())?.disabled).toBe(false);

    typeInto(c.querySelector<HTMLInputElement>('input[name$="-quantity"]')!, '3');
    button(c, m.invoices_action_save_draft())?.click();
    await waitFor(() => button(c, m.invoices_action_edit()) !== undefined);
    const created = (await db.invoices.toArray()).filter((i) => i.id !== 'quote-1');
    expect(created).toHaveLength(1);
    expect([created[0]!.documentType, created[0]!.status, created[0]!.number]).toEqual([
      'invoice',
      'draft',
      '',
    ]);
    expect(created[0]!.date).toBe(todayISO());
    expect(created[0]!.lineItems[0]!.quantity).toBe('3');
  });
});
