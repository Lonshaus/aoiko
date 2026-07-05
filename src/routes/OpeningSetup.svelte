<script lang="ts">
  import { onMount } from 'svelte';
  import { router, link } from '../router.svelte';
  import { ledger } from '../stores/ledger.svelte';
  import { m } from '../paraglide/messages';
  import { formatJPY } from '../lib/decimal';
  import { todayISO } from '../lib/date';
  import { isSmallAssetEligible, smallAssetThreshold } from '../tax-schema/2026/limits';
  import {
    computeConvertedAssetBasis,
    generateOpeningEntries,
    type ExpenseAmortization,
    type OpeningCustomItem,
  } from '../domain/business-opening';
  import { getSetting } from '../lib/settings';
  import type { DepreciationMethod } from '../db/types';
  import type { FilingType } from '../tax-schema/2026/xtx';

  let businessStartDate = $state(todayISO());
  // 少額特例は青色申告限定（措法28の2）。
  let filingType = $state<FilingType>('blue');
  onMount(async () => {
    filingType = (await getSetting('filingType')) ?? 'blue';
  });

  interface ExpenseRow {
    name: string;
    amount: string;
  }
  let expenses = $state<ExpenseRow[]>([]);
  let expenseAmortization = $state<ExpenseAmortization>('immediate');
  let expenseName = $state('');
  let expenseAmount = $state('');

  function addExpense() {
    if (!expenseName.trim() || !expenseAmount) {
      return;
    }
    expenses.push({ name: expenseName.trim(), amount: expenseAmount });
    expenseName = '';
    expenseAmount = '';
  }
  function removeExpense(i: number) {
    expenses.splice(i, 1);
  }
  const expenseTotal = $derived(expenses.reduce((sum, e) => sum + (Number(e.amount) || 0), 0));

  interface ConvertedAssetRow {
    name: string;
    acquisitionDate: string;
    acquisitionCost: string;
    usefulLifeYears: number;
    accountCode: string;
    depreciationMethod: DepreciationMethod;
    applySmallAssetSpecial: boolean;
  }
  let convertedAssets = $state<ConvertedAssetRow[]>([]);
  let newAssetName = $state('');
  let newAssetAcqDate = $state('');
  let newAssetCost = $state('');
  let newAssetLife = $state(4);
  let newAssetAccount = $state('1510');

  function addConvertedAsset() {
    if (!newAssetName.trim() || !newAssetAcqDate || !newAssetCost) {
      return;
    }
    convertedAssets.push({
      name: newAssetName.trim(),
      acquisitionDate: newAssetAcqDate,
      acquisitionCost: newAssetCost,
      usefulLifeYears: newAssetLife,
      accountCode: newAssetAccount,
      depreciationMethod: 'straight-line',
      applySmallAssetSpecial: false,
    });
    newAssetName = '';
    newAssetAcqDate = '';
    newAssetCost = '';
  }
  function removeConvertedAsset(i: number) {
    convertedAssets.splice(i, 1);
  }
  function assetBasis(row: ConvertedAssetRow) {
    if (!row.acquisitionDate || !businessStartDate || !row.acquisitionCost) {
      return null;
    }
    try {
      return computeConvertedAssetBasis(
        row.acquisitionDate,
        businessStartDate,
        row.acquisitionCost,
        row.usefulLifeYears
      );
    } catch {
      return null;
    }
  }
  function toggleSmallAssetSpecial(row: ConvertedAssetRow) {
    row.applySmallAssetSpecial = !row.applySmallAssetSpecial;
    row.depreciationMethod = row.applySmallAssetSpecial ? 'small-asset-special' : 'straight-line';
  }

  let showInventory = $state(false);
  let showDeposit = $state(false);
  interface CustomRow {
    name: string;
    amount: string;
    accountCode: string;
    side: 'debit' | 'credit';
  }
  let customItems = $state<CustomRow[]>([]);
  let customName = $state('');
  let customAmount = $state('');
  let customAccount = $state('');
  let customSide = $state<'debit' | 'credit'>('debit');

  function addCustomItem() {
    if (!customName.trim() || !customAmount || !customAccount) {
      return;
    }
    customItems.push({
      name: customName.trim(),
      amount: customAmount,
      accountCode: customAccount,
      side: customSide,
    });
    customName = '';
    customAmount = '';
    customAccount = '';
  }
  function removeCustomItem(i: number) {
    customItems.splice(i, 1);
  }

  let step = $state<'form' | 'preview' | 'done'>('form');
  let generating = $state(false);
  let error = $state('');

  const hasAnyItem = $derived(
    expenses.length > 0 || convertedAssets.length > 0 || customItems.length > 0
  );

  async function handleGenerate() {
    generating = true;
    error = '';
    try {
      const items: OpeningCustomItem[] = customItems.map((c) => ({
        name: c.name,
        amount: c.amount,
        accountCode: c.accountCode,
        side: c.side,
      }));
      await generateOpeningEntries({
        businessStartDate,
        expenses,
        expenseAmortization,
        convertedAssets: convertedAssets.map((a) => ({
          name: a.name,
          acquisitionDate: a.acquisitionDate,
          acquisitionCost: a.acquisitionCost,
          usefulLifeYears: a.usefulLifeYears,
          accountCode: a.accountCode,
          depreciationMethod: a.depreciationMethod,
        })),
        customItems: items,
      });
      step = 'done';
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      generating = false;
    }
  }
