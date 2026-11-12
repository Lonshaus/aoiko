import { toAmountString } from '../lib/decimal';
import { parseLegacyLineAmount, parseStoredDecimal } from '../lib/amount-input';
import { isProcessingYear } from '../lib/initial-processing-year';
import type {
  AccountCategory,
  ArApType,
  AssetCategory,
  DepreciationMethod,
  DisposalType,
  EntrySource,
  FamilyEmployeeRelation,
  IncomeType,
  InputUsageCategory,
  Invoice,
  InvoiceDocumentType,
  InvoiceLineItem,
  JournalEntry,
  LineSide,
  ParserRuleMatchType,
  RelativeDisability,
  ReportSnapshot,
  TaxCategory,
  TaxFilingMethod,
  TaxRegistration,
  VendorEntityType,
} from '../db/types';
import type { AiEngine, ReceiptMethod, ReceiptRuleEngine, SettingsMap } from '../lib/settings';
import type { AoiroDeductionKind } from '../tax-schema/2026/aoiro-deduction';
import type { SimplifiedTaxCategory } from '../tax-schema/2026/simplified-tax';
import type { FilingType } from '../tax-schema/2026/xtx';
// 復元するバックアップの列の仕様。検証は restore-validate.ts が呼ぶ。
export type Spec =
  | { readonly t: 'string'; readonly nonEmpty?: true }
  | { readonly t: 'number' }
  | { readonly t: 'integer'; readonly min?: number; readonly max?: number }
  | { readonly t: 'boolean' }
  | { readonly t: 'enum'; readonly values: ReadonlySet<unknown> }
  | { readonly t: 'decimal' }
  | { readonly t: 'sha256' }
  | { readonly t: 'isoDateOrEmpty' }
  | { readonly t: 'nullable'; readonly of: Spec }
  | { readonly t: 'array'; readonly of: Spec }
  | { readonly t: 'record'; readonly of: Spec }
  | { readonly t: 'object'; readonly fields: Fields };
type Field = readonly [name: string, spec: Spec, optional: boolean];
type Fields = readonly Field[];

const MAX_SHOWN_CHARS = 40;

const str: Spec = { t: 'string' };
const strNE: Spec = { t: 'string', nonEmpty: true };
const num: Spec = { t: 'number' };
const int: Spec = { t: 'integer' };
const bool: Spec = { t: 'boolean' };
const dec: Spec = { t: 'decimal' };

function intIn(min: number, max: number): Spec {
  return { t: 'integer', min, max };
}

function nullable(of: Spec): Spec {
  return { t: 'nullable', of };
}

function arr(of: Spec): Spec {
  return { t: 'array', of };
}

function rec(of: Spec): Spec {
  return { t: 'record', of };
}

function obj(...fields: Field[]): Spec {
  return { t: 'object', fields };
}

function req(name: string, spec: Spec): Field {
  return [name, spec, false];
}

function opt(name: string, spec: Spec): Field {
  return [name, spec, true];
}
// 型の列挙値を書き漏らすとコンパイルで止まる。
type Exhaustive<T, A extends readonly unknown[]> = [Exclude<T, A[number]>] extends [never]
  ? A
  : never;
