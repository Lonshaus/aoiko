<script lang="ts">
  import { onMount } from 'svelte';
  import { commitImport, DuplicateImportError, type ImportRow } from '../domain/import';
  import { recordRuleHit } from '../domain/rules';
  import { shouldConfirmExternalSend } from '../domain/send-confirm';
  import { getSetting, setSetting } from '../lib/settings';
  import { filedYearGuard } from '../lib/filed-year-guard.svelte';
  import { formatJPY } from '../lib/decimal';
  import AccountSelect from '../components/AccountSelect.svelte';
  import ConfirmDialog from '../components/ConfirmDialog.svelte';
  import DiscardCandidatesDialog from '../components/DiscardCandidatesDialog.svelte';
  import ScrollX from '../components/ScrollX.svelte';
  import { PARSERS, findParser } from '../parsers';
  import { analysis } from '../stores/analysis.svelte';
  import {
    defaultTaxRateFor,
    importDraft,
    type PreparedClassify,
    type RowState,
  } from '../stores/import-draft.svelte';
  import { ledger } from '../stores/ledger.svelte';
  import { clampPage, pageBounds, pageCount } from '../lib/pagination';
  import { m } from '../paraglide/messages';
  import { escapeHtml } from '../lib/html-escape';
  import FilePicker from '../components/FilePicker.svelte';

  const PAGE_SIZE = 500;

  const draft = importDraft;
  // 読み込んだ行は取込を押すまで DB に無いが、store が持つので画面を離れても残る。
  // 分類の準備はまだ実行権を取らない区間なので、ボタンの二度押しはここで防ぐ。
  let preparing = $state(false);
  const running = $derived(preparing || analysis.isRunning('classify'));
  const cancelling = $derived(analysis.isCancelling('classify'));
  const busyOther = $derived(analysis.isBusyWithOther('classify'));
  let llmConfirmOpen = $state(false);
  let llmPending = $state<PreparedClassify | null>(null);
  let discardConfirmOpen = $state(false);
  let parserSelectEl = $state<HTMLSelectElement | null>(null);
  // Cancel／取込元切替／ファイル選び直しの3経路を同じダイアログで賄うため、破棄後の動作を種別で持つ
  type PendingDiscard =
    | { kind: 'cancel' }
    | { kind: 'parser'; newName: string }
    | { kind: 'file'; file: File; input: HTMLInputElement };
  let pendingDiscard = $state<PendingDiscard | null>(null);

  onMount(() => {
    analysis.enter('classify');
    return () => analysis.leave('classify');
  });

  const currentParser = $derived(findParser(draft.selectedParserName));
  const knownAccount = $derived(
    currentParser ? ledger.accounts.find((a) => a.code === currentParser.accountCode) : null,
  );
  const knownSubAccounts = $derived(
    currentParser ? ledger.subAccountsFor(currentParser.accountCode) : [],
  );
  const accountGroups = $derived(ledger.groupedAccounts());
  const validCount = $derived(
    draft.rows.filter((r) => !r.skip && r.counterpartAccountCode.length > 0).length,
  );
  const unclassifiedCount = $derived(
    draft.rows.filter((r) => !r.skip && r.counterpartAccountCode.length === 0).length,
  );
  const totalPages = $derived(pageCount(draft.rows.length, PAGE_SIZE));
  const currentPage = $derived(clampPage(draft.page, draft.rows.length, PAGE_SIZE));
  const pageRange = $derived(pageBounds(draft.rows.length, PAGE_SIZE, currentPage));
  const pageRows = $derived(
    draft.rows
      .slice(pageRange.start, pageRange.end)
      .map((row, i) => ({ row, index: pageRange.start + i })),
  );
  // 取込元のプルダウンが変わったら、読み込み済みの表を parser 不一致のまま残さない。
  // 再解析ではなく破棄：computeFileHash / 重複チェック / findOverlappingRows / ルール適用を
  // 丸ごとやり直す必要があり、handleFile の分岐が増えて事故りやすいため。
  function handleParserChange(newName: string) {
    if (draft.locked) {
      if (parserSelectEl) {
        parserSelectEl.value = draft.selectedParserName;
      }
      return;
    }
    if (draft.rows.length > 0 && newName !== draft.selectedParserName) {
      pendingDiscard = { kind: 'parser', newName };
      discardConfirmOpen = true;
      return;
    }
    draft.selectedParserName = newName;
  }

  async function handleFile(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) {
      return;
    }
    if (draft.locked) {
      input.value = '';
      return;
    }
    if (draft.rows.length > 0) {
      pendingDiscard = { kind: 'file', file, input };
      discardConfirmOpen = true;
      return;
    }
    await processFile(file, input);
  }

  async function processFile(file: File, input: HTMLInputElement) {
    const result = await draft.loadFile(file);
    if (result === 'clear-input') {
      input.value = '';
    }
  }

  function onCounterpartAccountChange(row: RowState) {
    row.counterpartSubAccountId = '';
    // 利用者が上書きしたら自動分類の出所を解除
    row.matchedRuleId = '';
    row.vendorMatched = false;
    row.llmConfidence = '';
    // 科目変更時は税区分由来の既定税率に追従する
    row.taxRate = defaultTaxRateFor(row.counterpartAccountCode);
  }

  async function classifyRemainingWithLlm() {
    if (preparing) {
      return;
    }
    preparing = true;
    try {
      const prepared = await draft.prepareClassify();
      if (prepared === null) {
        return;
      }
      const skip = await getSetting('skipExternalSendConfirm');
      if (
        shouldConfirmExternalSend(
          { external: prepared.adapter.external, host: prepared.host },
          skip,
        )
      ) {
        llmPending = prepared;
        llmConfirmOpen = true;
        return;
      }
      await draft.runClassify(prepared);
    } finally {
      preparing = false;
    }
  }

  async function onLlmConfirm(dontAskAgain: boolean) {
    llmConfirmOpen = false;
    const p = llmPending;
    llmPending = null;
    if (!p) {
      return;
    }
    if (dontAskAgain) {
      await setSetting('skipExternalSendConfirm', true);
    }
    await draft.runClassify(p);
  }

  function onLlmCancel() {
    llmConfirmOpen = false;
    llmPending = null;
  }

  function requestDiscard() {
    pendingDiscard = { kind: 'cancel' };
    discardConfirmOpen = true;
  }

  async function confirmDiscard() {
    discardConfirmOpen = false;
    // AlertDialog の確定操作は handleClose 経由で oncancel（cancelDiscard）も呼ぶため、古い pendingDiscard を見せないよう await の前に読んで消す。
    const pending = pendingDiscard;
    pendingDiscard = null;
    if (!pending) {
      return;
    }
    if (pending.kind === 'cancel') {
      draft.reset();
      return;
    }
    if (pending.kind === 'parser') {
      draft.reset();
      draft.selectedParserName = pending.newName;
      draft.parserChangedNotice = m.import_parser_changed_notice();
      return;
    }
    await processFile(pending.file, pending.input);
  }
  // ダイアログ表示時点で select・input の DOM 値はもう新しい選択に変わっている。
  // value バインドは selectedParserName が変わらない限り再同期されないため、DOM を直接戻す。
  function cancelDiscard() {
    discardConfirmOpen = false;
    const pending = pendingDiscard;
    pendingDiscard = null;
    if (pending?.kind === 'parser' && parserSelectEl) {
      parserSelectEl.value = draft.selectedParserName;
    } else if (pending?.kind === 'file') {
      pending.input.value = '';
    }
  }

  async function submit() {
    if (!currentParser) {
      return;
    }
    draft.importing = true;
    draft.error = '';
    draft.success = '';
    try {
      const importRows: ImportRow[] = draft.rows.map((r) => ({
        transaction: r.transaction,
        counterpartAccountCode: r.counterpartAccountCode,
        ...(r.counterpartSubAccountId
          ? { counterpartSubAccountId: r.counterpartSubAccountId }
          : {}),
        ...(r.description !== r.transaction.description ? { description: r.description } : {}),
        skip: r.skip,
        counterpartTaxRate: r.taxRate,
        counterpartInvoiceCompliant: r.invoiceCompliant,
      }));
      const years = new Set(importRows.map((r) => Number(r.transaction.date.slice(0, 4))));
      if (!(await filedYearGuard.confirm(years))) {
        return;
      }
      const result = await commitImport(
        {
          parserName: currentParser.name,
          fileName: draft.fileName,
          fileHash: draft.fileHash,
          knownAccountCode: currentParser.accountCode,
          ...(draft.knownSubAccountId ? { knownSubAccountId: draft.knownSubAccountId } : {}),
        },
        importRows,
        { allowFiledYear: true },
      );
      // 採用されたルールの hitCount をインクリメント
      const ruleIds = new Set(
        draft.rows
          .filter(
            (r) => !r.skip && r.matchedRuleId.length > 0 && r.counterpartAccountCode.length > 0,
          )
          .map((r) => r.matchedRuleId),
      );
      for (const id of ruleIds) {
        await recordRuleHit(id);
      }
      draft.success = m.import_success({ count: result.entryCount });
      draft.reset();
    } catch (e) {
      if (e instanceof DuplicateImportError) {
        draft.error = e.message;
      } else {
        draft.error = e instanceof Error ? e.message : String(e);
      }
    } finally {
      draft.importing = false;
    }
  }
