<script lang="ts">
  import { ledger } from '../stores/ledger.svelte';
  import { formatJPY } from '../lib/decimal';
  import JournalEntryForm from './JournalEntryForm.svelte';
  import BackupNotice from '../components/BackupNotice.svelte';

  const overview = $derived(ledger.monthlyOverview);
  const isPositive = $derived(Number(overview.netIncome) >= 0);
</script>

<div class="space-y-8">
  <BackupNotice />

  <section class="bg-card text-card-foreground rounded-2xl p-8 space-y-6 shadow-sm">
    <header class="flex items-end justify-between">
      <div>
        <div class="text-xs text-muted-foreground">今月の概況</div>
        <div class="text-lg font-semibold tabular-nums">
          {overview.year} 年 {overview.month} 月
        </div>
      </div>
      <div class="text-xs text-muted-foreground tabular-nums">
        仕訳 {overview.entryCount} 件
      </div>
    </header>
    <div class="grid grid-cols-3 gap-8">
      <div>
        <div class="text-xs text-muted-foreground mb-1">売上</div>
        <div class="text-3xl font-bold tabular-nums">{formatJPY(overview.revenue)}</div>
      </div>
      <div>
        <div class="text-xs text-muted-foreground mb-1">経費</div>
        <div class="text-3xl font-bold tabular-nums">{formatJPY(overview.expense)}</div>
      </div>
      <div>
        <div class="text-xs text-muted-foreground mb-1">想定所得</div>
        <div
          class="text-3xl font-bold tabular-nums"
          class:text-destructive={!isPositive}
        >
          {formatJPY(overview.netIncome)}
        </div>
      </div>
    </div>
  </section>

  <JournalEntryForm />

  <section class="space-y-3">
    <header class="flex items-baseline justify-between">
      <h2 class="text-lg font-semibold">直近の仕訳</h2>
      {#if ledger.recentLedgerRows.length > 0}
        <span class="text-xs text-muted-foreground">
          直近 {ledger.recentLedgerRows.length} 件
        </span>
      {/if}
    </header>

    {#if ledger.recentLedgerRows.length > 0}
      <div class="bg-card text-card-foreground rounded-xl overflow-hidden shadow-sm">
        <table class="w-full text-sm">
          <thead>
            <tr class="text-xs text-muted-foreground">
              <th class="text-left font-normal px-4 py-3">日付</th>
              <th class="text-left font-normal px-4 py-3">摘要</th>
              <th class="text-left font-normal px-4 py-3">借方科目</th>
              <th class="text-left font-normal px-4 py-3">貸方科目</th>
              <th class="text-right font-normal px-4 py-3">金額</th>
            </tr>
          </thead>
          <tbody>
            {#each ledger.recentLedgerRows as row (row.entry.id)}
              {@const reversed = row.entry.status === 'reversed'}
              {@const isCorrection = !!row.entry.originalEntryId}
              <tr
                class="border-t border-border/50 hover:bg-accent/30 transition-colors"
                class:opacity-60={reversed}
              >
                <td class="px-4 py-3 text-muted-foreground tabular-nums whitespace-nowrap">
                  {row.entry.date}
                </td>
                <td class="px-4 py-3">
                  <span class:line-through={reversed}>{row.entry.description}</span>
                  {#if isCorrection}<span class="ml-2 text-xs text-muted-foreground">↩</span>{/if}
                </td>
                <td class="px-4 py-3">
                  {#if row.debits[0]}
                    <span>{row.debits[0].name}</span>
                    {#if row.debits.length > 1}
                      <span class="text-xs text-muted-foreground ml-1">+{row.debits.length - 1}</span>
                    {/if}
                  {:else}
                    <span class="text-muted-foreground">—</span>
                  {/if}
                </td>
                <td class="px-4 py-3">
                  {#if row.credits[0]}
                    <span>{row.credits[0].name}</span>
                    {#if row.credits.length > 1}
                      <span class="text-xs text-muted-foreground ml-1">+{row.credits.length - 1}</span>
                    {/if}
                  {:else}
                    <span class="text-muted-foreground">—</span>
                  {/if}
                </td>
                <td class="px-4 py-3 text-right tabular-nums font-medium whitespace-nowrap">
                  {formatJPY(row.totalAmount)}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {:else}
      <div class="bg-card text-card-foreground rounded-xl p-12 text-center shadow-sm">
        <p class="text-sm text-muted-foreground">
          今月の仕訳、まだ 0 件だよ。最初の一歩、書いてみる？
        </p>
      </div>
    {/if}
  </section>
</div>