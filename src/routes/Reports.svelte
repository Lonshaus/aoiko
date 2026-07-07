<script lang="ts">
  import { liveQuery } from 'dexie';
  import { D, formatJPY } from '../lib/decimal';
  import { toISODateLocal } from '../lib/date';
  import {
    buildAll,
    type BreakdownAxis,
    type BreakdownReport,
    type BSReport,
    type MonthlyPLReport,
    type MonthlyReport,
    type PLReport,
  } from '../domain/reports';
  import {
    getConsumptionTaxSnapshot,
    isYearLocked,
    markYearFiled,
    unlockYear,
  } from '../domain/snapshots';
  import { interimFilingObligation } from '../domain/interim-filing';
  import {
    amendmentChecklist,
    getAmendmentDiff,
    type AmendmentDiff,
  } from '../domain/amended';
  import { buildXtx2026, personalDeductionsToCtx, type FilingType } from '../tax-schema/2026/xtx';
  import { getSetting } from '../lib/settings';
  import {
    compareAll,
    computeTaxableSalesRatio,
    isFullDeductionEligible,
    isTwoWariEligibleYear,
    processYear,
    type ConsumptionTaxResult,
  } from '../domain/consumption-tax';
  import {
    buildGeneralXtx,
    buildSimplifiedXtx,
    buildTwoWariXtx,
  } from '../tax-schema/2026/xtx-consumption-tax';
  import { deemedInputRate, type SimplifiedTaxCategory } from '../tax-schema/2026/simplified-tax';
  import type { TaxRegistration } from '../db/types';
  import { db } from '../db/db';
  import * as AlertDialog from '$lib/components/ui/alert-dialog';
  import { m } from '../paraglide/messages';
  import type { AmendmentChecklistKey } from '../domain/amended';

  function checklistLabel(key: AmendmentChecklistKey, year: number): string {
    switch (key) {
      case 'unlock':
        return m.reports_amendment_checklist_unlock_label({ year });
      case 'reverse':
        return m.reports_amendment_checklist_reverse_label();
      case 'review':
        return m.reports_amendment_checklist_review_label();
      case 'submit':
        return m.reports_amendment_checklist_submit_label();
      case 'relock':
        return m.reports_amendment_checklist_relock_label();
    }
  }
  function checklistDetail(key: AmendmentChecklistKey): string {
    switch (key) {
      case 'unlock':
        return m.reports_amendment_checklist_unlock_detail();
      case 'reverse':
        return m.reports_amendment_checklist_reverse_detail();
      case 'review':
        return m.reports_amendment_checklist_review_detail();
      case 'submit':
        return m.reports_amendment_checklist_submit_detail();
      case 'relock':
        return m.reports_amendment_checklist_relock_detail();
    }
  }

  const now = new Date();
  let year = $state(now.getFullYear());

  let monthly = $state<MonthlyReport | null>(null);
  let pl = $state<PLReport | null>(null);
  let bs = $state<BSReport | null>(null);
  let monthlyPL = $state<MonthlyPLReport | null>(null);
  let breakdown = $state<BreakdownReport | null>(null);
  let breakdownAxis = $state<BreakdownAxis>('vendor');
  let amendment = $state<AmendmentDiff | null>(null);
  let consumptionTax = $state<ConsumptionTaxResult[] | null>(null);
  let taxableSalesRatioPercent = $state('100.00');
  let taxableSalesRatioFullDeduction = $state(true);
  let taxRegistration = $state<TaxRegistration>('tax-free');
  let filingType = $state<FilingType>('blue');
  let simplifiedCategory = $state<SimplifiedTaxCategory>(4);
  let locked = $state(false);
  let confirmingLock = $state(false);
  let confirmingUnlock = $state(false);
  let lockError = $state('');
  let consumptionTaxXtxError = $state('');
  // 中間申告：前年確定消費税額（国税分）。ロック済みの前年スナップショットがあれば自動入力、
  // 無ければ利用者が手入力する（fabricate しない——CLAUDE.md の監査履歴不変原則）
  let priorYearAmountInput = $state('');
  // 確定申告への充当用：本年中に実際に中間納付した税額（利用者が手入力）
  let interimPaidNationalInput = $state('');
  let interimPaidLocalInput = $state('');
  let selectedInstallmentIndex = $state(0);

  function safeDecimal(s: string) {
    try {
      return D(s || '0');
    } catch {
      return D(0);
    }
  }

  const interimObligation = $derived(interimFilingObligation(year, safeDecimal(priorYearAmountInput)));
  // 前年額の編集により installments の件数が変わり selectedInstallmentIndex が範囲外に
  // なりうるため、範囲外なら先頭にフォールバックする（未定義のまま渡すと period が
  // undefined になり確定申告モードに化けてしまう——中間申告ボタンとしては致命的な誤動作）
  const selectedInstallment = $derived(
    interimObligation.installments[selectedInstallmentIndex] ?? interimObligation.installments[0]
  );

  $effect(() => {
    const yr = year;
    selectedInstallmentIndex = 0;
    getConsumptionTaxSnapshot(yr - 1).then((snap) => {
      priorYearAmountInput = snap?.netTaxNational ?? '';
    });
  });

  $effect(() => {
    const yr = year;
    const ax = breakdownAxis;
    const sub = liveQuery(async () => {
      const reg = (await getSetting('taxRegistration')) ?? 'tax-free';
      const cat = (await getSetting('simplifiedTaxCategory')) ?? 4;
      const filing = (await getSetting('filingType')) ?? 'blue';
      const attributionMethod = (await getSetting('consumptionTaxAttributionMethod')) ?? 'proportional';
      const reports = await buildAll(yr, ax);
      const processed = await processYear(yr);
      const salesRatio = computeTaxableSalesRatio(
        processed.taxableBase10,
        processed.taxableBase8,
        processed.exportExemptSalesBase,
        processed.nonTaxableSalesBase
      );
      return {
        ...reports,
        amendment: await getAmendmentDiff(yr),
        consumptionTax: await compareAll(yr, cat, attributionMethod),
        taxRegistration: reg,
        simplifiedCategory: cat,
        filingType: filing,
        locked: await isYearLocked(yr),
        taxableSalesRatioPercent: salesRatio.ratioPercent,
        taxableSalesRatioFullDeduction: isFullDeductionEligible(salesRatio),
      };
    }).subscribe((v) => {
      monthly = v.monthly;
      pl = v.pl;
      bs = v.bs;
      monthlyPL = v.monthlyPL;
      breakdown = v.breakdown;
      amendment = v.amendment;
      consumptionTax = v.consumptionTax;
      taxRegistration = v.taxRegistration;
      simplifiedCategory = v.simplifiedCategory;
      taxableSalesRatioPercent = v.taxableSalesRatioPercent;
      taxableSalesRatioFullDeduction = v.taxableSalesRatioFullDeduction;
      filingType = v.filingType;
      locked = v.locked;
    });
    return () => sub.unsubscribe();
  });

  function consumptionTaxMethodLabel(r: ConsumptionTaxResult, simplifiedCat: SimplifiedTaxCategory): string {
    switch (r.method) {
      case 'general':
        return m.reports_consumption_tax_method_general();
      case 'simplified':
        return m.reports_consumption_tax_method_simplified({ n: simplifiedCat });
      case 'two-wari':
        return m.reports_consumption_tax_method_two_wari();
      case 'three-wari':
        return m.reports_consumption_tax_method_three_wari();
    }
  }
  // 4 方式中で最少納付額の method を返す。同額時は先に来た方を優先。
  function bestMethod(results: ConsumptionTaxResult[]): ConsumptionTaxResult['method'] | null {
    if (results.length === 0) {
      return null;
    }
    let best = results[0];
    if (!best) {
      return null;
    }
    let bestNet = D(best.netTax.total);
    for (let i = 1; i < results.length; i++) {
      const r = results[i];
      if (!r) {
        continue;
      }
      const net = D(r.netTax.total);
      if (net.lessThan(bestNet)) {
        best = r;
        bestNet = net;
      }
    }
    return best.method;
  }

  async function lockYear() {
    confirmingLock = false;
    lockError = '';
    if (!monthly || !pl) {
      return;
    }
    try {
      await markYearFiled(
        year,
        {
          monthlySales: {
            type: 'monthly-sales',
            data: {
              months: monthly.months.map((m) => ({
                month: m.month,
                sales: m.sales,
              })),
            },
          },
          pl: {
            type: 'pl',
            data: {
              rows: [...pl.revenue, ...pl.expense].map((r) => ({
                accountCode: r.accountCode,
                amount: r.amount,
              })),
              totalRevenue: pl.totalRevenue,
              totalExpense: pl.totalExpense,
              netIncome: pl.netIncome,
            },
          },
          ...(bs
            ? {
                bs: {
                  type: 'bs' as const,
                  data: {
                    assets: bs.assets.map((r) => ({
                      accountCode: r.accountCode,
                      amount: r.balance,
                    })),
                    liabilities: bs.liabilities.map((r) => ({
                      accountCode: r.accountCode,
                      amount: r.balance,
                    })),
                    equity: bs.equity.map((r) => ({
                      accountCode: r.accountCode,
                      amount: r.balance,
                    })),
                  },
                },
              }
            : {}),
        },
        `${year}-12-31`
      );
    } catch (e) {
      lockError = e instanceof Error ? e.message : String(e);
    }
  }

  async function unlock() {
    confirmingUnlock = false;
    lockError = '';
    try {
      await unlockYear(year);
    } catch (e) {
      lockError = e instanceof Error ? e.message : String(e);
    }
  }

  // 申告者情報を設定から読む。IT部 必須項目（税務署・利用者識別番号・氏名・住所）が
  // 欠けると .xtx は e-Tax に組み込めないため、欠落キーも返す。
  async function loadFiler() {
    const filer = {
      riyoshaId: (await getSetting('userRiyoshaId')) ?? '',
      name: (await getSetting('userFilerName')) ?? '',
      zip: (await getSetting('userFilerZip')) ?? '',
      address: (await getSetting('userFilerAddress')) ?? '',
      zeimushoCode: (await getSetting('userZeimushoCode')) ?? '',
      zeimushoName: (await getSetting('userZeimushoName')) ?? '',
    };
    const missing =
      !filer.zeimushoCode || !filer.riyoshaId || !filer.name || !filer.address;
    return { filer, missing };
  }
  // testReiwa7：令和8年分の e-Tax 様式・モジュールが未提供のため、実機検証は
  // 令和7年分（NENBUN=7）で行う。封包構造は年分非依存（同一コード生成）。
  async function downloadXtx(testReiwa7 = false) {
    if (!monthly || !pl || !bs) {
      return;
    }
    if (year !== 2026) {
      lockError = m.reports_xtx_unsupported_year({ year });
      return;
    }
    const { filer, missing } = await loadFiler();
    if (missing) {
      lockError = m.reports_xtx_filer_incomplete();
      return;
    }
    lockError = '';
    const businessName = (await getSetting('userBusinessName')) ?? '';
    const invoiceNumber = (await getSetting('userInvoiceNumber')) ?? '';
    const filingType = (await getSetting('filingType')) ?? 'blue';
    const aoiroDeductionKind = (await getSetting('aoiroDeductionKind')) ?? 'electronic';
    const fixedAssets = await db.fixedAssets.toArray();
    const exportYear = testReiwa7 ? 2025 : year;
    const storedDeductions = await db.personalDeductions.get(exportYear);
    const xml = buildXtx2026({
      year: exportYear,
      businessName,
      invoiceNumber,
      monthly,
      pl,
      bs,
      filer,
      fixedAssets,
      filingType,
      aoiroDeductionKind,
      ...(storedDeductions ? { personalDeductions: personalDeductionsToCtx(storedDeductions) } : {}),
    });
    const blob = new Blob([xml], { type: 'application/xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `aoiko-${exportYear}.xtx`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
  function downloadXml(xml: string, filename: string): void {
    const blob = new Blob([xml], { type: 'application/xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
  // period 指定時は中間申告（仮決算方式）用の .xtx を出力する（SHINKOKU_KBN=2・対象期間付き、
  // 中間納付税額の充当は行わない）。未指定（既定）は確定申告（中間納付税額があれば充当する）。
  // 2割特例（消費税）の .xtx を出力する。SHA020(簡易課税用の様式を流用)＋付表6。
  async function downloadConsumptionTaxXtx(period?: { start: string; end: string }) {
    if (!period && !isTwoWariEligibleYear(year)) {
      consumptionTaxXtxError = m.reports_consumption_tax_xtx_unsupported_year({ year });
      return;
    }
    const { filer, missing } = await loadFiler();
    if (missing) {
      consumptionTaxXtxError = m.reports_xtx_filer_incomplete();
      return;
    }
    consumptionTaxXtxError = '';
    const businessName = (await getSetting('userBusinessName')) ?? '';
    const processed = await processYear(year, period);
    const xml = buildTwoWariXtx({
      year,
      businessName,
      filer,
      taxableBase10: processed.taxableBase10,
      taxableBase8: processed.taxableBase8,
      badDebtTax10: processed.badDebtTax10,
      badDebtTax8: processed.badDebtTax8,
      badDebtRecoveryTax10: processed.badDebtRecoveryTax10,
      badDebtRecoveryTax8: processed.badDebtRecoveryTax8,
      ...(period
        ? { interimPeriod: period }
        : {
            interimPaidNational: safeDecimal(interimPaidNationalInput),
            interimPaidLocal: safeDecimal(interimPaidLocalInput),
          }),
    });
    downloadXml(xml, `aoiko-shohi-${year}${period ? '-interim' : ''}.xtx`);
  }
  // 簡易課税（単一事業区分）の .xtx を出力する。SHA020＋付表4-3＋付表5-3。
  async function downloadSimplifiedXtx(period?: { start: string; end: string }) {
    const { filer, missing } = await loadFiler();
    if (missing) {
      consumptionTaxXtxError = m.reports_xtx_filer_incomplete();
      return;
    }
    consumptionTaxXtxError = '';
    const businessName = (await getSetting('userBusinessName')) ?? '';
    const processed = await processYear(year, period);
    const xml = buildSimplifiedXtx({
      year,
      businessName,
      filer,
      taxableBase10: processed.taxableBase10,
      taxableBase8: processed.taxableBase8,
      category: simplifiedCategory,
      deemedInputRate: deemedInputRate(simplifiedCategory),
      badDebtTax10: processed.badDebtTax10,
      badDebtTax8: processed.badDebtTax8,
      badDebtRecoveryTax10: processed.badDebtRecoveryTax10,
      badDebtRecoveryTax8: processed.badDebtRecoveryTax8,
      ...(period
        ? { interimPeriod: period }
        : {
            interimPaidNational: safeDecimal(interimPaidNationalInput),
            interimPaidLocal: safeDecimal(interimPaidLocalInput),
          }),
    });
    downloadXml(xml, `aoiko-shohi-${year}${period ? '-interim' : ''}.xtx`);
  }
  // 一般課税（本則）の .xtx を出力する。SHA010＋付表1-3＋付表2-3。
  async function downloadGeneralXtx(period?: { start: string; end: string }) {
    const { filer, missing } = await loadFiler();
    if (missing) {
      consumptionTaxXtxError = m.reports_xtx_filer_incomplete();
      return;
    }
    consumptionTaxXtxError = '';
    const businessName = (await getSetting('userBusinessName')) ?? '';
    const processed = await processYear(year, period);
    const attributionMethod = (await getSetting('consumptionTaxAttributionMethod')) ?? 'proportional';
    const xml = buildGeneralXtx({
      year,
      businessName,
      filer,
      taxableBase10: processed.taxableBase10,
      taxableBase8: processed.taxableBase8,
      input10: processed.input10,
      input8: processed.input8,
      exportExemptSalesBase: processed.exportExemptSalesBase,
      nonTaxableSalesBase: processed.nonTaxableSalesBase,
      inputCommon10: processed.inputCommon10,
      inputCommon8: processed.inputCommon8,
      inputNonTaxableOnly10: processed.inputNonTaxableOnly10,
      inputNonTaxableOnly8: processed.inputNonTaxableOnly8,
      importTax10: processed.importTax10,
      importTax8: processed.importTax8,
      reverseChargeBase: processed.reverseChargeBase,
      reverseChargeTax: processed.reverseChargeTax,
      attributionMethod,
      badDebtTax10: processed.badDebtTax10,
      badDebtTax8: processed.badDebtTax8,
      badDebtRecoveryTax10: processed.badDebtRecoveryTax10,
      badDebtRecoveryTax8: processed.badDebtRecoveryTax8,
      ...(period
        ? { interimPeriod: period }
        : {
            interimPaidNational: safeDecimal(interimPaidNationalInput),
            interimPaidLocal: safeDecimal(interimPaidLocalInput),
          }),
    });
    downloadXml(xml, `aoiko-shohi-${year}${period ? '-interim' : ''}.xtx`);
  }
  // 月別売上のバー高さ計算用、月内の最大売上を取る
  function maxSales(rep: MonthlyReport | null) {
    if (!rep) {
      return D(0);
    }
    return rep.months.reduce((mx, x) => (mx.greaterThan(x.sales) ? mx : D(x.sales)), D(0));
  }
  const monthlyMax = $derived(maxSales(monthly));

  function barWidth(value: string): string {
    if (monthlyMax.isZero()) {
      return '0%';
    }
    const pct = D(value).dividedBy(monthlyMax).times(100).toNumber();
    return `${Math.min(100, Math.max(0, pct))}%`;
  }
</script>

<div class="space-y-8">
  <header class="flex items-end justify-between">
    <div>
      <h2 class="text-2xl font-bold">{m.reports_title()}</h2>
      <p class="text-xs text-muted-foreground">{m.reports_subtitle()}</p>
    </div>
    <label class="block">
      <span class="text-xs text-muted-foreground">{m.journal_list_filter_year()}</span>
      <input
        type="number"
        bind:value={year}
        min="2020"
        max="2099"
        step="1"
        class="mt-1 w-24 px-3 py-2 bg-background border rounded text-foreground tabular-nums"
      />
    </label>
  </header>

  {#if lockError}
    <div class="border border-destructive bg-destructive/10 text-destructive rounded-lg px-4 py-2 text-sm">
      {lockError}
    </div>
  {/if}

  {#if pl}
    <section class="bg-card text-card-foreground rounded-2xl p-8 space-y-4 shadow-sm">
      <header class="flex items-center justify-between">
        <h3 class="text-lg font-semibold">{m.reports_overview_title({ year })}</h3>
        <div class="flex items-center gap-3">
          {#if locked}
            <span class="text-xs px-2 py-1 rounded bg-primary/10 text-primary">{m.reports_filed_badge()}</span>
            <button
              type="button"
              onclick={() => (confirmingUnlock = true)}
              class="text-xs text-muted-foreground hover:text-destructive"
            >
              {m.reports_unlock_button()}
            </button>
          {:else}
            <button
              type="button"
              onclick={() => (confirmingLock = true)}
              class="text-xs px-3 py-1 border rounded hover:bg-accent"
            >
              {m.reports_lock_button()}
            </button>
          {/if}
        </div>
      </header>
      <div class="grid grid-cols-4 gap-6 text-sm">
        <div>
          <div class="text-xs text-muted-foreground mb-1">{m.home_overview_revenue()}</div>
          <div class="text-2xl font-bold tabular-nums">{formatJPY(pl.totalRevenue)}</div>
        </div>
        <div>
          <div class="text-xs text-muted-foreground mb-1">{m.home_overview_expense()}</div>
          <div class="text-2xl font-bold tabular-nums">{formatJPY(pl.totalExpense)}</div>
        </div>
        <div>
          <div class="text-xs text-muted-foreground mb-1">{m.reports_overview_income()}</div>
          <div
            class="text-2xl font-bold tabular-nums"
            class:text-destructive={D(pl.netIncome).isNegative()}
          >
            {formatJPY(pl.netIncome)}
          </div>
        </div>
        <div>
          <div class="text-xs text-muted-foreground mb-1">{m.reports_overview_entries()}</div>
          <div class="text-2xl font-bold tabular-nums">{pl.entryCount}</div>
        </div>
      </div>
    </section>
  {/if}

  {#if monthly}
    <section class="bg-card text-card-foreground rounded-2xl p-6 space-y-4 shadow-sm">
      <header class="flex items-baseline justify-between">
        <h3 class="text-lg font-semibold">{m.reports_monthly_title()}</h3>
        <span class="text-xs text-muted-foreground tabular-nums">
          {m.reports_monthly_annual({ amount: formatJPY(monthly.totalSales) })}
        </span>
      </header>
      <ul class="space-y-1">
        {#each monthly.months as mo (mo.month)}
          <li class="grid grid-cols-[3rem_1fr_auto] gap-3 items-center text-sm">
            <span class="text-muted-foreground tabular-nums">{m.reports_monthly_month({ m: mo.month })}</span>
            <div class="h-2 bg-background rounded overflow-hidden">
              <div
                class="h-full bg-primary/60 transition-all"
                style:width={barWidth(mo.sales)}
              ></div>
            </div>
            <span class="tabular-nums whitespace-nowrap text-right w-28">
              {formatJPY(mo.sales)}
            </span>
          </li>
        {/each}
      </ul>
    </section>
  {/if}

  {#if pl}
    <section class="bg-card text-card-foreground rounded-2xl p-6 space-y-6 shadow-sm">
      <h3 class="text-lg font-semibold">{m.reports_pl_title()}</h3>

      <div>
        <h4 class="text-sm text-muted-foreground mb-2">{m.reports_pl_revenue()}</h4>
        {#if pl.revenue.length > 0}
          <ul class="space-y-1 text-sm">
            {#each pl.revenue as row (row.accountCode)}
              <li class="grid grid-cols-[auto_1fr_auto] gap-3 items-baseline">
                <span class="font-mono text-xs text-muted-foreground">{row.accountCode}</span>
                <span>{row.accountName}</span>
                <span class="tabular-nums whitespace-nowrap">{formatJPY(row.amount)}</span>
              </li>
            {/each}
          </ul>
          <div class="mt-2 pt-2 border-t border-border/50 flex justify-between text-sm font-medium">
            <span>{m.reports_pl_revenue_total()}</span>
            <span class="tabular-nums">{formatJPY(pl.totalRevenue)}</span>
          </div>
        {:else}
          <p class="text-sm text-muted-foreground">{m.reports_pl_no_entries()}</p>
        {/if}
      </div>

      <div>
        <h4 class="text-sm text-muted-foreground mb-2">{m.reports_pl_expense()}</h4>
        {#if pl.expense.length > 0}
          <ul class="space-y-1 text-sm">
            {#each pl.expense as row (row.accountCode)}
              <li class="grid grid-cols-[auto_1fr_auto] gap-3 items-baseline">
                <span class="font-mono text-xs text-muted-foreground">{row.accountCode}</span>
                <span>{row.accountName}</span>
                <span class="tabular-nums whitespace-nowrap">{formatJPY(row.amount)}</span>
              </li>
            {/each}
          </ul>
          <div class="mt-2 pt-2 border-t border-border/50 flex justify-between text-sm font-medium">
            <span>{m.reports_pl_expense_total()}</span>
            <span class="tabular-nums">{formatJPY(pl.totalExpense)}</span>
          </div>
        {:else}
          <p class="text-sm text-muted-foreground">{m.reports_pl_no_entries()}</p>
        {/if}
      </div>

      <div class="pt-4 border-t border-border flex justify-between items-baseline">
        <span class="text-base font-semibold">{m.reports_pl_net_income_label()}</span>
        <span
          class="text-2xl font-bold tabular-nums"
          class:text-destructive={D(pl.netIncome).isNegative()}
        >
          {formatJPY(pl.netIncome)}
        </span>
      </div>
    </section>
  {/if}

  {#if bs && (bs.assets.length > 0 || bs.liabilities.length > 0 || bs.equity.length > 0)}
    <section class="bg-card text-card-foreground rounded-2xl p-6 space-y-6 shadow-sm">
      <header class="flex items-baseline justify-between">
        <h3 class="text-lg font-semibold">{m.reports_bs_title()}</h3>
        <span class="text-xs text-muted-foreground tabular-nums">{m.reports_bs_asof({ date: bs.asOf })}</span>
      </header>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <h4 class="text-sm text-muted-foreground mb-2">{m.reports_bs_assets()}</h4>
          {#if bs.assets.length > 0}
            <ul class="space-y-1 text-sm">
              {#each bs.assets as r (r.accountCode)}
                <li class="grid grid-cols-[auto_1fr_auto] gap-3 items-baseline">
                  <span class="font-mono text-xs text-muted-foreground">{r.accountCode}</span>
                  <span>{r.accountName}</span>
                  <span class="tabular-nums whitespace-nowrap">{formatJPY(r.balance)}</span>
                </li>
              {/each}
            </ul>
            <div class="mt-2 pt-2 border-t border-border/50 flex justify-between text-sm font-medium">
              <span>{m.reports_bs_assets_total()}</span>
              <span class="tabular-nums">{formatJPY(bs.totalAssets)}</span>
            </div>
          {:else}
            <p class="text-sm text-muted-foreground">{m.reports_pl_no_entries()}</p>
          {/if}
        </div>

        <div class="space-y-6">
          <div>
            <h4 class="text-sm text-muted-foreground mb-2">{m.reports_bs_liabilities()}</h4>
            {#if bs.liabilities.length > 0}
              <ul class="space-y-1 text-sm">
                {#each bs.liabilities as r (r.accountCode)}
                  <li class="grid grid-cols-[auto_1fr_auto] gap-3 items-baseline">
                    <span class="font-mono text-xs text-muted-foreground">{r.accountCode}</span>
                    <span>{r.accountName}</span>
                    <span class="tabular-nums whitespace-nowrap">{formatJPY(r.balance)}</span>
                  </li>
                {/each}
              </ul>
            {:else}
              <p class="text-sm text-muted-foreground">{m.reports_pl_no_entries()}</p>
            {/if}
          </div>

          <div>
            <h4 class="text-sm text-muted-foreground mb-2">{m.reports_bs_equity()}</h4>
            <ul class="space-y-1 text-sm">
              {#each bs.equity as r (r.accountCode)}
                <li class="grid grid-cols-[auto_1fr_auto] gap-3 items-baseline">
                  <span class="font-mono text-xs text-muted-foreground">{r.accountCode}</span>
                  <span>{r.accountName}</span>
                  <span class="tabular-nums whitespace-nowrap">{formatJPY(r.balance)}</span>
                </li>
              {/each}
              <li class="grid grid-cols-[auto_1fr_auto] gap-3 items-baseline">
                <span class="font-mono text-xs text-muted-foreground">—</span>
                <span>{m.reports_bs_net_income_row()}</span>
                <span
                  class="tabular-nums whitespace-nowrap"
                  class:text-destructive={D(bs.netIncome).isNegative()}
                >
                  {formatJPY(bs.netIncome)}
                </span>
              </li>
            </ul>
          </div>

          <div class="pt-2 border-t border-border/50 flex justify-between text-sm font-medium">
            <span>{m.reports_bs_liab_equity_total()}</span>
            <span class="tabular-nums">{formatJPY(bs.totalLiabilitiesAndEquity)}</span>
          </div>
        </div>
      </div>

      {#if !bs.balanced}
        <div class="border border-destructive bg-destructive/10 text-destructive rounded px-3 py-2 text-xs">
          {m.reports_bs_imbalance_warning({ assets: formatJPY(bs.totalAssets), liabEquity: formatJPY(bs.totalLiabilitiesAndEquity) })}
        </div>
      {/if}
    </section>
  {/if}

  {#if pl && pl.entryCount === 0}
    <div class="bg-card text-card-foreground rounded-xl p-12 text-center shadow-sm">
      <p class="text-sm text-muted-foreground">
        {m.reports_empty({ year })}
      </p>
    </div>
  {/if}

  {#if monthlyPL && (monthlyPL.revenue.length > 0 || monthlyPL.expense.length > 0)}
    <section class="bg-card text-card-foreground rounded-2xl p-6 space-y-4 shadow-sm">
      <header class="flex items-baseline justify-between">
        <h3 class="text-lg font-semibold">{m.reports_monthly_pl_title()}</h3>
        <span class="text-xs text-muted-foreground tabular-nums">
          {m.reports_monthly_pl_net_income({ amount: formatJPY(monthlyPL.netIncome) })}
        </span>
      </header>
      <div class="overflow-x-auto">
        <table class="w-full text-xs tabular-nums">
          <thead>
            <tr class="text-muted-foreground border-b">
              <th class="text-left font-normal py-2 pr-2 sticky left-0 bg-card">{m.reports_monthly_pl_th_account()}</th>
              {#each Array(12) as _, i (i)}
                <th class="text-right font-normal px-2">{m.reports_monthly_pl_th_month({ m: i + 1 })}</th>
              {/each}
              <th class="text-right font-medium px-2">{m.reports_monthly_pl_th_total()}</th>
            </tr>
          </thead>
          <tbody>
            {#if monthlyPL.revenue.length > 0}
              <tr class="text-muted-foreground bg-muted/30">
                <td class="py-1 pr-2 sticky left-0 bg-card">{m.reports_monthly_pl_revenue_row()}</td>
                <td colspan="13"></td>
              </tr>
              {#each monthlyPL.revenue as row (row.accountCode)}
                <tr class="border-b border-border/40">
                  <td class="py-1 pr-2 sticky left-0 bg-card">{row.accountName}</td>
                  {#each row.monthly as v, i (i)}
                    <td class="text-right px-2" class:text-muted-foreground={v === '0'}>
                      {v === '0' ? '' : formatJPY(v)}
                    </td>
                  {/each}
                  <td class="text-right px-2 font-medium">{formatJPY(row.total)}</td>
                </tr>
              {/each}
              <tr class="border-b font-medium">
                <td class="py-1 pr-2 sticky left-0 bg-card">{m.reports_monthly_pl_revenue_total()}</td>
                {#each monthlyPL.monthlyRevenueTotals as v, i (i)}
                  <td class="text-right px-2" class:text-muted-foreground={v === '0'}>
                    {v === '0' ? '' : formatJPY(v)}
                  </td>
                {/each}
                <td class="text-right px-2">{formatJPY(monthlyPL.totalRevenue)}</td>
              </tr>
            {/if}
            {#if monthlyPL.expense.length > 0}
              <tr class="text-muted-foreground bg-muted/30">
                <td class="py-1 pr-2 sticky left-0 bg-card">{m.reports_monthly_pl_expense_row()}</td>
                <td colspan="13"></td>
              </tr>
              {#each monthlyPL.expense as row (row.accountCode)}
                <tr class="border-b border-border/40">
                  <td class="py-1 pr-2 sticky left-0 bg-card">{row.accountName}</td>
                  {#each row.monthly as v, i (i)}
                    <td class="text-right px-2" class:text-muted-foreground={v === '0'}>
                      {v === '0' ? '' : formatJPY(v)}
                    </td>
                  {/each}
                  <td class="text-right px-2 font-medium">{formatJPY(row.total)}</td>
                </tr>
              {/each}
              <tr class="border-b font-medium">
                <td class="py-1 pr-2 sticky left-0 bg-card">{m.reports_monthly_pl_expense_total()}</td>
                {#each monthlyPL.monthlyExpenseTotals as v, i (i)}
                  <td class="text-right px-2" class:text-muted-foreground={v === '0'}>
                    {v === '0' ? '' : formatJPY(v)}
                  </td>
                {/each}
                <td class="text-right px-2">{formatJPY(monthlyPL.totalExpense)}</td>
              </tr>
            {/if}
            <tr class="font-semibold border-t-2">
              <td class="py-1 pr-2 sticky left-0 bg-card">{m.reports_monthly_pl_net_income_row()}</td>
              {#each monthlyPL.monthlyNetIncomes as v, i (i)}
                <td class="text-right px-2" class:text-destructive={D(v).isNegative()}>
                  {v === '0' ? '' : formatJPY(v)}
                </td>
              {/each}
              <td class="text-right px-2" class:text-destructive={D(monthlyPL.netIncome).isNegative()}>
                {formatJPY(monthlyPL.netIncome)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  {/if}

  {#if breakdown && breakdown.groups.length > 0}
    <section class="bg-card text-card-foreground rounded-2xl p-6 space-y-4 shadow-sm">
      <header class="flex items-baseline justify-between">
        <h3 class="text-lg font-semibold">{m.reports_breakdown_title()}</h3>
        <div class="flex gap-1 text-xs">
          <button
            type="button"
            onclick={() => (breakdownAxis = 'vendor')}
            class="px-3 py-1 border rounded"
            class:bg-primary={breakdownAxis === 'vendor'}
            class:text-primary-foreground={breakdownAxis === 'vendor'}
            class:hover:bg-accent={breakdownAxis !== 'vendor'}
          >
            {m.reports_breakdown_by_vendor()}
          </button>
          <button
            type="button"
            onclick={() => (breakdownAxis = 'subAccount')}
            class="px-3 py-1 border rounded"
            class:bg-primary={breakdownAxis === 'subAccount'}
            class:text-primary-foreground={breakdownAxis === 'subAccount'}
            class:hover:bg-accent={breakdownAxis !== 'subAccount'}
          >
            {m.reports_breakdown_by_subaccount()}
          </button>
        </div>
      </header>
      <div class="space-y-4">
        {#each breakdown.groups as g (g.accountCode)}
          <div>
            <header class="flex items-baseline justify-between text-sm font-medium border-b pb-1 mb-1">
              <span><span class="font-mono text-xs text-muted-foreground mr-2">{g.accountCode}</span>{g.accountName}</span>
              <span class="tabular-nums">{formatJPY(g.total)}</span>
            </header>
            <ul class="space-y-0.5 text-sm pl-4">
              {#each g.entries as e (e.key)}
                <li class="grid grid-cols-[1fr_auto_auto] gap-3 items-baseline">
                  <span class:text-muted-foreground={!e.key}>{e.label}</span>
                  <span class="text-xs text-muted-foreground tabular-nums">{m.reports_breakdown_count({ n: e.count })}</span>
                  <span class="tabular-nums whitespace-nowrap w-28 text-right">{formatJPY(e.amount)}</span>
                </li>
              {/each}
            </ul>
          </div>
        {/each}
      </div>
    </section>
  {/if}

  {#if amendment}
    {@const a = amendment}
    <section
      class="bg-card text-card-foreground rounded-2xl p-6 space-y-4 shadow-sm"
      class:border-2={a.hasChange}
      class:border-amber-500={a.hasChange}
    >
      <header class="flex items-baseline justify-between">
        <h3 class="text-lg font-semibold">{m.reports_amendment_title()}</h3>
        <span class="text-xs text-muted-foreground">
          {m.reports_amendment_filed_at({ date: toISODateLocal(new Date(a.filedAt)) })}
        </span>
      </header>
      {#if !a.hasChange}
        <p class="text-sm text-muted-foreground">
          {m.reports_amendment_no_change()}
        </p>
      {:else}
        <p class="text-sm text-amber-600">
          {m.reports_amendment_has_change()}
        </p>
        <div class="grid grid-cols-3 gap-4 text-sm tabular-nums border rounded p-3">
          <div>
            <div class="text-xs text-muted-foreground">{m.reports_amendment_revenue()}</div>
            <div>{m.reports_amendment_filed_value({ amount: formatJPY(a.filedTotalRevenue) })}</div>
            <div class="font-medium">{m.reports_amendment_current_value({ amount: formatJPY(a.currentTotalRevenue) })}</div>
          </div>
          <div>
            <div class="text-xs text-muted-foreground">{m.reports_amendment_expense()}</div>
            <div>{m.reports_amendment_filed_value({ amount: formatJPY(a.filedTotalExpense) })}</div>
            <div class="font-medium">{m.reports_amendment_current_value({ amount: formatJPY(a.currentTotalExpense) })}</div>
          </div>
          <div>
            <div class="text-xs text-muted-foreground">{m.reports_amendment_net_income()}</div>
            <div>{m.reports_amendment_filed_value({ amount: formatJPY(a.filedNetIncome) })}</div>
            <div class="font-medium" class:text-destructive={D(a.netIncomeDelta).isNegative()}>
              {m.reports_amendment_current_value_with_delta({ amount: formatJPY(a.currentNetIncome), delta: formatJPY(a.netIncomeDelta) })}
            </div>
          </div>
        </div>
        <ol class="space-y-2 text-sm list-decimal list-inside pt-2">
          {#each amendmentChecklist() as item (item.key)}
            <li>
              <span class="font-medium">{checklistLabel(item.key, year)}</span>
              <p class="text-xs text-muted-foreground pl-5">{checklistDetail(item.key)}</p>
            </li>
          {/each}
        </ol>
      {/if}
    </section>
  {/if}

  {#if consumptionTax && consumptionTax.length > 0}
    {@const ct = consumptionTax}
    {@const cat = simplifiedCategory}
    {@const best = bestMethod(ct)}
    <section class="bg-card text-card-foreground rounded-2xl p-6 space-y-4 shadow-sm">
      <header class="flex items-baseline justify-between">
        <h3 class="text-lg font-semibold">{m.reports_consumption_tax_title()}</h3>
      </header>
      {#if taxRegistration === 'tax-free'}
        <p class="text-sm text-muted-foreground">{m.reports_consumption_tax_tax_free()}</p>
      {/if}
      <p class="text-xs text-muted-foreground">
        {m.reports_consumption_tax_taxable_base({ amount: formatJPY(ct[0]?.taxableBase ?? '0') })}
      </p>
      <p class="text-xs text-muted-foreground">
        {m.reports_consumption_tax_sales_ratio({ percent: taxableSalesRatioPercent })}
        {#if !taxableSalesRatioFullDeduction}
          <span class="ml-1">{m.reports_consumption_tax_sales_ratio_partial()}</span>
        {/if}
      </p>
      <div class="overflow-x-auto">
        <table class="w-full text-sm tabular-nums">
          <thead>
            <tr class="text-xs text-muted-foreground border-b">
              <th class="text-left font-normal py-2 pr-2">{m.reports_consumption_tax_th_method()}</th>
              <th class="text-right font-normal px-2">{m.reports_consumption_tax_th_output()}</th>
              <th class="text-right font-normal px-2">{m.reports_consumption_tax_th_input_raw()}</th>
              <th class="text-right font-normal px-2">{m.reports_consumption_tax_th_input()}</th>
              <th class="text-right font-medium px-2">{m.reports_consumption_tax_th_net()}</th>
              <th class="text-right font-medium px-2">{m.reports_consumption_tax_th_filing()}</th>
            </tr>
          </thead>
          <tbody>
            {#each ct as r (r.method)}
              <tr class="border-b border-border/40" class:bg-primary={r.method === best} class:text-primary-foreground={r.method === best}>
                <td class="py-2 pr-2">
                  {consumptionTaxMethodLabel(r, cat)}
                  {#if r.method === best}
                    <span class="ml-1 text-xs">{m.reports_consumption_tax_best()}</span>
                  {/if}
                </td>
                <td class="text-right px-2">{formatJPY(r.outputTax.total)}</td>
                <td class="text-right px-2 text-muted-foreground" class:text-primary-foreground={r.method === best}>
                  {r.method === 'general' ? formatJPY(r.inputTaxRaw.total) : '—'}
                </td>
                <td class="text-right px-2">{formatJPY(r.inputTax.total)}</td>
                <td class="text-right px-2 font-medium">{formatJPY(r.netTax.total)}</td>
                <td class="text-right px-2 font-medium">{formatJPY(r.filingRounded.total)}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
      <details class="text-xs text-muted-foreground">
        <summary class="cursor-pointer">{m.reports_consumption_tax_breakdown_national()} / {m.reports_consumption_tax_breakdown_local()}</summary>
        <table class="w-full text-xs tabular-nums mt-2">
          <thead>
            <tr class="text-muted-foreground border-b">
              <th class="text-left font-normal py-1 pr-2">{m.reports_consumption_tax_th_method()}</th>
              <th class="text-right font-normal px-2">{m.reports_consumption_tax_breakdown_national()}（{m.reports_consumption_tax_th_net()}）</th>
              <th class="text-right font-normal px-2">{m.reports_consumption_tax_breakdown_local()}（{m.reports_consumption_tax_th_net()}）</th>
              <th class="text-right font-normal px-2">{m.reports_consumption_tax_breakdown_national()}（{m.reports_consumption_tax_th_filing()}）</th>
              <th class="text-right font-normal px-2">{m.reports_consumption_tax_breakdown_local()}（{m.reports_consumption_tax_th_filing()}）</th>
            </tr>
          </thead>
          <tbody>
            {#each ct as r (`bd-${r.method}`)}
              <tr class="border-b border-border/30">
                <td class="py-1 pr-2">{consumptionTaxMethodLabel(r, cat)}</td>
                <td class="text-right px-2">{formatJPY(r.netTax.national)}</td>
                <td class="text-right px-2">{formatJPY(r.netTax.local)}</td>
                <td class="text-right px-2">{formatJPY(r.filingRounded.national)}</td>
                <td class="text-right px-2">{formatJPY(r.filingRounded.local)}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </details>
      <p class="text-xs text-muted-foreground border-t pt-2">
        {m.reports_consumption_tax_caveat()}
      </p>
      <p class="text-xs text-muted-foreground">
        {m.reports_consumption_tax_filing_caveat()}
      </p>
      <p class="text-xs text-muted-foreground">
        {m.reports_consumption_tax_settings_link()}
      </p>
      <div class="border-t pt-3 space-y-2">
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <label class="text-xs text-muted-foreground">
            {m.reports_interim_paid_national_label()}
            <input
              type="text"
              inputmode="numeric"
              bind:value={interimPaidNationalInput}
              placeholder="0"
              class="mt-1 w-full border rounded px-2 py-1 text-sm"
            />
          </label>
          <label class="text-xs text-muted-foreground">
            {m.reports_interim_paid_local_label()}
            <input
              type="text"
              inputmode="numeric"
              bind:value={interimPaidLocalInput}
              placeholder="0"
              class="mt-1 w-full border rounded px-2 py-1 text-sm"
            />
          </label>
        </div>
        <p class="text-xs text-muted-foreground">{m.reports_interim_paid_hint()}</p>
        {#if ct.some((r) => r.method === 'two-wari')}
          <p class="text-xs text-muted-foreground">
            {m.reports_consumption_tax_xtx_two_wari_intro()}
          </p>
          <button
            type="button"
            onclick={() => downloadConsumptionTaxXtx()}
            class="px-4 py-2 border rounded hover:bg-accent"
          >
            {m.reports_consumption_tax_xtx_two_wari_download()}
          </button>
        {/if}
        <p class="text-xs text-muted-foreground">
          {m.reports_consumption_tax_xtx_simplified_intro()}
        </p>
        <button
          type="button"
          onclick={() => downloadSimplifiedXtx()}
          class="px-4 py-2 border rounded hover:bg-accent"
        >
          {m.reports_consumption_tax_xtx_simplified_download()}
        </button>
        <p class="text-xs text-muted-foreground">
          {m.reports_consumption_tax_xtx_general_intro()}
        </p>
        <button
          type="button"
          onclick={() => downloadGeneralXtx()}
          class="px-4 py-2 border rounded hover:bg-accent"
        >
          {m.reports_consumption_tax_xtx_general_download()}
        </button>
        {#if consumptionTaxXtxError}
          <p class="text-sm font-medium text-destructive border border-destructive rounded px-3 py-2">
            {consumptionTaxXtxError}
          </p>
        {/if}
      </div>
    </section>

    <section class="bg-card text-card-foreground rounded-2xl p-6 space-y-4 shadow-sm">
      <header class="flex items-baseline justify-between">
        <h3 class="text-lg font-semibold">{m.reports_interim_title()}</h3>
      </header>
      <p class="text-xs text-muted-foreground">{m.reports_interim_intro()}</p>
      <label class="block text-xs text-muted-foreground">
        {m.reports_interim_prior_year_label({ year: year - 1 })}
        <input
          type="text"
          inputmode="numeric"
          bind:value={priorYearAmountInput}
          placeholder="0"
          class="mt-1 w-full border rounded px-2 py-1 text-sm"
        />
      </label>
      {#if interimObligation.installmentCount === 0}
        <p class="text-sm text-muted-foreground">{m.reports_interim_no_obligation()}</p>
      {:else}
        <p class="text-sm">
          {m.reports_interim_installment_count({ n: interimObligation.installmentCount })}
        </p>
        <div class="overflow-x-auto">
          <table class="w-full text-sm tabular-nums">
            <thead>
              <tr class="text-xs text-muted-foreground border-b">
                <th class="text-left font-normal py-2 pr-2">{m.reports_interim_th_period()}</th>
                <th class="text-left font-normal px-2">{m.reports_interim_th_due()}</th>
                <th class="text-right font-normal px-2">{m.reports_interim_th_amount()}</th>
              </tr>
            </thead>
            <tbody>
              {#each interimObligation.installments as inst (inst.start)}
                <tr class="border-b border-border/40">
                  <td class="py-2 pr-2">{inst.start} 〜 {inst.end}</td>
                  <td class="px-2">{inst.dueDate}</td>
                  <td class="text-right px-2">{formatJPY(inst.amount.total)}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
        <p class="text-xs text-muted-foreground">{m.reports_interim_yotei_note()}</p>
        <div class="border-t pt-3 space-y-2">
          <label class="block text-xs text-muted-foreground">
            {m.reports_interim_period_select_label()}
            <select bind:value={selectedInstallmentIndex} class="mt-1 w-full border rounded px-2 py-1 text-sm">
              {#each interimObligation.installments as inst, i (inst.start)}
                <option value={i}>{inst.start} 〜 {inst.end}（{m.reports_interim_th_due()} {inst.dueDate}）</option>
              {/each}
            </select>
          </label>
          <p class="text-xs text-muted-foreground">{m.reports_interim_kari_kessan_intro()}</p>
          <div class="flex flex-wrap gap-2">
            {#if ct && ct.some((r) => r.method === 'two-wari')}
              <button
                type="button"
                onclick={() => downloadConsumptionTaxXtx(selectedInstallment)}
                class="px-4 py-2 border rounded hover:bg-accent"
              >
                {m.reports_consumption_tax_xtx_two_wari_download()}
              </button>
            {/if}
            <button
              type="button"
              onclick={() => downloadSimplifiedXtx(selectedInstallment)}
              class="px-4 py-2 border rounded hover:bg-accent"
            >
              {m.reports_consumption_tax_xtx_simplified_download()}
            </button>
            <button
              type="button"
              onclick={() => downloadGeneralXtx(selectedInstallment)}
              class="px-4 py-2 border rounded hover:bg-accent"
            >
              {m.reports_consumption_tax_xtx_general_download()}
            </button>
          </div>
          {#if consumptionTaxXtxError}
            <p class="text-sm font-medium text-destructive border border-destructive rounded px-3 py-2">
              {consumptionTaxXtxError}
            </p>
          {/if}
        </div>
      {/if}
    </section>
  {/if}

  {#if monthly && pl && bs && pl.entryCount > 0}
    <section class="bg-card text-card-foreground rounded-xl p-6 space-y-3 shadow-sm">
      <h3 class="text-lg font-semibold">{m.reports_xtx_title()}</h3>
      <p class="text-xs text-muted-foreground">
        {@html filingType === 'white' ? m.reports_xtx_intro_white_html() : m.reports_xtx_intro_html()}
      </p>
      <div class="flex flex-wrap gap-2">
        <button
          type="button"
          onclick={() => downloadXtx(false)}
          class="px-4 py-2 border rounded hover:bg-accent"
        >
          {m.reports_xtx_download()}
        </button>
        {#if import.meta.env.DEV}
          <button
            type="button"
            onclick={() => downloadXtx(true)}
            class="px-4 py-2 border border-dashed rounded text-muted-foreground hover:bg-accent"
            title={m.reports_xtx_download_reiwa7_hint()}
          >
            {m.reports_xtx_download_reiwa7()}
          </button>
        {/if}
      </div>
      {#if lockError}
        <div class="border border-destructive bg-destructive/10 text-destructive rounded-lg px-4 py-2 text-sm">
          {lockError}
        </div>
      {/if}
    </section>
  {/if}
</div>

<AlertDialog.Root bind:open={confirmingLock}>
  <AlertDialog.Content>
    <AlertDialog.Header>
      <AlertDialog.Title>{m.reports_lock_confirm_title({ year })}</AlertDialog.Title>
      <AlertDialog.Description>
        {m.reports_lock_confirm_desc({ year })}
      </AlertDialog.Description>
    </AlertDialog.Header>
    <AlertDialog.Footer>
      <AlertDialog.Cancel>{m.common_cancel()}</AlertDialog.Cancel>
      <AlertDialog.Action onclick={lockYear}>{m.reports_lock_confirm_action()}</AlertDialog.Action>
    </AlertDialog.Footer>
  </AlertDialog.Content>
</AlertDialog.Root>

<AlertDialog.Root bind:open={confirmingUnlock}>
  <AlertDialog.Content>
    <AlertDialog.Header>
      <AlertDialog.Title>{m.reports_unlock_confirm_title()}</AlertDialog.Title>
      <AlertDialog.Description>
        {m.reports_unlock_confirm_desc({ year })}
      </AlertDialog.Description>
    </AlertDialog.Header>
    <AlertDialog.Footer>
      <AlertDialog.Cancel>{m.common_cancel()}</AlertDialog.Cancel>
      <AlertDialog.Action
        onclick={unlock}
        class="bg-destructive text-destructive-foreground hover:bg-destructive/90"
      >
        {m.reports_unlock_button()}
      </AlertDialog.Action>
    </AlertDialog.Footer>
  </AlertDialog.Content>
</AlertDialog.Root>