</script>

<div class="space-y-6">
  <div class="flex items-center justify-between">
    <h2 class="text-xl font-semibold">{m.opening_title()}</h2>
    <a href="/settings" use:link class="text-sm text-muted-foreground hover:text-foreground">
      {m.nav_settings()}
    </a>
  </div>
  <p class="text-sm text-muted-foreground">{m.opening_intro()}</p>

  {#if step === 'form'}
    <section class="space-y-2 border rounded-lg p-6 bg-card text-card-foreground">
      <h3 class="text-lg font-semibold">{m.opening_start_date_title()}</h3>
      <input
        type="date"
        bind:value={businessStartDate}
        class="px-3 py-2 bg-background border rounded text-foreground text-sm tabular-nums"
      />
    </section>

    <section class="space-y-3 border rounded-lg p-6 bg-card text-card-foreground">
      <h3 class="text-lg font-semibold">{m.opening_expense_title()}</h3>
      <p class="text-xs text-muted-foreground">{m.opening_expense_intro()}</p>
      <form
        onsubmit={(e) => {
          e.preventDefault();
          addExpense();
        }}
        class="flex flex-wrap gap-2 items-center"
      >
        <input
          type="text"
          bind:value={expenseName}
          placeholder={m.opening_expense_name_placeholder()}
          class="flex-1 min-w-40 px-3 py-2 bg-background border rounded text-foreground text-sm"
        />
        <input
          type="number"
          bind:value={expenseAmount}
          min="0"
          step="1"
          placeholder={m.opening_amount_placeholder()}
          class="w-32 px-3 py-2 bg-background border rounded text-foreground text-sm tabular-nums text-right"
        />
        <button type="submit" class="px-4 py-2 bg-primary text-primary-foreground rounded hover:opacity-90">
          {m.settings_action_add()}
        </button>
      </form>
      {#if expenses.length > 0}
        <ul class="text-sm divide-y divide-border/50">
          {#each expenses as ex, i}
            <li class="flex items-center justify-between py-1.5">
              <span>{ex.name}</span>
              <span class="flex items-center gap-3">
                <span class="font-mono">{formatJPY(ex.amount)}</span>
                <button
                  type="button"
                  onclick={() => removeExpense(i)}
                  class="text-xs text-destructive hover:underline"
                >
                  {m.settings_action_delete()}
                </button>
              </span>
            </li>
          {/each}
        </ul>
        <p class="text-sm font-semibold text-right">{m.opening_expense_total({ amount: formatJPY(String(expenseTotal)) })}</p>
        <div class="flex gap-4 text-sm">
          <label class="flex items-center gap-1">
            <input type="radio" bind:group={expenseAmortization} value="immediate" />
            {m.opening_expense_amortize_immediate()}
          </label>
          <label class="flex items-center gap-1">
            <input type="radio" bind:group={expenseAmortization} value="five-year" />
            {m.opening_expense_amortize_five_year()}
          </label>
        </div>
      {/if}
    </section>

    <section class="space-y-3 border rounded-lg p-6 bg-card text-card-foreground">
      <h3 class="text-lg font-semibold">{m.opening_converted_title()}</h3>
      <p class="text-xs text-muted-foreground">{m.opening_converted_intro()}</p>
      <form
        onsubmit={(e) => {
          e.preventDefault();
          addConvertedAsset();
        }}
        class="space-y-2"
      >
        <input
          type="text"
          bind:value={newAssetName}
          placeholder={m.settings_asset_name_placeholder()}
          class="w-full px-3 py-2 bg-background border rounded text-foreground text-sm"
        />
        <div class="flex flex-wrap gap-2 items-center">
          <input
            type="date"
            bind:value={newAssetAcqDate}
            title={m.opening_converted_acq_date_title()}
            class="px-3 py-2 bg-background border rounded text-foreground text-sm tabular-nums"
          />
          <input
            type="number"
            bind:value={newAssetCost}
            min="0"
            step="1"
            placeholder={m.settings_asset_cost_placeholder()}
            class="flex-1 min-w-40 px-3 py-2 bg-background border rounded text-foreground text-sm tabular-nums text-right"
          />
          <input
            type="number"
            bind:value={newAssetLife}
            min="1"
            max="50"
            step="1"
            title={m.settings_asset_life_title()}
            class="w-20 px-3 py-2 bg-background border rounded text-foreground text-sm tabular-nums"
          />
          <select
            bind:value={newAssetAccount}
            title={m.settings_asset_account_title()}
            class="px-3 py-2 bg-background border rounded text-foreground text-sm"
          >
            <option value="1510">1510 工具器具備品</option>
            <option value="1540">1540 車両運搬具</option>
            <option value="1550">1550 建物附属設備</option>
          </select>
          <button type="submit" class="ml-auto px-4 py-2 bg-primary text-primary-foreground rounded hover:opacity-90">
            {m.settings_action_add()}
          </button>
        </div>
      </form>
      {#if convertedAssets.length > 0}
        <ul class="space-y-3">
          {#each convertedAssets as row, i}
            {@const basis = assetBasis(row)}
            <li class="border rounded p-3 text-sm space-y-1">
              <div class="flex items-center justify-between">
                <span class="font-medium">{row.name}</span>
                <button
                  type="button"
                  onclick={() => removeConvertedAsset(i)}
                  class="text-xs text-destructive hover:underline"
                >
                  {m.settings_action_delete()}
                </button>
              </div>
              {#if basis}
                <p class="text-muted-foreground">
                  {m.opening_converted_basis_result({
                    nonBusiness: formatJPY(basis.nonBusinessDepreciation.toString()),
                    basis: formatJPY(basis.businessStartBasis.toString()),
                  })}
                </p>
                {#if filingType === 'blue'}
                  <label class="flex items-start gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={row.applySmallAssetSpecial}
                      onchange={() => toggleSmallAssetSpecial(row)}
                    />
                    <span>
                      {m.opening_small_asset_apply_label()}
                      {#if isSmallAssetEligible(businessStartDate, basis.businessStartBasis.toString())}
                        <span class="text-muted-foreground">
                          {m.opening_small_asset_threshold_note({ threshold: formatJPY(String(smallAssetThreshold(row.acquisitionDate))) })}
                        </span>
                      {/if}
                    </span>
                  </label>
                  <p class="text-xs text-amber-600">{m.opening_gray_area_warning()}</p>
                {/if}
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
    </section>

    <section class="border rounded-lg p-6 bg-card text-card-foreground">
      <button type="button" class="text-sm font-semibold" onclick={() => (showInventory = !showInventory)}>
        {showInventory ? '▾' : '▸'} {m.opening_inventory_title()}
      </button>
      {#if showInventory}
        <p class="text-xs text-muted-foreground mt-2">{m.opening_inventory_hint()}</p>
      {/if}
    </section>

    <section class="border rounded-lg p-6 bg-card text-card-foreground">
      <button type="button" class="text-sm font-semibold" onclick={() => (showDeposit = !showDeposit)}>
        {showDeposit ? '▾' : '▸'} {m.opening_deposit_title()}
      </button>
      {#if showDeposit}
        <p class="text-xs text-muted-foreground mt-2">{m.opening_deposit_hint()}</p>
      {/if}
    </section>

    <section class="space-y-3 border rounded-lg p-6 bg-card text-card-foreground">
      <h3 class="text-lg font-semibold">{m.opening_custom_title()}</h3>
      <form
        onsubmit={(e) => {
          e.preventDefault();
          addCustomItem();
        }}
        class="flex flex-wrap gap-2 items-center"
      >
        <input
          type="text"
          bind:value={customName}
          placeholder={m.opening_custom_name_placeholder()}
          class="flex-1 min-w-32 px-3 py-2 bg-background border rounded text-foreground text-sm"
        />
        <select
          bind:value={customAccount}
          class="px-3 py-2 bg-background border rounded text-foreground text-sm"
        >
          <option value="">{m.opening_custom_account_placeholder()}</option>
          {#each ledger.allAccounts as a (a.code)}
            <option value={a.code}>{a.code} {a.name}</option>
          {/each}
        </select>
        <select bind:value={customSide} class="px-3 py-2 bg-background border rounded text-foreground text-sm">
          <option value="debit">{m.opening_custom_side_debit()}</option>
          <option value="credit">{m.opening_custom_side_credit()}</option>
        </select>
        <input
          type="number"
          bind:value={customAmount}
          min="0"
          step="1"
          placeholder={m.opening_amount_placeholder()}
          class="w-32 px-3 py-2 bg-background border rounded text-foreground text-sm tabular-nums text-right"
        />
        <button type="submit" class="px-4 py-2 bg-primary text-primary-foreground rounded hover:opacity-90">
          {m.settings_action_add()}
        </button>
      </form>
      {#if customItems.length > 0}
        <ul class="text-sm divide-y divide-border/50">
          {#each customItems as c, i}
            <li class="flex items-center justify-between py-1.5">
              <span>{c.name}（{c.accountCode}）</span>
              <span class="flex items-center gap-3">
                <span class="font-mono">{formatJPY(c.amount)}</span>
                <button
                  type="button"
                  onclick={() => removeCustomItem(i)}
                  class="text-xs text-destructive hover:underline"
                >
                  {m.settings_action_delete()}
                </button>
              </span>
            </li>
          {/each}
        </ul>
      {/if}
    </section>

    <div class="flex justify-end">
      <button
        type="button"
        disabled={!hasAnyItem}
        onclick={() => (step = 'preview')}
        class="px-6 py-2 bg-primary text-primary-foreground rounded hover:opacity-90 disabled:opacity-50"
      >
        {m.opening_action_preview()}
      </button>
    </div>
  {:else if step === 'preview'}
    <section class="space-y-3 border rounded-lg p-6 bg-card text-card-foreground">
      <h3 class="text-lg font-semibold">{m.opening_preview_title()}</h3>
      {#if expenses.length > 0}
        <p class="text-sm">{m.opening_preview_expense({ amount: formatJPY(String(expenseTotal)) })}</p>
      {/if}
      {#if convertedAssets.length > 0}
        <p class="text-sm">{m.opening_preview_assets({ count: convertedAssets.length })}</p>
      {/if}
      {#if customItems.length > 0}
        <p class="text-sm">{m.opening_preview_custom({ count: customItems.length })}</p>
      {/if}
      {#if error}
        <p class="text-sm text-destructive">{error}</p>
      {/if}
      <div class="flex justify-end gap-2">
        <button
          type="button"
          onclick={() => (step = 'form')}
          class="px-4 py-2 border rounded hover:bg-accent"
        >
          {m.opening_action_back()}
        </button>
        <button
          type="button"
          disabled={generating}
          onclick={handleGenerate}
          class="px-4 py-2 bg-primary text-primary-foreground rounded hover:opacity-90 disabled:opacity-50"
        >
          {m.opening_action_confirm()}
        </button>
      </div>
    </section>
  {:else}
    <section class="space-y-3 border rounded-lg p-6 bg-card text-card-foreground text-center">
      <p class="text-sm">{m.opening_done_message()}</p>
      <a href="/journal" use:link class="inline-block px-4 py-2 bg-primary text-primary-foreground rounded hover:opacity-90">
        {m.nav_journal()}
      </a>
    </section>
  {/if}
</div>