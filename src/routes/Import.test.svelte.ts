import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import { db } from '../db/db';
import type { CsvParser } from '../parsers/types';
import type { JournalLine } from '../db/types';
import { m } from '../paraglide/messages';

const { parserA, parserB, parserC, parserD } = vi.hoisted(() => {
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
  // ルール命中・非命中の 2 行を返す、相手科目セレクトの幅検証専用のパーサー
  const parserC: CsvParser = {
    name: 'parser-c',
    displayName: 'パーサーC',
    accountCode: '1130',
    encoding: 'utf-8',
    parse: () => [
      { date: '2026-04-01', description: 'ルール一致店', amount: '500', side: 'debit', rawRow: {} },
      { date: '2026-04-02', description: '未分類の店', amount: '700', side: 'debit', rawRow: {} },
    ],
  };
  // LLM 分類の失敗件数表示専用。41 行、全行ルール非命中・同一側で 1 回のバッチにまとまる。
  const parserD: CsvParser = {
    name: 'parser-d',
    displayName: 'パーサーD',
    accountCode: '1130',
    encoding: 'utf-8',
    parse: () =>
      Array.from({ length: 41 }, (_, i) => ({
        date: `2026-05-${String((i % 28) + 1).padStart(2, '0')}`,
        description: `d${i}`,
        amount: '1000',
        side: 'debit' as const,
        rawRow: {},
      })),
  };
  return { parserA, parserB, parserC, parserD };
});

vi.mock('../parsers', () => ({
  PARSERS: [parserA, parserB, parserC, parserD],
  findParser: (name: string) =>
    [parserA, parserB, parserC, parserD].find((p) => p.name === name) ?? null,
}));
// 失敗行数表示テスト専用。ローカルエンジンの分類結果を模し、確認ダイアログを経由させない external: false。
vi.mock('../lib/llm-adapter', () => ({
  createLlmAdapter: async () => ({
    external: false,
    destinationHost: '',
    generateJson: async () => ({
      classifications: [
        { ref: '2', accountCode: '', confidence: 'none', reason: '', status: 'failed' },
        { ref: '5', accountCode: '', confidence: 'none', reason: '', status: 'failed' },
        { ref: '10', accountCode: '', confidence: 'none', reason: '', status: 'failed' },
      ],
    }),
  }),
}));

const {
  default: Import,
  computeInventoryLive,
  shouldFillSuggestion,
} = await import('./Import.svelte');
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

// ダイアログが閉じている間は AlertDialog の中身がポータルに存在しない前提のヘルパー
function dialogVisible(): boolean {
  return Array.from(document.body.querySelectorAll('button')).some((b) =>
    (b.textContent ?? '').includes(m.discard_candidates_discard()),
  );
}

function dispatchFileToInput(input: HTMLInputElement, file: File): void {
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  input.dispatchEvent(new Event('change', { bubbles: true }));
  flushSync();
}

function dispatchCsvFile(c: HTMLElement, name: string): HTMLInputElement {
  const fileInput = c.querySelector('input[type="file"]') as HTMLInputElement;
  dispatchFileToInput(fileInput, new File(['dummy'], name, { type: 'text/csv' }));
  return fileInput;
}

// happy-dom は file input の value 代入を常に '' に固定し呼び出し自体を記録しないため、プロトタイプの setter に委譲するインスタンス直下の accessor で呼び出しを記録する。
function spyOnValueSetter(input: HTMLInputElement): string[] {
  const proto = Object.getPrototypeOf(input) as object;
  const desc = Object.getOwnPropertyDescriptor(proto, 'value');
  if (!desc?.get || !desc.set) {
    throw new Error('value のプロパティ記述子が取得できない');
  }
  const calls: string[] = [];
  Object.defineProperty(input, 'value', {
    configurable: true,
    get: () => desc.get!.call(input),
    set: (v: string) => {
      calls.push(v);
      desc.set!.call(input, v);
    },
  });
  return calls;
}

