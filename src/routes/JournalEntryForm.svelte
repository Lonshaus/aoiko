<script lang="ts">
  import { db } from '../db';
  import { validateLines } from '../domain/journal';
  import { expandHomeOffice, type SplittableLine } from '../domain/home-office';
  import { D, formatJPY, toIndexable } from '../lib/decimal';
  import { newId } from '../lib/id';
  import { ledger } from '../stores/ledger.svelte';
  import type { JournalLine } from '../db/types';

  type DraftLine = {
    id: string;
    accountCode: string;
    subAccountId: string;
    amount: string;
    taxRate: number;
    taxIncluded: boolean;
    homeOfficeRatio: string;  // '' = 未設定 (=100%), '0.30' 等
  };

  const TAX_OPTIONS: Array<{ value: number; label: string }> = [
    { value: 0, label: '対象外' },
    { value: 0.08, label: '軽減 8%' },
    { value: 0.1, label: '標準 10%' },
  ];

  const today = () => new Date().toISOString().slice(0, 10);
  const emptyLine = (): DraftLine => ({
    id: newId(),
    accountCode: '',
    subAccountId: '',
    amount: '',
    taxRate: 0,
    taxIncluded: true,
    homeOfficeRatio: '',
  });

  let date = $state(today());
  let description = $state('');
  let debits = $state<DraftLine[]>([emptyLine()]);
  let credits = $state<DraftLine[]>([emptyLine()]);
  let error = $state('');
  let saving = $state(false);

  const accountGroups = $derived(ledger.groupedAccounts());

  function sumAmount(lines: DraftLine[]): string {
    return lines
      .reduce((s, l) => (l.amount ? s.plus(l.amount) : s), D(0))
      .toString();
  }

  const debitTotal = $derived(sumAmount(debits));
  const creditTotal = $derived(sumAmount(credits));
  const diff = $derived(D(debitTotal).minus(creditTotal).toString());
  const balanced = $derived(D(diff).isZero() && !D(debitTotal).isZero());

  function addDebit() {
    debits = [...debits, emptyLine()];
  }
  function addCredit() {
    credits = [...credits, emptyLine()];
  }
  function removeLine(side: 'debit' | 'credit', id: string) {
    if (side === 'debit') {
      if (debits.length <= 1) {
        return;
      }
      debits = debits.filter((l) => l.id !== id);
    } else {
      if (credits.length <= 1) {
        return;
      }
      credits = credits.filter((l) => l.id !== id);
    }
  }
  function onAccountChange(line: DraftLine) {
    line.subAccountId = '';
  }

  // 借方・貸方ともに 1 行のみ、かつ貸方が空のときに借方金額を貸方へ初期コピー
  function onDebitAmountInput(line: DraftLine, value: string) {
    line.amount = value;
    if (
      debits.length === 1 &&
      credits.length === 1 &&
      credits[0] &&
      !credits[0].amount &&
      value
    ) {
      credits[0].amount = value;
    }
  }

  function reset() {
    description = '';
    debits = [emptyLine()];
    credits = [emptyLine()];
    error = '';
  }

  async function handleSubmit(e: Event) {
    e.preventDefault();
    error = '';
    saving = true;
    try {
      const entryId = newId();
      const now = Date.now();

      type LineLike = {
        accountCode: string;
        subAccountId: string;
        amount: string;
        taxRate: number;
        taxIncluded: boolean;
        homeOfficeRatio: string;
      };
      const buildLines = (drafts: LineLike[], side: 'debit' | 'credit'): JournalLine[] =>
        drafts.map((d) => ({
          id: newId(),
          entryId,
          side,
          accountCode: d.accountCode,
          ...(d.subAccountId ? { subAccountId: d.subAccountId } : {}),
          amount: d.amount,
          amountIndexed: toIndexable(d.amount),
          taxRate: d.taxRate,
          taxIncluded: d.taxIncluded,
          invoiceCompliant: false,
          ...(d.homeOfficeRatio ? { homeOfficeRatio: d.homeOfficeRatio } : {}),
        }));

      // 家事按分のある借方明細を「事業使用分」+「事業主貸」に分解
      const debitsForExpansion: SplittableLine[] = debits.map((d) => ({
        id: d.id,
        side: 'debit',
        accountCode: d.accountCode,
        subAccountId: d.subAccountId,
        amount: d.amount,
        taxRate: d.taxRate,
        taxIncluded: d.taxIncluded,
        homeOfficeRatio: d.homeOfficeRatio,
      }));
      const expandedDebits = expandHomeOffice(debitsForExpansion);

      const lines = [
        ...buildLines(expandedDebits, 'debit'),
        ...buildLines(credits, 'credit'),
      ];
      validateLines(lines);

      await db.transaction('rw', [db.journalEntries, db.journalLines], async () => {
        await db.journalEntries.add({
          id: entryId,
          date,
          year: Number(date.slice(0, 4)),
          description,
          status: 'confirmed',
          source: 'manual',
          createdAt: now,
          confirmedAt: now,
        });
        await db.journalLines.bulkAdd(lines);
      });

      reset();
      date = today();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      saving = false;
    }
  }
