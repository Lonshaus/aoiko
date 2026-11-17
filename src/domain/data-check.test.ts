import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { Blob as NodeBlob } from 'node:buffer';
import { db } from '../db/db';
import { toIndexable } from '../lib/decimal';
import { checkStoredData, type DataCheckResult } from './data-check';
import type { SettingsMap } from '../lib/settings';
import type {
  Account,
  ArApEntry,
  Budget,
  FixedAsset,
  ImportBatch,
  Invoice,
  JournalEntry,
  JournalLine,
  ParserRule,
  PersonalDeductionInput,
  ReportSnapshot,
  SubAccount,
  Vendor,
} from '../db/types';

const entry: JournalEntry = {
  id: 'e1',
  date: '2026-05-01',
  year: 2026,
  description: '家賃',
  status: 'confirmed',
  originalEntryId: 'e0',
  reversedByEntryId: 'e2',
  source: 'csv',
  sourceImportId: 'ib1',
  createdAt: 1,
  confirmedAt: 2,
  department: '本店',
};
const line: JournalLine = {
  id: 'l1',
  entryId: 'e1',
  side: 'debit',
  accountCode: '5130',
  subAccountId: 'sa1',
  vendorId: 'v1',
  amount: '5000',
  amountIndexed: toIndexable('5000'),
  taxRate: 0.1,
  taxIncluded: true,
  invoiceCompliant: true,
  homeOfficeRatio: '0.5',
  memo: 'メモ',
  taxCategory: 'taxable10',
  inputUsageCategory: 'common',
  itemId: 'it1',
  quantity: '2',
  taxableTransferConsideration: '1000',
};
const account: Account = {
  code: '5130',
  year: 2026,
  name: '水道光熱費',
  category: 'expense',
  taxCategory: 'taxable10',
  parentCode: '5100',
  displayOrder: 10,
  isActive: true,
  incomeType: 'business',
};
const subAccount: SubAccount = {
  id: 'sa1',
  accountCode: '5130',
  name: '電気',
  metadata: { k: 'v' },
};
const vendor: Vendor = {
  id: 'v1',
  name: '業者',
  entityType: 'corporation',
  invoiceNumber: 'T1234567890123',
  invoiceVerifiedAt: 1,
  invoiceValid: true,
  defaultAccountCode: '5130',
  defaultTaxRate: 0.1,
  aliases: ['別名'],
  address: '東京都',
};
const asset: FixedAsset = {
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
};
const snapshot: ReportSnapshot = {
  id: 'rs1',
  year: 2026,
  type: 'pl',
  status: 'draft',
  filedAt: 3,
  payload: {
    type: 'pl',
    data: {
      rows: [{ accountCode: '4110', amount: '100' }],
      totalRevenue: '100',
      totalExpense: '0',
      netIncome: '100',
    },
  },
  generatedAt: 2,
  generatedFromEntriesUpTo: '2026-12-31',
};
const deduction: PersonalDeductionInput = {
  year: 2026,
  socialInsurancePaid: '1',
  smallBusinessMutualAidPaid: '2',
  lifeInsurance: {
    newGeneral: '1',
    oldGeneral: '2',
    newMedical: '3',
    newPension: '4',
    oldPension: '5',
  },
  earthquakeInsurancePaid: '3',
  oldLongTermInsurancePaid: '4',
  medicalExpensePaid: '5',
  medicalInsuranceReimbursement: '6',
  donationAmount: '7',
  casualtyLossDeduction: '8',
  isDisabled: false,
  isSpecialDisabled: false,
  isSingleParent: true,
  isWidow: false,
  isWorkingStudent: false,
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
  salaryIncome: { paidAmount: '1', withholdingTax: '0', lastPaymentBeforeDecember: true },
  miscIncome: {
    publicPensionAmount: '0',
    publicPensionInputMode: 'revenue',
    publicPensionRevenue: '0',
    publicPensionAge65OrOver: true,
    otherIncome: '0',
    otherExpenses: '0',
  },
  otherWithholdingTax: '0',
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
    { id: 'f1', name: '妻', relation: 'spouse', age: 40, monthsWorked: 12, incomeType: 'business' },
  ],
  priorPriorBusinessRevenue: '0',
  priorPriorRealEstateRevenue: '0',
  homeWorker: false,
  updatedAt: 4,
};
const budget: Budget = { year: 2026, month: 1, revenueBudget: '100000', expenseBudget: '50000' };
const arAp: ArApEntry = {
  id: 'ar1',
  type: 'receivable',
  description: '売掛',
  dueDate: '2026-06-30',
  originalAmount: '10000',
  paidAmount: '0',
  createdAt: 1,
};
const invoice: Invoice = {
  id: 'inv-1',
  documentType: 'invoice',
  status: 'issued',
  number: 'INV-0001',
  vendorId: 'v1',
  date: '2026-05-01',
  dueDate: '2026-05-31',
  lineItems: [{ id: 'li1', name: '作業', quantity: '1', unitPrice: '1000', taxRate: 0.08 }],
  memo: 'メモ',
  journalEntryId: 'e1',
  arApEntryId: 'ar1',
  convertedToInvoiceId: 'inv-2',
  createdAt: 1,
  issuedAt: 2,
  voidedAt: 3,
};
const rule: ParserRule = {
  id: 'pr1',
  matchType: 'regex',
  pattern: '電気',
  vendorId: 'v1',
  accountCode: '5130',
  priority: 1,
  hitCount: 2,
  lastHitAt: 3,
};
const batch: ImportBatch = {
  id: 'ib1',
  parserName: 'generic',
  fileName: 'a.csv',
  fileHash: 'h',
  importedAt: 1,
  rowCount: 1,
};
// ③④⑤⑥ のすべてのキー。
const restorableSettings: { [K in keyof SettingsMap]?: SettingsMap[K] } = {
  currentYear: 2026,
  userBusinessName: '青井商店',
  userInvoiceNumber: 'T1234567890123',
  invoiceNumberPrefix: 'INV-',
  quoteNumberPrefix: 'Q-',
  filingType: 'blue',
  aoiroDeductionKind: 'eTax',
  cashBasisElection: false,
  realEstateIncomeEnabled: true,
  businessStartDate: '2020-04-01',
  businessCloseDate: '',
  homeOfficeAccountRatios: { '5130': '0.30' },
  inventoryAutoValuationEnabled: true,
  taxRegistration: 'taxable',
  taxFilingMethod: 'two-wari',
  simplifiedTaxCategory: 5,
  consumptionTaxAttributionMethod: 'individual',
  invoiceRegistrationStartDate: '2023-10-01',
  taxableElectionPeriod: { fromYear: 2024, toYear: 2026 },
  inheritanceSpecialDate: '',
  adjustedFixedAssetDate: '',
  shortenedTaxPeriod: { from: '2026-01-01', to: '2026-03-31' },
  foreignWithoutDomesticPe: false,
  basePeriodTaxableSales: '1000',
  specifiedPeriodTaxableSales: '500',
  simplifiedElectionFiledDate: '2025-12-01',
  interimVoluntaryFiled: false,
  interimVoluntaryLapsed: false,
  interimPriorPeriodMonths: { 2026: 6 },
  wariBaseAdjustments: {
    2026: {
      salesReturnTax78: '1',
      salesReturnTax624: '2',
      specifiedSmallAssetTransfers: [{ date: '2026-01-01', rate: 0.1, netTax: '3' }],
    },
  },
  aiEngine: 'openai-compatible',
  geminiModel: 'gemini-x',
  openaiBaseUrl: 'http://localhost:11434/v1',
  openaiOcrModel: 'vision',
  openaiClassifyModel: 'text',
  receiptMethod: 'rule',
  receiptRuleEngine: 'tesseract',
  geminiApiKey: 'gkey',
  openaiApiKey: 'okey',
  userRiyoshaId: '1234567890123456',
  userFilerName: '青井 太郎',
  userFilerZip: '1000001',
  userFilerAddress: '東京都',
  userZeimushoCode: '01101',
  userZeimushoName: '麹町',
};

