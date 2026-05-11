export type EntrySource = 'manual' | 'csv' | 'extension' | 'ocr' | 'carryover';
export type EntryStatus = 'confirmed' | 'reversed';
export type LineSide = 'debit' | 'credit';
export type AccountCategory = 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';
export type TaxCategory = 'taxable10' | 'taxable8' | 'exempt' | 'nontaxable';
export type CandidateConfidence = 'rule' | 'history' | 'llm-high' | 'llm-low' | 'none';
export type CandidateStatus = 'pending' | 'confirmed' | 'discarded';
export type DepreciationMethod = 'straight-line' | 'declining-balance';
export type ReportType = 'monthly-sales' | 'pl' | 'bs';
export type ReportStatus = 'draft' | 'filed';
export type VendorEntityType = 'corporation' | 'individual' | 'public' | 'foreign' | 'unknown';

export interface JournalEntry {
  id: string;
  date: string;
  year: number;
  description: string;
  status: EntryStatus;
  originalEntryId?: string;
  reversedByEntryId?: string;
  source: EntrySource;
  sourceImportId?: string;
  createdAt: number;
  confirmedAt: number;
}

export interface JournalLine {
  id: string;
  entryId: string;
  side: LineSide;
  accountCode: string;
  subAccountId?: string;
  vendorId?: string;
  amount: string;
  amountIndexed: string;
  taxRate: number;
  taxIncluded: boolean;
  invoiceCompliant: boolean;
  homeOfficeRatio?: string;
  memo?: string;
}

export interface Account {
  code: string;
  year: number;
  name: string;
  category: AccountCategory;
  taxCategory?: TaxCategory;
  parentCode?: string;
  displayOrder: number;
  isActive?: boolean;
}

export interface SubAccount {
  id: string;
  accountCode: string;
  name: string;
  metadata?: Record<string, string>;
}

export interface Vendor {
  id: string;
  name: string;
  entityType?: VendorEntityType;
  invoiceNumber?: string;
  invoiceVerifiedAt?: number;
  invoiceValid?: boolean;
  defaultAccountCode?: string;
  defaultTaxRate?: number;
  aliases?: string[];
}

export interface CandidateEntry {
  id: string;
  importBatchId: string;
  date: string;
  description: string;
  amount: string;
  vendorGuess?: string;
  vendorId?: string;
  accountCodeGuess?: string;
  confidence: CandidateConfidence;
  rawData: Record<string, unknown>;
  status: CandidateStatus;
}

export type ParserRuleMatchType = 'vendor-name' | 'description-includes' | 'regex';

export interface ParserRule {
  id: string;
  matchType: ParserRuleMatchType;
  pattern: string;
  vendorId?: string;
  accountCode?: string;
  priority: number;
  hitCount: number;
  lastHitAt?: number;
}

export interface FixedAsset {
  id: string;
  name: string;
  acquisitionDate: string;
  acquisitionCost: string;
  usefulLifeYears: number;
  depreciationMethod: DepreciationMethod;
  accountCode: string;
  disposedDate?: string;
}

export interface HomeOfficeRule {
  id: string;
  accountCode: string;
  vendorId?: string;
  ratio: string;
  validFrom: string;
  validTo?: string;
}

export interface ImportBatch {
  id: string;
  parserName: string;
  fileName: string;
  fileHash: string;
  importedAt: number;
  rowCount: number;
}

export interface MonthlySalesData {
  months: Array<{ month: number; sales: string }>;
}

export interface PLData {
  rows: Array<{ accountCode: string; amount: string }>;
  totalRevenue: string;
  totalExpense: string;
  netIncome: string;
}

export interface BSData {
  assets: Array<{ accountCode: string; amount: string }>;
  liabilities: Array<{ accountCode: string; amount: string }>;
  equity: Array<{ accountCode: string; amount: string }>;
}

export type ReportSnapshotData =
  | { type: 'monthly-sales'; data: MonthlySalesData }
  | { type: 'pl'; data: PLData }
  | { type: 'bs'; data: BSData };

export interface ReportSnapshot {
  id: string;
  year: number;
  type: ReportType;
  status: ReportStatus;
  filedAt?: number;
  payload: ReportSnapshotData;
  generatedAt: number;
  generatedFromEntriesUpTo: string;
}

export interface Setting<T = unknown> {
  key: string;
  value: T;
  updatedAt: number;
}