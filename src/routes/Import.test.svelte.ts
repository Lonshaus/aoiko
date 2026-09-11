import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import { db } from '../db/db';
import type { CsvParser } from '../parsers/types';
import type { JournalLine } from '../db/types';

const { parserA, parserB } = vi.hoisted(() => {
  const parserA: CsvParser = {
    name: 'parser-a',
    displayName: 'パーサーA',
    accountCode: '1130',
    encoding: 'utf-8',
    parse: () => [
      { date: '2026-01-10', description: 'A由来', amount: '1000', side: 'debit', rawRow: {} },
    ],
  };
  const parserB: CsvParser = {
    name: 'parser-b',
    displayName: 'パーサーB',
    accountCode: '2120',
    encoding: 'utf-8',
    parse: () => [
      { date: '2026-02-20', description: 'B由来', amount: '2000', side: 'credit', rawRow: {} },
    ],
  };
  return { parserA, parserB };
});

vi.mock('../parsers', () => ({
  PARSERS: [parserA, parserB],
  findParser: (name: string) => [parserA, parserB].find((p) => p.name === name) ?? null,
}));

const { default: Import, computeInventoryLive } = await import('./Import.svelte');
const { counterpartCandidates } = await import('../domain/llm-classify');
const { setSetting } = await import('../lib/settings');

async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('waitFor タイムアウト');
    }
    await new Promise((r) => setTimeout(r, 10));
  }
}
// description は <input value> なので textContent には出ない。行データの識別には日付列を使う。
function rowDates(c: HTMLElement): string[] {
  return Array.from(c.querySelectorAll('tbody tr td:first-child')).map(
    (td) => td.textContent?.trim() ?? '',
  );
}

let container: HTMLElement | undefined;
let instance: Record<string, unknown> | undefined;

beforeEach(async () => {
  await db.delete();
  await db.open();
  container = document.createElement('div');
  document.body.appendChild(container);
  instance = mount(Import, { target: container, props: {} });
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

async function loadFile(c: HTMLElement): Promise<void> {
  const fileInput = c.querySelector('input[type="file"]') as HTMLInputElement;
  const file = new File(['dummy'], 'a.csv', { type: 'text/csv' });
  Object.defineProperty(fileInput, 'files', { value: [file], configurable: true });
  fileInput.dispatchEvent(new Event('change', { bubbles: true }));
  await waitFor(() => rowDates(c).length > 0);
}

function changeParser(c: HTMLElement, name: string): void {
  const parserSelect = c.querySelector('select') as HTMLSelectElement;
  parserSelect.value = name;
  parserSelect.dispatchEvent(new Event('change', { bubbles: true }));
  flushSync();
}

describe('Import: 取込元を選び直した時の再解析行の破棄', () => {
  test('ファイル読込後に取込元を切り替えると、以前の parser の行は破棄される', async () => {
    const c = container as HTMLElement;
    await loadFile(c);
    expect(rowDates(c)).toEqual(['2026-01-10']);

    changeParser(c, parserB.name);

    expect(rowDates(c)).toEqual([]);
    expect(c.textContent).toContain('取込元を変更したため');
  });

  test('取込元を切り替えていない限り、行は保持される', async () => {
    const c = container as HTMLElement;
    await loadFile(c);

    changeParser(c, parserA.name);

    expect(rowDates(c)).toEqual(['2026-01-10']);
    expect(c.textContent).not.toContain('取込元を変更したため');
  });

  test('解析成功後は input.value がクリアされ、同じファイルを選び直せる', async () => {
    const c = container as HTMLElement;
    const fileInput = c.querySelector('input[type="file"]') as HTMLInputElement;
    await loadFile(c);
    expect(fileInput.value).toBe('');
  });
});

const INVENTORY_TEST_ACCOUNTS = [
  { code: '1340', year: 2026, name: '棚卸資産', category: 'asset' as const, displayOrder: 340 },
  { code: '5020', year: 2026, name: '仕入', category: 'expense' as const, displayOrder: 20 },
  { code: '5200', year: 2026, name: '消耗品費', category: 'expense' as const, displayOrder: 200 },
  { code: '1110', year: 2026, name: '現金', category: 'asset' as const, displayOrder: 110 },
  { code: '2120', year: 2026, name: '未払金', category: 'liability' as const, displayOrder: 120 },
];

function baseLine(overrides: Partial<JournalLine>): JournalLine {
  return {
    id: crypto.randomUUID(),
    entryId: 'e1',
    side: 'debit',
    accountCode: '5200',
    amount: '1000',
    amountIndexed: '0000000001000',
    taxRate: 10,
    taxIncluded: true,
    invoiceCompliant: true,
    ...overrides,
  };
}

function inventoryFreeCandidates() {
  return counterpartCandidates(INVENTORY_TEST_ACCOUNTS, '2120', 'credit', false);
}

describe('computeInventoryLive: 在庫運用の有無判定', () => {
  test('e1: 既定状態（itemId 行なし・inventoryItems 空）なら false、候補は在庫 4 科目を含まない', async () => {
    await expect(computeInventoryLive()).resolves.toBe(false);
    const codes = inventoryFreeCandidates().map((a) => a.code);
    expect(codes).not.toContain('1340');
    expect(codes).not.toContain('5020');
  });

  test('e2: 5020 のみの行があっても itemId 無しなら false、5200/1110 は候補に残る', async () => {
    await db.journalLines.add(baseLine({ accountCode: '5020' }));
    await expect(computeInventoryLive()).resolves.toBe(false);
    const codes = inventoryFreeCandidates().map((a) => a.code);
    expect(codes).not.toContain('1340');
    expect(codes).not.toContain('5020');
    expect(codes).toContain('5200');
    expect(codes).toContain('1110');
  });

  test('e3: 1340/5010/5030 のみの行があっても itemId 無しなら false', async () => {
    await db.journalLines.add(baseLine({ id: crypto.randomUUID(), accountCode: '1340' }));
    await expect(computeInventoryLive()).resolves.toBe(false);

    await db.journalLines.add(baseLine({ id: crypto.randomUUID(), accountCode: '5010' }));
    await expect(computeInventoryLive()).resolves.toBe(false);

    await db.journalLines.add(baseLine({ id: crypto.randomUUID(), accountCode: '5030' }));
    await expect(computeInventoryLive()).resolves.toBe(false);
  });

  test('e4: itemId を持つ行があれば true', async () => {
    await db.journalLines.add(baseLine({ itemId: 'item-1' }));
    await expect(computeInventoryLive()).resolves.toBe(true);
  });

  test('e5: inventoryItems にだけ行があれば true', async () => {
    await db.inventoryItems.add({ id: 'item-1', name: '商品A' });
    await expect(computeInventoryLive()).resolves.toBe(true);
  });

  test('e6: inventoryAutoValuationEnabled の値に関わらず、既定状態なら false', async () => {
    await setSetting('inventoryAutoValuationEnabled', true);
    await expect(computeInventoryLive()).resolves.toBe(false);
    await setSetting('inventoryAutoValuationEnabled', false);
    await expect(computeInventoryLive()).resolves.toBe(false);
  });
});
