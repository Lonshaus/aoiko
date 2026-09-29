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
    const decoded = Encoding.convert(Array.from(bytes), {
      to: 'UNICODE',
      from: 'SJIS',
      type: 'string',
    });
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

describe('buildYayoiCsvRows：免税事業者等からの仕入れの控除上限（附則52条1項）', () => {
  function purchases(vendorId: string | undefined, amounts: string[], year = 2027) {
    const entries: JournalEntry[] = [];
    const lines: JournalLine[] = [];
    amounts.forEach((amount, i) => {
      const id = `e${i + 1}`;
      const date = `${year}-0${i + 1}-10`;
      entries.push(entry({ id, date }));
      lines.push(
        line({
          id: `${id}d`,
          entryId: id,
          side: 'debit',
          accountCode: '5130',
          amount,
          amountIndexed: toIndexable(amount),
          taxRate: 0.1,
          ...(vendorId !== undefined ? { vendorId } : {}),
        }),
        line({
          id: `${id}c`,
          entryId: id,
          side: 'credit',
          accountCode: '1130',
          amount,
          amountIndexed: toIndexable(amount),
        }),
      );
    });
    return { entries, lines };
  }

  test('年間1億5千万円の取引先は、上限を超えた部分の行を控除できない区分で出力する', () => {
    const { entries, lines } = purchases('v1', ['50000000', '50000000', '50000000']);
    const rows = buildYayoiCsvRows(entries, lines, ACCOUNTS, [], CTX);
    expect(rows.map((r) => r[7])).toEqual([
      '課対仕入込10%区分70%',
      '課対仕入込10%区分70%',
      '課対仕入込10%区分控不',
    ]);
  });

  test('上限をまたぐ行は1行の中で按分できないため行全体を控除できない区分にする', () => {
    const { entries, lines } = purchases('v1', ['60000000', '60000000']);
    const rows = buildYayoiCsvRows(entries, lines, ACCOUNTS, [], CTX);
    expect(rows.map((r) => r[7])).toEqual(['課対仕入込10%区分70%', '課対仕入込10%区分控不']);
  });

  test('上限を超える取引先が無ければ各行の区分は従来どおり取引日の経過措置の割合', () => {
    const { entries, lines } = purchases('v1', ['30000000', '30000000', '40000000']);
    const rows = buildYayoiCsvRows(entries, lines, ACCOUNTS, [], CTX);
    expect(rows.map((r) => r[7])).toEqual([
      '課対仕入込10%区分70%',
      '課対仕入込10%区分70%',
      '課対仕入込10%区分70%',
    ]);
  });

  test('取引先の無い行は合算しないため、1億円以下の行が並んでも区分は変わらない', () => {
    const { entries, lines } = purchases(undefined, ['60000000', '60000000']);
    const rows = buildYayoiCsvRows(entries, lines, ACCOUNTS, [], CTX);
    expect(rows.map((r) => r[7])).toEqual(['課対仕入込10%区分70%', '課対仕入込10%区分70%']);
  });

  test('令和8年10月1日前に開始した課税期間（2026年分）は従来の10億円が上限', () => {
    const { entries, lines } = purchases('v1', ['60000000', '60000000'], 2026);
    const rows = buildYayoiCsvRows(entries, lines, ACCOUNTS, [], CTX);
    expect(rows.map((r) => r[7])).toEqual(['課対仕入込10%区分80%', '課対仕入込10%区分80%']);
  });
});

describe('控除割合0%は区分控不で出力する（区分0%は出力しない）', () => {
  test('経過措置終了後（令和13年10月1日以後）で上限を超えていない行も区分控不', () => {
    const entries = [entry({ id: 'e1', date: '2031-10-01' })];
    const lines = [
      line({
        id: 'l1',
        entryId: 'e1',
        side: 'debit',
        accountCode: '5130',
        amount: '1000',
        taxRate: 0.1,
      }),
      line({ id: 'l2', entryId: 'e1', side: 'credit', accountCode: '1130', amount: '1000' }),
    ];
    const rows = buildYayoiCsvRows(entries, lines, ACCOUNTS, [], CTX);
    expect(rows.map((r) => r[7])).toEqual(['課対仕入込10%区分控不']);
  });

  test('上限超過（附則52条1項）と経過措置終了後の両方が混在しても全文に区分0%は出ない', () => {
    const capExceeded = entry({ id: 'ecap', date: '2027-04-01' });
    const capLines = [
      line({
        id: 'capd',
        entryId: 'ecap',
        side: 'debit',
        accountCode: '5130',
        amount: '150000000',
        taxRate: 0.1,
        vendorId: 'v1',
      }),
      line({
        id: 'capc',
        entryId: 'ecap',
        side: 'credit',
        accountCode: '1130',
        amount: '150000000',
      }),
    ];
    const afterAbolition = entry({ id: 'eafter', date: '2031-10-01' });
    const afterLines = [
      line({
        id: 'afterd',
        entryId: 'eafter',
        side: 'debit',
        accountCode: '5130',
        amount: '1000',
        taxRate: 0.1,
      }),
      line({
        id: 'afterc',
        entryId: 'eafter',
        side: 'credit',
        accountCode: '1130',
        amount: '1000',
      }),
    ];
    const rows = buildYayoiCsvRows(
      [capExceeded, afterAbolition],
      [...capLines, ...afterLines],
      ACCOUNTS,
      [],
      CTX,
    );
    const fullText = rows.flat().join('\n');
    expect(fullText).not.toContain('区分0%');
    expect(fullText).toContain('区分控不');
  });
});

