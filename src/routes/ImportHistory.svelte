<script lang="ts">
  import { liveQuery } from 'dexie';
  import { db } from '../db';
  import { reverseImportBatch } from '../domain/import-batch';
  import * as AlertDialog from '$lib/components/ui/alert-dialog';
  import type { ImportBatch, JournalEntry } from '../db/types';
  import { findParser } from '../parsers';
  import { formatJPY } from '../lib/decimal';
  import { m } from '../paraglide/messages';

  let batches = $state<ImportBatch[]>([]);
  let entriesByBatch = $state<Map<string, JournalEntry[]>>(new Map());
  let expandedId = $state<string | null>(null);
  let confirmingReverseId = $state<string | null>(null);
  let lastError = $state('');
  let lastSuccess = $state('');

  $effect(() => {
    const sub1 = liveQuery(() =>
      db.importBatches.orderBy('importedAt').reverse().toArray()
    ).subscribe((v) => {
      batches = v;
    });
    const sub2 = liveQuery(async () => {
      // sourceImportId 索引で走査（undefined キーの行はインデックスに載らないため、
      // CSV 由来の仕訳だけが返る。全件走査を避ける）。
      const imported = await db.journalEntries.orderBy('sourceImportId').toArray();
      const map = new Map<string, JournalEntry[]>();
      for (const e of imported) {
        if (!e.sourceImportId) {
          continue;
        }
        const arr = map.get(e.sourceImportId) ?? [];
        arr.push(e);
        map.set(e.sourceImportId, arr);
      }
      return map;
    }).subscribe((v) => {
      entriesByBatch = v;
    });
    return () => {
      sub1.unsubscribe();
      sub2.unsubscribe();
    };
  });

  function toggleExpand(id: string) {
    expandedId = expandedId === id ? null : id;
  }

  async function confirmReverse() {
    if (!confirmingReverseId) {
      return;
    }
    const id = confirmingReverseId;
    confirmingReverseId = null;
    lastError = '';
    lastSuccess = '';
    try {
      const r = await reverseImportBatch(id);
      lastSuccess = r.alreadyReversedCount > 0
        ? m.import_history_reverse_success_with_skipped({ count: r.reversedCount, skipped: r.alreadyReversedCount })
        : m.import_history_reverse_success({ count: r.reversedCount });
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
    }
  }

  function parserDisplayName(name: string): string {
    return findParser(name)?.displayName ?? name;
  }

  function batchStatus(batchId: string): { active: number; reversed: number } {
    const list = entriesByBatch.get(batchId) ?? [];
    let active = 0;
    let reversed = 0;
    for (const e of list) {
      if (e.status === 'reversed') {
        reversed++;
      } else {
        active++;
      }
    }
    return { active, reversed };
  }
</script>