async function seedEveryTable(): Promise<void> {
  await db.journalEntries.add(entry);
  await db.journalLines.add(line);
  await db.accounts.add(account);
  await db.subAccounts.add(subAccount);
  await db.vendors.add(vendor);
  await db.inventoryItems.add({ id: 'it1', name: '商品' });
  await db.fixedAssets.add(asset);
  await db.reportSnapshots.add(snapshot);
  await db.personalDeductions.add(deduction);
  await db.budgets.add(budget);
  await db.arApEntries.add(arAp);
  await db.invoices.add(invoice);
  await db.parserRules.add(rule);
  await db.importBatches.add(batch);
  await db.attachments.add({
    id: 'at1',
    entryId: 'e1',
    blob: new NodeBlob([new Uint8Array([1, 2, 3])]) as unknown as Blob,
    mimeType: 'image/png',
    fileName: 'a.png',
    createdAt: 1,
    sha256: 'd'.repeat(64),
  });
  await db.settings.bulkPut([
    ...Object.entries(restorableSettings).map(([key, value]) => ({ key, value, updatedAt: 5 })),
    { key: 'ocrEngine', value: 'gemini', updatedAt: 5 },
  ]);
}
// 型を外して書く。復元の検証が入る前の経路で入り得た形を再現するため。
function putRaw(table: string, row: unknown): Promise<unknown> {
  return db.table(table).put(row);
}

