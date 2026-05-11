<script lang="ts">
  import { db } from '../db';
  import {
    commitImport,
    computeFileHash,
    DuplicateImportError,
    type ImportRow,
  } from '../domain/import';
  import { findMatchingRule, recordRuleHit } from '../domain/rules';
  import { GeminiAdapter } from '../domain/llm';
  import { classifyWithLlm, type ClassifyInput } from '../domain/llm-classify';
  import { getSetting } from '../lib/settings';
  import { formatJPY } from '../lib/decimal';
  import { PARSERS, findParser } from '../parsers';
  import type { ParsedTransaction } from '../parsers/types';
  import { ledger } from '../stores/ledger.svelte';
  import type { Account } from '../db/types';

  type RowState = {
    transaction: ParsedTransaction;
    counterpartAccountCode: string;
    counterpartSubAccountId: string;
    description: string;
    skip: boolean;
    matchedRuleId: string;       // ルール命中時の ID、'' = 非適用
    llmConfidence: '' | 'high' | 'low';  // LLM 分類の信頼度、'' = LLM 未適用
  };

  let selectedParserName = $state(PARSERS[0]?.name ?? '');
  let fileName = $state('');
  let fileHash = $state('');
  let rows = $state<RowState[]>([]);
  let knownSubAccountId = $state('');
  let importing = $state(false);
  let llmClassifying = $state(false);
  let llmStatus = $state('');
  let error = $state('');
  let success = $state('');

  const currentParser = $derived(findParser(selectedParserName));
  const knownAccount = $derived(
    currentParser
      ? ledger.accounts.find((a) => a.code === currentParser.accountCode)
      : null
  );
  const knownSubAccounts = $derived(
    currentParser ? ledger.subAccountsFor(currentParser.accountCode) : []
  );
  const accountGroups = $derived(ledger.groupedAccounts());
  const validCount = $derived(
    rows.filter((r) => !r.skip && r.counterpartAccountCode.length > 0).length
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
    fileName = file.name;
    try {
      const buffer = await file.arrayBuffer();
      const text = new TextDecoder(currentParser.encoding).decode(buffer);
      fileHash = await computeFileHash(text);

      const dup = await db.importBatches
        .where('fileHash')
        .equals(fileHash)
        .first();
      if (dup) {
        error = `このファイルは ${new Date(dup.importedAt).toLocaleDateString('ja-JP')} に既にインポート済みです（${dup.fileName}）`;
        return;
      }

      const txs = currentParser.parse(text);
      rows = await Promise.all(
        txs.map(async (t): Promise<RowState> => {
          const rule = await findMatchingRule(t.description);
          return {
            transaction: t,
            counterpartAccountCode: rule?.accountCode ?? '',
            counterpartSubAccountId: '',
            description: t.description,
            skip: false,
            matchedRuleId: rule?.id ?? '',
            llmConfidence: '',
          };
        })
      );
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }

  function onCounterpartAccountChange(row: RowState) {
    row.counterpartSubAccountId = '';
    // ユーザーが上書きしたら自動分類の出所を解除
    row.matchedRuleId = '';
    row.llmConfidence = '';
  }

  function counterpartCandidates(knownSide: 'debit' | 'credit'): Account[] {
    // 既知側の反対側として妥当な科目を選ぶ
    if (knownSide === 'debit') {
      // 既知が借方（入金等）→ 対方は貸方：収益 or 資産（振替）
      return ledger.accounts.filter(
        (a) => a.category === 'revenue' || a.category === 'asset'
      );
    }
    // 既知が貸方（出金等）→ 対方は借方：費用 or 資産（振替・前払）
    return ledger.accounts.filter(
      (a) => a.category === 'expense' || a.category === 'asset'
    );
  }

  async function classifyRemainingWithLlm() {
    if (!currentParser) {
      return;
    }
    llmStatus = '';
    error = '';

    const apiKey = await getSetting('geminiApiKey');
    if (!apiKey) {
      error = 'Gemini API キーが設定されていません。設定 → LLM 連携 で登録してください。';
      return;
    }

    const targets = rows
      .map((row, index) => ({ row, index }))
      .filter(({ row }) => !row.skip && !row.counterpartAccountCode);
    if (targets.length === 0) {
      llmStatus = '分類対象がありません';
      return;
    }

    llmClassifying = true;
    try {
      const adapter = new GeminiAdapter(apiKey);
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
      llmStatus = `✓ ${highCount + lowCount} 件を分類（高信頼 ${highCount} / 低信頼 ${lowCount}${noneCount > 0 ? ` / 判別不能 ${noneCount}` : ''}）`;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      llmClassifying = false;
    }
  }

  function reset() {
    rows = [];
    fileName = '';
    fileHash = '';
    knownSubAccountId = '';
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
        ...(r.description !== r.transaction.description
          ? { description: r.description }
          : {}),
        skip: r.skip,
      }));
      const result = await commitImport(
        {
          parserName: currentParser.name,
          fileName,
          fileHash,
          knownAccountCode: currentParser.accountCode,
          ...(knownSubAccountId ? { knownSubAccountId } : {}),
        },
        importRows
      );
      // 採用されたルールの hitCount をインクリメント
      const ruleIds = new Set(
        rows
          .filter(
            (r) =>
              !r.skip &&
              r.matchedRuleId.length > 0 &&
              r.counterpartAccountCode.length > 0
          )
          .map((r) => r.matchedRuleId)
      );
      for (const id of ruleIds) {
        await recordRuleHit(id);
      }
      success = `${result.entryCount} 件の仕訳を登録しました`;
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
    <h2 class="text-2xl font-bold">CSV インポート</h2>
    <p class="text-xs text-muted-foreground">銀行・カードの取引履歴 CSV から仕訳をまとめて作成</p>
  </header>

  <section class="bg-card text-card-foreground rounded-xl p-6 space-y-4 shadow-sm">
    <div class="space-y-3">
      <label class="block">
        <span class="text-xs text-muted-foreground">1. パーサー</span>
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
          既知側科目：<span class="font-mono">{knownAccount.code}</span> {knownAccount.name}
        </p>
      {/if}

      {#if knownSubAccounts.length > 0}
        <label class="block">
          <span class="text-xs text-muted-foreground">補助科目（任意）</span>
          <select
            bind:value={knownSubAccountId}
            class="mt-1 w-full px-3 py-2 bg-background border rounded text-foreground"
          >
            <option value="">—（補助科目なし）</option>
            {#each knownSubAccounts as s (s.id)}
              <option value={s.id}>{s.name}</option>
            {/each}
          </select>
        </label>
      {/if}

      <label class="block">
        <span class="text-xs text-muted-foreground">2. CSV ファイル</span>
        <input
          type="file"
          accept=".csv,text/csv"
          onchange={handleFile}
          class="mt-1 w-full text-sm text-muted-foreground"
        />
        {#if fileName}
          <span class="text-xs text-muted-foreground mt-1 block">
            選択中：{fileName}
          </span>
        {/if}
      </label>
    </div>

    {#if error}
      <div class="border border-destructive bg-destructive/10 text-destructive rounded-lg px-4 py-2 text-sm">
        {error}
      </div>
    {/if}
    {#if success}
      <div class="border border-primary bg-primary/10 text-foreground rounded-lg px-4 py-2 text-sm">
        ✓ {success}
      </div>
    {/if}
  </section>

  {#if rows.length > 0}
    <section class="bg-card text-card-foreground rounded-xl shadow-sm overflow-hidden">
      <header class="flex items-baseline justify-between p-4 border-b border-border/50">
        <h3 class="text-sm font-semibold">3. 各行の対方科目を選ぶ</h3>
        <span class="text-xs text-muted-foreground tabular-nums">
          {validCount} / {rows.length} 件 登録予定
        </span>
      </header>

      <div class="flex items-center gap-3 px-4 py-2 border-b border-border/50 text-xs">
        <button
          type="button"
          onclick={classifyRemainingWithLlm}
          disabled={llmClassifying}
          class="px-3 py-1 border rounded hover:bg-accent disabled:opacity-50"
        >
          {llmClassifying ? '⏳ LLM で分類中…' : 'LLM で残りを分類'}
        </button>
        {#if llmStatus}
          <span class="text-muted-foreground">{llmStatus}</span>
        {/if}
      </div>

      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead>
            <tr class="text-xs text-muted-foreground">
              <th class="text-left font-normal px-3 py-2">日付</th>
              <th class="text-left font-normal px-3 py-2">摘要</th>
              <th class="text-right font-normal px-3 py-2">金額</th>
              <th class="text-left font-normal px-3 py-2">対方科目</th>
              <th class="text-center font-normal px-3 py-2">除外</th>
            </tr>
          </thead>
          <tbody>
            {#each rows as row, i (i)}
              {@const subs = row.counterpartAccountCode
                ? ledger.subAccountsFor(row.counterpartAccountCode)
                : []}
              <tr
                class="border-t border-border/50 align-top"
                class:opacity-50={row.skip}
              >
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
                  <span
                    class:text-destructive={row.transaction.side === 'credit'}
                  >
                    {row.transaction.side === 'debit' ? '+' : '-'}{formatJPY(row.transaction.amount)}
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
                      <option value="">科目を選択</option>
                      {#each accountGroups as group (group.category)}
                        <optgroup label={group.label}>
                          {#each group.items as a (a.code)}
                            <option value={a.code}>{a.code} {a.name}</option>
                          {/each}
                        </optgroup>
                      {/each}
                    </select>
                    {#if row.matchedRuleId}
                      <span class="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary whitespace-nowrap" title="ルール命中">規則</span>
                    {:else if row.llmConfidence === 'high'}
                      <span class="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary whitespace-nowrap" title="LLM 高信頼">LLM↑</span>
                    {:else if row.llmConfidence === 'low'}
                      <span class="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground whitespace-nowrap" title="LLM 低信頼、確認推奨">LLM↓</span>
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
          キャンセル
        </button>
        <button
          type="button"
          onclick={submit}
          disabled={importing || validCount === 0}
          class="px-4 py-2 bg-primary text-primary-foreground rounded hover:opacity-90 disabled:opacity-50"
        >
          {importing ? '登録中…' : `${validCount} 件登録`}
        </button>
      </div>
    </section>
  {/if}
</div>