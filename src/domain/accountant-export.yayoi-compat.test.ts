import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import Encoding from 'encoding-japanese';
import { db } from '../db/db';
import { parseCsv } from '../lib/csv';
import { D, toIndexable } from '../lib/decimal';
import { buildYayoiCsvRows, exportYayoiCsv, exportYayoiCsvParts } from './accountant-export';
import type { Account, JournalEntry, JournalLine, SubAccount } from '../db/types';

const ACCOUNTS: Account[] = [
  { code: '1130', year: 2026, name: '普通預金', category: 'asset', displayOrder: 130 },
  { code: '1510', year: 2026, name: '工具器具備品', category: 'asset', displayOrder: 510 },
  { code: '1610', year: 2026, name: '事業主貸', category: 'asset', displayOrder: 610 },
  { code: '2110', year: 2026, name: '買掛金', category: 'liability', displayOrder: 110 },
  { code: '3110', year: 2026, name: '元入金', category: 'equity', displayOrder: 110 },
  { code: '4110', year: 2026, name: '売上高', category: 'revenue', displayOrder: 110 },
  { code: '5130', year: 2026, name: '水道光熱費', category: 'expense', displayOrder: 130 },
];

const GENERAL = { taxFilingMethod: 'general' as const, simplifiedTaxCategory: 4 as const };
const SIMPLIFIED = { taxFilingMethod: 'simplified' as const, simplifiedTaxCategory: 4 as const };

function entry(overrides: Partial<JournalEntry> & { id: string; date: string }): JournalEntry {
  return {
    description: 'テスト仕訳',
    status: 'confirmed',
    source: 'manual',
    createdAt: 0,
    confirmedAt: 0,
    year: Number(overrides.date.slice(0, 4)),
    ...overrides,
  };
}

function line(overrides: Partial<JournalLine> & { id: string; entryId: string }): JournalLine {
  const amount = overrides.amount ?? '1000';
  return {
    side: 'debit',
    accountCode: '1130',
    amountIndexed: toIndexable(amount),
    taxRate: 0,
    taxIncluded: true,
    invoiceCompliant: false,
    ...overrides,
    amount,
  };
}
function singleRow(
  debit: Partial<JournalLine>,
  credit: Partial<JournalLine> = {},
  ctx: typeof GENERAL | typeof SIMPLIFIED = GENERAL,
  subAccounts: SubAccount[] = [],
  description = 'テスト仕訳',
): string[] {
  const rows = buildYayoiCsvRows(
    [entry({ id: 'e1', date: '2026-04-15', description })],
    [
      line({ id: 'd', entryId: 'e1', side: 'debit', accountCode: '5130', ...debit }),
      line({ id: 'c', entryId: 'e1', side: 'credit', accountCode: '1130', ...credit }),
    ],
    ACCOUNTS,
    subAccounts,
    ctx,
  );
  expect(rows).toHaveLength(1);
  return rows[0]!;
}

function decodeSjis(bytes: Uint8Array): string {
  return Encoding.convert(Array.from(bytes), { to: 'UNICODE', from: 'SJIS', type: 'string' });
}

function physicalLines(bytes: Uint8Array): string[] {
  const text = decodeSjis(bytes);
  expect(text.endsWith('\r\n')).toBe(true);
  return text.slice(0, -2).split('\r\n');
}

describe('弥生形式：行数が違う側の空欄', () => {
  test('借方 1 行・貸方 2 行の 2 列目は、借方の税区分が対象外・金額が 0・科目が空欄', () => {
    const rows = buildYayoiCsvRows(
      [entry({ id: 'e1', date: '2026-04-15' })],
      [
        line({ id: 'l1', entryId: 'e1', side: 'debit', accountCode: '1130', amount: '5000' }),
        line({ id: 'l2', entryId: 'e1', side: 'credit', accountCode: '4110', amount: '3000' }),
        line({ id: 'l3', entryId: 'e1', side: 'credit', accountCode: '4110', amount: '2000' }),
      ],
      ACCOUNTS,
      [],
      GENERAL,
    );
    expect(rows).toHaveLength(2);
    const second = rows[1]!;
    expect(second[4]).toBe('');
    expect(second[5]).toBe('');
    expect(second[6]).toBe('');
    expect(second[7]).toBe('対象外');
    expect(second[8]).toBe('0');
    expect(second[9]).toBe('');
    expect(second[13]).toBe('対象外');
    expect(second[14]).toBe('2000');
  });
});

