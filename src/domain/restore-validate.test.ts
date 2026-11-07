import { describe, expect, test } from 'vitest';
import {
  BackupValidationError,
  journalEntryProblem,
  journalLineProblem,
  NEVER_RESTORED,
  PRIMARY_KEY,
  primaryKeyProblem,
  validateBackupPayload,
} from './restore-validate';
import { db } from '../db';
import type { BackupPayload } from '../backup';

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

const SHA = 'b'.repeat(64);
// 各表の「必須欄だけ」の行。固定資産はこれまでの検証と同じく主キー以外を必須にしない。
const minRows: Record<string, Record<string, unknown>> = {
  journalEntries: validEntry,
  journalLines: validLine,
  accounts: { code: '1110', year: 2026, name: '現金', category: 'asset', displayOrder: 1 },
  subAccounts: { id: 'sa1', accountCode: '1110', name: '小口' },
  vendors: { id: 'v1', name: '業者' },
  inventoryItems: { id: 'it1', name: '商品' },
  fixedAssets: { id: 'fa1' },
  reportSnapshots: {
    id: 'rs1',
    year: 2026,
    type: 'monthly-sales',
    status: 'draft',
    payload: { type: 'monthly-sales', data: { months: [] } },
    generatedAt: 1,
    generatedFromEntriesUpTo: '2026-12-31',
  },
  personalDeductions: {
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
  },
  budgets: { year: 2026, month: 1, revenueBudget: '100000', expenseBudget: '50000' },
  arApEntries: {
    id: 'ar1',
    type: 'receivable',
    description: '売掛',
    dueDate: '2026-06-30',
    originalAmount: '10000',
    paidAmount: '0',
    createdAt: 1,
  },
  invoices: {
    id: 'inv-1',
    documentType: 'invoice',
    status: 'draft',
    number: '',
    vendorId: 'v1',
    date: '2026-05-01',
    lineItems: [],
    createdAt: 1,
  },
  parserRules: { id: 'pr1', matchType: 'regex', pattern: '電気', priority: 1, hitCount: 0 },
  importBatches: {
    id: 'ib1',
    parserName: 'generic',
    fileName: 'a.csv',
    fileHash: 'h',
    importedAt: 1,
    rowCount: 1,
  },
  attachments: { id: 'at1', entryId: 'e1', mimeType: 'image/png', fileName: 'a.png', createdAt: 1 },
  settings: { key: 'currentYear', value: 2026 },
};
// 各表の「任意欄もすべてある」行。
const fullRows: Record<string, Record<string, unknown>> = {
  journalEntries: {
    ...validEntry,
    originalEntryId: 'e0',
    reversedByEntryId: 'e2',
    sourceImportId: 'ib1',
    department: '本店',
  },
  journalLines: {
    ...validLine,
    subAccountId: 'sa1',
    vendorId: 'v1',
    homeOfficeRatio: '0.5',
    memo: 'メモ',
    taxCategory: 'taxable10',
    inputUsageCategory: 'common',
    itemId: 'it1',
    quantity: '2',
    taxableTransferConsideration: '1000',
  },
  accounts: {
    ...minRows.accounts,
    taxCategory: 'exempt',
    parentCode: '1100',
    isActive: true,
    incomeType: 'realEstate',
  },
  subAccounts: { ...minRows.subAccounts, metadata: { bank: '青井銀行' } },
  vendors: {
    ...minRows.vendors,
    entityType: 'corporation',
    invoiceNumber: 'T1234567890123',
    invoiceVerifiedAt: 1,
    invoiceValid: true,
    defaultAccountCode: '5130',
    defaultTaxRate: 0.1,
    aliases: ['別名'],
    address: '東京都',
  },
  inventoryItems: minRows.inventoryItems!,
  fixedAssets: {
    id: 'fa1',
    name: '貸家',
    acquisitionDate: '2025-01-01',
    acquisitionCost: '3000000',
    usefulLifeYears: 22,
    depreciationMethod: 'straight-line',
    accountCode: '1510',
    disposedDate: '2026-03-31',
    disposalType: 'sale',
    salePrice: '100000',
    saleExpenses: '5000',
    incomeType: 'realEstate',
    source: 'opening',
    realEstateDetail: {
      propertyType: '貸家',
      isResidential: true,
      address: '東京都',
      tenantName: '山田',
      tenantAddress: '東京都',
      rentalPeriodStart: '2025-01-01',
      rentalPeriodEnd: '2025-12-31',
      areaSqm: '45',
      annualRent: '1200000',
      keyMoneyEtc: '100000',
      otherIncome: '0',
      depositBalance: '200000',
    },
    conversionBasis: '2500000',
    serviceStartDate: '2025-02-01',
    assetCategory: 1,
    isMineShaft: false,
    leaseContractDate: '2025-01-01',
    residualGuaranteeAmount: '10000',
    lumpSumPoolId: 'pool-1',
    usableLifeUnderOneYear: false,
    employeeCountAtAcquisition: 3,
    isLeasedOut: false,
    openingYear: 2025,
    essentialToBusiness: true,
    leaseTermMonths: 60,
    decliningBalanceElected: false,
  },
  reportSnapshots: {
    ...minRows.reportSnapshots,
    type: 'consumption-tax',
    status: 'filed',
    filedAt: 2,
    payload: { type: 'consumption-tax', data: { method: 'two-wari', netTaxNational: '12345' } },
  },
  personalDeductions: {
    ...minRows.personalDeductions,
    lifeInsurance: {
      newGeneral: '1',
      oldGeneral: '2',
      newMedical: '3',
      newPension: '4',
      oldPension: '5',
    },
    spouse: { totalIncome: '0', age: 40, disability: 'none' },
    dependents: [
      {
        id: 'd1',
        name: '子',
        age: 10,
        totalIncome: '0',
        livesWithLinealAscendant: false,
        disability: 'special',
      },
    ],
    dividendDeductionAmount: '0',
    mortgageDeductionAmount: '0',
    politicalDonationCreditAmount: '0',
    housingRenovationCreditAmount: '0',
    foreignTaxCreditAmount: '0',
    otherTaxCreditAmount: '0',
    disasterExemptionAmount: '0',
    otherWithholdingTax: '0',
    priorPriorBusinessRevenue: '0',
    priorPriorRealEstateRevenue: '0',
    salaryIncome: { paidAmount: '1', withholdingTax: '0', lastPaymentBeforeDecember: true },
    miscIncome: {
      publicPensionAmount: '0',
      publicPensionInputMode: 'revenue',
      publicPensionRevenue: '0',
      publicPensionAge65OrOver: true,
      otherIncome: '0',
      otherExpenses: '0',
    },
    realEstateIncome: {
      businessScale: true,
      landLoanInterestAmount: '0',
      rentPaid: [
        {
          payeeAddress: 'a',
          payeeName: 'b',
          amount: '1',
          deductibleAmount: '1',
          property: 'c',
          keyMoney: '0',
          renewalFee: '0',
        },
      ],
      loanInterestPaid: [{ amount: '1', deductibleAmount: '1', yearEndBalance: '100' }],
      professionalFeesPaid: [{ amount: '1', deductibleAmount: '1', withholdingTax: '0' }],
    },
    familyEmployees: [
      {
        id: 'f1',
        name: '妻',
        relation: 'spouse',
        age: 40,
        monthsWorked: 12,
        incomeType: 'business',
      },
    ],
    homeWorker: false,
  },
  budgets: minRows.budgets!,
  arApEntries: minRows.arApEntries!,
  invoices: {
    ...minRows.invoices,
    status: 'issued',
    number: 'INV-0001',
    dueDate: '2026-05-31',
    lineItems: [{ id: 'li1', name: '作業', quantity: '1', unitPrice: '1000', taxRate: 0.1 }],
    memo: 'メモ',
    journalEntryId: 'e1',
    arApEntryId: 'ar1',
    convertedToInvoiceId: 'inv-2',
    issuedAt: 2,
    voidedAt: 3,
  },
  parserRules: { ...minRows.parserRules, vendorId: 'v1', accountCode: '5130', lastHitAt: 1 },
  importBatches: minRows.importBatches!,
  attachments: { ...minRows.attachments, sha256: SHA },
  settings: { key: 'currentYear', value: 2026, updatedAt: 1 },
};
// 例外を捕まえ、BackupValidationError で表名と欄の道筋を含むことを確かめる。
function expectRejected(tables: Record<string, unknown[]>, table: string, path: RegExp): void {
  let caught: unknown;
  try {
    validateBackupPayload(payload(tables));
  } catch (e) {
    caught = e;
  }
  expect(caught).toBeInstanceOf(BackupValidationError);
  const message = (caught as Error).message;
  expect(message).toContain(table);
  expect(message).toMatch(path);
}

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
      validateBackupPayload(payload({ journalEntries: [{ ...validEntry, date: 20260501 }] })),
    ).toThrow(/date/);
  });

  test('旧バージョンの読み取れない日付の確定仕訳は通る', () => {
    const entries = [
      { ...validEntry, id: 'u1', date: '2026/5/1', year: 2026 },
      { ...validEntry, id: 'u2', date: '令和8年5月1日', year: null },
      { ...validEntry, id: 'u3', date: '', year: 0 },
      { ...validEntry, id: 'u4', date: '12.5.2026', year: 12.5 },
    ];
    expect(() => validateBackupPayload(payload({ journalEntries: entries }))).not.toThrow();
  });

  test('日付が YYYY-MM-DD なら year が null の仕訳は投げる', () => {
    expect(() =>
      validateBackupPayload(payload({ journalEntries: [{ ...validEntry, year: null }] })),
    ).toThrow(/year/);
  });

  test('日付が YYYY-MM-DD でなくても year が文字列の仕訳は投げる', () => {
    expect(() =>
      validateBackupPayload(
        payload({ journalEntries: [{ ...validEntry, date: '2026/5/1', year: '2026' }] }),
      ),
    ).toThrow(/year/);
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
    expect(() => validateBackupPayload(payload({ invoices: [minRows.invoices] }))).not.toThrow();
  });

  test('id と documentType だけの invoices は投げる', () => {
    expect(() =>
      validateBackupPayload(payload({ invoices: [{ id: 'inv-1', documentType: 'invoice' }] })),
    ).toThrow(BackupValidationError);
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

describe('fixedAssets の型検証', () => {
  const minimalAsset = {
    id: 'a1',
    name: '什器',
    acquisitionDate: '2025-01-01',
    acquisitionCost: '300000',
    usefulLifeYears: 5,
    depreciationMethod: 'straight-line',
    accountCode: '1510',
  };
  const fullAsset = {
    ...minimalAsset,
    disposedDate: '2026-03-31',
    disposalType: 'sale',
    salePrice: '100000',
    saleExpenses: '5000',
    incomeType: 'realEstate',
    source: 'opening',
    conversionBasis: '250000',
    serviceStartDate: '2025-02-01',
    assetCategory: 2,
    isMineShaft: false,
    leaseContractDate: '2025-01-01',
    residualGuaranteeAmount: '10000',
    lumpSumPoolId: 'pool-1',
    usableLifeUnderOneYear: false,
    employeeCountAtAcquisition: 3,
    isLeasedOut: false,
    openingYear: 2025,
    essentialToBusiness: true,
    leaseTermMonths: 60,
    decliningBalanceElected: false,
    realEstateDetail: {
      propertyType: '貸家',
      isResidential: true,
      address: '東京都',
      tenantName: '山田',
      tenantAddress: '東京都',
      rentalPeriodStart: '2025-01-01',
      rentalPeriodEnd: '2025-12-31',
      areaSqm: '45',
      annualRent: '1200000',
      keyMoneyEtc: '100000',
      otherIncome: '0',
      depositBalance: '200000',
    },
  };
  const withDetail = (over: Record<string, unknown>) => ({
    ...minimalAsset,
    incomeType: 'realEstate',
    realEstateDetail: { ...fullAsset.realEstateDetail, ...over },
  });
  const check = (row: unknown) => () => validateBackupPayload(payload({ fixedAssets: [row] }));

  test('salePrice が数値なら投げる', () => {
    expect(check({ ...minimalAsset, salePrice: 1000 })).toThrow(BackupValidationError);
    expect(check({ ...minimalAsset, salePrice: 1000 })).toThrow(/fixedAssets/);
    expect(check({ ...minimalAsset, salePrice: 1000 })).toThrow(/salePrice/);
  });

  test('realEstateDetail.propertyType が数値なら投げる', () => {
    expect(check(withDetail({ propertyType: 123 }))).toThrow(BackupValidationError);
    expect(check(withDetail({ propertyType: 123 }))).toThrow(/realEstateDetail\.propertyType/);
  });

  test('realEstateDetail に address が無ければ投げる', () => {
    expect(check(withDetail({ address: undefined }))).toThrow(BackupValidationError);
  });

  test('usefulLifeYears が文字列なら投げる', () => {
    expect(check({ ...minimalAsset, usefulLifeYears: '10' })).toThrow(/usefulLifeYears/);
  });

  test('essentialToBusiness が文字列なら投げる', () => {
    expect(check({ ...minimalAsset, essentialToBusiness: 'true' })).toThrow(/essentialToBusiness/);
  });

  test('realEstateDetail が文字列なら投げる', () => {
    expect(check({ ...minimalAsset, realEstateDetail: 'x' })).toThrow(BackupValidationError);
  });

  test('realEstateDetail.tenantName が null なら投げる', () => {
    expect(check(withDetail({ tenantName: null }))).toThrow(/realEstateDetail\.tenantName/);
  });

  test('最初のバージョンの欄だけの資産は通る', () => {
    expect(check(minimalAsset)).not.toThrow();
  });

  test('全ての任意欄を型どおり持つ資産は通る', () => {
    expect(check(fullAsset)).not.toThrow();
  });
});

describe('各表の型検証：通る行', () => {
  test.each(Object.keys(minRows))('%s：必須欄だけ', (table) => {
    expect(() => validateBackupPayload(payload({ [table]: [minRows[table]!] }))).not.toThrow();
  });

  test.each(Object.keys(fullRows))('%s：任意欄もすべてある', (table) => {
    expect(() => validateBackupPayload(payload({ [table]: [fullRows[table]!] }))).not.toThrow();
  });

  test('全表をまとめても通る', () => {
    const tables: Record<string, unknown[]> = {};
    for (const [name, row] of Object.entries(fullRows)) {
      tables[name] = [row];
    }
    tables.journalEntries = [validEntry];
    expect(() => validateBackupPayload(payload(tables))).not.toThrow();
  });
});

describe('各表の型検証：再現した不正値を弾く', () => {
  const pd = fullRows.personalDeductions!;
  const snapshot = minRows.reportSnapshots!;
  const pl = {
    ...snapshot,
    type: 'pl',
    payload: {
      type: 'pl',
      data: { rows: [], totalRevenue: '0', totalExpense: '0', netIncome: '0' },
    },
  };
  const invoice = fullRows.invoices!;
  const item = (invoice.lineItems as Record<string, unknown>[])[0]!;
  const setting = (key: string, value: unknown) => ({ settings: [{ key, value, updatedAt: 1 }] });
  const cases: [string, Record<string, unknown[]>, string, RegExp][] = [
    [
      'budgets 月が無い',
      { budgets: [{ ...minRows.budgets, month: undefined }] },
      'budgets',
      /month/,
    ],
    [
      'accounts 年が無い',
      { accounts: [{ ...minRows.accounts, year: undefined }] },
      'accounts',
      /year/,
    ],
    [
      'reportSnapshots year が文字列',
      { reportSnapshots: [{ ...snapshot, year: '2026' }] },
      'reportSnapshots',
      /year/,
    ],
    [
      'reportSnapshots status が大文字',
      { reportSnapshots: [{ ...snapshot, status: 'Filed' }] },
      'reportSnapshots',
      /status/,
    ],
    [
      'reportSnapshots payload.type が外側と違う',
      { reportSnapshots: [{ ...snapshot, payload: { type: 'pl', data: {} } }] },
      'reportSnapshots',
      /payload\.type/,
    ],
    [
      'reportSnapshots totalRevenue が null',
      {
        reportSnapshots: [
          { ...pl, payload: { ...pl.payload, data: { ...pl.payload.data, totalRevenue: null } } },
        ],
      },
      'reportSnapshots',
      /payload\.data\.totalRevenue/,
    ],
    ['settings currentYear が文字列', setting('currentYear', '2026'), 'settings', /currentYear/],
    ['settings filingType が大文字', setting('filingType', 'Blue'), 'settings', /filingType/],
    [
      'settings cashBasisElection が文字列',
      setting('cashBasisElection', 'false'),
      'settings',
      /cashBasisElection/,
    ],
    [
      'settings homeOfficeAccountRatios の値が数値',
      setting('homeOfficeAccountRatios', { '5130': 0.3 }),
      'settings',
      /homeOfficeAccountRatios\.5130/,
    ],
    [
      'settings businessStartDate がスラッシュ区切り',
      setting('businessStartDate', '2026/03/01'),
      'settings',
      /businessStartDate/,
    ],
    [
      'personalDeductions dependents が null',
      { personalDeductions: [{ ...pd, dependents: null }] },
      'personalDeductions',
      /dependents/,
    ],
    [
      'personalDeductions spouse が null',
      { personalDeductions: [{ ...pd, spouse: null }] },
      'personalDeductions',
      /spouse/,
    ],
    [
      'personalDeductions lifeInsurance が null',
      { personalDeductions: [{ ...pd, lifeInsurance: null }] },
      'personalDeductions',
      /lifeInsurance/,
    ],
    [
      'personalDeductions rentPaid の要素が null',
      {
        personalDeductions: [
          { ...pd, realEstateIncome: { businessScale: false, rentPaid: [null] } },
        ],
      },
      'personalDeductions',
      /realEstateIncome\.rentPaid\[0\]/,
    ],
    [
      'personalDeductions dependents[0].disability が未知の値',
      {
        personalDeductions: [
          {
            ...pd,
            dependents: [{ id: 'd', name: 'n', age: 1, totalIncome: '0', disability: 'x' }],
          },
        ],
      },
      'personalDeductions',
      /dependents\[0\]\.disability/,
    ],
    [
      'personalDeductions isDisabled が文字列',
      { personalDeductions: [{ ...pd, isDisabled: 'false' }] },
      'personalDeductions',
      /isDisabled/,
    ],
    [
      'personalDeductions dependents[0].name が数値',
      {
        personalDeductions: [
          { ...pd, dependents: [{ id: 'd', name: 1, age: 1, totalIncome: '0' }] },
        ],
      },
      'personalDeductions',
      /dependents\[0\]\.name/,
    ],
    [
      'invoices 税率が 8',
      { invoices: [{ ...invoice, lineItems: [{ ...item, taxRate: 8 }] }] },
      'invoices',
      /lineItems\[0\]\.taxRate/,
    ],
    [
      'invoices 税率が null',
      { invoices: [{ ...invoice, lineItems: [{ ...item, taxRate: null }] }] },
      'invoices',
      /lineItems\[0\]\.taxRate/,
    ],
    [
      'invoices 税率が文字列',
      { invoices: [{ ...invoice, lineItems: [{ ...item, taxRate: '0.08' }] }] },
      'invoices',
      /lineItems\[0\]\.taxRate/,
    ],
    ['invoices date が数値', { invoices: [{ ...invoice, date: 20260501 }] }, 'invoices', /date/],
    [
      'parserRules pattern が無い',
      { parserRules: [{ ...minRows.parserRules, pattern: undefined }] },
      'parserRules',
      /pattern/,
    ],
    [
      'parserRules pattern が数値',
      { parserRules: [{ ...minRows.parserRules, pattern: 1 }] },
      'parserRules',
      /pattern/,
    ],
    [
      'arApEntries originalAmount が null',
      { arApEntries: [{ ...minRows.arApEntries, originalAmount: null }] },
      'arApEntries',
      /originalAmount/,
    ],
    [
      'arApEntries dueDate が数値',
      { arApEntries: [{ ...minRows.arApEntries, dueDate: 20260630 }] },
      'arApEntries',
      /dueDate/,
    ],
    [
      'budgets revenueBudget が数字でない',
      { budgets: [{ ...minRows.budgets, revenueBudget: 'abc' }] },
      'budgets',
      /revenueBudget/,
    ],
    [
      'accounts code が数値',
      { accounts: [{ ...minRows.accounts, code: 1110 }] },
      'accounts',
      /code/,
    ],
    ['vendors name が null', { vendors: [{ ...minRows.vendors, name: null }] }, 'vendors', /name/],
    [
      'attachments sha256 が短い',
      { attachments: [{ ...minRows.attachments, sha256: 'abc' }] },
      'attachments',
      /sha256/,
    ],
  ];

  test.each(cases)('%s', (_label, tables, table, path) => {
    expectRejected(tables, table, path);
  });

  test('decimal 欄の NaN と Infinity は弾く', () => {
    for (const bad of ['NaN', 'Infinity', '-Infinity']) {
      expectRejected(
        { budgets: [{ ...minRows.budgets, revenueBudget: bad }] },
        'budgets',
        /revenueBudget/,
      );
      expectRejected(
        { arApEntries: [{ ...minRows.arApEntries, paidAmount: bad }] },
        'arApEntries',
        /paidAmount/,
      );
      expectRejected(
        {
          reportSnapshots: [
            {
              ...snapshot,
              payload: { type: 'monthly-sales', data: { months: [{ month: 1, sales: bad }] } },
            },
          ],
        },
        'reportSnapshots',
        /payload\.data\.months\[0\]\.sales/,
      );
    }
  });
});

describe('プロトタイプと __proto__ による素通りを防ぐ', () => {
  test('tables のプロトタイプを差し替えたら弾く', () => {
    const tables = Object.setPrototypeOf({}, { reportSnapshots: [minRows.reportSnapshots] });
    expect(() =>
      validateBackupPayload({ version: 1, exportedAt: 'x', tables } as BackupPayload),
    ).toThrow(BackupValidationError);
  });

  test('行のプロトタイプを差し替えたら弾く', () => {
    const row = Object.setPrototypeOf({ id: 'v1' }, { name: 'プロトタイプ上の名前' });
    expectRejected({ vendors: [row] }, 'vendors', /通常のオブジェクトではありません/);
  });

  test('プロトタイプの無い行も弾く', () => {
    const row = Object.assign(Object.create(null) as object, minRows.vendors);
    expectRejected({ vendors: [row] }, 'vendors', /通常のオブジェクトではありません/);
  });

  test('配列のプロトタイプを差し替えたら弾く', () => {
    const rows = Object.setPrototypeOf([minRows.vendors], { length: 0 }) as unknown[];
    expect(() => validateBackupPayload(payload({ vendors: rows }))).toThrow(BackupValidationError);
    const lineItems = Object.setPrototypeOf([], {}) as unknown[];
    const invoice = { ...fullRows.invoices, lineItems };
    expectRejected({ invoices: [invoice] }, 'invoices', /lineItems/);
  });

  test('自分の欄として __proto__ を持つ行（JSON.parse が作る）は弾く', () => {
    const row = JSON.parse('{"id":"v1","name":"業者","__proto__":{"evil":true}}') as unknown;
    expectRejected({ vendors: [row] }, 'vendors', /__proto__/);
  });

  test('入れ子の __proto__ も弾く', () => {
    const detail = JSON.parse(
      '{"propertyType":"貸家","address":"東京都","annualRent":"1","__proto__":{}}',
    ) as unknown;
    expectRejected(
      { fixedAssets: [{ id: 'fa1', realEstateDetail: detail }] },
      'fixedAssets',
      /realEstateDetail/,
    );
  });

  test('行そのものの問題は「行に」「行が」、欄の問題は欄の道筋で示す', () => {
    const own = JSON.parse('{"id":"v1","name":"業者","__proto__":{}}') as unknown;
    expectRejected({ vendors: [own] }, 'vendors', /行に __proto__ という名前の欄があります/);
    const swapped = Object.setPrototypeOf({ id: 'v1' }, { name: 'x' }) as unknown;
    expectRejected({ vendors: [swapped] }, 'vendors', /行が通常のオブジェクトではありません/);
    const detail = JSON.parse(
      '{"propertyType":"貸家","address":"東京都","annualRent":"1","__proto__":{}}',
    ) as unknown;
    expectRejected(
      { fixedAssets: [{ id: 'fa1', realEstateDetail: detail }] },
      'fixedAssets',
      /realEstateDetail に __proto__ という名前の欄があります/,
    );
  });

  test('tables 直下の __proto__ は弾く', () => {
    const parsed = JSON.parse(
      `{"version":1,"exportedAt":"x","tables":{"__proto__":{"reportSnapshots":[${JSON.stringify(minRows.reportSnapshots)}]}}}`,
    ) as BackupPayload;
    expect(() => validateBackupPayload(parsed)).toThrow(BackupValidationError);
  });

  test('payload 自体のプロトタイプを差し替えたら弾く', () => {
    const p = Object.setPrototypeOf(
      { version: 1, exportedAt: 'x' },
      { tables: {} },
    ) as BackupPayload;
    expect(() => validateBackupPayload(p)).toThrow(BackupValidationError);
  });
});

describe('Object.prototype の名前を既知の項目として扱わない', () => {
  test('設定キー constructor は見ずに通す', () => {
    expect(() =>
      validateBackupPayload(payload({ settings: [{ key: 'constructor', value: 1 }] })),
    ).not.toThrow();
  });

  test('表名 toString は見ずに通す', () => {
    expect(() => validateBackupPayload(payload({ toString: [{ id: 1 }] }))).not.toThrow();
  });

  test('配列でない表 constructor は BackupValidationError', () => {
    expect(() =>
      validateBackupPayload(payload({ constructor: 'x' as unknown as unknown[] })),
    ).toThrow(BackupValidationError);
  });

  test('列挙欄の hasOwnProperty は BackupValidationError', () => {
    expectRejected(
      { accounts: [{ ...minRows.accounts, category: 'hasOwnProperty' }] },
      'accounts',
      /category/,
    );
    expectRejected(
      { settings: [{ key: 'aiEngine', value: 'hasOwnProperty' }] },
      'settings',
      /aiEngine/,
    );
  });

  test('toString を書き換えた値でも BackupValidationError になる', () => {
    expectRejected(
      { journalEntries: [{ ...validEntry, status: { toString: 'x', valueOf: 'y' } }] },
      'journalEntries',
      /status/,
    );
  });
});

describe('旧バージョン（v1.0.2）の形', () => {
  const legacy = () =>
    payload({
      journalEntries: [validEntry],
      journalLines: [{ ...validLine, quantity: 3 }],
      budgets: [{ year: 2026, month: 1, revenueBudget: 100000, expenseBudget: 50000 }],
      arApEntries: [{ ...minRows.arApEntries, originalAmount: 10000, paidAmount: 0 }],
      parserRules: [{ ...minRows.parserRules, priority: null }],
      personalDeductions: [
        {
          ...minRows.personalDeductions,
          spouse: { totalIncome: '0', age: null },
          dependents: [{ id: 'd1', name: '子', age: null, totalIncome: '0' }],
        },
      ],
      settings: [
        { key: 'currentYear', value: null, updatedAt: 1 },
        { key: 'ocrEngine', value: 'tesseract', updatedAt: 1 },
        { key: 'tesseractLangPath', value: '/lang', updatedAt: 1 },
      ],
    });

  test('通る', () => {
    expect(() => validateBackupPayload(legacy())).not.toThrow();
  });

  test('複製の値が今の型になる', () => {
    const original = legacy();
    const result = validateBackupPayload(original);
    expect(result.tables.journalLines?.[0]).toMatchObject({ quantity: '3' });
    expect(result.tables.budgets?.[0]).toMatchObject({
      revenueBudget: '100000',
      expenseBudget: '50000',
    });
    expect(result.tables.arApEntries?.[0]).toMatchObject({
      originalAmount: '10000',
      paidAmount: '0',
    });
    const keys = result.tables.settings?.map((r) => (r as { key: string }).key);
    expect(keys).toEqual(['ocrEngine', 'tesseractLangPath']);
  });

  test('受け取った payload は書き換えない', () => {
    const original = legacy();
    const result = validateBackupPayload(original);
    expect(result).not.toBe(original);
    expect(result.tables).not.toBe(original.tables);
    expect(original.tables.budgets?.[0]).toMatchObject({ revenueBudget: 100000 });
    expect(original.tables.settings).toHaveLength(3);
  });
});

describe('検証が返す複製', () => {
  test('素のオブジェクトと配列だけを複製し、関数はそのまま残す', () => {
    const fn = () => {};
    const row = { ...minRows.vendors, notCloneable: fn, aliases: ['a'] };
    const result = validateBackupPayload(payload({ vendors: [row] }));
    const copied = result.tables.vendors?.[0] as Record<string, unknown>;
    expect(copied).not.toBe(row);
    expect(copied.aliases).not.toBe(row.aliases);
    expect(copied.aliases).toEqual(['a']);
    expect(copied.notCloneable).toBe(fn);
  });
});

describe('PRIMARY_KEY と Dexie の keyPath', () => {
  test('復元する全表で一致する', () => {
    for (const t of db.tables) {
      if (NEVER_RESTORED.has(t.name)) {
        continue;
      }
      expect(PRIMARY_KEY[t.name], t.name).toEqual(t.schema.primKey.keyPath);
    }
  });

  test('複合主キーは欄ごとに確かめる', () => {
    expectRejected(
      { accounts: [{ ...minRows.accounts, code: undefined }] },
      'accounts',
      /主キー code/,
    );
    expectRejected({ budgets: [{ ...minRows.budgets, year: null }] }, 'budgets', /主キー year/);
  });
});

describe('処理年度の範囲', () => {
  test('範囲外の整数の年度は未設定として通し、複製から行を除く', () => {
    const result = validateBackupPayload(
      payload({
        settings: [
          { key: 'currentYear', value: 2019, updatedAt: 1 },
          { key: 'userBusinessName', value: '青井商店', updatedAt: 1 },
        ],
      }),
    );
    expect(result.tables.settings?.map((r) => (r as { key: string }).key)).toEqual([
      'userBusinessName',
    ]);
  });

  test('整数でない年度は弾く', () => {
    expect(() =>
      validateBackupPayload(payload({ settings: [{ key: 'currentYear', value: 2026.5 }] })),
    ).toThrow(BackupValidationError);
  });

  test('JSON の 1e309（読むと Infinity）の年度は弾く', () => {
    const parsed = JSON.parse(
      '{"version":1,"exportedAt":"2026-06-13T00:00:00.000Z","tables":{"settings":[{"key":"currentYear","value":1e309}]}}',
    ) as BackupPayload;
    expect(() => validateBackupPayload(parsed)).toThrow(BackupValidationError);
  });
});

describe('検証の判定を説明として返す関数', () => {
  test('journalEntryProblem', () => {
    expect(journalEntryProblem(validEntry)).toBeNull();
    expect(journalEntryProblem({ ...validEntry, date: '2026/05/01' })).toBeNull();
    expect(journalEntryProblem({ ...validEntry, date: 20260501 })).toBe(
      'date が YYYY-MM-DD ではありません',
    );
  });

  test('journalLineProblem', () => {
    expect(journalLineProblem(validLine)).toBeNull();
    expect(journalLineProblem({ ...validLine, side: 'x' })).toBe('side が不正：「x」');
  });

  test('primaryKeyProblem', () => {
    expect(primaryKeyProblem(['year', 'month'], minRows.budgets)).toBeNull();
    expect(primaryKeyProblem(['year', 'month'], { ...minRows.budgets, month: null })).toBe(
      '主キー month がありません',
    );
    expect(primaryKeyProblem('id', [])).toBe('オブジェクトではありません');
  });
});
