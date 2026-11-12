import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { db } from '../db/db';
import type { BackupPayload } from '../backup';
import { formatStoredAmount, parseLegacyLineAmount, readStoredAmount } from '../lib/amount-input';
import { toAmountString, toIndexable } from '../lib/decimal';
import { setSetting } from '../lib/settings';
import { m } from '../paraglide/messages';
import { checkStoredData, type DataCheckResult } from './data-check';
import { inspectBackupPayload, parseBackupJson, restoreFromPayload } from './restore';
import {
  BackupValidationError,
  journalLineProblem,
  validateBackupPayload,
} from './restore-validate';
import {
  exportCorrectionHistoryCsv,
  exportGenericCsv,
  exportYayoiCsv,
  exportYayoiCsvParts,
} from './accountant-export';
import { OversizedAmountsError } from './oversized-amounts';
import { InvalidStoredValuesError } from './stored-value-checks';

const ZERO_INDEX = '00000000000000.00';

function payload(tables: Record<string, unknown[]>): BackupPayload {
  return { version: 1, exportedAt: '2026-06-13T00:00:00.000Z', tables };
}

const entry = {
  id: 'e1',
  date: '2026-05-01',
  year: 2026,
  description: '旧い書き方の取引',
  status: 'confirmed',
  source: 'manual',
  createdAt: 1,
  confirmedAt: 1,
};

const line = {
  id: 'l1',
  entryId: 'e1',
  side: 'debit',
  accountCode: '5130',
  amount: '5000',
  amountIndexed: '00000000005000.00',
  taxRate: 0,
  taxIncluded: true,
  invoiceCompliant: false,
};

function lineWith(fields: Record<string, unknown>): Record<string, unknown> {
  return { ...line, ...fields };
}

function linePayload(fields: Record<string, unknown>): BackupPayload {
  return payload({ journalEntries: [entry], journalLines: [lineWith(fields)] });
}

function expectWithin1s(run: () => void): void {
  const started = performance.now();
  run();
  expect(performance.now() - started).toBeLessThan(1000);
}

function errorMessage(run: () => unknown): string {
  try {
    run();
  } catch (e) {
    return (e as Error).message;
  }
  return '';
}

const budget = { year: 2026, month: 1, revenueBudget: '100000', expenseBudget: '50000' };
const arAp = {
  id: 'ar1',
  type: 'receivable',
  description: '売掛',
  dueDate: '2026-06-30',
  originalAmount: '1000',
  paidAmount: '0',
  createdAt: 1,
};

function snapshot(sales: unknown): Record<string, unknown> {
  return {
    id: 'rs1',
    year: 2026,
    type: 'monthly-sales',
    status: 'draft',
    payload: { type: 'monthly-sales', data: { months: [{ month: 1, sales }] } },
    generatedAt: 1,
    generatedFromEntriesUpTo: '2026-12-31',
  };
}
// 表ごとに dec 欄へ値を入れた 1 行
const DEC_ROWS: [string, (v: unknown) => Record<string, unknown>][] = [
  ['budgets', (v) => ({ ...budget, revenueBudget: v })],
  ['arApEntries', (v) => ({ ...arAp, originalAmount: v })],
  ['reportSnapshots', snapshot],
];

beforeEach(async () => {
  await db.delete();
  await db.open();
});

afterEach(async () => {
  await db.delete();
});

describe('旧バージョンの仕訳明細の金額の書き方', () => {
  test.each([
    ['1e3', '1000'],
    ['.5e1', '5'],
    ['1.e3', '1000'],
    ['1000.', '1000'],
    ['.5', '0.5'],
    ['1E3', '1000'],
    ['1e+3', '1000'],
    ['1.5e3', '1500'],
  ])('%s は読めて、通常の表記では %s', (raw, plain) => {
    const parsed = parseLegacyLineAmount(raw);
    expect(parsed === undefined ? undefined : toAmountString(parsed)).toBe(plain);
    expect(journalLineProblem(lineWith({ amount: raw, amountIndexed: toIndexable(plain) }))).toBe(
      null,
    );
  });

  test.each([
    '+1000',
    '0X10',
    '0b1',
    '0o7',
    '0x10',
    '1_000',
    '0x1p3000',
    '-0',
    '-0x0',
    'NaN',
    'Infinity',
    ' 1000',
    '1,000',
    '１０００',
    '1e1001',
    '1e-1001',
    '1'.repeat(63) + 'e0',
  ])('%s は読まず、索引が合っていても復元を拒む', (raw) => {
    expect(parseLegacyLineAmount(raw)).toBeUndefined();
    const parsed = readStoredAmount(raw);
    const amountIndexed =
      parsed !== undefined && !parsed.isNegative() && parsed.lt('1e14')
        ? toIndexable(parsed)
        : ZERO_INDEX;
    expect(journalLineProblem(lineWith({ amount: raw, amountIndexed }))).toMatch(/^amount が/);
    expect(() => validateBackupPayload(linePayload({ amount: raw, amountIndexed }))).toThrow(
      BackupValidationError,
    );
  });

  test.each([1000, 0])('数値の %s は拒む', (raw) => {
    expect(journalLineProblem(lineWith({ amount: raw }))).toBe(
      'amount が非負の数値文字列ではありません：number',
    );
  });
});

