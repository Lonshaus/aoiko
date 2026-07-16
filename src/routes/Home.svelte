<script lang="ts">
  import { ledger } from '../stores/ledger.svelte';
  import { D, formatJPY } from '../lib/decimal';
  import JournalEntryForm from './JournalEntryForm.svelte';
  import BackupNotice from '../components/BackupNotice.svelte';
  import { m } from '../paraglide/messages';

  const overview = $derived(ledger.monthlyOverview);
  const isPositive = $derived(!D(overview.netIncome).isNegative());
</script>

<div class="space-y-8">
  <BackupNotice />

  <section class="bg-card text-card-foreground rounded-2xl p-8 space-y-6 shadow-sm">
    <header class="flex items-end justify-between">
      <div>
        <div class="text-xs text-muted-foreground">{m.home_overview_label()}</div>
        <div class="text-lg font-semibold tabular-nums">
          {m.home_overview_year_month({ year: overview.year, month: overview.month })}
        </div>
      </div>
      <div class="text-xs text-muted-foreground tabular-nums">
        {m.home_overview_entry_count({ count: overview.entryCount })}
      </div>
    </header>
    <div class="grid grid-cols-1 gap-4 sm:grid-cols-3 sm:gap-8">
      <div>
        <div class="text-xs text-muted-foreground mb-1">{m.home_overview_revenue()}</div>
        <div class="text-3xl font-bold tabular-nums">{formatJPY(overview.revenue)}</div>
      </div>
      <div>
        <div class="text-xs text-muted-foreground mb-1">{m.home_overview_expense()}</div>
        <div class="text-3xl font-bold tabular-nums">{formatJPY(overview.expense)}</div>
      </div>
      <div>
        <div class="text-xs text-muted-foreground mb-1">{m.home_overview_income()}</div>
        <div class="text-3xl font-bold tabular-nums" class:text-destructive={!isPositive}>
          {formatJPY(overview.netIncome)}
        </div>
      </div>
    </div>
  </section>

  <JournalEntryForm />

  <section class="space-y-3">
    <header class="flex items-baseline justify-between">
      <h2 class="text-lg font-semibold">{m.home_recent_title()}</h2>
      {#if ledger.recentLedgerRows.length > 0}
        <span class="text-xs text-muted-foreground">
          {m.home_recent_count({ count: ledger.recentLedgerRows.length })}
        </span>
      {/if}
    </header>

    {#if ledger.recentLedgerRows.length > 0}
      <div class="bg-card text-card-foreground rounded-xl overflow-x-auto shadow-sm">
        <table class="w-full text-sm">
          <thead>
            <tr class="text-xs text-muted-foreground">
              <th class="text-left font-normal px-4 py-3">{m.home_recent_th_date()}</th>
              <th class="text-left font-normal px-4 py-3">{m.home_recent_th_description()}</th>
              <th class="text-left font-normal px-4 py-3">{m.home_recent_th_debit()}</th>
              <th class="text-left font-normal px-4 py-3">{m.home_recent_th_credit()}</th>
              <th class="text-right font-normal px-4 py-3">{m.home_recent_th_amount()}</th>
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
                      <span class="text-xs text-muted-foreground ml-1"
                        >+{row.debits.length - 1}</span
                      >
                    {/if}
                  {:else}
                    <span class="text-muted-foreground">—</span>
                  {/if}
                </td>
                <td class="px-4 py-3">
                  {#if row.credits[0]}
                    <span>{row.credits[0].name}</span>
                    {#if row.credits.length > 1}
                      <span class="text-xs text-muted-foreground ml-1"
                        >+{row.credits.length - 1}</span
                      >
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
          {m.home_recent_empty()}
        </p>
      </div>
    {/if}
  </section>
</div>
