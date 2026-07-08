<script lang="ts">
  import { liveQuery } from 'dexie';
  import { db } from '../db';
  import { D, formatJPY, type Decimal } from '../lib/decimal';
  import { reverseEntry } from '../domain/reverse';
  import { shouldConfirmAttachment } from '../domain/attachment-confirm';
  import { buildAttachmentRecord } from '../domain/attachments';
  import { exceedsLimit, formatBytes, MAX_IMAGE_BYTES } from '../lib/file-limit';
  import { getSetting, setSetting } from '../lib/settings';
  import {
    buildLedgerRows,
    type LedgerRow,
  } from '../stores/ledger.svelte';
  import * as AlertDialog from '$lib/components/ui/alert-dialog';
  import AttachmentConfirmDialog from '../components/AttachmentConfirmDialog.svelte';
  import { m } from '../paraglide/messages';
  import type { Attachment, Vendor } from '../db/types';

  const PAGE_SIZE = 50;
  const now = new Date();

  let year = $state(now.getFullYear());
  let month = $state<number | null>(now.getMonth() + 1);
  let descInput = $state('');
  let descQuery = $state('');
  // 金額範囲フィルタ：「優良な電子帳簿」要件（金額検索）対応。空文字は無制限。
  let amountMinInput = $state('');
  let amountMaxInput = $state('');
  let amountMinQuery = $state('');
  let amountMaxQuery = $state('');
  // 取引先フィルタ：「優良な電子帳簿」要件の主要記録項目検索対応。空文字＝全件。
  let vendorIdQuery = $state('');
  let vendors = $state<Vendor[]>([]);
  let pageOffset = $state(0);

  let rows = $state<LedgerRow[]>([]);
  let totalCount = $state(0);
  let loading = $state(true);

  let expandedId = $state<string | null>(null);
  let confirmingReverseId = $state<string | null>(null);
  let reverseError = $state('');
  // 証憑写真（C7）。展開中の分錄の添付一覧と、事後添付の確認フロー。
  let expandedAttachments = $state<Attachment[]>([]);
  let attachmentUrls = $state<Map<string, string>>(new Map());
  let attachmentError = $state('');
  let attachmentConfirmOpen = $state(false);
  let attachmentPreview = $state<string | null>(null);
  let pendingAttachmentFile: File | null = null;
  let pendingAttachmentInput: HTMLInputElement | null = null;

  $effect(() => {
    const id = expandedId;
    if (!id) {
      expandedAttachments = [];
      return;
    }
    const sub = liveQuery(() =>
      db.attachments.where('entryId').equals(id).toArray()
    ).subscribe((v) => {
      expandedAttachments = v;
    });
    return () => sub.unsubscribe();
  });

  $effect(() => {
    const atts = expandedAttachments;
    const urls = new Map(atts.map((a) => [a.id, URL.createObjectURL(a.blob)]));
    attachmentUrls = urls;
    return () => {
      for (const u of urls.values()) {
        URL.revokeObjectURL(u);
      }
    };
  });

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
    amountMin: string,
    amountMax: string,
    vendorId: string,
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
    const parseAmount = (s: string): Decimal | null => {
      if (s === '') {
        return null;
      }
      try {
        return D(s);
      } catch {
        return null;
      }
    };
    const min = parseAmount(amountMin);
    const max = parseAmount(amountMax);
    if (min !== null || max !== null) {
      // 金額範囲：いずれかの明細行が範囲内に入る仕訳だけ残す
      const entryIds = entries.map((e) => e.id);
      const matchingLines = await db.journalLines
        .where('entryId')
        .anyOf(entryIds)
        .filter((l) => {
          const v = D(l.amount);
          if (min !== null && v.lessThan(min)) {
            return false;
          }
          if (max !== null && v.greaterThan(max)) {
            return false;
          }
          return true;
        })
        .toArray();
      const hits = new Set(matchingLines.map((l) => l.entryId));
      entries = entries.filter((e) => hits.has(e.id));
    }
    if (vendorId) {
      // 取引先：いずれかの明細行に vendorId 一致する仕訳だけ残す
      const entryIds = entries.map((e) => e.id);
      const matchingLines = await db.journalLines
        .where('entryId')
        .anyOf(entryIds)
        .filter((l) => l.vendorId === vendorId)
        .toArray();
      const hits = new Set(matchingLines.map((l) => l.entryId));
      entries = entries.filter((e) => hits.has(e.id));
    }
    entries.sort((a, b) => b.date.localeCompare(a.date));
    const total = entries.length;
    const page = entries.slice(offset, offset + PAGE_SIZE);
    const result = await buildLedgerRows(page, year);
    return { rows: result, total };
  }

  $effect(() => {
    const sub = liveQuery(() =>
      db.vendors.orderBy('name').toArray()
    ).subscribe((v) => {
      vendors = v;
    });
    return () => sub.unsubscribe();
  });

  $effect(() => {
    const yr = year;
    const mo = month;
    const q = descQuery;
    const aMin = amountMinQuery;
    const aMax = amountMaxQuery;
    const vid = vendorIdQuery;
    const off = pageOffset;
    const sub = liveQuery(() => fetchFiltered(yr, mo, q, aMin, aMax, vid, off)).subscribe(
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

  function applyAmountQuery() {
    amountMinQuery = amountMinInput.trim();
    amountMaxQuery = amountMaxInput.trim();
    pageOffset = 0;
    markLoading();
  }

  function onVendorChange() {
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
    amountMinInput = '';
    amountMaxInput = '';
    amountMinQuery = '';
    amountMaxQuery = '';
    vendorIdQuery = '';
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

  async function handleAttachmentFile(e: Event) {
    attachmentError = '';
    const input = e.target as HTMLInputElement;
    const f = input.files?.[0];
    if (!f) {
      return;
    }
    if (exceedsLimit(f.size, MAX_IMAGE_BYTES)) {
      attachmentError = m.common_file_too_large({ size: formatBytes(f.size), limit: formatBytes(MAX_IMAGE_BYTES) });
      input.value = '';
      return;
    }
    if (shouldConfirmAttachment(await getSetting('skipAttachmentConfirm'))) {
      pendingAttachmentFile = f;
      pendingAttachmentInput = input;
      attachmentPreview = URL.createObjectURL(f);
      attachmentConfirmOpen = true;
      return;
    }
    await saveAttachment(f);
    input.value = '';
  }

  async function saveAttachment(f: File): Promise<void> {
    const id = expandedId;
    if (!id) {
      return;
    }
    try {
      await db.attachments.add(buildAttachmentRecord(id, f, Date.now()));
    } catch (e) {
      attachmentError = e instanceof Error ? e.message : String(e);
    }
  }

  async function onAttachmentConfirm(dontAskAgain: boolean) {
    attachmentConfirmOpen = false;
    if (attachmentPreview) {
      URL.revokeObjectURL(attachmentPreview);
      attachmentPreview = null;
    }
    const f = pendingAttachmentFile;
    const input = pendingAttachmentInput;
    pendingAttachmentFile = null;
    pendingAttachmentInput = null;
    if (!f) {
      return;
    }
    if (dontAskAgain) {
      await setSetting('skipAttachmentConfirm', true);
    }
    await saveAttachment(f);
    if (input) {
      input.value = '';
    }
  }

  function onAttachmentCancel() {
    attachmentConfirmOpen = false;
    if (attachmentPreview) {
      URL.revokeObjectURL(attachmentPreview);
      attachmentPreview = null;
    }
    pendingAttachmentFile = null;
    if (pendingAttachmentInput) {
      pendingAttachmentInput.value = '';
      pendingAttachmentInput = null;
    }
  }

  function fmtTax(rate: number): string {
    if (rate === 0) {
      return m.journal_tax_exempt();
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
      <h2 class="text-2xl font-bold">{m.journal_list_title()}</h2>
      <p class="text-xs text-muted-foreground">{m.journal_list_subtitle()}</p>
    </div>
  </header>

  <section class="bg-card text-card-foreground rounded-xl p-5 space-y-4 shadow-sm">
    <div class="flex flex-wrap gap-3 items-end">
      <label class="block">
        <span class="text-xs text-muted-foreground">{m.journal_list_filter_year()}</span>
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
        <span class="text-xs text-muted-foreground">{m.journal_list_filter_month()}</span>
        <select
          bind:value={month}
          onchange={onMonthChange}
          class="mt-1 px-3 py-2 bg-background border rounded text-foreground"
        >
          <option value={null}>{m.journal_list_filter_month_all()}</option>
          {#each [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as mo (mo)}
            <option value={mo}>{m.journal_list_filter_month_label({ m: mo })}</option>
          {/each}
        </select>
      </label>
      <label class="block flex-1 min-w-48">
        <span class="text-xs text-muted-foreground">{m.journal_list_filter_description()}</span>
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
          placeholder={m.journal_list_filter_description_placeholder()}
          class="mt-1 w-full px-3 py-2 bg-background border rounded text-foreground"
        />
      </label>
      <label class="block">
        <span class="text-xs text-muted-foreground">{m.journal_list_filter_amount_min()}</span>
        <input
          type="number"
          value={amountMinInput}
          oninput={(e) => {
            amountMinInput = (e.target as HTMLInputElement).value;
          }}
          onkeydown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              applyAmountQuery();
            }
          }}
          onblur={applyAmountQuery}
          min="0"
          step="1"
          placeholder="0"
          class="mt-1 w-28 px-3 py-2 bg-background border rounded text-foreground tabular-nums text-right"
        />
      </label>
      <label class="block">
        <span class="text-xs text-muted-foreground">{m.journal_list_filter_amount_max()}</span>
        <input
          type="number"
          value={amountMaxInput}
          oninput={(e) => {
            amountMaxInput = (e.target as HTMLInputElement).value;
          }}
          onkeydown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              applyAmountQuery();
            }
          }}
          onblur={applyAmountQuery}
          min="0"
          step="1"
          placeholder="—"
          class="mt-1 w-28 px-3 py-2 bg-background border rounded text-foreground tabular-nums text-right"
        />
      </label>
      <label class="block">
        <span class="text-xs text-muted-foreground">{m.journal_list_filter_vendor()}</span>
        <select
          bind:value={vendorIdQuery}
          onchange={onVendorChange}
          class="mt-1 px-3 py-2 bg-background border rounded text-foreground max-w-56"
        >
          <option value="">{m.journal_list_filter_vendor_all()}</option>
          {#each vendors as v (v.id)}
            <option value={v.id}>{v.name}</option>
          {/each}
        </select>
      </label>
      <button
        type="button"
        onclick={resetFilters}
        class="px-4 py-2 border rounded hover:bg-accent text-sm"
      >
        {m.journal_list_filter_reset()}
      </button>
    </div>

    <div class="flex items-center justify-between text-xs text-muted-foreground">
      <span class="tabular-nums">
        {#if loading}
          {m.journal_list_loading()}
        {:else}
          {m.journal_list_pagination({ total: totalCount, current: currentPage, pages: totalPages })}
        {/if}
      </span>
      <div class="flex gap-2">
        <button
          type="button"
          disabled={!canPrev}
          onclick={gotoPrev}
          class="px-3 py-1 border rounded hover:bg-accent disabled:opacity-30"
        >
          {m.journal_list_pagination_prev()}
        </button>
        <button
          type="button"
          disabled={!canNext}
          onclick={gotoNext}
          class="px-3 py-1 border rounded hover:bg-accent disabled:opacity-30"
        >
          {m.journal_list_pagination_next()}
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
            <th class="text-left font-normal px-4 py-3">{m.journal_th_date()}</th>
            <th class="text-left font-normal px-4 py-3">{m.journal_th_description()}</th>
            <th class="text-left font-normal px-4 py-3">{m.journal_th_debit()}</th>
            <th class="text-left font-normal px-4 py-3">{m.journal_th_credit()}</th>
            <th class="text-right font-normal px-4 py-3">{m.journal_th_amount()}</th>
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
                        <div class="text-xs text-muted-foreground mb-1">{m.journal_side_debit()}</div>
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
                        <div class="text-xs text-muted-foreground mb-1">{m.journal_side_credit()}</div>
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

                    <div class="pt-2 border-t border-border/50">
                      <div class="text-xs text-muted-foreground mb-1">{m.journal_list_attachments_title()}</div>
                      {#if expandedAttachments.length > 0}
                        <ul class="flex flex-wrap gap-2 mb-2">
                          {#each expandedAttachments as a (a.id)}
                            <li>
                              <a
                                href={attachmentUrls.get(a.id)}
                                target="_blank"
                                rel="noopener noreferrer"
                                onclick={(e) => e.stopPropagation()}
                              >
                                <img src={attachmentUrls.get(a.id)} alt={a.fileName} class="h-16 w-16 object-cover rounded border" />
                              </a>
                            </li>
                          {/each}
                        </ul>
                      {:else}
                        <p class="text-xs text-muted-foreground mb-2">{m.journal_list_attachments_empty()}</p>
                      {/if}
                      <input
                        type="file"
                        accept="image/*"
                        onchange={handleAttachmentFile}
                        onclick={(e) => e.stopPropagation()}
                        class="text-xs text-muted-foreground"
                      />
                      {#if attachmentError}
                        <p class="mt-1 text-xs text-destructive">{attachmentError}</p>
                      {/if}
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
                          {m.journal_list_reverse_button()}
                        </button>
                      {:else}
                        <span class="text-xs text-muted-foreground">{m.journal_list_reversed_label()}</span>
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
        {m.journal_list_empty()}
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
      <AlertDialog.Title>{m.journal_list_reverse_confirm_title()}</AlertDialog.Title>
      <AlertDialog.Description>
        {m.journal_list_reverse_confirm_desc()}
      </AlertDialog.Description>
    </AlertDialog.Header>
    <AlertDialog.Footer>
      <AlertDialog.Cancel>{m.common_cancel()}</AlertDialog.Cancel>
      <AlertDialog.Action
        onclick={confirmReverse}
        class="bg-destructive text-destructive-foreground hover:bg-destructive/90"
      >
        {m.journal_list_reverse_button()}
      </AlertDialog.Action>
    </AlertDialog.Footer>
  </AlertDialog.Content>
</AlertDialog.Root>

<AttachmentConfirmDialog
  open={attachmentConfirmOpen}
  previewUrl={attachmentPreview}
  onconfirm={onAttachmentConfirm}
  oncancel={onAttachmentCancel}
/>