function enumOf<T extends string | number>() {
  return <const A extends readonly T[]>(values: A & Exhaustive<T, A>): Spec => ({
    t: 'enum',
    values: new Set<unknown>(values),
  });
}
// 長い文字列全体を文字の配列にしない。先頭の上限 2 倍ぶん（UTF-16 単位）で上限の文字数は必ず取れる。
export function clip(s: string): string {
  if (s.length <= MAX_SHOWN_CHARS) {
    return s;
  }
  const chars = Array.from(s.slice(0, MAX_SHOWN_CHARS * 2));
  return chars.length > MAX_SHOWN_CHARS || s.length > MAX_SHOWN_CHARS * 2
    ? `${chars.slice(0, MAX_SHOWN_CHARS).join('')}…`
    : s;
}
// 文字列以外は String() を通さない。toString を書き換えた値で検証自体が例外を投げないため。
export function describeValue(v: unknown): string {
  if (typeof v === 'string') {
    return `「${clip(v)}」`;
  }
  if (v === null) {
    return 'null';
  }
  if (Array.isArray(v)) {
    return 'array';
  }
  return typeof v;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function own(o: Record<string, unknown>, key: string): unknown {
  return Object.hasOwn(o, key) ? o[key] : undefined;
}

function child(path: string, name: string): string {
  return path === '' ? name : `${path}.${name}`;
}

function isDecimal(v: string): boolean {
  return parseStoredDecimal(v, { allowNegative: true }) !== undefined;
}

function checkValue(spec: Spec, v: unknown, path: string): string | null {
  switch (spec.t) {
    case 'string':
      if (typeof v !== 'string') {
        return `${path} が文字列ではありません（${describeValue(v)}）`;
      }
      if (spec.nonEmpty && v.length === 0) {
        return `${path} が空です`;
      }
      return null;
    case 'number':
      return typeof v === 'number' ? null : `${path} が数値ではありません（${describeValue(v)}）`;
    case 'integer':
      if (typeof v !== 'number' || !Number.isInteger(v)) {
        return `${path} が整数ではありません（${describeValue(v)}）`;
      }
      if ((spec.min !== undefined && v < spec.min) || (spec.max !== undefined && v > spec.max)) {
        return `${path} が範囲外です`;
      }
      return null;
    case 'boolean':
      return typeof v === 'boolean'
        ? null
        : `${path} が真偽値ではありません（${describeValue(v)}）`;
    case 'enum':
      return spec.values.has(v) ? null : `${path} が不正です（${describeValue(v)}）`;
    case 'decimal':
      return typeof v === 'string' && isDecimal(v)
        ? null
        : `${path} が数値の文字列ではありません（${describeValue(v)}）`;
    case 'sha256':
      return typeof v === 'string' && /^[0-9a-f]{64}$/.test(v)
        ? null
        : `${path} が SHA-256 の形式ではありません（${describeValue(v)}）`;
    case 'isoDateOrEmpty':
      return typeof v === 'string' && (v === '' || /^\d{4}-\d{2}-\d{2}$/.test(v))
        ? null
        : `${path} が YYYY-MM-DD ではありません（${describeValue(v)}）`;
    case 'nullable':
      return v === null ? null : checkValue(spec.of, v, path);
    case 'array':
      if (!Array.isArray(v)) {
        return `${path} が配列ではありません（${describeValue(v)}）`;
      }
      for (let i = 0; i < v.length; i++) {
        const found = checkValue(spec.of, v[i], `${path}[${i}]`);
        if (found !== null) {
          return found;
        }
      }
      return null;
    case 'record':
      if (!isPlainObject(v)) {
        return `${path} がオブジェクトではありません（${describeValue(v)}）`;
      }
      for (const key of Object.keys(v)) {
        const found = checkValue(spec.of, v[key], child(path, clip(key)));
        if (found !== null) {
          return found;
        }
      }
      return null;
    case 'object':
      if (!isPlainObject(v)) {
        return `${path} がオブジェクトではありません（${describeValue(v)}）`;
      }
      return checkFields(spec.fields, v, path);
  }
}

function checkFields(fields: Fields, o: Record<string, unknown>, path: string): string | null {
  for (const [name, spec, optional] of fields) {
    const v = own(o, name);
    const p = child(path, name);
    if (v === undefined) {
      if (optional) {
        continue;
      }
      return `${p} がありません`;
    }
    const found = checkValue(spec, v, p);
    if (found !== null) {
      return found;
    }
  }
  return null;
}

const incomeType = enumOf<IncomeType>()(['business', 'realEstate']);
const taxCategory = enumOf<TaxCategory>()([
  'taxable10',
  'taxable8',
  'exempt',
  'nontaxable',
  'exportExempt',
  'importTax10',
  'importTax8',
  'reverseCharge',
  'badDebt',
  'badDebtRecovery',
]);
const taxFilingMethod = enumOf<TaxFilingMethod>()([
  'general',
  'simplified',
  'two-wari',
  'three-wari',
]);
const disability = enumOf<RelativeDisability>()([
  'none',
  'disabled',
  'special',
  'specialCohabiting',
]);
const payeeFields = [opt('payeeAddress', str), opt('payeeName', str), req('amount', str)];
const amountRows = arr(obj(req('accountCode', str), req('amount', dec)));
// 固定資産はこれまでの検証と同じく、主キー以外の欄は有無を問わない。
const fixedAssetFields: Fields = [
  opt('name', str),
  opt('acquisitionDate', str),
  opt('acquisitionCost', str),
  opt('usefulLifeYears', num),
  opt(
    'depreciationMethod',
    enumOf<DepreciationMethod>()([
      'straight-line',
      'declining-balance',
      'small-asset-special',
      'lump-sum',
      'old-straight-line',
      'old-declining-balance',
      'lease-period-straight-line',
    ]),
  ),
  opt('accountCode', str),
  opt('disposedDate', str),
  opt('disposalType', enumOf<DisposalType>()(['scrap', 'sale'])),
  opt('salePrice', str),
  opt('saleExpenses', str),
  opt('incomeType', incomeType),
  opt('source', enumOf<'opening'>()(['opening'])),
  opt(
    'realEstateDetail',
    obj(
      req('propertyType', str),
      opt('isResidential', bool),
      req('address', str),
      opt('tenantName', str),
      opt('tenantAddress', str),
      opt('rentalPeriodStart', str),
      opt('rentalPeriodEnd', str),
      opt('areaSqm', str),
      req('annualRent', str),
      opt('keyMoneyEtc', str),
      opt('otherIncome', str),
      opt('depositBalance', str),
    ),
  ),
  opt('conversionBasis', str),
  opt('serviceStartDate', str),
  opt('assetCategory', enumOf<AssetCategory>()([1, 2, 3, 4, 5, 6, 7, 8, 9])),
  opt('isMineShaft', bool),
  opt('leaseContractDate', str),
  opt('residualGuaranteeAmount', str),
  opt('lumpSumPoolId', str),
  opt('usableLifeUnderOneYear', bool),
  opt('employeeCountAtAcquisition', num),
  opt('isLeasedOut', bool),
  opt('openingYear', num),
  opt('essentialToBusiness', bool),
  opt('leaseTermMonths', num),
  opt('decliningBalanceElected', bool),
];

const TABLE_FIELDS: ReadonlyMap<string, Fields> = new Map<string, Fields>([
  [
    'journalEntries',
    [
      req('id', strNE),
      req('date', str),
      req('year', nullable(num)),
      req('description', str),
      req('status', enumOf<JournalEntry['status']>()(['confirmed', 'reversed'])),
      opt('originalEntryId', str),
      opt('reversedByEntryId', str),
      req(
        'source',
        enumOf<EntrySource>()([
          'manual',
          'csv',
          'extension',
          'ocr',
          'carryover',
          'paste',
          'opening',
          'badDebtReversal',
        ]),
      ),
      opt('sourceImportId', str),
      req('createdAt', num),
      req('confirmedAt', num),
      opt('department', str),
    ],
  ],
  [
    'journalLines',
    [
      req('id', strNE),
      req('entryId', strNE),
      req('accountCode', strNE),
      req('side', enumOf<LineSide>()(['debit', 'credit'])),
      opt('subAccountId', str),
      opt('vendorId', str),
      req('amount', str),
      req('amountIndexed', str),
      req('taxRate', num),
      req('taxIncluded', bool),
      req('invoiceCompliant', bool),
      opt('homeOfficeRatio', str),
      opt('memo', str),
      opt('taxCategory', taxCategory),
      opt(
        'inputUsageCategory',
        enumOf<InputUsageCategory>()(['taxableOnly', 'common', 'nonTaxableOnly']),
      ),
      opt('itemId', str),
      opt('quantity', str),
      opt('taxableTransferConsideration', str),
    ],
  ],
  [
    'accounts',
    [
      req('code', str),
      req('year', int),
      req('name', str),
      req(
        'category',
        enumOf<AccountCategory>()(['asset', 'liability', 'equity', 'revenue', 'expense']),
      ),
      opt('taxCategory', taxCategory),
      opt('parentCode', str),
      req('displayOrder', num),
      opt('isActive', bool),
      opt('incomeType', incomeType),
    ],
  ],
  [
    'subAccounts',
    [req('id', str), req('accountCode', str), req('name', str), opt('metadata', rec(str))],
  ],
  [
    'vendors',
    [
      req('id', str),
      req('name', str),
      opt(
        'entityType',
        enumOf<VendorEntityType>()(['corporation', 'individual', 'public', 'foreign', 'unknown']),
      ),
      opt('invoiceNumber', str),
      opt('invoiceVerifiedAt', num),
      opt('invoiceValid', bool),
      opt('defaultAccountCode', str),
      opt('defaultTaxRate', num),
      opt('aliases', arr(str)),
      opt('address', str),
    ],
  ],
  ['fixedAssets', fixedAssetFields],
  [
    'parserRules',
    [
      req('id', str),
      req(
        'matchType',
        enumOf<ParserRuleMatchType>()(['vendor-name', 'description-includes', 'regex']),
      ),
      req('pattern', str),
      opt('vendorId', str),
      opt('accountCode', str),
      req('priority', nullable(num)),
      req('hitCount', num),
      opt('lastHitAt', num),
    ],
  ],
  [
    'importBatches',
    [
      req('id', str),
      req('parserName', str),
      req('fileName', str),
      req('fileHash', str),
      req('importedAt', num),
      req('rowCount', num),
    ],
  ],
  [
    'reportSnapshots',
    [
      req('id', str),
      req('year', int),
      req(
        'type',
        enumOf<ReportSnapshot['type']>()(['monthly-sales', 'pl', 'bs', 'consumption-tax']),
      ),
      req('status', enumOf<ReportSnapshot['status']>()(['draft', 'filed', 'superseded'])),
      opt('filedAt', num),
      req('payload', obj()),
      req('generatedAt', num),
      req('generatedFromEntriesUpTo', str),
      opt('excludesNonPurchaseAssets', bool),
    ],
  ],
  ['inventoryItems', [req('id', str), req('name', str)]],
  [
    'personalDeductions',
    [
      req('year', int),
      req('socialInsurancePaid', str),
      req('smallBusinessMutualAidPaid', str),
      req('earthquakeInsurancePaid', str),
      req('oldLongTermInsurancePaid', str),
      req('medicalExpensePaid', str),
      req('medicalInsuranceReimbursement', str),
      req('donationAmount', str),
      req('casualtyLossDeduction', str),
      req(
        'lifeInsurance',
        obj(
          opt('newGeneral', str),
          opt('oldGeneral', str),
          opt('newMedical', str),
          opt('newPension', str),
          opt('oldPension', str),
        ),
      ),
      req('isDisabled', bool),
      req('isSpecialDisabled', bool),
      req('isSingleParent', bool),
      req('isWidow', bool),
      req('isWorkingStudent', bool),
      // 年齢の null は旧バージョンが書いていた形。
      opt(
        'spouse',
        obj(req('totalIncome', str), req('age', nullable(num)), opt('disability', disability)),
      ),
      req(
        'dependents',
        arr(
          obj(
            req('id', str),
            req('name', str),
            req('age', nullable(num)),
            req('totalIncome', str),
            opt('livesWithLinealAscendant', bool),
            opt('disability', disability),
          ),
        ),
      ),
      opt('dividendDeductionAmount', str),
      opt('mortgageDeductionAmount', str),
      opt('politicalDonationCreditAmount', str),
      opt('housingRenovationCreditAmount', str),
      opt('foreignTaxCreditAmount', str),
      opt('otherTaxCreditAmount', str),
      opt('disasterExemptionAmount', str),
      opt('otherWithholdingTax', str),
      opt('priorPriorBusinessRevenue', str),
      opt('priorPriorRealEstateRevenue', str),
      opt(
        'salaryIncome',
        obj(
          req('paidAmount', str),
          req('withholdingTax', str),
          opt('lastPaymentBeforeDecember', bool),
        ),
      ),
      opt(
        'miscIncome',
        obj(
          opt('publicPensionAmount', str),
          opt('publicPensionInputMode', enumOf<'income' | 'revenue'>()(['income', 'revenue'])),
          opt('publicPensionRevenue', str),
          opt('publicPensionAge65OrOver', bool),
          opt('otherIncome', str),
          opt('otherExpenses', str),
        ),
      ),
      opt(
        'realEstateIncome',
        obj(
          req('businessScale', bool),
          opt('landLoanInterestAmount', str),
          opt(
            'rentPaid',
            arr(
              obj(
                ...payeeFields,
                opt('deductibleAmount', str),
                opt('property', str),
                opt('keyMoney', str),
                opt('renewalFee', str),
              ),
            ),
          ),
          opt(
            'loanInterestPaid',
            arr(obj(...payeeFields, opt('deductibleAmount', str), opt('yearEndBalance', str))),
          ),
          opt(
            'professionalFeesPaid',
            arr(obj(...payeeFields, opt('deductibleAmount', str), opt('withholdingTax', str))),
          ),
        ),
      ),
      opt(
        'familyEmployees',
        arr(
          obj(
            req('id', str),
            req('name', str),
            req('relation', enumOf<FamilyEmployeeRelation>()(['spouse', 'other'])),
            req('age', num),
            req('monthsWorked', num),
            opt('incomeType', incomeType),
          ),
        ),
      ),
      opt('homeWorker', bool),
      req('updatedAt', num),
    ],
  ],
  [
    'attachments',
    [
      req('id', str),
      req('entryId', str),
      req('mimeType', str),
      req('fileName', str),
      req('createdAt', num),
      opt('sha256', { t: 'sha256' }),
    ],
  ],
  [
    'budgets',
    [
      req('year', int),
      req('month', intIn(1, 12)),
      req('revenueBudget', dec),
      req('expenseBudget', dec),
    ],
  ],
  [
    'arApEntries',
    [
      req('id', str),
      req('type', enumOf<ArApType>()(['receivable', 'payable'])),
      req('description', str),
      req('dueDate', str),
      req('originalAmount', dec),
      req('paidAmount', dec),
      req('createdAt', num),
    ],
  ],
  [
    'invoices',
    [
      req('id', str),
      req('documentType', enumOf<InvoiceDocumentType>()(['invoice', 'quote'])),
      req('status', enumOf<Invoice['status']>()(['draft', 'issued', 'voided'])),
      req('number', str),
      req('vendorId', str),
      req('date', str),
      opt('dueDate', str),
      req(
        'lineItems',
        arr(
          obj(
            req('id', str),
            req('name', str),
            req('quantity', str),
            req('unitPrice', str),
            req('taxRate', enumOf<InvoiceLineItem['taxRate']>()([0.1, 0.08])),
          ),
        ),
      ),
      opt('memo', str),
      opt('journalEntryId', str),
      opt('arApEntryId', str),
      opt('convertedToInvoiceId', str),
      req('createdAt', num),
      opt('issuedAt', num),
      opt('voidedAt', num),
    ],
  ],
]);

const REPORT_DATA: ReadonlyMap<unknown, Spec> = new Map<unknown, Spec>([
  ['monthly-sales', obj(req('months', arr(obj(req('month', int), req('sales', dec)))))],
  [
    'pl',
    obj(
      req('rows', amountRows),
      req('totalRevenue', dec),
      req('totalExpense', dec),
      req('netIncome', dec),
    ),
  ],
  ['bs', obj(req('assets', amountRows), req('liabilities', amountRows), req('equity', amountRows))],
  ['consumption-tax', obj(req('method', taxFilingMethod), req('netTaxNational', dec))],
]);

const SETTING_VALUES: ReadonlyMap<string, Spec> = new Map<string, Spec>([
  ['currentYear', int],
  ['userBusinessName', str],
  ['userInvoiceNumber', str],
  ['invoiceNumberPrefix', str],
  ['quoteNumberPrefix', str],
  ['filingType', enumOf<FilingType>()(['blue', 'white'])],
  [
    'aoiroDeductionKind',
    enumOf<AoiroDeductionKind>()(['electronic', 'eTax', 'doubleEntry', 'simple', 'none']),
  ],
  ['cashBasisElection', bool],
  ['realEstateIncomeEnabled', bool],
  ['businessStartDate', { t: 'isoDateOrEmpty' }],
  ['businessCloseDate', { t: 'isoDateOrEmpty' }],
  ['homeOfficeAccountRatios', rec(str)],
  ['inventoryAutoValuationEnabled', bool],
  ['taxRegistration', enumOf<TaxRegistration>()(['taxable', 'tax-free'])],
  ['taxFilingMethod', taxFilingMethod],
  ['simplifiedTaxCategory', enumOf<SimplifiedTaxCategory>()([1, 2, 3, 4, 5, 6])],
  [
    'consumptionTaxAttributionMethod',
    enumOf<SettingsMap['consumptionTaxAttributionMethod']>()(['individual', 'proportional']),
  ],
  ['invoiceRegistrationStartDate', str],
  ['taxableElectionPeriod', obj(req('fromYear', int), opt('toYear', int))],
  ['inheritanceSpecialDate', str],
  ['adjustedFixedAssetDate', str],
  ['shortenedTaxPeriod', obj(req('from', str), opt('to', str))],
  ['foreignWithoutDomesticPe', bool],
  ['basePeriodTaxableSales', str],
  ['specifiedPeriodTaxableSales', str],
  ['simplifiedElectionFiledDate', str],
  ['interimVoluntaryFiled', bool],
  ['interimVoluntaryLapsed', bool],
  ['interimPriorPeriodMonths', rec(int)],
  [
    'wariBaseAdjustments',
    rec(
      obj(
        opt('salesReturnTax78', str),
        opt('salesReturnTax624', str),
        opt(
          'specifiedSmallAssetTransfers',
          arr(
            obj(
              req('date', str),
              req('rate', enumOf<0.1 | 0.08>()([0.1, 0.08])),
              req('netTax', str),
            ),
          ),
        ),
      ),
    ),
  ],
  ['aiEngine', enumOf<AiEngine>()(['gemini', 'openai-compatible', 'apple-ai', 'chrome-ai'])],
  ['geminiModel', str],
  ['openaiBaseUrl', str],
  ['openaiOcrModel', str],
  ['openaiClassifyModel', str],
  ['receiptMethod', enumOf<ReceiptMethod>()(['ai', 'rule'])],
  ['receiptRuleEngine', enumOf<ReceiptRuleEngine>()(['native', 'tesseract'])],
  // migrateOcrEngineSetting が読み分けられる値だけを通す。
  [
    'ocrEngine',
    enumOf<'gemini' | 'openai-compatible' | 'tesseract' | 'native' | 'apple-ai'>()([
      'gemini',
      'openai-compatible',
      'tesseract',
      'native',
      'apple-ai',
    ]),
  ],
  ['geminiApiKey', str],
  ['openaiApiKey', str],
  ['userRiyoshaId', str],
  ['userFilerName', str],
  ['userFilerZip', str],
  ['userFilerAddress', str],
  ['userZeimushoCode', str],
  ['userZeimushoName', str],
]);

export function hasRowSpec(table: string): boolean {
  return table === 'settings' || TABLE_FIELDS.has(table);
}

export function hasSettingSpec(key: unknown): boolean {
  return typeof key === 'string' && SETTING_VALUES.has(key);
}

function checkReportPayload(row: Record<string, unknown>): string | null {
  const payload = own(row, 'payload') as Record<string, unknown>;
  const type = own(payload, 'type');
  if (type !== own(row, 'type')) {
    return `payload.type が type と一致しません（${describeValue(type)}）`;
  }
  const spec = REPORT_DATA.get(type);
  return spec === undefined ? null : checkValue(spec, own(payload, 'data'), 'payload.data');
}

function checkSetting(row: Record<string, unknown>): string | null {
  const key = own(row, 'key');
  const spec = typeof key === 'string' ? SETTING_VALUES.get(key) : undefined;
  if (typeof key !== 'string' || spec === undefined) {
    return null;
  }
  const head = checkFields([req('key', str), opt('updatedAt', num)], row, '');
  if (head !== null) {
    return head;
  }
  const value = own(row, 'value');
  const path = clip(key);
  return value === undefined ? `${path} の value がありません` : checkValue(spec, value, path);
}
/**
 * 1 行を列の仕様で確かめ、最初に見つかった不備の説明を返す（問題が無ければ null）。
 * settings は仕様のあるキーだけを見る。仕様の無い表は何も見ない。
 */
export function checkRow(table: string, row: Record<string, unknown>): string | null {
  if (table === 'settings') {
    return checkSetting(row);
  }
  const fields = TABLE_FIELDS.get(table);
  if (fields === undefined) {
    return null;
  }
  const found = checkFields(fields, row, '');
  if (found !== null || table !== 'reportSnapshots') {
    return found;
  }
  return checkReportPayload(row);
}

function toStringIfFinite(row: Record<string, unknown>, key: string): void {
  const v = own(row, key);
  if (typeof v === 'number' && Number.isFinite(v)) {
    row[key] = String(v);
  }
}
// 旧バージョンの 1e3 のような書き方を通常の表記に直す。値は変えない（読めない値は journalLineProblem が先に弾く）
function toPlainAmount(row: Record<string, unknown>, key: string): void {
  const v = own(row, key);
  if (typeof v !== 'string' || /^\d+(\.\d+)?$/.test(v)) {
    return;
  }
  const parsed = parseLegacyLineAmount(v);
  if (parsed !== undefined) {
    row[key] = toAmountString(parsed);
  }
}
/**
 * 旧バージョンが書いていた形を今の型へ直す（渡された複製を書き換える）。
 * 行ごと捨てるべきときは false を返す。
 */
export function upgradeLegacyRow(table: string, row: Record<string, unknown>): boolean {
  if (table === 'budgets') {
    toStringIfFinite(row, 'revenueBudget');
    toStringIfFinite(row, 'expenseBudget');
  } else if (table === 'arApEntries') {
    toStringIfFinite(row, 'originalAmount');
    toStringIfFinite(row, 'paidAmount');
  } else if (table === 'journalLines') {
    toStringIfFinite(row, 'quantity');
    toPlainAmount(row, 'amount');
    toPlainAmount(row, 'taxableTransferConsideration');
  } else if (table === 'settings' && own(row, 'key') === 'currentYear') {
    // 年度の null と範囲外の整数は未設定として扱う。整数でない値は checkRow が弾く。
    const v = own(row, 'value');
    return !(v === null || (Number.isInteger(v) && !isProcessingYear(v)));
  }
  return true;
}
// これ以外の型は Blob URL で開いたときに文書として描画され得るため、型無しに置き換える。
const ATTACHMENT_MIME_TYPES: ReadonlySet<string> = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/bmp',
  'image/heic',
  'image/heif',
  'application/octet-stream',
]);
// 古いブラウザや OS が付ける別名。完全一致のときだけ標準の型へ読み替える。
const ATTACHMENT_MIME_ALIASES: ReadonlyMap<string, string> = new Map([
  ['image/jpg', 'image/jpeg'],
  ['image/pjpeg', 'image/jpeg'],
  ['image/x-png', 'image/png'],
  ['image/x-ms-bmp', 'image/bmp'],
]);

export function safeAttachmentMimeType(type: string): string {
  const canonical = ATTACHMENT_MIME_ALIASES.get(type) ?? type;
  return ATTACHMENT_MIME_TYPES.has(canonical) ? canonical : 'application/octet-stream';
}
