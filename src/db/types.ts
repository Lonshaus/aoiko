export type EntrySource = 'manual' | 'csv' | 'extension' | 'ocr' | 'carryover' | 'paste' | 'opening';
export type EntryStatus = 'confirmed' | 'reversed';
export type LineSide = 'debit' | 'credit';
export type AccountCategory = 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';
// 'exempt'＝非課税（住宅家賃・利子収入等、課税売上割合の分母のみに算入）
// 'nontaxable'＝課税対象外（給料賃金等、課税売上割合に算入しない）
// 'exportExempt'＝免税（輸出売上等、課税売上割合の分子・分母両方に算入）
// 'importTax10'/'importTax8'＝輸入消費税（税率別。金額はそのまま税額として扱う）
// 'reverseCharge'＝特定課税仕入れ（国外事業者からの電気通信利用役務の提供等）
// 'badDebt'＝貸倒れ（税込の貸倒金額から、その行の taxRate で税額を逆算し控除。仕入税額とは別枠）
// 'badDebtRecovery'＝貸倒回収（過去に貸倒控除した売掛金等の回収。税額を売上税額に加算し直す）
export type TaxCategory =
  | 'taxable10'
  | 'taxable8'
  | 'exempt'
  | 'nontaxable'
  | 'exportExempt'
  | 'importTax10'
  | 'importTax8'
  | 'reverseCharge'
  | 'badDebt'
  | 'badDebtRecovery';
// 個別対応方式の用途区分。未指定は 'taxableOnly' 扱い（課税売上のみ対応、既存データの既定挙動を維持）。
export type InputUsageCategory = 'taxableOnly' | 'common' | 'nonTaxableOnly';
// 'small-asset-special' は少額減価償却資産の特例（措法28の2、青色申告限定）。取得年度に全額損金算入し、以降の償却なし。
// 'lump-sum' は一括償却資産（施行令139条、青色/白色問わず）。取得価額を3年均等償却、除却後も償却継続。
export type DepreciationMethod =
  | 'straight-line'
  | 'declining-balance'
  | 'small-asset-special'
  | 'lump-sum';
export type ReportType = 'monthly-sales' | 'pl' | 'bs' | 'consumption-tax';
// 'superseded'：申告ロックを解除した（修正申告等）スナップショット。
// ロック判定（filed のみ）からは外れるが、修正申告差分の基準として残す。
export type ReportStatus = 'draft' | 'filed' | 'superseded';
export type VendorEntityType = 'corporation' | 'individual' | 'public' | 'foreign' | 'unknown';
// 所得区分。未指定（undefined）は 'business' 扱い（既存データ互換）。
// freee/MF と同じく科目層級で持つ（同じ費用性質でも所得区分ごとに科目を複製する）。
export type IncomeType = 'business' | 'realEstate';
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
  // 科目の taxCategory 既定値を、この分錄だけ上書きしたい場合に指定（輸出免税・輸入消費税・特定課税仕入れ等）
  taxCategory?: TaxCategory;
  // 個別対応方式の用途区分の上書き。未指定なら 'taxableOnly'
  inputUsageCategory?: InputUsageCategory;
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
  incomeType?: IncomeType;
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

// 'scrap'＝除却（廃棄、対価なし）。帳簿価額全額を必要経費（固定資産除却損）に計上。
// 'sale'＝売却（対価あり）。個人事業主の事業用資産売却は譲渡所得（分離課税）に該当し
// 事業所得に含められないため、売却対価と帳簿価額の差額は事業主貸/事業主借で結転し
// 損益計算書には影響させない（freee 方式、詳細は asset-disposal.ts 冒頭コメント参照）。
export type DisposalType = 'scrap' | 'sale';

