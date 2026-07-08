import { describe, expect, test } from 'vitest';
import Encoding from 'encoding-japanese';
import { toIndexable } from '../lib/decimal';
import {
  buildCorrectionHistoryRows,
  buildGenericCsvRows,
  buildYayoiCsvRows,
  encodeShiftJis,
} from './accountant-export';
import type { Account, JournalEntry, JournalLine, SubAccount } from './../db/types';

const ACCOUNTS: Account[] = [
  { code: '1130', year: 2026, name: '普通預金', category: 'asset', displayOrder: 130 },
  { code: '4110', year: 2026, name: '売上高', category: 'revenue', displayOrder: 110 },
  { code: '5130', year: 2026, name: '水道光熱費', category: 'expense', displayOrder: 130 },
  { code: '5150', year: 2026, name: '通信費', category: 'expense', displayOrder: 150 },
];

const SUB_ACCOUNTS: SubAccount[] = [{ id: 'sub1', accountCode: '5130', name: '本店' }];

const CTX = { taxFilingMethod: 'general' as const, simplifiedTaxCategory: 4 as const };

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
  return {
    side: 'debit',
    accountCode: '1130',
    amount: '1000',
    amountIndexed: toIndexable('1000'),
    taxRate: 0,
    taxIncluded: true,
    invoiceCompliant: false,
    ...overrides,
  };
}

