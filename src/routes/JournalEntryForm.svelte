<script lang="ts">
  import { db } from '../db';
  import { validateLines } from '../domain/journal';
  import { expandHomeOffice, type SplittableLine } from '../domain/home-office';
  import { shouldConfirmAttachment } from '../domain/attachment-confirm';
  import { buildAttachmentRecord } from '../domain/attachments';
  import { D, formatJPY, toIndexable } from '../lib/decimal';
  import { todayISO } from '../lib/date';
  import { newId } from '../lib/id';
  import { exceedsLimit, formatBytes, MAX_IMAGE_BYTES } from '../lib/file-limit';
  import { getSetting, setSetting } from '../lib/settings';
  import { ledger } from '../stores/ledger.svelte';
  import AttachmentConfirmDialog from '../components/AttachmentConfirmDialog.svelte';
  import { m } from '../paraglide/messages';
  import type { IncomeType, InputUsageCategory, JournalLine, TaxCategory } from '../db/types';

  type DraftLine = {
    id: string;
    accountCode: string;
    subAccountId: string;
    amount: string;
    taxRate: number;
    taxIncluded: boolean;
    homeOfficeRatio: string;  // '' = 未設定 (=100%), '0.30' 等
    taxCategory: '' | TaxCategory;  // '' = 科目の既定値を使用
    inputUsageCategory: '' | InputUsageCategory;  // '' = taxableOnly 扱い
    itemId: string;   // 簡易在庫管理（C4）。仕入・売上科目でのみ意味を持つ
    quantity: string;
  };
  // 簡易在庫管理（C4）の対象科目（仕入・売上高）。実estate用の複製科目は対象外
  // （不動産所得に在庫の概念は無い）。
  const INVENTORY_TRACKED_ACCOUNTS = new Set(['5020', '4110']);

  const TAX_OPTIONS: Array<{ value: number; label: () => string }> = [
    { value: 0, label: () => m.journal_tax_exempt() },
    { value: 0.08, label: () => m.journal_tax_reduced() },
    { value: 0.1, label: () => m.journal_tax_standard() },
  ];
  // taxRate=0 のときだけ意味を持つ、科目の taxCategory 既定値の上書き（海外取引・非課税売上）
  const SPECIAL_TAX_CATEGORY_OPTIONS: Array<{ value: '' | TaxCategory; label: () => string }> = [
    { value: '', label: () => m.journal_tax_category_default() },
    { value: 'exportExempt', label: () => m.journal_tax_category_export_exempt() },
    { value: 'exempt', label: () => m.journal_tax_category_exempt() },
    { value: 'importTax10', label: () => m.journal_tax_category_import10() },
    { value: 'importTax8', label: () => m.journal_tax_category_import8() },
    { value: 'reverseCharge', label: () => m.journal_tax_category_reverse_charge() },
  ];
  // taxRate>0 のときだけ意味を持つ、貸倒れ・貸倒回収の税区分（元の売上・仕入の税率をそのまま使う）
  const BAD_DEBT_TAX_CATEGORY_OPTIONS: Array<{ value: '' | TaxCategory; label: () => string }> = [
    { value: '', label: () => m.journal_tax_category_default() },
    { value: 'badDebt', label: () => m.journal_tax_category_bad_debt() },
    { value: 'badDebtRecovery', label: () => m.journal_tax_category_bad_debt_recovery() },
  ];
  const USAGE_CATEGORY_OPTIONS: Array<{ value: '' | InputUsageCategory; label: () => string }> = [
    { value: '', label: () => m.journal_usage_category_taxable_only() },
    { value: 'common', label: () => m.journal_usage_category_common() },
    { value: 'nonTaxableOnly', label: () => m.journal_usage_category_non_taxable_only() },
  ];

  const today = () => todayISO();
  const emptyLine = (): DraftLine => ({
    id: newId(),
    accountCode: '',
    subAccountId: '',
    amount: '',
    taxRate: 0,
    taxIncluded: true,
    homeOfficeRatio: '',
    taxCategory: '',
    inputUsageCategory: '',
    itemId: '',
    quantity: '',
  });
  // emptyLine() と同じ内容か（id は無視）。未保存判定に使う
  const lineIsEmpty = (l: DraftLine): boolean =>
    l.accountCode === '' &&
    l.subAccountId === '' &&
    l.amount === '' &&
    l.taxRate === 0 &&
    l.taxIncluded === true &&
    l.homeOfficeRatio === '' &&
    l.taxCategory === '' &&
    l.inputUsageCategory === '' &&
    l.itemId === '' &&
    l.quantity === '';
  const linesPristine = (lines: DraftLine[]): boolean => {
    const first = lines[0];
    return lines.length === 1 && first !== undefined && lineIsEmpty(first);
  };

  let date = $state(today());
  let description = $state('');
  let department = $state('');
  // 証憑写真の添付（C7）。確認済みで送信待ちのファイル一覧。
  let attachments = $state<{ id: string; file: File; previewUrl: string }[]>([]);
  let attachmentError = $state('');
  let attachmentConfirmOpen = $state(false);
  let attachmentPreview = $state<string | null>(null);
  let pendingAttachmentFile: File | null = null;
  let pendingAttachmentInput: HTMLInputElement | null = null;
  let debits = $state<DraftLine[]>([emptyLine()]);
  let credits = $state<DraftLine[]>([emptyLine()]);
  let error = $state('');
  let saving = $state(false);
  // 事業/不動産の切替（セッション内のみ記憶、分錄には保存しない）。
  // realEstateIncomeEnabled が false の間はトグル自体を表示しない。
  let incomeType = $state<IncomeType>('business');

  const accountGroups = $derived(ledger.groupedAccounts(incomeType));

  function onIncomeTypeChange(next: IncomeType) {
    incomeType = next;
    for (const l of [...debits, ...credits]) {
      l.accountCode = '';
      l.subAccountId = '';
    }
  }

  function sumAmount(lines: DraftLine[]): string {
    return lines
      .reduce((s, l) => (l.amount ? s.plus(l.amount) : s), D(0))
      .toString();
  }

  const debitTotal = $derived(sumAmount(debits));
  const creditTotal = $derived(sumAmount(credits));
  const diff = $derived(D(debitTotal).minus(creditTotal).toString());
  const balanced = $derived(D(diff).isZero() && !D(debitTotal).isZero());
  // 入力途中でタブを閉じる・リロードした際にデータが無言で消えるのを防ぐ。
  // bind:value を多用しているため、入力ハンドラで flag を立てるより
  // reactive state 全体を初期状態と比較する $derived の方が非侵入的。
  const isDirty = $derived(
    description !== '' ||
    department !== '' ||
    attachments.length > 0 ||
    !linesPristine(debits) ||
    !linesPristine(credits)
  );
  $effect(() => {
    if (!isDirty) {
      return;
    }
    // beforeunload の既定動作を防ぐとブラウザが離脱確認ダイアログを出す。
    // 文言はブラウザ固定で自作不可のため独自メッセージは設定しない
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  });

  function addDebit() {
    debits = [...debits, emptyLine()];
  }
  function addCredit() {
    credits = [...credits, emptyLine()];
  }
  function removeLine(side: 'debit' | 'credit', id: string) {
    if (side === 'debit') {
      if (debits.length <= 1) {
        return;
      }
      debits = debits.filter((l) => l.id !== id);
    } else {
      if (credits.length <= 1) {
        return;
      }
      credits = credits.filter((l) => l.id !== id);
    }
  }
  function onAccountChange(line: DraftLine) {
    line.subAccountId = '';
  }
  // 借方・貸方ともに 1 行のみ、かつ貸方が空のときに借方金額を貸方へ初期コピー
  function onDebitAmountInput(line: DraftLine, value: string) {
    line.amount = value;
    if (
      debits.length === 1 &&
      credits.length === 1 &&
      credits[0] &&
      !credits[0].amount &&
      value
    ) {
      credits[0].amount = value;
    }
  }

  function reset() {
    description = '';
    department = '';
    for (const a of attachments) {
      URL.revokeObjectURL(a.previewUrl);
    }
    attachments = [];
    attachmentError = '';
    debits = [emptyLine()];
    credits = [emptyLine()];
    error = '';
  }

  async function handleAttachmentFile(e: Event) {
    attachmentError = '';
    const input = e.target as HTMLInputElement;
    const f = input.files?.[0];
    if (!f) {
      return;
    }
    if (exceedsLimit(f.size, MAX_IMAGE_BYTES)) {
      attachmentError = m.common_file_too_large({ size: formatBytes(f.size), limit: formatBytes(MAX_IMAGE_BYTES) });
      input.value = '';
      return;
    }
    if (shouldConfirmAttachment(await getSetting('skipAttachmentConfirm'))) {
      pendingAttachmentFile = f;
      pendingAttachmentInput = input;
      attachmentPreview = URL.createObjectURL(f);
      attachmentConfirmOpen = true;
      return;
    }
    stageAttachment(f);
    input.value = '';
  }

  function stageAttachment(f: File) {
    attachments = [...attachments, { id: newId(), file: f, previewUrl: URL.createObjectURL(f) }];
  }

  async function onAttachmentConfirm(dontAskAgain: boolean) {
    attachmentConfirmOpen = false;
    if (attachmentPreview) {
      URL.revokeObjectURL(attachmentPreview);
      attachmentPreview = null;
    }
    const f = pendingAttachmentFile;
    const input = pendingAttachmentInput;
    pendingAttachmentFile = null;
    pendingAttachmentInput = null;
    if (!f) {
      return;
    }
    if (dontAskAgain) {
      await setSetting('skipAttachmentConfirm', true);
    }
    stageAttachment(f);
    if (input) {
      input.value = '';
    }
  }

  function onAttachmentCancel() {
    attachmentConfirmOpen = false;
    if (attachmentPreview) {
      URL.revokeObjectURL(attachmentPreview);
      attachmentPreview = null;
    }
    pendingAttachmentFile = null;
    if (pendingAttachmentInput) {
      pendingAttachmentInput.value = '';
      pendingAttachmentInput = null;
    }
  }

  function removeAttachment(id: string) {
    const target = attachments.find((a) => a.id === id);
    if (target) {
      URL.revokeObjectURL(target.previewUrl);
    }
    attachments = attachments.filter((a) => a.id !== id);
  }

  async function handleSubmit(e: Event) {
    e.preventDefault();
    error = '';
    saving = true;
    try {
      const entryId = newId();
      const now = Date.now();

      type LineLike = {
        accountCode: string;
        subAccountId: string;
        amount: string;
        taxRate: number;
        taxIncluded: boolean;
        homeOfficeRatio: string;
        taxCategory?: '' | JournalLine['taxCategory'];
        inputUsageCategory?: '' | JournalLine['inputUsageCategory'];
        itemId?: string;
        quantity?: string;
      };
      const buildLines = (drafts: LineLike[], side: 'debit' | 'credit'): JournalLine[] =>
        drafts.map((d) => ({
          id: newId(),
          entryId,
          side,
          accountCode: d.accountCode,
          ...(d.subAccountId ? { subAccountId: d.subAccountId } : {}),
          amount: d.amount,
          amountIndexed: toIndexable(d.amount),
          taxRate: d.taxRate,
          taxIncluded: d.taxIncluded,
          invoiceCompliant: false,
          ...(d.homeOfficeRatio ? { homeOfficeRatio: d.homeOfficeRatio } : {}),
          ...(d.taxCategory ? { taxCategory: d.taxCategory } : {}),
          ...(d.inputUsageCategory ? { inputUsageCategory: d.inputUsageCategory } : {}),
          ...(d.itemId && d.quantity ? { itemId: d.itemId, quantity: d.quantity } : {}),
        }));
      // 家事按分のある借方明細を「事業使用分」+「事業主貸」に分解
      const debitsForExpansion: SplittableLine[] = debits.map((d) => ({
        id: d.id,
        side: 'debit',
        accountCode: d.accountCode,
        subAccountId: d.subAccountId,
        amount: d.amount,
        taxRate: d.taxRate,
        taxIncluded: d.taxIncluded,
        homeOfficeRatio: d.homeOfficeRatio,
        taxCategory: d.taxCategory,
        inputUsageCategory: d.inputUsageCategory,
        itemId: d.itemId,
        quantity: d.quantity,
      }));
      const expandedDebits = expandHomeOffice(debitsForExpansion);

      const lines = [
        ...buildLines(expandedDebits, 'debit'),
        ...buildLines(credits, 'credit'),
      ];
      validateLines(lines);

      await db.transaction(
        'rw',
        [db.journalEntries, db.journalLines, db.attachments],
        async () => {
          await db.journalEntries.add({
            id: entryId,
            date,
            year: Number(date.slice(0, 4)),
            description,
            ...(department ? { department } : {}),
            status: 'confirmed',
            source: 'manual',
            createdAt: now,
            confirmedAt: now,
          });
          await db.journalLines.bulkAdd(lines);
          if (attachments.length > 0) {
            await db.attachments.bulkAdd(
              attachments.map((a) => buildAttachmentRecord(entryId, a.file, now))
            );
          }
        }
      );

      reset();
      date = today();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      saving = false;
    }
  }