// KOA220（青色申告決算書・不動産所得用）第2頁「貸家等の状況」相当。
// 月額家賃の期中改定（上段/下段）は追跡せず、年額を確定額で直接入力する
// （雑損控除等と同じ「複雑な個別事情は確定額直接入力」の方針、real-estate-income.ts 冒頭コメント参照）。
export interface RealEstatePropertyDetail {
  /** 貸家貸地等の別 */
  propertyType: string;
  /** 用途（住宅用か住宅用以外か） */
  isResidential?: boolean;
  address: string;
  tenantName?: string;
  tenantAddress?: string;
  rentalPeriodStart?: string;
  rentalPeriodEnd?: string;
  /** 貸付面積（㎡） */
  areaSqm?: string;
  /** 賃貸料の年額 */
  annualRent: string;
  /** 礼金・権利金・更新料の合計 */
  keyMoneyEtc?: string;
  /** 名義書換料その他 */
  otherIncome?: string;
  /** 保証金・敷金（期末残高） */
  depositBalance?: string;
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
  disposalType?: DisposalType;
  /** 売却対価（disposalType === 'sale' のときのみ使用） */
  salePrice?: string;
  /** 譲渡費用（仲介手数料等）。譲渡所得の参考試算にのみ使用、仕訳には影響しない */
  saleExpenses?: string;
  /** 未指定は 'business'（既存データ互換） */
  incomeType?: IncomeType;
  /** incomeType === 'realEstate' のときのみ使用 */
  realEstateDetail?: RealEstatePropertyDetail;
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
// 確定申告した消費税額のスナップショット。翌年の中間申告義務判定・予定納付額算出の
// 基準として使う（前年度確定消費税額、国税のみ）。taxFilingMethod はグローバル設定
// のため、ロック時点で実際に使った方式をここに固定して残す。
export interface ConsumptionTaxSnapshotData {
  method: TaxFilingMethod;
  /** 差引税額（国税分、確定申告書相当額） */
  netTaxNational: string;
}

export type ReportSnapshotData =
  | { type: 'monthly-sales'; data: MonthlySalesData }
  | { type: 'pl'; data: PLData }
  | { type: 'bs'; data: BSData }
  | { type: 'consumption-tax'; data: ConsumptionTaxSnapshotData };

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

export interface PersonalDeductionSpouse {
  totalIncome: string;
  age: number;
}

export interface PersonalDeductionDependent {
  id: string;
  name: string;
  /** 年末時点の満年齢 */
  age: number;
  totalIncome: string;
  /** 老人扶養親族のうち、納税者又は配偶者と同居している直系尊属か */
  livesWithLinealAscendant?: boolean;
}

export interface PersonalDeductionLifeInsurance {
  newGeneral?: string;
  oldGeneral?: string;
  newMedical?: string;
  newPension?: string;
  oldPension?: string;
}
// 給与所得（源泉徴収票の記載内容を転記）。給与所得控除は other-income.ts が計算する。
export interface PersonalDeductionSalaryIncome {
  paidAmount: string;
  withholdingTax: string;
}
// 雑所得。公的年金等は3軸の速算表で複雑なため確定額を直接入力（other-income.ts 冒頭コメント参照）、
// その他雑所得（副業収入等）は収入−必要経費を aoiko が計算する。
export interface PersonalDeductionMiscIncome {
  publicPensionAmount?: string;
  otherIncome?: string;
  otherExpenses?: string;
}
// KOA220/KOA130 の「支払先の住所・氏名」明細行に共通する形。
export interface RealEstatePayeeDetail {
  payeeAddress?: string;
  payeeName?: string;
  amount: string;
  /** 左のうち必要経費算入額 */
  deductibleAmount?: string;
}

export interface RealEstateRentPaidDetail extends RealEstatePayeeDetail {
  /** 賃借物件 */
  property?: string;
  keyMoney?: string;
  renewalFee?: string;
}

export interface RealEstateLoanInterestPaidDetail extends RealEstatePayeeDetail {
  /** 期末現在の借入金等の金額 */
  yearEndBalance?: string;
}

export interface RealEstateProfessionalFeeDetail extends RealEstatePayeeDetail {
  withholdingTax?: string;
}

// 不動産所得の入力（年度ごと）。損益自体は incomeType: 'realEstate' の仕訳から導出するため
// ここには保存しない。事業的規模は「5棟10室」等の非正式基準で機械判定できないため
// 利用者の自己申告とする（real-estate-income.ts 冒頭コメント参照）。
export interface RealEstateIncomeInput {
  /** 事業的規模か（自己申告）。青色申告特別控除65/55万・専従者給与の可否に影響 */
  businessScale: boolean;
  /** 土地等を取得するために要した負債の利子の額（確定額を直接入力、按分計算はしない） */
  landLoanInterestAmount?: string;
  rentPaid?: RealEstateRentPaidDetail[];
  loanInterestPaid?: RealEstateLoanInterestPaidDetail[];
  professionalFeesPaid?: RealEstateProfessionalFeeDetail[];
}

// 所得控除・税額控除の入力（年度ごと）。事業所得（合計所得金額）は決算書側の集計から
// 導出するため、ここには保存しない。雑損控除・住宅ローン控除・外国税額控除等、
// 制度が複雑で本人事情に強く依存する項目は確定額をそのまま入力する
// （詳細は income-deductions.ts 冒頭コメント参照）。
export interface PersonalDeductionInput {
  year: number;
  socialInsurancePaid: string;
  smallBusinessMutualAidPaid: string;
  lifeInsurance: PersonalDeductionLifeInsurance;
  earthquakeInsurancePaid: string;
  oldLongTermInsurancePaid: string;
  medicalExpensePaid: string;
  medicalInsuranceReimbursement: string;
  donationAmount: string;
  casualtyLossDeduction: string;
  isDisabled: boolean;
  isSpecialDisabled: boolean;
  isSingleParent: boolean;
  isWidow: boolean;
  isWorkingStudent: boolean;
  spouse?: PersonalDeductionSpouse;
  dependents: PersonalDeductionDependent[];
  dividendDeductionAmount?: string;
  mortgageDeductionAmount?: string;
  politicalDonationCreditAmount?: string;
  housingRenovationCreditAmount?: string;
  foreignTaxCreditAmount?: string;
  otherTaxCreditAmount?: string;
  disasterExemptionAmount?: string;
  salaryIncome?: PersonalDeductionSalaryIncome;
  miscIncome?: PersonalDeductionMiscIncome;
  /** 事業所得側の源泉徴収税額（確定額を直接入力、取引単位の追跡は対象外） */
  otherWithholdingTax?: string;
  realEstateIncome?: RealEstateIncomeInput;
  updatedAt: number;
}

export interface Setting<T = unknown> {
  key: string;
  value: T;
  updatedAt: number;
}