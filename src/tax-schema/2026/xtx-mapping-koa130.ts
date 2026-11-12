// aoiko 業務データ（不動産所得PL・FixedAsset・personalDeductions.realEstateIncome）
// → KOA130（収支内訳書・不動産所得用・白色申告用）参照側の直接値の葉要素への転記。
//
// KOA110（事業所得・白色）と同じく、給料賃金の実額ではなく続柄で決まる定額の専従者控除
// （AKG00240）を出力する。ただし不動産所得の専従者控除は事業的規模の場合のみ認められる
// （国税庁タックスアンサー No.1373）ため、realEstateIncome.businessScale が false の間は
// AKG00240・事業専従者明細（AKJ00010）とも空欄のまま（利用者が e-Tax 上で補完）。
// 白色申告に青色申告特別控除は無いため、土地等取得の負債利子額による損益通算制限のみ適用する。
//
// 対応しない項目（対応不可分・低優先度、e-Tax 上で利用者が補完）：
//  - 給料賃金の内訳：aoiko のデータモデルに払込先の内訳を持たないため対象外
//  - 修繕費の内訳（AKM00000）：aoiko のデータモデルに払込先の内訳を持たないため対象外
//  - 貸付不動産の保有状況（AKN00000、住宅用/非住宅用/駐車場の棟数集計）：対応不可分
//
// 追加科目（AKG00010／AKG00190）は1組のみ。固定欄に対応しない経費科目のうち、
// 貸倒引当金繰入額（不動産）を最優先（明細書添付が要件の法定項目）、次点は金額の
// 大きい順で1件だけ転記する（issue#379）。事業的規模でなければ52条1項の要件を
// 満たさず所得へ加算し直す科目のため、その場合は候補から外す。2件目以降は
// koa130AdditionalExpenseOverflow() で利用者へ提示する。貸倒金（不動産）は実際の
// 貸倒損失として AKG00120「貸倒金」へ出力する（追加科目の対象外）

import koa130 from './xtx-schema-koa130.generated.json';
import { D } from '../../lib/decimal';
import { normalizeAmountInput } from '../../lib/amount-input';
import type { XtxSchema } from './xtx-schema';
import { maxOccursOf, toKingaku, type XtxDetailOverflowRow } from './xtx-mapping-shared';
import type { XtxContext } from './xtx';
import type { XtxLeafValues, XtxRepeatedValues } from './xtx-document';
import type {
  DepreciationMethod,
  FamilyEmployeeRelation,
  FixedAsset,
  RealEstatePropertyDetail,
} from '../../db/types';
import {
  computeDepreciation,
  lumpSumPoolShares,
  smallAssetSpecialStatuses,
  type SmallAssetStatus,
} from '../../domain/depreciation';
import {
  realEstatePreDeductionIncome,
  realEstateDisallowedExpenseAccounts,
  REAL_ESTATE_BAD_DEBT_RESERVE_ACCOUNT_NAME,
} from './real-estate-income';
import {
  familyEmployeeDeduction,
  realEstateFamilyEmployees,
  type FamilyEmployeeDeductionResult,
} from './family-employee-deduction';

const SCHEMA = koa130 as XtxSchema;

interface Leaf {
  tag: string;
  ja: string;
}
function kingakuLeavesByPage(): Map<string, Leaf[]> {
  const byPage = new Map<string, Leaf[]>();
  let page = '';
  for (const e of SCHEMA.refTree) {
    if (e.level === 1) {
      page = e.tag;
      byPage.set(page, []);
    }
    if (e.kind === 'leaf' && !e.idref && e.refType === 'gen:kingaku' && page) {
      byPage.get(page)!.push({ tag: e.tag, ja: e.ja });
    }
  }
  return byPage;
}