describe('弥生形式：輸入消費税', () => {
  test('本則課税で用途区分の指定が無い 10% 分は課対輸税7.8%、税額は空欄', () => {
    const row = singleRow({ amount: '780', taxCategory: 'importTax10' }, { amount: '780' });
    expect(row[7]).toBe('課対輸税7.8%');
    expect(row[9]).toBe('');
  });

  test('本則課税で共通対応の 8% 分は共対輸税軽減6.24%', () => {
    const row = singleRow({ taxCategory: 'importTax8', inputUsageCategory: 'common' });
    expect(row[7]).toBe('共対輸税軽減6.24%');
    expect(row[9]).toBe('');
  });

  test('本則課税で非課税売上対応の 10% 分は非対輸税7.8%', () => {
    const row = singleRow({ taxCategory: 'importTax10', inputUsageCategory: 'nonTaxableOnly' });
    expect(row[7]).toBe('非対輸税7.8%');
  });

  test('簡易課税では用途区分が共通対応でも課対輸税7.8%', () => {
    const row = singleRow(
      { taxCategory: 'importTax10', inputUsageCategory: 'common' },
      {},
      SIMPLIFIED,
    );
    expect(row[7]).toBe('課対輸税7.8%');
  });
});

describe('弥生形式：仕入の用途区分と仕入に数えない行', () => {
  const taxed10 = { taxRate: 0.1, invoiceCompliant: true, amount: '1100' } as const;

  test('簡易課税では共通対応の課税仕入も課対仕入、本則課税では共対仕入', () => {
    const simplified = singleRow({ ...taxed10, inputUsageCategory: 'common' }, {}, SIMPLIFIED);
    expect(simplified[7]).toBe('課対仕入込10%適格');
    const general = singleRow({ ...taxed10, inputUsageCategory: 'common' });
    expect(general[7]).toBe('共対仕入込10%適格');
  });

  test('費用科目で税率 0・非課税の行は対象外', () => {
    const row = singleRow({ taxRate: 0, taxCategory: 'exempt' });
    expect(row[7]).toBe('対象外');
    expect(row[9]).toBe('');
  });

  test('買掛金（負債）の貸方 10% は対象外で税額は空欄', () => {
    const row = singleRow({ ...taxed10 }, { ...taxed10, accountCode: '2110' });
    expect(row[13]).toBe('対象外');
    expect(row[15]).toBe('');
  });

  test('資産の貸方 10% は対象外', () => {
    const row = singleRow({ ...taxed10 }, { ...taxed10, accountCode: '1510' });
    expect(row[13]).toBe('対象外');
    expect(row[15]).toBe('');
  });

  test('事業主貸の借方 10% は対象外', () => {
    const row = singleRow({ ...taxed10, accountCode: '1610' });
    expect(row[7]).toBe('対象外');
    expect(row[9]).toBe('');
  });

  test('費用の借方 10% はこれまでどおり課税仕入', () => {
    const row = singleRow({ ...taxed10 });
    expect(row[7]).toBe('課対仕入込10%適格');
    expect(row[9]).toBe('100');
  });
});

describe('弥生形式：区切り文字と改行', () => {
  test('摘要と補助科目名の半角カンマは全角に変わる', () => {
    const row = singleRow(
      { subAccountId: 's1' },
      {},
      GENERAL,
      [{ id: 's1', accountCode: '5130', name: 'x,y' }],
      'A,B',
    );
    expect(row[16]).toBe('A，B');
    expect(row[5]).toBe('x，y');
  });

  test('摘要の改行とタブは半角空白に変わる', () => {
    const row = singleRow({}, {}, GENERAL, [], 'A\r\nB\tC\nD');
    expect(row[16]).toBe('A  B C D');
  });
});

