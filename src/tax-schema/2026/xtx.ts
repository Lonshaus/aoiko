// 令和 8 年分（2026 年度）.xtx XML 出力。
//
// 国税庁公式 W3C XSD（e-tax19）由来の schema を 2 段式 ID/IDREF 文書モデルで駆動し、
// 確定申告書（KOA020）+ 決算書・収支内訳書を 1 つの送信データ
// （手続 RKO0010 = 所得税及び復興特別所得税申告）に併載する。青色申告は
// 青色申告決算書一般用（KOA210）、白色申告は収支内訳書一般用（KOA110）を同梱する。
//
// ⚠ aoiko は事業の損益のみを扱う。確定申告書 KOA020 の「事業」部分
// （営業等収入・事業所得・（青色申告のみ）青色申告特別控除）と申告者情報（IT部 必須）は
// 必ず載る。所得控除・税額計算は、利用者が personalDeductions を入力した場合のみ載せ、
// 未入力の場合は従来どおり利用者が e-Tax 上で補完する。
// 決算書・収支内訳書側は PL/BS/月別を対映する。実申告可否は e-Taxソフト(DL版) での
// 実機取込検証を経て利用者が確認すること（docs/xtx-spec/README.md・DISCLAIMER.md 参照）。

import type { BSReport, MonthlyReport, PLReport } from '../../domain/reports';
import type { FixedAsset, PersonalDeductionInput } from '../../db/types';
import { D, type Decimal } from '../../lib/decimal';
import koa020 from './xtx-schema-koa020.generated.json';
import koa210 from './xtx-schema-koa210.generated.json';
import koa110 from './xtx-schema-koa110.generated.json';
import koa220 from './xtx-schema-koa220.generated.json';
import koa130 from './xtx-schema-koa130.generated.json';
import type { XtxSchema } from './xtx-schema';
import { buildXtxBundle, type XtxFilerInfo, type XtxFormInput } from './xtx-document';
import { todayISO } from '../../lib/date';
import type { AoiroDeductionKind } from './aoiro-deduction';
import type { IncomeDeductionInput, TaxCreditInput } from './income-deductions';
import type { OtherIncomeInput } from './other-income';
import type { RealEstateIncomeCtx } from './real-estate-income';
import { mapKoa020LeafValues, mapKoa020Values } from './xtx-mapping-koa020';
import { mapKoa210RepeatedValues, mapKoa210Values } from './xtx-mapping-koa210';
import { mapKoa110Values, mapKoa110RepeatedValues } from './xtx-mapping-koa110';
import { mapKoa220RepeatedValues, mapKoa220Values } from './xtx-mapping-koa220';
import { mapKoa130RepeatedValues, mapKoa130Values } from './xtx-mapping-koa130';
// 申告者情報（e-Tax 提出用）。IT部 定義側の必須・任意項目に対映する。
export interface XtxFiler {
  riyoshaId: string; // 利用者識別番号（16桁）
  name: string; // 氏名・名称
  zip: string; // 郵便番号（7桁・ハイフン無し）
  address: string; // 住所
  zeimushoCode: string; // 提出先税務署コード（5桁）
  zeimushoName: string; // 提出先税務署名
}
// 確定申告方式。青色申告特別控除・決算書の様式（KOA210/KOA110）に影響する。
export type FilingType = 'blue' | 'white';

export interface XtxContext {
  year: number;
  businessName: string;
  invoiceNumber: string;
  monthly: MonthlyReport;
  pl: PLReport;
  bs: BSReport;
  filer: XtxFiler;
  filingType: FilingType;
  aoiroDeductionKind: AoiroDeductionKind;
  /** 白色申告の収支内訳書 第2頁（減価償却資産の明細）用。青色申告時は未使用 */
  fixedAssets: FixedAsset[];
  /** 不動産所得のPL（incomeType: 'realEstate' の仕訳から buildPL で算出）。無ければ不動産所得なし */
  realEstatePl?: PLReport;
  /** 所得控除・税額控除・給与/雑所得の入力（totalIncome は ctx.pl から導出するため含めない）。未入力なら KOA020 側は出力しない */
  personalDeductions?: Omit<IncomeDeductionInput, 'totalIncome'> &
    TaxCreditInput &
    OtherIncomeInput & {
      realEstateIncome?: RealEstateIncomeCtx;
    };
}

