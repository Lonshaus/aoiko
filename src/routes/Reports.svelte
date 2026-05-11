<script lang="ts">
  import { liveQuery } from 'dexie';
  import { D, formatJPY } from '../lib/decimal';
  import {
    buildBS,
    buildBreakdown,
    buildMonthly,
    buildMonthlyPL,
    buildPL,
    type BreakdownAxis,
    type BreakdownReport,
    type BSReport,
    type MonthlyPLReport,
    type MonthlyReport,
    type PLReport,
  } from '../domain/reports';
  import { isYearLocked, markYearFiled, unlockYear } from '../domain/snapshots';
  import {
    amendmentChecklist,
    getAmendmentDiff,
    type AmendmentDiff,
  } from '../domain/amended';
  import { buildXtx2026 } from '../tax-schema/2026/xtx';
  import { getSetting } from '../lib/settings';
  import * as AlertDialog from '$lib/components/ui/alert-dialog';

  const now = new Date();
  let year = $state(now.getFullYear());

  let monthly = $state<MonthlyReport | null>(null);
  let pl = $state<PLReport | null>(null);
  let bs = $state<BSReport | null>(null);
  let monthlyPL = $state<MonthlyPLReport | null>(null);
  let breakdown = $state<BreakdownReport | null>(null);
  let breakdownAxis = $state<BreakdownAxis>('vendor');
  let amendment = $state<AmendmentDiff | null>(null);
  let locked = $state(false);
  let confirmingLock = $state(false);
  let confirmingUnlock = $state(false);
  let lockError = $state('');

  $effect(() => {
    const yr = year;
    const ax = breakdownAxis;
    const sub = liveQuery(async () => ({
      monthly: await buildMonthly(yr),
      pl: await buildPL(yr),
      bs: await buildBS(yr),
      monthlyPL: await buildMonthlyPL(yr),
      breakdown: await buildBreakdown(yr, ax),
      amendment: await getAmendmentDiff(yr),
      locked: await isYearLocked(yr),
    })).subscribe((v) => {
      monthly = v.monthly;
      pl = v.pl;
      bs = v.bs;
      monthlyPL = v.monthlyPL;
      breakdown = v.breakdown;
      amendment = v.amendment;
      locked = v.locked;
    });
    return () => sub.unsubscribe();
  });

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

  async function downloadXtx() {
    if (!monthly || !pl || !bs) {
      return;
    }
    if (year !== 2026) {
      lockError = `${year} 年度の .xtx 出力は未対応（現状 2026 年度のみ）`;
      return;
    }
    const businessName = (await getSetting('userBusinessName')) ?? '';
    const invoiceNumber = (await getSetting('userInvoiceNumber')) ?? '';
    const xml = buildXtx2026({
      year,
      businessName,
      invoiceNumber,
      monthly,
      pl,
      bs,
    });
    const blob = new Blob([xml], { type: 'application/xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `aoiko-${year}.xtx`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // 月別売上のバー高さ計算用、月内の最大売上を取る
  function maxSales(rep: MonthlyReport | null): number {
    if (!rep) {
      return 0;
    }
    return rep.months.reduce(
      (m, x) => Math.max(m, Number(x.sales)),
      0
    );
  }
  const monthlyMax = $derived(maxSales(monthly));

  function barWidth(value: string): string {
    if (monthlyMax === 0) {
      return '0%';
    }
    const pct = (Number(value) / monthlyMax) * 100;
    return `${Math.min(100, pct)}%`;
  }
</script>

<div class="space-y-8">
  <header class="flex items-end justify-between">
    <div>
      <h2 class="text-2xl font-bold">レポート</h2>
      <p class="text-xs text-muted-foreground">月別売上・損益計算書（年度ごと）</p>
    </div>
    <label class="block">
      <span class="text-xs text-muted-foreground">年</span>
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
        <h3 class="text-lg font-semibold">{year} 年 概況</h3>
        <div class="flex items-center gap-3">
          {#if locked}
            <span class="text-xs px-2 py-1 rounded bg-primary/10 text-primary">🔒 申告済み</span>
            <button
              type="button"
              onclick={() => (confirmingUnlock = true)}
              class="text-xs text-muted-foreground hover:text-destructive"
            >
              ロック解除
            </button>
          {:else}
            <button
              type="button"
              onclick={() => (confirmingLock = true)}
              class="text-xs px-3 py-1 border rounded hover:bg-accent"
            >
              申告済みとしてロック
            </button>
          {/if}
        </div>
      </header>
      <div class="grid grid-cols-4 gap-6 text-sm">
        <div>
          <div class="text-xs text-muted-foreground mb-1">売上</div>
          <div class="text-2xl font-bold tabular-nums">{formatJPY(pl.totalRevenue)}</div>
        </div>
        <div>
          <div class="text-xs text-muted-foreground mb-1">経費</div>
          <div class="text-2xl font-bold tabular-nums">{formatJPY(pl.totalExpense)}</div>
        </div>
        <div>
          <div class="text-xs text-muted-foreground mb-1">所得</div>
          <div
            class="text-2xl font-bold tabular-nums"
            class:text-destructive={D(pl.netIncome).isNegative()}
          >
            {formatJPY(pl.netIncome)}
          </div>
        </div>
        <div>
          <div class="text-xs text-muted-foreground mb-1">仕訳数</div>
          <div class="text-2xl font-bold tabular-nums">{pl.entryCount}</div>
        </div>
      </div>
    </section>
  {/if}

  {#if monthly}
    <section class="bg-card text-card-foreground rounded-2xl p-6 space-y-4 shadow-sm">
      <header class="flex items-baseline justify-between">
        <h3 class="text-lg font-semibold">月別売上</h3>
        <span class="text-xs text-muted-foreground tabular-nums">
          年計 {formatJPY(monthly.totalSales)}
        </span>
      </header>
      <ul class="space-y-1">
        {#each monthly.months as m (m.month)}
          <li class="grid grid-cols-[3rem_1fr_auto] gap-3 items-center text-sm">
            <span class="text-muted-foreground tabular-nums">{m.month} 月</span>
            <div class="h-2 bg-background rounded overflow-hidden">
              <div
                class="h-full bg-primary/60 transition-all"
                style:width={barWidth(m.sales)}
              ></div>
            </div>
            <span class="tabular-nums whitespace-nowrap text-right w-28">
              {formatJPY(m.sales)}
            </span>
          </li>
        {/each}
      </ul>
    </section>
  {/if}

  {#if pl}
    <section class="bg-card text-card-foreground rounded-2xl p-6 space-y-6 shadow-sm">
      <h3 class="text-lg font-semibold">損益計算書</h3>

      <div>
        <h4 class="text-sm text-muted-foreground mb-2">収益</h4>
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
            <span>収益計</span>
            <span class="tabular-nums">{formatJPY(pl.totalRevenue)}</span>
          </div>
        {:else}
          <p class="text-sm text-muted-foreground">計上なし</p>
        {/if}
      </div>

      <div>
        <h4 class="text-sm text-muted-foreground mb-2">経費</h4>
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
            <span>経費計</span>
            <span class="tabular-nums">{formatJPY(pl.totalExpense)}</span>
          </div>
        {:else}
          <p class="text-sm text-muted-foreground">計上なし</p>
        {/if}
      </div>

      <div class="pt-4 border-t border-border flex justify-between items-baseline">
        <span class="text-base font-semibold">所得（収益 − 経費）</span>
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
        <h3 class="text-lg font-semibold">貸借対照表</h3>
        <span class="text-xs text-muted-foreground tabular-nums">{bs.asOf} 時点</span>
      </header>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <h4 class="text-sm text-muted-foreground mb-2">資産</h4>
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
              <span>資産合計</span>
              <span class="tabular-nums">{formatJPY(bs.totalAssets)}</span>
            </div>
          {:else}
            <p class="text-sm text-muted-foreground">計上なし</p>
          {/if}
        </div>

        <div class="space-y-6">
          <div>
            <h4 class="text-sm text-muted-foreground mb-2">負債</h4>
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
              <p class="text-sm text-muted-foreground">計上なし</p>
            {/if}
          </div>

          <div>
            <h4 class="text-sm text-muted-foreground mb-2">純資産</h4>
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
                <span>当期純利益</span>
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
            <span>負債・純資産合計</span>
            <span class="tabular-nums">{formatJPY(bs.totalLiabilitiesAndEquity)}</span>
          </div>
        </div>
      </div>

      {#if !bs.balanced}
        <div class="border border-destructive bg-destructive/10 text-destructive rounded px-3 py-2 text-xs">
          ⚠ 資産合計 {formatJPY(bs.totalAssets)} と 負債・純資産合計 {formatJPY(bs.totalLiabilitiesAndEquity)} が一致しません。仕訳に不整合がある可能性があります。
        </div>
      {/if}
    </section>
  {/if}

  {#if pl && pl.entryCount === 0}
    <div class="bg-card text-card-foreground rounded-xl p-12 text-center shadow-sm">
      <p class="text-sm text-muted-foreground">
        {year} 年の仕訳がありません。
      </p>
    </div>
  {/if}

  {#if monthlyPL && (monthlyPL.revenue.length > 0 || monthlyPL.expense.length > 0)}
    <section class="bg-card text-card-foreground rounded-2xl p-6 space-y-4 shadow-sm">
      <header class="flex items-baseline justify-between">
        <h3 class="text-lg font-semibold">月別 PL（科目 × 月）</h3>
        <span class="text-xs text-muted-foreground tabular-nums">
          純利益 {formatJPY(monthlyPL.netIncome)}
        </span>
      </header>
      <div class="overflow-x-auto">
        <table class="w-full text-xs tabular-nums">
          <thead>
            <tr class="text-muted-foreground border-b">
              <th class="text-left font-normal py-2 pr-2 sticky left-0 bg-card">科目</th>
              {#each Array(12) as _, i (i)}
                <th class="text-right font-normal px-2">{i + 1}月</th>
              {/each}
              <th class="text-right font-medium px-2">計</th>
            </tr>
          </thead>
          <tbody>
            {#if monthlyPL.revenue.length > 0}
              <tr class="text-muted-foreground bg-muted/30">
                <td class="py-1 pr-2 sticky left-0 bg-card">収益</td>
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
                <td class="py-1 pr-2 sticky left-0 bg-card">収益計</td>
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
                <td class="py-1 pr-2 sticky left-0 bg-card">経費</td>
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
                <td class="py-1 pr-2 sticky left-0 bg-card">経費計</td>
                {#each monthlyPL.monthlyExpenseTotals as v, i (i)}
                  <td class="text-right px-2" class:text-muted-foreground={v === '0'}>
                    {v === '0' ? '' : formatJPY(v)}
                  </td>
                {/each}
                <td class="text-right px-2">{formatJPY(monthlyPL.totalExpense)}</td>
              </tr>
            {/if}
            <tr class="font-semibold border-t-2">
              <td class="py-1 pr-2 sticky left-0 bg-card">純利益</td>
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
        <h3 class="text-lg font-semibold">明細集計</h3>
        <div class="flex gap-1 text-xs">
          <button
            type="button"
            onclick={() => (breakdownAxis = 'vendor')}
            class="px-3 py-1 border rounded"
            class:bg-primary={breakdownAxis === 'vendor'}
            class:text-primary-foreground={breakdownAxis === 'vendor'}
            class:hover:bg-accent={breakdownAxis !== 'vendor'}
          >
            取引先別
          </button>
          <button
            type="button"
            onclick={() => (breakdownAxis = 'subAccount')}
            class="px-3 py-1 border rounded"
            class:bg-primary={breakdownAxis === 'subAccount'}
            class:text-primary-foreground={breakdownAxis === 'subAccount'}
            class:hover:bg-accent={breakdownAxis !== 'subAccount'}
          >
            補助科目別
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
                  <span class="text-xs text-muted-foreground tabular-nums">{e.count} 件</span>
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
        <h3 class="text-lg font-semibold">修正申告ガイド</h3>
        <span class="text-xs text-muted-foreground">
          申告日：{new Date(a.filedAt).toISOString().slice(0, 10)}
        </span>
      </header>
      {#if !a.hasChange}
        <p class="text-sm text-muted-foreground">
          申告時のスナップショットと現在の集計に差分はありません。修正申告は不要です。
        </p>
      {:else}
        <p class="text-sm text-amber-600">
          ⚠ 申告後に仕訳が変更されています。修正申告（amended return）の対象です。
        </p>
        <div class="grid grid-cols-3 gap-4 text-sm tabular-nums border rounded p-3">
          <div>
            <div class="text-xs text-muted-foreground">収益</div>
            <div>申告時：{formatJPY(a.filedTotalRevenue)}</div>
            <div class="font-medium">現在：{formatJPY(a.currentTotalRevenue)}</div>
          </div>
          <div>
            <div class="text-xs text-muted-foreground">経費</div>
            <div>申告時：{formatJPY(a.filedTotalExpense)}</div>
            <div class="font-medium">現在：{formatJPY(a.currentTotalExpense)}</div>
          </div>
          <div>
            <div class="text-xs text-muted-foreground">所得（純利益）</div>
            <div>申告時：{formatJPY(a.filedNetIncome)}</div>
            <div class="font-medium" class:text-destructive={D(a.netIncomeDelta).isNegative()}>
              現在：{formatJPY(a.currentNetIncome)}（差 {formatJPY(a.netIncomeDelta)}）
            </div>
          </div>
        </div>
        <ol class="space-y-2 text-sm list-decimal list-inside pt-2">
          {#each amendmentChecklist(year) as item (item.key)}
            <li>
              <span class="font-medium">{item.label}</span>
              <p class="text-xs text-muted-foreground pl-5">{item.detail}</p>
            </li>
          {/each}
        </ol>
      {/if}
    </section>
  {/if}

  {#if monthly && pl && bs && pl.entryCount > 0}
    <section class="bg-card text-card-foreground rounded-xl p-6 space-y-3 shadow-sm">
      <h3 class="text-lg font-semibold">e-Tax 出力</h3>
      <p class="text-xs text-muted-foreground">
        当年度の決算データを <code class="text-foreground">.xtx</code> として書き出し、e-Taxソフト(WEB版) にインポートして送信できます。
        <strong class="text-foreground">⚠ 現在の .xtx 出力は仮形式で、国税庁公式 XSD との照合が未完了です。実申告には使用しないでください。</strong>
      </p>
      <button
        type="button"
        onclick={downloadXtx}
        class="px-4 py-2 border rounded hover:bg-accent"
      >
        .xtx をダウンロード
      </button>
    </section>
  {/if}
</div>

<AlertDialog.Root bind:open={confirmingLock}>
  <AlertDialog.Content>
    <AlertDialog.Header>
      <AlertDialog.Title>{year} 年を「申告済み」としてロックしますか？</AlertDialog.Title>
      <AlertDialog.Description>
        現在の損益計算書・月別売上のスナップショットを保存し、{year} 年内の仕訳を訂正できなくなります。e-Tax 送信後の操作を想定。後から「ロック解除」で取り消せます。
      </AlertDialog.Description>
    </AlertDialog.Header>
    <AlertDialog.Footer>
      <AlertDialog.Cancel>キャンセル</AlertDialog.Cancel>
      <AlertDialog.Action onclick={lockYear}>ロックする</AlertDialog.Action>
    </AlertDialog.Footer>
  </AlertDialog.Content>
</AlertDialog.Root>

<AlertDialog.Root bind:open={confirmingUnlock}>
  <AlertDialog.Content>
    <AlertDialog.Header>
      <AlertDialog.Title>申告ロックを解除しますか？</AlertDialog.Title>
      <AlertDialog.Description>
        {year} 年の申告済みフラグを削除し、再び訂正可能になります。修正申告対応の管理者操作向け。
      </AlertDialog.Description>
    </AlertDialog.Header>
    <AlertDialog.Footer>
      <AlertDialog.Cancel>キャンセル</AlertDialog.Cancel>
      <AlertDialog.Action
        onclick={unlock}
        class="bg-destructive text-destructive-foreground hover:bg-destructive/90"
      >
        ロック解除
      </AlertDialog.Action>
    </AlertDialog.Footer>
  </AlertDialog.Content>
</AlertDialog.Root>