describe('Import: 取込元を選び直した時の再解析行の破棄', () => {
  test('行がある状態で取込元を切り替えると確認ダイアログが出て、行は変わらない', async () => {
    const c = container as HTMLElement;
    await loadFile(c);

    changeParser(c, parserB.name);

    expect(dialogVisible()).toBe(true);
    expect(rowDates(c)).toEqual(['2026-01-10']);
  });

  test('ダイアログを閉じると行は残り、parser セレクトも元の値に戻る', async () => {
    const c = container as HTMLElement;
    await loadFile(c);

    changeParser(c, parserB.name);
    bodyButton(m.discard_candidates_stay()).click();
    flushSync();

    expect(rowDates(c)).toEqual(['2026-01-10']);
    const parserSelect = c.querySelector('select') as HTMLSelectElement;
    expect(parserSelect.value).toBe(parserA.name);
  });

  test('確認すると行は破棄され、新しい parser が適用される', async () => {
    const c = container as HTMLElement;
    await loadFile(c);

    changeParser(c, parserB.name);
    bodyButton(m.discard_candidates_discard()).click();
    flushSync();

    expect(rowDates(c)).toEqual([]);
    expect(c.textContent).toContain('取込元を変更したため');
    const parserSelect = c.querySelector('select') as HTMLSelectElement;
    expect(parserSelect.value).toBe(parserB.name);
  });

  test('行が無ければ確認なしで即座に切り替わる', () => {
    const c = container as HTMLElement;

    changeParser(c, parserB.name);

    expect(dialogVisible()).toBe(false);
    const parserSelect = c.querySelector('select') as HTMLSelectElement;
    expect(parserSelect.value).toBe(parserB.name);
  });

  test('取込元を切り替えていない限り、行は保持される', async () => {
    const c = container as HTMLElement;
    await loadFile(c);

    changeParser(c, parserA.name);

    expect(rowDates(c)).toEqual(['2026-01-10']);
    expect(c.textContent).not.toContain('取込元を変更したため');
  });
});

describe('Import: ファイルを選び直した時の破棄確認', () => {
  test('行がある状態で別ファイルを選ぶと確認ダイアログが出て、行も選択中ファイル名も変わらない', async () => {
    const c = container as HTMLElement;
    await loadFile(c);

    dispatchCsvFile(c, 'b.csv');

    expect(dialogVisible()).toBe(true);
    expect(rowDates(c)).toEqual(['2026-01-10']);
    expect(c.textContent).toContain('選択中：a.csv');
  });

  test('ダイアログを閉じると行と選択中ファイル名は元のまま、input.value がクリアされて同じファイルを選び直せる', async () => {
    const c = container as HTMLElement;
    await loadFile(c);

    const fileInput = c.querySelector('input[type="file"]') as HTMLInputElement;
    const fileB = new File(['dummy'], 'b.csv', { type: 'text/csv' });
    dispatchFileToInput(fileInput, fileB);
    expect(dialogVisible()).toBe(true);

    const setCalls = spyOnValueSetter(fileInput);
    bodyButton(m.discard_candidates_stay()).click();
    flushSync();

    expect(setCalls).toContain('');
    expect(rowDates(c)).toEqual(['2026-01-10']);
    expect(c.textContent).toContain('選択中：a.csv');

    // input.value が本当にクリアされていなければ、同じファイルの再選択はここで無視される
    dispatchFileToInput(fileInput, fileB);
    expect(dialogVisible()).toBe(true);
  });

  test('確認すると行は破棄され、新しいファイルが解析される', async () => {
    const c = container as HTMLElement;
    await loadFile(c);

    dispatchCsvFile(c, 'b.csv');
    bodyButton(m.discard_candidates_discard()).click();
    await waitFor(() => (container as HTMLElement).textContent?.includes('選択中：b.csv') === true);

    expect(rowDates(c)).toEqual(['2026-01-10']);
    expect(c.textContent).toContain('選択中：b.csv');
  });

  test('行が無ければ確認なしで即座に解析される', async () => {
    const c = container as HTMLElement;
    await loadFile(c);
    expect(c.textContent).toContain('選択中：a.csv');
  });

  test('解析成功後は input.value がクリアされ、同じファイルを選び直せる', async () => {
    const c = container as HTMLElement;
    const fileInput = c.querySelector('input[type="file"]') as HTMLInputElement;
    const setCalls = spyOnValueSetter(fileInput);
    await loadFile(c);
    expect(setCalls).toContain('');
  });
});