function tableOf(result: DataCheckResult, name: string) {
  return result.tables.find((t) => t.table === name);
}

async function dumpAll(): Promise<Record<string, unknown[]>> {
  const out: Record<string, unknown[]> = {};
  for (const t of db.tables) {
    out[t.name] = await t.toArray();
  }
  return out;
}

beforeEach(async () => {
  await db.delete();
  await db.open();
});

afterEach(async () => {
  await db.delete();
});

describe('checkStoredData：問題の無いデータ', () => {
  test('全表の任意欄と ③④⑤⑥ の全設定があっても 0 件', async () => {
    await seedEveryTable();
    expect(await checkStoredData()).toEqual({ total: 0, tables: [], fingerprint: '' });
  });

  test('v1.0.2 の形は旧形式として通り 0 件', async () => {
    await db.journalEntries.add(entry);
    await putRaw('journalLines', { ...line, quantity: 3 });
    await putRaw('budgets', { year: 2026, month: 1, revenueBudget: 100000, expenseBudget: 0 });
    await putRaw('arApEntries', { ...arAp, originalAmount: 10000, paidAmount: 2500 });
    await putRaw('parserRules', { ...rule, priority: null });
    await putRaw('personalDeductions', {
      ...deduction,
      spouse: { totalIncome: '0', age: null },
      dependents: [{ id: 'd1', name: '子', age: null, totalIncome: '0' }],
    });
    await db.settings.bulkPut([
      { key: 'ocrEngine', value: 'tesseract', updatedAt: 1 },
      { key: 'tesseractLangPath', value: '/lang', updatedAt: 1 },
    ]);
    expect((await checkStoredData()).total).toBe(0);
  });

  test('端末専用の設定キーと stamps は見ない', async () => {
    await db.settings.put({ key: 'lastBackupAt', value: 'x', updatedAt: 1 });
    await putRaw('stamps', { id: 's1', shape: 1, color: null, at: 2, createdAt: 'x' });
    expect((await checkStoredData()).total).toBe(0);
  });
});

