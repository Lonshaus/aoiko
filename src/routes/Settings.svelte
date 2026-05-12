<script lang="ts">
  import { onMount } from 'svelte';
  import { db } from '../db';
  import { newId } from '../lib/id';
  import { DISCLAIMER_VERSION, deleteSetting, getSetting, setSetting } from '../lib/settings';
  import { m } from '../paraglide/messages';
  import { getLocale, setLocale, locales, type Locale } from '../paraglide/runtime';
  import { ledger } from '../stores/ledger.svelte';
  import { parseBackupJson, restoreFromJson } from '../domain/restore';
  import {
    computeDepreciation,
    generateYearEndDepreciation,
  } from '../domain/depreciation';
  import {
    applyCarryover,
    computeCarryover,
    removeCarryover,
    type CarryoverPreview,
  } from '../domain/carryover';
  import { formatJPY } from '../lib/decimal';
  import BackupPanel from '../components/BackupPanel.svelte';
  import * as AlertDialog from '$lib/components/ui/alert-dialog';
  import type {
    Account,
    DepreciationMethod,
    FixedAsset,
    ParserRule,
    ParserRuleMatchType,
    SubAccount,
    Vendor,
    VendorEntityType,
  } from '../db/types';

  const INVOICE_NUMBER_PATTERN = '^T\\d{13}$';

  let currentLocale = $state<Locale>(getLocale());

  function onLocaleChange(e: Event) {
    const v = (e.currentTarget as HTMLSelectElement).value as Locale;
    currentLocale = v;
    // setLocale 既定で reload を伴う — 即座に UI 全体へ反映される
    setLocale(v);
  }

  function localeLabel(loc: Locale): string {
    if (loc === 'ja') {
      return m.language_ja();
    } else if (loc === 'zh-TW') {
      return m.language_zh_tw();
    } else {
      return m.language_en();
    }
  }

  let currentYear = $state(2026);
  let userBusinessName = $state('');
  let userInvoiceNumber = $state('');
  let basicSaved = $state(false);
  let confirmingClear = $state(false);
  let confirmingRestore = $state(false);
  let restorePayload = $state<ReturnType<typeof parseBackupJson> | null>(null);
  let restoreFileName = $state('');
  let restoreError = $state('');
  let restoreSuccess = $state('');

  let newSubParent = $state('');
  let newSubName = $state('');
  let subError = $state('');

  let newVendorName = $state('');
  let newVendorEntityType = $state<VendorEntityType>('unknown');
  let newVendorInvoice = $state('');
  let newVendorAccountCode = $state('');
  let vendorError = $state('');

  let newRuleMatchType = $state<ParserRuleMatchType>('description-includes');
  let newRulePattern = $state('');
  let newRuleAccountCode = $state('');
  let newRulePriority = $state(10);
  let ruleError = $state('');

  let newAssetName = $state('');
  let newAssetDate = $state(new Date().toISOString().slice(0, 10));
  let newAssetCost = $state('');
  let newAssetLife = $state(4);
  let newAssetAccount = $state('1510');
  let newAssetMethod = $state<DepreciationMethod>('straight-line');
  let assetError = $state('');
  let depreciationYear = $state(new Date().getFullYear());
  let depreciationStatus = $state('');

  let geminiKey = $state('');
  let geminiKeySaved = $state('');
  let geminiTestStatus = $state('');

  let carryoverPreview = $state<CarryoverPreview | null>(null);
  let carryoverStatus = $state('');
  let carryoverError = $state('');

  let disclaimerAcceptedAt = $state<number | null>(null);
  let disclaimerAcceptedVersion = $state<number | null>(null);

  const accountGroups = $derived(ledger.groupedAccounts());

  const subGroups = $derived.by(() => {
    const accountMap = new Map(ledger.accounts.map((a) => [a.code, a]));
    const groups = new Map<string, { account: Account; items: SubAccount[] }>();
    for (const sa of ledger.subAccounts) {
      const acc = accountMap.get(sa.accountCode);
      if (!acc) {
        continue;
      }
      const g = groups.get(sa.accountCode);
      if (g) {
        g.items.push(sa);
      } else {
        groups.set(sa.accountCode, { account: acc, items: [sa] });
      }
    }
    return Array.from(groups.values()).sort(
      (a, b) => a.account.displayOrder - b.account.displayOrder
    );
  });

  const allAccountGroups = $derived.by(() => {
    type G = { category: string; label: string; items: Account[] };
    const groups: G[] = [];
    const order: Account['category'][] = [
      'asset',
      'liability',
      'equity',
      'revenue',
      'expense',
    ];
    for (const key of order) {
      const items = ledger.allAccounts.filter((a) => a.category === key);
      if (items.length > 0) {
        groups.push({ category: key, label: categoryLabel(key), items });
      }
    }
    return groups;
  });

  onMount(async () => {
    currentYear = (await getSetting('currentYear')) ?? 2026;
    userBusinessName = (await getSetting('userBusinessName')) ?? '';
    userInvoiceNumber = (await getSetting('userInvoiceNumber')) ?? '';
    geminiKey = (await getSetting('geminiApiKey')) ?? '';
    disclaimerAcceptedAt = (await getSetting('disclaimerAcceptedAt')) ?? null;
    disclaimerAcceptedVersion = (await getSetting('disclaimerAcceptedVersion')) ?? null;
  });

  async function revokeDisclaimer() {
    await deleteSetting('disclaimerAcceptedAt');
    await deleteSetting('disclaimerAcceptedVersion');
    location.reload();
  }

  async function saveBasic(e: Event) {
    e.preventDefault();
    await setSetting('currentYear', currentYear);
    await setSetting('userBusinessName', userBusinessName);
    await setSetting('userInvoiceNumber', userInvoiceNumber);
    basicSaved = true;
    setTimeout(() => {
      basicSaved = false;
    }, 2000);
  }

  async function clearAll() {
    confirmingClear = false;
    await db.delete();
    location.reload();
  }

  async function previewCarryover() {
    carryoverError = '';
    carryoverStatus = '';
    try {
      carryoverPreview = await computeCarryover(currentYear);
    } catch (err) {
      carryoverError = err instanceof Error ? err.message : String(err);
    }
  }

  async function runCarryover() {
    carryoverError = '';
    carryoverStatus = '';
    try {
      const r = await applyCarryover(currentYear);
      if ('entryId' in r) {
        carryoverStatus = m.settings_carryover_applied();
        carryoverPreview = null;
      } else if (r.reason === 'already-exists') {
        carryoverError = m.settings_carryover_already_exists();
      } else {
        carryoverError = m.settings_carryover_no_prior();
      }
    } catch (err) {
      carryoverError = err instanceof Error ? err.message : String(err);
    }
  }

  async function deleteCarryover() {
    carryoverError = '';
    carryoverStatus = '';
    try {
      const r = await removeCarryover(currentYear);
      carryoverStatus = r.removed ? m.settings_carryover_deleted() : m.settings_carryover_no_target();
    } catch (err) {
      carryoverError = err instanceof Error ? err.message : String(err);
    }
  }

  async function addSubAccount(e: Event) {
    e.preventDefault();
    subError = '';
    const parent = newSubParent.trim();
    const name = newSubName.trim();
    if (!parent || !name) {
      subError = m.settings_subaccount_error_required();
      return;
    }
    const exists = ledger.subAccounts.some(
      (s) => s.accountCode === parent && s.name === name
    );
    if (exists) {
      subError = m.settings_subaccount_error_duplicate();
      return;
    }
    await db.subAccounts.add({ id: newId(), accountCode: parent, name });
    newSubName = '';
  }

  async function deleteSubAccount(id: string) {
    await db.subAccounts.delete(id);
  }

  async function toggleAccountActive(account: Account) {
    const next = account.isActive === false ? true : false;
    await db.accounts
      .where('[code+year]')
      .equals([account.code, account.year])
      .modify({ isActive: next });
  }

  async function addVendor(e: Event) {
    e.preventDefault();
    vendorError = '';
    const name = newVendorName.trim();
    if (!name) {
      vendorError = m.settings_vendor_error_required();
      return;
    }
    if (ledger.vendors.some((v) => v.name === name)) {
      vendorError = m.settings_vendor_error_duplicate();
      return;
    }
    const v: Vendor = {
      id: newId(),
      name,
      entityType: newVendorEntityType,
    };
    if (newVendorInvoice.trim()) {
      v.invoiceNumber = newVendorInvoice.trim();
    }
    if (newVendorAccountCode) {
      v.defaultAccountCode = newVendorAccountCode;
    }
    await db.vendors.add(v);
    newVendorName = '';
    newVendorInvoice = '';
    newVendorAccountCode = '';
    newVendorEntityType = 'unknown';
  }

  async function deleteVendor(id: string) {
    await db.vendors.delete(id);
  }

  async function addRule(e: Event) {
    e.preventDefault();
    ruleError = '';
    const pattern = newRulePattern.trim();
    if (!pattern || !newRuleAccountCode) {
      ruleError = m.settings_rule_error_required();
      return;
    }
    const rule: ParserRule = {
      id: newId(),
      matchType: newRuleMatchType,
      pattern,
      accountCode: newRuleAccountCode,
      priority: newRulePriority,
      hitCount: 0,
    };
    await db.parserRules.add(rule);
    newRulePattern = '';
    newRuleAccountCode = '';
    newRulePriority = 10;
  }

  async function deleteRule(id: string) {
    await db.parserRules.delete(id);
  }

  async function addAsset(e: Event) {
    e.preventDefault();
    assetError = '';
    if (!newAssetName.trim() || !newAssetCost.trim()) {
      assetError = m.settings_asset_error_required();
      return;
    }
    if (newAssetLife < 1) {
      assetError = m.settings_asset_error_life();
      return;
    }
    const a: FixedAsset = {
      id: newId(),
      name: newAssetName.trim(),
      acquisitionDate: newAssetDate,
      acquisitionCost: newAssetCost.trim(),
      usefulLifeYears: newAssetLife,
      depreciationMethod: newAssetMethod,
      accountCode: newAssetAccount,
    };
    await db.fixedAssets.add(a);
    newAssetName = '';
    newAssetCost = '';
    newAssetLife = 4;
  }

  async function deleteAsset(id: string) {
    await db.fixedAssets.delete(id);
  }

  async function runDepreciation() {
    depreciationStatus = '';
    try {
      const r = await generateYearEndDepreciation(depreciationYear);
      depreciationStatus = r.skipped > 0
        ? m.settings_asset_run_success_with_skipped({ created: r.created, skipped: r.skipped })
        : m.settings_asset_run_success({ created: r.created });
    } catch (e) {
      depreciationStatus = m.settings_asset_run_error({ message: e instanceof Error ? e.message : String(e) });
    }
  }

  function assetCurrentDepreciation(asset: FixedAsset): {
    amount: string;
    book: string;
  } {
    const r = computeDepreciation(asset, depreciationYear);
    return { amount: r.amount, book: r.bookValueEnd };
  }

  async function saveGeminiKey() {
    await setSetting('geminiApiKey', geminiKey.trim());
    geminiKeySaved = m.settings_llm_saved();
    setTimeout(() => {
      geminiKeySaved = '';
    }, 2000);
  }

  async function testGeminiKey() {
    geminiTestStatus = m.settings_llm_testing();
    try {
      const { GeminiAdapter } = await import('../domain/llm');
      const adapter = new GeminiAdapter(geminiKey.trim());
      await adapter.generateJson(
        '日本語で "ok" だけを JSON 形式 {"status":"ok"} で返してください。'
      );
      geminiTestStatus = m.settings_llm_test_success();
    } catch (e) {
      geminiTestStatus = m.settings_llm_test_error({ message: e instanceof Error ? e.message : String(e) });
    }
  }

  async function handleRestoreFile(e: Event) {
    restoreError = '';
    restoreSuccess = '';
    restorePayload = null;
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) {
      return;
    }
    restoreFileName = file.name;
    try {
      const text = await file.text();
      restorePayload = parseBackupJson(text);
    } catch (err) {
      restoreError = err instanceof Error ? err.message : String(err);
    }
  }

  async function confirmRestore() {
    if (!restorePayload) {
      return;
    }
    confirmingRestore = false;
    try {
      const result = await restoreFromJson(restorePayload);
      restoreSuccess = m.settings_restore_success({ tables: result.tableCount, rows: result.rowCount });
      restorePayload = null;
    } catch (err) {
      restoreError = err instanceof Error ? err.message : String(err);
    }
  }

  function vendorEntityLabel(t: VendorEntityType | undefined): string {
    if (!t || t === 'unknown') {
      return '—';
    }
    switch (t) {
      case 'corporation':
        return m.settings_vendor_entity_corporation();
      case 'individual':
        return m.settings_vendor_entity_individual();
      case 'public':
        return m.settings_vendor_entity_public();
      case 'foreign':
        return m.settings_vendor_entity_foreign();
    }
  }

  function matchTypeLabel(t: ParserRuleMatchType): string {
    switch (t) {
      case 'description-includes':
        return m.settings_rule_match_includes();
      case 'vendor-name':
        return m.settings_rule_match_vendor();
      case 'regex':
        return m.settings_rule_match_regex();
    }
  }

  function categoryLabel(key: Account['category']): string {
    switch (key) {
      case 'asset':
        return m.settings_account_category_asset();
      case 'liability':
        return m.settings_account_category_liability();
      case 'equity':
        return m.settings_account_category_equity();
      case 'revenue':
        return m.settings_account_category_revenue();
      case 'expense':
        return m.settings_account_category_expense();
    }
  }