</script>

<form
  onsubmit={handleSubmit}
  class="space-y-4 border rounded-lg p-6 bg-card text-card-foreground"
>
  <h2 class="text-lg font-semibold">新規仕訳</h2>

  <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
    <label class="block sm:col-span-1">
      <span class="text-xs text-muted-foreground">日付</span>
      <input
        type="date"
        bind:value={date}
        required
        class="mt-1 w-full px-3 py-2 bg-background border rounded text-foreground tabular-nums"
      />
    </label>
    <label class="block sm:col-span-2">
      <span class="text-xs text-muted-foreground">摘要</span>
      <input
        type="text"
        bind:value={description}
        required
        placeholder="例：電気代"
        class="mt-1 w-full px-3 py-2 bg-background border rounded text-foreground"
      />
    </label>
  </div>

  <div class="border-t pt-4 space-y-2">
    <div class="flex items-center justify-between">
      <h3 class="text-sm font-medium text-muted-foreground">借方</h3>
      <span class="text-xs text-muted-foreground tabular-nums">計 {formatJPY(debitTotal)}</span>
    </div>
    {#each debits as line, i (line.id)}
      {@const subs = line.accountCode ? ledger.subAccountsFor(line.accountCode) : []}
      <div class="grid grid-cols-1 sm:grid-cols-[1fr_auto_auto_auto] gap-2 items-start">
        <div class="space-y-2">
          <select
            bind:value={line.accountCode}
            onchange={() => onAccountChange(line)}
            required
            class="w-full px-3 py-2 bg-background border rounded text-foreground"
          >
            <option value="" disabled>科目を選択</option>
            {#each accountGroups as group (group.category)}
              <optgroup label={group.label}>
                {#each group.items as a (a.code)}
                  <option value={a.code}>{a.code} {a.name}</option>
                {/each}
              </optgroup>
            {/each}
          </select>
          {#if subs.length > 0}
            <select
              bind:value={line.subAccountId}
              class="w-full px-3 py-2 bg-background border rounded text-foreground text-sm"
            >
              <option value="">補助科目を選択（任意）</option>
              {#each subs as s (s.id)}
                <option value={s.id}>{s.name}</option>
              {/each}
            </select>
          {/if}
        </div>
        <input
          type="number"
          value={line.amount}
          oninput={(e) => onDebitAmountInput(line, (e.target as HTMLInputElement).value)}
          required
          min="0"
          step="1"
          placeholder="金額"
          class="w-32 px-3 py-2 bg-background border rounded text-right text-foreground tabular-nums"
        />
        <select
          bind:value={line.taxRate}
          class="px-3 py-2 bg-background border rounded text-foreground text-sm"
        >
          {#each TAX_OPTIONS as opt (opt.value)}
            <option value={opt.value}>{opt.label}</option>
          {/each}
        </select>
        <button
          type="button"
          onclick={() => removeLine('debit', line.id)}
          disabled={debits.length <= 1}
          aria-label="この行を削除"
          class="px-2 py-2 text-muted-foreground hover:text-destructive disabled:opacity-30"
        >
          ×
        </button>
      </div>
      {#if line.accountCode}
        <div class="flex gap-3 ml-1 mb-2 text-xs items-center text-muted-foreground">
          <label class="flex items-center gap-1 cursor-pointer">
            <input type="checkbox" bind:checked={line.taxIncluded} /> 内税
          </label>
          <label class="flex items-center gap-1">
            家事按分
            <input
              type="number"
              bind:value={line.homeOfficeRatio}
              min="0"
              max="1"
              step="0.01"
              placeholder="1.0"
              class="w-16 px-2 py-0.5 bg-background border rounded text-foreground tabular-nums"
            />
          </label>
        </div>
      {/if}
    {/each}
    <button
      type="button"
      onclick={addDebit}
      class="text-xs text-muted-foreground hover:text-foreground"
    >
      ＋ 借方を追加
    </button>
  </div>

  <div class="border-t pt-4 space-y-2">
    <div class="flex items-center justify-between">
      <h3 class="text-sm font-medium text-muted-foreground">貸方</h3>
      <span class="text-xs text-muted-foreground tabular-nums">計 {formatJPY(creditTotal)}</span>
    </div>
    {#each credits as line, i (line.id)}
      {@const subs = line.accountCode ? ledger.subAccountsFor(line.accountCode) : []}
      <div class="grid grid-cols-1 sm:grid-cols-[1fr_auto_auto_auto] gap-2 items-start">
        <div class="space-y-2">
          <select
            bind:value={line.accountCode}
            onchange={() => onAccountChange(line)}
            required
            class="w-full px-3 py-2 bg-background border rounded text-foreground"
          >
            <option value="" disabled>科目を選択</option>
            {#each accountGroups as group (group.category)}
              <optgroup label={group.label}>
                {#each group.items as a (a.code)}
                  <option value={a.code}>{a.code} {a.name}</option>
                {/each}
              </optgroup>
            {/each}
          </select>
          {#if subs.length > 0}
            <select
              bind:value={line.subAccountId}
              class="w-full px-3 py-2 bg-background border rounded text-foreground text-sm"
            >
              <option value="">補助科目を選択（任意）</option>
              {#each subs as s (s.id)}
                <option value={s.id}>{s.name}</option>
              {/each}
            </select>
          {/if}
        </div>
        <input
          type="number"
          bind:value={line.amount}
          required
          min="0"
          step="1"
          placeholder="金額"
          class="w-32 px-3 py-2 bg-background border rounded text-right text-foreground tabular-nums"
        />
        <select
          bind:value={line.taxRate}
          class="px-3 py-2 bg-background border rounded text-foreground text-sm"
        >
          {#each TAX_OPTIONS as opt (opt.value)}
            <option value={opt.value}>{opt.label}</option>
          {/each}
        </select>
        <button
          type="button"
          onclick={() => removeLine('credit', line.id)}
          disabled={credits.length <= 1}
          aria-label="この行を削除"
          class="px-2 py-2 text-muted-foreground hover:text-destructive disabled:opacity-30"
        >
          ×
        </button>
      </div>
      {#if line.accountCode}
        <div class="flex gap-3 ml-1 mb-2 text-xs items-center text-muted-foreground">
          <label class="flex items-center gap-1 cursor-pointer">
            <input type="checkbox" bind:checked={line.taxIncluded} /> 内税
          </label>
          <label class="flex items-center gap-1">
            家事按分
            <input
              type="number"
              bind:value={line.homeOfficeRatio}
              min="0"
              max="1"
              step="0.01"
              placeholder="1.0"
              class="w-16 px-2 py-0.5 bg-background border rounded text-foreground tabular-nums"
            />
          </label>
        </div>
      {/if}
    {/each}
    <button
      type="button"
      onclick={addCredit}
      class="text-xs text-muted-foreground hover:text-foreground"
    >
      ＋ 貸方を追加
    </button>
  </div>

  <div class="border-t pt-4 flex items-center justify-between text-sm">
    <div class="space-x-4 tabular-nums">
      <span class="text-muted-foreground">差額</span>
      <span class:text-destructive={!balanced} class="font-medium">{formatJPY(diff)}</span>
      {#if balanced}
        <span class="text-xs text-muted-foreground">✓ 一致</span>
      {/if}
    </div>
  </div>

  {#if error}
    <div class="text-sm text-destructive">{error}</div>
  {/if}

  <div class="flex gap-2 justify-end">
    <button
      type="button"
      onclick={reset}
      disabled={saving}
      class="px-4 py-2 border rounded hover:bg-accent disabled:opacity-50"
    >
      クリア
    </button>
    <button
      type="submit"
      disabled={saving || !balanced}
      class="px-4 py-2 bg-primary text-primary-foreground rounded hover:opacity-90 disabled:opacity-50"
    >
      {saving ? '保存中…' : '仕訳を追加'}
    </button>
  </div>
</form>