</script>

<div class="space-y-6">
  <header>
    <h2 class="text-2xl font-bold">{m.import_title()}</h2>
    <p class="text-xs text-muted-foreground">{m.import_subtitle()}</p>
  </header>

  <section class="bg-card text-card-foreground rounded-xl p-6 space-y-4 shadow-sm">
    <div class="space-y-3">
      <label class="block">
        <span class="text-xs text-muted-foreground">{m.import_step_parser()}</span>
        <select
          bind:this={parserSelectEl}
          name="importParser"
          value={draft.selectedParserName}
          disabled={draft.locked}
          onchange={(e) => handleParserChange((e.target as HTMLSelectElement).value)}
          class="mt-1 w-full px-3 py-2 bg-background border rounded text-foreground"
        >
          {#each PARSERS as p (p.name)}
            <option value={p.name}>{p.displayName}</option>
          {/each}
        </select>
      </label>
      {#if knownAccount}
        <p class="text-xs text-muted-foreground">
          {m.import_known_account({ code: knownAccount.code, name: knownAccount.name })}
        </p>
      {/if}

      {#if knownSubAccounts.length > 0}
        <label class="block">
          <span class="text-xs text-muted-foreground">{m.import_known_subaccount()}</span>
          <select
            bind:value={draft.knownSubAccountId}
            name="importKnownSubAccount"
            class="mt-1 w-full px-3 py-2 bg-background border rounded text-foreground"
          >
            <option value="">{m.import_known_subaccount_none()}</option>
            {#each knownSubAccounts as s (s.id)}
              <option value={s.id}>{s.name}</option>
            {/each}
          </select>
        </label>
      {/if}

      <label class="block">
        <span class="text-xs text-muted-foreground">{m.import_step_file()}</span>
        <span class="mt-1 block">
          <FilePicker accept=".csv,text/csv" onchange={handleFile} disabled={draft.locked} />
        </span>
        {#if draft.fileName}
          <span class="text-xs text-muted-foreground mt-1 block">
            {m.import_file_selected({ name: draft.fileName })}
          </span>
        {/if}
      </label>
    </div>

    {#if draft.error}
      <div
        class="border border-destructive bg-destructive/10 text-destructive rounded-lg px-4 py-2 text-sm"
      >
        {draft.error}
      </div>
    {/if}
    {#if draft.success}
      <div class="border border-primary bg-primary/10 text-foreground rounded-lg px-4 py-2 text-sm">
        ✓ {draft.success}
      </div>
    {/if}
    {#if draft.duplicateNotice}
      <div
        class="border border-amber-500 bg-amber-500/10 text-foreground rounded-lg px-4 py-2 text-sm"
      >
        ⚠ {draft.duplicateNotice}
      </div>
    {/if}
    {#if draft.parserChangedNotice}
      <div
        class="border border-amber-500 bg-amber-500/10 text-foreground rounded-lg px-4 py-2 text-sm"
      >
        ⚠ {draft.parserChangedNotice}
      </div>
    {/if}
  </section>

  {#if draft.rows.length > 0}
    <section class="bg-card text-card-foreground rounded-xl shadow-sm overflow-hidden">
      <header class="flex items-baseline justify-between p-4 border-b border-border/50">
        <h3 class="text-sm font-semibold">{m.import_step_review()}</h3>
        <span class="text-xs text-muted-foreground tabular-nums">
          {m.import_planned_count({ valid: validCount, total: draft.rows.length })}
        </span>
      </header>

      <div class="flex flex-wrap items-center gap-3 px-4 py-2 border-b border-border/50 text-xs">
        <button
          type="button"
          onclick={classifyRemainingWithLlm}
          disabled={running || busyOther}
          class="px-3 py-1 border rounded hover:bg-accent disabled:opacity-50"
        >
          {running ? m.import_llm_button_running() : m.import_llm_button()}
        </button>
        {#if analysis.isRunning('classify')}
          <button
            type="button"
            onclick={() => analysis.cancel()}
            disabled={cancelling}
            class="px-3 py-1 border rounded hover:bg-accent disabled:opacity-50"
          >
            {cancelling ? m.analysis_cancelling() : m.analysis_cancel()}
          </button>
        {:else if busyOther}
          <span class="text-muted-foreground">{m.analysis_busy_other()}</span>
        {/if}
        {#if cancelling}
          <span class="text-muted-foreground">{m.analysis_cancelling_hint()}</span>
        {/if}
        {#if draft.llmStatus}
          <span class="text-muted-foreground">{draft.llmStatus}</span>
        {/if}
      </div>

      <ScrollX>
        <table class="w-full min-w-[916px] table-fixed text-sm">
          <thead>
            <tr class="text-xs text-muted-foreground">
              <th class="text-left font-normal px-3 py-2 w-[6.5rem]">{m.journal_th_date()}</th>
              <th class="text-left font-normal px-3 py-2">{m.journal_th_description()}</th>
              <th class="text-right font-normal px-3 py-2 w-[7.5rem]">{m.journal_th_amount()}</th>
              <th class="text-left font-normal px-3 py-2 w-64">{m.import_th_counterpart()}</th>
              <th class="text-left font-normal px-3 py-2 w-36">{m.import_th_tax()}</th>
              <th class="text-center font-normal px-3 py-2 w-[3.5rem]">{m.import_th_skip()}</th>
            </tr>
          </thead>
          <tbody>
            {#each pageRows as { row, index } (index)}
              {@const subs = row.counterpartAccountCode
                ? ledger.subAccountsFor(row.counterpartAccountCode)
                : []}
              <tr class="border-t border-border/50 align-top" class:opacity-50={row.skip}>
                <td class="px-3 py-2 text-muted-foreground tabular-nums whitespace-nowrap">
                  {row.transaction.date}
                </td>
                <td class="px-3 py-2">
                  <input
                    type="text"
                    name="import-{index}-description"
                    autocomplete="off"
                    aria-label={m.journal_th_description()}
                    bind:value={row.description}
                    class="w-full px-2 py-1 bg-background border rounded text-foreground text-sm"
                  />
                </td>
                <td class="px-3 py-2 text-right tabular-nums whitespace-nowrap">
                  <span class:text-destructive={row.transaction.side === 'credit'}>
                    {row.transaction.side === 'debit' ? '+' : '-'}{formatJPY(
                      row.transaction.amount,
                    )}
                  </span>
                </td>
                <td class="px-3 py-2 space-y-1">
                  <div class="flex items-center gap-1">
                    <AccountSelect
                      bind:value={row.counterpartAccountCode}
                      groups={accountGroups}
                      placeholder={m.journal_form_account_select()}
                      name="import-{index}-counterpart"
                      ariaLabel={m.import_th_counterpart()}
                      onchange={() => onCounterpartAccountChange(row)}
                      disabled={row.skip}
                      class="w-48 shrink-0 px-2 py-1 bg-background border rounded text-foreground text-sm disabled:opacity-50"
                    />
                    {#if row.matchedRuleId}
                      <span
                        class="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary whitespace-nowrap"
                        title={m.import_badge_rule_title()}>{m.import_badge_rule()}</span
                      >
                    {:else if row.vendorMatched}
                      <span
                        class="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary whitespace-nowrap"
                        title={m.import_badge_vendor_title()}>{m.import_badge_vendor()}</span
                      >
                    {:else if row.llmConfidence === 'high'}
                      <span
                        class="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary whitespace-nowrap"
                        title={m.import_badge_llm_high_title()}>{m.import_badge_llm_high()}</span
                      >
                    {:else if row.llmConfidence === 'low'}
                      <span
                        class="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground whitespace-nowrap"
                        title={m.import_badge_llm_low_title()}>{m.import_badge_llm_low()}</span
                      >
                    {/if}
                  </div>
                  {#if subs.length > 0}
                    <select
                      bind:value={row.counterpartSubAccountId}
                      name="import-{index}-subaccount"
                      aria-label={m.journal_form_subaccount_select()}
                      disabled={row.skip}
                      class="w-full px-2 py-1 bg-background border rounded text-foreground text-xs disabled:opacity-50"
                    >
                      <option value="">—</option>
                      {#each subs as s (s.id)}
                        <option value={s.id}>{s.name}</option>
                      {/each}
                    </select>
                  {/if}
                </td>
                <td class="px-3 py-2 space-y-1 whitespace-nowrap">
                  <select
                    bind:value={row.taxRate}
                    name="import-{index}-tax-rate"
                    aria-label={m.import_th_tax()}
                    disabled={row.skip}
                    class="w-full px-2 py-1 bg-background border rounded text-foreground text-xs disabled:opacity-50"
                  >
                    <option value={0}>{m.journal_tax_exempt()}</option>
                    <option value={0.08}>{m.journal_tax_reduced()}</option>
                    <option value={0.1}>{m.journal_tax_standard()}</option>
                  </select>
                  {#if row.taxRate > 0}
                    <label
                      class="flex items-center gap-1 text-xs text-muted-foreground"
                      title={m.import_invoice_compliant_title()}
                    >
                      <input
                        type="checkbox"
                        bind:checked={row.invoiceCompliant}
                        disabled={row.skip}
                      />
                      {m.import_invoice_compliant()}
                    </label>
                  {/if}
                </td>
                <td class="px-3 py-2 text-center">
                  <input type="checkbox" bind:checked={row.skip} />
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </ScrollX>

      {#if totalPages > 1}
        <div
          class="flex items-center justify-center gap-3 px-4 py-2 border-t border-border/50 text-xs"
        >
          <button
            type="button"
            onclick={() => (draft.page = currentPage - 1)}
            disabled={currentPage === 0}
            class="px-2 py-1 border rounded hover:bg-accent disabled:opacity-50"
          >
            {m.import_pager_prev()}
          </button>
          <span class="text-muted-foreground tabular-nums">
            {m.import_pager_range({
              start: pageRange.start + 1,
              end: pageRange.end,
              total: draft.rows.length,
            })}
          </span>
          <button
            type="button"
            onclick={() => (draft.page = currentPage + 1)}
            disabled={currentPage >= totalPages - 1}
            class="px-2 py-1 border rounded hover:bg-accent disabled:opacity-50"
          >
            {m.import_pager_next()}
          </button>
        </div>
      {/if}

      <div class="flex flex-wrap items-center justify-end gap-3 p-4 border-t border-border/50">
        {#if unclassifiedCount > 0}
          <span class="text-xs text-amber-600 dark:text-amber-500">
            {m.import_unclassified_notice({ count: unclassifiedCount })}
          </span>
        {/if}
        <button
          type="button"
          onclick={requestDiscard}
          disabled={draft.importing}
          class="px-4 py-2 border rounded hover:bg-accent disabled:opacity-50"
        >
          {m.common_cancel()}
        </button>
        <button
          type="button"
          onclick={submit}
          disabled={draft.importing || validCount === 0}
          class="px-4 py-2 bg-primary text-primary-foreground rounded hover:opacity-90 disabled:opacity-50"
        >
          {draft.importing ? m.import_submit_running() : m.import_submit({ count: validCount })}
        </button>
      </div>
    </section>
  {/if}
</div>

<ConfirmDialog
  open={llmConfirmOpen}
  title={m.cloud_send_confirm_title()}
  descriptionHtml={m.cloud_send_confirm_desc_html({ host: escapeHtml(llmPending?.host ?? '') })}
  proceedLabel={m.cloud_send_confirm_proceed()}
  dontAskLabel={m.cloud_send_confirm_dont_ask()}
  onconfirm={onLlmConfirm}
  oncancel={onLlmCancel}
/>
<DiscardCandidatesDialog
  open={discardConfirmOpen}
  onconfirm={confirmDiscard}
  oncancel={cancelDiscard}
/>
