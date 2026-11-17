import { describe, expect, test } from 'vitest';
import {
  checkRow,
  clip,
  describeValue,
  hasRowSpec,
  hasSettingSpec,
  safeAttachmentMimeType,
  upgradeLegacyRow,
} from './restore-schema';
import { RESTORABLE_SETTING_KEYS, RESTORABLE_TABLES } from '../backup/parts';

const SHA = 'a'.repeat(64);

const pd = {
  year: 2026,
  socialInsurancePaid: '0',
  smallBusinessMutualAidPaid: '0',
  earthquakeInsurancePaid: '0',
  oldLongTermInsurancePaid: '0',
  medicalExpensePaid: '0',
  medicalInsuranceReimbursement: '0',
  donationAmount: '0',
  casualtyLossDeduction: '0',
  lifeInsurance: {},
  isDisabled: false,
  isSpecialDisabled: false,
  isSingleParent: false,
  isWidow: false,
  isWorkingStudent: false,
  dependents: [],
  updatedAt: 1,
};

const snapshot = {
  id: 's1',
  year: 2026,
  type: 'pl',
  status: 'filed',
  payload: {
    type: 'pl',
    data: {
      rows: [{ accountCode: '4110', amount: '100' }],
      totalRevenue: '100',
      totalExpense: '0',
      netIncome: '100',
    },
  },
  generatedAt: 1,
  generatedFromEntriesUpTo: '2026-12-31',
};

function setting(key: string, value: unknown): Record<string, unknown> {
  return { key, value, updatedAt: 1 };
}

