<script lang="ts">
  import { onMount } from 'svelte';
  import { db } from '../db';
  import { newId } from '../lib/id';
  import { DISCLAIMER_VERSION, deleteSetting, getSetting, setSetting } from '../lib/settings';
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

  let currentYear = $state(2026);
  let userBusinessName = $state('');
  let userInvoiceNumber = $state('');
  let basicSaveLabel = $state('保存');
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
    const order: Array<{ key: Account['category']; label: string }> = [
      { key: 'asset', label: '資産' },
      { key: 'liability', label: '負債' },
      { key: 'equity', label: '純資産' },
      { key: 'revenue', label: '収益' },
      { key: 'expense', label: '費用' },
    ];
    for (const { key, label } of order) {
      const items = ledger.allAccounts.filter((a) => a.category === key);
      if (items.length > 0) {
        groups.push({ category: key, label, items });
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
    basicSaveLabel = '✓ 保存しました';
    setTimeout(() => {
      basicSaveLabel = '保存';
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
        carryoverStatus = '✓ 期首振替仕訳を作成しました';
        carryoverPreview = null;
      } else if (r.reason === 'already-exists') {
        carryoverError = 'すでに前期繰越仕訳が存在します。先に削除してください。';
      } else {
        carryoverError = '前年に仕訳がないため繰越できません';
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
      carryoverStatus = r.removed ? '✓ 削除しました' : '対象なし';
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
      subError = '親科目と名前を入力してください';
      return;
    }
    const exists = ledger.subAccounts.some(
      (s) => s.accountCode === parent && s.name === name
    );
    if (exists) {
      subError = '同名の補助科目がすでに存在します';
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
      vendorError = '名前を入力してください';
      return;
    }
    if (ledger.vendors.some((v) => v.name === name)) {
      vendorError = '同名の取引先がすでに存在します';
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
      ruleError = 'パターンと対方科目は必須です';
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
      assetError = '名前と取得価額は必須です';
      return;
    }
    if (newAssetLife < 1) {
      assetError = '耐用年数は 1 以上を指定してください';
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
      depreciationStatus = `✓ ${r.created} 件の仕訳を作成${r.skipped > 0 ? `（${r.skipped} 件は既存のためスキップ）` : ''}`;
    } catch (e) {
      depreciationStatus = `⚠ ${e instanceof Error ? e.message : String(e)}`;
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
    geminiKeySaved = '✓ 保存しました';
    setTimeout(() => {
      geminiKeySaved = '';
    }, 2000);
  }

  async function testGeminiKey() {
    geminiTestStatus = '⏳ テスト中…';
    try {
      const { GeminiAdapter } = await import('../domain/llm');
      const adapter = new GeminiAdapter(geminiKey.trim());
      await adapter.generateJson(
        '日本語で "ok" だけを JSON 形式 {"status":"ok"} で返してください。'
      );
      geminiTestStatus = '✓ 接続成功';
    } catch (e) {
      geminiTestStatus = `⚠ ${e instanceof Error ? e.message : String(e)}`;
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
      restoreSuccess = `${result.tableCount} テーブル / ${result.rowCount} 行 を復元しました。ページを再読み込みしてください。`;
      restorePayload = null;
    } catch (err) {
      restoreError = err instanceof Error ? err.message : String(err);
    }
  }

  function vendorEntityLabel(t: VendorEntityType | undefined): string {
    if (!t || t === 'unknown') {
      return '—';
    }
    return ({
      corporation: '法人',
      individual: '個人',
      public: '公共',
      foreign: '海外',
      unknown: '—',
    } as const)[t];
  }

  function matchTypeLabel(t: ParserRuleMatchType): string {
    return ({
      'description-includes': '内容に含む',
      'vendor-name': '取引先名一致',
      regex: '正規表現',
    } as const)[t];
  }
</script>

<div class="space-y-8">
  <h2 class="text-2xl font-bold">設定</h2>

  <form
    onsubmit={saveBasic}
    class="space-y-4 border rounded-lg p-6 bg-card text-card-foreground"
  >
    <h3 class="text-lg font-semibold">基本情報</h3>
    <p class="text-xs text-muted-foreground">
      決算書・確定申告書 B・<code class="text-foreground">.xtx</code> ファイルに記載される事業者情報。
    </p>
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <label class="block sm:col-span-2">
        <span class="text-xs text-muted-foreground">事業名 / 屋号</span>
        <input
          type="text"
          bind:value={userBusinessName}
          placeholder="例：青井ウェブ事務所"
          class="mt-1 w-full px-3 py-2 bg-background border rounded text-foreground"
        />
      </label>
      <label class="block">
        <span class="text-xs text-muted-foreground">インボイス登録番号</span>
        <input
          type="text"
          bind:value={userInvoiceNumber}
          placeholder="T1234567890123"
          pattern={INVOICE_NUMBER_PATTERN}
          class="mt-1 w-full px-3 py-2 bg-background border rounded text-foreground font-mono"
        />
      </label>
      <label class="block">
        <span class="text-xs text-muted-foreground">処理中の年度</span>
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
        {basicSaveLabel}
      </button>
    </div>
  </form>

  <section class="space-y-4 border rounded-lg p-6 bg-card text-card-foreground">
    <h3 class="text-lg font-semibold">前期繰越（期首残高）</h3>
    <p class="text-xs text-muted-foreground">
      前年の資産・負債残高を <strong>{currentYear}-01-01</strong> 付けの期首振替仕訳として今年度に持ち越します。
      事業主貸・事業主借・前年純利益は元入金へ吸収されます。年度の最初に 1 回だけ実行してください。
    </p>
    <div class="flex flex-wrap gap-2">
      <button
        type="button"
        onclick={previewCarryover}
        class="px-4 py-2 border rounded hover:bg-accent"
      >
        プレビュー
      </button>
      <button
        type="button"
        onclick={runCarryover}
        class="px-4 py-2 bg-primary text-primary-foreground rounded hover:opacity-90"
      >
        期首振替仕訳を作成
      </button>
      <button
        type="button"
        onclick={deleteCarryover}
        class="px-4 py-2 border rounded text-destructive hover:bg-destructive/10"
      >
        既存の繰越仕訳を削除
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
          <h4 class="font-medium mb-1">借方（資産）</h4>
          {#if p.assets.length === 0}
            <p class="text-muted-foreground text-xs">なし</p>
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
          <h4 class="font-medium mb-1">貸方（負債・元入金）</h4>
          {#if p.liabilities.length === 0 && p.capitalAmount === '0'}
            <p class="text-muted-foreground text-xs">なし</p>
          {:else}
            <ul class="space-y-1">
              {#each p.liabilities as l (l.accountCode)}
                <li class="flex justify-between">
                  <span>{l.accountCode} {l.accountName}</span>
                  <span class="font-mono">{formatJPY(l.amount)}</span>
                </li>
              {/each}
              <li class="flex justify-between border-t pt-1">
                <span>{p.capitalCode} 元入金</span>
                <span class="font-mono">{formatJPY(p.capitalAmount)}</span>
              </li>
            </ul>
          {/if}
        </div>
      </div>
      <div class="text-xs text-muted-foreground border-t pt-2 space-y-0.5">
        <p>前年純利益：<span class="font-mono">{formatJPY(p.priorNetIncome)}</span></p>
        <p>前年末元入金：<span class="font-mono">{formatJPY(p.priorEndingCapital)}</span></p>
        <p>事業主貸：<span class="font-mono">{formatJPY(p.priorOwnerWithdrawals)}</span> / 事業主借：<span class="font-mono">{formatJPY(p.priorOwnerContributions)}</span></p>
      </div>
    {/if}
  </section>

  <section class="space-y-4 border rounded-lg p-6 bg-card text-card-foreground">
    <h3 class="text-lg font-semibold">補助科目</h3>
    <p class="text-xs text-muted-foreground">
      銀行口座の区別（例：普通預金 / 三菱UFJ）や経費の細目（例：通信費 / AWS）に使えます。
    </p>
    <form onsubmit={addSubAccount} class="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-3">
      <select
        bind:value={newSubParent}
        required
        class="px-3 py-2 bg-background border rounded text-foreground"
      >
        <option value="">親科目を選択</option>
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
        placeholder="補助科目名（例：三菱UFJ 本店）"
        class="px-3 py-2 bg-background border rounded text-foreground"
      />
      <button
        type="submit"
        class="px-4 py-2 bg-primary text-primary-foreground rounded hover:opacity-90"
      >
        追加
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
                    削除
                  </button>
                </li>
              {/each}
            </ul>
          </li>
        {/each}
      </ul>
    {:else}
      <p class="text-sm text-muted-foreground">まだ補助科目がありません。</p>
    {/if}
  </section>

  <section class="space-y-4 border rounded-lg p-6 bg-card text-card-foreground">
    <h3 class="text-lg font-semibold">取引先</h3>
    <p class="text-xs text-muted-foreground">
      インボイス登録番号や既定の対方科目を登録しておくと、CSV インポート時の自動分類に使えます。
    </p>
    <form onsubmit={addVendor} class="grid grid-cols-1 sm:grid-cols-[1fr_auto_1fr_1fr_auto] gap-3">
      <input
        type="text"
        bind:value={newVendorName}
        required
        placeholder="取引先名"
        class="px-3 py-2 bg-background border rounded text-foreground"
      />
      <select
        bind:value={newVendorEntityType}
        class="px-3 py-2 bg-background border rounded text-foreground"
      >
        <option value="unknown">区分</option>
        <option value="corporation">法人</option>
        <option value="individual">個人</option>
        <option value="public">公共</option>
        <option value="foreign">海外</option>
      </select>
      <input
        type="text"
        bind:value={newVendorInvoice}
        placeholder="T1234567890123 (任意)"
        pattern={INVOICE_NUMBER_PATTERN}
        class="px-3 py-2 bg-background border rounded text-foreground font-mono text-sm"
      />
      <select
        bind:value={newVendorAccountCode}
        class="px-3 py-2 bg-background border rounded text-foreground"
      >
        <option value="">既定科目（任意）</option>
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
        class="px-4 py-2 bg-primary text-primary-foreground rounded hover:opacity-90"
      >
        追加
      </button>
    </form>
    {#if vendorError}
      <div class="text-sm text-destructive">{vendorError}</div>
    {/if}
    {#if ledger.vendors.length > 0}
      <ul class="space-y-1">
        {#each ledger.vendors as v (v.id)}
          <li class="grid grid-cols-[1fr_auto_auto_auto] gap-3 items-center border rounded px-3 py-2 bg-background text-sm">
            <span>
              {v.name}
              <span class="text-xs text-muted-foreground ml-2">{vendorEntityLabel(v.entityType)}</span>
            </span>
            <span class="font-mono text-xs text-muted-foreground">{v.invoiceNumber ?? ''}</span>
            <span class="text-xs text-muted-foreground">
              {v.defaultAccountCode ?? ''}
            </span>
            <div class="flex gap-2">
              {#if v.invoiceNumber}
                <a
                  href={`https://www.invoice-kohyo.nta.go.jp/regno-search/list?selRegNo=${v.invoiceNumber.replace(/^T/, '')}`}
                  target="_blank"
                  rel="noreferrer noopener"
                  class="text-xs text-primary hover:underline"
                >
                  公表サイト
                </a>
              {/if}
              <button
                type="button"
                onclick={() => deleteVendor(v.id)}
                class="text-xs text-muted-foreground hover:text-destructive"
              >
                削除
              </button>
            </div>
          </li>
        {/each}
      </ul>
    {:else}
      <p class="text-sm text-muted-foreground">まだ取引先がありません。</p>
    {/if}
  </section>

  <section class="space-y-4 border rounded-lg p-6 bg-card text-card-foreground">
    <h3 class="text-lg font-semibold">固定資産</h3>
    <p class="text-xs text-muted-foreground">
      取得価額 10 万円以上の機材は固定資産として登録し、減価償却（直接法）で経費計上します。
      年末に「減価償却仕訳を生成」で当年度の償却仕訳を一括作成します。
    </p>

    <form
      onsubmit={addAsset}
      class="grid grid-cols-1 sm:grid-cols-[1.5fr_auto_auto_auto_auto_auto] gap-2"
    >
      <input
        type="text"
        bind:value={newAssetName}
        required
        placeholder="名前（例：MacBook Pro）"
        class="px-3 py-2 bg-background border rounded text-foreground text-sm"
      />
      <input
        type="date"
        bind:value={newAssetDate}
        required
        title="取得日"
        class="px-3 py-2 bg-background border rounded text-foreground text-sm tabular-nums"
      />
      <input
        type="number"
        bind:value={newAssetCost}
        required
        min="0"
        step="1"
        placeholder="取得価額"
        class="w-32 px-3 py-2 bg-background border rounded text-foreground text-sm tabular-nums text-right"
      />
      <input
        type="number"
        bind:value={newAssetLife}
        required
        min="1"
        max="50"
        step="1"
        title="耐用年数"
        class="w-20 px-3 py-2 bg-background border rounded text-foreground text-sm tabular-nums"
      />
      <select
        bind:value={newAssetAccount}
        title="科目"
        class="px-3 py-2 bg-background border rounded text-foreground text-sm"
      >
        <option value="1510">1510 工具器具備品</option>
        <option value="1540">1540 車両運搬具</option>
        <option value="1550">1550 建物附属設備</option>
      </select>
      <select
        bind:value={newAssetMethod}
        title="償却方法"
        class="px-3 py-2 bg-background border rounded text-foreground text-sm"
      >
        <option value="straight-line">定額法</option>
        <option value="declining-balance">定率法（200%）</option>
      </select>
      <button
        type="submit"
        class="px-4 py-2 bg-primary text-primary-foreground rounded hover:opacity-90"
      >
        追加
      </button>
    </form>
    {#if assetError}
      <div class="text-sm text-destructive">{assetError}</div>
    {/if}

    {#if ledger.fixedAssets.length > 0}
      <table class="w-full text-sm">
        <thead>
          <tr class="text-xs text-muted-foreground">
            <th class="text-left font-normal py-1">名前</th>
            <th class="text-left font-normal py-1">取得日</th>
            <th class="text-right font-normal py-1">取得価額</th>
            <th class="text-right font-normal py-1">耐用年数</th>
            <th class="text-right font-normal py-1">当年度償却</th>
            <th class="text-right font-normal py-1">期末簿価</th>
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
              <td class="py-2 text-right tabular-nums">{a.usefulLifeYears} 年</td>
              <td class="py-2 text-right tabular-nums">{formatJPY(d.amount)}</td>
              <td class="py-2 text-right tabular-nums text-muted-foreground">{formatJPY(d.book)}</td>
              <td class="py-2 text-right">
                <button
                  type="button"
                  onclick={() => deleteAsset(a.id)}
                  class="text-xs text-muted-foreground hover:text-destructive"
                >
                  削除
                </button>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    {:else}
      <p class="text-sm text-muted-foreground">まだ固定資産がありません。</p>
    {/if}

    <div class="flex items-end gap-3 pt-3 border-t border-border/50">
      <label class="block">
        <span class="text-xs text-muted-foreground">対象年度</span>
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
        減価償却仕訳を生成
      </button>
      {#if depreciationStatus}
        <span class="text-sm">{depreciationStatus}</span>
      {/if}
    </div>
  </section>

  <section class="space-y-4 border rounded-lg p-6 bg-card text-card-foreground">
    <h3 class="text-lg font-semibold">自動分類ルール</h3>
    <p class="text-xs text-muted-foreground">
      CSV インポート時に内容文字列でマッチして対方科目を自動入力します。優先度が高いルールから評価されます。
    </p>
    <form
      onsubmit={addRule}
      class="grid grid-cols-1 sm:grid-cols-[auto_2fr_1fr_auto_auto] gap-3"
    >
      <select
        bind:value={newRuleMatchType}
        class="px-3 py-2 bg-background border rounded text-foreground"
      >
        <option value="description-includes">内容に含む</option>
        <option value="vendor-name">取引先名一致</option>
        <option value="regex">正規表現</option>
      </select>
      <input
        type="text"
        bind:value={newRulePattern}
        required
        placeholder="例：amazon"
        class="px-3 py-2 bg-background border rounded text-foreground"
      />
      <select
        bind:value={newRuleAccountCode}
        required
        class="px-3 py-2 bg-background border rounded text-foreground"
      >
        <option value="">対方科目</option>
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
        title="優先度"
        class="w-20 px-3 py-2 bg-background border rounded text-foreground tabular-nums"
      />
      <button
        type="submit"
        class="px-4 py-2 bg-primary text-primary-foreground rounded hover:opacity-90"
      >
        追加
      </button>
    </form>
    {#if ruleError}
      <div class="text-sm text-destructive">{ruleError}</div>
    {/if}
    {#if ledger.parserRules.length > 0}
      <ul class="space-y-1">
        {#each ledger.parserRules as r (r.id)}
          <li class="grid grid-cols-[auto_1fr_auto_auto_auto_auto] gap-3 items-center border rounded px-3 py-2 bg-background text-sm">
            <span class="text-xs text-muted-foreground">{matchTypeLabel(r.matchType)}</span>
            <span class="font-mono">{r.pattern}</span>
            <span class="font-mono text-xs text-muted-foreground">→ {r.accountCode}</span>
            <span class="text-xs text-muted-foreground tabular-nums">優{r.priority}</span>
            <span class="text-xs text-muted-foreground tabular-nums">{r.hitCount} 回</span>
            <button
              type="button"
              onclick={() => deleteRule(r.id)}
              class="text-xs text-muted-foreground hover:text-destructive"
            >
              削除
            </button>
          </li>
        {/each}
      </ul>
    {:else}
      <p class="text-sm text-muted-foreground">まだルールがありません。</p>
    {/if}
  </section>

  <section class="space-y-4 border rounded-lg p-6 bg-card text-card-foreground">
    <h3 class="text-lg font-semibold">勘定科目</h3>
    <p class="text-xs text-muted-foreground">
      使わない科目を非表示にすると、仕訳入力時の選択肢が短くなります。会計記録から削除されることはありません。
    </p>
    {#each allAccountGroups as group (group.category)}
      <details class="border rounded">
        <summary class="cursor-pointer px-3 py-2 text-sm font-medium">
          {group.label}
          <span class="text-xs text-muted-foreground ml-2">
            {group.items.filter((a) => a.isActive !== false).length} / {group.items.length} 有効
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
                有効
              </label>
            </li>
          {/each}
        </ul>
      </details>
    {/each}
  </section>

  <section class="space-y-4 border rounded-lg p-6 bg-card text-card-foreground">
    <h3 class="text-lg font-semibold">LLM 連携（任意）</h3>
    <p class="text-xs text-muted-foreground">
      Google Gemini API キーを入れると、CSV インポート時にルールにマッチしなかった行を
      LLM で自動分類できます。<strong class="text-foreground">BYOK 方式</strong>：キーはあなたのブラウザ内のみに保存され、Google API に直接送信されます（aoiko 側に経由しません）。
      <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer" class="text-primary hover:underline">Google AI Studio</a> で無料取得可能。
    </p>
    <div class="flex gap-3 items-end">
      <label class="block flex-1">
        <span class="text-xs text-muted-foreground">Gemini API キー</span>
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
        保存
      </button>
      <button
        type="button"
        onclick={testGeminiKey}
        disabled={!geminiKey.trim()}
        class="px-4 py-2 border rounded hover:bg-accent disabled:opacity-50"
      >
        接続テスト
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
    <h3 class="text-lg font-semibold">JSON から復元</h3>
    <p class="text-xs text-muted-foreground">
      バックアップした JSON ファイルから完全復元します。<strong class="text-foreground">現在の全データは削除されます。</strong>
    </p>
    <input
      type="file"
      accept=".json,application/json"
      onchange={handleRestoreFile}
      class="w-full text-sm text-muted-foreground"
    />
    {#if restoreFileName}
      <p class="text-xs text-muted-foreground">選択中：{restoreFileName}</p>
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
          再読み込み
        </button>
      </div>
    {/if}
    {#if restorePayload}
      <div class="text-xs text-muted-foreground">
        version {restorePayload.version} ・ {Object.keys(restorePayload.tables).length} テーブル ・
        {Object.values(restorePayload.tables).reduce((s, t) => s + t.length, 0)} 行
      </div>
      <button
        type="button"
        onclick={() => (confirmingRestore = true)}
        class="px-4 py-2 bg-destructive text-destructive-foreground rounded hover:opacity-90"
      >
        全データを置換して復元
      </button>
    {/if}
  </section>

  <section class="space-y-4 border rounded-lg p-6 bg-card text-card-foreground">
    <h3 class="text-lg font-semibold">免責事項の同意状態</h3>
    {#if disclaimerAcceptedAt}
      <p class="text-sm">
        ✓ 同意済み（{new Date(disclaimerAcceptedAt).toISOString().slice(0, 10)} 時点・version {disclaimerAcceptedVersion}）
      </p>
      <p class="text-xs text-muted-foreground">
        全文：
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
          同意を取り消す（再表示）
        </button>
      </div>
    {:else}
      <p class="text-sm text-muted-foreground">未同意</p>
    {/if}
  </section>

  <section class="space-y-4 border rounded-lg p-6 bg-card text-card-foreground">
    <h3 class="text-lg font-semibold">データ管理</h3>
    <p class="text-xs text-muted-foreground">
      ローカル IndexedDB のすべてのデータを削除します。バックアップファイルは保持されます。
    </p>
    <div>
      <button
        type="button"
        onclick={() => (confirmingClear = true)}
        class="px-4 py-2 bg-destructive text-destructive-foreground rounded hover:opacity-90"
      >
        全データ削除
      </button>
    </div>
  </section>
</div>

<AlertDialog.Root bind:open={confirmingClear}>
  <AlertDialog.Content>
    <AlertDialog.Header>
      <AlertDialog.Title>本当に全データを削除しますか？</AlertDialog.Title>
      <AlertDialog.Description>
        IndexedDB の仕訳・取引先・固定資産・設定などすべてのデータが完全に削除されます。この操作は元に戻せません。
        バックアップフォルダ内のファイルは削除されません。
      </AlertDialog.Description>
    </AlertDialog.Header>
    <AlertDialog.Footer>
      <AlertDialog.Cancel>キャンセル</AlertDialog.Cancel>
      <AlertDialog.Action
        onclick={clearAll}
        class="bg-destructive text-destructive-foreground hover:bg-destructive/90"
      >
        削除する
      </AlertDialog.Action>
    </AlertDialog.Footer>
  </AlertDialog.Content>
</AlertDialog.Root>

<AlertDialog.Root bind:open={confirmingRestore}>
  <AlertDialog.Content>
    <AlertDialog.Header>
      <AlertDialog.Title>JSON で全データを置換しますか？</AlertDialog.Title>
      <AlertDialog.Description>
        現在の全データが削除され、選択した JSON の内容で完全置換されます。この操作は元に戻せません。
      </AlertDialog.Description>
    </AlertDialog.Header>
    <AlertDialog.Footer>
      <AlertDialog.Cancel>キャンセル</AlertDialog.Cancel>
      <AlertDialog.Action
        onclick={confirmRestore}
        class="bg-destructive text-destructive-foreground hover:bg-destructive/90"
      >
        置換して復元
      </AlertDialog.Action>
    </AlertDialog.Footer>
  </AlertDialog.Content>
</AlertDialog.Root>