describe('Import: キャンセル時の破棄確認', () => {
  test('候補がある状態でキャンセルすると確認ダイアログが出て、候補は表示されたまま', async () => {
    const c = container as HTMLElement;
    await loadFile(c);

    button(c, 'キャンセル').click();
    flushSync();

    expect(bodyButton(m.discard_candidates_discard())).not.toBeNull();
    expect(rowDates(c)).toEqual(['2026-01-10']);
  });

  test('ダイアログを閉じると候補は残ったまま', async () => {
    const c = container as HTMLElement;
    await loadFile(c);

    button(c, 'キャンセル').click();
    flushSync();
    bodyButton(m.discard_candidates_stay()).click();
    flushSync();

    expect(rowDates(c)).toEqual(['2026-01-10']);
  });

  test('確認すると候補が破棄される', async () => {
    const c = container as HTMLElement;
    await loadFile(c);

    button(c, 'キャンセル').click();
    flushSync();
    bodyButton(m.discard_candidates_discard()).click();
    flushSync();

    expect(rowDates(c)).toEqual([]);
  });
});

describe('Import: 相手科目セレクトの幅はバッジの有無で変わらない', () => {
  test('ルール命中の行にだけバッジが出て、select の幅クラスは両行で同じ・content 依存でない', async () => {
    await db.parserRules.add({
      id: 'rule-1',
      matchType: 'description-includes',
      pattern: 'ルール一致店',
      accountCode: '5200',
      priority: 1,
      hitCount: 0,
    });
    const c = container as HTMLElement;
    changeParser(c, parserC.name);
    await loadFile(c);

    expect(c.textContent).toContain('規則');

    const rows = Array.from(c.querySelectorAll('tbody tr'));
    expect(rows.length).toBe(2);
    const counterpartSelects = rows.map(
      (row) => row.querySelectorAll('td')[3]?.querySelector('select') as HTMLSelectElement,
    );
    const [withBadge, withoutBadge] = counterpartSelects;
    expect(withBadge?.className).toBe(withoutBadge?.className);
    expect(withBadge?.className).toMatch(/\bw-\d+\b/);
    expect(withBadge?.className).not.toContain('flex-1');
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

describe('shouldFillSuggestion: 相手科目の自動入力可否', () => {
  test('confidence が low の提案は行を埋める', () => {
    expect(shouldFillSuggestion({ accountCode: '5200', confidence: 'low' })).toBe(true);
  });

  test('confidence が none の提案は行を埋めない', () => {
    expect(shouldFillSuggestion({ accountCode: '5200', confidence: 'none' })).toBe(false);
  });

  test('confidence が high でも accountCode が無ければ埋めない', () => {
    expect(shouldFillSuggestion({ accountCode: null, confidence: 'high' })).toBe(false);
  });
});
// f) 41 行中 3 行が失敗する分類結果を投入し、失敗件数が画面文言に出ることを確認する。
describe('Import: LLM 分類の失敗件数表示', () => {
  test('41 行中 3 行が失敗すると失敗件数が表示される', async () => {
    const c = container as HTMLElement;
    changeParser(c, parserD.name);
    await loadFile(c);
    expect(rowDates(c)).toHaveLength(41);

    button(c, m.import_llm_button()).click();
    const expected = m.import_llm_status_failed({ failed: 3 });
    await waitFor(() => (c.textContent ?? '').includes(expected));
    expect(c.textContent).toContain(expected);
  });
});
