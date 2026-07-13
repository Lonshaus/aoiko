<script lang="ts">
  import { liveQuery } from 'dexie';
  import { db } from '../db/db';
  import { newId } from '../lib/id';
  import { todayISO } from '../lib/date';
  import { D, formatJPY } from '../lib/decimal';
  import { getSetting } from '../lib/settings';
  import { ledger } from '../stores/ledger.svelte';
  import {
    convertQuoteToInvoiceDraft,
    createDraftInvoice,
    DEFAULT_INVOICE_PREFIX,
    DEFAULT_QUOTE_PREFIX,
    groupLineItemsByTaxRate,
    invoiceTotal,
    issueInvoice,
    newLineItem,
    voidInvoice,
  } from '../domain/invoice';
  import { m } from '../paraglide/messages';
  import type { Invoice, InvoiceDocumentType } from '../db/types';
  import * as AlertDialog from '$lib/components/ui/alert-dialog';

  let tab = $state<InvoiceDocumentType>('invoice');
  let invoices = $state<Invoice[]>([]);
  let editing = $state<Invoice | null>(null);
  let printingId = $state<string | null>(null);
  let errorMessage = $state('');
  let confirmingDelete = $state(false);
  let pendingDeleteId = $state<string | null>(null);
  let pendingDeleteName = $state('');
  // 変換元の見積書 id。保存/発行が成功した時点で見積書側に convertedToInvoiceId を書き戻す
  // （下書きのまま破棄された場合は書き戻さない＝再変換できる）。
  let convertingFromQuoteId = $state<string | null>(null);

  let issuerName = $state('');
  let issuerInvoiceNumber = $state('');
  let issuerAddress = $state('');
  let taxRegistration = $state('taxable');

  $effect(() => {
    const sub = liveQuery(() => db.invoices.toArray()).subscribe((v) => {
      invoices = v;
    });
    return () => sub.unsubscribe();
  });

  $effect(() => {
    if (!printingId) {
      return;
    }
    const handle = () => {
      printingId = null;
    };
    window.addEventListener('afterprint', handle);
    requestAnimationFrame(() => window.print());
    return () => window.removeEventListener('afterprint', handle);
  });

  async function loadIssuerInfo() {
    issuerName = (await getSetting('userBusinessName')) ?? '';
    issuerInvoiceNumber = (await getSetting('userInvoiceNumber')) ?? '';
    issuerAddress = (await getSetting('userFilerAddress')) ?? '';
    taxRegistration = (await getSetting('taxRegistration')) ?? 'taxable';
  }
  loadIssuerInfo();

  const filtered = $derived(
    invoices.filter((inv) => inv.documentType === tab).sort((a, b) => (a.date < b.date ? 1 : -1)),
  );

  function vendorName(vendorId: string): string {
    return ledger.vendors.find((v) => v.id === vendorId)?.name ?? '';
  }

  function statusLabel(status: Invoice['status']): string {
    if (status === 'draft') {
      return m.invoices_status_draft();
    }
    if (status === 'issued') {
      return m.invoices_status_issued();
    }
    return m.invoices_status_voided();
  }

  function startNew() {
    errorMessage = '';
    convertingFromQuoteId = null;
    editing = createDraftInvoice(tab, ledger.vendors[0]?.id ?? '', todayISO());
  }

  function openEdit(inv: Invoice) {
    errorMessage = '';
    convertingFromQuoteId = null;
    editing = structuredClone(inv);
  }

  function closeForm() {
    editing = null;
    convertingFromQuoteId = null;
  }

  function addLine() {
    if (!editing) {
      return;
    }
    editing.lineItems = [...editing.lineItems, newLineItem()];
  }

  function removeLine(id: string) {
    if (!editing) {
      return;
    }
    editing.lineItems = editing.lineItems.filter((l) => l.id !== id);
  }

  async function saveDraft() {
    if (!editing) {
      return;
    }
    errorMessage = '';
    try {
      const snapshot = $state.snapshot(editing);
      await db.invoices.put(snapshot);
      if (convertingFromQuoteId) {
        await db.invoices.update(convertingFromQuoteId, { convertedToInvoiceId: snapshot.id });
      }
      editing = null;
      convertingFromQuoteId = null;
    } catch (e) {
      errorMessage = e instanceof Error ? e.message : String(e);
    }
  }

  async function issue() {
    if (!editing) {
      return;
    }
    errorMessage = '';
    try {
      const snapshot = $state.snapshot(editing);
      const prefix =
        tab === 'invoice'
          ? ((await getSetting('invoiceNumberPrefix')) ?? DEFAULT_INVOICE_PREFIX)
          : ((await getSetting('quoteNumberPrefix')) ?? DEFAULT_QUOTE_PREFIX);
      await issueInvoice(snapshot, prefix);
      if (convertingFromQuoteId) {
        await db.invoices.update(convertingFromQuoteId, { convertedToInvoiceId: snapshot.id });
      }
      editing = null;
      convertingFromQuoteId = null;
    } catch (e) {
      errorMessage = e instanceof Error ? e.message : String(e);
    }
  }

  async function deleteDraft(id: string) {
    await db.invoices.delete(id);
  }

  function askDeleteDraft(inv: Invoice) {
    pendingDeleteId = inv.id;
    pendingDeleteName = inv.number || m.invoices_status_draft();
    confirmingDelete = true;
  }

  async function runPendingDelete() {
    confirmingDelete = false;
    if (pendingDeleteId) {
      await deleteDraft(pendingDeleteId);
    }
    pendingDeleteId = null;
  }

  async function onVoid(id: string) {
    errorMessage = '';
    try {
      await voidInvoice(id);
    } catch (e) {
      errorMessage = e instanceof Error ? e.message : String(e);
    }
  }

  function convertToInvoice(quote: Invoice) {
    errorMessage = '';
    tab = 'invoice';
    convertingFromQuoteId = quote.id;
    editing = convertQuoteToInvoiceDraft(quote, todayISO());
  }

  function print(id: string) {
    printingId = id;
  }

  const printingInvoice = $derived(invoices.find((inv) => inv.id === printingId) ?? null);
  const printingGroups = $derived(
    printingInvoice ? groupLineItemsByTaxRate(printingInvoice.lineItems) : [],
  );
  const printingTotal = $derived(printingInvoice ? invoiceTotal(printingInvoice.lineItems) : D(0));