const PAGES = kingakuLeavesByPage();
const PAGE1 = PAGES.get('KOA130-1') ?? [];
function tagByJa(leaves: Leaf[], ja: string): string | undefined {
  return leaves.find((l) => l.ja === ja)?.tag;
}
const EXPENSE_ALIAS: Record<string, string> = {
  '給料賃金（不動産）': '給料賃金',
  '減価償却費（不動産）': '減価償却費',
  '地代家賃（不動産）': '地代家賃',
  '借入金利子（不動産）': '借入金利子',
  '租税公課（不動産）': '租税公課',
  '損害保険料（不動産）': '損害保険料',
  '修繕費（不動産）': '修繕費',
  '雑費（不動産）': '雑費',
  '貸倒金（不動産）': '貸倒金',
};
// 追加科目（AKG00010）は xsd で最大10文字。
const ADDITIONAL_EXPENSE_NAME_MAX_LENGTH = 10;

function put(out: XtxLeafValues, tag: string | undefined, amount: string): void {
  if (!tag) {
    return;
  }
  const v = toKingaku(amount, tag);
  if (v !== '') {
    out[tag] = v;
  }
}
// 事業的規模でなければ専従者控除は認められない（ファイル冒頭コメント参照）ため、
// mapKoa130Values（AKG00240/AKG00250）・mapKoa130RepeatedValues（AKJ00010）で共有する。
// ここに来る時点で businessScale は必ず true（ガード済み）。KOA130 は白色申告用の
// 様式なので filingType は 'white' 固定：専従者給与は businessScale に関わらず
// 白色では実額を使えないため加算し戻すが、貸倒引当金繰入額は businessScale が
// true なら（52条1項の要件を満たすため）加算し戻さない（issue#378）。
function realEstateFamilyEmployeeDeductionResult(ctx: XtxContext): FamilyEmployeeDeductionResult {
  const pl = ctx.realEstatePl;
  const realEstateInput = ctx.personalDeductions?.realEstateIncome;
  if (!pl || !realEstateInput?.businessScale) {
    return { total: D(0), entries: [] };
  }
  const preDeductionIncome = realEstatePreDeductionIncome(
    pl,
    realEstateInput.businessScale,
    'white',
  );
  const employees = realEstateFamilyEmployees(ctx.personalDeductions?.familyEmployees ?? []);
  return familyEmployeeDeduction(ctx.year, preDeductionIncome, employees);
}
// 固定欄（EXPENSE_ALIAS）に対応しない経費科目のうち、追加科目欄（1組のみ）に載せる
// 候補を優先順位順に並べる：貸倒引当金繰入額（不動産）を最優先、以降は金額の大きい順。
// 所得計算で加算し直す科目（realEstateDisallowedExpenseAccounts、専従者給与・事業的
// 規模でない引当金）は同じ理由でここでも転記しない（唯一の判定元、issue#379）。
function additionalExpenseCandidates(ctx: XtxContext): { accountName: string; amount: string }[] {
  const pl = ctx.realEstatePl;
  if (!pl) {
    return [];
  }
  const businessScale = ctx.personalDeductions?.realEstateIncome?.businessScale ?? false;
  const disallowed = realEstateDisallowedExpenseAccounts(businessScale, 'white');
  return pl.expense
    .filter((row) => {
      if (row.accountName in EXPENSE_ALIAS) {
        return false;
      }
      if (disallowed.has(row.accountName)) {
        return false;
      }
      return true;
    })
    .sort((a, b) => {
      if (a.accountName === REAL_ESTATE_BAD_DEBT_RESERVE_ACCOUNT_NAME) {
        return -1;
      }
      if (b.accountName === REAL_ESTATE_BAD_DEBT_RESERVE_ACCOUNT_NAME) {
        return 1;
      }
      return D(b.amount).comparedTo(D(a.amount));
    });
}
// 追加科目の1組に収まらなかった経費科目。利用者への警告表示用
// （xtx.ts の xtxAdditionalExpenseOverflow 参照）。
export function koa130AdditionalExpenseOverflow(
  ctx: XtxContext,
): { accountName: string; amount: string }[] {
  return additionalExpenseCandidates(ctx)
    .slice(1)
    .map((row) => ({ accountName: row.accountName, amount: row.amount }));
}