describe('buildYayoiCsvRows', () => {
  test('単純な借方1行・貸方1行の仕訳は識別フラグ2000で1行になる', () => {
    const entries = [entry({ id: 'e1', date: '2026-04-15', description: '電気代' })];
    const lines = [
      line({ id: 'l1', entryId: 'e1', side: 'debit', accountCode: '5130', amount: '3000' }),
      line({ id: 'l2', entryId: 'e1', side: 'credit', accountCode: '1130', amount: '3000' }),
    ];
    const rows = buildYayoiCsvRows(entries, lines, ACCOUNTS, [], CTX);
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row[0]).toBe('2000');
    expect(row[3]).toBe('2026/04/15');
    expect(row[4]).toBe('水道光熱費');
    expect(row[8]).toBe('3000');
    expect(row[10]).toBe('普通預金');
    expect(row[14]).toBe('3000');
    expect(row[16]).toBe('電気代');
    expect(row[19]).toBe('0');
  });

  test('複数貸方行を持つ仕訳は振替伝票形式（2110/2101）に分割される', () => {
    const entries = [entry({ id: 'e1', date: '2026-04-15' })];
    const lines = [
      line({ id: 'l1', entryId: 'e1', side: 'debit', accountCode: '1130', amount: '5000' }),
      line({ id: 'l2', entryId: 'e1', side: 'credit', accountCode: '4110', amount: '3000' }),
      line({ id: 'l3', entryId: 'e1', side: 'credit', accountCode: '5130', amount: '2000' }),
    ];
    const rows = buildYayoiCsvRows(entries, lines, ACCOUNTS, [], CTX);
    expect(rows).toHaveLength(2);
    expect(rows[0]![0]).toBe('2110');
    expect(rows[1]![0]).toBe('2101');
    expect(rows[0]![19]).toBe('3');
    expect(rows[0]![10]).toBe('売上高');
    expect(rows[1]![10]).toBe('水道光熱費');
    // 借方は1行しかないため2行目は空欄
    expect(rows[1]![4]).toBe('');
  });

  test('訂正済みペア（原仕訳・訂正仕訳）は除外される', () => {
    const entries = [
      entry({ id: 'e1', date: '2026-04-15', status: 'reversed', reversedByEntryId: 'e2' }),
      entry({ id: 'e2', date: '2026-04-16', originalEntryId: 'e1' }),
      entry({ id: 'e3', date: '2026-04-17', description: '有効な仕訳' }),
    ];
    const lines = [
      line({ id: 'l1', entryId: 'e1', side: 'debit', accountCode: '5130', amount: '1000' }),
      line({ id: 'l2', entryId: 'e1', side: 'credit', accountCode: '1130', amount: '1000' }),
      line({ id: 'l3', entryId: 'e2', side: 'credit', accountCode: '5130', amount: '1000' }),
      line({ id: 'l4', entryId: 'e2', side: 'debit', accountCode: '1130', amount: '1000' }),
      line({ id: 'l5', entryId: 'e3', side: 'debit', accountCode: '5130', amount: '500' }),
      line({ id: 'l6', entryId: 'e3', side: 'credit', accountCode: '1130', amount: '500' }),
    ];
    const rows = buildYayoiCsvRows(entries, lines, ACCOUNTS, [], CTX);
    expect(rows).toHaveLength(1);
    expect(rows[0]![16]).toBe('有効な仕訳');
  });

  test('部門タグは借方・貸方両方の部門欄に出力される', () => {
    const entries = [entry({ id: 'e1', date: '2026-04-15', department: '本店' })];
    const lines = [
      line({ id: 'l1', entryId: 'e1', side: 'debit', accountCode: '5130', amount: '1000' }),
      line({ id: 'l2', entryId: 'e1', side: 'credit', accountCode: '1130', amount: '1000' }),
    ];
    const rows = buildYayoiCsvRows(entries, lines, ACCOUNTS, [], CTX);
    expect(rows[0]![6]).toBe('本店');
    expect(rows[0]![12]).toBe('本店');
  });

  test('補助科目は該当欄に出力される', () => {
    const entries = [entry({ id: 'e1', date: '2026-04-15' })];
    const lines = [
      line({
        id: 'l1',
        entryId: 'e1',
        side: 'debit',
        accountCode: '5130',
        amount: '1000',
        subAccountId: 'sub1',
      }),
      line({ id: 'l2', entryId: 'e1', side: 'credit', accountCode: '1130', amount: '1000' }),
    ];
    const rows = buildYayoiCsvRows(entries, lines, ACCOUNTS, SUB_ACCOUNTS, CTX);
    expect(rows[0]![5]).toBe('本店');
  });

  test('課税売上（税込10%）の税区分・税金額を計算する', () => {
    const entries = [entry({ id: 'e1', date: '2026-04-15' })];
    const lines = [
      line({ id: 'l1', entryId: 'e1', side: 'debit', accountCode: '1130', amount: '11000' }),
      line({
        id: 'l2',
        entryId: 'e1',
        side: 'credit',
        accountCode: '4110',
        amount: '11000',
        taxRate: 0.1,
        taxIncluded: true,
      }),
    ];
    const rows = buildYayoiCsvRows(entries, lines, ACCOUNTS, [], CTX);
    expect(rows[0]![13]).toBe('課税売上込10%');
    expect(rows[0]![15]).toBe('1000');
  });

  test('軽減税率8%の課税仕入（インボイス非適格）は経過措置控除率が付与される', () => {
    const entries = [entry({ id: 'e1', date: '2026-04-15' })];
    const lines = [
      line({
        id: 'l1',
        entryId: 'e1',
        side: 'debit',
        accountCode: '5130',
        amount: '1080',
        taxRate: 0.08,
        taxIncluded: true,
        invoiceCompliant: false,
      }),
      line({ id: 'l2', entryId: 'e1', side: 'credit', accountCode: '1130', amount: '1080' }),
    ];
    // 2026-04-15 は 2026/10 の 70% フェーズ前 → 経過措置控除率 80%
    const rows = buildYayoiCsvRows(entries, lines, ACCOUNTS, [], CTX);
    expect(rows[0]![7]).toBe('課対仕入込軽減8%区分80%');
  });

  test('インボイス適格な課税仕入は「適格」が付与される', () => {
    const entries = [entry({ id: 'e1', date: '2026-04-15' })];
    const lines = [
      line({
        id: 'l1',
        entryId: 'e1',
        side: 'debit',
        accountCode: '5130',
        amount: '1100',
        taxRate: 0.1,
        taxIncluded: true,
        invoiceCompliant: true,
      }),
      line({ id: 'l2', entryId: 'e1', side: 'credit', accountCode: '1130', amount: '1100' }),
    ];
    const rows = buildYayoiCsvRows(entries, lines, ACCOUNTS, [], CTX);
    expect(rows[0]![7]).toBe('課対仕入込10%適格');
  });

  test('非課税・免税・対象外・特定課税仕入れ（対象外）を正しく区分する', () => {
    const entries = [
      entry({ id: 'e1', date: '2026-04-15' }),
      entry({ id: 'e2', date: '2026-04-15' }),
      entry({ id: 'e3', date: '2026-04-15' }),
    ];
    const lines = [
      line({
        id: 'l1',
        entryId: 'e1',
        side: 'credit',
        accountCode: '4110',
        amount: '1000',
        taxCategory: 'exportExempt',
      }),
      line({ id: 'l2', entryId: 'e1', side: 'debit', accountCode: '1130', amount: '1000' }),
      line({
        id: 'l3',
        entryId: 'e2',
        side: 'debit',
        accountCode: '5130',
        amount: '500',
        taxCategory: 'reverseCharge',
      }),
      line({ id: 'l4', entryId: 'e2', side: 'credit', accountCode: '1130', amount: '500' }),
      line({ id: 'l5', entryId: 'e3', side: 'debit', accountCode: '1130', amount: '200' }),
      line({ id: 'l6', entryId: 'e3', side: 'credit', accountCode: '1130', amount: '200' }),
    ];
    const rows = buildYayoiCsvRows(entries, lines, ACCOUNTS, [], CTX);
    expect(rows[0]![13]).toBe('輸出売上');
    expect(rows[1]![7]).toBe('対象外');
    expect(rows[2]![7]).toBe('対象外');
  });

  test('簡易課税では課税売上に事業区分の漢数字が付与される', () => {
    const entries = [entry({ id: 'e1', date: '2026-04-15' })];
    const lines = [
      line({ id: 'l1', entryId: 'e1', side: 'debit', accountCode: '1130', amount: '1100' }),
      line({
        id: 'l2',
        entryId: 'e1',
        side: 'credit',
        accountCode: '4110',
        amount: '1100',
        taxRate: 0.1,
        taxIncluded: true,
      }),
    ];
    const rows = buildYayoiCsvRows(entries, lines, ACCOUNTS, [], {
      taxFilingMethod: 'simplified',
      simplifiedTaxCategory: 5,
    });
    expect(rows[0]![13]).toBe('課税売上込五10%');
  });
});

