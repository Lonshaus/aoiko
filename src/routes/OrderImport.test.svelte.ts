import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import { db } from '../db/db';
import { setLocale } from '../paraglide/runtime';
import type { OrderExtracted } from '../domain/order-extract';
import { m } from '../paraglide/messages';
import { ACCOUNTS_2026 } from '../tax-schema/2026';
import { processYear } from '../domain/consumption-tax';

const { defaultExtracted, state } = vi.hoisted(() => {
  const defaultExtracted = {
    date: '2026-03-01',
    vendor: 'テスト商店',
    items: [{ description: '品目A', amount: '8200' }],
    totalAmount: '9000',
  } as OrderExtracted;
  return { defaultExtracted, state: { extracted: defaultExtracted } };
});

vi.mock('../lib/order-extractor', () => ({
  createOrderExtractor: async () => ({
    external: false,
    destinationHost: '',
    extract: async () => state.extracted,
  }),
}));

const { default: OrderImport } = await import('./OrderImport.svelte');

async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('waitFor タイムアウト');
    }
    await new Promise((r) => setTimeout(r, 10));
  }
}

function button(c: HTMLElement, label: string): HTMLButtonElement {
  const found = Array.from(c.querySelectorAll('button')).find((b) =>
    (b.textContent ?? '').includes(label),
  );
  if (found === undefined) {
    throw new Error(`ボタンが見つからない: ${label}`);
  }
  return found;
}

// ダイアログは AlertDialog の portal で document.body 直下に出る。
function bodyButton(label: string): HTMLButtonElement {
  const found = Array.from(document.body.querySelectorAll('button')).find((b) =>
    (b.textContent ?? '').includes(label),
  );
  if (found === undefined) {
    throw new Error(`ボタンが見つからない: ${label}`);
  }
  return found;
}

let container: HTMLElement | undefined;
let instance: Record<string, unknown> | undefined;