export function mapKoa130Values(ctx: XtxContext): XtxLeafValues {
  const out: XtxLeafValues = {};
  const pl = ctx.realEstatePl;
  if (!pl) {
    return out;
  }
  put(
    out,
    tagByJa(PAGE1, '賃貸料'),
    pl.revenue.find((r) => r.accountName === '賃貸料（不動産）')?.amount ?? '0',
  );
  put(
    out,
    tagByJa(PAGE1, '礼金・権利金・更新料'),
    pl.revenue.find((r) => r.accountName === '礼金・権利金等（不動産）')?.amount ?? '0',
  );
  // 賃貸料・礼金以外の不動産収入（雑収入（不動産）・貸倒引当金繰戻額（不動産）等）は
  // 「名義書換料その他」欄へ集約する。52条3項の繰戻額もここに自然に乗る（issue#379）。
  const otherRevenue = pl.revenue
    .filter(
      (r) => r.accountName !== '賃貸料（不動産）' && r.accountName !== '礼金・権利金等（不動産）',
    )
    .reduce((sum, r) => sum.plus(D(r.amount)), D(0));
  put(out, tagByJa(PAGE1, '名義書換料その他'), otherRevenue.toString());
  for (const row of pl.expense) {
    const ja = EXPENSE_ALIAS[row.accountName];
    if (!ja) {
      continue;
    }
    put(out, tagByJa(PAGE1, ja), row.amount);
  }
  const [additionalExpense] = additionalExpenseCandidates(ctx);
  if (additionalExpense) {
    const name = additionalExpense.accountName
      .replace('（不動産）', '')
      .slice(0, ADDITIONAL_EXPENSE_NAME_MAX_LENGTH);
    if (name) {
      out.AKG00010 = name;
    }
    put(out, 'AKG00190', additionalExpense.amount);
  }
  // 専従者控除前の所得金額。白色申告は事業的規模に関わらず専従者給与の実額を
  // 使えないため常に加算し戻すが、貸倒引当金繰入額（不動産）は事業的規模なら
  // 52条1項の要件を満たすため加算し戻さない。実際の businessScale を渡す
  // （KOA110 の white-return-income.ts とは専従者給与側の扱いが異なる。issue#378）。
  const realEstateInput = ctx.personalDeductions?.realEstateIncome;
  const preDeductionIncome = realEstatePreDeductionIncome(
    pl,
    realEstateInput?.businessScale ?? false,
    'white',
  );
  put(out, tagByJa(PAGE1, '専従者控除前の所得金額'), preDeductionIncome.toString());
  // 事業的規模でなければ専従者控除は認められないため、その場合は控除額・控除後所得とも
  // 空欄のまま（利用者が e-Tax 上で補完する、従来どおりの挙動）。
  if (realEstateInput?.businessScale) {
    const deduction = realEstateFamilyEmployeeDeductionResult(ctx);
    put(out, tagByJa(PAGE1, '専従者控除'), deduction.total.toString());
    put(
      out,
      tagByJa(PAGE1, '所得金額（上段）'),
      preDeductionIncome.minus(deduction.total).toString(),
    );
  }
  if (realEstateInput?.landLoanInterestAmount) {
    put(
      out,
      tagByJa(PAGE1, '土地等を取得するために要した負債の利子の額'),
      realEstateInput.landLoanInterestAmount.toString(),
    );
  }
  return out;
}

