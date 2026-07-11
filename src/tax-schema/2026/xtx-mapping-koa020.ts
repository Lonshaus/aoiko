// aoiko 業務データ → KOA020（確定申告書）の値マップ。
//
// ⚠ 申告者情報（氏名・住所・税務署）は IT部（定義側）から第一表へ IDREF で反映される
// （buildItPart が出力）。本モジュールは第一表の「事業」部分の直接値 leaf を扱う：
// 営業等収入金額・事業所得（青色控除後）・青色申告特別控除額・所得金額（合計）。
// 各種所得控除・税額計算（ABB00420〜ABB01040）は、利用者が個人情報を入力した場合
// （ctx.personalDeductions）のみ出力する。未入力の場合は従来どおり利用者が e-Tax 上で
// 補完する。白色申告時は青色申告特別控除を出力せず、事業所得は white-return-income.ts で
// 専従者給与・貸倒引当金繰入額を補正した値を使う（詳細は同ファイル参照）。

import koa020 from './xtx-schema-koa020.generated.json';
import { D, type Decimal } from '../../lib/decimal';
import { whiteReturnAdjustedNetIncome } from './white-return-income';
import {
  computeIncomeDeductions,
  progressiveIncomeTax,
  reconstructionSurtax,
  totalTaxCredits,
} from './income-deductions';
import { otherIncomeAmount, otherMiscIncome, salaryIncomeAmount, totalWithholdingTax } from './other-income';
import {
  computeCombinedBusinessRealEstateIncome,
  offsettableRealEstateLoss,
  realEstatePreDeductionIncome,
} from './real-estate-income';
import type { XtxSchema } from './xtx-schema';
import type { XtxContext } from './xtx';
import type { XtxValues, XtxLeafValues } from './xtx-document';

const SCHEMA = koa020 as XtxSchema;
// 西暦 → 令和年（令和1年=2019）。NENBUN は gen:yy（非負整数）
function toReiwa(year: number): string {
  const r = year - 2018;
  return r >= 1 ? String(r) : '';
}
// gen:kingaku は xsd:long（整数円）。Decimal 文字列 → 整数円（小数切捨て・カンマ除去）
function toKingaku(s: string): string {
  const t = s.replace(/,/g, '').trim();
  const m = /^(-?)(\d+)(?:\.\d+)?$/.exec(t);
  if (!m) {
    return '';
  }
  const sign = m[1] === '-' ? '-' : '';
  const digits = m[2]!.replace(/^0+(?=\d)/, '');
  if (digits === '0') {
    return '0';
  }
  return `${sign}${digits}`;
}
// KOA020 第一表（KOA020-1）内で、日本語名が完全一致する最初の直接値 leaf tag を返す。
function firstTableLeafTagByJa(ja: string): string | undefined {
  let inFirstTable = false;
  for (const e of SCHEMA.refTree) {
    if (e.level === 1) {
      inFirstTable = e.tag === 'KOA020-1';
    }
    if (inFirstTable && e.kind === 'leaf' && !e.idref && e.ja === ja) {
      return e.tag;
    }
  }
  return undefined;
}
// 改行・タブを除去（nametype/yagotype の pattern [^\n\r\t]* に適合させる）
function sanitizeLine(s: string): string {
  return s.replace(/[\n\r\t]+/g, ' ').trim();
}

export function mapKoa020Values(ctx: XtxContext): XtxValues {
  const values: XtxValues = {};
  const nenbun = toReiwa(ctx.year);
  if (nenbun) {
    values.NENBUN = nenbun;
  }
  const yago = sanitizeLine(ctx.businessName);
  if (yago) {
    values.NOZEISHA_YAGO = yago;
  }
  return values;
}
// KOA020 第一表（KOA020-1）の「事業」部分の直接値 leaf。
//  - 営業等収入金額(ア)＝売上(収入)合計
//  - 事業 営業等所得金額(①)＝控除前事業所得 − 青色申告特別控除額
//  - 青色申告特別控除額
// 合計所得金額(⑫) は e-Tax が自動計算するため載せない（ja「所得金額」は
// その他＞変動・臨時所得金額 の子要素 ABB00870 で別物のため誤対映を避ける）。
// 各種所得控除・税額は本人情報が必要なため載せず、利用者が e-Tax 上で補完する。
function put(out: XtxLeafValues, ja: string, amount: string): void {
  const tag = firstTableLeafTagByJa(ja);
  if (!tag) {
    return;
  }
  putTag(out, tag, amount);
}
// tag を直接指定して書き込む。「合計」「控除額」等、KOA020-1 内に同名 leaf が複数存在し
// firstTableLeafTagByJa の文書順一致では誤対映しうる項目に使う。
function putTag(out: XtxLeafValues, tag: string, amount: string): void {
  const v = toKingaku(amount);
  if (v !== '') {
    out[tag] = v;
  }
}