describe('checkStoredData：復元の規則に合わない行', () => {
  interface Case {
    label: string;
    table: string;
    path: string;
    row: unknown;
  }
  const cases: Case[] = [
    {
      label: 'reportSnapshots の year が文字列',
      table: 'reportSnapshots',
      path: 'year',
      row: { ...snapshot, year: '2026' },
    },
    {
      label: 'personalDeductions の dependents が null',
      table: 'personalDeductions',
      path: 'dependents',
      row: { ...deduction, dependents: null },
    },
    {
      label: 'personalDeductions の isDisabled が文字列',
      table: 'personalDeductions',
      path: 'isDisabled',
      row: { ...deduction, year: 2025, isDisabled: 'false' },
    },
    {
      label: 'invoices の税率が 8',
      table: 'invoices',
      path: 'lineItems[0].taxRate',
      row: { ...invoice, lineItems: [{ ...invoice.lineItems[0], taxRate: 8 }] },
    },
    {
      label: 'invoices の date が数値',
      table: 'invoices',
      path: 'date',
      row: { ...invoice, id: 'inv-2', date: 20260501 },
    },
    {
      label: 'parserRules の regex に pattern が無い',
      table: 'parserRules',
      path: 'pattern',
      row: { id: 'pr1', matchType: 'regex', priority: 1, hitCount: 0 },
    },
    {
      label: 'arApEntries の originalAmount が null',
      table: 'arApEntries',
      path: 'originalAmount',
      row: { ...arAp, originalAmount: null },
    },
    {
      label: 'settings の cashBasisElection が文字列',
      table: 'settings',
      path: 'cashBasisElection',
      row: { key: 'cashBasisElection', value: 'false', updatedAt: 1 },
    },
    {
      label: 'settings の homeOfficeAccountRatios の値が数値',
      table: 'settings',
      path: 'homeOfficeAccountRatios.5130',
      row: { key: 'homeOfficeAccountRatios', value: { '5130': 0.3 }, updatedAt: 1 },
    },
    {
      label: 'budgets の revenueBudget が数値でない',
      table: 'budgets',
      path: 'revenueBudget',
      row: { ...budget, revenueBudget: 'abc' },
    },
    {
      label: 'accounts の year が文字列',
      table: 'accounts',
      path: 'year',
      row: { ...account, year: '2026' },
    },
    {
      label: 'vendors の name が null',
      table: 'vendors',
      path: 'name',
      row: { ...vendor, name: null },
    },
    {
      label: 'journalEntries の date が YYYY-MM-DD でない',
      table: 'journalEntries',
      path: 'date',
      row: { ...entry, date: '2026/05/01' },
    },
    {
      label: 'journalLines の entryId に仕訳が無い',
      table: 'journalLines',
      path: 'entryId',
      row: { ...line, entryId: 'missing' },
    },
  ];

  test.each(cases)('$label', async ({ table, path, row }) => {
    await putRaw(table, row);
    const result = await checkStoredData();
    expect(result.total).toBe(1);
    const found = tableOf(result, table);
    expect(found?.count).toBe(1);
    expect(found?.samples).toHaveLength(1);
    expect(found?.samples[0]).toContain(path);
  });

  test('全部をまとめて入れると表ごとに数える', async () => {
    for (const c of cases) {
      await putRaw(c.table, c.row);
    }
    const result = await checkStoredData();
    const counts = Object.fromEntries(result.tables.map((t) => [t.table, t.count]));
    expect(counts).toEqual({
      journalEntries: 1,
      journalLines: 1,
      accounts: 1,
      vendors: 1,
      parserRules: 1,
      reportSnapshots: 1,
      settings: 2,
      personalDeductions: 2,
      budgets: 1,
      arApEntries: 1,
      invoices: 2,
    });
    expect(result.total).toBe(cases.length);
    expect(result.tables.map((t) => t.table)).toEqual([
      'journalEntries',
      'journalLines',
      'accounts',
      'vendors',
      'parserRules',
      'reportSnapshots',
      'settings',
      'personalDeductions',
      'budgets',
      'arApEntries',
      'invoices',
    ]);
  });

  test('同じ表に 5 件あれば件数は 5、例は 3 件', async () => {
    for (let i = 0; i < 5; i++) {
      await putRaw('vendors', { id: `v${i}`, name: null });
    }
    const found = tableOf(await checkStoredData(), 'vendors');
    expect(found?.count).toBe(5);
    expect(found?.samples).toHaveLength(3);
  });

  test('複合主キーは / でつないで示す', async () => {
    await putRaw('budgets', { ...budget, revenueBudget: 'abc' });
    const found = tableOf(await checkStoredData(), 'budgets');
    expect(found?.samples[0]).toBe('2026/1：revenueBudget が数値の文字列ではありません（「abc」）');
  });

  test('点検の前後でデータベースの中身は変わらない', async () => {
    await seedEveryTable();
    for (const c of cases) {
      await putRaw(c.table, c.row);
    }
    const before = await dumpAll();
    await checkStoredData();
    expect(await dumpAll()).toEqual(before);
  });
});

