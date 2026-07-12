<script lang="ts">
  import { db } from '../db';
  import {
    commitImport,
    computeFileHash,
    DuplicateImportError,
    findOverlappingRows,
    type ImportRow,
  } from '../domain/import';
  import { findMatchingRule, recordRuleHit } from '../domain/rules';
  import type { LlmAdapter } from '../domain/llm';
  import { classifyWithLlm, type ClassifyInput } from '../domain/llm-classify';
  import { shouldConfirmExternalSend } from '../domain/send-confirm';
  import { createLlmAdapter } from '../lib/llm-adapter';
  import { getSetting, setSetting } from '../lib/settings';
  import { formatJPY } from '../lib/decimal';
  import CloudSendConfirmDialog from '../components/CloudSendConfirmDialog.svelte';
  import { PARSERS, findParser } from '../parsers';
  import type { ParsedTransaction } from '../parsers/types';
  import { ledger } from '../stores/ledger.svelte';
  import { taxRateForCategory } from '../lib/tax-category';
  import { exceedsLimit, formatBytes, MAX_CSV_BYTES } from '../lib/file-limit';
  import { decodeCsv } from '../lib/encoding';
  import type { Account } from '../db/types';
  import { m } from '../paraglide/messages';

  type RowState = {
    transaction: ParsedTransaction;
    counterpartAccountCode: string;
    counterpartSubAccountId: string;
    description: string;
    skip: boolean;
    matchedRuleId: string; // ルール命中時の ID、'' = 非適用
    llmConfidence: '' | 'high' | 'low'; // LLM 分類の信頼度、'' = LLM 未適用
    taxRate: number; // 相手科目の消費税率（科目の税区分から既定値を設定、上書き可）
    invoiceCompliant: boolean; // 適格請求書あり（仕入税額控除 100%）
  };
  // 相手科目コードから税区分由来の既定税率を引く。
  function defaultTaxRateFor(accountCode: string): number {
    const acc = ledger.accounts.find((a) => a.code === accountCode);
    return taxRateForCategory(acc?.taxCategory);
  }

  let selectedParserName = $state(PARSERS[0]?.name ?? '');
  let fileName = $state('');
  let fileHash = $state('');
  let rows = $state<RowState[]>([]);
  let knownSubAccountId = $state('');
  let duplicateNotice = $state('');
  let importing = $state(false);
  let llmClassifying = $state(false);
  let llmStatus = $state('');
  let llmConfirmOpen = $state(false);
  let llmPending = $state<{
    adapter: LlmAdapter;
    targets: { row: RowState; index: number }[];
    host: string;
  } | null>(null);
  let error = $state('');
  let success = $state('');

  const currentParser = $derived(findParser(selectedParserName));
  const knownAccount = $derived(
    currentParser ? ledger.accounts.find((a) => a.code === currentParser.accountCode) : null,
  );
  const knownSubAccounts = $derived(
    currentParser ? ledger.subAccountsFor(currentParser.accountCode) : [],
  );
  const accountGroups = $derived(ledger.groupedAccounts());
  const validCount = $derived(
    rows.filter((r) => !r.skip && r.counterpartAccountCode.length > 0).length,
  );

  async function handleFile(e: Event) {
    error = '';
    success = '';
    rows = [];
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file || !currentParser) {
      return;
    }
    if (exceedsLimit(file.size, MAX_CSV_BYTES)) {
      error = m.common_file_too_large({
        size: formatBytes(file.size),
        limit: formatBytes(MAX_CSV_BYTES),
      });
      input.value = '';
      return;
    }
    fileName = file.name;
    try {
      const buffer = await file.arrayBuffer();
      const text = decodeCsv(buffer, currentParser.encoding);
      fileHash = await computeFileHash(text);

      const dup = await db.importBatches.where('fileHash').equals(fileHash).first();
      if (dup) {
        error = m.import_duplicate_error({
          date: new Date(dup.importedAt).toLocaleDateString('ja-JP'),
          name: dup.fileName,
        });
        return;
      }

      const txs = currentParser.parse(text);
      // 期間が重なる過去のインポートと重複する行を検出し、既定でスキップにする（誤検知に備え解除可能）。
      const overlapping = await findOverlappingRows(txs, currentParser.accountCode);
      rows = await Promise.all(
        txs.map(async (t, i): Promise<RowState> => {
          const rule = await findMatchingRule(t.description);
          const code = rule?.accountCode ?? '';
          return {
            transaction: t,
            counterpartAccountCode: code,
            counterpartSubAccountId: '',
            description: t.description,
            skip: overlapping.has(i),
            matchedRuleId: rule?.id ?? '',
            llmConfidence: '',
            taxRate: defaultTaxRateFor(code),
            invoiceCompliant: false,
          };
        }),
      );
      duplicateNotice =
        overlapping.size > 0 ? m.import_overlap_notice({ count: overlapping.size }) : '';
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }

  function onCounterpartAccountChange(row: RowState) {
    row.counterpartSubAccountId = '';
    // ユーザーが上書きしたら自動分類の出所を解除
    row.matchedRuleId = '';
    row.llmConfidence = '';
    // 科目変更時は税区分由来の既定税率に追従する
    row.taxRate = defaultTaxRateFor(row.counterpartAccountCode);
  }

  function counterpartCandidates(knownSide: 'debit' | 'credit'): Account[] {
    // 既知側の反対側として妥当な科目を選ぶ
    if (knownSide === 'debit') {
      // 既知が借方（入金等）→ 対方は貸方：収益 or 資産（振替）
      return ledger.accounts.filter((a) => a.category === 'revenue' || a.category === 'asset');
    }
    // 既知が貸方（出金等）→ 対方は借方：費用 or 資産（振替・前払）
    return ledger.accounts.filter((a) => a.category === 'expense' || a.category === 'asset');
  }

  async function classifyRemainingWithLlm() {
    if (!currentParser) {
      return;
    }
    llmStatus = '';
    error = '';

    const targets = rows
      .map((row, index) => ({ row, index }))
      .filter(({ row }) => !row.skip && !row.counterpartAccountCode);
    if (targets.length === 0) {
      llmStatus = m.import_llm_no_target();
      return;
    }

    let adapter;
    try {
      adapter = await createLlmAdapter('classify');
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      return;
    }
    const skip = await getSetting('skipExternalSendConfirm');
    if (
      shouldConfirmExternalSend({ external: adapter.external, host: adapter.destinationHost }, skip)
    ) {
      llmPending = { adapter, targets, host: adapter.destinationHost };
      llmConfirmOpen = true;
      return;
    }
    await runClassify(adapter, targets);
  }

  async function runClassify(adapter: LlmAdapter, targets: { row: RowState; index: number }[]) {
    if (!currentParser) {
      return;
    }
    llmClassifying = true;
    try {
      const bySide = new Map<'debit' | 'credit', typeof targets>();
      for (const t of targets) {
        const s = t.row.transaction.side;
        const arr = bySide.get(s) ?? [];
        arr.push(t);
        bySide.set(s, arr);
      }

      let highCount = 0;
      let lowCount = 0;
      let noneCount = 0;

      for (const [knownSide, group] of bySide) {
        const inputs: ClassifyInput[] = group.map((g) => ({
          ref: String(g.index),
          description: g.row.description,
          amount: g.row.transaction.amount,
        }));
        const suggestions = await classifyWithLlm(adapter, inputs, {
          knownAccountCode: currentParser.accountCode,
          knownSide,
          candidateAccounts: counterpartCandidates(knownSide),
        });
        for (const s of suggestions) {
          const idx = Number(s.ref);
          const row = rows[idx];
          if (!row) {
            continue;
          }
          if (s.accountCode && s.confidence !== 'none') {
            row.counterpartAccountCode = s.accountCode;
            row.taxRate = defaultTaxRateFor(s.accountCode);
            row.llmConfidence = s.confidence;
            if (s.confidence === 'high') {
              highCount++;
            } else {
              lowCount++;
            }
          } else {
            noneCount++;
          }
        }
      }
      llmStatus =
        noneCount > 0
          ? m.import_llm_status_with_none({
              count: highCount + lowCount,
              high: highCount,
              low: lowCount,
              none: noneCount,
            })
          : m.import_llm_status({ count: highCount + lowCount, high: highCount, low: lowCount });
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      llmClassifying = false;
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
    await runClassify(p.adapter, p.targets);
  }

  function onLlmCancel() {
    llmConfirmOpen = false;
    llmPending = null;
  }

  function reset() {
    rows = [];
    fileName = '';
    fileHash = '';
    knownSubAccountId = '';
    duplicateNotice = '';
    error = '';
  }

  async function submit() {
    if (!currentParser) {
      return;
    }
    importing = true;
    error = '';
    success = '';
    try {
      const importRows: ImportRow[] = rows.map((r) => ({
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
      const result = await commitImport(
        {
          parserName: currentParser.name,
          fileName,
          fileHash,
          knownAccountCode: currentParser.accountCode,
          ...(knownSubAccountId ? { knownSubAccountId } : {}),
        },
        importRows,
      );
      // 採用されたルールの hitCount をインクリメント
      const ruleIds = new Set(
        rows
          .filter(
            (r) => !r.skip && r.matchedRuleId.length > 0 && r.counterpartAccountCode.length > 0,
          )
          .map((r) => r.matchedRuleId),
      );
      for (const id of ruleIds) {
        await recordRuleHit(id);
      }
      success = m.import_success({ count: result.entryCount });
      reset();
    } catch (e) {
      if (e instanceof DuplicateImportError) {
        error = e.message;
      } else {
        error = e instanceof Error ? e.message : String(e);
      }
    } finally {
      importing = false;
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
          bind:value={selectedParserName}
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
            bind:value={knownSubAccountId}
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
        <input
          type="file"
          accept=".csv,text/csv"
          onchange={handleFile}
          class="mt-1 w-full text-sm text-muted-foreground"
        />
        {#if fileName}
          <span class="text-xs text-muted-foreground mt-1 block">
            {m.import_file_selected({ name: fileName })}
          </span>
        {/if}
      </label>
    </div>

    {#if error}
      <div
        class="border border-destructive bg-destructive/10 text-destructive rounded-lg px-4 py-2 text-sm"
      >
        {error}
      </div>
    {/if}
    {#if success}
      <div class="border border-primary bg-primary/10 text-foreground rounded-lg px-4 py-2 text-sm">
        ✓ {success}
      </div>
    {/if}
    {#if duplicateNotice}
      <div
        class="border border-amber-500 bg-amber-500/10 text-foreground rounded-lg px-4 py-2 text-sm"
      >
        ⚠ {duplicateNotice}
      </div>
    {/if}
  </section>

  {#if rows.length > 0}
    <section class="bg-card text-card-foreground rounded-xl shadow-sm overflow-hidden">
      <header class="flex items-baseline justify-between p-4 border-b border-border/50">
        <h3 class="text-sm font-semibold">{m.import_step_review()}</h3>
        <span class="text-xs text-muted-foreground tabular-nums">
          {m.import_planned_count({ valid: validCount, total: rows.length })}
        </span>
      </header>

      <div class="flex items-center gap-3 px-4 py-2 border-b border-border/50 text-xs">
        <button
          type="button"
          onclick={classifyRemainingWithLlm}
          disabled={llmClassifying}
          class="px-3 py-1 border rounded hover:bg-accent disabled:opacity-50"
        >
          {llmClassifying ? m.import_llm_button_running() : m.import_llm_button()}
        </button>
        {#if llmStatus}
          <span class="text-muted-foreground">{llmStatus}</span>
        {/if}
      </div>

      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead>
            <tr class="text-xs text-muted-foreground">
              <th class="text-left font-normal px-3 py-2">{m.journal_th_date()}</th>
              <th class="text-left font-normal px-3 py-2">{m.journal_th_description()}</th>
              <th class="text-right font-normal px-3 py-2">{m.journal_th_amount()}</th>
              <th class="text-left font-normal px-3 py-2">{m.import_th_counterpart()}</th>
              <th class="text-left font-normal px-3 py-2">{m.import_th_tax()}</th>
              <th class="text-center font-normal px-3 py-2">{m.import_th_skip()}</th>
            </tr>
          </thead>
          <tbody>
            {#each rows as row, i (i)}
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
                    <select
                      bind:value={row.counterpartAccountCode}
                      onchange={() => onCounterpartAccountChange(row)}
                      disabled={row.skip}
                      class="flex-1 px-2 py-1 bg-background border rounded text-foreground text-sm disabled:opacity-50"
                    >
                      <option value="">{m.journal_form_account_select()}</option>
                      {#each accountGroups as group (group.category)}
                        <optgroup label={group.label}>
                          {#each group.items as a (a.code)}
                            <option value={a.code}>{a.code} {a.name}</option>
                          {/each}
                        </optgroup>
                      {/each}
                    </select>
                    {#if row.matchedRuleId}
                      <span
                        class="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary whitespace-nowrap"
                        title={m.import_badge_rule_title()}>{m.import_badge_rule()}</span
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
      </div>

      <div class="flex justify-end gap-2 p-4 border-t border-border/50">
        <button
          type="button"
          onclick={reset}
          disabled={importing}
          class="px-4 py-2 border rounded hover:bg-accent disabled:opacity-50"
        >
          {m.common_cancel()}
        </button>
        <button
          type="button"
          onclick={submit}
          disabled={importing || validCount === 0}
          class="px-4 py-2 bg-primary text-primary-foreground rounded hover:opacity-90 disabled:opacity-50"
        >
          {importing ? m.import_submit_running() : m.import_submit({ count: validCount })}
        </button>
      </div>
    </section>
  {/if}
</div>

<CloudSendConfirmDialog
  open={llmConfirmOpen}
  host={llmPending?.host ?? ''}
  onconfirm={onLlmConfirm}
  oncancel={onLlmCancel}
/>
