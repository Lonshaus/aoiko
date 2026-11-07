<script lang="ts">
  import { onMount } from 'svelte';
  import { SvelteMap } from 'svelte/reactivity';
  import type { LineSide } from '../db/types';
  import { loadAccountsForYear } from '../db/year-accounts';
  import { UNSAFE_CHARS } from '../domain/data-check';
  import {
    correctEntryDate,
    entryDateFixYears,
    isExistingDate,
    listUnreadableDateEntries,
    type UnreadableDateEntry,
  } from '../domain/entry-date-fix';
  import { clip } from '../domain/restore-schema';
  import { formatJPY } from '../lib/decimal';
  import { filedYearGuard } from '../lib/filed-year-guard.svelte';
  import { describeStorageError } from '../lib/storage-error';
  import { m } from '../paraglide/messages';
  import { normalizeDate } from '../parsers/_helpers';
  import { dataCheck } from '../stores/data-check.svelte';
  import { ledger } from '../stores/ledger.svelte';

  let items = $state<UnreadableDateEntry[]>([]);
  let accountNames = $state<Record<string, string>>({});
  const dates = new SvelteMap<string, string>();
  const errors = new SvelteMap<string, string>();
  let busy = $state(false);
  let done = $state(false);

  onMount(() => {
    void load();
  });
  // 読めなければ一覧を出さない。
  async function load(): Promise<void> {
    try {
      const list = await listUnreadableDateEntries();
      const accounts = await loadAccountsForYear(ledger.currentYear);
      accountNames = Object.fromEntries(accounts.map((a) => [a.code, a.name]));
      for (const item of list) {
        if (!dates.has(item.entry.id)) {
          dates.set(item.entry.id, initialDate(item.entry.date));
        }
      }
      items = list;
    } catch {
      items = [];
    }
  }

  function initialDate(stored: string): string {
    try {
      const normalized = normalizeDate(stored);
      return isExistingDate(normalized) ? normalized : '';
    } catch {
      return '';
    }
  }

  function shownDate(stored: string): string {
    return stored === '' ? m.entry_date_fix_empty() : clip(stored).replace(UNSAFE_CHARS, '?');
  }
  // 明細は id の順で届くので、帳簿の書き方に合わせて借方を先に並べる。
  function debitFirst<T extends { side: LineSide }>(lines: readonly T[]): T[] {
    return [...lines].sort((a, b) => (a.side === b.side ? 0 : a.side === 'debit' ? -1 : 1));
  }

  function sideLabel(side: LineSide): string {
    return side === 'debit' ? m.journal_side_debit() : m.journal_side_credit();
  }

  async function register(item: UnreadableDateEntry): Promise<void> {
    const id = item.entry.id;
    const date = dates.get(id) ?? '';
    if (busy || date === '') {
      return;
    }
    busy = true;
    errors.delete(id);
    try {
      const consent = await filedYearGuard.confirm(entryDateFixYears(item.entry, date));
      if (!consent) {
        busy = false;
        return;
      }
      await correctEntryDate(id, date, { allowedFiledYears: consent });
      done = true;
      await load();
      void dataCheck.rerun();
    } catch (e) {
      errors.set(id, describeStorageError(e));
    }
    busy = false;
  }
</script>

{#if items.length > 0 || done}
  <div class="space-y-3 border-t pt-4">
    {#if items.length > 0}
      <h4 class="font-medium">{m.entry_date_fix_title()}</h4>
      <p class="text-xs text-muted-foreground">{m.entry_date_fix_intro()}</p>
      <ul class="space-y-3 text-sm">
        {#each items as item (item.entry.id)}
          <li class="space-y-2 border rounded p-3">
            <div class="break-all">
              {m.entry_date_fix_original_date({ date: shownDate(item.entry.date) })}
            </div>
            {#if item.attachmentCount > 0}
              <div class="text-xs text-muted-foreground">
                {m.entry_date_fix_attachments({ count: item.attachmentCount })}
              </div>
            {/if}
            <div class="break-all">{item.entry.description}</div>
            <ul class="text-xs text-muted-foreground space-y-0.5">
              {#each debitFirst(item.lines) as line (line.id)}
                <li class="flex flex-wrap gap-x-2">
                  <span>{sideLabel(line.side)}</span>
                  <span>{line.accountCode} {accountNames[line.accountCode] ?? ''}</span>
                  <span class="tabular-nums">{formatJPY(line.amount)}</span>
                </li>
              {/each}
            </ul>
            <div class="flex flex-wrap items-end gap-2">
              <label class="block">
                <span class="text-xs text-muted-foreground">{m.entry_date_fix_new_date()}</span>
                <input
                  type="date"
                  value={dates.get(item.entry.id) ?? ''}
                  oninput={(e) => dates.set(item.entry.id, e.currentTarget.value)}
                  class="mt-1 block px-3 py-2 bg-background border rounded text-foreground tabular-nums supports-[-webkit-touch-callout:none]:appearance-none [&::-webkit-date-and-time-value]:text-left"
                />
              </label>
              <button
                type="button"
                onclick={() => void register(item)}
                disabled={busy || (dates.get(item.entry.id) ?? '') === ''}
                class="px-4 py-2 border rounded hover:bg-accent hover:text-accent-foreground disabled:opacity-50"
              >
                {m.entry_date_fix_action()}
              </button>
            </div>
            {#if errors.has(item.entry.id)}
              <p class="text-xs text-destructive">{errors.get(item.entry.id)}</p>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
    {#if done}
      <p class="text-sm">{m.entry_date_fix_done()}</p>
    {/if}
  </div>
{/if}