</script>

<form
  onsubmit={handleSubmit}
  class="space-y-4 border rounded-lg p-6 bg-card text-card-foreground"
>
  <h2 class="text-lg font-semibold">{m.journal_form_title()}</h2>

  {#if ledger.realEstateIncomeEnabled}
    <div class="flex gap-2 text-sm" role="radiogroup" aria-label={m.journal_form_income_type_label()}>
      <button
        type="button"
        role="radio"
        aria-checked={incomeType === 'business'}
        onclick={() => onIncomeTypeChange('business')}
        class="px-3 py-1 rounded border"
        class:bg-primary={incomeType === 'business'}
        class:text-primary-foreground={incomeType === 'business'}
      >
        {m.journal_form_income_type_business()}
      </button>
      <button
        type="button"
        role="radio"
        aria-checked={incomeType === 'realEstate'}
        onclick={() => onIncomeTypeChange('realEstate')}
        class="px-3 py-1 rounded border"
        class:bg-primary={incomeType === 'realEstate'}
        class:text-primary-foreground={incomeType === 'realEstate'}
      >
        {m.journal_form_income_type_real_estate()}
      </button>
    </div>
  {/if}

  <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
    <label class="block sm:col-span-1">
      <span class="text-xs text-muted-foreground">{m.journal_form_label_date()}</span>
      <input
        type="date"
        bind:value={date}
        required
        class="mt-1 w-full px-3 py-2 bg-background border rounded text-foreground tabular-nums"
      />
    </label>
    <label class="block sm:col-span-2">
      <span class="text-xs text-muted-foreground">{m.journal_form_label_description()}</span>
      <input
        type="text"
        bind:value={description}
        required
        placeholder={m.journal_form_placeholder_description()}
        class="mt-1 w-full px-3 py-2 bg-background border rounded text-foreground"
      />
    </label>
    <label class="block sm:col-span-3">
      <span class="text-xs text-muted-foreground">{m.journal_form_label_department()}</span>
      <input
        type="text"
        list="department-options"
        bind:value={department}
        placeholder={m.journal_form_placeholder_department()}
        class="mt-1 w-full px-3 py-2 bg-background border rounded text-foreground"
      />
      <datalist id="department-options">
        {#each ledger.departments as d (d)}
          <option value={d}></option>
        {/each}
      </datalist>
    </label>
    <label class="block sm:col-span-3">
      <span class="text-xs text-muted-foreground">{m.journal_form_label_attachment()}</span>
      <input
        type="file"
        accept="image/*"
        onchange={handleAttachmentFile}
        class="mt-1 w-full text-sm text-muted-foreground"
      />
      {#if attachmentError}
        <p class="mt-1 text-xs text-destructive">{attachmentError}</p>
      {/if}
      {#if attachments.length > 0}
        <ul class="mt-2 flex flex-wrap gap-2">
          {#each attachments as a (a.id)}
            <li class="relative">
              <img src={a.previewUrl} alt={a.file.name} class="h-16 w-16 object-cover rounded border" />
              <button
                type="button"
                onclick={() => removeAttachment(a.id)}
                class="absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full bg-destructive text-destructive-foreground text-xs leading-none"
                aria-label={m.journal_form_attachment_remove()}
              >
                ×
              </button>
            </li>
          {/each}
        </ul>
      {/if}
    </label>
  </div>

  <div class="border-t pt-4 space-y-2">
    <div class="flex items-center justify-between">
      <h3 class="text-sm font-medium text-muted-foreground">{m.journal_side_debit()}</h3>
      <span class="text-xs text-muted-foreground tabular-nums">{m.journal_form_total({ amount: formatJPY(debitTotal) })}</span>
    </div>
    {#each debits as line, i (line.id)}
      {@const subs = line.accountCode ? ledger.subAccountsFor(line.accountCode) : []}
      <div class="grid grid-cols-1 sm:grid-cols-[1fr_auto_auto_auto] gap-2 items-start">
        <div class="space-y-2">
          <select
            bind:value={line.accountCode}
            onchange={() => onAccountChange(line)}
            required
            class="w-full px-3 py-2 bg-background border rounded text-foreground"
          >
            <option value="" disabled>{m.journal_form_account_select()}</option>
            {#each accountGroups as group (group.category)}
              <optgroup label={group.label}>
                {#each group.items as a (a.code)}
                  <option value={a.code}>{a.code} {a.name}</option>
                {/each}
              </optgroup>
            {/each}
          </select>
          {#if subs.length > 0}
            <select
              bind:value={line.subAccountId}
              class="w-full px-3 py-2 bg-background border rounded text-foreground text-sm"
            >
              <option value="">{m.journal_form_subaccount_select()}</option>
              {#each subs as s (s.id)}
                <option value={s.id}>{s.name}</option>
              {/each}
            </select>
          {/if}
        </div>
        <input
          type="number"
          value={line.amount}
          oninput={(e) => onDebitAmountInput(line, (e.target as HTMLInputElement).value)}
          required
          min="0"
          step="1"
          placeholder={m.journal_form_amount_placeholder()}
          class="w-32 px-3 py-2 bg-background border rounded text-right text-foreground tabular-nums"
        />
        <select
          bind:value={line.taxRate}
          class="px-3 py-2 bg-background border rounded text-foreground text-sm"
        >
          {#each TAX_OPTIONS as opt (opt.value)}
            <option value={opt.value}>{opt.label()}</option>
          {/each}
        </select>
        <button
          type="button"
          onclick={() => removeLine('debit', line.id)}
          disabled={debits.length <= 1}
          aria-label={m.journal_form_remove_line_label()}
          class="px-2 py-2 text-muted-foreground hover:text-destructive disabled:opacity-30"
        >
          ×
        </button>
      </div>
      {#if line.accountCode}
        <div class="flex gap-3 ml-1 mb-2 text-xs items-center text-muted-foreground">
          <label class="flex items-center gap-1 cursor-pointer">
            <input type="checkbox" bind:checked={line.taxIncluded} /> {m.journal_form_tax_included()}
          </label>
          <label class="flex items-center gap-1">
            {m.journal_form_home_office()}
            <input
              type="number"
              value={line.homeOfficeRatio}
              oninput={(e) => {
                line.homeOfficeRatio = (e.target as HTMLInputElement).value;
              }}
              min="0"
              max="1"
              step="0.01"
              placeholder="1.0"
              class="w-16 px-2 py-0.5 bg-background border rounded text-foreground tabular-nums"
            />
          </label>
          {#if line.taxRate === 0}
            <select
              bind:value={line.taxCategory}
              class="px-2 py-0.5 bg-background border rounded text-foreground"
            >
              {#each SPECIAL_TAX_CATEGORY_OPTIONS as opt (opt.value)}
                <option value={opt.value}>{opt.label()}</option>
              {/each}
            </select>
          {:else}
            <select
              bind:value={line.taxCategory}
              class="px-2 py-0.5 bg-background border rounded text-foreground"
            >
              {#each BAD_DEBT_TAX_CATEGORY_OPTIONS as opt (opt.value)}
                <option value={opt.value}>{opt.label()}</option>
              {/each}
            </select>
          {/if}
          <select
            bind:value={line.inputUsageCategory}
            class="px-2 py-0.5 bg-background border rounded text-foreground"
          >
            {#each USAGE_CATEGORY_OPTIONS as opt (opt.value)}
              <option value={opt.value}>{opt.label()}</option>
            {/each}
          </select>
          {#if ledger.inventoryAutoValuationEnabled && INVENTORY_TRACKED_ACCOUNTS.has(line.accountCode)}
            <select
              bind:value={line.itemId}
              class="px-2 py-0.5 bg-background border rounded text-foreground"
            >
              <option value="">{m.journal_form_inventory_item_select()}</option>
              {#each ledger.inventoryItems as it (it.id)}
                <option value={it.id}>{it.name}</option>
              {/each}
            </select>
            {#if line.itemId}
              <input
                type="number"
                bind:value={line.quantity}
                min="0"
                step="1"
                placeholder={m.journal_form_inventory_quantity_placeholder()}
                class="w-20 px-2 py-0.5 bg-background border rounded text-right text-foreground tabular-nums"
              />
            {/if}
          {/if}
        </div>
      {/if}
    {/each}
    <button
      type="button"
      onclick={addDebit}
      class="text-xs text-muted-foreground hover:text-foreground"
    >
      {m.journal_form_add_debit()}
    </button>
  </div>

  <div class="border-t pt-4 space-y-2">
    <div class="flex items-center justify-between">
      <h3 class="text-sm font-medium text-muted-foreground">{m.journal_side_credit()}</h3>
      <span class="text-xs text-muted-foreground tabular-nums">{m.journal_form_total({ amount: formatJPY(creditTotal) })}</span>
    </div>
    {#each credits as line, i (line.id)}
      {@const subs = line.accountCode ? ledger.subAccountsFor(line.accountCode) : []}
      <div class="grid grid-cols-1 sm:grid-cols-[1fr_auto_auto_auto] gap-2 items-start">
        <div class="space-y-2">
          <select
            bind:value={line.accountCode}
            onchange={() => onAccountChange(line)}
            required
            class="w-full px-3 py-2 bg-background border rounded text-foreground"
          >
            <option value="" disabled>{m.journal_form_account_select()}</option>
            {#each accountGroups as group (group.category)}
              <optgroup label={group.label}>
                {#each group.items as a (a.code)}
                  <option value={a.code}>{a.code} {a.name}</option>
                {/each}
              </optgroup>
            {/each}
          </select>
          {#if subs.length > 0}
            <select
              bind:value={line.subAccountId}
              class="w-full px-3 py-2 bg-background border rounded text-foreground text-sm"
            >
              <option value="">{m.journal_form_subaccount_select()}</option>
              {#each subs as s (s.id)}
                <option value={s.id}>{s.name}</option>
              {/each}
            </select>
          {/if}
        </div>
        <input
          type="number"
          value={line.amount}
          oninput={(e) => {
            line.amount = (e.target as HTMLInputElement).value;
          }}
          required
          min="0"
          step="1"
          placeholder={m.journal_form_amount_placeholder()}
          class="w-32 px-3 py-2 bg-background border rounded text-right text-foreground tabular-nums"
        />
        <select
          bind:value={line.taxRate}
          class="px-3 py-2 bg-background border rounded text-foreground text-sm"
        >
          {#each TAX_OPTIONS as opt (opt.value)}
            <option value={opt.value}>{opt.label()}</option>
          {/each}
        </select>
        <button
          type="button"
          onclick={() => removeLine('credit', line.id)}
          disabled={credits.length <= 1}
          aria-label={m.journal_form_remove_line_label()}
          class="px-2 py-2 text-muted-foreground hover:text-destructive disabled:opacity-30"
        >
          ×
        </button>
      </div>
      {#if line.accountCode}
        <div class="flex gap-3 ml-1 mb-2 text-xs items-center text-muted-foreground">
          <label class="flex items-center gap-1 cursor-pointer">
            <input type="checkbox" bind:checked={line.taxIncluded} /> {m.journal_form_tax_included()}
          </label>
          <label class="flex items-center gap-1">
            {m.journal_form_home_office()}
            <input
              type="number"
              value={line.homeOfficeRatio}
              oninput={(e) => {
                line.homeOfficeRatio = (e.target as HTMLInputElement).value;
              }}
              min="0"
              max="1"
              step="0.01"
              placeholder="1.0"
              class="w-16 px-2 py-0.5 bg-background border rounded text-foreground tabular-nums"
            />
          </label>
          {#if line.taxRate === 0}
            <select
              bind:value={line.taxCategory}
              class="px-2 py-0.5 bg-background border rounded text-foreground"
            >
              {#each SPECIAL_TAX_CATEGORY_OPTIONS as opt (opt.value)}
                <option value={opt.value}>{opt.label()}</option>
              {/each}
            </select>
          {:else}
            <select
              bind:value={line.taxCategory}
              class="px-2 py-0.5 bg-background border rounded text-foreground"
            >
              {#each BAD_DEBT_TAX_CATEGORY_OPTIONS as opt (opt.value)}
                <option value={opt.value}>{opt.label()}</option>
              {/each}
            </select>
          {/if}
          <select
            bind:value={line.inputUsageCategory}
            class="px-2 py-0.5 bg-background border rounded text-foreground"
          >
            {#each USAGE_CATEGORY_OPTIONS as opt (opt.value)}
              <option value={opt.value}>{opt.label()}</option>
            {/each}
          </select>
          {#if ledger.inventoryAutoValuationEnabled && INVENTORY_TRACKED_ACCOUNTS.has(line.accountCode)}
            <select
              bind:value={line.itemId}
              class="px-2 py-0.5 bg-background border rounded text-foreground"
            >
              <option value="">{m.journal_form_inventory_item_select()}</option>
              {#each ledger.inventoryItems as it (it.id)}
                <option value={it.id}>{it.name}</option>
              {/each}
            </select>
            {#if line.itemId}
              <input
                type="number"
                bind:value={line.quantity}
                min="0"
                step="1"
                placeholder={m.journal_form_inventory_quantity_placeholder()}
                class="w-20 px-2 py-0.5 bg-background border rounded text-right text-foreground tabular-nums"
              />
            {/if}
          {/if}
        </div>
      {/if}
    {/each}
    <button
      type="button"
      onclick={addCredit}
      class="text-xs text-muted-foreground hover:text-foreground"
    >
      {m.journal_form_add_credit()}
    </button>
  </div>

  <div class="border-t pt-4 flex items-center justify-between text-sm">
    <div class="space-x-4 tabular-nums">
      <span class="text-muted-foreground">{m.journal_form_diff()}</span>
      <span class:text-destructive={!balanced} class="font-medium">{formatJPY(diff)}</span>
      {#if balanced}
        <span class="text-xs text-muted-foreground">{m.journal_form_balanced()}</span>
      {/if}
    </div>
  </div>

  {#if error}
    <div class="text-sm text-destructive">{error}</div>
  {/if}

  <div class="flex gap-2 justify-end">
    <button
      type="button"
      onclick={reset}
      disabled={saving}
      class="px-4 py-2 border rounded hover:bg-accent disabled:opacity-50"
    >
      {m.journal_form_clear()}
    </button>
    <button
      type="submit"
      disabled={saving || !balanced}
      class="px-4 py-2 bg-primary text-primary-foreground rounded hover:opacity-90 disabled:opacity-50"
    >
      {saving ? m.common_saving() : m.journal_form_submit()}
    </button>
  </div>
</form>

<AttachmentConfirmDialog
  open={attachmentConfirmOpen}
  previewUrl={attachmentPreview}
  onconfirm={onAttachmentConfirm}
  oncancel={onAttachmentCancel}
/>