describe('長い値や巨大な指数でも 1 秒以内に判定する', () => {
  test('数字が 10 万個続いたあとに x がある金額は、正規表現に通す前に長さで拒む', () => {
    const raw = '1'.repeat(1e5) + 'x';
    expectWithin1s(() => {
      expect(parseLegacyLineAmount(raw)).toBeUndefined();
      expect(() => validateBackupPayload(linePayload({ amount: raw }))).toThrow(/amount/);
    });
  });

  test('10 万桁の 16 進の金額は D() に渡す前に長さで拒む', () => {
    const raw = '0x' + 'f'.repeat(1e5);
    expectWithin1s(() => {
      expect(readStoredAmount(raw)).toBeUndefined();
      expect(formatStoredAmount(raw)).toBe(m.common_stored_amount_unreadable());
    });
  });

  test('10 万桁の通常の表記の金額は、復元の検証を通り、読む側では指数の範囲外として扱う', () => {
    const raw = '1' + '0'.repeat(1e5);
    expectWithin1s(() => {
      expect(journalLineProblem(lineWith({ amount: raw }))).toBe(null);
      expect(formatStoredAmount(raw)).toBe(m.common_stored_amount_unreadable());
    });
  });

  test.each(DEC_ROWS)('%s の数値欄の 10 万桁の 16 進は 1 秒以内に拒む', (table, row) => {
    expectWithin1s(() => {
      expect(() =>
        validateBackupPayload(payload({ [table]: [row('0x' + 'f'.repeat(1e5))] })),
      ).toThrow(BackupValidationError);
    });
  });
});

describe('明細以外の数値欄（dec）の読み方', () => {
  const accepted = ['-5', '1e3', '1.234567890123456789012345678e+37', '100000'];
  const rejected = ['1e1001', '1e999999999', '0x1p99999999', 'abc', ''];

  for (const [table, row] of DEC_ROWS) {
    test.each(accepted)(`${table} の %j は通す`, (v) => {
      expect(() => validateBackupPayload(payload({ [table]: [row(v)] }))).not.toThrow();
    });

    test.each(rejected)(`${table} の %j は拒む`, (v) => {
      expect(() => validateBackupPayload(payload({ [table]: [row(v)] }))).toThrow(
        BackupValidationError,
      );
    });
  }
});

describe('通常の表記以外の金額と索引の突き合わせ', () => {
  test.each([
    ['1e3', '00000000001000.00'],
    ['1e15', '1000000000000000.00'],
    ['1.005e0', '00000000000001.01'],
    ['1e-7', ZERO_INDEX],
  ])('%s と %s は一致するので通す', (amount, amountIndexed) => {
    expect(journalLineProblem(lineWith({ amount, amountIndexed }))).toBe(null);
  });

  test.each([
    ['1e3', '00000000005000.00'],
    ['1e3', '1000.00'],
    ['1e15', '100000000000000.00'],
    ['1.005e0', '00000000000001.00'],
  ])('%s と %s は一致しないので拒む', (amount, amountIndexed) => {
    expect(journalLineProblem(lineWith({ amount, amountIndexed }))).toMatch(
      /^amountIndexed が amount と一致しません/,
    );
  });

  test('通常の表記の金額は索引の値を突き合わせない（形式だけ見る）', () => {
    expect(
      journalLineProblem(lineWith({ amount: '1000', amountIndexed: '00000000005000.00' })),
    ).toBe(null);
  });
});

