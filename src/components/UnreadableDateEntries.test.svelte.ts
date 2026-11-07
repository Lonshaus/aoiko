import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { db } from '../db/db';
import { toIndexable } from '../lib/decimal';
import { m } from '../paraglide/messages';

const { default: UnreadableDateEntries } = await import('./UnreadableDateEntries.svelte');

async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 3000,
): Promise<void> {
  const start = Date.now();
  while (!(await predicate())) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('waitFor タイムアウト');
    }
    await new Promise((r) => setTimeout(r, 10));
  }
}

let target: HTMLElement | null = null;
let component: Record<string, unknown> | null = null;

function text(): string {
  return target?.textContent ?? '';
}

function dateInput(): HTMLInputElement {
  const el = target?.querySelector<HTMLInputElement>('input[type="date"]');
  if (!el) {
    throw new Error('日付の欄が無い');
  }
  return el;
}

function registerButton(): HTMLButtonElement {
  const el = [...(target?.querySelectorAll<HTMLButtonElement>('button') ?? [])].find(
    (b) => b.textContent?.trim() === m.entry_date_fix_action(),
  );
  if (el === undefined) {
    throw new Error('登録し直すボタンが無い');
  }
  return el;
}
// 型を外して書く。旧バージョンが保存した形を再現するため。
async function seedEntry(id: string, date: string, year: unknown): Promise<void> {
  await db.table('journalEntries').put({
    id,
    date,
    year,
    description: `レシート ${id}`,
    status: 'confirmed',
    source: 'ocr',
    createdAt: 1,
    confirmedAt: 1,
  });
  for (const [side, accountCode] of [
    ['debit', '1110'],
    ['credit', '4110'],
  ] as const) {
    await db.journalLines.add({
      id: `${id}-${side}`,
      entryId: id,
      side,
      accountCode,
      amount: '4000',
      amountIndexed: toIndexable('4000'),
      taxRate: 0.1,
      taxIncluded: true,
      invoiceCompliant: false,
    });
  }
}

function render(): void {
  target = document.createElement('div');
  document.body.appendChild(target);
  component = mount(UnreadableDateEntries, { target });
  flushSync();
}

beforeEach(async () => {
  await db.delete();
  await db.open();
});

afterEach(async () => {
  if (component) {
    unmount(component);
    component = null;
  }
  target?.remove();
  target = null;
  await db.delete();
});

describe('UnreadableDateEntries', () => {
  test('斜線の日付は一覧に出し、正しい日付を初めから入れておく', async () => {
    await seedEntry('o1', '2026/5/1', 2026);
    render();
    await waitFor(() => text().includes(m.entry_date_fix_title()));
    expect(text()).toContain(m.entry_date_fix_original_date({ date: '2026/5/1' }));
    expect(text()).toContain('レシート o1');
    expect(dateInput().value).toBe('2026-05-01');
    expect(registerButton().disabled).toBe(false);
  });

  test('明細は借方を先に並べる', async () => {
    await seedEntry('o1', '2026/5/1', 2026);
    render();
    await waitFor(() => text().includes(m.entry_date_fix_title()));
    const shown = text();
    expect(shown.indexOf(m.journal_side_debit())).toBeGreaterThanOrEqual(0);
    expect(shown.indexOf(m.journal_side_debit())).toBeLessThan(
      shown.indexOf(m.journal_side_credit()),
    );
  });

  test('和暦の日付は欄を空にし、日付を選んで登録し直すと一覧から消える', async () => {
    await seedEntry('o1', '令和8年5月1日', NaN);
    render();
    await waitFor(() => text().includes(m.entry_date_fix_title()));
    expect(dateInput().value).toBe('');
    expect(registerButton().disabled).toBe(true);

    const input = dateInput();
    input.value = '2026-05-01';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    expect(registerButton().disabled).toBe(false);
    registerButton().click();
    flushSync();

    await waitFor(() => text().includes(m.entry_date_fix_done()));
    expect((await db.journalEntries.get('o1'))?.status).toBe('reversed');
    expect(text()).not.toContain('レシート o1');
    expect(text()).not.toContain(m.entry_date_fix_title());
  });

  test('存在しない日付は欄に入れない', async () => {
    await seedEntry('o1', '2026/2/30', 2026);
    render();
    await waitFor(() => text().includes(m.entry_date_fix_title()));
    expect(dateInput().value).toBe('');
    expect(registerButton().disabled).toBe(true);
  });

  test('保存された日付の双方向の制御文字は表示しない', async () => {
    const rlo = String.fromCharCode(0x202e);
    await seedEntry('o1', `2026/5/1${rlo}10/9`, 2026);
    render();
    await waitFor(() => text().includes(m.entry_date_fix_title()));
    expect(text()).toContain('2026/5/1?10/9');
    expect(text()).not.toContain(rlo);
  });

  test('対象が無ければ何も出さない', async () => {
    await seedEntry('readable', '2026-05-01', 2026);
    await seedEntry('reversed', '2026/5/1', 2026);
    await db.journalEntries.update('reversed', { status: 'reversed' });
    render();
    await new Promise((r) => setTimeout(r, 200));
    flushSync();
    expect(text()).toBe('');
    expect(target?.children).toHaveLength(0);
  });
});