const KOA020_SCHEMA = koa020 as XtxSchema;
const KOA210_SCHEMA = koa210 as XtxSchema;
const KOA110_SCHEMA = koa110 as XtxSchema;
const KOA220_SCHEMA = koa220 as XtxSchema;
const KOA130_SCHEMA = koa130 as XtxSchema;

// フォーム入力の生文字列（空・空白・全角数字など）が流入するため、throw させず 0 扱いにする。
function toDec(s: string): Decimal {
  const trimmed = s.trim();
  if (trimmed === '') {
    return D(0);
  }
  try {
    return D(trimmed);
  } catch {
    return D(0);
  }
}

// db.personalDeductions（年度ごとに保存された確定額、文字列）を XtxContext.personalDeductions
// （計算用の Decimal 形状）へ変換する。IncomeDeductions.svelte の試算プレビューと
// Reports.svelte の .xtx 出力の両方から、この1関数だけを共通で使う（値の食い違いを防ぐ）。
export function personalDeductionsToCtx(
  stored: Omit<PersonalDeductionInput, 'year' | 'updatedAt'>,
): NonNullable<XtxContext['personalDeductions']> {
  return {
    socialInsurancePaid: toDec(stored.socialInsurancePaid),
    smallBusinessMutualAidPaid: toDec(stored.smallBusinessMutualAidPaid),
    lifeInsurance: {
      ...(stored.lifeInsurance.newGeneral !== undefined
        ? { newGeneral: toDec(stored.lifeInsurance.newGeneral) }
        : {}),
      ...(stored.lifeInsurance.oldGeneral !== undefined
        ? { oldGeneral: toDec(stored.lifeInsurance.oldGeneral) }
        : {}),
      ...(stored.lifeInsurance.newMedical !== undefined
        ? { newMedical: toDec(stored.lifeInsurance.newMedical) }
        : {}),
      ...(stored.lifeInsurance.newPension !== undefined
        ? { newPension: toDec(stored.lifeInsurance.newPension) }
        : {}),
      ...(stored.lifeInsurance.oldPension !== undefined
        ? { oldPension: toDec(stored.lifeInsurance.oldPension) }
        : {}),
    },
    earthquakeInsurancePaid: toDec(stored.earthquakeInsurancePaid),
    oldLongTermInsurancePaid: toDec(stored.oldLongTermInsurancePaid),
    medicalExpensePaid: toDec(stored.medicalExpensePaid),
    medicalInsuranceReimbursement: toDec(stored.medicalInsuranceReimbursement),
    donationAmount: toDec(stored.donationAmount),
    casualtyLossDeduction: toDec(stored.casualtyLossDeduction),
    isDisabled: stored.isDisabled,
    isSpecialDisabled: stored.isSpecialDisabled,
    isSingleParent: stored.isSingleParent,
    isWidow: stored.isWidow,
    isWorkingStudent: stored.isWorkingStudent,
    ...(stored.spouse
      ? { spouse: { totalIncome: toDec(stored.spouse.totalIncome), age: stored.spouse.age } }
      : {}),
    dependents: stored.dependents.map((d) => ({
      id: d.id,
      age: d.age,
      totalIncome: toDec(d.totalIncome),
      ...(d.livesWithLinealAscendant !== undefined
        ? { livesWithLinealAscendant: d.livesWithLinealAscendant }
        : {}),
    })),
    ...(stored.dividendDeductionAmount !== undefined
      ? { dividendDeductionAmount: toDec(stored.dividendDeductionAmount) }
      : {}),
    ...(stored.mortgageDeductionAmount !== undefined
      ? { mortgageDeductionAmount: toDec(stored.mortgageDeductionAmount) }
      : {}),
    ...(stored.politicalDonationCreditAmount !== undefined
      ? { politicalDonationCreditAmount: toDec(stored.politicalDonationCreditAmount) }
      : {}),
    ...(stored.housingRenovationCreditAmount !== undefined
      ? { housingRenovationCreditAmount: toDec(stored.housingRenovationCreditAmount) }
      : {}),
    ...(stored.foreignTaxCreditAmount !== undefined
      ? { foreignTaxCreditAmount: toDec(stored.foreignTaxCreditAmount) }
      : {}),
    ...(stored.otherTaxCreditAmount !== undefined
      ? { otherTaxCreditAmount: toDec(stored.otherTaxCreditAmount) }
      : {}),
    ...(stored.disasterExemptionAmount !== undefined
      ? { disasterExemptionAmount: toDec(stored.disasterExemptionAmount) }
      : {}),
    ...(stored.salaryIncome
      ? {
          salaryIncome: {
            paidAmount: toDec(stored.salaryIncome.paidAmount),
            withholdingTax: toDec(stored.salaryIncome.withholdingTax),
          },
        }
      : {}),
    ...(stored.miscIncome
      ? {
          miscIncome: {
            ...(stored.miscIncome.publicPensionAmount !== undefined
              ? { publicPensionAmount: toDec(stored.miscIncome.publicPensionAmount) }
              : {}),
            ...(stored.miscIncome.otherIncome !== undefined
              ? { otherIncome: toDec(stored.miscIncome.otherIncome) }
              : {}),
            ...(stored.miscIncome.otherExpenses !== undefined
              ? { otherExpenses: toDec(stored.miscIncome.otherExpenses) }
              : {}),
          },
        }
      : {}),
    ...(stored.otherWithholdingTax !== undefined
      ? { otherWithholdingTax: toDec(stored.otherWithholdingTax) }
      : {}),
    ...(stored.realEstateIncome
      ? {
          realEstateIncome: {
            businessScale: stored.realEstateIncome.businessScale,
            ...(stored.realEstateIncome.landLoanInterestAmount !== undefined
              ? { landLoanInterestAmount: toDec(stored.realEstateIncome.landLoanInterestAmount) }
              : {}),
            ...(stored.realEstateIncome.rentPaid
              ? { rentPaid: stored.realEstateIncome.rentPaid }
              : {}),
            ...(stored.realEstateIncome.loanInterestPaid
              ? { loanInterestPaid: stored.realEstateIncome.loanInterestPaid }
              : {}),
            ...(stored.realEstateIncome.professionalFeesPaid
              ? { professionalFeesPaid: stored.realEstateIncome.professionalFeesPaid }
              : {}),
          },
        }
      : {}),
  };
}

