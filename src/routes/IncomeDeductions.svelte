<script lang="ts">
  import { db } from '../db';
  import { D, formatJPY } from '../lib/decimal';
  import { newId } from '../lib/id';
  import { getSetting } from '../lib/settings';
  import { buildPL } from '../domain/reports';
  import {
    computeIncomeDeductions,
    progressiveIncomeTax,
    reconstructionSurtax,
    totalTaxCredits,
  } from '../tax-schema/2026/income-deductions';
  import { otherIncomeAmount, totalWithholdingTax } from '../tax-schema/2026/other-income';
  import { totalIncomeAmount } from '../tax-schema/2026/xtx-mapping-koa020';
  import type { PersonalDeductionDependent, PersonalDeductionInput } from '../db/types';
  import type { AoiroDeductionKind } from '../tax-schema/2026/aoiro-deduction';
  import { personalDeductionsToCtx, type FilingType } from '../tax-schema/2026/xtx';
  import { m } from '../paraglide/messages';

  const now = new Date();
  let year = $state(now.getFullYear());

  function safeDecimal(s: string) {
    try {
      return D(s || '0');
    } catch {
      return D(0);
    }
  }

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
  let spouseAge = $state(40);
  let dependents = $state<Array<{
    id: string;
    name: string;
    age: number;
    totalIncome: string;
    livesWithLinealAscendant: boolean;
  }>>([]);
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
  let publicPensionAmount = $state('0');
  let otherMiscIncomeAmount = $state('0');
  let otherMiscExpenses = $state('0');
  let otherWithholdingTaxPaid = $state('0');

  let saved = $state(false);
  let businessTotalIncome = $state(D(0));

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
    publicPensionAmount = '0';
    otherMiscIncomeAmount = '0';
    otherMiscExpenses = '0';
    otherWithholdingTaxPaid = '0';
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
    publicPensionAmount = stored.miscIncome?.publicPensionAmount ?? '0';
    otherMiscIncomeAmount = stored.miscIncome?.otherIncome ?? '0';
    otherMiscExpenses = stored.miscIncome?.otherExpenses ?? '0';
    otherWithholdingTaxPaid = stored.otherWithholdingTax ?? '0';
  }

  $effect(() => {
    const yr = year;
    saved = false;
    (async () => {
      const stored = await db.personalDeductions.get(yr);
      if (stored) {
        loadFromStored(stored);
      } else {
        resetForm();
      }
      const pl = await buildPL(yr);
      const filingType = ((await getSetting('filingType')) ?? 'blue') as FilingType;
      const aoiroDeductionKind = ((await getSetting('aoiroDeductionKind')) ?? 'electronic') as AoiroDeductionKind;
      businessTotalIncome = totalIncomeAmount({ year: yr, pl, filingType, aoiroDeductionKind });
    })();
  });

  function addDependent() {
    dependents = [
      ...dependents,
      { id: newId(), name: '', age: 18, totalIncome: '0', livesWithLinealAscendant: false },
    ];
  }

  function removeDependent(id: string) {
    dependents = dependents.filter((d) => d.id !== id);
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
    ...(hasSpouse ? { spouse: { totalIncome: spouseIncome, age: spouseAge } } : {}),
    dependents: dependents.map(
      (d): PersonalDeductionDependent => ({
        id: d.id,
        name: d.name,
        age: d.age,
        totalIncome: d.totalIncome,
        livesWithLinealAscendant: d.livesWithLinealAscendant,
      })
    ),
    dividendDeductionAmount,
    mortgageDeductionAmount,
    politicalDonationCreditAmount,
    housingRenovationCreditAmount,
    foreignTaxCreditAmount,
    otherTaxCreditAmount,
    disasterExemptionAmount,
    ...(hasSalaryIncome
      ? { salaryIncome: { paidAmount: salaryPaidAmount, withholdingTax: salaryWithholdingTax } }
      : {}),
    miscIncome: {
      ...(safeDecimal(publicPensionAmount).greaterThan(0) ? { publicPensionAmount } : {}),
      otherIncome: otherMiscIncomeAmount,
      otherExpenses: otherMiscExpenses,
    },
    otherWithholdingTax: otherWithholdingTaxPaid,
  });

  const ctx = $derived(personalDeductionsToCtx(recordDraft));
  // 事業所得＋給与所得＋雑所得（B7）。基礎控除の級距・配偶者控除の判定等はこちらを使う。
  const combinedTotalIncome = $derived(businessTotalIncome.plus(otherIncomeAmount(ctx)));
  const result = $derived(
    computeIncomeDeductions(year, { ...ctx, totalIncome: combinedTotalIncome })
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
    await db.personalDeductions.put({ ...recordDraft, year, updatedAt: Date.now() });
    saved = true;
  }