</script>

<div class="print:hidden space-y-6">
  <h2 class="text-xl font-semibold">{m.invoices_title()}</h2>

  {#if !editing}
    <div class="flex gap-2 border-b">
      <button
        type="button"
        onclick={() => (tab = 'invoice')}
        class="px-4 py-2 text-sm {tab === 'invoice'
          ? 'border-b-2 border-primary font-semibold'
          : 'text-muted-foreground'}"
      >
        {m.invoices_tab_invoice()}
      </button>
      <button
        type="button"
        onclick={() => (tab = 'quote')}
        class="px-4 py-2 text-sm {tab === 'quote'
          ? 'border-b-2 border-primary font-semibold'
          : 'text-muted-foreground'}"
      >
        {m.invoices_tab_quote()}
      </button>
    </div>

    <button
      type="button"
      onclick={startNew}
      class="px-4 py-2 bg-primary text-primary-foreground rounded hover:opacity-90"
    >
      {m.invoices_action_new()}
    </button>

    {#if errorMessage}
      <div class="text-sm text-destructive">{errorMessage}</div>
    {/if}

    {#if filtered.length > 0}
      <ul class="space-y-2">
        {#each filtered as inv (inv.id)}
          <li class="flex flex-wrap gap-3 items-center border rounded px-3 py-2 bg-card text-sm">
            <span class="font-mono text-xs text-muted-foreground min-w-32"
              >{inv.number || m.invoices_status_draft()}</span
            >
            <span class="min-w-32">{vendorName(inv.vendorId)}</span>
            <span class="text-xs text-muted-foreground">{inv.date}</span>
            <span class="font-mono">{formatJPY(invoiceTotal(inv.lineItems))}</span>
            <span class="text-xs px-2 py-0.5 rounded bg-muted">{statusLabel(inv.status)}</span>
            <div class="ml-auto flex gap-2">
              {#if inv.status === 'draft'}
                <button
                  type="button"
                  onclick={() => openEdit(inv)}
                  class="text-xs text-primary hover:underline"
                >
                  {m.invoices_action_edit()}
                </button>
                <button
                  type="button"
                  onclick={() => askDeleteDraft(inv)}
                  class="text-xs text-muted-foreground hover:text-destructive"
                >
                  {m.settings_action_delete()}
                </button>
              {:else}
                <button
                  type="button"
                  onclick={() => print(inv.id)}
                  class="text-xs text-primary hover:underline"
                >
                  {m.invoices_action_print()}
                </button>
                {#if inv.documentType === 'quote' && inv.status === 'issued' && !inv.convertedToInvoiceId}
                  <button
                    type="button"
                    onclick={() => convertToInvoice(inv)}
                    class="text-xs text-primary hover:underline"
                  >
                    {m.invoices_action_convert()}
                  </button>
                {/if}
                {#if inv.status === 'issued'}
                  <button
                    type="button"
                    onclick={() => onVoid(inv.id)}
                    class="text-xs text-muted-foreground hover:text-destructive"
                  >
                    {m.invoices_action_void()}
                  </button>
                {/if}
              {/if}
            </div>
          </li>
        {/each}
      </ul>
    {:else}
      <p class="text-sm text-muted-foreground">{m.invoices_empty()}</p>
    {/if}
  {:else}
    <div class="space-y-4 border rounded-lg p-6 bg-card">
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <label class="block">
          <span class="text-xs text-muted-foreground">{m.invoices_form_vendor()}</span>
          <select
            bind:value={editing.vendorId}
            class="mt-1 w-full px-3 py-2 bg-background border rounded text-foreground"
          >
            {#each ledger.vendors as v (v.id)}
              <option value={v.id}>{v.name}</option>
            {/each}
          </select>
        </label>
        <label class="block">
          <span class="text-xs text-muted-foreground">{m.invoices_form_date()}</span>
          <input
            type="date"
            bind:value={editing.date}
            class="mt-1 w-full px-3 py-2 bg-background border rounded text-foreground"
          />
        </label>
        {#if editing.documentType === 'invoice'}
          <label class="block">
            <span class="text-xs text-muted-foreground">{m.invoices_form_due_date()}</span>
            <input
              type="date"
              bind:value={editing.dueDate}
              class="mt-1 w-full px-3 py-2 bg-background border rounded text-foreground"
            />
          </label>
        {/if}
      </div>

      <div class="space-y-2">
        <span class="text-xs text-muted-foreground">{m.invoices_form_line_items()}</span>
        {#each editing.lineItems as item (item.id)}
          <div class="flex flex-wrap gap-2 items-center">
            <input
              type="text"
              bind:value={item.name}
              placeholder={m.invoices_form_item_name()}
              class="flex-1 min-w-32 px-3 py-2 bg-background border rounded text-foreground"
            />
            <input
              type="text"
              inputmode="decimal"
              bind:value={item.quantity}
              placeholder={m.invoices_form_item_quantity()}
              class="w-20 px-3 py-2 bg-background border rounded text-foreground"
            />
            <input
              type="text"
              inputmode="decimal"
              bind:value={item.unitPrice}
              placeholder={m.invoices_form_item_unit_price()}
              class="w-28 px-3 py-2 bg-background border rounded text-foreground"
            />
            <select
              bind:value={item.taxRate}
              class="px-3 py-2 bg-background border rounded text-foreground"
            >
              <option value={0.1}>10%</option>
              <option value={0.08}>8%</option>
            </select>
            <button
              type="button"
              onclick={() => removeLine(item.id)}
              class="text-xs text-muted-foreground hover:text-destructive"
            >
              {m.settings_action_delete()}
            </button>
          </div>
        {/each}
        <button type="button" onclick={addLine} class="text-xs text-primary hover:underline">
          {m.invoices_form_add_line()}
        </button>
      </div>

      <label class="block">
        <span class="text-xs text-muted-foreground">{m.invoices_form_memo()}</span>
        <textarea
          bind:value={editing.memo}
          class="mt-1 w-full px-3 py-2 bg-background border rounded text-foreground"
          rows="2"></textarea>
      </label>

      <div class="text-sm space-y-1">
        {#each groupLineItemsByTaxRate(editing.lineItems) as g (g.taxRate)}
          <div class="flex justify-between text-muted-foreground">
            <span>{m.invoices_form_subtotal_at_rate({ rate: g.taxRate * 100 })}</span>
            <span class="font-mono"
              >{formatJPY(g.subtotalExcl)} + {m.invoices_form_tax()} {formatJPY(g.taxAmount)}</span
            >
          </div>
        {/each}
        <div class="flex justify-between font-semibold">
          <span>{m.invoices_form_total()}</span>
          <span class="font-mono">{formatJPY(invoiceTotal(editing.lineItems))}</span>
        </div>
      </div>

      {#if errorMessage}
        <div class="text-sm text-destructive">{errorMessage}</div>
      {/if}

      <div class="flex gap-2">
        <button type="button" onclick={saveDraft} class="px-4 py-2 border rounded hover:bg-muted">
          {m.invoices_action_save_draft()}
        </button>
        <button
          type="button"
          onclick={issue}
          class="px-4 py-2 bg-primary text-primary-foreground rounded hover:opacity-90"
        >
          {m.invoices_action_issue()}
        </button>
        <button
          type="button"
          onclick={closeForm}
          class="ml-auto px-4 py-2 text-muted-foreground hover:text-foreground"
        >
          {m.settings_action_cancel()}
        </button>
      </div>
    </div>
  {/if}
</div>

{#if printingInvoice}
  <div class="hidden print:block p-8 text-black bg-white text-sm space-y-6">
    <h1 class="text-2xl font-bold text-center">
      {printingInvoice.documentType === 'invoice'
        ? m.invoices_print_title_invoice()
        : m.invoices_print_title_quote()}
    </h1>
    <div class="flex justify-between">
      <div>
        <p class="font-semibold">
          {vendorName(printingInvoice.vendorId)}
          {m.invoices_print_addressee_suffix()}
        </p>
        <p class="text-xs">
          {ledger.vendors.find((v) => v.id === printingInvoice.vendorId)?.address ?? ''}
        </p>
      </div>
      <div class="text-right text-xs">
        <p>{m.invoices_print_number()}: {printingInvoice.number}</p>
        <p>{m.invoices_print_date()}: {printingInvoice.date}</p>
      </div>
    </div>
    <div class="border-t pt-2 text-right text-xs space-y-1">
      <p class="font-semibold">{issuerName}</p>
      <p>{issuerAddress}</p>
      {#if taxRegistration === 'taxable' && issuerInvoiceNumber}
        <p>{m.invoices_print_registration_number()}: {issuerInvoiceNumber}</p>
      {/if}
    </div>
    <table class="w-full border-collapse text-xs">
      <thead>
        <tr class="border-b">
          <th class="text-left py-1">{m.invoices_form_item_name()}</th>
          <th class="text-right py-1">{m.invoices_form_item_quantity()}</th>
          <th class="text-right py-1">{m.invoices_form_item_unit_price()}</th>
          <th class="text-right py-1">{m.invoices_print_rate()}</th>
        </tr>
      </thead>
      <tbody>
        {#each printingInvoice.lineItems as item (item.id)}
          <tr class="border-b">
            <td class="py-1">{item.name}</td>
            <td class="text-right py-1">{item.quantity}</td>
            <td class="text-right py-1 font-mono">{formatJPY(item.unitPrice)}</td>
            <td class="text-right py-1">{item.taxRate * 100}%</td>
          </tr>
        {/each}
      </tbody>
    </table>
    <div class="text-xs space-y-1">
      {#each printingGroups as g (g.taxRate)}
        <div class="flex justify-between">
          <span>{m.invoices_form_subtotal_at_rate({ rate: g.taxRate * 100 })}</span>
          <span class="font-mono">{formatJPY(g.subtotalExcl)}</span>
        </div>
        <div class="flex justify-between text-muted-foreground">
          <span>{m.invoices_print_tax_at_rate({ rate: g.taxRate * 100 })}</span>
          <span class="font-mono">{formatJPY(g.taxAmount)}</span>
        </div>
      {/each}
      <div class="flex justify-between font-bold text-base border-t pt-1">
        <span>{m.invoices_form_total()}</span>
        <span class="font-mono">{formatJPY(printingTotal)}</span>
      </div>
    </div>
    {#if printingInvoice.memo}
      <p class="text-xs whitespace-pre-wrap">{printingInvoice.memo}</p>
    {/if}
  </div>
{/if}

<AlertDialog.Root bind:open={confirmingDelete}>
  <AlertDialog.Content>
    <AlertDialog.Header>
      <AlertDialog.Title>{m.settings_delete_confirm_title()}</AlertDialog.Title>
      <AlertDialog.Description>
        {m.settings_delete_confirm_desc({ name: pendingDeleteName })}
      </AlertDialog.Description>
    </AlertDialog.Header>
    <AlertDialog.Footer>
      <AlertDialog.Cancel>{m.common_cancel()}</AlertDialog.Cancel>
      <AlertDialog.Action
        onclick={runPendingDelete}
        class="bg-destructive text-destructive-foreground hover:bg-destructive/90"
      >
        {m.settings_action_delete()}
      </AlertDialog.Action>
    </AlertDialog.Footer>
  </AlertDialog.Content>
</AlertDialog.Root>