describe('checkRow：型ごとの判定', () => {
  test('string', () => {
    expect(checkRow('vendors', { id: 'v', name: 'X' })).toBeNull();
    expect(checkRow('vendors', { id: 'v', name: 1 })).toBe('name が文字列ではありません（number）');
  });

  test('空でない string', () => {
    expect(checkRow('journalLines', { id: '' })).toBe('id が空です');
  });

  test('number', () => {
    const row = { id: 'b', parserName: 'p', fileName: 'f', fileHash: 'h', importedAt: 1 };
    expect(checkRow('importBatches', { ...row, rowCount: 3 })).toBeNull();
    expect(checkRow('importBatches', { ...row, rowCount: '3' })).toBe(
      'rowCount が数値ではありません（「3」）',
    );
  });

  test('integer と範囲', () => {
    const b = { year: 2026, month: 1, revenueBudget: '0', expenseBudget: '0' };
    expect(checkRow('budgets', b)).toBeNull();
    expect(checkRow('budgets', { ...b, year: 2026.5 })).toBe('year が整数ではありません（number）');
    expect(checkRow('budgets', { ...b, month: 13 })).toBe('month が範囲外です');
    expect(checkRow('budgets', { ...b, month: 0 })).toBe('month が範囲外です');
  });

  test('boolean', () => {
    expect(checkRow('personalDeductions', pd)).toBeNull();
    expect(checkRow('personalDeductions', { ...pd, isDisabled: 'false' })).toBe(
      'isDisabled が真偽値ではありません（「false」）',
    );
  });

  test('列挙', () => {
    const a = { code: '1110', year: 2026, name: '現金', category: 'asset', displayOrder: 1 };
    expect(checkRow('accounts', a)).toBeNull();
    expect(checkRow('accounts', { ...a, category: 'Asset' })).toBe(
      'category が不正です（「Asset」）',
    );
    expect(checkRow('accounts', { ...a, category: 'hasOwnProperty' })).toBe(
      'category が不正です（「hasOwnProperty」）',
    );
  });

  test('数値の列挙（税率）', () => {
    const inv = {
      id: 'i',
      documentType: 'invoice',
      status: 'draft',
      number: '',
      vendorId: 'v',
      date: '2026-01-01',
      createdAt: 1,
    };
    const item = { id: 'l', name: 'x', quantity: '1', unitPrice: '100' };
    expect(checkRow('invoices', { ...inv, lineItems: [{ ...item, taxRate: 0.08 }] })).toBeNull();
    expect(checkRow('invoices', { ...inv, lineItems: [{ ...item, taxRate: '0.08' }] })).toBe(
      'lineItems[0].taxRate が不正です（「0.08」）',
    );
  });

  test('decimal は Decimal として読めて有限であること', () => {
    const b = { year: 2026, month: 1, expenseBudget: '0' };
    expect(checkRow('budgets', { ...b, revenueBudget: '-1.5' })).toBeNull();
    expect(checkRow('budgets', { ...b, revenueBudget: '1e3' })).toBeNull();
    for (const bad of ['abc', 'NaN', 'Infinity', '-Infinity', '']) {
      expect(checkRow('budgets', { ...b, revenueBudget: bad })).toMatch(/^revenueBudget が/);
    }
    expect(checkRow('budgets', { ...b, revenueBudget: 1000 })).toBe(
      'revenueBudget が数値の文字列ではありません（number）',
    );
  });

  test('sha256', () => {
    const at = { id: 'a', entryId: 'e', mimeType: 'image/png', fileName: 'a.png', createdAt: 1 };
    expect(checkRow('attachments', { ...at, sha256: SHA })).toBeNull();
    expect(checkRow('attachments', at)).toBeNull();
    expect(checkRow('attachments', { ...at, sha256: 'abc' })).toMatch(/^sha256 が SHA-256/);
    expect(checkRow('attachments', { ...at, sha256: 'A'.repeat(64) })).toMatch(/^sha256 が/);
  });

  test('YYYY-MM-DD または空', () => {
    expect(checkRow('settings', setting('businessStartDate', ''))).toBeNull();
    expect(checkRow('settings', setting('businessStartDate', '2026-03-01'))).toBeNull();
    expect(checkRow('settings', setting('businessStartDate', '2026/03/01'))).toBe(
      'businessStartDate が YYYY-MM-DD ではありません（「2026/03/01」）',
    );
  });

  test('配列', () => {
    expect(checkRow('vendors', { id: 'v', name: 'X', aliases: ['a'] })).toBeNull();
    expect(checkRow('vendors', { id: 'v', name: 'X', aliases: 'a' })).toBe(
      'aliases が配列ではありません（「a」）',
    );
    expect(checkRow('vendors', { id: 'v', name: 'X', aliases: ['a', 1] })).toBe(
      'aliases[1] が文字列ではありません（number）',
    );
  });

  test('record', () => {
    expect(
      checkRow('subAccounts', { id: 's', accountCode: 'a', name: 'n', metadata: { k: 'v' } }),
    ).toBeNull();
    expect(
      checkRow('subAccounts', { id: 's', accountCode: 'a', name: 'n', metadata: { k: 1 } }),
    ).toBe('metadata.k が文字列ではありません（number）');
    expect(checkRow('settings', setting('homeOfficeAccountRatios', { '5130': 0.3 }))).toBe(
      'homeOfficeAccountRatios.5130 が文字列ではありません（number）',
    );
    expect(checkRow('settings', setting('interimPriorPeriodMonths', { '2026': 6 }))).toBeNull();
  });

  test('オブジェクト', () => {
    expect(checkRow('personalDeductions', { ...pd, lifeInsurance: null })).toBe(
      'lifeInsurance がオブジェクトではありません（null）',
    );
    expect(checkRow('personalDeductions', { ...pd, lifeInsurance: [] })).toBe(
      'lifeInsurance がオブジェクトではありません（array）',
    );
  });
});

describe('checkRow：必須・任意・null', () => {
  test('必須欄が無ければ欄名を返す', () => {
    expect(checkRow('inventoryItems', { id: 'i' })).toBe('name がありません');
  });

  test('任意欄は無い・undefined なら見ない、あれば型を見る', () => {
    expect(checkRow('vendors', { id: 'v', name: 'X' })).toBeNull();
    expect(checkRow('vendors', { id: 'v', name: 'X', address: undefined })).toBeNull();
    expect(checkRow('vendors', { id: 'v', name: 'X', address: null })).toBe(
      'address が文字列ではありません（null）',
    );
  });

  test('null を許すのは型か旧形式が許す欄だけ', () => {
    const rule = { id: 'r', matchType: 'regex', pattern: 'x', hitCount: 0 };
    expect(checkRow('parserRules', { ...rule, priority: null })).toBeNull();
    expect(checkRow('parserRules', { ...rule, priority: 1 })).toBeNull();
    expect(checkRow('parserRules', { ...rule, priority: '1' })).toBe(
      'priority が数値ではありません（「1」）',
    );
    expect(
      checkRow('personalDeductions', { ...pd, spouse: { totalIncome: '0', age: null } }),
    ).toBeNull();
    const dependent = { id: 'd', name: 'n', age: null, totalIncome: '0' };
    expect(checkRow('personalDeductions', { ...pd, dependents: [dependent] })).toBeNull();
    const employee = { id: 'f', name: 'n', relation: 'spouse', age: null, monthsWorked: 12 };
    expect(checkRow('personalDeductions', { ...pd, familyEmployees: [employee] })).toBe(
      'familyEmployees[0].age が数値ではありません（null）',
    );
  });

  test('明細の税率は数値であれば値の範囲を問わない（OCR の旧データ）', () => {
    const line = {
      id: 'l',
      entryId: 'e',
      accountCode: '5130',
      side: 'debit',
      amount: '1',
      amountIndexed: '00000000000001.00',
      taxIncluded: true,
      invoiceCompliant: false,
    };
    expect(checkRow('journalLines', { ...line, taxRate: 0.0937 })).toBeNull();
    expect(checkRow('journalLines', { ...line, taxRate: '0.1' })).toMatch(/^taxRate/);
  });
});