const ASSET_NAME_MAX_LENGTH = 16;
const USEFUL_LIFE_MIN = 2;
const USEFUL_LIFE_MAX = 100;
const DEPRECIATION_METHOD_LABEL: Record<DepreciationMethod, string> = {
  'straight-line': '定額法',
  'declining-balance': '定率法',
  'small-asset-special': '少額特例',
  'lump-sum': '一括償却',
  'old-straight-line': '旧定額法',
  'old-declining-balance': '旧定率法',
  'lease-period-straight-line': 'リース期間定額法',
};
// 落選（要件外・上限超過）した少額特例資産は定額法／定率法に切替済みなので、決算書の方法欄は実際の方法を出す。
function effectiveMethodLabel(
  asset: { depreciationMethod: DepreciationMethod; decliningBalanceElected?: boolean },
  status: SmallAssetStatus | undefined,
): string {
  if (
    asset.depreciationMethod === 'small-asset-special' &&
    (status === 'ineligible' || status === 'cap-exceeded')
  ) {
    return asset.decliningBalanceElected === true ? '定率法' : '定額法';
  }
  return DEPRECIATION_METHOD_LABEL[asset.depreciationMethod];
}
function putRow(row: XtxLeafValues, tag: string, amount: string): void {
  const v = toKingaku(amount, tag);
  if (v !== '') {
    row[tag] = v;
  }
}
// 保存値の全角数字は toKingaku が読めず、桁区切りは明細溢れの金額表示（formatJPY）が読めないため、候補にする時点で正規化する
function normalizeDetailAmounts(d: RealEstatePropertyDetail): RealEstatePropertyDetail {
  const out: RealEstatePropertyDetail = { ...d, annualRent: normalizeAmountInput(d.annualRent) };
  if (d.keyMoneyEtc) {
    out.keyMoneyEtc = normalizeAmountInput(d.keyMoneyEtc);
  }
  if (d.otherIncome) {
    out.otherIncome = normalizeAmountInput(d.otherIncome);
  }
  if (d.depositBalance) {
    out.depositBalance = normalizeAmountInput(d.depositBalance);
  }
  return out;
}
// 貸付不動産明細の候補。propertyRows（先頭から上限まで）と koa130DetailOverflow
// （上限を超えた分）が同じ並びを共有する。
function propertyCandidates(ctx: XtxContext): FixedAsset[] {
  return ctx.fixedAssets
    .filter((a) => a.incomeType === 'realEstate' && a.realEstateDetail)
    .map((a) => ({ ...a, realEstateDetail: normalizeDetailAmounts(a.realEstateDetail!) }));
}

function propertyRows(ctx: XtxContext): XtxLeafValues[] {
  return propertyCandidates(ctx)
    .slice(0, maxOccursOf(SCHEMA, 'AKH00010'))
    .map((a) => {
      const d = a.realEstateDetail!;
      const row: XtxLeafValues = {};
      row.AKH00020 = d.propertyType.slice(0, 10);
      row.AKH00025 = d.isResidential === false ? '住宅用以外' : '住宅用';
      row.AKH00030 = d.address;
      if (d.tenantAddress) {
        row.AKH00050 = d.tenantAddress;
      }
      if (d.tenantName) {
        row.AKH00060 = d.tenantName;
      }
      if (d.rentalPeriodStart) {
        row.AKH00080 = d.rentalPeriodStart;
      }
      if (d.rentalPeriodEnd) {
        row.AKH00090 = d.rentalPeriodEnd;
      }
      if (d.areaSqm) {
        putRow(row, 'AKH00100', d.areaSqm);
      }
      putRow(row, 'AKH00170', d.annualRent);
      if (d.keyMoneyEtc) {
        putRow(row, 'AKH00180', d.keyMoneyEtc);
      }
      if (d.otherIncome) {
        putRow(row, 'AKH00210', d.otherIncome);
      }
      if (d.depositBalance) {
        putRow(row, 'AKH00220', d.depositBalance);
      }
      return row;
    });
}
// 減価償却明細の候補。depreciationRows（先頭から上限まで）と koa130DetailOverflow
// （上限を超えた分）が同じ並びを共有する。
function depreciationCandidates(ctx: XtxContext) {
  const detailYear = ctx.dataYear ?? ctx.year;
  const pools = lumpSumPoolShares(ctx.fixedAssets);
  const statuses = smallAssetSpecialStatuses(
    ctx.fixedAssets,
    ctx.businessStartDates,
    ctx.businessCloseDate,
  );
  const candidates = ctx.fixedAssets
    .filter((a) => a.incomeType === 'realEstate')
    .map((asset) => ({
      asset,
      result: computeDepreciation(asset, detailYear, pools.get(asset.id), statuses),
    }))
    .filter(({ result }) => !D(result.amount).isZero())
    .sort((a, b) => a.asset.acquisitionDate.localeCompare(b.asset.acquisitionDate));
  return { detailYear, statuses, candidates };
}