</script>

<div class="space-y-8">
  <h2 class="text-2xl font-bold">{m.settings_title()}</h2>

  <section class="space-y-4 border rounded-lg p-6 bg-card text-card-foreground">
    <h3 class="text-lg font-semibold">{m.language_label()}</h3>
    <p class="text-xs text-muted-foreground">
      {m.settings_language_hint()}
    </p>
    <label class="block sm:max-w-xs">
      <select
        value={currentLocale}
        onchange={onLocaleChange}
        class="mt-1 w-full px-3 py-2 bg-background border rounded text-foreground"
      >
        {#each locales as loc (loc)}
          <option value={loc}>{localeLabel(loc)}</option>
        {/each}
      </select>
    </label>
  </section>

  <form
    onsubmit={saveBasic}
    class="space-y-4 border rounded-lg p-6 bg-card text-card-foreground"
  >
    <h3 class="text-lg font-semibold">{m.settings_basic_title()}</h3>
    <p class="text-xs text-muted-foreground">
      {@html m.settings_basic_intro_html()}
    </p>
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <label class="block sm:col-span-2">
        <span class="text-xs text-muted-foreground">{m.settings_basic_business_name()}</span>
        <input
          type="text"
          bind:value={userBusinessName}
          placeholder={m.settings_basic_business_name_placeholder()}
          class="mt-1 w-full px-3 py-2 bg-background border rounded text-foreground"
        />
      </label>
      <label class="block">
        <span class="text-xs text-muted-foreground">{m.settings_basic_invoice_number()}</span>
        <input
          type="text"
          bind:value={userInvoiceNumber}
          placeholder="T1234567890123"
          pattern={INVOICE_NUMBER_PATTERN}
          class="mt-1 w-full px-3 py-2 bg-background border rounded text-foreground font-mono"
        />
      </label>
      <label class="block">
        <span class="text-xs text-muted-foreground">{m.settings_basic_year()}</span>
        <input
          type="number"
          bind:value={currentYear}
          min="2020"
          max="2099"
          step="1"
          class="mt-1 w-full px-3 py-2 bg-background border rounded text-foreground"
        />
      </label>
    </div>
    <div class="flex justify-end">
      <button
        type="submit"
        class="px-4 py-2 bg-primary text-primary-foreground rounded hover:opacity-90"
      >
        {basicSaved ? m.settings_basic_saved() : m.settings_basic_save()}
      </button>
    </div>
  </form>

  <section class="space-y-4 border rounded-lg p-6 bg-card text-card-foreground">
    <h3 class="text-lg font-semibold">{m.settings_carryover_title()}</h3>
    <p class="text-xs text-muted-foreground">
      {@html m.settings_carryover_intro_html({ year: currentYear })}
    </p>
    <div class="flex flex-wrap gap-2">
      <button
        type="button"
        onclick={previewCarryover}
        class="px-4 py-2 border rounded hover:bg-accent"
      >
        {m.settings_carryover_preview_button()}
      </button>
      <button
        type="button"
        onclick={runCarryover}
        class="px-4 py-2 bg-primary text-primary-foreground rounded hover:opacity-90"
      >
        {m.settings_carryover_apply_button()}
      </button>
      <button
        type="button"
        onclick={deleteCarryover}
        class="px-4 py-2 border rounded text-destructive hover:bg-destructive/10"
      >
        {m.settings_carryover_delete_button()}
      </button>
    </div>
    {#if carryoverStatus}
      <p class="text-sm text-green-600">{carryoverStatus}</p>
    {/if}
    {#if carryoverError}
      <p class="text-sm text-destructive">{carryoverError}</p>
    {/if}
    {#if carryoverPreview}
      {@const p = carryoverPreview}
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm pt-2">
        <div>
          <h4 class="font-medium mb-1">{m.settings_carryover_assets_label()}</h4>
          {#if p.assets.length === 0}
            <p class="text-muted-foreground text-xs">{m.settings_carryover_none()}</p>
          {:else}
            <ul class="space-y-1">
              {#each p.assets as a (a.accountCode)}
                <li class="flex justify-between">
                  <span>{a.accountCode} {a.accountName}</span>
                  <span class="font-mono">{formatJPY(a.amount)}</span>
                </li>
              {/each}
            </ul>
          {/if}
        </div>
        <div>
          <h4 class="font-medium mb-1">{m.settings_carryover_liabilities_label()}</h4>
          {#if p.liabilities.length === 0 && p.capitalAmount === '0'}
            <p class="text-muted-foreground text-xs">{m.settings_carryover_none()}</p>
          {:else}
            <ul class="space-y-1">
              {#each p.liabilities as l (l.accountCode)}
                <li class="flex justify-between">
                  <span>{l.accountCode} {l.accountName}</span>
                  <span class="font-mono">{formatJPY(l.amount)}</span>
                </li>
              {/each}
              <li class="flex justify-between border-t pt-1">
                <span>{p.capitalCode} {m.settings_carryover_capital_label()}</span>
                <span class="font-mono">{formatJPY(p.capitalAmount)}</span>
              </li>
            </ul>
          {/if}
        </div>
      </div>
      <div class="text-xs text-muted-foreground border-t pt-2 space-y-0.5">
        <p>{m.settings_carryover_prior_net_income()}：<span class="font-mono">{formatJPY(p.priorNetIncome)}</span></p>
        <p>{m.settings_carryover_prior_capital()}：<span class="font-mono">{formatJPY(p.priorEndingCapital)}</span></p>
        <p>{m.settings_carryover_prior_owner_movements({ withdrawals: formatJPY(p.priorOwnerWithdrawals), contributions: formatJPY(p.priorOwnerContributions) })}</p>
      </div>
    {/if}
  </section>

  <section class="space-y-4 border rounded-lg p-6 bg-card text-card-foreground">
    <h3 class="text-lg font-semibold">{m.settings_subaccount_title()}</h3>
    <p class="text-xs text-muted-foreground">
      {m.settings_subaccount_intro()}
    </p>
    <form onsubmit={addSubAccount} class="flex flex-wrap gap-3 items-center">
      <select
        bind:value={newSubParent}
        required
        class="flex-1 min-w-40 px-3 py-2 bg-background border rounded text-foreground"
      >
        <option value="">{m.settings_subaccount_parent_select()}</option>
        {#each accountGroups as group (group.category)}
          <optgroup label={group.label}>
            {#each group.items as a (a.code)}
              <option value={a.code}>{a.code} {a.name}</option>
            {/each}
          </optgroup>
        {/each}
      </select>
      <input
        type="text"
        bind:value={newSubName}
        required
        placeholder={m.settings_subaccount_name_placeholder()}
        class="flex-1 min-w-40 px-3 py-2 bg-background border rounded text-foreground"
      />
      <button
        type="submit"
        class="ml-auto px-4 py-2 bg-primary text-primary-foreground rounded hover:opacity-90"
      >
        {m.settings_action_add()}
      </button>
    </form>
    {#if subError}
      <div class="text-sm text-destructive">{subError}</div>
    {/if}
    {#if subGroups.length > 0}
      <ul class="space-y-3">
        {#each subGroups as group (group.account.code)}
          <li class="space-y-1">
            <div class="text-xs text-muted-foreground">
              <span class="font-mono">{group.account.code}</span> {group.account.name}
            </div>
            <ul class="space-y-1">
              {#each group.items as sa (sa.id)}
                <li class="flex items-center justify-between border rounded px-3 py-2 bg-background">
                  <span>{sa.name}</span>
                  <button
                    type="button"
                    onclick={() => deleteSubAccount(sa.id)}
                    class="text-xs text-muted-foreground hover:text-destructive"
                  >
                    {m.settings_action_delete()}
                  </button>
                </li>
              {/each}
            </ul>
          </li>
        {/each}
      </ul>
    {:else}
      <p class="text-sm text-muted-foreground">{m.settings_subaccount_empty()}</p>
    {/if}
  </section>

  <section class="space-y-4 border rounded-lg p-6 bg-card text-card-foreground">
    <h3 class="text-lg font-semibold">{m.settings_vendor_title()}</h3>
    <p class="text-xs text-muted-foreground">
      {m.settings_vendor_intro()}
    </p>
    <form onsubmit={addVendor} class="flex flex-wrap gap-3 items-center">
      <input
        type="text"
        bind:value={newVendorName}
        required
        placeholder={m.settings_vendor_name_placeholder()}
        class="flex-1 min-w-40 px-3 py-2 bg-background border rounded text-foreground"
      />
      <select
        bind:value={newVendorEntityType}
        class="px-3 py-2 bg-background border rounded text-foreground"
      >
        <option value="unknown">{m.settings_vendor_entity_label()}</option>
        <option value="corporation">{m.settings_vendor_entity_corporation()}</option>
        <option value="individual">{m.settings_vendor_entity_individual()}</option>
        <option value="public">{m.settings_vendor_entity_public()}</option>
        <option value="foreign">{m.settings_vendor_entity_foreign()}</option>
      </select>
      <input
        type="text"
        bind:value={newVendorInvoice}
        placeholder={m.settings_vendor_invoice_placeholder()}
        pattern={INVOICE_NUMBER_PATTERN}
        class="flex-1 min-w-48 px-3 py-2 bg-background border rounded text-foreground font-mono text-sm"
      />
      <select
        bind:value={newVendorAccountCode}
        class="flex-1 min-w-40 px-3 py-2 bg-background border rounded text-foreground"
      >
        <option value="">{m.settings_vendor_default_account()}</option>
        {#each accountGroups as group (group.category)}
          <optgroup label={group.label}>
            {#each group.items as a (a.code)}
              <option value={a.code}>{a.code} {a.name}</option>
            {/each}
          </optgroup>
        {/each}
      </select>
      <button
        type="submit"
        class="ml-auto px-4 py-2 bg-primary text-primary-foreground rounded hover:opacity-90"
      >
        {m.settings_action_add()}
      </button>
    </form>
    {#if vendorError}
      <div class="text-sm text-destructive">{vendorError}</div>
    {/if}
    {#if ledger.vendors.length > 0}
      <ul class="space-y-1">
        {#each ledger.vendors as v (v.id)}
          <li class="flex flex-wrap gap-3 items-center border rounded px-3 py-2 bg-background text-sm">
            <span class="flex-1 min-w-40 break-all">
              {v.name}
              <span class="text-xs text-muted-foreground ml-2">{vendorEntityLabel(v.entityType)}</span>
            </span>
            <span class="font-mono text-xs text-muted-foreground">{v.invoiceNumber ?? ''}</span>
            <span class="text-xs text-muted-foreground">
              {v.defaultAccountCode ?? ''}
            </span>
            <div class="ml-auto flex gap-2">
              {#if v.invoiceNumber}
                <a
                  href={`https://www.invoice-kohyo.nta.go.jp/regno-search/list?selRegNo=${v.invoiceNumber.replace(/^T/, '')}`}
                  target="_blank"
                  rel="noreferrer noopener"
                  class="text-xs text-primary hover:underline"
                >
                  {m.settings_vendor_official_site()}
                </a>
              {/if}
              <button
                type="button"
                onclick={() => deleteVendor(v.id)}
                class="text-xs text-muted-foreground hover:text-destructive"
              >
                {m.settings_action_delete()}
              </button>
            </div>
          </li>
        {/each}
      </ul>
    {:else}
      <p class="text-sm text-muted-foreground">{m.settings_vendor_empty()}</p>
    {/if}
  </section>

  <section class="space-y-4 border rounded-lg p-6 bg-card text-card-foreground">
    <h3 class="text-lg font-semibold">{m.settings_asset_title()}</h3>
    <p class="text-xs text-muted-foreground">
      {m.settings_asset_intro()}
    </p>

    <form onsubmit={addAsset} class="space-y-2">
      <input
        type="text"
        bind:value={newAssetName}
        required
        placeholder={m.settings_asset_name_placeholder()}
        class="w-full px-3 py-2 bg-background border rounded text-foreground text-sm"
      />
      <div class="flex flex-wrap gap-2 items-center">
        <input
          type="date"
          bind:value={newAssetDate}
          required
          title={m.settings_asset_date_title()}
          class="px-3 py-2 bg-background border rounded text-foreground text-sm tabular-nums"
        />
        <input
          type="number"
          bind:value={newAssetCost}
          required
          min="0"
          step="1"
          placeholder={m.settings_asset_cost_placeholder()}
          class="flex-1 min-w-40 px-3 py-2 bg-background border rounded text-foreground text-sm tabular-nums text-right"
        />
        <input
          type="number"
          bind:value={newAssetLife}
          required
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
        <select
          bind:value={newAssetMethod}
          title={m.settings_asset_method_title()}
          class="px-3 py-2 bg-background border rounded text-foreground text-sm"
        >
          <option value="straight-line">{m.settings_asset_method_straight()}</option>
          <option value="declining-balance">{m.settings_asset_method_declining()}</option>
        </select>
        <button
          type="submit"
          class="ml-auto px-4 py-2 bg-primary text-primary-foreground rounded hover:opacity-90"
        >
          {m.settings_action_add()}
        </button>
      </div>
    </form>
    {#if assetError}
      <div class="text-sm text-destructive">{assetError}</div>
    {/if}

    {#if ledger.fixedAssets.length > 0}
      <table class="w-full text-sm">
        <thead>
          <tr class="text-xs text-muted-foreground">
            <th class="text-left font-normal py-1">{m.settings_asset_th_name()}</th>
            <th class="text-left font-normal py-1">{m.settings_asset_th_date()}</th>
            <th class="text-right font-normal py-1">{m.settings_asset_th_cost()}</th>
            <th class="text-right font-normal py-1">{m.settings_asset_th_life()}</th>
            <th class="text-right font-normal py-1">{m.settings_asset_th_year_depreciation()}</th>
            <th class="text-right font-normal py-1">{m.settings_asset_th_book_value()}</th>
            <th class="py-1"></th>
          </tr>
        </thead>
        <tbody>
          {#each ledger.fixedAssets as a (a.id)}
            {@const d = assetCurrentDepreciation(a)}
            <tr class="border-t border-border/50">
              <td class="py-2">{a.name}</td>
              <td class="py-2 tabular-nums text-muted-foreground">{a.acquisitionDate}</td>
              <td class="py-2 text-right tabular-nums">{formatJPY(a.acquisitionCost)}</td>
              <td class="py-2 text-right tabular-nums">{m.settings_asset_life_years({ n: a.usefulLifeYears })}</td>
              <td class="py-2 text-right tabular-nums">{formatJPY(d.amount)}</td>
              <td class="py-2 text-right tabular-nums text-muted-foreground">{formatJPY(d.book)}</td>
              <td class="py-2 text-right">
                <button
                  type="button"
                  onclick={() => deleteAsset(a.id)}
                  class="text-xs text-muted-foreground hover:text-destructive"
                >
                  {m.settings_action_delete()}
                </button>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    {:else}
      <p class="text-sm text-muted-foreground">{m.settings_asset_empty()}</p>
    {/if}

    <div class="flex items-end gap-3 pt-3 border-t border-border/50">
      <label class="block">
        <span class="text-xs text-muted-foreground">{m.settings_asset_target_year()}</span>
        <input
          type="number"
          bind:value={depreciationYear}
          min="2020"
          max="2099"
          step="1"
          class="mt-1 w-24 px-3 py-2 bg-background border rounded text-foreground tabular-nums text-sm"
        />
      </label>
      <button
        type="button"
        onclick={runDepreciation}
        disabled={ledger.fixedAssets.length === 0}
        class="px-4 py-2 bg-primary text-primary-foreground rounded hover:opacity-90 disabled:opacity-50"
      >
        {m.settings_asset_run_button()}
      </button>
      {#if depreciationStatus}
        <span class="text-sm">{depreciationStatus}</span>
      {/if}
    </div>
  </section>

  <section class="space-y-4 border rounded-lg p-6 bg-card text-card-foreground">
    <h3 class="text-lg font-semibold">{m.settings_rule_title()}</h3>
    <p class="text-xs text-muted-foreground">
      {m.settings_rule_intro()}
    </p>
    <form onsubmit={addRule} class="flex flex-wrap gap-3 items-center">
      <select
        bind:value={newRuleMatchType}
        class="px-3 py-2 bg-background border rounded text-foreground"
      >
        <option value="description-includes">{m.settings_rule_match_includes()}</option>
        <option value="vendor-name">{m.settings_rule_match_vendor()}</option>
        <option value="regex">{m.settings_rule_match_regex()}</option>
      </select>
      <input
        type="text"
        bind:value={newRulePattern}
        required
        placeholder={m.settings_rule_pattern_placeholder()}
        class="flex-1 min-w-40 px-3 py-2 bg-background border rounded text-foreground"
      />
      <select
        bind:value={newRuleAccountCode}
        required
        class="flex-1 min-w-40 px-3 py-2 bg-background border rounded text-foreground"
      >
        <option value="">{m.settings_rule_account_select()}</option>
        {#each accountGroups as group (group.category)}
          <optgroup label={group.label}>
            {#each group.items as a (a.code)}
              <option value={a.code}>{a.code} {a.name}</option>
            {/each}
          </optgroup>
        {/each}
      </select>
      <input
        type="number"
        bind:value={newRulePriority}
        min="0"
        step="1"
        title={m.settings_rule_priority_title()}
        class="w-20 px-3 py-2 bg-background border rounded text-foreground tabular-nums"
      />
      <button
        type="submit"
        class="ml-auto px-4 py-2 bg-primary text-primary-foreground rounded hover:opacity-90"
      >
        {m.settings_action_add()}
      </button>
    </form>
    {#if ruleError}
      <div class="text-sm text-destructive">{ruleError}</div>
    {/if}
    {#if ledger.parserRules.length > 0}
      <ul class="space-y-1">
        {#each ledger.parserRules as r (r.id)}
          <li class="flex flex-wrap gap-3 items-center border rounded px-3 py-2 bg-background text-sm">
            <span class="text-xs text-muted-foreground">{matchTypeLabel(r.matchType)}</span>
            <span class="font-mono flex-1 min-w-32 break-all">{r.pattern}</span>
            <span class="font-mono text-xs text-muted-foreground">→ {r.accountCode}</span>
            <span class="text-xs text-muted-foreground tabular-nums">{m.settings_rule_priority_short({ n: r.priority })}</span>
            <span class="text-xs text-muted-foreground tabular-nums">{m.settings_rule_hits({ n: r.hitCount })}</span>
            <button
              type="button"
              onclick={() => deleteRule(r.id)}
              class="ml-auto text-xs text-muted-foreground hover:text-destructive"
            >
              {m.settings_action_delete()}
            </button>
          </li>
        {/each}
      </ul>
    {:else}
      <p class="text-sm text-muted-foreground">{m.settings_rule_empty()}</p>
    {/if}
  </section>

  <section class="space-y-4 border rounded-lg p-6 bg-card text-card-foreground">
    <h3 class="text-lg font-semibold">{m.settings_account_title()}</h3>
    <p class="text-xs text-muted-foreground">
      {m.settings_account_intro()}
    </p>
    {#each allAccountGroups as group (group.category)}
      <details class="border rounded">
        <summary class="cursor-pointer px-3 py-2 text-sm font-medium">
          {group.label}
          <span class="text-xs text-muted-foreground ml-2">
            {m.settings_account_active_count({ active: group.items.filter((a) => a.isActive !== false).length, total: group.items.length })}
          </span>
        </summary>
        <ul class="border-t divide-y divide-border/50">
          {#each group.items as a (a.code)}
            <li class="flex items-center justify-between px-3 py-2 text-sm">
              <span>
                <span class="font-mono text-xs text-muted-foreground mr-2">{a.code}</span>
                <span class:line-through={a.isActive === false} class:opacity-50={a.isActive === false}>
                  {a.name}
                </span>
              </span>
              <label class="flex items-center gap-2 cursor-pointer text-xs">
                <input
                  type="checkbox"
                  checked={a.isActive !== false}
                  onchange={() => toggleAccountActive(a)}
                />
                {m.settings_account_active_label()}
              </label>
            </li>
          {/each}
        </ul>
      </details>
    {/each}
  </section>

  <section class="space-y-4 border rounded-lg p-6 bg-card text-card-foreground">
    <h3 class="text-lg font-semibold">{m.settings_llm_title()}</h3>
    <p class="text-xs text-muted-foreground">
      {@html m.settings_llm_intro_html()}
    </p>
    <div class="flex gap-3 items-end">
      <label class="block flex-1">
        <span class="text-xs text-muted-foreground">{m.settings_llm_key_label()}</span>
        <input
          type="password"
          bind:value={geminiKey}
          placeholder="AIza..."
          class="mt-1 w-full px-3 py-2 bg-background border rounded text-foreground font-mono text-sm"
        />
      </label>
      <button
        type="button"
        onclick={saveGeminiKey}
        class="px-4 py-2 bg-primary text-primary-foreground rounded hover:opacity-90"
      >
        {m.settings_llm_save()}
      </button>
      <button
        type="button"
        onclick={testGeminiKey}
        disabled={!geminiKey.trim()}
        class="px-4 py-2 border rounded hover:bg-accent disabled:opacity-50"
      >
        {m.settings_llm_test()}
      </button>
    </div>
    <div class="flex gap-3 text-xs">
      {#if geminiKeySaved}
        <span>{geminiKeySaved}</span>
      {/if}
      {#if geminiTestStatus}
        <span>{geminiTestStatus}</span>
      {/if}
    </div>
  </section>

  <BackupPanel />

  <section class="space-y-4 border rounded-lg p-6 bg-card text-card-foreground">
    <h3 class="text-lg font-semibold">{m.settings_restore_title()}</h3>
    <p class="text-xs text-muted-foreground">
      {@html m.settings_restore_intro_html()}
    </p>
    <input
      type="file"
      accept=".json,application/json"
      onchange={handleRestoreFile}
      class="w-full text-sm text-muted-foreground"
    />
    {#if restoreFileName}
      <p class="text-xs text-muted-foreground">{m.settings_restore_selected({ name: restoreFileName })}</p>
    {/if}
    {#if restoreError}
      <div class="text-sm text-destructive">{restoreError}</div>
    {/if}
    {#if restoreSuccess}
      <div class="text-sm text-foreground border border-primary bg-primary/10 rounded px-3 py-2">
        ✓ {restoreSuccess}
        <button
          type="button"
          onclick={() => location.reload()}
          class="ml-2 text-primary underline"
        >
          {m.settings_restore_reload()}
        </button>
      </div>
    {/if}
    {#if restorePayload}
      <div class="text-xs text-muted-foreground">
        {m.settings_restore_summary({ version: restorePayload.version, tables: Object.keys(restorePayload.tables).length, rows: Object.values(restorePayload.tables).reduce((s, t) => s + t.length, 0) })}
      </div>
      <button
        type="button"
        onclick={() => (confirmingRestore = true)}
        class="px-4 py-2 bg-destructive text-destructive-foreground rounded hover:opacity-90"
      >
        {m.settings_restore_apply()}
      </button>
    {/if}
  </section>

  <section class="space-y-4 border rounded-lg p-6 bg-card text-card-foreground">
    <h3 class="text-lg font-semibold">{m.settings_disclaimer_title()}</h3>
    {#if disclaimerAcceptedAt}
      <p class="text-sm">
        {m.settings_disclaimer_accepted({ date: new Date(disclaimerAcceptedAt).toISOString().slice(0, 10), version: disclaimerAcceptedVersion ?? 0 })}
      </p>
      <p class="text-xs text-muted-foreground">
        {m.settings_disclaimer_full_text_label()}
        <a
          href="https://github.com/Lonshaus/aoiko/blob/master/DISCLAIMER.md"
          target="_blank"
          rel="noopener noreferrer"
          class="underline hover:text-foreground"
        >DISCLAIMER.md</a>
      </p>
      <div>
        <button
          type="button"
          onclick={revokeDisclaimer}
          class="px-4 py-2 border rounded text-destructive hover:bg-destructive/10"
        >
          {m.settings_disclaimer_revoke()}
        </button>
      </div>
    {:else}
      <p class="text-sm text-muted-foreground">{m.settings_disclaimer_not_accepted()}</p>
    {/if}
  </section>

  <section class="space-y-4 border rounded-lg p-6 bg-card text-card-foreground">
    <h3 class="text-lg font-semibold">{m.settings_data_title()}</h3>
    <p class="text-xs text-muted-foreground">
      {m.settings_data_intro()}
    </p>
    <div>
      <button
        type="button"
        onclick={() => (confirmingClear = true)}
        class="px-4 py-2 bg-destructive text-destructive-foreground rounded hover:opacity-90"
      >
        {m.settings_data_clear_button()}
      </button>
    </div>
  </section>
</div>

<AlertDialog.Root bind:open={confirmingClear}>
  <AlertDialog.Content>
    <AlertDialog.Header>
      <AlertDialog.Title>{m.settings_clear_confirm_title()}</AlertDialog.Title>
      <AlertDialog.Description>
        {m.settings_clear_confirm_desc()}
      </AlertDialog.Description>
    </AlertDialog.Header>
    <AlertDialog.Footer>
      <AlertDialog.Cancel>{m.common_cancel()}</AlertDialog.Cancel>
      <AlertDialog.Action
        onclick={clearAll}
        class="bg-destructive text-destructive-foreground hover:bg-destructive/90"
      >
        {m.settings_clear_confirm_action()}
      </AlertDialog.Action>
    </AlertDialog.Footer>
  </AlertDialog.Content>
</AlertDialog.Root>

<AlertDialog.Root bind:open={confirmingRestore}>
  <AlertDialog.Content>
    <AlertDialog.Header>
      <AlertDialog.Title>{m.settings_restore_confirm_title()}</AlertDialog.Title>
      <AlertDialog.Description>
        {m.settings_restore_confirm_desc()}
      </AlertDialog.Description>
    </AlertDialog.Header>
    <AlertDialog.Footer>
      <AlertDialog.Cancel>{m.common_cancel()}</AlertDialog.Cancel>
      <AlertDialog.Action
        onclick={confirmRestore}
        class="bg-destructive text-destructive-foreground hover:bg-destructive/90"
      >
        {m.settings_restore_confirm_action()}
      </AlertDialog.Action>
    </AlertDialog.Footer>
  </AlertDialog.Content>
</AlertDialog.Root>