describe('checkRow：入れ子の道筋と値の表示', () => {
  test('入れ子の道筋を . と [n] でつなぐ', () => {
    const dependent = { id: 'd', name: 'n', age: 70, totalIncome: '0', disability: 'x' };
    expect(checkRow('personalDeductions', { ...pd, dependents: [dependent] })).toBe(
      'dependents[0].disability が不正です（「x」）',
    );
    const rent = { amount: 1 };
    expect(
      checkRow('personalDeductions', {
        ...pd,
        realEstateIncome: { businessScale: false, rentPaid: [rent] },
      }),
    ).toBe('realEstateIncome.rentPaid[0].amount が文字列ではありません（number）');
  });

  test('長い値と長いキーは 40 字で切る', () => {
    const long = 'あ'.repeat(50);
    expect(
      checkRow('accounts', { code: 'c', year: 2026, name: 'n', category: long, displayOrder: 1 }),
    ).toBe(`category が不正です（「${'あ'.repeat(40)}…」）`);
    const key = 'k'.repeat(45);
    expect(checkRow('settings', setting('homeOfficeAccountRatios', { [key]: 1 }))).toBe(
      `homeOfficeAccountRatios.${'k'.repeat(40)}… が文字列ではありません（number）`,
    );
  });

  test('文字列以外は型名だけを示し、toString を呼ばない', () => {
    expect(describeValue(null)).toBe('null');
    expect(describeValue([1])).toBe('array');
    expect(describeValue(1)).toBe('number');
    expect(describeValue(true)).toBe('boolean');
    expect(describeValue(undefined)).toBe('undefined');
    expect(describeValue({ toString: 'x' })).toBe('object');
    expect(
      describeValue({
        toString: () => {
          throw new Error('x');
        },
      }),
    ).toBe('object');
    expect(clip('abc')).toBe('abc');
  });

  test('clip は 5 MB の文字列でも先頭 40 字で切る', () => {
    const huge = 'x'.repeat(5_000_000);
    expect(clip(huge)).toBe(`${'x'.repeat(40)}…`);
    expect(clip(`あ${huge}`)).toBe(`あ${'x'.repeat(39)}…`);
  });

  test('clip はサロゲートペアを分けず、全体を文字の配列にしたときと同じ位置で切る', () => {
    const wholeArray = (v: string): string => {
      const chars = Array.from(v);
      return chars.length > 40 ? `${chars.slice(0, 40).join('')}…` : v;
    };
    const pair = '𠮷';
    const inputs = [
      pair.repeat(40),
      pair.repeat(41),
      pair.repeat(100),
      `a${pair.repeat(38)}b`,
      `a${pair.repeat(39)}bc`,
      `a${pair.repeat(60)}`,
      `${'x'.repeat(79)}${pair.repeat(5)}`,
    ];
    for (const v of inputs) {
      expect(clip(v)).toBe(wholeArray(v));
    }
    expect(clip(`a${pair.repeat(60)}`)).toBe(`a${pair.repeat(39)}…`);
  });

  test('toString を書き換えた値でも説明を返し例外を投げない', () => {
    expect(checkRow('vendors', { id: 'v', name: { toString: 'x', valueOf: 'y' } })).toBe(
      'name が文字列ではありません（object）',
    );
  });
});