function depreciationRows(ctx: XtxContext): XtxLeafValues[] {
  const { detailYear, statuses, candidates } = depreciationCandidates(ctx);
  return candidates.slice(0, maxOccursOf(SCHEMA, 'AKK00010')).map(({ asset, result }) => {
    const row: XtxLeafValues = {};
    const name = asset.name.trim().slice(0, ASSET_NAME_MAX_LENGTH);
    if (name) {
      row.AKK00020 = name;
    }
    putRow(row, 'AKK00060', asset.acquisitionCost);
    putRow(row, 'AKK00070', result.depreciationBase);
    row.AKK00080 = effectiveMethodLabel(asset, statuses.get(asset.id));
    if (asset.usefulLifeYears >= USEFUL_LIFE_MIN && asset.usefulLifeYears <= USEFUL_LIFE_MAX) {
      row.AKK00090 = String(asset.usefulLifeYears);
    }
    putRow(row, 'AKK00150', result.amount);
    putRow(row, 'AKK00170', result.amount);
    putRow(row, 'AKK00190', result.amount);
    putRow(row, 'AKK00200', result.bookValueEnd);
    if (asset.disposedDate && Number(asset.disposedDate.slice(0, 4)) === detailYear) {
      row.AKK00210 = asset.disposalType === 'sale' ? '売却' : '除却';
    }
    return row;
  });
}

function payeeRows<
  T extends {
    payeeAddress?: string;
    payeeName?: string;
    amount: string;
    deductibleAmount?: string;
  },
>(
  items: T[] | undefined,
  max: number,
  addressTag: string,
  nameTag: string,
  amountTag: string,
  deductibleTag: string,
  extra?: (row: XtxLeafValues, item: T) => void,
): XtxLeafValues[] {
  return (items ?? []).slice(0, max).map((item) => {
    const row: XtxLeafValues = {};
    if (item.payeeAddress) {
      row[addressTag] = item.payeeAddress;
    }
    if (item.payeeName) {
      row[nameTag] = item.payeeName;
    }
    putRow(row, amountTag, item.amount);
    if (item.deductibleAmount) {
      putRow(row, deductibleTag, item.deductibleAmount);
    }
    extra?.(row, item);
    return row;
  });
}

export function mapKoa130RepeatedValues(ctx: XtxContext): XtxRepeatedValues {
  const out: XtxRepeatedValues = {};
  const properties = propertyRows(ctx);
  if (properties.length > 0) {
    out.AKH00010 = properties;
  }
  const depreciation = depreciationRows(ctx);
  if (depreciation.length > 0) {
    out.AKK00010 = depreciation;
  }
  const realEstateInput = ctx.personalDeductions?.realEstateIncome;
  const rentPaid = payeeRows(
    realEstateInput?.rentPaid,
    maxOccursOf(SCHEMA, 'AKO00000'),
    'AKO00020',
    'AKO00030',
    'AKO00080',
    'AKO00090',
  );
  if (rentPaid.length > 0) {
    out.AKO00000 = rentPaid;
  }
  const loanInterestPaid = payeeRows(
    realEstateInput?.loanInterestPaid,
    maxOccursOf(SCHEMA, 'AKL00000'),
    'AKL00020',
    'AKL00030',
    'AKL00050',
    'AKL00060',
    (row, item) => {
      if (item.yearEndBalance) {
        putRow(row, 'AKL00040', item.yearEndBalance);
      }
    },
  );
  if (loanInterestPaid.length > 0) {
    out.AKL00000 = loanInterestPaid;
  }
  const professionalFeesPaid = payeeRows(
    realEstateInput?.professionalFeesPaid,
    maxOccursOf(SCHEMA, 'AKP00000'),
    'AKP00020',
    'AKP00030',
    'AKP00040',
    'AKP00050',
    (row, item) => {
      if (item.withholdingTax) {
        putRow(row, 'AKP00060', item.withholdingTax);
      }
    },
  );
  if (professionalFeesPaid.length > 0) {
    out.AKP00000 = professionalFeesPaid;
  }
  const familyEmployeeRows = mapFamilyEmployeeRows(ctx);
  if (familyEmployeeRows.length > 0) {
    out.AKJ00010 = familyEmployeeRows;
  }
  return out;
}
// 改行・タブを除去（nametype/zokugaratype の pattern [^\n\r\t]* に適合させる）
function sanitizeLine(s: string): string {
  return s.replace(/[\n\r\t]+/g, ' ').trim();
}
const FAMILY_EMPLOYEE_ZOKUGARA_LABEL: Record<FamilyEmployeeRelation, string> = {
  spouse: '配偶者',
  other: '親族',
};