describe('課税資産の譲渡等の対価', () => {
  test.each(['1e3', '.5', '1000'])('%j は通す', (v) => {
    expect(journalLineProblem(lineWith({ taxableTransferConsideration: v }))).toBe(null);
  });

  test.each(['abc', null, 1000, '-5', '0x10', '1'.repeat(63) + 'e0'])('%j は拒む', (v) => {
    expect(journalLineProblem(lineWith({ taxableTransferConsideration: v }))).toMatch(
      /^taxableTransferConsideration が/,
    );
  });

  test('10 万桁の 16 進の対価は 1 秒以内に拒む', () => {
    expectWithin1s(() => {
      expect(
        journalLineProblem(lineWith({ taxableTransferConsideration: '0x' + 'f'.repeat(1e5) })),
      ).toMatch(/^taxableTransferConsideration が/);
    });
  });

  test('欄が無い明細と undefined の明細は通す', () => {
    expect(journalLineProblem(line)).toBe(null);
    expect(journalLineProblem(lineWith({ taxableTransferConsideration: undefined }))).toBe(null);
  });
});

describe('プロトタイプの欄', () => {
  test('プロトタイプにある金額は読まない', () => {
    const { amount: _amount, amountIndexed: _index, ...rest } = line;
    const row = Object.assign(
      Object.create({ amount: '1e3', amountIndexed: '00000000001000.00' }) as object,
      rest,
    );
    expect(journalLineProblem(row)).toBe('amount が非負の数値文字列ではありません：undefined');
  });

  test('明細の行に __proto__ という名前の欄があれば復元を拒む', () => {
    const text = JSON.stringify(payload({ journalEntries: [entry], journalLines: [line] })).replace(
      '"id":"l1"',
      '"id":"l1","__proto__":{"amount":"1e3"}',
    );
    expect(() => validateBackupPayload(JSON.parse(text) as BackupPayload)).toThrow(
      '行に __proto__ という名前の欄があります',
    );
  });

  test('tables に __proto__ という名前の表があれば復元を拒む', () => {
    const text =
      '{"version":1,"exportedAt":"2026-06-13T00:00:00.000Z","tables":{"__proto__":[{"id":"l1","amount":"1e3"}]}}';
    expect(() => validateBackupPayload(JSON.parse(text) as BackupPayload)).toThrow(
      m.error_backup_not_backup_format(),
    );
  });
});

describe('エラー文に載せる値', () => {
  test('数 MB の金額でも先頭 40 文字だけを載せる', () => {
    const raw = 'x' + 'y'.repeat(3_000_000);
    const message = errorMessage(() => validateBackupPayload(linePayload({ amount: raw })));
    expect(message).toContain('x' + 'y'.repeat(39) + '…');
    expect(message).not.toContain('y'.repeat(40));
  });

  test('サロゲートペアの途中で切らない', () => {
    const raw = '𠮷'.repeat(50);
    const message = errorMessage(() =>
      validateBackupPayload(linePayload({ taxableTransferConsideration: raw })),
    );
    expect(message).toContain('𠮷'.repeat(40) + '…');
    expect(message).not.toMatch(
      /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/,
    );
  });
});

async function seedEntry(id: string, opts: { status?: string; originalEntryId?: string } = {}) {
  await db.table('journalEntries').put({
    ...entry,
    id,
    date: '2026-03-01',
    status: opts.status ?? 'confirmed',
    ...(opts.originalEntryId === undefined ? {} : { originalEntryId: opts.originalEntryId }),
  });
}

async function seedLine(id: string, entryId: string, fields: Record<string, unknown>) {
  await db.table('journalLines').put({ ...line, id, entryId, ...fields });
}

function samples(result: DataCheckResult, table: string): string[] {
  return result.tables.find((t) => t.table === table)?.samples ?? [];
}