describe('checkRow：申告ロックのスナップショット', () => {
  test('型どおりなら通る', () => {
    expect(checkRow('reportSnapshots', snapshot)).toBeNull();
  });

  test('payload.type が外側の type と違えば弾く', () => {
    expect(
      checkRow('reportSnapshots', { ...snapshot, payload: { ...snapshot.payload, type: 'bs' } }),
    ).toBe('payload.type が type と一致しません（「bs」）');
  });

  test('data の金額は Decimal として読めること', () => {
    const data = { ...snapshot.payload.data, totalRevenue: null };
    expect(checkRow('reportSnapshots', { ...snapshot, payload: { type: 'pl', data } })).toBe(
      'payload.data.totalRevenue が数値の文字列ではありません（null）',
    );
  });

  test('各 type の data を見る', () => {
    const base = { ...snapshot };
    expect(
      checkRow('reportSnapshots', {
        ...base,
        type: 'monthly-sales',
        payload: { type: 'monthly-sales', data: { months: [{ month: 1, sales: '10' }] } },
      }),
    ).toBeNull();
    expect(
      checkRow('reportSnapshots', {
        ...base,
        type: 'bs',
        payload: {
          type: 'bs',
          data: { assets: [], liabilities: [], equity: [{ accountCode: 'x', amount: 'y' }] },
        },
      }),
    ).toBe('payload.data.equity[0].amount が数値の文字列ではありません（「y」）');
    expect(
      checkRow('reportSnapshots', {
        ...base,
        type: 'consumption-tax',
        payload: { type: 'consumption-tax', data: { method: 'other', netTaxNational: '0' } },
      }),
    ).toBe('payload.data.method が不正です（「other」）');
  });
});

describe('checkRow：settings', () => {
  test('仕様のあるキーだけを見る', () => {
    expect(checkRow('settings', setting('lastBackupAt', 'x'))).toBeNull();
    expect(checkRow('settings', setting('unknownKey', { a: 1 }))).toBeNull();
    expect(checkRow('settings', setting('constructor', 1))).toBeNull();
  });

  test('値の型を見る', () => {
    expect(checkRow('settings', setting('currentYear', 2026))).toBeNull();
    expect(checkRow('settings', setting('currentYear', '2026'))).toBe(
      'currentYear が整数ではありません（「2026」）',
    );
    expect(checkRow('settings', setting('filingType', 'Blue'))).toBe(
      'filingType が不正です（「Blue」）',
    );
    expect(checkRow('settings', setting('taxableElectionPeriod', { fromYear: 2026 }))).toBeNull();
    expect(checkRow('settings', setting('taxableElectionPeriod', { toYear: 2027 }))).toBe(
      'taxableElectionPeriod.fromYear がありません',
    );
    expect(
      checkRow(
        'settings',
        setting('wariBaseAdjustments', {
          '2026': {
            specifiedSmallAssetTransfers: [{ date: '2026-01-01', rate: 0.1, netTax: '1' }],
          },
        }),
      ),
    ).toBeNull();
  });

  test('value が無ければ弾く、updatedAt は任意', () => {
    expect(checkRow('settings', { key: 'currentYear' })).toBe('currentYear の value がありません');
    expect(checkRow('settings', { key: 'currentYear', value: 2026 })).toBeNull();
    expect(checkRow('settings', { key: 'currentYear', value: 2026, updatedAt: 'x' })).toBe(
      'updatedAt が数値ではありません（「x」）',
    );
  });

  test('ocrEngine は移行処理が読み分けられる値だけ', () => {
    for (const v of ['gemini', 'openai-compatible', 'tesseract', 'native', 'apple-ai']) {
      expect(checkRow('settings', setting('ocrEngine', v))).toBeNull();
    }
    expect(checkRow('settings', setting('ocrEngine', 'chrome-ai'))).toBe(
      'ocrEngine が不正です（「chrome-ai」）',
    );
  });
});

describe('仕様の網羅', () => {
  test('復元する設定キーにはすべて仕様がある', () => {
    expect([...RESTORABLE_SETTING_KEYS].filter((k) => !hasSettingSpec(k))).toEqual([]);
  });

  test('復元する表にはすべて仕様がある', () => {
    expect([...RESTORABLE_TABLES].filter((t) => !hasRowSpec(t))).toEqual([]);
    expect(hasRowSpec('settings')).toBe(true);
  });

  test('仕様の無い表とキーは何も見ない', () => {
    expect(hasRowSpec('stamps')).toBe(false);
    expect(hasRowSpec('toString')).toBe(false);
    expect(hasSettingSpec('constructor')).toBe(false);
    expect(hasSettingSpec(1)).toBe(false);
    expect(checkRow('stamps', { id: 1 })).toBeNull();
    expect(checkRow('toString', {})).toBeNull();
  });
});