describe('課税資産の譲渡等の行単位の印（taxableTransferConsideration）', () => {
  test('資産科目（収入科目でない）の行は対象外になり、同科目で貸借バランスする合成ペアが課税売上を表す', () => {
    const entries = [entry({ id: 'e1', date: '2026-05-01' })];
    const lines = [
      line({ id: 'l1', entryId: 'e1', side: 'debit', accountCode: '1130', amount: '110000' }),
      line({
        id: 'l2',
        entryId: 'e1',
        side: 'credit',
        accountCode: '5150',
        amount: '110000',
        taxRate: 0.1,
        taxIncluded: true,
        taxableTransferConsideration: '110000',
      }),
    ];
    const rows = buildYayoiCsvRows(entries, lines, ACCOUNTS, [], CTX);
    // l2（対象外）＋合成ペア（貸方=課税売上、借方=対象外）で振替伝票2行になる
    expect(rows).toHaveLength(2);
    const debitTotal = rows.reduce((sum, r) => sum + Number(r[8] || 0), 0);
    const creditTotal = rows.reduce((sum, r) => sum + Number(r[14] || 0), 0);
    expect(debitTotal).toBe(creditTotal);
    expect(debitTotal).toBe(220000);
    const taxLabels = rows.flatMap((r) => [r[7], r[13]]);
    expect(taxLabels).toContain('課税売上込10%');
    expect(taxLabels).toContain('対象外');
    expect(taxLabels).not.toContain('課対仕入込10%区分80%');
    const taxAmounts = rows.map((r) => Number(r[9] || 0) + Number(r[15] || 0));
    expect(taxAmounts.reduce((s, n) => s + n, 0)).toBe(10000);
  });

  test('簡易課税では合成ペアの課税売上区分に第四種（消基通13-2-9）が付く', () => {
    const ctxSimplified = {
      taxFilingMethod: 'simplified' as const,
      simplifiedTaxCategory: 5 as const,
    };
    const entries = [entry({ id: 'e1', date: '2026-05-01' })];
    const lines = [
      line({ id: 'l1', entryId: 'e1', side: 'debit', accountCode: '1130', amount: '110000' }),
      line({
        id: 'l2',
        entryId: 'e1',
        side: 'credit',
        accountCode: '5150',
        amount: '110000',
        taxRate: 0.1,
        taxIncluded: true,
        taxableTransferConsideration: '110000',
      }),
    ];
    const rows = buildYayoiCsvRows(entries, lines, ACCOUNTS, [], ctxSimplified);
    const taxLabels = rows.flatMap((r) => [r[7], r[13]]);
    expect(taxLabels).toContain('課税売上込四10%');
  });

  test('収入科目に印を付けた行はそれ自体が課税売上行になり、合成ペアは追加されない', () => {
    const entries = [entry({ id: 'e1', date: '2026-05-01' })];
    const lines = [
      line({ id: 'l1', entryId: 'e1', side: 'debit', accountCode: '1130', amount: '110000' }),
      line({
        id: 'l2',
        entryId: 'e1',
        side: 'credit',
        accountCode: '4110',
        amount: '110000',
        taxRate: 0.1,
        taxIncluded: true,
        taxableTransferConsideration: '110000',
      }),
    ];
    const rows = buildYayoiCsvRows(entries, lines, ACCOUNTS, [], CTX);
    expect(rows).toHaveLength(1);
    expect(rows[0]![13]).toBe('課税売上込10%');
  });
});
