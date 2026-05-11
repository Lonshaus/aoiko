<script lang="ts">
  import { db } from '../db';
  import { validateLines } from '../domain/journal';
  import { GeminiAdapter } from '../domain/llm';
  import {
    extractReceipt,
    fileToBase64,
    type ReceiptExtracted,
  } from '../domain/ocr';
  import { toIndexable } from '../lib/decimal';
  import { formatJPY } from '../lib/decimal';
  import { newId } from '../lib/id';
  import { getSetting } from '../lib/settings';
  import { ledger } from '../stores/ledger.svelte';
  import type { JournalLine } from '../db/types';

  let file = $state<File | null>(null);
  let preview = $state<string | null>(null);
  let extracted = $state<ReceiptExtracted | null>(null);
  let counterpartAccount = $state('5910');  // 雑費 デフォルト
  let knownAccount = $state('1110');         // 現金 デフォルト
  let processing = $state(false);
  let error = $state('');
  let success = $state('');

  const accountGroups = $derived(ledger.groupedAccounts());

  async function handleFile(e: Event) {
    const input = e.target as HTMLInputElement;
    const f = input.files?.[0];
    if (!f) {
      return;
    }
    file = f;
    extracted = null;
    error = '';
    success = '';
    if (preview) {
      URL.revokeObjectURL(preview);
    }
    preview = URL.createObjectURL(f);
  }

  async function analyze() {
    if (!file) {
      return;
    }
    processing = true;
    error = '';
    try {
      const apiKey = await getSetting('geminiApiKey');
      if (!apiKey) {
        throw new Error('Gemini API キーが未設定です。設定 → LLM 連携 で登録してください。');
      }
      const image = await fileToBase64(file);
      const adapter = new GeminiAdapter(apiKey);
      extracted = await extractReceipt(adapter, image);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      processing = false;
    }
  }

  async function commit() {
    if (!extracted) {
      return;
    }
    const data = extracted;  // 以降のクロージャ内でも narrowed 保証
    error = '';
    success = '';
    try {
      const entryId = newId();
      const now = Date.now();
      const lines: JournalLine[] = [
        {
          id: newId(),
          entryId,
          side: 'debit',
          accountCode: counterpartAccount,
          amount: data.totalAmount,
          amountIndexed: toIndexable(data.totalAmount),
          taxRate: data.taxRate ?? 0,
          taxIncluded: true,
          invoiceCompliant: !!data.invoiceNumber,
        },
        {
          id: newId(),
          entryId,
          side: 'credit',
          accountCode: knownAccount,
          amount: data.totalAmount,
          amountIndexed: toIndexable(data.totalAmount),
          taxRate: 0,
          taxIncluded: true,
          invoiceCompliant: false,
        },
      ];
      validateLines(lines);

      const description = data.vendorName || '領収書 OCR';
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
            source: 'ocr',
            createdAt: now,
            confirmedAt: now,
          });
          await db.journalLines.bulkAdd(lines);
        }
      );

      success = `✓ 仕訳を登録しました（${description} ${formatJPY(data.totalAmount)}）`;
      extracted = null;
      file = null;
      if (preview) {
        URL.revokeObjectURL(preview);
        preview = null;
      }
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }

  function reset() {
    extracted = null;
    file = null;
    if (preview) {
      URL.revokeObjectURL(preview);
      preview = null;
    }
    error = '';
    success = '';
  }
</script>

<div class="space-y-6">
  <header>
    <h2 class="text-2xl font-bold">領収書 OCR</h2>
    <p class="text-xs text-muted-foreground">
      レシート画像から Gemini Vision で取引情報を抽出 → 確認 → 仕訳化（BYOK、API キーが必要）
    </p>
  </header>

  <section class="bg-card text-card-foreground rounded-xl p-6 space-y-4 shadow-sm">
    <label class="block">
      <span class="text-xs text-muted-foreground">1. 画像を選ぶ（カメラ撮影も可）</span>
      <input
        type="file"
        accept="image/*"
        capture="environment"
        onchange={handleFile}
        class="mt-1 w-full text-sm text-muted-foreground"
      />
    </label>

    {#if preview}
      <div class="border rounded-lg overflow-hidden bg-background flex items-center justify-center">
        <img src={preview} alt="プレビュー" class="max-h-80 object-contain" />
      </div>
    {/if}

    {#if file && !extracted}
      <button
        type="button"
        onclick={analyze}
        disabled={processing}
        class="px-4 py-2 bg-primary text-primary-foreground rounded hover:opacity-90 disabled:opacity-50"
      >
        {processing ? '⏳ 解析中…' : '解析する（Gemini Vision）'}
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
      <h3 class="text-lg font-semibold">2. 抽出結果（編集可）</h3>

      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <label class="block">
          <span class="text-xs text-muted-foreground">取引日</span>
          <input
            type="date"
            bind:value={extracted.date}
            class="mt-1 w-full px-3 py-2 bg-background border rounded text-foreground tabular-nums"
          />
        </label>
        <label class="block">
          <span class="text-xs text-muted-foreground">店名 / 取引先</span>
          <input
            type="text"
            bind:value={extracted.vendorName}
            class="mt-1 w-full px-3 py-2 bg-background border rounded text-foreground"
          />
        </label>
        <label class="block">
          <span class="text-xs text-muted-foreground">合計金額（円）</span>
          <input
            type="number"
            bind:value={extracted.totalAmount}
            min="0"
            step="1"
            class="mt-1 w-full px-3 py-2 bg-background border rounded text-right text-foreground tabular-nums"
          />
        </label>
        {#if extracted.invoiceNumber}
          <div class="block">
            <span class="text-xs text-muted-foreground">インボイス登録番号</span>
            <div class="mt-1 px-3 py-2 bg-background border rounded font-mono text-sm">
              {extracted.invoiceNumber}
            </div>
          </div>
        {/if}
      </div>

      {#if extracted.items.length > 0}
        <details class="border rounded-lg">
          <summary class="cursor-pointer px-3 py-2 text-sm text-muted-foreground">
            内訳 {extracted.items.length} 件
          </summary>
          <ul class="border-t divide-y divide-border/50">
            {#each extracted.items as item, i (i)}
              <li class="flex justify-between px-3 py-2 text-sm">
                <span>{item.description}</span>
                <span class="tabular-nums">{formatJPY(item.amount)}</span>
              </li>
            {/each}
          </ul>
        </details>
      {/if}

      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-4 border-t border-border/50">
        <label class="block">
          <span class="text-xs text-muted-foreground">対方科目（経費）</span>
          <select
            bind:value={counterpartAccount}
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
        <label class="block">
          <span class="text-xs text-muted-foreground">支払元</span>
          <select
            bind:value={knownAccount}
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
          キャンセル
        </button>
        <button
          type="button"
          onclick={commit}
          class="px-4 py-2 bg-primary text-primary-foreground rounded hover:opacity-90"
        >
          仕訳を登録
        </button>
      </div>
    </section>
  {/if}
</div>