</script>

<div class="space-y-8">
  <h2 class="text-2xl font-bold">{m.income_deductions_title()}</h2>
  <p class="text-xs text-muted-foreground">{m.income_deductions_intro()}</p>

  <section class="space-y-4 border rounded-lg p-6 bg-card text-card-foreground">
    <label class="block sm:max-w-xs">
      <span class="text-xs text-muted-foreground">{m.income_deductions_year_label()}</span>
      <input
        type="number"
        bind:value={year}
        min="2020"
        max="2099"
        step="1"
        class="mt-1 w-full px-3 py-2 bg-background border rounded text-foreground"
      />
    </label>
    <p class="text-sm">
      {m.income_deductions_total_income_label()}：<span class="font-mono">{formatJPY(businessTotalIncome)}</span>
    </p>
    <p class="text-sm">
      {m.income_deductions_combined_total_income_label()}：<span class="font-mono">{formatJPY(combinedTotalIncome)}</span>
    </p>
  </section>

  <section class="space-y-4 border rounded-lg p-6 bg-card text-card-foreground">
    <h3 class="text-lg font-semibold">{m.income_deductions_other_income_title()}</h3>
    <p class="text-xs text-muted-foreground">{m.income_deductions_other_income_intro()}</p>
    <label class="flex items-center gap-2">
      <input type="checkbox" bind:checked={hasSalaryIncome} />
      <span class="text-sm">{m.income_deductions_salary_checkbox()}</span>
    </label>
    {#if hasSalaryIncome}
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 pl-6">
        <label class="block">
          <span class="text-xs text-muted-foreground">{m.income_deductions_salary_paid_amount()}</span>
          <input type="text" inputmode="numeric" bind:value={salaryPaidAmount} class="mt-1 w-full px-3 py-2 bg-background border rounded text-foreground font-mono" />
        </label>
        <label class="block">
          <span class="text-xs text-muted-foreground">{m.income_deductions_salary_withholding_tax()}</span>
          <input type="text" inputmode="numeric" bind:value={salaryWithholdingTax} class="mt-1 w-full px-3 py-2 bg-background border rounded text-foreground font-mono" />
        </label>
      </div>
    {/if}
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <label class="block">
        <span class="text-xs text-muted-foreground">{m.income_deductions_public_pension_amount()}</span>
        <input type="text" inputmode="numeric" bind:value={publicPensionAmount} class="mt-1 w-full px-3 py-2 bg-background border rounded text-foreground font-mono" />
        <span class="block mt-1 text-xs text-muted-foreground">{m.income_deductions_public_pension_hint()}</span>
      </label>
      <label class="block">
        <span class="text-xs text-muted-foreground">{m.income_deductions_other_misc_income()}</span>
        <input type="text" inputmode="numeric" bind:value={otherMiscIncomeAmount} class="mt-1 w-full px-3 py-2 bg-background border rounded text-foreground font-mono" />
      </label>
      <label class="block">
        <span class="text-xs text-muted-foreground">{m.income_deductions_other_misc_expenses()}</span>
        <input type="text" inputmode="numeric" bind:value={otherMiscExpenses} class="mt-1 w-full px-3 py-2 bg-background border rounded text-foreground font-mono" />
      </label>
      <label class="block">
        <span class="text-xs text-muted-foreground">{m.income_deductions_other_withholding_tax()}</span>
        <input type="text" inputmode="numeric" bind:value={otherWithholdingTaxPaid} class="mt-1 w-full px-3 py-2 bg-background border rounded text-foreground font-mono" />
      </label>
    </div>
  </section>

  <section class="space-y-4 border rounded-lg p-6 bg-card text-card-foreground">
    <h3 class="text-lg font-semibold">{m.income_deductions_family_title()}</h3>
    <label class="flex items-center gap-2">
      <input type="checkbox" bind:checked={hasSpouse} />
      <span class="text-sm">{m.income_deductions_spouse_checkbox()}</span>
    </label>
    {#if hasSpouse}
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 pl-6">
        <label class="block">
          <span class="text-xs text-muted-foreground">{m.income_deductions_spouse_income()}</span>
          <input
            type="text"
            inputmode="numeric"
            bind:value={spouseIncome}
            class="mt-1 w-full px-3 py-2 bg-background border rounded text-foreground font-mono"
          />
        </label>
        <label class="block">
          <span class="text-xs text-muted-foreground">{m.income_deductions_spouse_age()}</span>
          <input
            type="number"
            bind:value={spouseAge}
            min="0"
            max="120"
            class="mt-1 w-full px-3 py-2 bg-background border rounded text-foreground"
          />
        </label>
      </div>
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
      <div class="grid grid-cols-1 sm:grid-cols-5 gap-3 items-end border-t pt-3">
        <label class="block sm:col-span-2">
          <span class="text-xs text-muted-foreground">{m.income_deductions_dependent_name()}</span>
          <input
            type="text"
            bind:value={dep.name}
            class="mt-1 w-full px-3 py-2 bg-background border rounded text-foreground"
          />
        </label>
        <label class="block">
          <span class="text-xs text-muted-foreground">{m.income_deductions_dependent_age()}</span>
          <input
            type="number"
            bind:value={dep.age}
            min="0"
            max="120"
            class="mt-1 w-full px-3 py-2 bg-background border rounded text-foreground"
          />
        </label>
        <label class="block">
          <span class="text-xs text-muted-foreground">{m.income_deductions_dependent_income()}</span>
          <input
            type="text"
            inputmode="numeric"
            bind:value={dep.totalIncome}
            class="mt-1 w-full px-3 py-2 bg-background border rounded text-foreground font-mono"
          />
        </label>
        <div class="flex items-center gap-3">
          <label class="flex items-center gap-1 text-xs">
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
      </div>
    {/each}
  </section>

  <section class="space-y-4 border rounded-lg p-6 bg-card text-card-foreground">
    <h3 class="text-lg font-semibold">{m.income_deductions_insurance_title()}</h3>
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <label class="block">
        <span class="text-xs text-muted-foreground">{m.income_deductions_social_insurance_paid()}</span>
        <input type="text" inputmode="numeric" bind:value={socialInsurancePaid} class="mt-1 w-full px-3 py-2 bg-background border rounded text-foreground font-mono" />
      </label>
      <label class="block">
        <span class="text-xs text-muted-foreground">{m.income_deductions_small_business_mutual_aid_paid()}</span>
        <input type="text" inputmode="numeric" bind:value={smallBusinessMutualAidPaid} class="mt-1 w-full px-3 py-2 bg-background border rounded text-foreground font-mono" />
      </label>
      <label class="block">
        <span class="text-xs text-muted-foreground">{m.income_deductions_life_insurance_new_general()}</span>
        <input type="text" inputmode="numeric" bind:value={lifeNewGeneral} class="mt-1 w-full px-3 py-2 bg-background border rounded text-foreground font-mono" />
      </label>
      <label class="block">
        <span class="text-xs text-muted-foreground">{m.income_deductions_life_insurance_old_general()}</span>
        <input type="text" inputmode="numeric" bind:value={lifeOldGeneral} class="mt-1 w-full px-3 py-2 bg-background border rounded text-foreground font-mono" />
      </label>
      <label class="block">
        <span class="text-xs text-muted-foreground">{m.income_deductions_life_insurance_new_medical()}</span>
        <input type="text" inputmode="numeric" bind:value={lifeNewMedical} class="mt-1 w-full px-3 py-2 bg-background border rounded text-foreground font-mono" />
      </label>
      <label class="block">
        <span class="text-xs text-muted-foreground">{m.income_deductions_life_insurance_new_pension()}</span>
        <input type="text" inputmode="numeric" bind:value={lifeNewPension} class="mt-1 w-full px-3 py-2 bg-background border rounded text-foreground font-mono" />
      </label>
      <label class="block">
        <span class="text-xs text-muted-foreground">{m.income_deductions_life_insurance_old_pension()}</span>
        <input type="text" inputmode="numeric" bind:value={lifeOldPension} class="mt-1 w-full px-3 py-2 bg-background border rounded text-foreground font-mono" />
      </label>
      <label class="block">
        <span class="text-xs text-muted-foreground">{m.income_deductions_earthquake_insurance_paid()}</span>
        <input type="text" inputmode="numeric" bind:value={earthquakeInsurancePaid} class="mt-1 w-full px-3 py-2 bg-background border rounded text-foreground font-mono" />
      </label>
      <label class="block">
        <span class="text-xs text-muted-foreground">{m.income_deductions_old_long_term_insurance_paid()}</span>
        <input type="text" inputmode="numeric" bind:value={oldLongTermInsurancePaid} class="mt-1 w-full px-3 py-2 bg-background border rounded text-foreground font-mono" />
      </label>
    </div>
  </section>

  <section class="space-y-4 border rounded-lg p-6 bg-card text-card-foreground">
    <h3 class="text-lg font-semibold">{m.income_deductions_medical_title()}</h3>
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <label class="block">
        <span class="text-xs text-muted-foreground">{m.income_deductions_medical_expense_paid()}</span>
        <input type="text" inputmode="numeric" bind:value={medicalExpensePaid} class="mt-1 w-full px-3 py-2 bg-background border rounded text-foreground font-mono" />
      </label>
      <label class="block">
        <span class="text-xs text-muted-foreground">{m.income_deductions_medical_insurance_reimbursement()}</span>
        <input type="text" inputmode="numeric" bind:value={medicalInsuranceReimbursement} class="mt-1 w-full px-3 py-2 bg-background border rounded text-foreground font-mono" />
      </label>
      <label class="block">
        <span class="text-xs text-muted-foreground">{m.income_deductions_donation_amount()}</span>
        <input type="text" inputmode="numeric" bind:value={donationAmount} class="mt-1 w-full px-3 py-2 bg-background border rounded text-foreground font-mono" />
      </label>
      <label class="block">
        <span class="text-xs text-muted-foreground">{m.income_deductions_casualty_loss_deduction()}</span>
        <input type="text" inputmode="numeric" bind:value={casualtyLossDeduction} class="mt-1 w-full px-3 py-2 bg-background border rounded text-foreground font-mono" />
        <span class="block mt-1 text-xs text-muted-foreground">{m.income_deductions_casualty_loss_hint()}</span>
      </label>
    </div>
  </section>

  <section class="space-y-4 border rounded-lg p-6 bg-card text-card-foreground">
    <h3 class="text-lg font-semibold">{m.income_deductions_status_title()}</h3>
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <label class="flex items-center gap-2 text-sm">
        <input type="checkbox" bind:checked={isDisabled} />
        {m.income_deductions_is_disabled()}
      </label>
      <label class="flex items-center gap-2 text-sm">
        <input type="checkbox" bind:checked={isSpecialDisabled} />
        {m.income_deductions_is_special_disabled()}
      </label>
      <label class="flex items-center gap-2 text-sm">
        <input type="checkbox" bind:checked={isSingleParent} />
        {m.income_deductions_is_single_parent()}
      </label>
      <label class="flex items-center gap-2 text-sm">
        <input type="checkbox" bind:checked={isWidow} />
        {m.income_deductions_is_widow()}
      </label>
      <label class="flex items-center gap-2 text-sm">
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
        <input type="text" inputmode="numeric" bind:value={dividendDeductionAmount} class="mt-1 w-full px-3 py-2 bg-background border rounded text-foreground font-mono" />
      </label>
      <label class="block">
        <span class="text-xs text-muted-foreground">{m.income_deductions_mortgage_credit()}</span>
        <input type="text" inputmode="numeric" bind:value={mortgageDeductionAmount} class="mt-1 w-full px-3 py-2 bg-background border rounded text-foreground font-mono" />
      </label>
      <label class="block">
        <span class="text-xs text-muted-foreground">{m.income_deductions_political_donation_credit()}</span>
        <input type="text" inputmode="numeric" bind:value={politicalDonationCreditAmount} class="mt-1 w-full px-3 py-2 bg-background border rounded text-foreground font-mono" />
      </label>
      <label class="block">
        <span class="text-xs text-muted-foreground">{m.income_deductions_housing_renovation_credit()}</span>
        <input type="text" inputmode="numeric" bind:value={housingRenovationCreditAmount} class="mt-1 w-full px-3 py-2 bg-background border rounded text-foreground font-mono" />
      </label>
      <label class="block">
        <span class="text-xs text-muted-foreground">{m.income_deductions_foreign_tax_credit()}</span>
        <input type="text" inputmode="numeric" bind:value={foreignTaxCreditAmount} class="mt-1 w-full px-3 py-2 bg-background border rounded text-foreground font-mono" />
      </label>
      <label class="block">
        <span class="text-xs text-muted-foreground">{m.income_deductions_other_tax_credit()}</span>
        <input type="text" inputmode="numeric" bind:value={otherTaxCreditAmount} class="mt-1 w-full px-3 py-2 bg-background border rounded text-foreground font-mono" />
      </label>
      <label class="block">
        <span class="text-xs text-muted-foreground">{m.income_deductions_disaster_exemption()}</span>
        <input type="text" inputmode="numeric" bind:value={disasterExemptionAmount} class="mt-1 w-full px-3 py-2 bg-background border rounded text-foreground font-mono" />
      </label>
    </div>
  </section>

  <section class="space-y-2 border rounded-lg p-6 bg-card text-card-foreground">
    <h3 class="text-lg font-semibold">{m.income_deductions_result_title()}</h3>
    <div class="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
      <span class="text-muted-foreground">{m.income_deductions_result_basic()}</span><span class="font-mono text-right">{formatJPY(result.basicDeduction)}</span>
      <span class="text-muted-foreground">{m.income_deductions_result_social_insurance()}</span><span class="font-mono text-right">{formatJPY(result.socialInsuranceDeduction)}</span>
      <span class="text-muted-foreground">{m.income_deductions_result_small_business_mutual_aid()}</span><span class="font-mono text-right">{formatJPY(result.smallBusinessMutualAidDeduction)}</span>
      <span class="text-muted-foreground">{m.income_deductions_result_life_insurance()}</span><span class="font-mono text-right">{formatJPY(result.lifeInsuranceDeduction)}</span>
      <span class="text-muted-foreground">{m.income_deductions_result_earthquake_insurance()}</span><span class="font-mono text-right">{formatJPY(result.earthquakeInsuranceDeduction)}</span>
      <span class="text-muted-foreground">{m.income_deductions_result_medical_expense()}</span><span class="font-mono text-right">{formatJPY(result.medicalExpenseDeduction)}</span>
      <span class="text-muted-foreground">{m.income_deductions_result_donation()}</span><span class="font-mono text-right">{formatJPY(result.donationDeduction)}</span>
      <span class="text-muted-foreground">{m.income_deductions_result_casualty_loss()}</span><span class="font-mono text-right">{formatJPY(result.casualtyLossDeduction)}</span>
      <span class="text-muted-foreground">{m.income_deductions_result_disability()}</span><span class="font-mono text-right">{formatJPY(result.disabilityDeduction)}</span>
      <span class="text-muted-foreground">{m.income_deductions_result_single_parent_or_widow()}</span><span class="font-mono text-right">{formatJPY(result.singleParentOrWidowDeduction)}</span>
      <span class="text-muted-foreground">{m.income_deductions_result_working_student()}</span><span class="font-mono text-right">{formatJPY(result.workingStudentDeduction)}</span>
      <span class="text-muted-foreground">{m.income_deductions_result_spouse()}</span><span class="font-mono text-right">{formatJPY(result.spouseDeduction)}</span>
      <span class="text-muted-foreground">{m.income_deductions_result_dependent()}</span><span class="font-mono text-right">{formatJPY(result.dependentDeduction)}</span>
      <span class="text-muted-foreground">{m.income_deductions_result_specific_relative_special()}</span><span class="font-mono text-right">{formatJPY(result.specificRelativeSpecialDeduction)}</span>
      <span class="font-semibold border-t pt-1">{m.income_deductions_result_total()}</span><span class="font-mono text-right font-semibold border-t pt-1">{formatJPY(result.total)}</span>
      <span class="text-muted-foreground">{m.income_deductions_result_taxable_income()}</span><span class="font-mono text-right">{formatJPY(taxableIncome)}</span>
      <span class="text-muted-foreground">{m.income_deductions_result_income_tax()}</span><span class="font-mono text-right">{formatJPY(afterCredits)}</span>
      <span class="text-muted-foreground">{m.income_deductions_result_surtax()}</span><span class="font-mono text-right">{formatJPY(surtax)}</span>
      <span class="font-semibold border-t pt-1">{m.income_deductions_result_final_tax()}</span><span class="font-mono text-right font-semibold border-t pt-1">{formatJPY(finalTax)}</span>
      <span class="text-muted-foreground">{m.income_deductions_result_withholding()}</span><span class="font-mono text-right">{formatJPY(withholding)}</span>
      <span class="font-semibold border-t pt-1">{m.income_deductions_result_net_tax_due()}</span><span class="font-mono text-right font-semibold border-t pt-1">{formatJPY(netTaxDue)}</span>
    </div>
  </section>

  <div class="flex items-center gap-3 justify-end">
    {#if saved}
      <span class="text-xs text-green-600">{m.income_deductions_saved()}</span>
    {/if}
    <button
      type="button"
      onclick={save}
      class="px-4 py-2 bg-primary text-primary-foreground rounded hover:opacity-90"
    >
      {m.income_deductions_save()}
    </button>
  </div>
</div>