describe('checkStoredData：日付を読み取れない仕訳', () => {
  const oldOcrEntry = {
    description: 'レシート',
    source: 'ocr',
    createdAt: 1,
    confirmedAt: 1,
  };

  test('訂正済み（reversed）のものは挙げない', async () => {
    await putRaw('journalEntries', {
      ...oldOcrEntry,
      id: 'r1',
      date: '2026/5/1',
      year: 2026,
      status: 'reversed',
    });
    await putRaw('journalEntries', {
      ...oldOcrEntry,
      id: 'r2',
      date: '令和8年5月1日',
      year: NaN,
      status: 'reversed',
    });
    await putRaw('journalEntries', {
      ...oldOcrEntry,
      id: 'r3',
      date: '12.5.2026',
      year: 12.5,
      status: 'reversed',
    });
    expect((await checkStoredData()).total).toBe(0);
  });

  test.each([
    { label: '空の日付・year 0', date: '', year: 0 },
    { label: '和暦の日付・year NaN', date: '令和8年5月1日', year: NaN },
  ])('確定仕訳は挙げる（$label）', async ({ date, year }) => {
    await putRaw('journalEntries', { ...oldOcrEntry, id: 'c1', date, year, status: 'confirmed' });
    const result = await checkStoredData();
    expect(result.total).toBe(1);
    const found = tableOf(result, 'journalEntries');
    expect(found?.count).toBe(1);
    expect(found?.samples[0]).toContain('date');
  });
});

describe('checkStoredData：大きな値と表示の安全', () => {
  test('5 MB の値や主キーでも先頭 40 字で示す', { timeout: 60_000 }, async () => {
    await putRaw('vendors', { id: 'v1', name: 'A', entityType: 'x'.repeat(5_000_000) });
    await putRaw('vendors', { id: 'y'.repeat(5_000_000), name: null });
    const found = tableOf(await checkStoredData(), 'vendors');
    expect(found?.count).toBe(2);
    expect(found?.samples).toHaveLength(2);
    expect(found?.samples).toEqual(
      expect.arrayContaining([
        'v1：entityType が不正です（「' + 'x'.repeat(40) + '…」）',
        'y'.repeat(40) + '…：name が文字列ではありません（null）',
      ]),
    );
  });

  test('主キーが配列なら String() を通さず行の番号で示す', { timeout: 60_000 }, async () => {
    const id = Array.from({ length: 100_000 }, (_, i) => i);
    await putRaw('vendors', { id, name: 'A' });
    const found = tableOf(await checkStoredData(), 'vendors');
    expect(found?.count).toBe(1);
    expect(found?.samples[0]).toMatch(/^\d+ 行目：/);
  });

  test('自分の欄に __proto__ を持つ行は問題として示す', async () => {
    await putRaw('vendors', JSON.parse('{"id":"v1","name":"A","__proto__":{"name":1}}'));
    const found = tableOf(await checkStoredData(), 'vendors');
    expect(found?.count).toBe(1);
    expect(found?.samples[0]).toBe('v1：行に __proto__ という名前の欄があります');
  });

  test('欄の問題と仕訳の無い entryId を併せ持つ明細も 1 行として数える', async () => {
    await putRaw('journalLines', { ...line, side: 'x', entryId: 'missing' });
    await putRaw('journalLines', { ...line, id: 'l2', entryId: 'missing' });
    const result = await checkStoredData();
    expect(tableOf(result, 'journalLines')?.count).toBe(2);
    expect(result.total).toBe(2);
  });

  test('説明の中の制御文字と双方向の制御文字は置き換える', async () => {
    await putRaw('vendors', { id: 'v1', name: 'A', entityType: 'a‮b\nc' });
    const sample = tableOf(await checkStoredData(), 'vendors')?.samples[0] ?? '';
    expect(sample).toContain('a�b�c');
    expect(sample).not.toMatch(/[‮\n]/);
  });
});

describe('checkStoredData：指紋', () => {
  test('データが同じなら 2 回の点検で同じ', async () => {
    await putRaw('vendors', { id: 'v1', name: null });
    const first = await checkStoredData();
    const second = await checkStoredData();
    expect(first.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(second.fingerprint).toBe(first.fingerprint);
  });

  test('同じ表で問題の行が入れ替わると、件数が同じでも変わる', async () => {
    await putRaw('vendors', { id: 'v1', name: null });
    const first = await checkStoredData();
    await db.vendors.delete('v1');
    await putRaw('vendors', { id: 'v2', name: null });
    const second = await checkStoredData();
    expect(second.total).toBe(first.total);
    expect(second.fingerprint).not.toBe(first.fingerprint);
  });
});
