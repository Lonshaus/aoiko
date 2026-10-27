<script lang="ts">
  import { clearUnsavedGuard, setUnsavedGuard } from '../router.svelte';
  import { untrack } from 'svelte';
  import { db } from '../db';
  import { D, formatJPY } from '../lib/decimal';
  import { isAmountInputInvalid, parseAmountInput, parseIntegerInput } from '../lib/amount-input';
  import { newId } from '../lib/id';
  import { assignInputNumberOrEmpty } from '../lib/number-input';
  import { getSetting } from '../lib/settings';
  import { describeStorageError } from '../lib/storage-error';
  import { buildPL } from '../domain/reports';
  import {
    computeIncomeDeductions,
    progressiveIncomeTax,
    reconstructionSurtax,
    totalTaxCredits,
  } from '../tax-schema/2026/income-deductions';
  import { totalWithholdingTax } from '../tax-schema/2026/other-income';
  import {
    businessFamilyEmployeeDeductionResultForOutput,
    combinedTotalIncomeAmount,
    realEstateFamilyEmployeeDeductionResult,
    totalIncomeAmount,
  } from '../tax-schema/2026/xtx-mapping-koa020';
  import { familyEmployeeExclusion } from '../tax-schema/2026/family-employee-deduction';
  import type {
    FamilyEmployeeRelation,
    PersonalDeductionDependent,
    PersonalDeductionFamilyEmployee,
    PersonalDeductionInput,
    RealEstateLoanInterestPaidDetail,
    RealEstateProfessionalFeeDetail,
    RealEstateRentPaidDetail,
  } from '../db/types';
  import type { AoiroDeductionKind } from '../tax-schema/2026/aoiro-deduction';
  import { personalDeductionsToCtx, type FilingType } from '../tax-schema/2026/xtx';
  import { validatePersonalDeductions } from '../domain/stored-value-checks';
  import { ledger } from '../stores/ledger.svelte';
  import { m } from '../paraglide/messages';

  const now = new Date();
  let year = $state(now.getFullYear());

  let socialInsurancePaid = $state('0');
  let smallBusinessMutualAidPaid = $state('0');
  let lifeNewGeneral = $state('0');
  let lifeOldGeneral = $state('0');
  let lifeNewMedical = $state('0');
  let lifeNewPension = $state('0');
  let lifeOldPension = $state('0');
  let earthquakeInsurancePaid = $state('0');
  let oldLongTermInsurancePaid = $state('0');
  let medicalExpensePaid = $state('0');
  let medicalInsuranceReimbursement = $state('0');
  let donationAmount = $state('0');
  let casualtyLossDeduction = $state('0');
  let isDisabled = $state(false);
  let isSpecialDisabled = $state(false);
  let isSingleParent = $state(false);
  let isWidow = $state(false);
  let isWorkingStudent = $state(false);
  let hasSpouse = $state(false);
  let spouseIncome = $state('0');
  let spouseAge = $state<number | undefined>(40);
  let dependents = $state<
    Array<{
      id: string;
      name: string;
      age: number | undefined;
      totalIncome: string;
      livesWithLinealAscendant: boolean;
    }>
  >([]);
  let familyEmployees = $state<
    Array<{
      id: string;
      name: string;
      relation: FamilyEmployeeRelation;
      age: number | undefined;
      monthsWorked: number | undefined;
      incomeType: 'business' | 'realEstate';
    }>
  >([]);
  let dividendDeductionAmount = $state('0');
  let mortgageDeductionAmount = $state('0');
  let politicalDonationCreditAmount = $state('0');
  let housingRenovationCreditAmount = $state('0');
  let foreignTaxCreditAmount = $state('0');
  let otherTaxCreditAmount = $state('0');
  let disasterExemptionAmount = $state('0');
  let hasSalaryIncome = $state(false);
  let salaryPaidAmount = $state('0');
  let salaryWithholdingTax = $state('0');
  let salaryLastPaymentBeforeDecember = $state(false);
  let publicPensionAmount = $state('0');
  let otherMiscIncomeAmount = $state('0');
  let otherMiscExpenses = $state('0');
  let otherWithholdingTaxPaid = $state('0');
  let homeWorker = $state(false);
  let priorPriorBusinessRevenue = $state('0');
  let priorPriorRealEstateRevenue = $state('0');

  let realEstateBusinessScale = $state(false);
  let realEstateLandLoanInterest = $state('0');
  let realEstateRentPaid = $state<Array<RealEstateRentPaidDetail & { id: string }>>([]);
  let realEstateLoanInterestPaid = $state<Array<RealEstateLoanInterestPaidDetail & { id: string }>>(
    [],
  );
  let realEstateProfessionalFeesPaid = $state<
    Array<RealEstateProfessionalFeeDetail & { id: string }>
  >([]);

  function addRealEstateRentPaid() {
    realEstateRentPaid = [...realEstateRentPaid, { id: newId(), amount: '0' }];
  }
  function removeRealEstateRentPaid(id: string) {
    realEstateRentPaid = realEstateRentPaid.filter((r) => r.id !== id);
  }
  function addRealEstateLoanInterestPaid() {
    realEstateLoanInterestPaid = [...realEstateLoanInterestPaid, { id: newId(), amount: '0' }];
  }
  function removeRealEstateLoanInterestPaid(id: string) {
    realEstateLoanInterestPaid = realEstateLoanInterestPaid.filter((r) => r.id !== id);
  }
  function addRealEstateProfessionalFeesPaid() {
    realEstateProfessionalFeesPaid = [
      ...realEstateProfessionalFeesPaid,
      { id: newId(), amount: '0' },
    ];
  }
  function removeRealEstateProfessionalFeesPaid(id: string) {
    realEstateProfessionalFeesPaid = realEstateProfessionalFeesPaid.filter((r) => r.id !== id);
  }

  let saved = $state(false);
  // 保存済みの値のうち読めない欄。.xtx は同じ判定で止まるため、ここでも名前を示す
  let storedIssues = $state<string[]>([]);
  let saveError = $state('');
  // 最後に保存した内容の署名。null の間は読み込み前なので未保存扱いにしない。
  let savedSnapshot = $state<string | null>(null);
  // 年度切替の非同期ロードが完了した年度。loadedYear !== year の間は旧年度の編集値を
  // 抱えたままなので保存を禁じる（新年度キーへの誤書き込み防止）。
  let loadedYear = $state<number | null>(null);
  const YEAR_RANGE = { min: 2020, max: 2099 };
  // 年度欄が空・範囲外の間は year を直前の値のまま残し、保存だけを止める
  let yearInvalid = $state(false);
  // 年度の帳簿を読み込めなかったときの理由。この間は試算に前の年度の値を使わず、保存もしない
  let loadError = $state('');
  // 素早い年度往復で後着の旧 promise が新年度の表示を上書きしないための世代トークン。
  let loadToken = 0;
  // 年度ごとに DB/設定から読み込む値（利用者の入力欄とは独立、年度切替時のみ再取得）。
  let plCache = $state<Awaited<ReturnType<typeof buildPL>> | null>(null);
  let realEstatePlCache = $state<Awaited<ReturnType<typeof buildPL>> | undefined>(undefined);
  let filingTypeCache = $state<FilingType>('blue');
  let aoiroDeductionKindCache = $state<AoiroDeductionKind>('electronic');
  let cashBasisCache = $state(false);

  function resetForm() {
    socialInsurancePaid = '0';
    smallBusinessMutualAidPaid = '0';
    lifeNewGeneral = '0';
    lifeOldGeneral = '0';
    lifeNewMedical = '0';
    lifeNewPension = '0';
    lifeOldPension = '0';
    earthquakeInsurancePaid = '0';
    oldLongTermInsurancePaid = '0';
    medicalExpensePaid = '0';
    medicalInsuranceReimbursement = '0';
    donationAmount = '0';
    casualtyLossDeduction = '0';
    isDisabled = false;
    isSpecialDisabled = false;
    isSingleParent = false;
    isWidow = false;
    isWorkingStudent = false;
    hasSpouse = false;
    spouseIncome = '0';
    spouseAge = 40;
    dependents = [];
    familyEmployees = [];
    dividendDeductionAmount = '0';
    mortgageDeductionAmount = '0';
    politicalDonationCreditAmount = '0';
    housingRenovationCreditAmount = '0';
    foreignTaxCreditAmount = '0';
    otherTaxCreditAmount = '0';
    disasterExemptionAmount = '0';
    hasSalaryIncome = false;
    salaryPaidAmount = '0';
    salaryWithholdingTax = '0';
    salaryLastPaymentBeforeDecember = false;
    publicPensionAmount = '0';
    otherMiscIncomeAmount = '0';
    otherMiscExpenses = '0';
    otherWithholdingTaxPaid = '0';
    homeWorker = false;
    priorPriorBusinessRevenue = '0';
    priorPriorRealEstateRevenue = '0';
    realEstateBusinessScale = false;
    realEstateLandLoanInterest = '0';
    realEstateRentPaid = [];
    realEstateLoanInterestPaid = [];
    realEstateProfessionalFeesPaid = [];
  }

  function isLoadableShape(stored: PersonalDeductionInput): boolean {
    const v = stored as unknown as Record<string, unknown>;
    const isObj = (x: unknown) => typeof x === 'object' && x !== null && !Array.isArray(x);
    const isObjArray = (x: unknown) => Array.isArray(x) && x.every(isObj);
    const re = v.realEstateIncome as Record<string, unknown> | null | undefined;
    return (
      isObj(v.lifeInsurance) &&
      isObjArray(v.dependents) &&
      (v.familyEmployees == null || isObjArray(v.familyEmployees)) &&
      (!v.spouse || isObj(v.spouse)) &&
      (!re ||
        (isObj(re) &&
          ['rentPaid', 'loanInterestPaid', 'professionalFeesPaid'].every(
            (k) => !re[k] || isObjArray(re[k]),
          )))
    );
  }

  function loadFromStored(stored: PersonalDeductionInput) {
    socialInsurancePaid = stored.socialInsurancePaid;
    smallBusinessMutualAidPaid = stored.smallBusinessMutualAidPaid;
    lifeNewGeneral = stored.lifeInsurance.newGeneral ?? '0';
    lifeOldGeneral = stored.lifeInsurance.oldGeneral ?? '0';
    lifeNewMedical = stored.lifeInsurance.newMedical ?? '0';
    lifeNewPension = stored.lifeInsurance.newPension ?? '0';
    lifeOldPension = stored.lifeInsurance.oldPension ?? '0';
    earthquakeInsurancePaid = stored.earthquakeInsurancePaid;
    oldLongTermInsurancePaid = stored.oldLongTermInsurancePaid;
    medicalExpensePaid = stored.medicalExpensePaid;
    medicalInsuranceReimbursement = stored.medicalInsuranceReimbursement;
    donationAmount = stored.donationAmount;
    casualtyLossDeduction = stored.casualtyLossDeduction;
    isDisabled = stored.isDisabled;
    isSpecialDisabled = stored.isSpecialDisabled;
    isSingleParent = stored.isSingleParent;
    isWidow = stored.isWidow;
    isWorkingStudent = stored.isWorkingStudent;
    hasSpouse = !!stored.spouse;
    spouseIncome = stored.spouse?.totalIncome ?? '0';
    spouseAge = stored.spouse?.age ?? 40;
    dependents = stored.dependents.map((d) => ({
      id: d.id,
      name: d.name,
      age: d.age,
      totalIncome: d.totalIncome,
      livesWithLinealAscendant: d.livesWithLinealAscendant ?? false,
    }));
    familyEmployees = (stored.familyEmployees ?? []).map((f) => ({
      id: f.id,
      name: f.name,
      relation: f.relation,
      age: f.age,
      monthsWorked: f.monthsWorked,
      incomeType: f.incomeType ?? 'business',
    }));
    dividendDeductionAmount = stored.dividendDeductionAmount ?? '0';
    mortgageDeductionAmount = stored.mortgageDeductionAmount ?? '0';
    politicalDonationCreditAmount = stored.politicalDonationCreditAmount ?? '0';
    housingRenovationCreditAmount = stored.housingRenovationCreditAmount ?? '0';
    foreignTaxCreditAmount = stored.foreignTaxCreditAmount ?? '0';
    otherTaxCreditAmount = stored.otherTaxCreditAmount ?? '0';
    disasterExemptionAmount = stored.disasterExemptionAmount ?? '0';
    hasSalaryIncome = !!stored.salaryIncome;
    salaryPaidAmount = stored.salaryIncome?.paidAmount ?? '0';
    salaryWithholdingTax = stored.salaryIncome?.withholdingTax ?? '0';
    salaryLastPaymentBeforeDecember = stored.salaryIncome?.lastPaymentBeforeDecember ?? false;
    publicPensionAmount = stored.miscIncome?.publicPensionAmount ?? '0';
    otherMiscIncomeAmount = stored.miscIncome?.otherIncome ?? '0';
    otherMiscExpenses = stored.miscIncome?.otherExpenses ?? '0';
    otherWithholdingTaxPaid = stored.otherWithholdingTax ?? '0';
    homeWorker = stored.homeWorker ?? false;
    priorPriorBusinessRevenue = stored.priorPriorBusinessRevenue ?? '0';
    priorPriorRealEstateRevenue = stored.priorPriorRealEstateRevenue ?? '0';
    realEstateBusinessScale = stored.realEstateIncome?.businessScale ?? false;
    realEstateLandLoanInterest = stored.realEstateIncome?.landLoanInterestAmount ?? '0';
    realEstateRentPaid = (stored.realEstateIncome?.rentPaid || []).map((r) => ({
      ...r,
      id: newId(),
    }));
    realEstateLoanInterestPaid = (stored.realEstateIncome?.loanInterestPaid || []).map((r) => ({
      ...r,
      id: newId(),
    }));
    realEstateProfessionalFeesPaid = (stored.realEstateIncome?.professionalFeesPaid || []).map(
      (r) => ({
        ...r,
        id: newId(),
      }),
    );
  }

  $effect(() => {
    const yr = year;
    const gen = ++loadToken;
    saved = false;
    loadedYear = null;
    loadError = '';
    (async () => {
      try {
        await loadYear(yr, gen);
      } catch (e) {
        if (gen !== loadToken) {
          return;
        }
        plCache = null;
        realEstatePlCache = undefined;
        loadError = describeStorageError(e);
      }
    })();
  });

  async function loadYear(yr: number, gen: number): Promise<void> {
    const stored = await db.personalDeductions.get(yr);
    if (gen !== loadToken) {
      return;
    }
    storedIssues = stored ? validatePersonalDeductions(stored) : [];
    // 形が壊れた記録（復元データ）は欄へ写すと例外になるため、写さずに空の入力から始める
    if (stored && isLoadableShape(stored)) {
      loadFromStored(stored);
    } else {
      resetForm();
    }
    const pl = await buildPL(yr);
    const filingType = ((await getSetting('filingType')) ?? 'blue') as FilingType;
    const aoiroDeductionKind = ((await getSetting('aoiroDeductionKind')) ??
      'electronic') as AoiroDeductionKind;
    const cashBasisElection = (await getSetting('cashBasisElection')) ?? false;
    const realEstatePl = ledger.realEstateIncomeEnabled
      ? await buildPL(yr, undefined, 'realEstate')
      : undefined;
    if (gen !== loadToken) {
      return;
    }
    plCache = pl;
    filingTypeCache = filingType;
    aoiroDeductionKindCache = aoiroDeductionKind;
    cashBasisCache = cashBasisElection;
    realEstatePlCache = realEstatePl;
    loadedYear = yr;
    // untrack しないと全入力欄がこの effect の依存になり、打鍵ごとに再ロードされる。
    savedSnapshot = untrack(() => draftSignature);
  }

  function addDependent() {
    dependents = [
      ...dependents,
      { id: newId(), name: '', age: 18, totalIncome: '0', livesWithLinealAscendant: false },
    ];
  }

  function removeDependent(id: string) {
    dependents = dependents.filter((d) => d.id !== id);
  }

  function addFamilyEmployee() {
    familyEmployees = [
      ...familyEmployees,
      {
        id: newId(),
        name: '',
        relation: 'other',
        age: 18,
        monthsWorked: 12,
        incomeType: 'business',
      },
    ];
  }

  function removeFamilyEmployee(id: string) {
    familyEmployees = familyEmployees.filter((f) => f.id !== id);
  }
  // 保存用（文字列）と試算用（Decimal）の二重管理を避けるため、まずこの文字列形状を
  // 1箇所で組み立て、personalDeductionsToCtx() で試算用 Decimal 形状に変換する
  // （xtx.ts 側と同じ変換ロジックを共有し、保存内容と試算・.xtx 出力の食い違いを防ぐ）。
  const recordDraft = $derived<Omit<PersonalDeductionInput, 'year' | 'updatedAt'>>({
    socialInsurancePaid,
    smallBusinessMutualAidPaid,
    lifeInsurance: {
      newGeneral: lifeNewGeneral,
      oldGeneral: lifeOldGeneral,
      newMedical: lifeNewMedical,
      newPension: lifeNewPension,
      oldPension: lifeOldPension,
    },
    earthquakeInsurancePaid,
    oldLongTermInsurancePaid,
    medicalExpensePaid,
    medicalInsuranceReimbursement,
    donationAmount,
    casualtyLossDeduction,
    isDisabled,
    isSpecialDisabled,
    isSingleParent,
    isWidow,
    isWorkingStudent,
    ...(hasSpouse ? { spouse: { totalIncome: spouseIncome, age: spouseAge ?? 0 } } : {}),
    dependents: dependents.map((d): PersonalDeductionDependent => ({
      id: d.id,
      name: d.name,
      age: d.age ?? 0,
      totalIncome: d.totalIncome,
      livesWithLinealAscendant: d.livesWithLinealAscendant,
    })),
    ...(familyEmployees.length > 0
      ? {
          familyEmployees: familyEmployees.map((f): PersonalDeductionFamilyEmployee => ({
            id: f.id,
            name: f.name,
            relation: f.relation,
            age: f.age ?? 0,
            monthsWorked: f.monthsWorked ?? 0,
            incomeType: f.incomeType,
          })),
        }
      : {}),
    dividendDeductionAmount,
    mortgageDeductionAmount,
    politicalDonationCreditAmount,
    housingRenovationCreditAmount,
    foreignTaxCreditAmount,
    otherTaxCreditAmount,
    disasterExemptionAmount,
    ...(hasSalaryIncome
      ? {
          salaryIncome: {
            paidAmount: salaryPaidAmount,
            withholdingTax: salaryWithholdingTax,
            lastPaymentBeforeDecember: salaryLastPaymentBeforeDecember,
          },
        }
      : {}),
    miscIncome: {
      ...(isAmountInputInvalid(publicPensionAmount) ||
      parseAmountInput(publicPensionAmount)?.greaterThan(0)
        ? { publicPensionAmount }
        : {}),
      otherIncome: otherMiscIncomeAmount,
      otherExpenses: otherMiscExpenses,
    },
    otherWithholdingTax: otherWithholdingTaxPaid,
    homeWorker,
    priorPriorBusinessRevenue,
    priorPriorRealEstateRevenue,
    ...(ledger.realEstateIncomeEnabled
      ? {
          realEstateIncome: {
            businessScale: realEstateBusinessScale,
            landLoanInterestAmount: realEstateLandLoanInterest,
            rentPaid: realEstateRentPaid.map(({ id: _id, ...r }) => r),
            loanInterestPaid: realEstateLoanInterestPaid.map(({ id: _id, ...r }) => r),
            professionalFeesPaid: realEstateProfessionalFeesPaid.map(({ id: _id, ...r }) => r),
          },
        }
      : {}),
  });

  const draftSignature = $derived(JSON.stringify(recordDraft));
  const AGE_RANGE = { min: 0, max: 120 };
  const MONTHS_RANGE = { min: 0, max: 12 };
  // 復元された記録では年齢が文字列のこともあるため、数値以外は誤りとして数える
  const intInvalid = (v: unknown, range: { min: number; max: number }): boolean =>
    typeof v !== 'number' || parseIntegerInput(String(v), range) === undefined;
  // 画面に出ている欄だけを数える。保存は 1 件でも誤りがあれば行わない
  const invalidFieldCount = $derived.by(() => {
    const d = recordDraft;
    const raws: Array<string | undefined> = [
      d.socialInsurancePaid,
      d.smallBusinessMutualAidPaid,
      ...Object.values(d.lifeInsurance),
      d.earthquakeInsurancePaid,
      d.oldLongTermInsurancePaid,
      d.medicalExpensePaid,
      d.medicalInsuranceReimbursement,
      d.donationAmount,
      d.casualtyLossDeduction,
      d.spouse?.totalIncome,
      ...d.dependents.map((x) => x.totalIncome),
      d.dividendDeductionAmount,
      d.mortgageDeductionAmount,
      d.politicalDonationCreditAmount,
      d.housingRenovationCreditAmount,
      d.foreignTaxCreditAmount,
      d.otherTaxCreditAmount,
      d.disasterExemptionAmount,
      d.salaryIncome?.paidAmount,
      d.salaryIncome?.withholdingTax,
      d.miscIncome?.publicPensionAmount,
      d.miscIncome?.otherIncome,
      d.miscIncome?.otherExpenses,
      d.otherWithholdingTax,
      d.priorPriorBusinessRevenue,
      d.priorPriorRealEstateRevenue,
      d.realEstateIncome?.landLoanInterestAmount,
      ...(d.realEstateIncome?.rentPaid ?? []).flatMap((r) => [r.amount, r.deductibleAmount]),
      ...(d.realEstateIncome?.loanInterestPaid ?? []).flatMap((r) => [
        r.amount,
        r.deductibleAmount,
        r.yearEndBalance,
      ]),
      ...(d.realEstateIncome?.professionalFeesPaid ?? []).flatMap((r) => [
        r.amount,
        r.deductibleAmount,
        r.withholdingTax,
      ]),
    ];
    let count = raws.filter((v) => v !== undefined && isAmountInputInvalid(v)).length;
    if (hasSpouse && intInvalid(spouseAge, AGE_RANGE)) {
      count += 1;
    }
    count += dependents.filter((x) => intInvalid(x.age, AGE_RANGE)).length;
    for (const f of familyEmployees) {
      count +=
        Number(intInvalid(f.age, AGE_RANGE)) + Number(intInvalid(f.monthsWorked, MONTHS_RANGE));
    }
    return count;
  });
  // 保存済みの内容と一致しなくなったら未保存。約40項目あり、失うと打ち直しになる。
  const isDirty = $derived(savedSnapshot !== null && draftSignature !== savedSnapshot);
  // タブを閉じる操作も App 内の画面遷移も router 側の 1 つの判定でカバーされる。
  const unsavedToken = {};
  $effect(() => {
    setUnsavedGuard(unsavedToken, isDirty);
    return () => clearUnsavedGuard(unsavedToken);
  });
  const ctx = $derived(personalDeductionsToCtx(recordDraft));
  // 事業所得（青色控除は不動産所得との共有枠配分後）。ledger 由来の pl はキャッシュから、
  // businessScale・土地利子額は現在編集中の ctx から読むため、両方の変更に反応する。
  const businessTotalIncome = $derived(
    plCache
      ? totalIncomeAmount({
          year,
          pl: plCache,
          filingType: filingTypeCache,
          aoiroDeductionKind: aoiroDeductionKindCache,
          cashBasis: cashBasisCache,
          ...(realEstatePlCache ? { realEstatePl: realEstatePlCache } : {}),
          personalDeductions: ctx,
        })
      : D(0),
  );
  // 不動産所得のPL（青色控除前）。試算欄の内訳表示にのみ使う。
  const realEstateTotalIncome = $derived(realEstatePlCache ? D(realEstatePlCache.netIncome) : D(0));
  // 事業所得＋不動産所得（損益通算可能分）＋給与所得＋雑所得（B7）。
  const combinedTotalIncome = $derived(
    plCache
      ? combinedTotalIncomeAmount({
          year,
          pl: plCache,
          filingType: filingTypeCache,
          aoiroDeductionKind: aoiroDeductionKindCache,
          cashBasis: cashBasisCache,
          ...(realEstatePlCache ? { realEstatePl: realEstatePlCache } : {}),
          personalDeductions: ctx,
        })
      : D(0),
  );
  // 事業専従者控除（白色申告のみ、続柄で決まる定額）。事業所得側・不動産所得側の合計を表示する。
  const familyEmployeeDeductionTotal = $derived.by(() => {
    if (!plCache) {
      return D(0);
    }
    const incomeCtx = {
      year,
      pl: plCache,
      filingType: filingTypeCache,
      aoiroDeductionKind: aoiroDeductionKindCache,
      cashBasis: cashBasisCache,
      ...(realEstatePlCache ? { realEstatePl: realEstatePlCache } : {}),
      personalDeductions: ctx,
    };
    return businessFamilyEmployeeDeductionResultForOutput(incomeCtx).total.plus(
      realEstateFamilyEmployeeDeductionResult(incomeCtx).total,
    );
  });
  // 事業専従者との相互排他（issue #307）。ctx 側は既に personalDeductionsToCtx で
  // 除外済みだが、UI 上で「なぜ配偶者控除・扶養控除が消えたか」を示すため、同じ判定を
  // ローカルの入力値（配偶者チェック・扶養親族一覧）に対して再度行う。
  const familyEmployeeExclusionResult = $derived(
    familyEmployeeExclusion(
      familyEmployees.map((f) => ({ ...f, age: f.age ?? 0, monthsWorked: f.monthsWorked ?? 0 })),
      dependents.map((d) => ({ id: d.id, name: d.name })),
    ),
  );
  const spouseExcludedByFamilyEmployee = $derived(
    hasSpouse && familyEmployeeExclusionResult.spouseExcluded,
  );
  const result = $derived(
    computeIncomeDeductions(year, { ...ctx, totalIncome: combinedTotalIncome }),
  );
  const taxableIncome = $derived.by(() => {
    const v = combinedTotalIncome.minus(result.total);
    return v.greaterThan(0) ? v : D(0);
  });
  const incomeTax = $derived(progressiveIncomeTax(taxableIncome));
  const credits = $derived(totalTaxCredits(ctx));
  const afterCredits = $derived.by(() => {
    const v = incomeTax.minus(credits);
    return v.greaterThan(0) ? v : D(0);
  });
  const surtax = $derived(reconstructionSurtax(afterCredits));
  const finalTax = $derived(afterCredits.plus(surtax));
  const withholding = $derived(totalWithholdingTax(ctx));
  const netTaxDue = $derived(finalTax.minus(withholding));

  async function save() {
    if (loadedYear !== year || yearInvalid || loadError !== '' || invalidFieldCount > 0) {
      return;
    }
    // 書けなかったのに「保存しました」を出すと、未保存の警告も止まってしまう。
    try {
      await db.personalDeductions.put({ ...recordDraft, year, updatedAt: Date.now() });
    } catch (e) {
      saveError = describeStorageError(e);
      saved = false;
      return;
    }
    saveError = '';
    savedSnapshot = draftSignature;
    saved = true;
  }
