<script lang="ts">
  import { liveQuery } from 'dexie';
  import { db } from '../db';
  import { formatJPY } from '../lib/decimal';
  import { reverseEntry } from '../domain/reverse';
  import {
    buildLedgerRows,
    type LedgerRow,
  } from '../stores/ledger.svelte';
  import * as AlertDialog from '$lib/components/ui/alert-dialog';

  const PAGE_SIZE = 50;
  const now = new Date();

  let year = $state(now.getFullYear());
  let month = $state<number | null>(now.getMonth() + 1);
  let descInput = $state('');
  let descQuery = $state('');
  let pageOffset = $state(0);

  let rows = $state<LedgerRow[]>([]);
  let totalCount = $state(0);
  let loading = $state(true);

  let expandedId = $state<string | null>(null);
  let confirmingReverseId = $state<string | null>(null);
  let reverseError = $state('');

  function pad2(n: number): string {
    return String(n).padStart(2, '0');
  }

  function nextMonthStart(y: number, m: number): string {
    return m === 12 ? `${y + 1}-01-01` : `${y}-${pad2(m + 1)}-01`;
  }

  async function fetchFiltered(
    year: number,
    month: number | null,
    desc: string,
    offset: number
  ): Promise<{ rows: LedgerRow[]; total: number }> {
    let entries = month
      ? await db.journalEntries
          .where('[year+date]')
          .between(
            [year, `${year}-${pad2(month)}-01`],
            [year, nextMonthStart(year, month)],
            true,
            false
          )
          .toArray()
      : await db.journalEntries.where('year').equals(year).toArray();

    if (desc) {
      const q = desc.toLowerCase();
      entries = entries.filter((e) => e.description.toLowerCase().includes(q));
    }
    entries.sort((a, b) => b.date.localeCompare(a.date));
    const total = entries.length;
    const page = entries.slice(offset, offset + PAGE_SIZE);
    const result = await buildLedgerRows(page, year);
    return { rows: result, total };
  }

  $effect(() => {
    const yr = year;
    const mo = month;
    const q = descQuery;
    const off = pageOffset;
    const sub = liveQuery(() => fetchFiltered(yr, mo, q, off)).subscribe(
      (result) => {
        rows = result.rows;
        totalCount = result.total;
        loading = false;
      }
    );
    return () => sub.unsubscribe();
  });

  function markLoading() {
    loading = true;
  }

  function applyDescQuery() {
    descQuery = descInput.trim();
    pageOffset = 0;
    markLoading();
  }

  function onYearChange() {
    pageOffset = 0;
    markLoading();
  }

  function onMonthChange() {
    pageOffset = 0;
    markLoading();
  }

  function gotoPrev() {
    pageOffset = Math.max(0, pageOffset - PAGE_SIZE);
    markLoading();
  }

  function gotoNext() {
    pageOffset = pageOffset + PAGE_SIZE;
    markLoading();
  }

  function resetFilters() {
    year = now.getFullYear();
    month = now.getMonth() + 1;
    descInput = '';
    descQuery = '';
    pageOffset = 0;
    markLoading();
  }

  function toggleExpand(id: string) {
    expandedId = expandedId === id ? null : id;
  }

  async function confirmReverse() {
    if (!confirmingReverseId) {
      return;
    }
    const target = confirmingReverseId;
    confirmingReverseId = null;
    reverseError = '';
    try {
      await reverseEntry(target);
      expandedId = null;
    } catch (e) {
      reverseError = e instanceof Error ? e.message : String(e);
    }
  }

  function fmtTax(rate: number): string {
    if (rate === 0) {
      return '対象外';
    }
    return `${Math.round(rate * 100)}%`;
  }

  const totalPages = $derived(Math.max(1, Math.ceil(totalCount / PAGE_SIZE)));
  const currentPage = $derived(Math.floor(pageOffset / PAGE_SIZE) + 1);
  const canPrev = $derived(pageOffset > 0);
  const canNext = $derived(pageOffset + PAGE_SIZE < totalCount);
</script>

