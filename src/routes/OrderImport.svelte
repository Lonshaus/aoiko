<script lang="ts">
  import { db } from '../db';
  import { validateLines } from '../domain/journal';
  import { shouldConfirmExternalSend } from '../domain/send-confirm';
  import { D, formatJPY, toIndexable } from '../lib/decimal';
  import { newId } from '../lib/id';
  import {
    createOrderExtractor,
    type OrderExtractor,
  } from '../lib/order-extractor';
  import { getSetting, setSetting } from '../lib/settings';
  import { ledger } from '../stores/ledger.svelte';
  import type { JournalLine } from '../db/types';
  import type { OrderExtracted, OrderItem } from '../domain/order-extract';
  import CloudSendConfirmDialog from '../components/CloudSendConfirmDialog.svelte';
  import { m } from '../paraglide/messages';

  type ReviewItem = OrderItem & { accountCode: string };

  let pastedText = $state('');
  let processing = $state(false);
  let error = $state('');
  let success = $state('');

  let extracted = $state<OrderExtracted | null>(null);
  let reviewItems = $state<ReviewItem[]>([]);
  let paymentAccount = $state('2120'); // 未払金（クレカ既定）

  let confirmOpen = $state(false);
  let pending = $state<{ extractor: OrderExtractor; text: string; host: string } | null>(null);

  const accountGroups = $derived(ledger.groupedAccounts());
  // 既定の経費科目 = 消耗品費（5200）。無ければ最初の expense を使う
  function defaultExpenseAccount(): string {
    for (const g of accountGroups) {
      if (g.category === 'expense') {
        for (const a of g.items) {
          if (a.code === '5200') {
            return '5200';
          }
        }
        if (g.items[0]) {
          return g.items[0].code;
        }
      }
    }
    return '5910'; // fallback: 雑費
  }

  async function analyze() {
    if (!pastedText.trim()) {
      error = m.order_text_required();
      return;
    }
    processing = true;
    error = '';
    success = '';
    try {
      const extractor = await createOrderExtractor();
      const skip = await getSetting('skipExternalSendConfirm');
      if (
        shouldConfirmExternalSend(
          { external: extractor.external, host: extractor.destinationHost },
          skip
        )
      ) {
        pending = { extractor, text: pastedText, host: extractor.destinationHost };
        confirmOpen = true;
        return;
      }
      await runExtract(extractor, pastedText);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      processing = false;
    }
  }

  async function runExtract(extractor: OrderExtractor, text: string) {
    try {
      const result = await extractor.extract(text);
      extracted = result;
      const def = defaultExpenseAccount();
      reviewItems = result.items.map((it) => ({ ...it, accountCode: def }));
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      processing = false;
    }
  }

  async function onConfirmSend(dontAskAgain: boolean) {
    confirmOpen = false;
    const p = pending;
    pending = null;
    if (!p) {
      processing = false;
      return;
    }
    if (dontAskAgain) {
      await setSetting('skipExternalSendConfirm', true);
    }
    await runExtract(p.extractor, p.text);
  }

  function onCancelSend() {
    confirmOpen = false;
    pending = null;
    processing = false;
  }

  function removeItem(idx: number) {
    reviewItems = reviewItems.filter((_, i) => i !== idx);
  }

  function addItem() {
    reviewItems = [
      ...reviewItems,
      { description: '', amount: '0', accountCode: defaultExpenseAccount() },
    ];
  }

  async function commit() {
    if (!extracted) {
      return;
    }
    const data = extracted;
    error = '';
    success = '';
    if (!data.date || !/^\d{4}-\d{2}-\d{2}$/.test(data.date)) {
      error = m.order_amount_required();
      return;
    }
    if (!data.totalAmount || !/^\d+$/.test(data.totalAmount)) {
      error = m.order_amount_required();
      return;
    }
    const validItems = reviewItems.filter(
      (it) => it.description.trim() !== '' && /^-?\d+$/.test(it.amount)
    );
    if (validItems.length === 0) {
      error = m.order_no_items();
      return;
    }
    // 品目合計と総額の照合（差異があれば総額を信用しユーザに警告）
    const itemsSum = validItems.reduce((s, it) => s.plus(D(it.amount)), D(0));
    const total = D(data.totalAmount);
    if (!itemsSum.equals(total)) {
      const ok = confirm(
        m.order_total_mismatch({
          itemSum: formatJPY(itemsSum.toString()),
          total: formatJPY(data.totalAmount),
        })
      );
      if (!ok) {
        return;
      }
    }

    try {
      const entryId = newId();
      const now = Date.now();
      const lines: JournalLine[] = [];
      // 各品目：正値 → debit、負値（値引）→ credit
      for (const it of validItems) {
        const amount = D(it.amount);
        const abs = amount.abs().toString();
        const side = amount.isNegative() ? 'credit' : 'debit';
        lines.push({
          id: newId(),
          entryId,
          side,
          accountCode: it.accountCode,
          amount: abs,
          amountIndexed: toIndexable(abs),
          taxRate: amount.isNegative() ? 0 : 0.1,
          taxIncluded: true,
          invoiceCompliant: false,
        });
      }
      // 支払元（既定：未払金）への credit 1 行
      lines.push({
        id: newId(),
        entryId,
        side: 'credit',
        accountCode: paymentAccount,
        amount: data.totalAmount,
        amountIndexed: toIndexable(data.totalAmount),
        taxRate: 0,
        taxIncluded: true,
        invoiceCompliant: false,
      });
      validateLines(lines);

      const description = data.vendor
        ? data.orderNumber
          ? `${data.vendor} ${data.orderNumber}`
          : data.vendor
        : m.order_default_description();

      await db.transaction(
        'rw',
        [db.journalEntries, db.journalLines],
        async () => {
          await db.journalEntries.add({
            id: entryId,
            date: data.date,
            year: Number(data.date.slice(0, 4)),
            description,
            status: 'confirmed',
            source: 'paste',
            createdAt: now,
            confirmedAt: now,
          });
          await db.journalLines.bulkAdd(lines);
        }
      );

      success = m.order_success({
        name: description,
        amount: formatJPY(data.totalAmount),
        count: String(validItems.length),
      });
      reset();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }

  function reset() {
    extracted = null;
    reviewItems = [];
    pastedText = '';
    error = '';
  }
</script>

<div class="space-y-6">
  <header>
    <h2 class="text-2xl font-bold">{m.order_title()}</h2>
    <p class="text-xs text-muted-foreground">
      {m.order_subtitle()}
    </p>
  </header>

  <section class="bg-card text-card-foreground rounded-xl p-6 space-y-4 shadow-sm">
    <label class="block">
      <span class="text-xs text-muted-foreground">{m.order_step_paste()}</span>
      <textarea
        bind:value={pastedText}
        placeholder={m.order_paste_placeholder()}
        rows="10"
        class="mt-1 w-full px-3 py-2 bg-background border rounded text-foreground text-sm font-mono"
      ></textarea>
    </label>

    {#if !extracted}
      <button
        type="button"
        onclick={analyze}
        disabled={processing}
        class="px-4 py-2 bg-primary text-primary-foreground rounded hover:opacity-90 disabled:opacity-50"
      >
        {processing ? m.order_analyze_running() : m.order_analyze_button()}
      </button>
    {/if}

    {#if error}
      <div class="border border-destructive bg-destructive/10 text-destructive rounded-lg px-3 py-2 text-sm">
        {error}
      </div>
    {/if}
    {#if success}
      <div class="border border-primary bg-primary/10 text-foreground rounded-lg px-3 py-2 text-sm">
        {success}
      </div>
    {/if}
  </section>

  {#if extracted}
    <section class="bg-card text-card-foreground rounded-xl p-6 space-y-4 shadow-sm">
      <h3 class="text-lg font-semibold">{m.order_step_review()}</h3>

      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <label class="block">
          <span class="text-xs text-muted-foreground">{m.order_label_date()}</span>
          <input
            type="date"
            bind:value={extracted.date}
            class="mt-1 w-full px-3 py-2 bg-background border rounded text-foreground tabular-nums"
          />
        </label>
        <label class="block">
          <span class="text-xs text-muted-foreground">{m.order_label_vendor()}</span>
          <input
            type="text"
            bind:value={extracted.vendor}
            class="mt-1 w-full px-3 py-2 bg-background border rounded text-foreground"
          />
        </label>
        <label class="block">
          <span class="text-xs text-muted-foreground">{m.order_label_order_number()}</span>
          <input
            type="text"
            bind:value={extracted.orderNumber}
            class="mt-1 w-full px-3 py-2 bg-background border rounded text-foreground font-mono text-sm"
          />
        </label>
        <label class="block">
          <span class="text-xs text-muted-foreground">{m.order_label_total()}</span>
          <input
            type="number"
            value={extracted.totalAmount}
            oninput={(e) => {
              if (extracted) {
                extracted.totalAmount = (e.target as HTMLInputElement).value;
              }
            }}
            min="0"
            step="1"
            class="mt-1 w-full px-3 py-2 bg-background border rounded text-right text-foreground tabular-nums"
          />
        </label>
      </div>

      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead>
            <tr class="text-xs text-muted-foreground border-b">
              <th class="text-left font-normal px-2 py-2">{m.order_th_description()}</th>
              <th class="text-right font-normal px-2 py-2 w-32">{m.order_th_amount()}</th>
              <th class="text-left font-normal px-2 py-2 w-64">{m.order_th_account()}</th>
              <th class="px-2 py-2 w-12"></th>
            </tr>
          </thead>
          <tbody>
            {#each reviewItems as item, i (i)}
              <tr class="border-b border-border/30">
                <td class="px-2 py-2">
                  <input
                    type="text"
                    bind:value={item.description}
                    class="w-full px-2 py-1 bg-background border rounded text-foreground"
                  />
                </td>
                <td class="px-2 py-2">
                  <input
                    type="number"
                    value={item.amount}
                    oninput={(e) => {
                      item.amount = (e.target as HTMLInputElement).value;
                    }}
                    step="1"
                    class="w-full px-2 py-1 bg-background border rounded text-right text-foreground tabular-nums"
                  />
                </td>
                <td class="px-2 py-2">
                  <select
                    bind:value={item.accountCode}
                    class="w-full px-2 py-1 bg-background border rounded text-foreground text-xs"
                  >
                    {#each accountGroups as group (group.category)}
                      <optgroup label={group.label}>
                        {#each group.items as a (a.code)}
                          <option value={a.code}>{a.code} {a.name}</option>
                        {/each}
                      </optgroup>
                    {/each}
                  </select>
                </td>
                <td class="px-2 py-2">
                  <button
                    type="button"
                    onclick={() => removeItem(i)}
                    class="text-destructive hover:opacity-70 text-xs"
                    aria-label={m.order_item_remove()}
                  >
                    ✕
                  </button>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
        <button
          type="button"
          onclick={addItem}
          class="mt-2 px-3 py-1 border rounded hover:bg-accent text-xs"
        >
          + {m.order_item_add()}
        </button>
      </div>

      <div class="pt-4 border-t border-border/50">
        <label class="block max-w-md">
          <span class="text-xs text-muted-foreground">{m.order_label_payment_account()}</span>
          <select
            bind:value={paymentAccount}
            class="mt-1 w-full px-3 py-2 bg-background border rounded text-foreground"
          >
            {#each accountGroups as group (group.category)}
              <optgroup label={group.label}>
                {#each group.items as a (a.code)}
                  <option value={a.code}>{a.code} {a.name}</option>
                {/each}
              </optgroup>
            {/each}
          </select>
        </label>
      </div>

      <div class="flex justify-end gap-2">
        <button
          type="button"
          onclick={reset}
          class="px-4 py-2 border rounded hover:bg-accent"
        >
          {m.common_cancel()}
        </button>
        <button
          type="button"
          onclick={commit}
          class="px-4 py-2 bg-primary text-primary-foreground rounded hover:opacity-90"
        >
          {m.order_submit()}
        </button>
      </div>
    </section>
  {/if}
</div>

<CloudSendConfirmDialog
  open={confirmOpen}
  host={pending?.host ?? ''}
  onconfirm={onConfirmSend}
  oncancel={onCancelSend}
/>