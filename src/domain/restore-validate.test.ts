import { describe, expect, test } from 'vitest';
import {
  BackupValidationError,
  NEVER_RESTORED,
  PRIMARY_KEY,
  validateBackupPayload,
} from './restore-validate';
import { db } from '../db';
import type { BackupPayload } from '../backup';
import { toIndexable } from '../lib/decimal';

function payload(tables: Record<string, unknown[]>): BackupPayload {
  return { version: 1, exportedAt: '2026-06-13T00:00:00.000Z', tables };
}

const validEntry = {
  id: 'e1',
  date: '2026-05-01',
  year: 2026,
  description: 'テスト',
  status: 'confirmed',
  source: 'manual',
  createdAt: 1,
  confirmedAt: 1,
};

const validLine = {
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

describe('validateBackupPayload', () => {
  test('正常な payload は通る', () => {
    expect(() =>
      validateBackupPayload(payload({ journalEntries: [validEntry], journalLines: [validLine] })),
    ).not.toThrow();
  });

  test('空テーブルや未知テーブルは無視（破壊しない）', () => {
    expect(() =>
      validateBackupPayload(payload({ journalEntries: [], unknownTable: [{ x: 1 }] })),
    ).not.toThrow();
  });

  test('tables が配列でなければ投げる', () => {
    expect(() => validateBackupPayload(payload({ journalEntries: {} as never }))).toThrow(
      BackupValidationError,
    );
  });

  test('仕訳の date が不正なら投げる', () => {
    expect(() =>
      validateBackupPayload(payload({ journalEntries: [{ ...validEntry, date: '2026/5/1' }] })),
    ).toThrow(/date/);
  });

  test('仕訳の status が不正なら投げる', () => {
    expect(() =>
      validateBackupPayload(payload({ journalEntries: [{ ...validEntry, status: 'draft' }] })),
    ).toThrow(/status/);
  });

  test('明細の side が不正なら投げる', () => {
    expect(() =>
      validateBackupPayload(payload({ journalLines: [{ ...validLine, side: 'left' }] })),
    ).toThrow(/side/);
  });

  test('明細の amount が数値文字列でなければ投げる', () => {
    expect(() =>
      validateBackupPayload(payload({ journalLines: [{ ...validLine, amount: 'abc' }] })),
    ).toThrow(/amount/);
    // number は文字列ではないので拒否（Dexie 境界では string のはず）
    expect(() =>
      validateBackupPayload(payload({ journalLines: [{ ...validLine, amount: 5000 }] })),
    ).toThrow(/amount/);
  });

  test('明細がオブジェクトでなければ投げる', () => {
    expect(() => validateBackupPayload(payload({ journalLines: ['not-an-object'] }))).toThrow(
      BackupValidationError,
    );
  });

  test('その他テーブルは主キー欠落で投げる', () => {
    expect(() => validateBackupPayload(payload({ vendors: [{ name: '主キー無し' }] }))).toThrow(
      /vendors/,
    );
    expect(() => validateBackupPayload(payload({ settings: [{ value: 1 }] }))).toThrow(/settings/);
  });

  test('その他テーブルは主キーがあれば通る', () => {
    expect(() =>
      validateBackupPayload(
        payload({ vendors: [{ id: 'v1', name: 'X' }], settings: [{ key: 'k', value: 1 }] }),
      ),
    ).not.toThrow();
  });

  test('invoices（v9 追加）は主キー id 欠落で投げる', () => {
    expect(() =>
      validateBackupPayload(payload({ invoices: [{ documentType: 'invoice' }] })),
    ).toThrow(/invoices/);
  });

  test('invoices は id があれば通る', () => {
    expect(() =>
      validateBackupPayload(payload({ invoices: [{ id: 'inv-1', documentType: 'invoice' }] })),
    ).not.toThrow();
  });
});

describe('意図的に復元しないテーブル', () => {
  test('stamps は PRIMARY_KEY に載せない（載せると別端末の記録を持ち込める）', () => {
    expect('stamps' in PRIMARY_KEY).toBe(false);
    expect(NEVER_RESTORED.has('stamps')).toBe(true);
  });

  test('stamps を含むバックアップでも検証は通る（無視されるだけ）', () => {
    expect(() => validateBackupPayload(payload({ stamps: [{ id: 's1' }] }))).not.toThrow();
  });
});

describe('PRIMARY_KEY と db スキーマの同期', () => {
  test('db.tables の全テーブルが PRIMARY_KEY に登録されている', () => {
    const missing = db.tables
      .map((t) => t.name)
      .filter((name) => !(name in PRIMARY_KEY) && !NEVER_RESTORED.has(name));
    expect(
      missing,
      'db に新テーブルを追加したら restore-validate.ts の PRIMARY_KEY にも追加すること（未登録テーブルは復元時に黙って無視され、利用者データが復元されない）',
    ).toEqual([]);
  });
});

describe('journalLines の金額検証', () => {
  test('負の金額は拒否する（validateLines・toIndexable と揃える）', () => {
    expect(() =>
      validateBackupPayload(payload({ journalLines: [{ ...validLine, amount: '-100' }] })),
    ).toThrow(/amount/);
  });

  test('amountIndexed の形式が壊れていれば拒否する', () => {
    expect(() =>
      validateBackupPayload(payload({ journalLines: [{ ...validLine, amountIndexed: 'abc' }] })),
    ).toThrow(/amountIndexed/);
  });
});

describe('明細と仕訳の対応', () => {
  test('仕訳の無い明細は拒否する', () => {
    expect(() =>
      validateBackupPayload(
        payload({
          journalEntries: [validEntry],
          journalLines: [validLine, { ...validLine, id: 'l2', entryId: 'e-missing' }],
        }),
      ),
    ).toThrow(/e-missing/);
  });
  // 仕訳表が入っていないバックアップは対応を見ようがない。表ごとの検証は済んでいるので通す。
  test('journalEntries が無ければ照合しない', () => {
    expect(() => validateBackupPayload(payload({ journalLines: [validLine] }))).not.toThrow();
  });
});

describe('personalDeductions の旧フィールドのみの旧バックアップも復元できる', () => {
  test('priorPriorBusinessRevenue・priorPriorRealEstateRevenue・homeWorker が無くても通る', () => {
    const oldBackupRow = {
      year: 2026,
      socialInsurancePaid: '400000',
      smallBusinessMutualAidPaid: '0',
      lifeInsurance: {},
      earthquakeInsurancePaid: '0',
      oldLongTermInsurancePaid: '0',
      medicalExpensePaid: '0',
      medicalInsuranceReimbursement: '0',
      donationAmount: '0',
      casualtyLossDeduction: '0',
      isDisabled: false,
      isSpecialDisabled: false,
      isSingleParent: false,
      isWidow: false,
      isWorkingStudent: false,
      dependents: [],
      updatedAt: 1,
    };
    expect(() =>
      validateBackupPayload(payload({ personalDeductions: [oldBackupRow] })),
    ).not.toThrow();
  });
});

describe('journalLines の通常の表記以外の金額', () => {
  function lineWith(amount: unknown, amountIndexed: unknown) {
    return payload({ journalLines: [{ ...validLine, amount, amountIndexed }] });
  }

  function expectFastReject(amount: string) {
    const started = performance.now();
    expect(() => validateBackupPayload(lineWith(amount, '00000000000000.00'))).toThrow(
      BackupValidationError,
    );
    expect(performance.now() - started).toBeLessThan(1000);
  }

  test.each([
    '1e3',
    '.5e1',
    '1.e3',
    '1000.',
    '.5',
    '+1000',
    '0x10',
    '0b1',
    '0o7',
    '1_000',
    '0X10',
    '1E3',
    '0x' + '0'.repeat(61) + '1',
  ])('%s は toIndexable と同じ amountIndexed なら通る', (amount) => {
    expect(() => validateBackupPayload(lineWith(amount, toIndexable(amount)))).not.toThrow();
  });

  test.each([
    ['1e15', '1000000000000000.00'],
    ['1e-7', '00000000000000.00'],
    ['1e14', '100000000000000.00'],
    ['0x5af3107a4000', '100000000000000.00'],
    ['1.234567890123456789012345678e+21', '1234567890123456789012.35'],
    ['0x1p-3000', '00000000000000.00'],
    ['0x1p3000', '00000000000000.00'],
  ])('%s は amountIndexed の形式だけ見て通す', (amount, amountIndexed) => {
    expect(() => validateBackupPayload(lineWith(amount, amountIndexed))).not.toThrow();
  });

  test('minE を下回る指数は 0 と読み、0 の amountIndexed なら通る', () => {
    expect(() =>
      validateBackupPayload(lineWith('1e-9000000000000001', '00000000000000.00')),
    ).not.toThrow();
  });

  test.each([
    '-1',
    '-0',
    '-0.0',
    '-0e5',
    '-0x0',
    'abc',
    '',
    'NaN',
    'Infinity',
    '-Infinity',
    ' 1000',
    '1,000',
    '1e-9999999999',
    '1e1001',
    '1e-1001',
    '0x' + '0'.repeat(62) + '1',
  ])('%s は拒否する', (amount) => {
    expect(() => validateBackupPayload(lineWith(amount, '00000000000000.00'))).toThrow(/amount/);
  });

  test.each([5000, null, undefined, {}, ['1000']])('文字列でない %s は拒否する', (amount) => {
    expect(() => validateBackupPayload(lineWith(amount, '00000000005000.00'))).toThrow(/amount/);
  });

  test.each([
    '1e9999999999',
    '1e8999999999999999',
    '0x' + 'f'.repeat(200000),
    '0x1p999999999999999',
    '0x1p99999999999999999999',
  ])('%s は 1 秒以内に拒否する', (amount) => {
    expectFastReject(amount);
  });

  test('数 MB の不正な金額でもエラー文に載るのは先頭 40 文字だけ', () => {
    const amount = 'x' + 'y'.repeat(3_000_000);
    let message = '';
    try {
      validateBackupPayload(lineWith(amount, '00000000000000.00'));
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain('x' + 'y'.repeat(39));
    expect(message).not.toContain('y'.repeat(40));
  });

  test('形式が不正な amountIndexed もエラー文に載るのは先頭 40 文字だけ', () => {
    const amountIndexed = 'x' + 'y'.repeat(3_000_000);
    let message = '';
    try {
      validateBackupPayload(lineWith('5000', amountIndexed));
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain('x' + 'y'.repeat(39));
    expect(message).not.toContain('y'.repeat(40));
  });

  test('通常の表記以外で amountIndexed が一致しなければ拒否する', () => {
    expect(() => validateBackupPayload(lineWith('1e3', '00000000005000.00'))).toThrow(
      /amountIndexed/,
    );
    expect(() => validateBackupPayload(lineWith('1e3', '1000.00'))).toThrow(/amountIndexed/);
  });

  test.each(['1000', '1.005', '123456789012345'])(
    '通常の表記 %s は amountIndexed の値が違っても形式が正しければ通す',
    (amount) => {
      expect(() => validateBackupPayload(lineWith(amount, '00000000005000.00'))).not.toThrow();
    },
  );
});

describe('課税資産の譲渡等の対価（R18）', () => {
  function lineWith(consideration: unknown) {
    return payload({
      journalLines: [{ ...validLine, taxableTransferConsideration: consideration }],
    });
  }

  test.each(['abc', null, 1000, '-5', '0x' + 'f'.repeat(65)])('%j は復元を拒む', (v) => {
    expect(() => validateBackupPayload(lineWith(v))).toThrow(/taxableTransferConsideration/);
  });

  test.each(['1000', '1e3', '1' + '0'.repeat(1500)])('%j は復元できる', (v) => {
    expect(() => validateBackupPayload(lineWith(v))).not.toThrow();
  });
});