type IncomeCtx = Pick<
  XtxContext,
  'year' | 'pl' | 'filingType' | 'aoiroDeductionKind' | 'realEstatePl' | 'personalDeductions'
>;

// 事業所得（青色申告特別控除後）。不動産所得（B7 part2）があれば、共有枠での
// 配分後の実際の控除額を使う（単独計算だと不動産所得と共有する分を考慮せず過小控除になる）。
// 所得控除・税額控除の計算（income-deductions.ts）にもそのまま使う（IncomeDeductions.svelte 参照）。
export function totalIncomeAmount(ctx: IncomeCtx): Decimal {
  if (ctx.filingType === 'white') {
    // 専従者給与・貸倒引当金繰入額は白色申告では通常の経費として扱えないため、
    // pl.netIncome をそのまま使うと過小になる（詳細は white-return-income.ts）。
    // 白色申告に青色申告特別控除は無いため、不動産所得の有無はこの値に影響しない。
    return whiteReturnAdjustedNetIncome(ctx.pl);
  }
  const preIncome = D(ctx.pl.netIncome);
  const hasBusinessIncome = preIncome.greaterThan(0);
  const combined = computeCombinedBusinessRealEstateIncome(
    ctx.year,
    ctx.aoiroDeductionKind,
    hasBusinessIncome,
    preIncome,
    ctx.realEstatePl,
    ctx.personalDeductions?.realEstateIncome
  );
  return combined.businessIncome;
}
// 不動産所得のうち、他の所得と損益通算できる金額（土地等取得の負債利子額による制限後）。
// 不動産所得が無ければ 0。白色申告は青色申告特別控除が無いため共有枠配分は発生しないが、
// 専従者給与（不動産）の全額不算入・土地等負債利子額の制限は同様に適用する。
function realEstateOffsettableAmount(ctx: IncomeCtx): Decimal {
  const realEstateInput = ctx.personalDeductions?.realEstateIncome;
  if (!ctx.realEstatePl || !realEstateInput) {
    return D(0);
  }
  if (ctx.filingType === 'white') {
    const realEstateIncome = realEstatePreDeductionIncome(ctx.realEstatePl, false);
    return offsettableRealEstateLoss(realEstateIncome, realEstateInput.landLoanInterestAmount ?? D(0));
  }
  const preIncome = D(ctx.pl.netIncome);
  const hasBusinessIncome = preIncome.greaterThan(0);
  const combined = computeCombinedBusinessRealEstateIncome(
    ctx.year,
    ctx.aoiroDeductionKind,
    hasBusinessIncome,
    preIncome,
    ctx.realEstatePl,
    realEstateInput
  );
  return combined.realEstateOffsettable;
}
// 事業所得＋不動産所得（損益通算可能分）＋給与所得＋雑所得（B7）。所得控除の計算
// （基礎控除の級距・配偶者控除の判定等）はこちらを使う。totalIncomeAmount（事業所得のみ）は
// 白色申告の所得補正や IncomeDeductions.svelte の「事業所得」表示にそのまま使うため、
// 意味を変えず残す。
export function combinedTotalIncomeAmount(ctx: IncomeCtx): Decimal {
  const business = totalIncomeAmount(ctx);
  const realEstate = realEstateOffsettableAmount(ctx);
  const other = ctx.personalDeductions ? otherIncomeAmount(ctx.personalDeductions) : D(0);
  return business.plus(realEstate).plus(other);
}

