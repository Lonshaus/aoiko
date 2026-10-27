import { readStoredAmount } from '../lib/amount-input';
import { isValidIsoDate } from '../lib/date';
import { hasOldStraightLineRate } from './business-opening';
import { hasDecliningBalanceRate, oldDecliningBalanceRate } from './depreciation';
import type { FixedAsset } from '../db/types';
import { m } from '../paraglide/messages';

export type FixedAssetAmountField =
  | 'acquisitionCost'
  | 'conversionBasis'
  | 'residualGuaranteeAmount'
  | 'salePrice'
  | 'saleExpenses'
  | 'areaSqm'
  | 'annualRent'
  | 'keyMoneyEtc'
  | 'otherIncome'
  | 'depositBalance';

export type FixedAssetDateField =
  'acquisitionDate' | 'disposedDate' | 'serviceStartDate' | 'leaseContractDate';

export type FixedAssetPropertyField =
  | 'detail'
  | 'propertyType'
  | 'address'
  | 'tenantAddress'
  | 'tenantName'
  | 'rentalPeriodStart'
  | 'rentalPeriodEnd';

export type FixedAssetIssue =
  | { kind: 'amount'; field: FixedAssetAmountField }
  | { kind: 'too-large'; field: FixedAssetAmountField }
  | { kind: 'xtx-too-large'; field: FixedAssetAmountField }
  | { kind: 'useful-life' }
  | { kind: 'lease-term' }
  | { kind: 'method' }
  | { kind: 'date'; field: FixedAssetDateField }
  | { kind: 'name' }
  | { kind: 'property'; field: FixedAssetPropertyField }
  | { kind: 'disposal-type' };
// compute は償却計算そのもの、disposal はその資産の除却・売却、output は .xtx の明細だけに効く
export type FixedAssetIssueScope = 'compute' | 'disposal' | 'output';

const KNOWN_METHODS = new Set<string>([
  'straight-line',
  'declining-balance',
  'small-asset-special',
  'lump-sum',
  'old-straight-line',
  'old-declining-balance',
  'lease-period-straight-line',
]);
// 仕訳明細と同じく 14 桁を超える金額は償却・除却の仕訳にできない
const TOO_LARGE_FIELDS = new Set<FixedAssetAmountField>([
  'acquisitionCost',
  'conversionBasis',
  'residualGuaranteeAmount',
  'salePrice',
]);
const COMPUTE_AMOUNT_FIELDS = new Set<FixedAssetAmountField>([
  'acquisitionCost',
  'conversionBasis',
  'residualGuaranteeAmount',
]);
const DISPOSAL_AMOUNT_FIELDS = new Set<FixedAssetAmountField>(['salePrice', 'saleExpenses']);
const PROPERTY_AMOUNT_FIELDS = [
  'areaSqm',
  'annualRent',
  'keyMoneyEtc',
  'otherIncome',
  'depositBalance',
] as const;
const PROPERTY_OPTIONAL_TEXT_FIELDS = [
  'address',
  'tenantAddress',
  'tenantName',
  'rentalPeriodStart',
  'rentalPeriodEnd',
] as const;
// 定率法の率表は 2〜20 年だが、少額特例の定率法選択は落選しない限り率表を使わない
const SMALL_ASSET_DECLINING_LIFE_MAX = 50;