describe('弥生形式：ファイルの分割と書き出し後の注意', { timeout: 30_000 }, () => {
  beforeEach(async () => {
    await db.delete();
    await db.open();
    await db.accounts.bulkAdd(ACCOUNTS);
  });

  afterEach(async () => {
    await db.delete();
  });

  function id(n: number): string {
    return `e${String(n).padStart(5, '0')}`;
  }

  async function seedSingles(count: number, description = 'テスト仕訳'): Promise<void> {
    const entries: JournalEntry[] = [];
    const lines: JournalLine[] = [];
    for (let n = 1; n <= count; n++) {
      entries.push(entry({ id: id(n), date: '2026-04-15', description }));
      lines.push(
        line({ id: `${id(n)}d`, entryId: id(n), side: 'debit', accountCode: '5130' }),
        line({ id: `${id(n)}c`, entryId: id(n), side: 'credit', accountCode: '1130' }),
      );
    }
    await db.journalEntries.bulkAdd(entries);
    await db.journalLines.bulkAdd(lines);
  }

  async function seedMulti(
    n: number,
    debitCount: number,
    opts: { description?: string; debitAccount?: string; amount?: string } = {},
  ): Promise<void> {
    const amount = opts.amount ?? '1000';
    await db.journalEntries.add(
      entry({ id: id(n), date: '2026-05-01', description: opts.description ?? '複合仕訳' }),
    );
    const lines: JournalLine[] = [];
    for (let i = 0; i < debitCount; i++) {
      lines.push(
        line({
          id: `${id(n)}d${i}`,
          entryId: id(n),
          side: 'debit',
          accountCode: opts.debitAccount ?? '5130',
          amount,
        }),
      );
    }
    lines.push(
      line({
        id: `${id(n)}c`,
        entryId: id(n),
        side: 'credit',
        accountCode: '1130',
        amount: D(amount).times(debitCount).toFixed(0),
      }),
    );
    await db.journalLines.bulkAdd(lines);
  }

  async function allRows(): Promise<string[][]> {
    const entries = await db.journalEntries.where('year').equals(2026).toArray();
    const lines = await db.journalLines.toArray();
    return buildYayoiCsvRows(entries, lines, ACCOUNTS, [], GENERAL);
  }

  function concat(parts: Uint8Array[]): Uint8Array {
    const out = new Uint8Array(parts.reduce((sum, p) => sum + p.length, 0));
    let offset = 0;
    for (const p of parts) {
      out.set(p, offset);
      offset += p.length;
    }
    return out;
  }

  test('物理行の数は列の数と同じで、どの行も 25 項目', async () => {
    await seedSingles(2, '改行\nを含む,摘要');
    await db.subAccounts.add({ id: 's1', accountCode: '5130', name: 'a\r\nb,c' });
    await db.journalLines.update('e00001d', { subAccountId: 's1' });

    const lines = physicalLines(await exportYayoiCsv(2026));
    expect(lines).toHaveLength((await allRows()).length);
    expect(lines).toHaveLength(2);
    for (const l of lines) {
      expect(l.split(',')).toHaveLength(25);
    }
  });

  test('1001 件の 1 列の仕訳は 1000 列と 1 列の 2 ファイルになる', async () => {
    await seedSingles(1001);

    const { parts } = await exportYayoiCsvParts(2026);
    expect(parts.map((p) => physicalLines(p).length)).toEqual([1000, 1]);
  });

  test('998 件の 1 列の仕訳の後の 3 列の仕訳は、まるごと 2 つ目のファイルに入る', async () => {
    await seedSingles(998);
    await seedMulti(999, 3);

    const { parts } = await exportYayoiCsvParts(2026);
    expect(parts).toHaveLength(2);
    expect(physicalLines(parts[0]!)).toHaveLength(998);
    const second = parseCsv(decodeSjis(parts[1]!));
    expect(second.map((r) => r[0])).toEqual(['2110', '2100', '2101']);
    expect(second.every((r) => r[16] === '複合仕訳')).toBe(true);
  });

  test('摘要が長くバイト数が先に上限に達すると、バイト数で分割する', async () => {
    await seedSingles(600, 'あ'.repeat(1100));

    const { parts } = await exportYayoiCsvParts(2026);
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) {
      expect(p.length).toBeLessThanOrEqual(1_000_000);
      expect(physicalLines(p).length).toBeLessThan(1000);
    }
    const joined = parts.flatMap((p) => parseCsv(decodeSjis(p)));
    expect(joined).toEqual(await allRows());
    expect(concat(parts)).toEqual(await exportYayoiCsv(2026));
  });

  test('分割した列をつなぐと、分割前の列と同じ順で同じ内容になる', async () => {
    await seedSingles(998);
    await seedMulti(999, 3);

    const { parts } = await exportYayoiCsvParts(2026);
    const joined = parts.flatMap((p) => parseCsv(decodeSjis(p)));
    expect(joined).toEqual(await allRows());
    expect(concat(parts)).toEqual(await exportYayoiCsv(2026));
  });

  test('1000 列以内なら 1 ファイルで、中身は exportYayoiCsv と同じ', async () => {
    await seedSingles(1000);

    const { parts } = await exportYayoiCsvParts(2026);
    expect(parts).toHaveLength(1);
    expect(parts[0]).toEqual(await exportYayoiCsv(2026));
  });

  test('仕訳が無い年度はファイルを作らない', async () => {
    const { parts, notices } = await exportYayoiCsvParts(2026);
    expect(parts).toEqual([]);
    expect(notices).toEqual([]);
  });

  test('借方 21 行の仕訳は列数の注意に載り、20 行の仕訳は載らない', async () => {
    await seedMulti(1, 21, { description: '21行' });
    await seedMulti(2, 20, { description: '20行' });

    const { notices } = await exportYayoiCsvParts(2026);
    expect(notices).toEqual([
      { date: '2026-05-01', description: '21行', rows: 21, reasons: ['rows'] },
    ]);
  });

  test('元入金を含む仕訳は元入金の注意に載る', async () => {
    await seedMulti(1, 1, { description: '元入れ', debitAccount: '3110' });

    const { notices } = await exportYayoiCsvParts(2026);
    expect(notices).toEqual([
      { date: '2026-05-01', description: '元入れ', rows: 1, reasons: ['capital'] },
    ]);
  });

  test('金額が 10 桁の仕訳は金額の注意に載り、9 桁の仕訳は載らない', async () => {
    await seedMulti(1, 1, { description: '10桁', amount: '1000000000' });
    await seedMulti(2, 1, { description: '9桁', amount: '999999999' });

    const { notices } = await exportYayoiCsvParts(2026);
    expect(notices).toEqual([
      { date: '2026-05-01', description: '10桁', rows: 1, reasons: ['amount'] },
    ]);
  });
});