export function mapKoa020LeafValues(ctx: XtxContext): XtxLeafValues {
  const out: XtxLeafValues = {};
  const isWhite = ctx.filingType === 'white';
  put(out, '営業等　金額', ctx.pl.totalRevenue);
  const preIncome = D(ctx.pl.netIncome);
  const businessIncome = totalIncomeAmount(ctx);
  put(out, '営業等', businessIncome.toString());
  const realEstateInput = ctx.personalDeductions?.realEstateIncome;
  // 白色申告は青色申告特別控除が無いため ABB00800/ABI00170 は出さないが、不動産所得の
  // 収入・損益通算可能額と所得控除・税額（putIncomeDeductions）は青色と同様に出力する。
  if (isWhite) {
    if (ctx.realEstatePl && realEstateInput) {
      putTag(out, 'ABB00050', ctx.realEstatePl.totalRevenue);
      putTag(out, 'ABB00340', realEstateOffsettableAmount(ctx).toString());
    }
    putIncomeDeductions(out, ctx);
    return out;
  }
  // 実際に事業所得側へ配分された青色申告特別控除額（不動産所得が無ければ従来どおり）。
  const businessDeduction = preIncome.minus(businessIncome);
  if (ctx.realEstatePl && realEstateInput) {
    const combined = computeCombinedBusinessRealEstateIncome(
      ctx.year,
      ctx.aoiroDeductionKind,
      preIncome.greaterThan(0),
      preIncome,
      ctx.realEstatePl,
      realEstateInput
    );
    const realEstatePreIncome = realEstatePreDeductionIncome(ctx.realEstatePl, realEstateInput.businessScale);
    const realEstateDeduction = realEstatePreIncome.minus(combined.realEstateIncomeAfterDeduction);
    // 第一表の青色申告特別控除額は2枚の決算書の控除額の合計を転記する（手引き p.49）
    putTag(out, 'ABB00800', businessDeduction.plus(realEstateDeduction).toString());
    // 収入金額等・不動産＝不動産所得の総収入金額
    putTag(out, 'ABB00050', ctx.realEstatePl.totalRevenue);
    // 所得金額等・不動産＝損益通算可能な不動産所得（赤字は土地等負債利子制限後）
    putTag(out, 'ABB00340', combined.realEstateOffsettable.toString());
    // 事業税は青色申告特別控除を認めないため、都道府県が加算に使う不動産充当分を第二表へ載せる（手引き p.56）
    putTag(out, 'ABI00170', realEstateDeduction.toString());
  } else {
    put(out, '青色申告特別控除額', businessDeduction.toString());
  }
  putIncomeDeductions(out, ctx);
  return out;
}
// 所得控除・税額控除・累進課税（KOA020 第一表「所得から差し引かれる金額」ABB00420〜
// 「税金の計算」ABB00570）と、給与所得・雑所得（B7、収入金額等 ABB00080/00110〜・
// 所得金額等 ABB00370/01060/01120）・源泉徴収税額/申告納税額（ABB00710/00720）。
// ctx.personalDeductions が未設定（利用者が入力していない）場合は何も出力しない
// （既存どおり e-Tax 上で利用者が補完する）。
// ⚠ 配偶者(特別)控除・扶養控除・寡婦ひとり親控除・特定親族特別控除・住借金等特別控除・
// 外国税額控除等の「区分」コード（ABB00495/515/517/535/544/645/647/676）、および
// 給与・業務・その他雑所得の「区分」コード（ABB00075/365/103/107）は本人の続柄・
// 住宅ローンの契約種別・所得の生じた事情等の追加情報が必要なため出力しない。
// 金額のみ載せるので、これらを使う場合は e-Tax 上で区分コードを利用者が補完すること。
// ⚠ 公的年金等（ABB00100/01060）は速算表を計算しないため、収入金額等側（ABB00100）は
// 出力せず、確定額を所得金額等側（ABB01060）にのみ載せる（詳細は other-income.ts）。
function putIncomeDeductions(out: XtxLeafValues, ctx: XtxContext): void {
  if (!ctx.personalDeductions) {
    return;
  }
  const pd = ctx.personalDeductions;
  const totalIncome = combinedTotalIncomeAmount(ctx);
  const deductions = computeIncomeDeductions(ctx.year, {
    ...pd,
    totalIncome,
  });
  putTag(out, 'ABB00430', deductions.casualtyLossDeduction.toString());
  putTag(out, 'ABB00440', deductions.medicalExpenseDeduction.toString());
  putTag(out, 'ABB00450', deductions.socialInsuranceDeduction.toString());
  putTag(out, 'ABB00460', deductions.smallBusinessMutualAidDeduction.toString());
  putTag(out, 'ABB00470', deductions.lifeInsuranceDeduction.toString());
  putTag(out, 'ABB00480', deductions.earthquakeInsuranceDeduction.toString());
  putTag(out, 'ABB00490', deductions.donationDeduction.toString());
  putTag(out, 'ABB00500', deductions.singleParentOrWidowDeduction.toString());
  putTag(
    out,
    'ABB00510',
    deductions.workingStudentDeduction.plus(deductions.disabilityDeduction).toString()
  );
  putTag(out, 'ABB00520', deductions.spouseDeduction.toString());
  putTag(out, 'ABB00540', deductions.dependentDeduction.toString());
  putTag(out, 'ABB00548', deductions.specificRelativeSpecialDeduction.toString());
  putTag(out, 'ABB00550', deductions.basicDeduction.toString());
  putTag(out, 'ABB00560', deductions.total.toString());
  const taxableIncome = maxZero(totalIncome.minus(deductions.total));
  const taxAmount = progressiveIncomeTax(taxableIncome);
  putTag(out, 'ABB00580', taxableIncome.toString());
  putTag(out, 'ABB00590', taxAmount.toString());
  putTag(out, 'ABB00600', (pd.dividendDeductionAmount ?? D(0)).toString());
  putTag(out, 'ABB00650', (pd.mortgageDeductionAmount ?? D(0)).toString());
  putTag(out, 'ABB00660', (pd.politicalDonationCreditAmount ?? D(0)).toString());
  putTag(out, 'ABB00663', (pd.housingRenovationCreditAmount ?? D(0)).toString());
  putTag(out, 'ABB01040', (pd.foreignTaxCreditAmount ?? D(0)).toString());
  putTag(out, 'ABB00640', (pd.otherTaxCreditAmount ?? D(0)).toString());
  putTag(out, 'ABB00680', (pd.disasterExemptionAmount ?? D(0)).toString());
  // ABB00670（差引所得税額）＝①税額 − 配当控除・住宅ローン控除等の税額控除
  // ABB01010（再差引所得税額）＝差引所得税額 − 外国税額控除等・災害減免額（この2つは実際の
  // 申告書上でも差引所得税額算出後に別枠で控除される）
  const stage1Credits = totalTaxCredits(pd).minus(pd.foreignTaxCreditAmount ?? D(0));
  const diffTax = maxZero(taxAmount.minus(stage1Credits));
  putTag(out, 'ABB00670', diffTax.toString());
  const stage2Reduction = (pd.foreignTaxCreditAmount ?? D(0)).plus(
    pd.disasterExemptionAmount ?? D(0)
  );
  const saiSashihiki = maxZero(diffTax.minus(stage2Reduction));
  putTag(out, 'ABB01010', saiSashihiki.toString());
  const surtax = reconstructionSurtax(saiSashihiki);
  putTag(out, 'ABB01020', surtax.toString());
  const taxTotal = saiSashihiki.plus(surtax);
  putTag(out, 'ABB01030', taxTotal.toString());
  // 給与所得（収入金額等 ABB00080＝税引前・所得金額等 ABB00370＝給与所得控除後）
  if (pd.salaryIncome) {
    putTag(out, 'ABB00080', pd.salaryIncome.paidAmount.toString());
    putTag(out, 'ABB00370', salaryIncomeAmount(pd.salaryIncome.paidAmount).toString());
  }
  // 雑所得。公的年金等は確定額を所得金額等側にのみ載せる（関数冒頭の注記参照）。
  // その他雑所得は収入金額等側（ABB00110＝収入）・所得金額等側（ABB01120＝収入−必要経費）両方に載せる。
  if (pd.miscIncome) {
    if (pd.miscIncome.publicPensionAmount) {
      putTag(out, 'ABB01060', pd.miscIncome.publicPensionAmount.toString());
    }
    if (pd.miscIncome.otherIncome) {
      putTag(out, 'ABB00110', pd.miscIncome.otherIncome.toString());
      putTag(
        out,
        'ABB01120',
        otherMiscIncome(pd.miscIncome.otherIncome, pd.miscIncome.otherExpenses ?? D(0)).toString()
      );
    }
  }
  // 源泉徴収税額（給与＋事業所得側の直接入力分）・申告納税額（マイナス＝還付相当）
  const withholding = totalWithholdingTax(pd);
  putTag(out, 'ABB00710', withholding.toString());
  putTag(out, 'ABB00720', taxTotal.minus(withholding).toString());
  // 公的年金等以外の合計所得金額・配偶者の合計所得金額（既存収集データからの参考値）
  putTag(
    out,
    'ABB00775',
    totalIncome.minus(pd.miscIncome?.publicPensionAmount ?? D(0)).toString()
  );
  if (pd.spouse) {
    putTag(out, 'ABB00780', pd.spouse.totalIncome.toString());
  }
}

function maxZero(v: Decimal): Decimal {
  return v.greaterThan(0) ? v : D(0);
}