export function toFilerInfo(f: XtxFiler): XtxFilerInfo {
  return {
    zeimushoCode: f.zeimushoCode,
    zeimushoName: f.zeimushoName,
    riyoshaId: f.riyoshaId,
    name: f.name,
    zip: f.zip,
    address: f.address,
  };
}

export function buildXtx2026(ctx: XtxContext): string {
  const creatorName = ctx.businessName.replace(/[\n\r\t]+/g, ' ').trim() || 'aoiko';
  // 事業用の決算書・収支内訳書は常に載る。不動産所得用（KOA220/KOA130）は
  // ctx.realEstatePl がある場合のみ追加で載せる（B7 part2、両方同時申告に対応）。
  const businessStatementForm: XtxFormInput =
    ctx.filingType === 'white'
      ? {
          schema: KOA110_SCHEMA,
          values: {},
          leafValues: mapKoa110Values(ctx),
          repeats: mapKoa110RepeatedValues(ctx),
        }
      : {
          schema: KOA210_SCHEMA,
          values: {},
          leafValues: mapKoa210Values(ctx),
          repeats: mapKoa210RepeatedValues(ctx),
        };
  const realEstateStatementForm: XtxFormInput | undefined = !ctx.realEstatePl
    ? undefined
    : ctx.filingType === 'white'
      ? {
          schema: KOA130_SCHEMA,
          values: {},
          leafValues: mapKoa130Values(ctx),
          repeats: mapKoa130RepeatedValues(ctx),
        }
      : {
          schema: KOA220_SCHEMA,
          values: {},
          leafValues: mapKoa220Values(ctx),
          repeats: mapKoa220RepeatedValues(ctx),
        };
  return buildXtxBundle(
    [
      {
        schema: KOA020_SCHEMA,
        values: mapKoa020Values(ctx),
        leafValues: mapKoa020LeafValues(ctx),
      },
      businessStatementForm,
      ...(realEstateStatementForm ? [realEstateStatementForm] : []),
    ],
    {
      creatorName,
      creationDate: todayISO(),
      filer: toFilerInfo(ctx.filer),
    },
  );
}