function familyEmployeeCandidates(ctx: XtxContext) {
  const employees = realEstateFamilyEmployees(ctx.personalDeductions?.familyEmployees ?? []);
  const ageById = new Map(employees.map((e) => [e.id, e.age]));
  return { ageById, entries: realEstateFamilyEmployeeDeductionResult(ctx).entries };
}

function mapFamilyEmployeeRows(ctx: XtxContext): XtxLeafValues[] {
  const { ageById, entries } = familyEmployeeCandidates(ctx);
  return entries.slice(0, maxOccursOf(SCHEMA, 'AKJ00010')).map((entry) => {
    const row: XtxLeafValues = {};
    const name = sanitizeLine(entry.name);
    if (name) {
      row.AKJ00020 = name;
    }
    const age = ageById.get(entry.id);
    if (age !== undefined) {
      row.AKJ00030 = String(age);
    }
    row.AKJ00040 = FAMILY_EMPLOYEE_ZOKUGARA_LABEL[entry.relation];
    row.AKJ00050 = String(entry.monthsWorked);
    return row;
  });
}
// 明細欄（貸付不動産・減価償却・支払先・事業専従者）の上限を超えて .xtx へ出せなかった行。
// 出力側と同じ候補の並びの、上限より後ろを返す。
export function koa130DetailOverflow(ctx: XtxContext): XtxDetailOverflowRow[] {
  const realEstateInput = ctx.personalDeductions?.realEstateIncome;
  const payee = (
    section: 'rentPaid' | 'loanInterestPaid' | 'professionalFee',
    items: { payeeName?: string; amount: string }[] | undefined,
    tag: string,
  ): XtxDetailOverflowRow[] =>
    (items ?? []).slice(maxOccursOf(SCHEMA, tag)).map((item) => ({
      section,
      label: (item.payeeName ?? '').trim(),
      amount: item.amount,
    }));
  return [
    ...propertyCandidates(ctx)
      .slice(maxOccursOf(SCHEMA, 'AKH00010'))
      .map((a) => ({
        section: 'realEstateProperty' as const,
        label: a.realEstateDetail!.address.trim(),
        amount: a.realEstateDetail!.annualRent,
      })),
    ...depreciationCandidates(ctx)
      .candidates.slice(maxOccursOf(SCHEMA, 'AKK00010'))
      .map(({ asset, result }) => ({
        section: 'depreciation' as const,
        label: asset.name.trim(),
        amount: result.amount,
      })),
    ...payee('rentPaid', realEstateInput?.rentPaid, 'AKO00000'),
    ...payee('loanInterestPaid', realEstateInput?.loanInterestPaid, 'AKL00000'),
    ...payee('professionalFee', realEstateInput?.professionalFeesPaid, 'AKP00000'),
    ...familyEmployeeCandidates(ctx)
      .entries.slice(maxOccursOf(SCHEMA, 'AKJ00010'))
      .map((entry) => ({
        section: 'familyEmployee' as const,
        label: sanitizeLine(entry.name),
        amount: entry.amount.toString(),
      })),
  ];
}
