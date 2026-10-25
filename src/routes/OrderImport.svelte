<script lang="ts">
  import { onMount } from 'svelte';
  import { db } from '../db';
  import { validateLines } from '../domain/journal';
  import { shouldConfirmExternalSend } from '../domain/send-confirm';
  import { D, formatJPY, toIndexable } from '../lib/decimal';
  import { newId } from '../lib/id';
  import { getSetting, setSetting } from '../lib/settings';
  import { describeStorageError } from '../lib/storage-error';
  import { filedYearGuard } from '../lib/filed-year-guard.svelte';
  import { allowFiledYearWriteInThisTransaction } from '../db/filed-year-guard';
  import { ledger } from '../stores/ledger.svelte';
  import { analysis } from '../stores/analysis.svelte';
  import { orderDraft, type PreparedOrder, type ReviewItem } from '../stores/order-draft.svelte';
  import type { JournalLine } from '../db/types';
  import AccountSelect from '../components/AccountSelect.svelte';
  import ConfirmDialog from '../components/ConfirmDialog.svelte';
  import DiscardCandidatesDialog from '../components/DiscardCandidatesDialog.svelte';
  import { m } from '../paraglide/messages';
  import { escapeHtml } from '../lib/html-escape';
  import ScrollX from '../components/ScrollX.svelte';
  // 全選択・コピーの修飾キーは環境で違うため、userAgent で出し分ける。
  const uaModKey = /Mac|iPhone|iPad/.test(navigator.userAgent) ? 'Cmd' : 'Ctrl';
  const previewPlatform = __DOC_PREVIEW__
    ? (globalThis as unknown as Record<string, unknown>)['__aoikoPreviewPlatform']
    : undefined;
  const modKey =
    previewPlatform === 'windows'
      ? 'Ctrl'
      : previewPlatform === 'macos' || previewPlatform === 'ios'
        ? 'Cmd'
        : uaModKey;

  const TAX_RATES = [0.1, 0.08];

  const draft = orderDraft;
  // 貼り付けた本文と解析結果は確定するまで DB に無いが、store が持つので画面を離れても残る。
  // 解析の準備はまだ実行権を取らない区間なので、ボタンの二度押しはここで防ぐ。
  let preparing = $state(false);
  const running = $derived(preparing || analysis.isRunning('order'));
  const cancelling = $derived(analysis.isCancelling('order'));
  const busyOther = $derived(analysis.isBusyWithOther('order'));
  // 保存中は再度押せないようにする（二度押しで同じ仕訳が2件作られる）
  let committing = $state(false);

  let confirmOpen = $state(false);
  let discardConfirmOpen = $state(false);
  let pending = $state<PreparedOrder | null>(null);

  const accountGroups = $derived(ledger.groupedAccounts());

  onMount(() => {
    analysis.enter('order');
    return () => analysis.leave('order');
  });

  async function analyze() {
    if (preparing) {
      return;
    }
    preparing = true;
    try {
      const prepared = await draft.prepare();
      if (prepared === null) {
        return;
      }
      const skip = await getSetting('skipExternalSendConfirm');
      if (
        shouldConfirmExternalSend(
          { external: prepared.extractor.external, host: prepared.host },
          skip,
        )
      ) {
        pending = prepared;
        confirmOpen = true;
        return;
      }
      await draft.run(prepared);
    } finally {
      preparing = false;
    }
  }

  async function onConfirmSend(dontAskAgain: boolean) {
    confirmOpen = false;
    const p = pending;
    pending = null;
    if (!p) {
      return;
    }
    if (dontAskAgain) {
      await setSetting('skipExternalSendConfirm', true);
    }
    await draft.run(p);
  }

  function onCancelSend() {
    confirmOpen = false;
    pending = null;
  }

  function removeItem(idx: number) {
    draft.reviewItems = draft.reviewItems.filter((_, i) => i !== idx);
  }

  function addItem() {
    draft.reviewItems = [
      ...draft.reviewItems,
      {
        description: '',
        amount: '0',
        accountCode: draft.defaultExpenseAccount(),
        taxRate: 0.1,
        rateTouched: false,
      },
    ];
  }
  // 値引行は触られていなければ、値引対象と見なせる品目（正の金額の行）の税率が1種類のときそれに従う
  function effectiveRate(item: ReviewItem): number {
    if (item.rateTouched || !/^-\d+$/.test(item.amount)) {
      return item.taxRate;
    }
    const rates = new Set(
      draft.reviewItems
        .filter(
          (it) => it.description.trim() !== '' && /^\d+$/.test(it.amount) && D(it.amount).gt(0),
        )
        .map((it) => it.taxRate),
    );
    const [only] = [...rates];
    return rates.size === 1 && only !== undefined ? only : item.taxRate;
  }
  function setRate(item: ReviewItem, value: string) {
    item.taxRate = Number(value);
    item.rateTouched = true;
  }

  async function commit() {
    const data = draft.extracted;
    if (!data || committing) {
      return;
    }
    draft.error = '';
    draft.success = '';
    if (!data.date || !/^\d{4}-\d{2}-\d{2}$/.test(data.date)) {
      draft.error = m.order_amount_required();
      return;
    }
    if (!data.totalAmount || !/^\d+$/.test(data.totalAmount)) {
      draft.error = m.order_amount_required();
      return;
    }
    const validItems = draft.reviewItems.filter(
      (it) => it.description.trim() !== '' && /^-?\d+$/.test(it.amount),
    );
    if (validItems.length === 0) {
      draft.error = m.order_no_items();
      return;
    }
    // 借方は品目、貸方は総額で組むため、両者が一致しないと validateLines が必ず
    // unbalanced を投げる。続行させても仕訳にならないので、ここで止めて直させる。
    // どちらの欄も画面上で編集できる。
    const itemsSum = validItems.reduce((s, it) => s.plus(D(it.amount)), D(0));
    if (!itemsSum.equals(D(data.totalAmount))) {
      draft.error = m.order_total_mismatch({
        itemSum: formatJPY(itemsSum.toString()),
        total: formatJPY(data.totalAmount),
      });
      return;
    }

    committing = true;
    try {
      const entryId = newId();
      const now = Date.now();
      const lines: JournalLine[] = [];
      // 各品目：正値 → 借方、負値（値引）→ 貸方
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
          taxRate: effectiveRate(it),
          taxIncluded: true,
          invoiceCompliant: false,
          memo: it.description.trim(),
        });
      }
      // 支払元（既定：未払金）への貸方 1 行
      lines.push({
        id: newId(),
        entryId,
        side: 'credit',
        accountCode: draft.paymentAccount,
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

      if (
        !(await filedYearGuard.confirm([Number(data.date.slice(0, 4))], { suppressible: true }))
      ) {
        return;
      }

      await db.transaction('rw', [db.journalEntries, db.journalLines], async () => {
        allowFiledYearWriteInThisTransaction();
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
      });

      draft.success = m.order_success({
        name: description,
        amount: formatJPY(data.totalAmount),
        count: String(validItems.length),
      });
      draft.reset();
    } catch (e) {
      draft.error = describeStorageError(e);
    } finally {
      committing = false;
    }
  }

  function requestDiscard() {
    discardConfirmOpen = true;
  }

  function confirmDiscard() {
    discardConfirmOpen = false;
    draft.reset();
  }

  function cancelDiscard() {
    discardConfirmOpen = false;
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
        value={draft.pastedText}
        oninput={(e) => draft.setPastedText((e.target as HTMLTextAreaElement).value)}
        readonly={draft.locked}
        name="orderPastedHonbun"
        autocomplete="off"
        placeholder={m.order_paste_placeholder({ mod: modKey })}
        rows="10"
        class="mt-1 w-full px-3 py-2 bg-background border rounded text-foreground text-sm font-mono"
      ></textarea>
    </label>

    {#if !draft.extracted}
      <div class="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onclick={analyze}
          disabled={running || busyOther}
          class="px-4 py-2 bg-primary text-primary-foreground rounded hover:opacity-90 disabled:opacity-50"
        >
          {running ? m.order_analyze_running() : m.order_analyze_button()}
        </button>
        {#if analysis.isRunning('order')}
          <button
            type="button"
            onclick={() => analysis.cancel()}
            disabled={cancelling}
            class="px-4 py-2 border rounded hover:bg-accent disabled:opacity-50"
          >
            {cancelling ? m.analysis_cancelling() : m.analysis_cancel()}
          </button>
        {:else if busyOther}
          <span class="text-xs text-muted-foreground">{m.analysis_busy_other()}</span>
        {/if}
      </div>
      {#if cancelling}
        <p class="text-xs text-muted-foreground">{m.analysis_cancelling_hint()}</p>
      {/if}
    {/if}

    {#if draft.error}
      <div
        class="border border-destructive bg-destructive/10 text-destructive rounded-lg px-3 py-2 text-sm"
      >
        {draft.error}
      </div>
    {/if}
    {#if draft.success}
      <div class="border border-primary bg-primary/10 text-foreground rounded-lg px-3 py-2 text-sm">
        {draft.success}
      </div>
    {/if}
  </section>

  {#if draft.extracted}
    {@const ex = draft.extracted}
    <section class="bg-card text-card-foreground rounded-xl p-6 space-y-4 shadow-sm">
      <h3 class="text-lg font-semibold">{m.order_step_review()}</h3>

      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <label class="block">
          <span class="text-xs text-muted-foreground">{m.order_label_date()}</span>
          <input
            type="date"
            name="orderDate"
            autocomplete="off"
            bind:value={ex.date}
            class="mt-1 w-full px-3 py-2 bg-background border rounded text-foreground tabular-nums supports-[-webkit-touch-callout:none]:appearance-none [&::-webkit-date-and-time-value]:text-left"
          />
        </label>
        <label class="block">
          <span class="text-xs text-muted-foreground">{m.order_label_vendor()}</span>
          <input
            type="text"
            name="orderVendorTitle"
            autocomplete="off"
            bind:value={ex.vendor}
            class="mt-1 w-full px-3 py-2 bg-background border rounded text-foreground"
          />
        </label>
        <label class="block">
          <span class="text-xs text-muted-foreground">{m.order_label_order_number()}</span>
          <input
            type="text"
            name="orderNumber"
            autocomplete="off"
            bind:value={ex.orderNumber}
            class="mt-1 w-full px-3 py-2 bg-background border rounded text-foreground font-mono text-sm"
          />
        </label>
        <label class="block">
          <span class="text-xs text-muted-foreground">{m.order_label_total()}</span>
          <input
            type="number"
            name="orderTotalAmount"
            autocomplete="off"
            value={ex.totalAmount}
            oninput={(e) => {
              ex.totalAmount = (e.target as HTMLInputElement).value;
            }}
            min="0"
            step="1"
            class="mt-1 w-full px-3 py-2 bg-background border rounded text-right text-foreground tabular-nums"
          />
        </label>
      </div>

      <ScrollX>
        <table class="w-full min-w-[600px] text-sm">
          <thead>
            <tr class="text-xs text-muted-foreground border-b">
              <th class="text-left font-normal px-2 py-2">{m.order_th_description()}</th>
              <th class="text-right font-normal px-2 py-2 w-32">{m.order_th_amount()}</th>
              <th class="text-left font-normal px-2 py-2 w-24">{m.order_th_tax_rate()}</th>
              <th class="text-left font-normal px-2 py-2 w-64">{m.order_th_account()}</th>
              <th class="px-2 py-2 w-12"></th>
            </tr>
          </thead>
          <tbody>
            {#each draft.reviewItems as item, i (i)}
              <tr class="border-b border-border/30">
                <td class="px-2 py-2">
                  <input
                    type="text"
                    name="order-item-{i}-description"
                    autocomplete="off"
                    aria-label={m.order_th_description()}
                    bind:value={item.description}
                    class="w-full px-2 py-1 bg-background border rounded text-foreground"
                  />
                </td>
                <td class="px-2 py-2">
                  <input
                    type="number"
                    name="order-item-{i}-amount"
                    autocomplete="off"
                    aria-label={m.order_th_amount()}
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
                    value={effectiveRate(item)}
                    name="order-item-{i}-tax-rate"
                    onchange={(e) => setRate(item, (e.target as HTMLSelectElement).value)}
                    aria-label={m.order_th_tax_rate()}
                    class="w-full px-2 py-1 bg-background border rounded text-foreground text-xs"
                  >
                    {#each TAX_RATES as rate (rate)}
                      <option value={rate}>{rate * 100}%</option>
                    {/each}
                  </select>
                </td>
                <td class="px-2 py-2">
                  <AccountSelect
                    bind:value={item.accountCode}
                    groups={accountGroups}
                    name="order-item-{i}-account"
                    ariaLabel={m.order_th_account()}
                    class="w-full px-2 py-1 bg-background border rounded text-foreground text-xs"
                  />
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
        <p class="mt-2 text-xs text-muted-foreground">{m.order_rate_hint()}</p>
      </ScrollX>

      <div class="pt-4 border-t border-border/50">
        <label class="block max-w-md">
          <span class="text-xs text-muted-foreground">{m.order_label_payment_account()}</span>
          <select
            bind:value={draft.paymentAccount}
            name="orderPaymentAccount"
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
          onclick={requestDiscard}
          class="px-4 py-2 border rounded hover:bg-accent"
        >
          {m.common_cancel()}
        </button>
        <button
          type="button"
          onclick={commit}
          disabled={committing}
          class="px-4 py-2 bg-primary text-primary-foreground rounded hover:opacity-90 disabled:opacity-50"
        >
          {m.order_submit()}
        </button>
      </div>
    </section>
  {/if}
</div>

<ConfirmDialog
  open={confirmOpen}
  title={m.cloud_send_confirm_title()}
  descriptionHtml={m.cloud_send_confirm_desc_html({ host: escapeHtml(pending?.host ?? '') })}
  proceedLabel={m.cloud_send_confirm_proceed()}
  dontAskLabel={m.cloud_send_confirm_dont_ask()}
  onconfirm={onConfirmSend}
  oncancel={onCancelSend}
/>
<DiscardCandidatesDialog
  open={discardConfirmOpen}
  onconfirm={confirmDiscard}
  oncancel={cancelDiscard}
/>