describe('保存データの点検で金額を確かめる', () => {
  test('索引の合った 1e3 は挙げず、点検は値を書き換えない', async () => {
    await seedEntry('e1');
    await seedLine('l1', 'e1', { amount: '1e3', amountIndexed: '00000000001000.00' });
    const result = await checkStoredData();
    expect(result.total).toBe(0);
    expect((await db.journalLines.get('l1'))?.amount).toBe('1e3');
  });

  test('集計に入る仕訳の 100 兆円以上の金額と対価は日付付きで挙げる', async () => {
    await seedEntry('e1');
    await seedLine('l1', 'e1', { amount: '100000000000000', amountIndexed: '100000000000000.00' });
    await seedLine('l2', 'e1', { taxableTransferConsideration: '100000000000000' });
    const result = await checkStoredData();
    expect(samples(result, 'journalLines')).toEqual([
      'l1：amount が 100 兆円以上です（2026-03-01 の仕訳）：「100000000000000」',
      'l2：taxableTransferConsideration が 100 兆円以上です（2026-03-01 の仕訳）：「100000000000000」',
    ]);
  });

  test('打ち消した仕訳と打消し仕訳の 100 兆円以上は挙げない', async () => {
    await seedEntry('e1', { status: 'reversed' });
    await seedEntry('e2', { originalEntryId: 'e1' });
    await seedLine('l1', 'e1', { amount: '100000000000000' });
    await seedLine('l2', 'e2', { taxableTransferConsideration: '100000000000000' });
    expect((await checkStoredData()).total).toBe(0);
  });

  test('読めない金額と対価は、打ち消した仕訳でも挙げる', async () => {
    await seedEntry('e1', { status: 'reversed' });
    await seedLine('l1', 'e1', { amount: '1' + '0'.repeat(1500) });
    await seedLine('l2', 'e1', { taxableTransferConsideration: '1' + '0'.repeat(1500) });
    const found = samples(await checkStoredData(), 'journalLines');
    expect(found).toHaveLength(2);
    expect(found[0]).toMatch(/^l1：amount を金額として読めません（2026-03-01 の仕訳）：「1000/);
    expect(found[1]).toMatch(/^l2：taxableTransferConsideration を金額として読めません/);
  });

  test('取得価額が 100 兆円以上の固定資産を挙げ、それ未満は挙げない', async () => {
    await db.table('fixedAssets').bulkPut([
      { id: 'fa1', acquisitionCost: '100000000000000' },
      { id: 'fa2', acquisitionCost: '99999999999999' },
    ]);
    const result = await checkStoredData();
    expect(samples(result, 'fixedAssets')).toEqual([
      'fa1：acquisitionCost が 100 兆円以上です：「100000000000000」',
    ]);
  });

  test('保存済みの 10 万桁の 16 進や 10 万桁の数字も 1 秒以内に挙げる', async () => {
    await seedEntry('e1');
    await seedLine('l1', 'e1', { amount: '0x' + 'f'.repeat(1e5) });
    await seedLine('l2', 'e1', { amount: '1' + '0'.repeat(1e5) });
    await db.table('budgets').put({ ...budget, revenueBudget: '0x' + 'f'.repeat(1e5) });
    await db.table('arApEntries').put({ ...arAp, originalAmount: '0x' + 'f'.repeat(1e5) });
    await db.table('reportSnapshots').put(snapshot('0x' + 'f'.repeat(1e5)));
    const started = performance.now();
    const result = await checkStoredData();
    expect(performance.now() - started).toBeLessThan(1000);
    expect(result.total).toBe(5);
  });
});