<div class="space-y-6">
  <header>
    <h2 class="text-2xl font-bold">{m.import_history_title()}</h2>
    <p class="text-xs text-muted-foreground">{m.import_history_subtitle()}</p>
  </header>

  {#if lastError}
    <div class="border border-destructive bg-destructive/10 text-destructive rounded-lg px-4 py-2 text-sm">
      {lastError}
    </div>
  {/if}
  {#if lastSuccess}
    <div class="border border-primary bg-primary/10 text-foreground rounded-lg px-4 py-2 text-sm">
      ✓ {lastSuccess}
    </div>
  {/if}

  {#if batches.length === 0}
    <div class="bg-card text-card-foreground rounded-xl p-12 text-center shadow-sm">
      <p class="text-sm text-muted-foreground">{m.import_history_empty()}</p>
    </div>
  {:else}
    <div class="bg-card text-card-foreground rounded-xl shadow-sm overflow-hidden">
      <table class="w-full text-sm">
        <thead>
          <tr class="text-xs text-muted-foreground">
            <th class="text-left font-normal px-4 py-3 w-8"></th>
            <th class="text-left font-normal px-4 py-3">{m.import_history_th_imported_at()}</th>
            <th class="text-left font-normal px-4 py-3">{m.import_history_th_parser()}</th>
            <th class="text-left font-normal px-4 py-3">{m.import_history_th_filename()}</th>
            <th class="text-right font-normal px-4 py-3">{m.import_history_th_count()}</th>
            <th class="text-left font-normal px-4 py-3">{m.import_history_th_status()}</th>
          </tr>
        </thead>
        <tbody>
          {#each batches as batch (batch.id)}
            {@const expanded = expandedId === batch.id}
            {@const { active, reversed } = batchStatus(batch.id)}
            {@const entries = entriesByBatch.get(batch.id) ?? []}
            <tr
              class="border-t border-border/50 hover:bg-accent/30 transition-colors cursor-pointer"
              onclick={() => toggleExpand(batch.id)}
            >
              <td class="px-4 py-3 text-muted-foreground">
                {expanded ? '▾' : '▸'}
              </td>
              <td class="px-4 py-3 text-muted-foreground tabular-nums whitespace-nowrap">
                {new Date(batch.importedAt).toLocaleString('ja-JP')}
              </td>
              <td class="px-4 py-3">{parserDisplayName(batch.parserName)}</td>
              <td class="px-4 py-3 font-mono text-xs break-all">{batch.fileName}</td>
              <td class="px-4 py-3 text-right tabular-nums whitespace-nowrap">{batch.rowCount}</td>
              <td class="px-4 py-3 text-xs">
                {#if reversed === 0}
                  <span class="text-foreground">{m.import_history_status_active({ n: active })}</span>
                {:else if active === 0}
                  <span class="text-muted-foreground">{m.import_history_status_all_reversed()}</span>
                {:else}
                  <span class="text-foreground">{m.import_history_status_mixed({ active, reversed })}</span>
                {/if}
              </td>
            </tr>
            {#if expanded}
              <tr class="border-t border-border/50 bg-background/40">
                <td colspan="6" class="px-4 py-4">
                  {#if entries.length > 0}
                    <ul class="space-y-1 mb-3">
                      {#each entries as e (e.id)}
                        <li class="flex items-center justify-between text-sm">
                          <span>
                            <span class="text-muted-foreground tabular-nums mr-2">{e.date}</span>
                            <span class:line-through={e.status === 'reversed'} class:opacity-60={e.status === 'reversed'}>
                              {e.description}
                            </span>
                          </span>
                          <span class="text-xs text-muted-foreground font-mono">{e.id}</span>
                        </li>
                      {/each}
                    </ul>
                  {:else}
                    <p class="text-xs text-muted-foreground mb-3">{m.import_history_no_entries()}</p>
                  {/if}

                  {#if active > 0}
                    <button
                      type="button"
                      onclick={(ev) => {
                        ev.stopPropagation();
                        confirmingReverseId = batch.id;
                      }}
                      class="px-3 py-1 text-sm border border-destructive/50 text-destructive rounded hover:bg-destructive/10"
                    >
                      {m.import_history_batch_reverse_button({ count: active })}
                    </button>
                  {:else}
                    <span class="text-xs text-muted-foreground">{m.import_history_batch_already_reversed()}</span>
                  {/if}
                </td>
              </tr>
            {/if}
          {/each}
        </tbody>
      </table>
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
      <AlertDialog.Title>{m.import_history_reverse_confirm_title()}</AlertDialog.Title>
      <AlertDialog.Description>
        {m.import_history_reverse_confirm_desc()}
      </AlertDialog.Description>
    </AlertDialog.Header>
    <AlertDialog.Footer>
      <AlertDialog.Cancel>{m.common_cancel()}</AlertDialog.Cancel>
      <AlertDialog.Action
        onclick={confirmReverse}
        class="bg-destructive text-destructive-foreground hover:bg-destructive/90"
      >
        {m.import_history_reverse_confirm_action()}
      </AlertDialog.Action>
    </AlertDialog.Footer>
  </AlertDialog.Content>
</AlertDialog.Root>