function isPositiveInteger(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 1;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim() !== '';
}
// 復元された資産は主キーしか検査していない。償却計算・一覧・.xtx が読む値を、
// それぞれの読み方（未指定の扱いを含む）に合わせてここで先に確かめる
export function validateFixedAsset(asset: FixedAsset): FixedAssetIssue[] {
  const issues: FixedAssetIssue[] = [];
  const raw = asset as unknown as Record<string, unknown>;
  const amounts: [FixedAssetAmountField, unknown, boolean][] = [
    ['acquisitionCost', asset.acquisitionCost, false],
    ['conversionBasis', asset.conversionBasis, asset.conversionBasis == null],
    [
      'residualGuaranteeAmount',
      asset.residualGuaranteeAmount,
      asset.residualGuaranteeAmount === undefined,
    ],
    ['salePrice', asset.salePrice, !asset.salePrice],
    ['saleExpenses', asset.saleExpenses, asset.saleExpenses == null],
  ];
  const detail = raw.realEstateDetail;
  if (isRecord(detail)) {
    for (const field of PROPERTY_AMOUNT_FIELDS) {
      amounts.push([field, detail[field], detail[field] === undefined || detail[field] === '']);
    }
  }
  for (const [field, value, absent] of amounts) {
    if (absent) {
      continue;
    }
    const v = readStoredAmount(value);
    if (v === undefined || v.isNegative()) {
      issues.push({ kind: 'amount', field });
    } else if (TOO_LARGE_FIELDS.has(field) && v.gte('1e14')) {
      issues.push({ kind: 'too-large', field });
    } else if (!TOO_LARGE_FIELDS.has(field) && v.gte('1e15')) {
      issues.push({ kind: 'xtx-too-large', field });
    }
  }
  const method = asset.depreciationMethod as string;
  if (!KNOWN_METHODS.has(method)) {
    issues.push({ kind: 'method' });
  }
  const life = asset.usefulLifeYears as unknown;
  if (!isPositiveInteger(life)) {
    issues.push({ kind: 'useful-life' });
  } else if (asset.usableLifeUnderOneYear !== true && !usefulLifeFitsMethod(asset, life)) {
    issues.push({ kind: 'useful-life' });
  }
  if (method === 'lease-period-straight-line' && !isPositiveInteger(asset.leaseTermMonths)) {
    issues.push({ kind: 'lease-term' });
  }
  issues.push(...dateIssues(raw));
  if (!isNonEmptyString(raw.name)) {
    issues.push({ kind: 'name' });
  }
  // .xtx の不動産の明細に載る資産だけ、明細が組み立てられる形かを見る
  if (raw.incomeType === 'realEstate' && detail) {
    issues.push(...propertyIssues(detail));
  }
  if (
    raw.disposalType !== undefined &&
    raw.disposalType !== 'scrap' &&
    raw.disposalType !== 'sale'
  ) {
    issues.push({ kind: 'disposal-type' });
  }
  return issues;
}
// 読む側の未指定の扱いに揃える。除却日は空文字でも未除却（除却の編集で日付を消すと '' が入る）
function dateIssues(raw: Record<string, unknown>): FixedAssetIssue[] {
  const issues: FixedAssetIssue[] = [];
  if (!isValidIsoDate(raw.acquisitionDate)) {
    issues.push({ kind: 'date', field: 'acquisitionDate' });
  }
  const disposed = raw.disposedDate;
  if (disposed !== undefined && disposed !== null && disposed !== '' && !isValidIsoDate(disposed)) {
    issues.push({ kind: 'date', field: 'disposedDate' });
  }
  for (const field of ['serviceStartDate', 'leaseContractDate'] as const) {
    if (raw[field] !== undefined && !isValidIsoDate(raw[field])) {
      issues.push({ kind: 'date', field });
    }
  }
  return issues;
}