</script>

{#snippet intError(value: number | undefined, min: number, max: number)}
  {#if intInvalid(value, { min, max })}
    <span class="block mt-1 text-xs text-destructive">{m.common_integer_invalid({ min, max })}</span
    >
  {/if}
{/snippet}

{#snippet amountError(value: string | undefined)}
  {#if typeof value === 'string' && isAmountInputInvalid(value)}
    <span class="block mt-1 text-xs text-destructive">{m.common_amount_invalid()}</span>
  {/if}
{/snippet}

<div class="space-y-8">
  <h2 class="text-2xl font-bold">{m.income_deductions_title()}</h2>
  <p class="text-xs text-muted-foreground">{m.income_deductions_intro()}</p>
  {#if storedIssues.length > 0}
    <p
      class="text-sm text-destructive border border-destructive bg-destructive/10 rounded px-3 py-2"
      role="alert"
    >
      {m.income_deductions_stored_invalid({ fields: storedIssues.join('、') })}
    </p>
  {/if}

  <section class="space-y-4 border rounded-lg p-6 bg-card text-card-foreground">
    <label class="block sm:max-w-xs">
      <span class="text-xs text-muted-foreground">{m.income_deductions_year_label()}</span>
      <input
        type="number"
        name="deductionNen"
        autocomplete="off"
        value={year}
        oninput={assignInputNumberOrEmpty((v) => {
          const y = parseIntegerInput(v === undefined ? '' : String(v), YEAR_RANGE);
          yearInvalid = y === undefined;
          if (y !== undefined) {
            year = y;
          }
        })}
        min="2020"
        max="2099"
        step="1"
        class="mt-1 w-full px-3 py-2 bg-background border rounded text-foreground"
      />
      {#if yearInvalid}
        <span class="block mt-1 text-xs text-destructive"
          >{m.common_integer_invalid(YEAR_RANGE)}</span
        >
      {/if}
    </label>
    {#if loadError}
      <p class="text-sm text-destructive" role="alert">
        {m.income_deductions_load_failed({ message: loadError })}
      </p>
    {/if}
    <p class="text-sm">
      {m.income_deductions_total_income_label()}：<span class="font-mono"
        >{formatJPY(businessTotalIncome)}</span
      >
    </p>
    <p class="text-sm">
      {m.income_deductions_combined_total_income_label()}：<span class="font-mono"
        >{formatJPY(combinedTotalIncome)}</span
      >
    </p>
    {#if filingTypeCache === 'white' && familyEmployeeDeductionTotal.greaterThan(0)}
      <p class="text-sm">
        {m.income_deductions_result_family_employee()}：<span class="font-mono"
          >{formatJPY(familyEmployeeDeductionTotal)}</span
        >
      </p>
    {/if}
  </section>

  <section class="space-y-4 border rounded-lg p-6 bg-card text-card-foreground">
    <h3 class="text-lg font-semibold">{m.income_deductions_other_income_title()}</h3>
    <p class="text-xs text-muted-foreground">{m.income_deductions_other_income_intro()}</p>
    <label class="flex items-center gap-2 py-2">
      <input type="checkbox" bind:checked={hasSalaryIncome} />
      <span class="text-sm">{m.income_deductions_salary_checkbox()}</span>
    </label>
    {#if hasSalaryIncome}
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 pl-6">
        <label class="block">
          <span class="text-xs text-muted-foreground"
            >{m.income_deductions_salary_paid_amount()}</span
          >
          <input
            type="text"
            name="salaryPaidAmount"
            autocomplete="off"
            inputmode="numeric"
            bind:value={salaryPaidAmount}
            class="mt-1 w-full px-3 py-2 bg-background border rounded text-foreground font-mono"
          />
          {@render amountError(salaryPaidAmount)}
        </label>
        <label class="block">
          <span class="text-xs text-muted-foreground"
            >{m.income_deductions_salary_withholding_tax()}</span
          >
          <input
            type="text"
            name="salaryWithholdingTax"
            autocomplete="off"
            inputmode="numeric"
            bind:value={salaryWithholdingTax}
            class="mt-1 w-full px-3 py-2 bg-background border rounded text-foreground font-mono"
          />
          {@render amountError(salaryWithholdingTax)}
        </label>
        {#if year === 2026}
          <label class="flex items-center gap-2 py-2 sm:col-span-2">
            <input type="checkbox" bind:checked={salaryLastPaymentBeforeDecember} />
            <span class="text-sm">{m.income_salary_last_payment_before_december()}</span>
          </label>
        {/if}
      </div>
    {/if}
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <label class="block">
        <span class="text-xs text-muted-foreground"
          >{m.income_deductions_public_pension_amount()}</span
        >
        <input
          type="text"
          name="publicPensionAmount"
          autocomplete="off"
          inputmode="numeric"
          bind:value={publicPensionAmount}
          class="mt-1 w-full px-3 py-2 bg-background border rounded text-foreground font-mono"
        />
        {@render amountError(publicPensionAmount)}
        <span class="block mt-1 text-xs text-muted-foreground"
          >{m.income_deductions_public_pension_hint()}</span
        >
      </label>
      <label class="block">
        <span class="text-xs text-muted-foreground">{m.income_deductions_other_misc_income()}</span>
        <input
          type="text"
          name="otherMiscIncomeAmount"
          autocomplete="off"
          inputmode="numeric"
          bind:value={otherMiscIncomeAmount}
          class="mt-1 w-full px-3 py-2 bg-background border rounded text-foreground font-mono"
        />
        {@render amountError(otherMiscIncomeAmount)}
      </label>
      <label class="block">
        <span class="text-xs text-muted-foreground"
          >{m.income_deductions_other_misc_expenses()}</span
        >
        <input
          type="text"
          name="otherMiscKeihi"
          autocomplete="off"
          inputmode="numeric"
          bind:value={otherMiscExpenses}
          class="mt-1 w-full px-3 py-2 bg-background border rounded text-foreground font-mono"
        />
        {@render amountError(otherMiscExpenses)}
      </label>
      <label class="block">
        <span class="text-xs text-muted-foreground"
          >{m.income_deductions_other_withholding_tax()}</span
        >
        <input
          type="text"
          name="otherWithholdingTaxPaid"
          autocomplete="off"
          inputmode="numeric"
          bind:value={otherWithholdingTaxPaid}
          class="mt-1 w-full px-3 py-2 bg-background border rounded text-foreground font-mono"
        />
        {@render amountError(otherWithholdingTaxPaid)}
      </label>
    </div>
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <label class="block">
        <span class="text-xs text-muted-foreground">{m.income_prior_prior_business_revenue()}</span>
        <input
          type="text"
          name="priorPriorJigyoRevenue"
          autocomplete="off"
          inputmode="numeric"
          bind:value={priorPriorBusinessRevenue}
          class="mt-1 w-full px-3 py-2 bg-background border rounded text-foreground font-mono"
        />
        {@render amountError(priorPriorBusinessRevenue)}
      </label>
      <label class="block">
        <span class="text-xs text-muted-foreground"
          >{m.income_prior_prior_real_estate_revenue()}</span
        >
        <input
          type="text"
          name="priorPriorFudosanRevenue"
          autocomplete="off"
          inputmode="numeric"
          bind:value={priorPriorRealEstateRevenue}
          class="mt-1 w-full px-3 py-2 bg-background border rounded text-foreground font-mono"
        />
        {@render amountError(priorPriorRealEstateRevenue)}
      </label>
    </div>
    <label class="flex items-center gap-2 py-2">
      <input type="checkbox" bind:checked={homeWorker} />
      <span class="text-sm">{m.income_home_worker()}</span>
    </label>
  </section>

  {#if ledger.realEstateIncomeEnabled}
    <section class="space-y-4 border rounded-lg p-6 bg-card text-card-foreground">
      <h3 class="text-lg font-semibold">{m.income_deductions_real_estate_title()}</h3>
      <p class="text-xs text-muted-foreground">{m.income_deductions_real_estate_intro()}</p>
      <p class="text-sm">
        {m.income_deductions_real_estate_pl_label()}：<span class="font-mono"
          >{formatJPY(realEstateTotalIncome)}</span
        >
      </p>
      <label class="flex items-center gap-2 py-2">
        <input type="checkbox" bind:checked={realEstateBusinessScale} />
        <span class="text-sm">{m.income_deductions_real_estate_business_scale()}</span>
      </label>
      <label class="block sm:max-w-xs">
        <span class="text-xs text-muted-foreground"
          >{m.income_deductions_real_estate_land_loan_interest()}</span
        >
        <input
          type="text"
          name="landLoanInterest"
          autocomplete="off"
          inputmode="numeric"
          bind:value={realEstateLandLoanInterest}
          class="mt-1 w-full px-3 py-2 bg-background border rounded text-foreground font-mono"
        />
        {@render amountError(realEstateLandLoanInterest)}
        <span class="block mt-1 text-xs text-muted-foreground"
          >{m.income_deductions_real_estate_land_loan_interest_hint()}</span
        >
      </label>

      <div class="flex items-center justify-between pt-2 border-t">
        <h4 class="text-sm font-semibold">{m.income_deductions_real_estate_rent_paid_title()}</h4>
        <button
          type="button"
          onclick={addRealEstateRentPaid}
          class="px-3 py-1 text-sm bg-secondary text-secondary-foreground rounded hover:opacity-90"
        >
          {m.income_deductions_dependent_add()}
        </button>
      </div>
      {#each realEstateRentPaid as r (r.id)}
        <div class="grid grid-cols-1 md:grid-cols-5 gap-2 items-end border-t pt-2">
          <input
            type="text"
            name="fudosanRent-{r.id}-payeeShimei"
            aria-label={m.income_deductions_real_estate_payee_name()}
            autocomplete="off"
            bind:value={r.payeeName}
            placeholder={m.income_deductions_real_estate_payee_name()}
            class="px-3 py-2 bg-background border rounded text-foreground text-sm"
          />
          <input
            type="text"
            name="fudosanRent-{r.id}-payeeJusho"
            aria-label={m.income_deductions_real_estate_payee_address()}
            autocomplete="off"
            bind:value={r.payeeAddress}
            placeholder={m.income_deductions_real_estate_payee_address()}
            class="px-3 py-2 bg-background border rounded text-foreground text-sm"
          />
          <input
            type="text"
            name="fudosanRent-{r.id}-property"
            autocomplete="off"
            aria-label={m.income_deductions_real_estate_rent_property()}
            bind:value={r.property}
            placeholder={m.income_deductions_real_estate_rent_property()}
            class="px-3 py-2 bg-background border rounded text-foreground text-sm"
          />
          <div>
            <input
              type="text"
              name="fudosanRent-{r.id}-amount"
              autocomplete="off"
              aria-label={m.income_deductions_real_estate_amount()}
              inputmode="numeric"
              bind:value={r.amount}
              placeholder={m.income_deductions_real_estate_amount()}
              class="w-full px-3 py-2 bg-background border rounded text-foreground text-sm font-mono text-right"
            />
            {@render amountError(r.amount)}
          </div>
          <div class="flex gap-2 items-center">
            <div class="flex-1">
              <input
                type="text"
                name="fudosanRent-{r.id}-deductibleAmount"
                autocomplete="off"
                aria-label={m.income_deductions_real_estate_deductible_amount()}
                inputmode="numeric"
                bind:value={r.deductibleAmount}
                placeholder={m.income_deductions_real_estate_deductible_amount()}
                class="w-full px-3 py-2 bg-background border rounded text-foreground text-sm font-mono text-right"
              />
              {@render amountError(r.deductibleAmount)}
            </div>
            <button
              type="button"
              onclick={() => removeRealEstateRentPaid(r.id)}
              class="px-2 py-1 text-xs bg-destructive text-destructive-foreground rounded hover:opacity-90"
            >
              {m.income_deductions_dependent_remove()}
            </button>
          </div>
        </div>
      {/each}

      <div class="flex items-center justify-between pt-2 border-t">
        <h4 class="text-sm font-semibold">
          {m.income_deductions_real_estate_loan_interest_paid_title()}
        </h4>
        <button
          type="button"
          onclick={addRealEstateLoanInterestPaid}
          class="px-3 py-1 text-sm bg-secondary text-secondary-foreground rounded hover:opacity-90"
        >
          {m.income_deductions_dependent_add()}
        </button>
      </div>
      {#each realEstateLoanInterestPaid as r (r.id)}
        <div class="grid grid-cols-1 md:grid-cols-5 gap-2 items-end border-t pt-2">
          <input
            type="text"
            name="fudosanInterestPaid-{r.id}-payeeShimei"
            aria-label={m.income_deductions_real_estate_payee_name()}
            autocomplete="off"
            bind:value={r.payeeName}
            placeholder={m.income_deductions_real_estate_payee_name()}
            class="px-3 py-2 bg-background border rounded text-foreground text-sm"
          />
          <input
            type="text"
            name="fudosanInterestPaid-{r.id}-payeeJusho"
            aria-label={m.income_deductions_real_estate_payee_address()}
            autocomplete="off"
            bind:value={r.payeeAddress}
            placeholder={m.income_deductions_real_estate_payee_address()}
            class="px-3 py-2 bg-background border rounded text-foreground text-sm"
          />
          <div>
            <input
              type="text"
              name="fudosanInterestPaid-{r.id}-nenEndBalance"
              autocomplete="off"
              aria-label={m.income_deductions_real_estate_year_end_balance()}
              inputmode="numeric"
              bind:value={r.yearEndBalance}
              placeholder={m.income_deductions_real_estate_year_end_balance()}
              class="w-full px-3 py-2 bg-background border rounded text-foreground text-sm font-mono text-right"
            />
            {@render amountError(r.yearEndBalance)}
          </div>
          <div>
            <input
              type="text"
              name="fudosanInterestPaid-{r.id}-amount"
              autocomplete="off"
              aria-label={m.income_deductions_real_estate_amount()}
              inputmode="numeric"
              bind:value={r.amount}
              placeholder={m.income_deductions_real_estate_amount()}
              class="w-full px-3 py-2 bg-background border rounded text-foreground text-sm font-mono text-right"
            />
            {@render amountError(r.amount)}
          </div>
          <div class="flex gap-2 items-center">
            <div class="flex-1">
              <input
                type="text"
                name="fudosanInterestPaid-{r.id}-deductibleAmount"
                autocomplete="off"
                aria-label={m.income_deductions_real_estate_deductible_amount()}
                inputmode="numeric"
                bind:value={r.deductibleAmount}
                placeholder={m.income_deductions_real_estate_deductible_amount()}
                class="w-full px-3 py-2 bg-background border rounded text-foreground text-sm font-mono text-right"
              />
              {@render amountError(r.deductibleAmount)}
            </div>
            <button
              type="button"
              onclick={() => removeRealEstateLoanInterestPaid(r.id)}
              class="px-2 py-1 text-xs bg-destructive text-destructive-foreground rounded hover:opacity-90"
            >
              {m.income_deductions_dependent_remove()}
            </button>
          </div>
        </div>
      {/each}

      <div class="flex items-center justify-between pt-2 border-t">
        <h4 class="text-sm font-semibold">
          {m.income_deductions_real_estate_professional_fees_title()}
        </h4>
        <button
          type="button"
          onclick={addRealEstateProfessionalFeesPaid}
          class="px-3 py-1 text-sm bg-secondary text-secondary-foreground rounded hover:opacity-90"
        >
          {m.income_deductions_dependent_add()}
        </button>
      </div>
      {#each realEstateProfessionalFeesPaid as r (r.id)}
        <div class="grid grid-cols-1 md:grid-cols-5 gap-2 items-end border-t pt-2">
          <input
            type="text"
            name="fudosanFee-{r.id}-payeeShimei"
            aria-label={m.income_deductions_real_estate_payee_name()}
            autocomplete="off"
            bind:value={r.payeeName}
            placeholder={m.income_deductions_real_estate_payee_name()}
            class="px-3 py-2 bg-background border rounded text-foreground text-sm"
          />
          <input
            type="text"
            name="fudosanFee-{r.id}-payeeJusho"
            aria-label={m.income_deductions_real_estate_payee_address()}
            autocomplete="off"
            bind:value={r.payeeAddress}
            placeholder={m.income_deductions_real_estate_payee_address()}
            class="px-3 py-2 bg-background border rounded text-foreground text-sm"
          />
          <div>
            <input
              type="text"
              name="fudosanFee-{r.id}-amount"
              autocomplete="off"
              aria-label={m.income_deductions_real_estate_amount()}
              inputmode="numeric"
              bind:value={r.amount}
              placeholder={m.income_deductions_real_estate_amount()}
              class="w-full px-3 py-2 bg-background border rounded text-foreground text-sm font-mono text-right"
            />
            {@render amountError(r.amount)}
          </div>
          <div>
            <input
              type="text"
              name="fudosanFee-{r.id}-withholdingTax"
              autocomplete="off"
              aria-label={m.income_deductions_real_estate_withholding_tax()}
              inputmode="numeric"
              bind:value={r.withholdingTax}
              placeholder={m.income_deductions_real_estate_withholding_tax()}
              class="w-full px-3 py-2 bg-background border rounded text-foreground text-sm font-mono text-right"
            />
            {@render amountError(r.withholdingTax)}
          </div>
          <div class="flex gap-2 items-center">
            <div class="flex-1">
              <input
                type="text"
                name="fudosanFee-{r.id}-deductibleAmount"
                autocomplete="off"
                aria-label={m.income_deductions_real_estate_deductible_amount()}
                inputmode="numeric"
                bind:value={r.deductibleAmount}
                placeholder={m.income_deductions_real_estate_deductible_amount()}
                class="w-full px-3 py-2 bg-background border rounded text-foreground text-sm font-mono text-right"
              />
              {@render amountError(r.deductibleAmount)}
            </div>
            <button
              type="button"
              onclick={() => removeRealEstateProfessionalFeesPaid(r.id)}
              class="px-2 py-1 text-xs bg-destructive text-destructive-foreground rounded hover:opacity-90"
            >
              {m.income_deductions_dependent_remove()}
            </button>
          </div>
        </div>
      {/each}
    </section>
  {/if}

  <section class="space-y-4 border rounded-lg p-6 bg-card text-card-foreground">
    <h3 class="text-lg font-semibold">{m.income_deductions_family_title()}</h3>
    <label class="flex items-center gap-2 py-2">
      <input type="checkbox" bind:checked={hasSpouse} />
      <span class="text-sm">{m.income_deductions_spouse_checkbox()}</span>
    </label>
    {#if hasSpouse}
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 pl-6">
        <label class="block">
          <span class="text-xs text-muted-foreground">{m.income_deductions_spouse_income()}</span>
          <input
            type="text"
            name="spouseIncome"
            autocomplete="off"
            inputmode="numeric"
            bind:value={spouseIncome}
            class="mt-1 w-full px-3 py-2 bg-background border rounded text-foreground font-mono"
          />
          {@render amountError(spouseIncome)}
        </label>
        <label class="block">
          <span class="text-xs text-muted-foreground">{m.income_deductions_spouse_age()}</span>
          <input
            type="number"
            name="spouseAge"
            autocomplete="off"
            value={spouseAge}
            oninput={assignInputNumberOrEmpty((v) => (spouseAge = v))}
            min="0"
            max="120"
            class="mt-1 w-full px-3 py-2 bg-background border rounded text-foreground"
          />
          {@render intError(spouseAge, 0, 120)}
        </label>
      </div>
    {/if}
    {#if spouseExcludedByFamilyEmployee}
      <p class="pl-6 text-xs text-amber-600">
        {m.income_deductions_family_employee_spouse_excluded_note()}
      </p>
    {/if}

    <div class="flex items-center justify-between">
      <h4 class="text-sm font-semibold">{m.income_deductions_dependents_title()}</h4>
      <button
        type="button"
        onclick={addDependent}
        class="px-3 py-1 text-sm bg-secondary text-secondary-foreground rounded hover:opacity-90"
      >
        {m.income_deductions_dependent_add()}
      </button>
    </div>
    {#each dependents as dep (dep.id)}
      <div class="grid grid-cols-1 md:grid-cols-5 gap-3 items-end border-t pt-3">
        <label class="block sm:col-span-2">
          <span class="text-xs text-muted-foreground">{m.income_deductions_dependent_name()}</span>
          <input
            type="text"
            name="dependent-{dep.id}-shimei"
            autocomplete="off"
            bind:value={dep.name}
            class="mt-1 w-full px-3 py-2 bg-background border rounded text-foreground"
          />
        </label>
        <label class="block">
          <span class="text-xs text-muted-foreground">{m.income_deductions_dependent_age()}</span>
          <input
            type="number"
            name="dependent-{dep.id}-age"
            autocomplete="off"
            value={dep.age}
            oninput={assignInputNumberOrEmpty((v) => (dep.age = v))}
            min="0"
            max="120"
            class="mt-1 w-full px-3 py-2 bg-background border rounded text-foreground"
          />
          {@render intError(dep.age, 0, 120)}
        </label>
        <label class="block">
          <span class="text-xs text-muted-foreground">{m.income_deductions_dependent_income()}</span
          >
          <input
            type="text"
            name="dependent-{dep.id}-totalIncome"
            autocomplete="off"
            inputmode="numeric"
            bind:value={dep.totalIncome}
            class="mt-1 w-full px-3 py-2 bg-background border rounded text-foreground font-mono"
          />
          {@render amountError(dep.totalIncome)}
        </label>
        <div class="flex items-center gap-3">
          <label class="flex items-center gap-1 text-xs py-2">
            <input type="checkbox" bind:checked={dep.livesWithLinealAscendant} />
            {m.income_deductions_dependent_lives_with_lineal_ascendant()}
          </label>
          <button
            type="button"
            onclick={() => removeDependent(dep.id)}
            class="px-2 py-1 text-xs bg-destructive text-destructive-foreground rounded hover:opacity-90"
          >
            {m.income_deductions_dependent_remove()}
          </button>
        </div>
        {#if familyEmployeeExclusionResult.excludedDependentIds.has(dep.id)}
          <p class="md:col-span-5 text-xs text-amber-600">
            {m.income_deductions_family_employee_dependent_excluded_note()}
          </p>
        {/if}
      </div>
    {/each}

    <div class="flex items-center justify-between pt-2 border-t">
      <h4 class="text-sm font-semibold">{m.income_deductions_family_employees_title()}</h4>
      <button
        type="button"
        onclick={addFamilyEmployee}
        class="px-3 py-1 text-sm bg-secondary text-secondary-foreground rounded hover:opacity-90"
      >
        {m.income_deductions_family_employee_add()}
      </button>
    </div>
    {#each familyEmployees as employee (employee.id)}
      <div class="grid grid-cols-1 md:grid-cols-6 gap-3 items-end border-t pt-3">
        <label class="block sm:col-span-2">
          <span class="text-xs text-muted-foreground"
            >{m.income_deductions_family_employee_name()}</span
          >
          <input
            type="text"
            name="familyEmployee-{employee.id}-shimei"
            autocomplete="off"
            bind:value={employee.name}
            class="mt-1 w-full px-3 py-2 bg-background border rounded text-foreground"
          />
        </label>
        <label class="block">
          <span class="text-xs text-muted-foreground"
            >{m.income_deductions_family_employee_relation()}</span
          >
          <select
            bind:value={employee.relation}
            name="familyEmployee-{employee.id}-relation"
            class="mt-1 w-full px-3 py-2 bg-background border rounded text-foreground"
          >
            <option value="spouse">{m.income_deductions_family_employee_relation_spouse()}</option>
            <option value="other">{m.income_deductions_family_employee_relation_other()}</option>
          </select>
        </label>
        <label class="block">
          <span class="text-xs text-muted-foreground"
            >{m.income_deductions_family_employee_age()}</span
          >
          <input
            type="number"
            name="familyEmployee-{employee.id}-age"
            autocomplete="off"
            value={employee.age}
            oninput={assignInputNumberOrEmpty((v) => (employee.age = v))}
            min="0"
            max="120"
            class="mt-1 w-full px-3 py-2 bg-background border rounded text-foreground"
          />
          {@render intError(employee.age, 0, 120)}
        </label>
        <label class="block">
          <span class="text-xs text-muted-foreground"
            >{m.income_deductions_family_employee_months_worked()}</span
          >
          <input
            type="number"
            name="familyEmployee-{employee.id}-monthsWorked"
            autocomplete="off"
            value={employee.monthsWorked}
            oninput={assignInputNumberOrEmpty((v) => (employee.monthsWorked = v))}
            min="0"
            max="12"
            class="mt-1 w-full px-3 py-2 bg-background border rounded text-foreground"
          />
          {@render intError(employee.monthsWorked, 0, 12)}
        </label>
        {#if ledger.realEstateIncomeEnabled}
          <label class="block">
            <span class="text-xs text-muted-foreground"
              >{m.income_deductions_family_employee_income_type()}</span
            >
            <select
              bind:value={employee.incomeType}
              name="familyEmployee-{employee.id}-incomeType"
              class="mt-1 w-full px-3 py-2 bg-background border rounded text-foreground"
            >
              <option value="business"
                >{m.income_deductions_family_employee_income_type_business()}</option
              >
              <option value="realEstate"
                >{m.income_deductions_family_employee_income_type_real_estate()}</option
              >
            </select>
          </label>
        {/if}
        <button
          type="button"
          onclick={() => removeFamilyEmployee(employee.id)}
          class="px-2 py-1 text-xs bg-destructive text-destructive-foreground rounded hover:opacity-90"
        >
          {m.income_deductions_family_employee_remove()}
        </button>
      </div>
    {/each}
  </section>

  <section class="space-y-4 border rounded-lg p-6 bg-card text-card-foreground">
    <h3 class="text-lg font-semibold">{m.income_deductions_insurance_title()}</h3>
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <label class="block">
        <span class="text-xs text-muted-foreground"
          >{m.income_deductions_social_insurance_paid()}</span
        >
        <input
          type="text"
          name="socialInsurancePaid"
          autocomplete="off"
          inputmode="numeric"
          bind:value={socialInsurancePaid}
          class="mt-1 w-full px-3 py-2 bg-background border rounded text-foreground font-mono"
        />
        {@render amountError(socialInsurancePaid)}
      </label>
      <label class="block">
        <span class="text-xs text-muted-foreground"
          >{m.income_deductions_small_business_mutual_aid_paid()}</span
        >
        <input
          type="text"
          name="smallJigyoMutualAidPaid"
          autocomplete="off"
          inputmode="numeric"
          bind:value={smallBusinessMutualAidPaid}
          class="mt-1 w-full px-3 py-2 bg-background border rounded text-foreground font-mono"
        />
        {@render amountError(smallBusinessMutualAidPaid)}
      </label>
      <label class="block">
        <span class="text-xs text-muted-foreground"
          >{m.income_deductions_life_insurance_new_general()}</span
        >
        <input
          type="text"
          name="lifeNewGeneral"
          autocomplete="off"
          inputmode="numeric"
          bind:value={lifeNewGeneral}
          class="mt-1 w-full px-3 py-2 bg-background border rounded text-foreground font-mono"
        />
        {@render amountError(lifeNewGeneral)}
      </label>
      <label class="block">
        <span class="text-xs text-muted-foreground"
          >{m.income_deductions_life_insurance_old_general()}</span
        >
        <input
          type="text"
          name="lifeOldGeneral"
          autocomplete="off"
          inputmode="numeric"
          bind:value={lifeOldGeneral}
          class="mt-1 w-full px-3 py-2 bg-background border rounded text-foreground font-mono"
        />
        {@render amountError(lifeOldGeneral)}
      </label>
      <label class="block">
        <span class="text-xs text-muted-foreground"
          >{m.income_deductions_life_insurance_new_medical()}</span
        >
        <input
          type="text"
          name="lifeNewMedical"
          autocomplete="off"
          inputmode="numeric"
          bind:value={lifeNewMedical}
          class="mt-1 w-full px-3 py-2 bg-background border rounded text-foreground font-mono"
        />
        {@render amountError(lifeNewMedical)}
      </label>
      <label class="block">
        <span class="text-xs text-muted-foreground"
          >{m.income_deductions_life_insurance_new_pension()}</span
        >
        <input
          type="text"
          name="lifeNewPension"
          autocomplete="off"
          inputmode="numeric"
          bind:value={lifeNewPension}
          class="mt-1 w-full px-3 py-2 bg-background border rounded text-foreground font-mono"
        />
        {@render amountError(lifeNewPension)}
      </label>
      <label class="block">
        <span class="text-xs text-muted-foreground"
          >{m.income_deductions_life_insurance_old_pension()}</span
        >
        <input
          type="text"
          name="lifeOldPension"
          autocomplete="off"
          inputmode="numeric"
          bind:value={lifeOldPension}
          class="mt-1 w-full px-3 py-2 bg-background border rounded text-foreground font-mono"
        />
        {@render amountError(lifeOldPension)}
      </label>
      <label class="block">
        <span class="text-xs text-muted-foreground"
          >{m.income_deductions_earthquake_insurance_paid()}</span
        >
        <input
          type="text"
          name="earthquakeInsurancePaid"
          autocomplete="off"
          inputmode="numeric"
          bind:value={earthquakeInsurancePaid}
          class="mt-1 w-full px-3 py-2 bg-background border rounded text-foreground font-mono"
        />
        {@render amountError(earthquakeInsurancePaid)}
      </label>
      <label class="block">
        <span class="text-xs text-muted-foreground"
          >{m.income_deductions_old_long_term_insurance_paid()}</span
        >
        <input
          type="text"
          name="oldLongTermInsurancePaid"
          autocomplete="off"
          inputmode="numeric"
          bind:value={oldLongTermInsurancePaid}
          class="mt-1 w-full px-3 py-2 bg-background border rounded text-foreground font-mono"
        />
        {@render amountError(oldLongTermInsurancePaid)}
      </label>
    </div>
  </section>

  <section class="space-y-4 border rounded-lg p-6 bg-card text-card-foreground">
    <h3 class="text-lg font-semibold">{m.income_deductions_medical_title()}</h3>
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <label class="block">
        <span class="text-xs text-muted-foreground"
          >{m.income_deductions_medical_expense_paid()}</span
        >
        <input
          type="text"
          name="medicalKeihiPaid"
          autocomplete="off"
          inputmode="numeric"
          bind:value={medicalExpensePaid}
          class="mt-1 w-full px-3 py-2 bg-background border rounded text-foreground font-mono"
        />
        {@render amountError(medicalExpensePaid)}
      </label>
      <label class="block">
        <span class="text-xs text-muted-foreground"
          >{m.income_deductions_medical_insurance_reimbursement()}</span
        >
        <input
          type="text"
          name="medicalInsuranceReimbursement"
          autocomplete="off"
          inputmode="numeric"
          bind:value={medicalInsuranceReimbursement}
          class="mt-1 w-full px-3 py-2 bg-background border rounded text-foreground font-mono"
        />
        {@render amountError(medicalInsuranceReimbursement)}
      </label>
      <label class="block">
        <span class="text-xs text-muted-foreground">{m.income_deductions_donation_amount()}</span>
        <input
          type="text"
          name="donationAmount"
          autocomplete="off"
          inputmode="numeric"
          bind:value={donationAmount}
          class="mt-1 w-full px-3 py-2 bg-background border rounded text-foreground font-mono"
        />
        {@render amountError(donationAmount)}
      </label>
      <label class="block">
        <span class="text-xs text-muted-foreground"
          >{m.income_deductions_casualty_loss_deduction()}</span
        >
        <input
          type="text"
          name="casualtyLossDeduction"
          autocomplete="off"
          inputmode="numeric"
          bind:value={casualtyLossDeduction}
          class="mt-1 w-full px-3 py-2 bg-background border rounded text-foreground font-mono"
        />
        {@render amountError(casualtyLossDeduction)}
        <span class="block mt-1 text-xs text-muted-foreground"
          >{m.income_deductions_casualty_loss_hint()}</span
        >
      </label>
    </div>
  </section>

  <section class="space-y-4 border rounded-lg p-6 bg-card text-card-foreground">
    <h3 class="text-lg font-semibold">{m.income_deductions_status_title()}</h3>
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <label class="flex items-center gap-2 text-sm py-2">
        <input type="checkbox" bind:checked={isDisabled} />
        {m.income_deductions_is_disabled()}
      </label>
      <label class="flex items-center gap-2 text-sm py-2">
        <input type="checkbox" bind:checked={isSpecialDisabled} />
        {m.income_deductions_is_special_disabled()}
      </label>
      <label class="flex items-center gap-2 text-sm py-2">
        <input type="checkbox" bind:checked={isSingleParent} />
        {m.income_deductions_is_single_parent()}
      </label>
      <label class="flex items-center gap-2 text-sm py-2">
        <input type="checkbox" bind:checked={isWidow} />
        {m.income_deductions_is_widow()}
      </label>
      <label class="flex items-center gap-2 text-sm py-2">
        <input type="checkbox" bind:checked={isWorkingStudent} />
        {m.income_deductions_is_working_student()}
      </label>
    </div>
  </section>

  <section class="space-y-4 border rounded-lg p-6 bg-card text-card-foreground">
    <h3 class="text-lg font-semibold">{m.income_deductions_credits_title()}</h3>
    <p class="text-xs text-muted-foreground">{m.income_deductions_credits_hint()}</p>
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <label class="block">
        <span class="text-xs text-muted-foreground">{m.income_deductions_dividend_credit()}</span>
        <input
          type="text"
          name="dividendDeductionAmount"
          autocomplete="off"
          inputmode="numeric"
          bind:value={dividendDeductionAmount}
          class="mt-1 w-full px-3 py-2 bg-background border rounded text-foreground font-mono"
        />
        {@render amountError(dividendDeductionAmount)}
      </label>
      <label class="block">
        <span class="text-xs text-muted-foreground">{m.income_deductions_mortgage_credit()}</span>
        <input
          type="text"
          name="mortgageDeductionAmount"
          autocomplete="off"
          inputmode="numeric"
          bind:value={mortgageDeductionAmount}
          class="mt-1 w-full px-3 py-2 bg-background border rounded text-foreground font-mono"
        />
        {@render amountError(mortgageDeductionAmount)}
      </label>
      <label class="block">
        <span class="text-xs text-muted-foreground"
          >{m.income_deductions_political_donation_credit()}</span
        >
        <input
          type="text"
          name="politicalDonationCreditAmount"
          autocomplete="off"
          inputmode="numeric"
          bind:value={politicalDonationCreditAmount}
          class="mt-1 w-full px-3 py-2 bg-background border rounded text-foreground font-mono"
        />
        {@render amountError(politicalDonationCreditAmount)}
      </label>
      <label class="block">
        <span class="text-xs text-muted-foreground"
          >{m.income_deductions_housing_renovation_credit()}</span
        >
        <input
          type="text"
          name="housingRenovationCreditAmount"
          autocomplete="off"
          inputmode="numeric"
          bind:value={housingRenovationCreditAmount}
          class="mt-1 w-full px-3 py-2 bg-background border rounded text-foreground font-mono"
        />
        {@render amountError(housingRenovationCreditAmount)}
      </label>
      <label class="block">
        <span class="text-xs text-muted-foreground">{m.income_deductions_foreign_tax_credit()}</span
        >
        <input
          type="text"
          name="foreignTaxCreditAmount"
          autocomplete="off"
          inputmode="numeric"
          bind:value={foreignTaxCreditAmount}
          class="mt-1 w-full px-3 py-2 bg-background border rounded text-foreground font-mono"
        />
        {@render amountError(foreignTaxCreditAmount)}
      </label>
      <label class="block">
        <span class="text-xs text-muted-foreground">{m.income_deductions_other_tax_credit()}</span>
        <input
          type="text"
          name="otherTaxCreditAmount"
          autocomplete="off"
          inputmode="numeric"
          bind:value={otherTaxCreditAmount}
          class="mt-1 w-full px-3 py-2 bg-background border rounded text-foreground font-mono"
        />
        {@render amountError(otherTaxCreditAmount)}
      </label>
      <label class="block">
        <span class="text-xs text-muted-foreground">{m.income_deductions_disaster_exemption()}</span
        >
        <input
          type="text"
          name="disasterExemptionAmount"
          autocomplete="off"
          inputmode="numeric"
          bind:value={disasterExemptionAmount}
          class="mt-1 w-full px-3 py-2 bg-background border rounded text-foreground font-mono"
        />
        {@render amountError(disasterExemptionAmount)}
      </label>
    </div>
  </section>

  <section class="space-y-2 border rounded-lg p-6 bg-card text-card-foreground">
    <h3 class="text-lg font-semibold">{m.income_deductions_result_title()}</h3>
    <div class="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
      <span class="text-muted-foreground">{m.income_deductions_result_basic()}</span><span
        class="font-mono text-right">{formatJPY(result.basicDeduction)}</span
      >
      <span class="text-muted-foreground">{m.income_deductions_result_social_insurance()}</span
      ><span class="font-mono text-right">{formatJPY(result.socialInsuranceDeduction)}</span>
      <span class="text-muted-foreground"
        >{m.income_deductions_result_small_business_mutual_aid()}</span
      ><span class="font-mono text-right">{formatJPY(result.smallBusinessMutualAidDeduction)}</span>
      <span class="text-muted-foreground">{m.income_deductions_result_life_insurance()}</span><span
        class="font-mono text-right">{formatJPY(result.lifeInsuranceDeduction)}</span
      >
      <span class="text-muted-foreground">{m.income_deductions_result_earthquake_insurance()}</span
      ><span class="font-mono text-right">{formatJPY(result.earthquakeInsuranceDeduction)}</span>
      <span class="text-muted-foreground">{m.income_deductions_result_medical_expense()}</span><span
        class="font-mono text-right">{formatJPY(result.medicalExpenseDeduction)}</span
      >
      <span class="text-muted-foreground">{m.income_deductions_result_donation()}</span><span
        class="font-mono text-right">{formatJPY(result.donationDeduction)}</span
      >
      <span class="text-muted-foreground">{m.income_deductions_result_casualty_loss()}</span><span
        class="font-mono text-right">{formatJPY(result.casualtyLossDeduction)}</span
      >
      <span class="text-muted-foreground">{m.income_deductions_result_disability()}</span><span
        class="font-mono text-right">{formatJPY(result.disabilityDeduction)}</span
      >
      <span class="text-muted-foreground"
        >{m.income_deductions_result_single_parent_or_widow()}</span
      ><span class="font-mono text-right">{formatJPY(result.singleParentOrWidowDeduction)}</span>
      <span class="text-muted-foreground">{m.income_deductions_result_working_student()}</span><span
        class="font-mono text-right">{formatJPY(result.workingStudentDeduction)}</span
      >
      <span class="text-muted-foreground">{m.income_deductions_result_spouse()}</span><span
        class="font-mono text-right">{formatJPY(result.spouseDeduction)}</span
      >
      <span class="text-muted-foreground">{m.income_deductions_result_dependent()}</span><span
        class="font-mono text-right">{formatJPY(result.dependentDeduction)}</span
      >
      <span class="text-muted-foreground"
        >{m.income_deductions_result_specific_relative_special()}</span
      ><span class="font-mono text-right">{formatJPY(result.specificRelativeSpecialDeduction)}</span
      >
      <span class="font-semibold border-t pt-1">{m.income_deductions_result_total()}</span><span
        class="font-mono text-right font-semibold border-t pt-1">{formatJPY(result.total)}</span
      >
      <span class="text-muted-foreground">{m.income_deductions_result_taxable_income()}</span><span
        class="font-mono text-right">{formatJPY(taxableIncome)}</span
      >
      <span class="text-muted-foreground">{m.income_deductions_result_income_tax()}</span><span
        class="font-mono text-right">{formatJPY(afterCredits)}</span
      >
      <span class="text-muted-foreground">{m.income_deductions_result_surtax()}</span><span
        class="font-mono text-right">{formatJPY(surtax)}</span
      >
      <span class="font-semibold border-t pt-1">{m.income_deductions_result_final_tax()}</span><span
        class="font-mono text-right font-semibold border-t pt-1">{formatJPY(finalTax)}</span
      >
      <span class="text-muted-foreground">{m.income_deductions_result_withholding()}</span><span
        class="font-mono text-right">{formatJPY(withholding)}</span
      >
      <span class="font-semibold border-t pt-1">{m.income_deductions_result_net_tax_due()}</span
      ><span class="font-mono text-right font-semibold border-t pt-1">{formatJPY(netTaxDue)}</span>
    </div>
  </section>

  <div class="flex items-center gap-3 justify-end">
    {#if yearInvalid}
      <span class="text-xs text-destructive">{m.common_integer_invalid(YEAR_RANGE)}</span>
    {:else if loadError}
      <span class="text-xs text-destructive">{m.income_deductions_load_failed_short()}</span>
    {:else if invalidFieldCount > 0}
      <span class="text-xs text-destructive"
        >{m.income_deductions_invalid_count({ count: invalidFieldCount })}</span
      >
    {:else if saveError}
      <span class="text-xs text-destructive">{saveError}</span>
    {:else if saved && !isDirty}
      <span class="text-xs text-green-600">{m.income_deductions_saved()}</span>
    {/if}
    <button
      type="button"
      onclick={save}
      disabled={loadedYear !== year || yearInvalid || loadError !== '' || invalidFieldCount > 0}
      class="px-4 py-2 bg-primary text-primary-foreground rounded hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
    >
      {m.income_deductions_save()}
    </button>
  </div>
</div>