describe('復元したあとに保存される金額', () => {
  test('旧い書き方は通常の表記で保存し、通常の表記と索引はそのまま、渡した payload は変えない', async () => {
    const source = payload({
      journalEntries: [entry],
      journalLines: [
        lineWith({ id: 'l1', amount: '1e3', amountIndexed: '00000000001000.00' }),
        lineWith({
          id: 'l2',
          amount: '.5',
          amountIndexed: '00000000000000.50',
          taxableTransferConsideration: '1.5e3',
        }),
        lineWith({ id: 'l3', amount: '0100', amountIndexed: '00000000000100.00' }),
        lineWith({ id: 'l4', amount: '1.50', amountIndexed: '00000000000001.50' }),
      ],
    });
    const before = structuredClone(source);
    const { copy, parts } = inspectBackupPayload(source);
    expect(source).toEqual(before);
    expect(copy).not.toBe(source);
    await restoreFromPayload(source, new Map(), new Set(parts));
    expect(source).toEqual(before);
    const lines = await db.journalLines.orderBy('id').toArray();
    expect(lines.map((l) => [l.amount, l.amountIndexed, l.taxableTransferConsideration])).toEqual([
      ['1000', '00000000001000.00', undefined],
      ['0.5', '00000000000000.50', '1500'],
      ['0100', '00000000000100.00', undefined],
      ['1.50', '00000000000001.50', undefined],
    ]);
    expect((await checkStoredData()).total).toBe(0);
  });

  test('1e14 以上の旧い書き方は戻せて、通常の表記で保存され、点検に出る', async () => {
    await restoreFromPayload(
      linePayload({ amount: '1e15', amountIndexed: '1000000000000000.00' }),
      new Map(),
      new Set(['books']),
    );
    expect((await db.journalLines.get('l1'))?.amount).toBe('1000000000000000');
    expect(samples(await checkStoredData(), 'journalLines')).toEqual([
      'l1：amount が 100 兆円以上です（2026-05-01 の仕訳）：「1000000000000000」',
    ]);
  });

  test('拒むバックアップは既存のデータを消さない', async () => {
    await seedEntry('keep');
    await seedLine('keep-l', 'keep', {});
    await expect(
      restoreFromPayload(linePayload({ amount: '0x10' }), new Map(), new Set(['books'])),
    ).rejects.toThrow(BackupValidationError);
    expect(await db.journalLines.get('keep-l')).toBeDefined();
  });

  test('version 1 の JSON バックアップ（指数の書き方の金額を含む）を戻せる', async () => {
    const text = JSON.stringify({
      version: 1,
      exportedAt: '2026-01-10T00:00:00.000Z',
      tables: {
        journalEntries: [entry],
        journalLines: [
          lineWith({ id: 'l1', amount: '2.5e4', amountIndexed: '00000000025000.00' }),
          lineWith({
            id: 'l2',
            side: 'credit',
            amount: '25000',
            amountIndexed: '00000000025000.00',
          }),
        ],
      },
    });
    const parsed = parseBackupJson(text);
    expect(inspectBackupPayload(parsed).parts).toContain('books');
    await restoreFromPayload(parsed, new Map(), new Set(inspectBackupPayload(parsed).parts));
    expect((await db.journalLines.orderBy('id').toArray()).map((l) => l.amount)).toEqual([
      '25000',
      '25000',
    ]);
  });
});

describe('書き出しの前に止める', () => {
  test('100 兆円以上の明細があれば、弥生（分割）・弥生・汎用 CSV は止まる', async () => {
    await seedEntry('e1');
    await seedLine('l1', 'e1', { amount: '100000000000000', amountIndexed: '100000000000000.00' });
    await expect(exportYayoiCsvParts(2026)).rejects.toThrow(OversizedAmountsError);
    await expect(exportYayoiCsv(2026)).rejects.toThrow(OversizedAmountsError);
    await expect(exportGenericCsv(2026)).rejects.toThrow(OversizedAmountsError);
  });

  test('読めない対価があれば、弥生（分割）CSV は止まる', async () => {
    await seedEntry('e1');
    await seedLine('l1', 'e1', { taxableTransferConsideration: '1' + '0'.repeat(1500) });
    await expect(exportYayoiCsvParts(2026)).rejects.toThrow(OversizedAmountsError);
  });

  test('消費税の設定に読めない値があれば、弥生（分割）CSV は設定名を示して止まる', async () => {
    await setSetting('basePeriodTaxableSales', 20000000 as unknown as string);
    await expect(exportYayoiCsvParts(2026)).rejects.toThrow(InvalidStoredValuesError);
    await expect(exportYayoiCsvParts(2026)).rejects.toThrow('基準期間');
  });

  test('訂正履歴 CSV は、年度が範囲外の原仕訳に読めない金額があれば止まる', async () => {
    await db.table('journalEntries').bulkPut([
      { ...entry, id: 'orig', date: '', year: 0, status: 'reversed', reversedByEntryId: 'rev' },
      { ...entry, id: 'rev', date: '2026-04-01', year: 2026, originalEntryId: 'orig' },
    ]);
    await seedLine('orig-l', 'orig', { amount: '1' + '0'.repeat(1500) });
    await seedLine('rev-l', 'rev', { side: 'credit' });
    const error = await exportCorrectionHistoryCsv(2026).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(OversizedAmountsError);
    expect((error as Error).message).toContain(
      m.reversed_amounts_unreadable({ count: 1, items: '' }),
    );
  });

  test('訂正履歴 CSV は、打ち消した原仕訳の 100 兆円以上では止まらない', async () => {
    await seedEntry('e1', { status: 'reversed' });
    await seedLine('l1', 'e1', { amount: '100000000000000' });
    await expect(exportCorrectionHistoryCsv(2026)).resolves.toBeInstanceOf(Uint8Array);
  });
});