function propertyIssues(detail: unknown): FixedAssetIssue[] {
  if (!isRecord(detail)) {
    return [{ kind: 'property', field: 'detail' }];
  }
  const issues: FixedAssetIssue[] = [];
  if (!isNonEmptyString(detail.propertyType)) {
    issues.push({ kind: 'property', field: 'propertyType' });
  }
  if (detail.annualRent === undefined || detail.annualRent === '') {
    issues.push({ kind: 'amount', field: 'annualRent' });
  }
  for (const field of PROPERTY_OPTIONAL_TEXT_FIELDS) {
    const v = detail[field];
    if (v !== undefined && typeof v !== 'string') {
      issues.push({ kind: 'property', field });
    }
  }
  return issues;
}
// 償却率表に無い耐用年数は計算時に例外になる。旧償却方法の生物は細目ごとの残存割合が要り、扱えない
function usefulLifeFitsMethod(asset: FixedAsset, life: number): boolean {
  switch (asset.depreciationMethod) {
    case 'declining-balance':
      return hasDecliningBalanceRate(life);
    case 'small-asset-special':
      return asset.decliningBalanceElected !== true || life <= SMALL_ASSET_DECLINING_LIFE_MAX;
    case 'old-straight-line':
      return asset.assetCategory !== 9 && hasOldStraightLineRate(life);
    case 'old-declining-balance':
      return asset.assetCategory !== 9 && oldDecliningBalanceRate(life) !== undefined;
    default:
      return true;
  }
}

export function fixedAssetIssueScope(issue: FixedAssetIssue): FixedAssetIssueScope {
  switch (issue.kind) {
    case 'amount':
    case 'too-large':
    case 'xtx-too-large':
      if (COMPUTE_AMOUNT_FIELDS.has(issue.field)) {
        return 'compute';
      }
      return DISPOSAL_AMOUNT_FIELDS.has(issue.field) ? 'disposal' : 'output';
    case 'useful-life':
    case 'lease-term':
    case 'method':
    case 'date':
      return 'compute';
    case 'disposal-type':
      return 'disposal';
    case 'name':
    case 'property':
      return 'output';
  }
}

export function hasComputeIssue(issues: readonly FixedAssetIssue[]): boolean {
  return issues.some((i) => fixedAssetIssueScope(i) === 'compute');
}
// 少額特例の年合計上限（smallAssetSpecialStatuses）が読む欄。ほかの資産の除却を止めるのはこの欄の問題だけ
export function affectsSmallAssetCap(issue: FixedAssetIssue): boolean {
  switch (issue.kind) {
    case 'method':
      return true;
    case 'amount':
    case 'too-large':
      return issue.field === 'acquisitionCost';
    case 'date':
      return issue.field === 'acquisitionDate' || issue.field === 'serviceStartDate';
    default:
      return false;
  }
}

function fieldLabel(field: FixedAssetAmountField): string {
  switch (field) {
    case 'acquisitionCost':
      return m.settings_asset_th_cost();
    case 'conversionBasis':
      return m.fixed_asset_field_conversion_basis();
    case 'residualGuaranteeAmount':
      return m.fixed_asset_field_residual_guarantee();
    case 'salePrice':
      return m.settings_asset_disposal_sale_price_placeholder();
    case 'saleExpenses':
      return m.fixed_asset_field_sale_expenses();
    case 'areaSqm':
      return m.settings_asset_property_area_placeholder();
    case 'annualRent':
      return m.settings_asset_property_annual_rent_placeholder();
    case 'keyMoneyEtc':
      return m.settings_asset_property_key_money_placeholder();
    case 'otherIncome':
      return m.settings_asset_property_other_income_placeholder();
    case 'depositBalance':
      return m.settings_asset_property_deposit_placeholder();
  }
}

function dateFieldLabel(field: FixedAssetDateField): string {
  switch (field) {
    case 'acquisitionDate':
      return m.settings_asset_th_date();
    case 'disposedDate':
      return m.settings_asset_disposal_date();
    case 'serviceStartDate':
      return m.fixed_asset_field_service_start_date();
    case 'leaseContractDate':
      return m.fixed_asset_field_lease_contract_date();
  }
}

function propertyFieldLabel(field: FixedAssetPropertyField): string {
  switch (field) {
    case 'detail':
      return m.settings_asset_property_button();
    case 'propertyType':
      return m.settings_asset_property_type_placeholder();
    case 'address':
      return m.settings_asset_property_address_placeholder();
    case 'tenantAddress':
      return m.settings_asset_property_tenant_address_placeholder();
    case 'tenantName':
      return m.settings_asset_property_tenant_name_placeholder();
    case 'rentalPeriodStart':
      return m.settings_asset_property_rental_start_title();
    case 'rentalPeriodEnd':
      return m.settings_asset_property_rental_end_title();
  }
}