describe('upgradeLegacyRow：旧形式の変換', () => {
  test('予算の数値金額を文字列にする', () => {
    const row: Record<string, unknown> = {
      year: 2026,
      month: 1,
      revenueBudget: 1000,
      expenseBudget: 0.5,
    };
    expect(upgradeLegacyRow('budgets', row)).toBe(true);
    expect(row).toEqual({ year: 2026, month: 1, revenueBudget: '1000', expenseBudget: '0.5' });
    expect(checkRow('budgets', row)).toBeNull();
  });

  test('売掛買掛の数値金額を文字列にする', () => {
    const row: Record<string, unknown> = { originalAmount: 5000, paidAmount: 0 };
    upgradeLegacyRow('arApEntries', row);
    expect(row).toEqual({ originalAmount: '5000', paidAmount: '0' });
  });

  test('明細の数値の数量を文字列にする', () => {
    const row: Record<string, unknown> = { quantity: 3 };
    upgradeLegacyRow('journalLines', row);
    expect(row).toEqual({ quantity: '3' });
  });

  test('有限でない数値と文字列はそのまま', () => {
    const row: Record<string, unknown> = { revenueBudget: Number.NaN, expenseBudget: '1,000' };
    upgradeLegacyRow('budgets', row);
    expect(row.revenueBudget).toBeNaN();
    expect(row.expenseBudget).toBe('1,000');
    expect(checkRow('budgets', { year: 2026, month: 1, ...row })).toMatch(/^revenueBudget が/);
  });

  test('年度の null は行ごと捨てる', () => {
    expect(upgradeLegacyRow('settings', setting('currentYear', null))).toBe(false);
    expect(upgradeLegacyRow('settings', setting('currentYear', 2026))).toBe(true);
    expect(upgradeLegacyRow('settings', setting('userBusinessName', null))).toBe(true);
  });

  test('範囲外の整数の年度は行ごと捨て、整数でない値は残して checkRow に任せる', () => {
    for (const v of [0, 2019, 2100, 1e300]) {
      expect(upgradeLegacyRow('settings', setting('currentYear', v)), String(v)).toBe(false);
    }
    for (const v of [2020, 2099, 2026.5, '2026']) {
      expect(upgradeLegacyRow('settings', setting('currentYear', v)), String(v)).toBe(true);
    }
  });

  test('対象外の表は変えない', () => {
    const row: Record<string, unknown> = { id: 'v', name: 'X', defaultTaxRate: 10 };
    expect(upgradeLegacyRow('vendors', row)).toBe(true);
    expect(row).toEqual({ id: 'v', name: 'X', defaultTaxRate: 10 });
  });
});

describe('safeAttachmentMimeType', () => {
  test('許可した画像の型はそのまま', () => {
    for (const t of [
      'image/jpeg',
      'image/png',
      'image/gif',
      'image/webp',
      'image/bmp',
      'image/heic',
      'image/heif',
      'application/octet-stream',
    ]) {
      expect(safeAttachmentMimeType(t)).toBe(t);
    }
  });

  test('それ以外は型無しにする', () => {
    for (const t of [
      'text/html',
      '',
      'text/html\u0000',
      'image/svg+xml',
      'IMAGE/PNG',
      'image/png ',
      'constructor',
    ]) {
      expect(safeAttachmentMimeType(t)).toBe('application/octet-stream');
    }
  });

  test('別名は標準の型へ読み替える', () => {
    expect(safeAttachmentMimeType('image/jpg')).toBe('image/jpeg');
    expect(safeAttachmentMimeType('image/pjpeg')).toBe('image/jpeg');
    expect(safeAttachmentMimeType('image/x-png')).toBe('image/png');
    expect(safeAttachmentMimeType('image/x-ms-bmp')).toBe('image/bmp');
  });

  test('別名表に無い型は読み替えない', () => {
    expect(safeAttachmentMimeType('image/svg+xml')).toBe('application/octet-stream');
    expect(safeAttachmentMimeType('text/html')).toBe('application/octet-stream');
    expect(safeAttachmentMimeType('IMAGE/JPG')).toBe('application/octet-stream');
    expect(safeAttachmentMimeType('get')).toBe('application/octet-stream');
  });
});