describe('encodeShiftJis', () => {
  test('日本語文字列を Shift-JIS バイト列に変換し、デコードすると元に戻る', () => {
    const text = '課税売上込10%\r\n摘要テスト';
    const bytes = encodeShiftJis(text);
    const decoded = Encoding.convert(Array.from(bytes), { to: 'UNICODE', from: 'SJIS', type: 'string' });
    expect(decoded).toBe(text);
  });
});

describe('buildGenericCsvRows', () => {
  test('JournalLine単位で1行ずつ出力し、訂正済みペアは除外される', () => {
    const entries = [
      entry({ id: 'e1', date: '2026-04-15', description: '有効仕訳' }),
      entry({ id: 'e2', date: '2026-04-16', status: 'reversed', reversedByEntryId: 'e3' }),
      entry({ id: 'e3', date: '2026-04-17', originalEntryId: 'e2' }),
    ];
    const lines = [
      line({ id: 'l1', entryId: 'e1', side: 'debit', accountCode: '5130', amount: '1000' }),
      line({ id: 'l2', entryId: 'e1', side: 'credit', accountCode: '1130', amount: '1000' }),
      line({ id: 'l3', entryId: 'e2', side: 'debit', accountCode: '5130', amount: '2000' }),
      line({ id: 'l4', entryId: 'e2', side: 'credit', accountCode: '1130', amount: '2000' }),
      line({ id: 'l5', entryId: 'e3', side: 'credit', accountCode: '5130', amount: '2000' }),
      line({ id: 'l6', entryId: 'e3', side: 'debit', accountCode: '1130', amount: '2000' }),
    ];
    const rows = buildGenericCsvRows(entries, lines, ACCOUNTS, []);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r[0] === 'e1')).toBe(true);
  });
});

describe('buildCorrectionHistoryRows', () => {
  test('原仕訳と打消し仕訳の2件のみを取消履歴として出力する', () => {
    const entries = [
      entry({
        id: 'e1',
        date: '2026-04-15',
        description: '誤った仕訳',
        status: 'reversed',
        reversedByEntryId: 'e2',
      }),
      entry({ id: 'e2', date: '2026-04-16', originalEntryId: 'e1' }),
      entry({ id: 'e3', date: '2026-04-17', description: '通常仕訳' }),
    ];
    const lines = [
      line({ id: 'l1', entryId: 'e1', side: 'debit', accountCode: '5130', amount: '1000' }),
      line({ id: 'l2', entryId: 'e1', side: 'credit', accountCode: '1130', amount: '1000' }),
    ];
    const rows = buildCorrectionHistoryRows(entries, lines);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(['2026-04-15', '誤った仕訳', '1000', '2026-04-16']);
  });

  test('訂正されていない仕訳は含まれない', () => {
    const entries = [entry({ id: 'e1', date: '2026-04-15' })];
    const rows = buildCorrectionHistoryRows(entries, []);
    expect(rows).toHaveLength(0);
  });
});