export function describeFixedAssetIssue(issue: FixedAssetIssue): string {
  switch (issue.kind) {
    case 'amount':
      return m.fixed_asset_issue_amount({ field: fieldLabel(issue.field) });
    case 'too-large':
      return m.fixed_asset_issue_too_large({ field: fieldLabel(issue.field) });
    case 'xtx-too-large':
      return m.fixed_asset_issue_xtx_too_large({ field: fieldLabel(issue.field) });
    case 'useful-life':
      return m.fixed_asset_issue_useful_life();
    case 'lease-term':
      return m.fixed_asset_issue_lease_term();
    case 'method':
      return m.fixed_asset_issue_method();
    case 'date':
      return m.fixed_asset_issue_date({ field: dateFieldLabel(issue.field) });
    case 'name':
      return m.fixed_asset_issue_name();
    case 'property':
      return m.fixed_asset_issue_property({ field: propertyFieldLabel(issue.field) });
    case 'disposal-type':
      return m.fixed_asset_issue_disposal_type();
  }
}

export function describeFixedAssetIssues(issues: readonly FixedAssetIssue[]): string {
  return issues.map(describeFixedAssetIssue).join('、');
}
// 名前の無い資産も案内で見分けられるよう、id の先頭を添える
export function fixedAssetLabel(asset: FixedAsset): string {
  const name = (asset as unknown as Record<string, unknown>).name;
  return isNonEmptyString(name)
    ? name
    : m.fixed_asset_unnamed({ id: String(asset.id).slice(0, 8) });
}
// 開業後に取得した資産を転用資産として作った旧データは、業務供用時の未償却残高が取得価額を超える。
// 計算は止めず、直し方の案内だけを返す（該当が無ければ空文字）
export function describeConversionBasisOverCost(assets: readonly FixedAsset[]): string {
  const names = assets
    .filter((a) => {
      const basis = readStoredAmount(a.conversionBasis);
      const cost = readStoredAmount(a.acquisitionCost);
      return basis !== undefined && cost !== undefined && basis.greaterThan(cost);
    })
    .map(fixedAssetLabel);
  return names.length > 0
    ? m.settings_asset_conversion_basis_exceeds_cost({ names: names.join('、') })
    : '';
}
// 資産の名前付きで理由を並べる。償却仕訳・.xtx を止めたときの案内に使う
export function describeInvalidFixedAssets(
  invalid: readonly { asset: FixedAsset; issues: readonly FixedAssetIssue[] }[],
): string {
  return invalid
    .map(({ asset, issues }) =>
      m.fixed_asset_invalid({
        name: fixedAssetLabel(asset),
        reasons: describeFixedAssetIssues(issues),
      }),
    )
    .join(' / ');
}
// filter を渡すと、その条件に当たる問題だけで判定する
export function findInvalidFixedAssets(
  assets: readonly FixedAsset[],
  filter: (issue: FixedAssetIssue) => boolean = () => true,
): { asset: FixedAsset; issues: FixedAssetIssue[] }[] {
  const result: { asset: FixedAsset; issues: FixedAssetIssue[] }[] = [];
  for (const asset of assets) {
    const issues = validateFixedAsset(asset).filter(filter);
    if (issues.length > 0) {
      result.push({ asset, issues });
    }
  }
  return result;
}

export class InvalidFixedAssetError extends Error {
  constructor(invalid: readonly { asset: FixedAsset; issues: readonly FixedAssetIssue[] }[]) {
    super(describeInvalidFixedAssets(invalid));
    this.name = 'InvalidFixedAssetError';
  }
}