<div class="space-y-6">
  <header class="flex items-end justify-between">
    <div>
      <h2 class="text-2xl font-bold">仕訳一覧</h2>
      <p class="text-xs text-muted-foreground">確定済み・訂正済みの全仕訳を年月で絞り込んで閲覧</p>
    </div>
  </header>

  <section class="bg-card text-card-foreground rounded-xl p-5 space-y-4 shadow-sm">
    <div class="grid grid-cols-1 sm:grid-cols-[auto_auto_1fr_auto] gap-3 items-end">
      <label class="block">
        <span class="text-xs text-muted-foreground">年</span>
        <input
          type="number"
          bind:value={year}
          onchange={onYearChange}
          min="2020"
          max="2099"
          step="1"
          class="mt-1 w-24 px-3 py-2 bg-background border rounded text-foreground tabular-nums"
        />
      </label>
      <label class="block">
        <span class="text-xs text-muted-foreground">月</span>
        <select
          bind:value={month}
          onchange={onMonthChange}
          class="mt-1 px-3 py-2 bg-background border rounded text-foreground"
        >
          <option value={null}>全月</option>
          {#each [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as m (m)}
            <option value={m}>{m} 月</option>
          {/each}
        </select>
      </label>
      <label class="block">
        <span class="text-xs text-muted-foreground">摘要に含む文字</span>
        <input
          type="text"
          bind:value={descInput}
          onkeydown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              applyDescQuery();
            }
          }}
          onblur={applyDescQuery}
          placeholder="Enter で適用"
          class="mt-1 w-full px-3 py-2 bg-background border rounded text-foreground"
        />
      </label>
      <button
        type="button"
        onclick={resetFilters}
        class="px-4 py-2 border rounded hover:bg-accent text-sm"
      >
        リセット
      </button>
    </div>

    <div class="flex items-center justify-between text-xs text-muted-foreground">
      <span class="tabular-nums">
        {#if loading}
          読み込み中…
        {:else}
          {totalCount} 件 — {currentPage} / {totalPages} ページ
        {/if}
      </span>
      <div class="flex gap-2">
        <button
          type="button"
          disabled={!canPrev}
          onclick={gotoPrev}
          class="px-3 py-1 border rounded hover:bg-accent disabled:opacity-30"
        >
          ← 前
        </button>
        <button
          type="button"
          disabled={!canNext}
          onclick={gotoNext}
          class="px-3 py-1 border rounded hover:bg-accent disabled:opacity-30"
        >
          次 →
        </button>
      </div>
    </div>
  </section>

  {#if reverseError}
    <div class="border border-destructive bg-destructive/10 text-destructive rounded-lg px-4 py-2 text-sm">
      {reverseError}
    </div>
  {/if}

  {#if rows.length > 0}
    <div class="bg-card text-card-foreground rounded-xl overflow-hidden shadow-sm">
      <table class="w-full text-sm">
        <thead>
          <tr class="text-xs text-muted-foreground">
            <th class="text-left font-normal px-4 py-3 w-8"></th>
            <th class="text-left font-normal px-4 py-3">日付</th>
            <th class="text-left font-normal px-4 py-3">摘要</th>
            <th class="text-left font-normal px-4 py-3">借方科目</th>
            <th class="text-left font-normal px-4 py-3">貸方科目</th>
            <th class="text-right font-normal px-4 py-3">金額</th>
          </tr>
        </thead>
        <tbody>
          {#each rows as row (row.entry.id)}
            {@const expanded = expandedId === row.entry.id}
            {@const reversed = row.entry.status === 'reversed'}
            {@const isCorrection = !!row.entry.originalEntryId}
            <tr
              class="border-t border-border/50 hover:bg-accent/30 transition-colors cursor-pointer"
              class:opacity-60={reversed}
              onclick={() => toggleExpand(row.entry.id)}
            >
              <td class="px-4 py-3 text-muted-foreground tabular-nums">
                {expanded ? '▾' : '▸'}
              </td>
              <td class="px-4 py-3 text-muted-foreground tabular-nums whitespace-nowrap">
                {row.entry.date}
              </td>
              <td class="px-4 py-3">
                <span class:line-through={reversed}>{row.entry.description}</span>
                {#if isCorrection}
                  <span class="ml-2 text-xs text-muted-foreground">↩</span>
                {/if}
              </td>
              <td class="px-4 py-3">
                {#if row.debits[0]}
                  {row.debits[0].name}{#if row.debits.length > 1}<span class="text-xs text-muted-foreground ml-1">+{row.debits.length - 1}</span>{/if}
                {:else}
                  <span class="text-muted-foreground">—</span>
                {/if}
              </td>
              <td class="px-4 py-3">
                {#if row.credits[0]}
                  {row.credits[0].name}{#if row.credits.length > 1}<span class="text-xs text-muted-foreground ml-1">+{row.credits.length - 1}</span>{/if}
                {:else}
                  <span class="text-muted-foreground">—</span>
                {/if}
              </td>
              <td class="px-4 py-3 text-right tabular-nums font-medium whitespace-nowrap">
                {formatJPY(row.totalAmount)}
              </td>
            </tr>
            {#if expanded}
              <tr class="border-t border-border/50 bg-background/40">
                <td colspan="6" class="px-4 py-4">
                  <div class="space-y-3">
                    <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <div class="text-xs text-muted-foreground mb-1">借方</div>
                        <ul class="space-y-1">
                          {#each row.debits as l, i (`d-${i}`)}
                            <li class="flex justify-between gap-3 text-sm">
                              <span>
                                <span class="font-mono text-xs text-muted-foreground">{l.code}</span>
                                {l.name}{#if l.subAccountName} / {l.subAccountName}{/if}
                                <span class="text-xs text-muted-foreground ml-1">{fmtTax(l.taxRate)}</span>
                              </span>
                              <span class="tabular-nums whitespace-nowrap">{formatJPY(l.amount)}</span>
                            </li>
                            {#if l.memo}
                              <li class="text-xs text-muted-foreground pl-2">↳ {l.memo}</li>
                            {/if}
                          {/each}
                        </ul>
                      </div>
                      <div>
                        <div class="text-xs text-muted-foreground mb-1">貸方</div>
                        <ul class="space-y-1">
                          {#each row.credits as l, i (`c-${i}`)}
                            <li class="flex justify-between gap-3 text-sm">
                              <span>
                                <span class="font-mono text-xs text-muted-foreground">{l.code}</span>
                                {l.name}{#if l.subAccountName} / {l.subAccountName}{/if}
                                <span class="text-xs text-muted-foreground ml-1">{fmtTax(l.taxRate)}</span>
                              </span>
                              <span class="tabular-nums whitespace-nowrap">{formatJPY(l.amount)}</span>
                            </li>
                            {#if l.memo}
                              <li class="text-xs text-muted-foreground pl-2">↳ {l.memo}</li>
                            {/if}
                          {/each}
                        </ul>
                      </div>
                    </div>

                    <div class="flex items-center justify-between pt-2 border-t border-border/50">
                      <div class="text-xs text-muted-foreground font-mono">{row.entry.id}</div>
                      {#if !reversed}
                        <button
                          type="button"
                          onclick={(e) => {
                            e.stopPropagation();
                            confirmingReverseId = row.entry.id;
                          }}
                          class="px-3 py-1 text-sm border border-destructive/50 text-destructive rounded hover:bg-destructive/10"
                        >
                          訂正する
                        </button>
                      {:else}
                        <span class="text-xs text-muted-foreground">訂正済み</span>
                      {/if}
                    </div>
                  </div>
                </td>
              </tr>
            {/if}
          {/each}
        </tbody>
      </table>
    </div>
  {:else if !loading}
    <div class="bg-card text-card-foreground rounded-xl p-12 text-center shadow-sm">
      <p class="text-sm text-muted-foreground">
        条件に合う仕訳がないみたい。フィルタを変えてみてね。
      </p>
    </div>
  {/if}
</div>

<AlertDialog.Root
  open={confirmingReverseId !== null}
  onOpenChange={(o) => {
    if (!o) {
      confirmingReverseId = null;
    }
  }}
>
  <AlertDialog.Content>
    <AlertDialog.Header>
      <AlertDialog.Title>この仕訳を訂正しますか？</AlertDialog.Title>
      <AlertDialog.Description>
        借方と貸方を入れ替えた打消し仕訳を本日付で作成し、元の仕訳は「訂正済み」となります。両方の仕訳は履歴として保持されます（電子帳簿保存法の要件）。
      </AlertDialog.Description>
    </AlertDialog.Header>
    <AlertDialog.Footer>
      <AlertDialog.Cancel>キャンセル</AlertDialog.Cancel>
      <AlertDialog.Action
        onclick={confirmReverse}
        class="bg-destructive text-destructive-foreground hover:bg-destructive/90"
      >
        訂正する
      </AlertDialog.Action>
    </AlertDialog.Footer>
  </AlertDialog.Content>
</AlertDialog.Root>