beforeEach(async () => {
  // 既定ロケールは実行環境で変わる。文言を確かめるので明示的に日本語へ固定する。
  setLocale('ja', { reload: false });
  // 前のテストが state.extracted を書き換えたまま戻さないため、順序に依存しないよう毎回戻す。
  state.extracted = defaultExtracted;
  await db.delete();
  await db.open();
  container = document.createElement('div');
  document.body.appendChild(container);
  instance = mount(OrderImport, { target: container, props: {} });
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

async function analyze(c: HTMLElement): Promise<void> {
  const textarea = c.querySelector('textarea') as HTMLTextAreaElement;
  textarea.value = '注文ページの貼り付けテキスト';
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
  button(c, '解析').click();
  await waitFor(() => c.querySelector('table') !== null);
}

async function commit(c: HTMLElement): Promise<void> {
  button(c, '仕訳を登録').click();
  await new Promise((r) => setTimeout(r, 50));
  flushSync();
}

describe('OrderImport: 品目合計と総額の不一致', () => {
  test('一致しなければ登録せず、その場で理由を出す', async () => {
    const c = container as HTMLElement;
    await analyze(c);

    await commit(c);

    expect(c.textContent).toContain('品目合計と合計金額が一致しません');
    // 借方が品目・貸方が総額なので、続行させても validateLines が unbalanced を投げる。
    // 英語の例外メッセージが画面に出ていないことも確かめる。
    expect(c.textContent).not.toContain('unbalanced');
    expect(await db.journalEntries.count()).toBe(0);
  });

  test('一致していれば従来どおり登録できる', async () => {
    state.extracted = {
      date: '2026-03-01',
      vendor: 'テスト商店',
      items: [{ description: '品目A', amount: '9000' }],
      totalAmount: '9000',
    };
    const c = container as HTMLElement;
    await analyze(c);

    await commit(c);

    expect(c.textContent).not.toContain('品目合計と合計金額が一致しません');
    expect(await db.journalEntries.count()).toBe(1);
  });
});

describe('OrderImport: キャンセル時の破棄確認', () => {
  test('候補がある状態でキャンセルすると確認ダイアログが出て、候補は表示されたまま', async () => {
    const c = container as HTMLElement;
    await analyze(c);

    button(c, 'キャンセル').click();
    flushSync();

    expect(document.body.querySelector('[role="alertdialog"]')).not.toBeNull();
    expect(c.querySelector('table')).not.toBeNull();
  });

  test('ダイアログを閉じると候補は残ったまま', async () => {
    const c = container as HTMLElement;
    await analyze(c);

    button(c, 'キャンセル').click();
    flushSync();
    bodyButton(m.discard_candidates_stay()).click();
    flushSync();

    expect(c.querySelector('table')).not.toBeNull();
  });

  test('確認すると候補が破棄される', async () => {
    const c = container as HTMLElement;
    await analyze(c);

    button(c, 'キャンセル').click();
    flushSync();
    bodyButton(m.discard_candidates_discard()).click();
    flushSync();

    expect(c.querySelector('table')).toBeNull();
  });
});

function rateSelects(c: HTMLElement): HTMLSelectElement[] {
  return Array.from(
    c.querySelectorAll<HTMLSelectElement>(`select[aria-label="${m.order_th_tax_rate()}"]`),
  );
}

function pickRate(select: HTMLSelectElement, value: string): void {
  select.value = value;
  select.dispatchEvent(new Event('change', { bubbles: true }));
  flushSync();
}

function setTotal(c: HTMLElement, value: string): void {
  const input = Array.from(c.querySelectorAll('label'))
    .find((l) => (l.textContent ?? '').includes(m.order_label_total()))!
    .querySelector('input')!;
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
}

async function expenseLines() {
  const lines = await db.journalLines.toArray();
  return lines.filter((l) => l.accountCode !== '2120');
}

describe('OrderImport: 品目ごとの税率', () => {
  test('既定は 10%、8% を選んだ品目は 8% で記録され、品名が各明細の memo に入る', async () => {
    state.extracted = {
      date: '2026-03-01',
      vendor: 'テスト商店',
      items: [
        { description: '食品', amount: '5400' },
        { description: '文具', amount: '3600' },
      ],
      totalAmount: '9000',
    };
    const c = container as HTMLElement;
    await analyze(c);
    const selects = rateSelects(c);
    expect(selects.map((s) => s.value)).toEqual(['0.1', '0.1']);

    pickRate(selects[0]!, '0.08');
    await commit(c);

    const lines = await expenseLines();
    const food = lines.find((l) => l.memo === '食品')!;
    const stationery = lines.find((l) => l.memo === '文具')!;
    expect(food.taxRate).toBe(0.08);
    expect(stationery.taxRate).toBe(0.1);
  });

  test('品目の税率が 1 種類なら、値引行はその品目と同じ税率になり、課税仕入が同率で減る', async () => {
    await db.accounts.bulkPut(ACCOUNTS_2026.map((a) => ({ ...a, year: 2026 })));
    state.extracted = {
      date: '2026-03-01',
      vendor: 'テスト商店',
      items: [
        { description: '食品', amount: '10800' },
        { description: 'クーポン', amount: '-1080' },
      ],
      totalAmount: '9720',
    };
    const c = container as HTMLElement;
    await analyze(c);
    pickRate(rateSelects(c)[0]!, '0.08');
    expect(rateSelects(c)[1]!.value).toBe('0.08');
    await commit(c);

    const lines = await expenseLines();
    const discount = lines.find((l) => l.memo === 'クーポン')!;
    expect(discount.side).toBe('credit');
    expect(discount.taxRate).toBe(0.08);
    const processed = await processYear(2026);
    // 値引後 9,720 円の 8% 分。適格請求書なしのため経過措置で 80%（値引が無ければ 499.2）
    expect(processed.input8.toString()).toBe('449.28');
    expect(processed.input10.toString()).toBe('0');
  });

  test('税率が混在するときは値引行ごとに選べる', async () => {
    state.extracted = {
      date: '2026-03-01',
      vendor: 'テスト商店',
      items: [
        { description: '食品', amount: '5400' },
        { description: '文具', amount: '3600' },
        { description: 'クーポン', amount: '-500' },
      ],
      totalAmount: '8500',
    };
    const c = container as HTMLElement;
    await analyze(c);
    pickRate(rateSelects(c)[0]!, '0.08');
    expect(rateSelects(c)[2]!.value).toBe('0.1');
    pickRate(rateSelects(c)[2]!, '0.08');
    await commit(c);

    const discount = (await expenseLines()).find((l) => l.memo === 'クーポン')!;
    expect(discount.taxRate).toBe(0.08);
  });

  test('総額の編集後も、行の税率はそのまま記録される', async () => {
    state.extracted = {
      date: '2026-03-01',
      vendor: 'テスト商店',
      items: [{ description: '食品', amount: '1000' }],
      totalAmount: '900',
    };
    const c = container as HTMLElement;
    await analyze(c);
    pickRate(rateSelects(c)[0]!, '0.08');
    setTotal(c, '1000');
    await commit(c);

    expect((await expenseLines())[0]!.taxRate).toBe(0.08);
  });
});
