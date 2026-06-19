export type EntrySource = 'manual' | 'csv' | 'extension' | 'ocr' | 'carryover' | 'paste';
export type EntryStatus = 'confirmed' | 'reversed';
export type LineSide = 'debit' | 'credit';
export type AccountCategory = 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';
export type TaxCategory = 'taxable10' | 'taxable8' | 'exempt' | 'nontaxable';
// 'small-asset-special' は少額減価償却資産の特例（措法28の2）。取得年度に全額損金算入し、以降の償却なし。
export type DepreciationMethod = 'straight-line' | 'declining-balance' | 'small-asset-special';
export type ReportType = 'monthly-sales' | 'pl' | 'bs';
// 'superseded'：申告ロックを解除した（修正申告等）スナップショット。
// ロック判定（filed のみ）からは外れるが、修正申告差分の基準として残す。
export type ReportStatus = 'draft' | 'filed' | 'superseded';
export type VendorEntityType = 'corporation' | 'individual' | 'public' | 'foreign' | 'unknown';
// 消費税の納税義務区分。免税事業者は仕入税額控除の計算対象外。
export type TaxRegistration = 'taxable' | 'tax-free';
// 消費税の課税方式。
// - general：本則課税（売上税額 − 仕入税額）
// - simplified：簡易課税（売上税額 × (1 − みなし仕入率)）
// - two-wari：2 割特例（2023/10〜2026/9、売上税額 × 20%）
// - three-wari：3 割特例（令和 9・10 限定、売上税額 × 30%）
export type TaxFilingMethod = 'general' | 'simplified' | 'two-wari' | 'three-wari';

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