<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { SvelteMap, SvelteSet } from 'svelte/reactivity';
  import { liveQuery } from 'dexie';
  import { clearUnsavedGuard, link, setUnsavedGuard } from '../router.svelte';
  import { db } from '../db';
  import { newId } from '../lib/id';
  import { assignInputNumberOrEmpty, assignInputString } from '../lib/number-input';
  import {
    isFilerZipInvalid,
    isRiyoshaIdInvalid,
    normalizeFilerZip,
    normalizeRiyoshaId,
    readFilerField,
    type FilerFieldKind,
  } from '../lib/filer-fields';
  import {
    isAmountInputInvalid,
    isJournalAmountTooLarge,
    normalizeAmountInput,
    parseAmountInput,
    parseIntegerInput,
    readStoredAmount,
    storedToInputText,
  } from '../lib/amount-input';
  import {
    describeConversionBasisOverCost,
    describeFixedAssetIssues,
    describeInvalidFixedAssets,
    fixedAssetIssueScope,
    fixedAssetLabel,
    hasComputeIssue,
    validateFixedAsset,
    type FixedAssetIssue,
  } from '../domain/fixed-asset-check';
  import { isValidIsoDate, toISODateLocal, todayISO } from '../lib/date';
  import { nativeBridge } from '../lib/native-bridge';
  import { readPreviewPlatform, writePreviewPlatform } from '../lib/doc-preview';
  import { isPlatform, PLATFORMS, type Platform } from '../lib/build-only';
  import { formatBytes } from '../lib/file-limit';
  import { describeStorageError } from '../lib/storage-error';
  import { describeLlmError } from '../domain/llm';
  import {
    DISCLAIMER_VERSION,
    deleteSetting,
    getSetting,
    setSetting,
    type AiEngine,
  } from '../lib/settings';
  import { m } from '../paraglide/messages';
  import { getLocale, setLocale, locales, type Locale } from '../paraglide/runtime';
  import { ledger } from '../stores/ledger.svelte';
  import { saveFile } from '../lib/save-file';
  import { backup } from '../stores/backup.svelte';
  import { isValidDefaultRatio } from '../domain/home-office';
  import { BackupCorruptError } from '../backup';
  import { BackupTooLargeError, parseBackupFile, restoreFromPayload } from '../domain/restore';
  import { stashRestoreNotice, takeRestoreNotice } from '../lib/restore-notice';
  import { takeSettingsTarget } from '../lib/settings-target';
  import { describeFoundAmounts, findOversizedAmounts } from '../domain/oversized-amounts';
  import {
    exportCorrectionHistoryCsv,
    exportGenericCsv,
    exportYayoiCsv,
  } from '../domain/accountant-export';
  import {
    buildDepreciationInputs,
    computeDepreciation,
    depreciableCost,
    generateYearEndDepreciation,
    InvalidBusinessDateError,
    readBusinessDateSources,
    readStoredBusinessDate,
    saveBusinessDateSettings,
    selectEffectiveBusinessDates,
    serviceStartDate,
    type BusinessDateField,
    type BusinessDateSelection,
    type BusinessDateSources,
    type StoredBusinessDate,
  } from '../domain/depreciation';
  import { readVisibleInterruptedOpeningYears } from '../domain/business-opening';
  import {
    aggregateTransferIncome,
    estimateTransferIncome,
    generateDisposalEntry,
    transferIncomeByTerm,
  } from '../domain/asset-disposal';
  import { DEPRECIABLE_ASSET_ACCOUNTS, defaultAssetCategory } from '../tax-schema/2026/accounts';
  import {
    applyCarryover,
    computeCarryover,
    removeCarryover,
    type CarryoverPreview,
  } from '../domain/carryover';
  import { applyBadDebtReversal } from '../domain/bad-debt-reversal';
  import {
    SMALL_ASSET_EXPIRY,
    isLumpSumEligible,
    isSmallAssetEligible,
    smallAssetThreshold,
  } from '../tax-schema/2026/limits';
  import { D, formatJPY } from '../lib/decimal';
  import { filedYearGuard } from '../lib/filed-year-guard.svelte';
  import { countSuppressedConfirms, resetSuppressedConfirms } from '../lib/suppressed-confirms';
  import BackupPanel from '../components/BackupPanel.svelte';
  import PolicyDocViewer from '../components/PolicyDocViewer.svelte';
  import { DEFAULT_INVOICE_PREFIX, DEFAULT_QUOTE_PREFIX } from '../domain/invoice';
  import * as AlertDialog from '$lib/components/ui/alert-dialog';
  import type {
    Account,
    AssetCategory,
    DepreciationMethod,
    DisposalType,
    FixedAsset,
    IncomeType,
    ParserRule,
    ParserRuleMatchType,
    RealEstatePropertyDetail,
    SubAccount,
    TaxFilingMethod,
    TaxRegistration,
    Vendor,
    VendorEntityType,
  } from '../db/types';
  import {
    simplifiedTaxCategoryLabel,
    type SimplifiedTaxCategory,
  } from '../tax-schema/2026/simplified-tax';
  import type { AoiroDeductionKind } from '../tax-schema/2026/aoiro-deduction';
  import type { FilingType } from '../tax-schema/2026/xtx';
  import FilePicker from '../components/FilePicker.svelte';
  import ScrollX from '../components/ScrollX.svelte';
  import {
    displayZeimusho,
    isValidZeimushoCode,
    isZeimushoUnresolved,
    nextConfirmedZeimusho,
    searchZeimusho,
    type ZeimushoEntry,
  } from '../tax-schema/2026/zeimusho';

  const INVOICE_NUMBER_PATTERN = '^T\\d{13}$';

  let currentLocale = $state<Locale>(getLocale());

  function onLocaleChange(e: Event) {
    const v = (e.currentTarget as HTMLSelectElement).value as Locale;
    currentLocale = v;
    // setLocale 既定で reload を伴う — 即座に UI 全体へ反映される
    setLocale(v);
  }

  function localeLabel(loc: Locale): string {
    if (loc === 'ja') {
      return m.language_ja();
    } else if (loc === 'zh-TW') {
      return m.language_zh_tw();
    } else {
      return m.language_en();
    }
  }

  let currentYear = $state(2026);
  // 入力欄の値。空欄・範囲外のときも currentYear は直前の有効な年のまま残し、保存とその年で動く操作を止める
  let currentYearDraft = $state<number | undefined>(2026);
  const currentYearInvalid = $derived(
    parseIntegerInput(currentYearDraft === undefined ? '' : String(currentYearDraft), {
      min: 2020,
      max: 2099,
    }) === undefined,
  );
  let userBusinessName = $state('');
  let userInvoiceNumber = $state('');
  let skipAttachmentConfirm = $state(false);
  let skipExternalSendConfirm = $state(false);
  let resetSuppressedConfirmsStatus = $state('');
  let homeOfficeRatios = $state<Record<string, string>>({});
  let hoRatioAccount = $state('');
  let hoRatioValue = $state('');
  let hoRatioError = $state('');
  let basicSaved = $state(false);
  let confirmingClear = $state(false);
  let supportOpen = $state(false);
  // 開発用：手引き・条文と画面の出し分けを dev server でどの配布形態向けに見せるか。
  // __DOC_PLATFORM__ は dev server 起動時の AOIKO_PLATFORM で、未検証の生値なので isPlatform で確かめる。
  // __DOC_PREVIEW__ で分岐ごと畳んでおかないと、ビルド成果物に doc-preview.ts が
  // 混入する（tree-shaking は分岐の外側の参照までは削らない）。
  let devDocPreviewPlatform = $state<Platform>(
    __DOC_PREVIEW__
      ? readPreviewPlatform(isPlatform(__DOC_PLATFORM__) ? __DOC_PLATFORM__ : 'browser')
      : 'browser',
  );
  function onDocPreviewPlatformChange(e: Event) {
    if (!__DOC_PREVIEW__) {
      return;
    }
    const v = (e.currentTarget as HTMLSelectElement).value as Platform;
    writePreviewPlatform(v);
    location.reload();
  }
  const DOC_PREVIEW_LABELS: Record<Platform, string> = {
    browser: 'Web',
    macos: 'macOS',
    ios: 'iOS',
    windows: 'Windows',
  };
  // ストアを持つのはネイティブ版だけ。web には購入画面そのものを含めない。
  // __NATIVE__ はビルド時に畳まれる定数なので、web のビルドではこの分岐ごと消え、
  // 下の import も出力に入らない。実行時の判定だけだと、ブラウザの console で
  // window.__aoikoNative を生やせば画面を出せてしまう。
  // 橋渡しがあることと購入の実装があることは別なので、関数の有無まで見る。
  const canSupport = __NATIVE__ && typeof nativeBridge()?.purchaseIap === 'function';
  // OS 内蔵の AI が使えるかは端末ごとに違い、理由（オフ・DL 中・機種非対応等）も
  // onMount で実際に問うまで分からない。null は「まだ問えていない／理由を認識できない」で、
  // 選択肢そのものを畳んで隠す側に倒す。__NATIVE__ で畳むのは、web のビルド成果物に
  // この経路の文言・問い合わせを残さないため。
  let appleAiAvailability = $state<number | null>(null);
  // 1（機種非対応）と 4（OS が古い）は利用者側でどうにもならないので選択肢ごと隠す。
  // 2/3/5 は選び直せる余地があるので選択肢を disabled で残し、理由を出し分ける。
  const APPLE_AI_UNAVAILABLE_MESSAGES: Record<number, () => string> = {
    2: m.settings_apple_ai_unavailable_2,
    3: m.settings_apple_ai_unavailable_3,
    5: m.settings_apple_ai_unavailable_5,
  };
  const appleAiOptionShown = $derived(
    __NATIVE__ &&
      (appleAiAvailability === 0 ||
        appleAiAvailability === 2 ||
        appleAiAvailability === 3 ||
        appleAiAvailability === 5),
  );
  // ブラウザ内蔵の AI。null は「まだ問えていない」。モデルの取得は aoiko の役目ではないので、
  // ブラウザが既に持っている（available）ときだけ選択肢を出す。__NATIVE__ で畳むのは、
  // ネイティブ版のビルド成果物にこの経路の問い合わせを残さないため。
  let chromeAiAvailability = $state<string | null>(null);
  const chromeAiOptionShown = $derived(!__NATIVE__ && chromeAiAvailability === 'available');
  const SupportDialog = __NATIVE__
    ? import('../components/SupportDialog.svelte').then((mod) => mod.default)
    : null;
  let confirmingRestore = $state(false);
  let restorePayload = $state<Awaited<ReturnType<typeof parseBackupFile>>['payload'] | null>(null);
  let restoreAttachmentCount = $state(0);
  let restoreAttachmentBlobs: Map<string, Blob> = new Map();
  let restoreFileName = $state('');
  let restoreError = $state('');
  let restoreSuccess = $state('');
  let restoreWarning = $state('');
  let restoreOversized = $state('');
  let restoringFromFolder = $state(false);
  let restoreProgressDone = $state(0);
  let restoreProgressTotal = $state(0);
  // 復元後の自動再読み込みで結果表示までスクロールし直すために掴む（issue#387）。
  let restoreSection = $state<HTMLElement | null>(null);
  let restoreApplyButton = $state<HTMLButtonElement | null>(null);
  let backupSection = $state<HTMLElement | null>(null);

  let accountantExportError = $state('');

  let newSubParent = $state('');
  let newSubName = $state('');
  let subError = $state('');

  let newVendorName = $state('');
  let newVendorEntityType = $state<VendorEntityType>('unknown');
  let newVendorInvoice = $state('');
  let newVendorAccountCode = $state('');
  let newVendorAddress = $state('');
  let vendorError = $state('');

  let invoiceNumberPrefix = $state(DEFAULT_INVOICE_PREFIX);
  let quoteNumberPrefix = $state(DEFAULT_QUOTE_PREFIX);

  let newInventoryItemName = $state('');
  let inventoryItemError = $state('');

  let newRuleMatchType = $state<ParserRuleMatchType>('description-includes');
  let newRulePattern = $state('');
  let newRuleAccountCode = $state('');
  let newRulePriority = $state<number | undefined>(10);
  let ruleError = $state('');

  let newAssetName = $state('');
  let newAssetDate = $state(todayISO());
  let newAssetCost = $state('');
  let newAssetLife = $state<number | undefined>(4);
  let newAssetAccount = $state('1510');
  let newAssetMethod = $state<DepreciationMethod>('straight-line');
  let newAssetIncomeType = $state<IncomeType>('business');
  // 所令6条の号。'mine-shaft' は2号（構築物）のうち坑道、'' は未指定。
  type AssetCategoryChoice = '' | `${AssetCategory}` | 'mine-shaft';
  const ASSET_CATEGORY_CHOICES: Array<{ value: AssetCategoryChoice; label: () => string }> = [
    { value: '1', label: m.settings_asset_category_option_1 },
    { value: '2', label: m.settings_asset_category_option_2 },
    { value: 'mine-shaft', label: m.settings_asset_category_option_mine_shaft },
    { value: '3', label: m.settings_asset_category_option_3 },
    { value: '4', label: m.settings_asset_category_option_4 },
    { value: '5', label: m.settings_asset_category_option_5 },
    { value: '6', label: m.settings_asset_category_option_6 },
    { value: '7', label: m.settings_asset_category_option_7 },
    { value: '8', label: m.settings_asset_category_option_8 },
    { value: '9', label: m.settings_asset_category_option_9 },
  ];
  function categoryChoiceForAccount(accountCode: string): AssetCategoryChoice {
    const category = defaultAssetCategory(accountCode);
    return category === undefined ? '' : (String(category) as AssetCategoryChoice);
  }
  let newAssetCategory = $state<AssetCategoryChoice>(categoryChoiceForAccount('1510'));
  let newAssetEmployeeCount = $state('');
  let newAssetLeasedOut = $state(false);
  let newAssetLeaseContractDate = $state('');
  let newAssetResidualGuarantee = $state('');
  // 所令138条1項2号：使用可能期間が1年未満（金額にかかわらず即時費用化）。
  let newAssetUsableLifeUnderOneYear = $state(false);
  // 所令81条2号・3号の例外（業務の性質上基本的に重要）。
  let newAssetEssentialToBusiness = $state(false);
  // リース期間定額法（所令120条の2第1項6号）のリース期間月数。
  let newAssetLeaseTermMonths = $state('');
  // 少額特例落選時の切替先。true は定率法、未設定（false）は定額法（所令125条2号イ）。
  let newAssetDecliningBalanceElected = $state(false);
  let transferOccasionalIncome = $state('');
  let assetError = $state('');
  let propertyEditId = $state<string | null>(null);
  let propertyType = $state('');
  let propertyIsResidential = $state(true);
  let propertyAddress = $state('');
  let propertyTenantName = $state('');
  let propertyTenantAddress = $state('');
  let propertyRentalStart = $state('');
  let propertyRentalEnd = $state('');
  let propertyAreaSqm = $state('');
  let propertyAnnualRent = $state('');
  let propertyKeyMoneyEtc = $state('');
  let propertyOtherIncome = $state('');
  let propertyDepositBalance = $state('');
  let propertyError = $state('');
  const DEPRECIATION_YEAR_RANGE = { min: 2020, max: 2099 };
  let depreciationYear = $state(new Date().getFullYear());
  // 入力欄が空・範囲外の間は depreciationYear を直前の値のまま残し、実行だけを止める
  let depreciationYearInvalid = $state(false);
  let depreciationStatus = $state('');
  // 計算に効く問題のある資産のうち、耐用年数とリース期間だけを直す欄
  let lifeEditId = $state<string | null>(null);
  let lifeEditYears = $state<number | undefined>(undefined);
  let lifeEditLeaseMonths = $state('');
  let lifeEditError = $state('');
  let disposeEditId = $state<string | null>(null);
  let disposeDate = $state(todayISO());
  let disposeType = $state<DisposalType>('scrap');
  let disposeSalePrice = $state('');
  let disposeSaleExpenses = $state('');
  let disposeCashAccount = $state('1110');
  let disposeError = $state('');
  let disposeStatus = $state<Record<string, string>>({});

  let geminiKey = $state('');
  let geminiKeySaved = $state('');
  let geminiTestStatus = $state('');
  let geminiTestFailed = $state(false);
  let geminiModel = $state('');
  let geminiModels = $state<string[]>([]);
  let aiEngine = $state<AiEngine>('gemini');
  // 選択肢の無い値（他環境の復元・選べなくなった旧値等）が保存に残っている場合の生値。
  // aiEngine は bind 先の狭いユニオン型なので、そちらへは書かず別枠に控える。
  let strandedAiEngine = $state<string | null>(null);
  let openaiBaseUrl = $state('');
  let openaiOcrModel = $state('');
  let openaiClassifyModel = $state('');
  let openaiApiKey = $state('');
  let openaiModels = $state<string[]>([]);
  let openaiStatus = $state('');
  let openaiTestFailed = $state(false);
  let openaiSaved = $state('');

  let carryoverPreview = $state<CarryoverPreview | null>(null);
  let carryoverStatus = $state('');
  let carryoverError = $state('');
  let badDebtReversalStatus = $state('');
  let badDebtReversalError = $state('');

  let disclaimerAcceptedAt = $state<number | null>(null);
  let disclaimerAcceptedVersion = $state<number | null>(null);

  let taxRegistration = $state<TaxRegistration>('tax-free');
  let taxFilingMethod = $state<TaxFilingMethod>('general');
  let simplifiedTaxCategory = $state<SimplifiedTaxCategory>(4);
  let consumptionTaxAttributionMethod = $state<'individual' | 'proportional'>('proportional');
  let ctRegistrationStartDate = $state('');
  let ctTaxableElectionFrom = $state('');
  let ctTaxableElectionTo = $state('');
  let ctInheritanceDate = $state('');
  let ctAdjustedFixedAssetDate = $state('');
  let ctShortenedFrom = $state('');
  let ctShortenedTo = $state('');
  let ctForeignWithoutDomesticPe = $state(false);
  let ctBasePeriodSales = $state('');
  let ctSpecifiedPeriodSales = $state('');
  let ctSimplifiedElectionFiledDate = $state('');
  let ctInterimVoluntaryFiled = $state(false);
  let ctInterimVoluntaryLapsed = $state(false);
  let consumptionTaxSaved = $state(false);
  // 申告者情報（e-Tax 提出用）
  let userRiyoshaId = $state('');
  let userFilerName = $state('');
  let userFilerZip = $state('');
  let userFilerAddress = $state('');
  let userZeimushoCode = $state('');
  let userZeimushoName = $state('');
  let filingType = $state<FilingType>('blue');
  // 確認を通るまで filingType は変えないため、選択の見た目は別に持つ。同じ値へ戻すと
  // 再描画が起きず、取り消しても押した側に選択が残る。
  let filingTypeChoice = $state<FilingType>('blue');
  type BusinessDateSourcesState =
    | { status: 'loading' }
    | { status: 'ok'; sources: BusinessDateSources }
    | { status: 'error'; reason: string };
  // 少額特例の年合計上限の月割（措法28の2）に使う開業日・廃業日の出どころ。開業設定や復元で変わっても追従する
  let businessDateSources = $state.raw<BusinessDateSourcesState>({ status: 'loading' });
  let bizStartInput = $state('');
  let bizCloseInput = $state('');
  // 欄ごとに、変えたかと、変え始めたときに画面が出していた保存済みの値（保存の前にほかの画面での変更と突き合わせる）
  let startEdited = $state(false);
  let closeEdited = $state(false);
  let startBase: unknown = undefined;
  let closeBase: unknown = undefined;
  let bizDatesError = $state('');
  let bizDatesConflict = $state('');
  let bizDatesSaved = $state(false);
  function storedDateText(v: StoredBusinessDate | undefined): string {
    return v?.valid ? String(v.value) : '';
  }
  $effect(() => {
    const sub = liveQuery(() => readBusinessDateSources()).subscribe({
      next: (sources) => {
        businessDateSources = { status: 'ok', sources };
        // 入力途中の欄は書き換えない。変えていない欄は保存済みの値に追従させる
        if (!startEdited) {
          bizStartInput = storedDateText(sources.settingStart);
        }
        if (!closeEdited) {
          bizCloseInput = storedDateText(sources.settingClose);
        }
      },
      error: (e: unknown) => {
        businessDateSources = { status: 'error', reason: describeStorageError(e) };
      },
    });
    return () => sub.unsubscribe();
  });
  const businessDateSelection = $derived<BusinessDateSelection | null>(
    businessDateSources.status === 'ok'
      ? selectEffectiveBusinessDates(businessDateSources.sources)
      : null,
  );
  // 欄を変え始めた最初の入力のときに、画面が出している値をそのまま基準にする（読み直すと間の変更を見落とす）
  function markBusinessDateEdited(field: BusinessDateField): void {
    bizDatesSaved = false;
    if (businessDateSources.status !== 'ok') {
      return;
    }
    const { settingStart, settingClose } = businessDateSources.sources;
    if (field === 'start' && !startEdited) {
      startBase = settingStart?.value;
      startEdited = true;
    }
    if (field === 'close' && !closeEdited) {
      closeBase = settingClose?.value;
      closeEdited = true;
    }
  }
  // 書くのは変えた欄と、保存済みの値が読めない欄（空欄で表示しており、そのまま保存すると消える）
  function writesBusinessDate(field: BusinessDateField, sources: BusinessDateSources): boolean {
    return field === 'start'
      ? startEdited || sources.settingStart?.valid === false
      : closeEdited || sources.settingClose?.valid === false;
  }
  function inputBusinessDate(value: string): StoredBusinessDate | undefined {
    return value !== '' ? { value, valid: isValidIsoDate(value) } : undefined;
  }
  // 書く欄だけを欄の値に置き換えた出どころ
  function draftBusinessDateSources(sources: BusinessDateSources): BusinessDateSources {
    const { settingStart, settingClose, ...rest } = sources;
    const start = writesBusinessDate('start', sources)
      ? inputBusinessDate(bizStartInput)
      : settingStart;
    const close = writesBusinessDate('close', sources)
      ? inputBusinessDate(bizCloseInput)
      : settingClose;
    return {
      ...rest,
      ...(start !== undefined ? { settingStart: start } : {}),
      ...(close !== undefined ? { settingClose: close } : {}),
    };
  }
  // 作り直しの途中で止まった年。ここでは示すだけで、元に戻す操作は開業設定の画面で行う
  let interruptedOpeningYears = $state.raw<number[]>([]);
  $effect(() => {
    const sub = liveQuery(() => readVisibleInterruptedOpeningYears()).subscribe({
      next: (years) => {
        interruptedOpeningYears = years;
      },
    });
    return () => sub.unsubscribe();
  });
  const bizStartNote = $derived.by(() => {
    if (businessDateSources.status !== 'ok' || !isValidIsoDate(bizStartInput)) {
      return '';
    }
    const year = Number(bizStartInput.slice(0, 4));
    return businessDateSources.sources.openingStartByYear.has(year)
      ? m.settings_business_dates_start_unused()
      : m.settings_business_dates_start_used({ year });
  });
  const bizCloseReopen = $derived.by(() => {
    if (businessDateSources.status !== 'ok') {
      return false;
    }
    const draft = selectEffectiveBusinessDates(
      draftBusinessDateSources(businessDateSources.sources),
    );
    const close = draft.businessCloseDate;
    if (close === undefined) {
      return false;
    }
    const start = draft.businessStartDates.filter((d) => d.slice(0, 4) === close.slice(0, 4))[0];
    return start !== undefined && close < start;
  });
  let pendingFilingType = $state<FilingType | null>(null);
  let confirmingFilingType = $state(false);
  type PendingConfirm = { title: string; desc: string; action: string; run: () => Promise<void> };
  let pendingConfirm = $state<PendingConfirm | null>(null);
  let confirmingDelete = $state(false);
  function askDelete(name: string, run: () => Promise<void>) {
    pendingConfirm = {
      title: m.settings_delete_confirm_title(),
      desc: m.settings_delete_confirm_desc({ name }),
      action: m.settings_action_delete(),
      run,
    };
    confirmingDelete = true;
  }
  function askClearDisposal(name: string, run: () => Promise<void>) {
    pendingConfirm = {
      title: m.settings_disposal_clear_confirm_title(),
      desc: m.settings_disposal_clear_confirm_desc({ name }),
      action: m.settings_asset_disposal_clear(),
      run,
    };
    confirmingDelete = true;
  }
  function askReverseCarryover(name: string, run: () => Promise<void>) {
    pendingConfirm = {
      title: m.settings_carryover_delete_confirm_title(),
      desc: m.settings_carryover_delete_confirm_desc({ name }),
      action: m.settings_carryover_delete_button(),
      run,
    };
    confirmingDelete = true;
  }
  async function runPendingConfirm() {
    confirmingDelete = false;
    await pendingConfirm?.run();
  }
  let aoiroDeductionKind = $state<AoiroDeductionKind>('electronic');
  let cashBasisElection = $state(false);
  let filerSaved = $state(false);
  // 復元された申告者情報は型を検査していない。文字列にできない値と、桁が化けうる数値の識別番号は
  // 読めない値として示し、入力し直すまで保存しない
  const filerStoredUnreadable = new SvelteSet<string>();
  function loadFilerText(key: string, stored: unknown, kind: FilerFieldKind): string {
    const text = readFilerField(stored, kind);
    if (text === undefined) {
      filerStoredUnreadable.add(key);
    }
    return text ?? storedToInputText(stored);
  }
  const riyoshaIdInvalid = $derived(
    filerStoredUnreadable.has('userRiyoshaId') || isRiyoshaIdInvalid(userRiyoshaId),
  );
  const filerZipInvalid = $derived(
    filerStoredUnreadable.has('userFilerZip') || isFilerZipInvalid(userFilerZip),
  );
  const zeimushoCodeInvalid = $derived(
    filerStoredUnreadable.has('userZeimushoCode') ||
      (userZeimushoCode.trim() !== '' && !isValidZeimushoCode(userZeimushoCode)),
  );
  // 税務署サジェスト（署名・コードで検索 → コード+署名を確定）
  let zeimushoQuery = $state('');
  let zeimushoOpen = $state(false);
  // 入力欄に文字が残っているのに確定した署が無い状態。ここで保存を通すと、設定済みの
  // 利用者が一文字消しただけで提出先税務署が空文字で上書きされ、次の .xtx から消える。
  const zeimushoUnresolved = $derived(
    isZeimushoUnresolved(zeimushoQuery, { code: userZeimushoCode, name: userZeimushoName }),
  );
  const zeimushoResults = $derived(zeimushoOpen ? searchZeimusho(zeimushoQuery) : []);
  function selectZeimusho(e: ZeimushoEntry): void {
    filerStoredUnreadable.delete('userZeimushoCode');
    filerStoredUnreadable.delete('userZeimushoName');
    userZeimushoCode = e.code;
    userZeimushoName = e.name;
    zeimushoQuery = displayZeimusho(e.code, e.name);
    zeimushoOpen = false;
  }
  function onZeimushoInput(value: string): void {
    filerStoredUnreadable.delete('userZeimushoCode');
    filerStoredUnreadable.delete('userZeimushoName');
    zeimushoQuery = value;
    zeimushoOpen = true;
    const next = nextConfirmedZeimusho(value, {
      code: userZeimushoCode,
      name: userZeimushoName,
    });
    userZeimushoCode = next.code;
    userZeimushoName = next.name;
  }

  const accountGroups = $derived(ledger.groupedAccounts());

  const subGroups = $derived.by(() => {
    const accountMap = new Map(ledger.accounts.map((a) => [a.code, a]));
    const groups = new Map<string, { account: Account; items: SubAccount[] }>();
    for (const sa of ledger.subAccounts) {
      const acc = accountMap.get(sa.accountCode);
      if (!acc) {
        continue;
      }
      const g = groups.get(sa.accountCode);
      if (g) {
        g.items.push(sa);
      } else {
        groups.set(sa.accountCode, { account: acc, items: [sa] });
      }
    }
    return Array.from(groups.values()).sort(
      (a, b) => a.account.displayOrder - b.account.displayOrder,
    );
  });

  const allAccountGroups = $derived.by(() => {
    type G = { category: string; label: string; items: Account[] };
    const groups: G[] = [];
    const order: Account['category'][] = ['asset', 'liability', 'equity', 'revenue', 'expense'];
    for (const key of order) {
      const items = ledger.allAccounts.filter((a) => a.category === key);
      if (items.length > 0) {
        groups.push({ category: key, label: categoryLabel(key), items });
      }
    }
    return groups;
  });

  onMount(async () => {
    // 復元直後の再読み込みで持ち越された結果（issue#387）。await より先に読んで消す。
    const notice = takeRestoreNotice();
    const target = takeSettingsTarget();
    if (notice) {
      restoreSuccess = m.settings_restore_success({ tables: notice.tables, rows: notice.rows });
      restoreWarning =
        notice.missingBlobCount > 0
          ? m.settings_restore_missing_blobs({ count: notice.missingBlobCount })
          : '';
      // 復元の検証は 1e14 以上の明細を形式だけで通すため、戻した直後に一覧で示す。失敗しても他の設定は読む
      try {
        const found = await findOversizedAmounts();
        restoreOversized = found.total > 0 ? describeFoundAmounts(found) : '';
      } catch {
        restoreOversized = '';
      }
    }
    currentYear = (await getSetting('currentYear')) ?? 2026;
    currentYearDraft = currentYear;
    userBusinessName = storedToInputText(await getSetting('userBusinessName'));
    userInvoiceNumber = storedToInputText(await getSetting('userInvoiceNumber'));
    invoiceNumberPrefix = (await getSetting('invoiceNumberPrefix')) ?? DEFAULT_INVOICE_PREFIX;
    quoteNumberPrefix = (await getSetting('quoteNumberPrefix')) ?? DEFAULT_QUOTE_PREFIX;
    geminiKey = (await getSetting('geminiApiKey')) ?? '';
    geminiModel = (await getSetting('geminiModel')) ?? '';
    // 理由コードは環境が返すまで分からない。関数が無い側は 1/4 と同じ「隠す」扱いにする。
    const askAppleAi = __NATIVE__ ? nativeBridge()?.appleAiAvailability : undefined;
    appleAiAvailability =
      typeof askAppleAi === 'function' ? await askAppleAi().catch(() => null) : null;
    if (!__NATIVE__) {
      const { chromeAiAvailability: ask } = await import('../lib/chrome-ai/availability');
      chromeAiAvailability = await ask();
    }
    const storedAiEngine = await getSetting('aiEngine');
    if (
      storedAiEngine === 'gemini' ||
      storedAiEngine === 'openai-compatible' ||
      (storedAiEngine === 'apple-ai' && appleAiOptionShown) ||
      (storedAiEngine === 'chrome-ai' && chromeAiOptionShown)
    ) {
      aiEngine = storedAiEngine;
      strandedAiEngine = null;
    } else if (storedAiEngine === undefined) {
      aiEngine = 'gemini';
      strandedAiEngine = null;
    } else {
      // 選択肢の無い値（他環境の復元・選べなくなった旧値等）。空欄に見せず、
      // 生値のまま disabled で見せて理由を出す。bind 先は狭いユニオン型なので
      // 表示のためだけにキャストする。保存し直せば必ず上書きされる。
      strandedAiEngine = storedAiEngine;
      aiEngine = storedAiEngine as AiEngine;
    }
    openaiBaseUrl = (await getSetting('openaiBaseUrl')) ?? '';
    openaiOcrModel = (await getSetting('openaiOcrModel')) ?? '';
    openaiClassifyModel = (await getSetting('openaiClassifyModel')) ?? '';
    openaiApiKey = (await getSetting('openaiApiKey')) ?? '';
    disclaimerAcceptedAt = (await getSetting('disclaimerAcceptedAt')) ?? null;
    disclaimerAcceptedVersion = (await getSetting('disclaimerAcceptedVersion')) ?? null;
    taxRegistration = (await getSetting('taxRegistration')) ?? 'tax-free';
    taxFilingMethod = (await getSetting('taxFilingMethod')) ?? 'general';
    simplifiedTaxCategory = (await getSetting('simplifiedTaxCategory')) ?? 4;
    consumptionTaxAttributionMethod =
      (await getSetting('consumptionTaxAttributionMethod')) ?? 'proportional';
    ctRegistrationStartDate = (await getSetting('invoiceRegistrationStartDate')) ?? '';
    const taxableElection = await getSetting('taxableElectionPeriod');
    ctTaxableElectionFrom = String(taxableElection?.fromYear ?? '');
    ctTaxableElectionTo = String(taxableElection?.toYear ?? '');
    ctInheritanceDate = (await getSetting('inheritanceSpecialDate')) ?? '';
    ctAdjustedFixedAssetDate = (await getSetting('adjustedFixedAssetDate')) ?? '';
    const shortened = await getSetting('shortenedTaxPeriod');
    ctShortenedFrom = shortened?.from ?? '';
    ctShortenedTo = shortened?.to ?? '';
    ctForeignWithoutDomesticPe = (await getSetting('foreignWithoutDomesticPe')) ?? false;
    ctBasePeriodSales = loadCtAmount(
      'ctBasePeriodSales',
      await getSetting('basePeriodTaxableSales'),
    );
    ctSpecifiedPeriodSales = loadCtAmount(
      'ctSpecifiedPeriodSales',
      await getSetting('specifiedPeriodTaxableSales'),
    );
    ctSimplifiedElectionFiledDate = (await getSetting('simplifiedElectionFiledDate')) ?? '';
    ctInterimVoluntaryFiled = (await getSetting('interimVoluntaryFiled')) ?? false;
    ctInterimVoluntaryLapsed = (await getSetting('interimVoluntaryLapsed')) ?? false;
    userRiyoshaId = loadFilerText('userRiyoshaId', await getSetting('userRiyoshaId'), 'code');
    userFilerName = loadFilerText('userFilerName', await getSetting('userFilerName'), 'text');
    userFilerZip = loadFilerText('userFilerZip', await getSetting('userFilerZip'), 'zip');
    userFilerAddress = loadFilerText(
      'userFilerAddress',
      await getSetting('userFilerAddress'),
      'text',
    );
    userZeimushoCode = loadFilerText(
      'userZeimushoCode',
      await getSetting('userZeimushoCode'),
      'code',
    );
    userZeimushoName = loadFilerText(
      'userZeimushoName',
      await getSetting('userZeimushoName'),
      'text',
    );
    zeimushoQuery = displayZeimusho(userZeimushoCode, userZeimushoName);
    filingType = (await getSetting('filingType')) ?? 'blue';
    filingTypeChoice = filingType;
    aoiroDeductionKind = (await getSetting('aoiroDeductionKind')) ?? 'electronic';
    cashBasisElection = (await getSetting('cashBasisElection')) ?? false;
    skipAttachmentConfirm = (await getSetting('skipAttachmentConfirm')) ?? false;
    skipExternalSendConfirm = (await getSetting('skipExternalSendConfirm')) ?? false;
    homeOfficeRatios = (await getSetting('homeOfficeAccountRatios')) ?? {};
    // 復元の結果もバックアップ欄も設定画面のかなり下にあり、着いた先は先頭。
    // 復元は全置換という取り消せない操作の唯一の確認なので、そちらを優先する。
    // 上の読み込みで高さが変わるため、すべて終わってから測る。
    if (notice) {
      await tick();
      restoreSection?.scrollIntoView({ block: 'center' });
    } else if (target === 'backup') {
      await tick();
      // center だと画面より高い欄は見出しが上へ外れる。start と scroll-mt で、
      // 貼り付いたヘッダの下に見出しが来る位置へ寄せる。
      backupSection?.scrollIntoView({ block: 'start' });
    }
  });

  const expenseAccounts = $derived(ledger.accounts.filter((a) => a.category === 'expense'));
  function accountLabel(code: string): string {
    const a = ledger.accounts.find((x) => x.code === code);
    return a ? `${a.code} ${a.name}` : code;
  }
  async function addHomeOfficeRatio() {
    hoRatioError = '';
    if (!hoRatioAccount || !isValidDefaultRatio(hoRatioValue)) {
      hoRatioError = m.settings_home_office_ratio_invalid();
      return;
    }
    homeOfficeRatios = { ...homeOfficeRatios, [hoRatioAccount]: hoRatioValue };
    await setSetting('homeOfficeAccountRatios', $state.snapshot(homeOfficeRatios));
    hoRatioAccount = '';
    hoRatioValue = '';
  }
  async function removeHomeOfficeRatio(code: string) {
    const next = { ...homeOfficeRatios };
    delete next[code];
    homeOfficeRatios = next;
    await setSetting('homeOfficeAccountRatios', $state.snapshot(homeOfficeRatios));
  }

  type CtTextKey =
    | 'invoiceRegistrationStartDate'
    | 'inheritanceSpecialDate'
    | 'adjustedFixedAssetDate'
    | 'simplifiedElectionFiledDate';
  type CtAmountKey = 'basePeriodTaxableSales' | 'specifiedPeriodTaxableSales';
  // 復元された設定は型を検証しないため数値などが入りうる。読む側（settings.ts）は文字列しか読まないので、
  // 数値は文字列にして見せつつ誤りとして示し、それ以外は空欄にして示す
  function loadCtAmount(name: string, stored: unknown): string {
    if (stored === undefined || (typeof stored === 'string' && !isAmountInputInvalid(stored))) {
      return stored ?? '';
    }
    ctErrors.set(name, m.common_stored_amount_unreadable);
    return storedToInputText(stored);
  }
  type CtFlagKey = 'foreignWithoutDomesticPe' | 'interimVoluntaryFiled' | 'interimVoluntaryLapsed';
  // 空欄・未チェックは未設定として消し、判定を従来どおりにする
  async function saveCtText(key: CtTextKey, name: string, value: string) {
    if (ctErrors.has(name)) {
      return;
    }
    if (value.trim() === '') {
      await deleteSetting(key);
    } else {
      await setSetting(key, value.trim());
    }
  }
  async function saveCtAmount(key: CtAmountKey, value: string) {
    const normalized = normalizeAmountInput(value);
    if (normalized === '') {
      await deleteSetting(key);
    } else if (parseAmountInput(normalized) !== undefined) {
      await setSetting(key, normalized);
    }
  }
  async function saveCtFlag(key: CtFlagKey, value: boolean) {
    if (value) {
      await setSetting(key, true);
    } else {
      await deleteSetting(key);
    }
  }
  function parseYear(value: string): number | undefined {
    const normalized = value.normalize('NFKC').trim();
    return /^\d{4}$/.test(normalized) ? Number(normalized) : undefined;
  }
  // 期間は開始と終了を 1 つの値で持つ。片方が読めないまま保存すると、もう片方の保存済みの値まで消える
  async function saveCtPeriods() {
    const fromYear = parseYear(ctTaxableElectionFrom);
    const toYear = parseYear(ctTaxableElectionTo);
    if (!ctErrors.has('ctTaxableElectionFrom') && !ctErrors.has('ctTaxableElectionTo')) {
      if (fromYear === undefined) {
        await deleteSetting('taxableElectionPeriod');
      } else {
        await setSetting('taxableElectionPeriod', {
          fromYear,
          ...(toYear !== undefined ? { toYear } : {}),
        });
      }
    }
    if (!ctErrors.has('ctShortenedFrom') && !ctErrors.has('ctShortenedTo')) {
      if (ctShortenedFrom === '') {
        await deleteSetting('shortenedTaxPeriod');
      } else {
        await setSetting('shortenedTaxPeriod', {
          from: ctShortenedFrom,
          ...(ctShortenedTo !== '' ? { to: ctShortenedTo } : {}),
        });
      }
    }
  }
  // 読めない値を書き込むと保存済みの値が消えたり別の値になったりするため、その欄は書き込まず、保存したとも表示しない
  const ctErrors = new SvelteMap<string, () => string>();
  let ctSection = $state<HTMLElement | null>(null);
  function collectCtErrors(): Map<string, () => string> {
    const errors = new Map<string, () => string>();
    // 日付欄は途中まで入力すると value が空になり、空欄として消してしまうため badInput で見分ける
    const dateInputs = [
      ...(ctSection?.querySelectorAll<HTMLInputElement>('input[type="date"]') ?? []),
    ];
    for (const el of dateInputs) {
      if (el.validity.badInput) {
        errors.set(el.name, m.settings_ct_date_incomplete);
      }
    }
    // 描画し直した欄は空に見えるため、日付の誤りは利用者が入れ直すか空にするまで引き継ぐ
    for (const [name, message] of ctErrors) {
      if (message === m.settings_ct_date_incomplete) {
        errors.set(name, message);
      }
    }
    if (!errors.has('ctShortenedFrom') && ctShortenedFrom === '' && ctShortenedTo !== '') {
      errors.set('ctShortenedFrom', m.settings_ct_period_start_required);
    }
    for (const [name, value] of [
      ['ctTaxableElectionFrom', ctTaxableElectionFrom],
      ['ctTaxableElectionTo', ctTaxableElectionTo],
    ] as const) {
      if (value.trim() !== '' && parseYear(value) === undefined) {
        errors.set(name, m.settings_ct_year_invalid);
      }
    }
    if (ctTaxableElectionFrom.trim() === '' && ctTaxableElectionTo.trim() !== '') {
      errors.set('ctTaxableElectionFrom', m.settings_ct_period_start_required);
    }
    for (const [name, value] of [
      ['ctBasePeriodSales', ctBasePeriodSales],
      ['ctSpecifiedPeriodSales', ctSpecifiedPeriodSales],
    ] as const) {
      if (isAmountInputInvalid(value)) {
        errors.set(name, m.common_amount_invalid);
      }
    }
    return errors;
  }
  function ctErrorMessages(...names: string[]): string[] {
    return [...new Set(names.flatMap((name) => ctErrors.get(name) ?? []))].map((message) =>
      message(),
    );
  }
  // change（フォーカスを外す）まで保存されない欄。フォーカス時点と値が違う間にページを閉じると入力が黙って消えるため未保存として登録する。
  const ctPending = new SvelteSet<string>();
  const ctFocusValues = new Map<string, string>();
  const ctFocusBadInput = new Map<string, boolean>();
  const ctUnsavedToken = {};
  $effect(() => {
    setUnsavedGuard(ctUnsavedToken, ctPending.size > 0);
    return () => clearUnsavedGuard(ctUnsavedToken);
  });
  function trackCtFocus(name: string, el: HTMLInputElement) {
    ctFocusValues.set(name, el.value);
    ctFocusBadInput.set(name, el.validity.badInput);
  }
  function trackCtInput(name: string, el: HTMLInputElement) {
    // 誤りを示している欄はフォーカス時の文字列もまだ保存されていないため、その文字列に戻っても未保存のまま
    if (!ctErrors.has(name) && ctFocusValues.get(name) === el.value) {
      ctPending.delete(name);
    } else {
      ctPending.add(name);
    }
  }
  function commitConsumptionTax(name: string, el: HTMLInputElement) {
    ctPending.delete(name);
    ctFocusValues.set(name, el.value);
    ctFocusBadInput.set(name, el.validity.badInput);
    if (el.type === 'date' && !el.validity.badInput) {
      ctErrors.delete(name);
    }
    return saveConsumptionTax();
  }
  // 日付を区画ごとに消すと最初の区画でしか change が出ない環境があるため、フォーカスを外す時に確定する
  // 描画し直しただけの欄は記録した状態から変わらないので、触っていなければ確定しない
  function blurCtDate(name: string, el: HTMLInputElement) {
    if (
      ctErrors.get(name) === m.settings_ct_date_incomplete &&
      !el.validity.badInput &&
      (el.value !== ctFocusValues.get(name) || ctFocusBadInput.get(name) !== false)
    ) {
      return commitConsumptionTax(name, el);
    }
  }

  async function saveConsumptionTax() {
    const errors = collectCtErrors();
    for (const name of ctErrors.keys()) {
      if (!errors.has(name)) {
        ctPending.delete(name);
      }
    }
    ctErrors.clear();
    for (const [name, message] of errors) {
      ctErrors.set(name, message);
      ctPending.add(name);
    }
    // 全角で入れた値も半角で保存されるため、欄も保存した値の表記に揃える
    if (!errors.has('ctBasePeriodSales')) {
      ctBasePeriodSales = normalizeAmountInput(ctBasePeriodSales);
    }
    if (!errors.has('ctSpecifiedPeriodSales')) {
      ctSpecifiedPeriodSales = normalizeAmountInput(ctSpecifiedPeriodSales);
    }
    if (!errors.has('ctTaxableElectionFrom') && !errors.has('ctTaxableElectionTo')) {
      ctTaxableElectionFrom = String(parseYear(ctTaxableElectionFrom) ?? '');
      ctTaxableElectionTo = String(parseYear(ctTaxableElectionTo) ?? '');
    }
    await setSetting('taxRegistration', taxRegistration);
    await setSetting('taxFilingMethod', taxFilingMethod);
    await setSetting('simplifiedTaxCategory', simplifiedTaxCategory);
    await setSetting('consumptionTaxAttributionMethod', consumptionTaxAttributionMethod);
    await saveCtText(
      'invoiceRegistrationStartDate',
      'ctRegistrationStartDate',
      ctRegistrationStartDate,
    );
    await saveCtText('inheritanceSpecialDate', 'ctInheritanceDate', ctInheritanceDate);
    await saveCtText(
      'adjustedFixedAssetDate',
      'ctAdjustedFixedAssetDate',
      ctAdjustedFixedAssetDate,
    );
    await saveCtText(
      'simplifiedElectionFiledDate',
      'ctSimplifiedElectionFiledDate',
      ctSimplifiedElectionFiledDate,
    );
    await saveCtAmount('basePeriodTaxableSales', ctBasePeriodSales);
    await saveCtAmount('specifiedPeriodTaxableSales', ctSpecifiedPeriodSales);
    await saveCtFlag('foreignWithoutDomesticPe', ctForeignWithoutDomesticPe);
    await saveCtFlag('interimVoluntaryFiled', ctInterimVoluntaryFiled);
    await saveCtFlag('interimVoluntaryLapsed', ctInterimVoluntaryLapsed);
    await saveCtPeriods();
    if (ctErrors.size > 0) {
      consumptionTaxSaved = false;
      return;
    }
    consumptionTaxSaved = true;
    setTimeout(() => {
      consumptionTaxSaved = false;
    }, 2000);
  }

  function requestFilingTypeChange(next: FilingType) {
    if (next === filingType) {
      return;
    }
    pendingFilingType = next;
    confirmingFilingType = true;
  }

  function applyFilingTypeChange() {
    if (pendingFilingType) {
      filingType = pendingFilingType;
    }
    filingTypeChoice = filingType;
    pendingFilingType = null;
    confirmingFilingType = false;
  }

  function cancelFilingTypeChange() {
    filingTypeChoice = filingType;
    pendingFilingType = null;
    confirmingFilingType = false;
  }

  async function saveFiler(e: Event) {
    e.preventDefault();
    // ボタンの disabled だけに頼らない。欄と確定値がずれたまま保存すると、画面に
    // 出ている署とは違うコードが .xtx へ載る。
    if (
      zeimushoCodeInvalid ||
      zeimushoUnresolved ||
      riyoshaIdInvalid ||
      filerZipInvalid ||
      filerStoredUnreadable.size > 0
    ) {
      return;
    }
    await setSetting('userRiyoshaId', normalizeRiyoshaId(userRiyoshaId));
    await setSetting('userFilerName', userFilerName.trim());
    await setSetting('userFilerZip', normalizeFilerZip(userFilerZip));
    await setSetting('userFilerAddress', userFilerAddress.trim());
    await setSetting('userZeimushoCode', userZeimushoCode.trim());
    await setSetting('userZeimushoName', userZeimushoName.trim());
    await setSetting('filingType', filingType);
    await setSetting('aoiroDeductionKind', aoiroDeductionKind);
    await setSetting('cashBasisElection', cashBasisElection);
    filerSaved = true;
    setTimeout(() => {
      filerSaved = false;
    }, 2000);
  }

  async function revokeDisclaimer() {
    await deleteSetting('disclaimerAcceptedAt');
    await deleteSetting('disclaimerAcceptedVersion');
    location.reload();
  }

  async function saveBasic(e: Event) {
    e.preventDefault();
    if (currentYearInvalid) {
      return;
    }
    await setSetting('currentYear', currentYear);
    // 保存した処理年度を全画面（概況・仕訳一覧・帳票）へ即時反映する
    ledger.switchYear(currentYear);
    await setSetting('userBusinessName', userBusinessName);
    await setSetting('userInvoiceNumber', userInvoiceNumber);
    await setSetting('invoiceNumberPrefix', invoiceNumberPrefix);
    await setSetting('quoteNumberPrefix', quoteNumberPrefix);
    basicSaved = true;
    setTimeout(() => {
      basicSaved = false;
    }, 2000);
  }

  async function resetSuppressedConfirmsClick() {
    const count = await countSuppressedConfirms();
    await resetSuppressedConfirms();
    skipAttachmentConfirm = false;
    skipExternalSendConfirm = false;
    resetSuppressedConfirmsStatus =
      count > 0
        ? m.settings_basic_reset_suppressed_confirms_done({ count })
        : m.settings_basic_reset_suppressed_confirms_none();
  }

  async function clearAll() {
    confirmingClear = false;
    await backup.clearStoredBackups();
    await db.delete();
    location.reload();
  }

  async function previewCarryover() {
    if (currentYearInvalid) {
      return;
    }
    carryoverError = '';
    carryoverStatus = '';
    try {
      carryoverPreview = await computeCarryover(currentYear);
    } catch (err) {
      carryoverError = describeStorageError(err);
    }
  }

  async function runCarryover() {
    if (currentYearInvalid) {
      return;
    }
    carryoverError = '';
    carryoverStatus = '';
    if (!(await filedYearGuard.confirm([currentYear]))) {
      return;
    }
    try {
      const r = await applyCarryover(currentYear, { allowFiledYear: true });
      if ('entryId' in r) {
        carryoverStatus = m.settings_carryover_applied();
        carryoverPreview = null;
      } else if (r.reason === 'already-exists') {
        carryoverError = m.settings_carryover_already_exists();
      } else {
        carryoverError = m.settings_carryover_no_prior();
      }
    } catch (err) {
      carryoverError = describeStorageError(err);
    }
  }

  async function runBadDebtReversal() {
    if (currentYearInvalid) {
      return;
    }
    badDebtReversalError = '';
    badDebtReversalStatus = '';
    if (!(await filedYearGuard.confirm([currentYear]))) {
      return;
    }
    try {
      const r = await applyBadDebtReversal(currentYear, { allowFiledYear: true });
      if ('entryId' in r) {
        badDebtReversalStatus = m.settings_bad_debt_reversal_applied({
          amount: formatJPY(r.total),
        });
      } else if (r.reason === 'already-exists') {
        badDebtReversalError = m.settings_bad_debt_reversal_already_exists();
      } else {
        badDebtReversalError = m.settings_bad_debt_reversal_none();
      }
    } catch (err) {
      badDebtReversalError = describeStorageError(err);
    }
  }

  async function deleteCarryover() {
    if (currentYearInvalid) {
      return;
    }
    carryoverError = '';
    carryoverStatus = '';
    if (
      !(await filedYearGuard.confirm([currentYear], {
        detail: m.filed_year_warning_detail_carryover({ year: currentYear }),
      }))
    ) {
      return;
    }
    try {
      const r = await removeCarryover(currentYear, { allowFiledYear: true });
      carryoverStatus = r.removed
        ? m.settings_carryover_deleted()
        : m.settings_carryover_no_target();
    } catch (err) {
      carryoverError = describeStorageError(err);
    }
  }

  async function addSubAccount(e: Event) {
    e.preventDefault();
    subError = '';
    const parent = newSubParent.trim();
    const name = newSubName.trim();
    if (!parent || !name) {
      subError = m.settings_subaccount_error_required();
      return;
    }
    const exists = ledger.subAccounts.some((s) => s.accountCode === parent && s.name === name);
    if (exists) {
      subError = m.settings_subaccount_error_duplicate();
      return;
    }
    await db.subAccounts.add({ id: newId(), accountCode: parent, name });
    newSubName = '';
  }

  async function deleteSubAccount(id: string) {
    await db.subAccounts.delete(id);
  }

  async function toggleAccountActive(account: Account) {
    const next = account.isActive === false ? true : false;
    await db.accounts
      .where('[code+year]')
      .equals([account.code, account.year])
      .modify({ isActive: next });
  }

  async function addVendor(e: Event) {
    e.preventDefault();
    vendorError = '';
    const name = newVendorName.trim();
    if (!name) {
      vendorError = m.settings_vendor_error_required();
      return;
    }
    if (ledger.vendors.some((v) => v.name === name)) {
      vendorError = m.settings_vendor_error_duplicate();
      return;
    }
    const v: Vendor = {
      id: newId(),
      name,
      entityType: newVendorEntityType,
    };
    if (newVendorInvoice.trim()) {
      v.invoiceNumber = newVendorInvoice.trim();
    }
    if (newVendorAccountCode) {
      v.defaultAccountCode = newVendorAccountCode;
    }
    if (newVendorAddress.trim()) {
      v.address = newVendorAddress.trim();
    }
    await db.vendors.add(v);
    newVendorName = '';
    newVendorInvoice = '';
    newVendorAccountCode = '';
    newVendorAddress = '';
    newVendorEntityType = 'unknown';
  }

  async function deleteVendor(id: string) {
    await db.vendors.delete(id);
  }

  async function addInventoryItem(e: Event) {
    e.preventDefault();
    inventoryItemError = '';
    const name = newInventoryItemName.trim();
    if (!name) {
      inventoryItemError = m.settings_inventory_item_error_required();
      return;
    }
    if (ledger.inventoryItems.some((it) => it.name === name)) {
      inventoryItemError = m.settings_inventory_item_error_duplicate();
      return;
    }
    await db.inventoryItems.add({ id: newId(), name });
    newInventoryItemName = '';
  }

  async function deleteInventoryItem(id: string) {
    await db.inventoryItems.delete(id);
  }

  async function addRule(e: Event) {
    e.preventDefault();
    ruleError = '';
    const pattern = newRulePattern.trim();
    const priority = newRulePriority;
    if (priority === undefined || !Number.isSafeInteger(priority) || priority < 0) {
      ruleError = m.settings_rule_priority_invalid();
      return;
    }
    if (!pattern || !newRuleAccountCode) {
      ruleError = m.settings_rule_error_required();
      return;
    }
    const rule: ParserRule = {
      id: newId(),
      matchType: newRuleMatchType,
      pattern,
      accountCode: newRuleAccountCode,
      priority,
      hitCount: 0,
    };
    await db.parserRules.add(rule);
    newRulePattern = '';
    newRuleAccountCode = '';
    newRulePriority = 10;
  }

  async function deleteRule(id: string) {
    await db.parserRules.delete(id);
  }
  // 少額特例の適用可否（フォーム入力に応じて反応）。
  // 用途：i) 入力中の即時フィードバック、ii) 送信ブロック
  type SmallAssetCheck =
    | { state: 'eligible'; threshold: number }
    | { state: 'cost'; threshold: number }
    | { state: 'expired' };

  const newAssetEmployeeCountValue = $derived(
    newAssetEmployeeCount.trim() === '' ? undefined : Number(newAssetEmployeeCount),
  );
  const newAssetSmallCheck = $derived.by<SmallAssetCheck>(() => {
    const threshold = smallAssetThreshold(newAssetDate);
    if (newAssetDate > SMALL_ASSET_EXPIRY) {
      return { state: 'expired' };
    }
    if (isSmallAssetEligible(newAssetDate, newAssetCost.trim())) {
      return { state: 'eligible', threshold };
    }
    return { state: 'cost', threshold };
  });
  // 表示用の newAssetSmallCheck は金額と期限だけを見る。登録可否は従業員数・貸付けの要件も含めて判定する。
  const newAssetSmallEligible = $derived(
    isSmallAssetEligible(newAssetDate, newAssetCost.trim(), {
      employeeCount: newAssetEmployeeCountValue,
      isLeasedOut: newAssetLeasedOut,
    }),
  );
  const newAssetLumpSumEligible = $derived(
    isLumpSumEligible(newAssetCost.trim(), {
      isLeasedOut: newAssetLeasedOut,
      acquisitionDate: newAssetDate,
    }),
  );
  function assetAmountError(raw: string, required: boolean): string {
    if (normalizeAmountInput(raw) === '') {
      return required ? m.settings_asset_error_required() : '';
    }
    if (parseAmountInput(raw) === undefined) {
      return m.common_amount_invalid();
    }
    return isJournalAmountTooLarge(raw) ? m.common_amount_too_large() : '';
  }
  const newAssetCostError = $derived(assetAmountError(newAssetCost, false));
  const newAssetResidualError = $derived(assetAmountError(newAssetResidualGuarantee, false));
  const newAssetLeaseTermValue = $derived(
    parseIntegerInput(newAssetLeaseTermMonths, { min: 1, max: Number.MAX_SAFE_INTEGER }),
  );
  // 登録する資産は減価償却・.xtx の検査（validateFixedAsset）を必ず通る形にする
  const newAssetLifeIssues = $derived(
    validateFixedAsset({
      id: '',
      name: '',
      acquisitionDate: newAssetDate,
      acquisitionCost: '0',
      usefulLifeYears: newAssetLife ?? Number.NaN,
      depreciationMethod: newAssetMethod,
      accountCode: newAssetAccount,
      ...assetCategoryFields(newAssetCategory),
      ...(newAssetUsableLifeUnderOneYear ? { usableLifeUnderOneYear: true } : {}),
      ...(newAssetMethod === 'small-asset-special' && newAssetDecliningBalanceElected
        ? { decliningBalanceElected: true }
        : {}),
      ...(newAssetMethod === 'lease-period-straight-line' && newAssetLeaseTermValue !== undefined
        ? { leaseTermMonths: newAssetLeaseTermValue }
        : {}),
    }),
  );
  const newAssetLifeError = $derived(
    newAssetLifeIssues.some((i) => i.kind === 'useful-life')
      ? m.fixed_asset_issue_useful_life()
      : '',
  );
  const newAssetLeaseTermError = $derived(
    newAssetLifeIssues.some((i) => i.kind === 'lease-term') ? m.fixed_asset_issue_lease_term() : '',
  );
  const newAssetFieldErrors = $derived(
    [
      { label: m.settings_asset_cost_placeholder(), message: newAssetCostError },
      { label: m.settings_asset_life_title(), message: newAssetLifeError },
      { label: m.fixed_asset_field_residual_guarantee(), message: newAssetResidualError },
      { label: m.settings_asset_lease_term_months(), message: newAssetLeaseTermError },
    ].filter((e) => e.message !== ''),
  );
  // 復元された資産は主キーしか検査していない。少額特例の枠と一括償却の群は全資産で決まるため、
  // 計算に効く問題が 1 件でもあれば、どの資産の償却額も出さずに理由を示す（仕訳の生成と同じ関門）。
  // 問題のある資産を除いて計算すると、画面の金額が生成される仕訳と食い違う
  const assetIssuesById = $derived(
    new Map<string, FixedAssetIssue[]>(
      ledger.fixedAssets.map((a) => [a.id, validateFixedAsset(a)]),
    ),
  );
  // dates：開業日・廃業日の読み込み・値の問題で止まっている（減価償却も同じ理由で止まるので押させない）
  type DepreciationInputsState =
    | { status: 'loading' }
    | { status: 'ok'; inputs: ReturnType<typeof buildDepreciationInputs> }
    | { status: 'blocked'; reason: string; dates: boolean };
  const depreciationInputs = $derived.by<DepreciationInputsState>(() => {
    const blocked = ledger.fixedAssets.flatMap((asset) => {
      const issues = (assetIssuesById.get(asset.id) ?? []).filter(
        (i) => fixedAssetIssueScope(i) === 'compute',
      );
      return issues.length > 0 ? [{ asset, issues }] : [];
    });
    if (blocked.length > 0) {
      return { status: 'blocked', reason: describeInvalidFixedAssets(blocked), dates: false };
    }
    if (businessDateSources.status === 'loading' || businessDateSelection === null) {
      return businessDateSources.status === 'error'
        ? { status: 'blocked', reason: businessDateSources.reason, dates: true }
        : { status: 'loading' };
    }
    const issue = businessDateSelection.issues[0];
    if (issue) {
      return {
        status: 'blocked',
        reason: new InvalidBusinessDateError(issue.source, issue.value).message,
        dates: true,
      };
    }
    try {
      return {
        status: 'ok',
        inputs: buildDepreciationInputs(
          ledger.fixedAssets,
          businessDateSelection.businessStartDates,
          businessDateSelection.businessCloseDate,
        ),
      };
    } catch (e) {
      return { status: 'blocked', reason: describeStorageError(e), dates: false };
    }
  });
  const depreciationRunBlocked = $derived(
    depreciationInputs.status === 'loading' ||
      (depreciationInputs.status === 'blocked' && depreciationInputs.dates),
  );
  const conversionBasisNotice = $derived(describeConversionBasisOverCost(ledger.fixedAssets));
  function errorText(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
  }
  type TransferEstimate = NonNullable<ReturnType<typeof estimateTransferIncome>>;
  interface AssetRowCalc {
    depreciation: { amount: string; book: string } | { error: string };
    transfer: TransferEstimate | { error: string } | null;
  }
  // 資産ごとの計算は 1 件ずつ囲み、計算できない資産はその行に理由を出す
  const assetRowCalcs = $derived.by(() => {
    const calcs = new Map<string, AssetRowCalc>();
    if (depreciationInputs.status !== 'ok') {
      return calcs;
    }
    const { pools, statuses } = depreciationInputs.inputs;
    for (const a of ledger.fixedAssets) {
      let depreciation: AssetRowCalc['depreciation'];
      try {
        const r = computeDepreciation(a, depreciationYear, pools.get(a.id), statuses);
        depreciation = { amount: r.amount, book: r.bookValueEnd };
      } catch (e) {
        depreciation = { error: errorText(e) };
      }
      let transfer: AssetRowCalc['transfer'] = null;
      const disposalIssues = (assetIssuesById.get(a.id) ?? []).filter(
        (i) => fixedAssetIssueScope(i) === 'disposal',
      );
      if (a.disposalType === 'sale' && a.disposedDate && disposalIssues.length > 0) {
        transfer = { error: describeFixedAssetIssues(disposalIssues) };
      } else if (disposalIssues.length === 0) {
        try {
          transfer = estimateTransferIncome(a, statuses);
        } catch (e) {
          transfer = { error: errorText(e) };
        }
      }
      calcs.set(a.id, { depreciation, transfer });
    }
    return calcs;
  });
  // 売却した年の譲渡所得の合計。1 件でも計算できなければ、一部だけの合計は出さない
  const transferAssetsThisYear = $derived(
    ledger.fixedAssets.filter(
      (a) =>
        a.disposalType === 'sale' &&
        typeof a.disposedDate === 'string' &&
        Number(a.disposedDate.slice(0, 4)) === depreciationYear,
    ),
  );
  type TransferTotalState =
    { ok: true; terms: ReturnType<typeof transferIncomeByTerm> } | { ok: false; names: string[] };
  const transferIncomeTotal = $derived.by<TransferTotalState>(() => {
    if (depreciationInputs.status !== 'ok') {
      return { ok: false, names: [] };
    }
    const failed = transferAssetsThisYear.filter((a) => {
      const t = assetRowCalcs.get(a.id)?.transfer;
      return t !== null && t !== undefined && 'error' in t;
    });
    if (failed.length > 0) {
      return { ok: false, names: failed.map(fixedAssetLabel) };
    }
    try {
      return {
        ok: true,
        terms: transferIncomeByTerm(
          transferAssetsThisYear,
          depreciationYear,
          depreciationInputs.inputs.statuses,
        ),
      };
    } catch {
      return { ok: false, names: transferAssetsThisYear.map(fixedAssetLabel) };
    }
  });
  const transferIncomeAggregate = $derived.by(() => {
    if (!transferIncomeTotal.ok) {
      return null;
    }
    const occasional = parseAmountInput(transferOccasionalIncome);
    return aggregateTransferIncome({
      shortTerm: transferIncomeTotal.terms.shortTerm,
      longTerm: transferIncomeTotal.terms.longTerm,
      ...(occasional !== undefined ? { occasionalIncome: occasional.toFixed() } : {}),
    });
  });
  const transferOccasionalInvalid = $derived(isAmountInputInvalid(transferOccasionalIncome));

  function selectNewAssetAccount(code: string) {
    newAssetAccount = code;
    newAssetCategory = categoryChoiceForAccount(code);
  }
  // 画面の選択肢を FixedAsset の assetCategory / isMineShaft に写す。未指定は両方とも書かない（既存と同じ扱い）。
  function assetCategoryFields(
    choice: AssetCategoryChoice,
  ): Pick<FixedAsset, 'assetCategory' | 'isMineShaft'> {
    if (choice === '') {
      return {};
    }
    if (choice === 'mine-shaft') {
      return { assetCategory: 2, isMineShaft: true };
    }
    return { assetCategory: Number(choice) as AssetCategory };
  }

  async function addAsset(e: Event) {
    e.preventDefault();
    assetError = '';
    if (!newAssetName.trim() || normalizeAmountInput(newAssetCost) === '') {
      assetError = m.settings_asset_error_required();
      return;
    }
    const cost = parseAmountInput(newAssetCost);
    if (
      cost === undefined ||
      newAssetCostError !== '' ||
      newAssetResidualError !== '' ||
      newAssetLifeError !== '' ||
      newAssetLeaseTermError !== '' ||
      newAssetLife === undefined
    ) {
      return;
    }
    if (
      newAssetMethod === 'small-asset-special' &&
      (filingType !== 'blue' || newAssetSmallCheck.state !== 'eligible' || !newAssetSmallEligible)
    ) {
      assetError = m.settings_asset_error_small_ineligible();
      return;
    }
    if (newAssetMethod === 'lump-sum' && !newAssetLumpSumEligible) {
      assetError = m.settings_asset_error_lump_sum_ineligible();
      return;
    }
    const leaseContractDate = newAssetLeaseContractDate;
    const residualGuarantee = parseAmountInput(newAssetResidualGuarantee)?.toFixed() ?? '';
    const employeeCount = newAssetEmployeeCountValue;
    const employeeFields =
      newAssetMethod === 'small-asset-special' &&
      employeeCount !== undefined &&
      Number.isInteger(employeeCount)
        ? { employeeCountAtAcquisition: employeeCount }
        : {};
    const a: FixedAsset = {
      id: newId(),
      name: newAssetName.trim(),
      acquisitionDate: newAssetDate,
      acquisitionCost: cost.toFixed(),
      usefulLifeYears: newAssetLife,
      depreciationMethod: newAssetMethod,
      accountCode: newAssetAccount,
      ...(newAssetIncomeType === 'realEstate' ? { incomeType: 'realEstate' as const } : {}),
      ...assetCategoryFields(newAssetCategory),
      ...(newAssetLeasedOut ? { isLeasedOut: true } : {}),
      ...(leaseContractDate ? { leaseContractDate } : {}),
      ...(residualGuarantee ? { residualGuaranteeAmount: residualGuarantee } : {}),
      ...employeeFields,
      ...(newAssetUsableLifeUnderOneYear ? { usableLifeUnderOneYear: true } : {}),
      ...(newAssetEssentialToBusiness ? { essentialToBusiness: true } : {}),
      ...(newAssetMethod === 'lease-period-straight-line' && newAssetLeaseTermValue !== undefined
        ? { leaseTermMonths: newAssetLeaseTermValue }
        : {}),
      ...(newAssetMethod === 'small-asset-special' && newAssetDecliningBalanceElected
        ? { decliningBalanceElected: true }
        : {}),
      // 同じ年に業務の用に供した一括償却資産を所得区分ごとに一括償却対象額としてまとめる（所令139条1項）。
      ...(newAssetMethod === 'lump-sum'
        ? { lumpSumPoolId: `${newAssetIncomeType}-${newAssetDate.slice(0, 4)}` }
        : {}),
    };
    const issues = validateFixedAsset(a);
    if (issues.length > 0) {
      assetError = describeFixedAssetIssues(issues);
      return;
    }
    await db.fixedAssets.add(a);
    newAssetName = '';
    newAssetCost = '';
    newAssetLife = 4;
    newAssetEmployeeCount = '';
    newAssetLeasedOut = false;
    newAssetLeaseContractDate = '';
    newAssetResidualGuarantee = '';
    newAssetUsableLifeUnderOneYear = false;
    newAssetEssentialToBusiness = false;
    newAssetLeaseTermMonths = '';
    newAssetDecliningBalanceElected = false;
  }

  async function deleteAsset(id: string) {
    await db.fixedAssets.delete(id);
  }

  function canonicalAmount(raw: string): string {
    return (parseAmountInput(raw) ?? D(0)).toFixed();
  }
  const propertyAmountsInvalid = $derived(
    [propertyAreaSqm, propertyKeyMoneyEtc, propertyOtherIncome, propertyDepositBalance].some((v) =>
      isAmountInputInvalid(v),
    ) || isAmountInputInvalid(propertyAnnualRent),
  );
  const disposeAmountsInvalid = $derived(
    disposeType === 'sale' &&
      (isAmountInputInvalid(disposeSalePrice) || isAmountInputInvalid(disposeSaleExpenses)),
  );

  function startEditProperty(a: FixedAsset) {
    propertyEditId = a.id;
    // 復元された明細は型を検査していない。数値などはそのまま文字列にして入力し直せるようにする
    const raw: unknown = a.realEstateDetail;
    const d: Record<string, unknown> =
      typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
    propertyType = storedToInputText(d.propertyType);
    propertyIsResidential = d.isResidential !== false;
    propertyAddress = storedToInputText(d.address);
    propertyTenantName = storedToInputText(d.tenantName);
    propertyTenantAddress = storedToInputText(d.tenantAddress);
    propertyRentalStart = storedToInputText(d.rentalPeriodStart);
    propertyRentalEnd = storedToInputText(d.rentalPeriodEnd);
    propertyAreaSqm = storedToInputText(d.areaSqm);
    propertyAnnualRent = storedToInputText(d.annualRent);
    propertyKeyMoneyEtc = storedToInputText(d.keyMoneyEtc);
    propertyOtherIncome = storedToInputText(d.otherIncome);
    propertyDepositBalance = storedToInputText(d.depositBalance);
    propertyError = '';
  }

  function cancelEditProperty() {
    propertyEditId = null;
    propertyError = '';
  }

  async function saveProperty() {
    if (!propertyEditId) {
      return;
    }
    propertyError = '';
    if (!propertyType.trim() || !propertyAddress.trim() || !propertyAnnualRent.trim()) {
      propertyError = m.settings_asset_property_error_required();
      return;
    }
    if (propertyAmountsInvalid) {
      propertyError = m.common_amount_invalid();
      return;
    }
    const a = await db.fixedAssets.get(propertyEditId);
    if (!a) {
      return;
    }
    const detail: RealEstatePropertyDetail = {
      propertyType: propertyType.trim(),
      isResidential: propertyIsResidential,
      address: propertyAddress.trim(),
      annualRent: canonicalAmount(propertyAnnualRent),
      ...(propertyTenantName.trim() ? { tenantName: propertyTenantName.trim() } : {}),
      ...(propertyTenantAddress.trim() ? { tenantAddress: propertyTenantAddress.trim() } : {}),
      ...(propertyRentalStart ? { rentalPeriodStart: propertyRentalStart } : {}),
      ...(propertyRentalEnd ? { rentalPeriodEnd: propertyRentalEnd } : {}),
      ...(propertyAreaSqm.trim() ? { areaSqm: canonicalAmount(propertyAreaSqm) } : {}),
      ...(propertyKeyMoneyEtc.trim() ? { keyMoneyEtc: canonicalAmount(propertyKeyMoneyEtc) } : {}),
      ...(propertyOtherIncome.trim() ? { otherIncome: canonicalAmount(propertyOtherIncome) } : {}),
      ...(propertyDepositBalance.trim()
        ? { depositBalance: canonicalAmount(propertyDepositBalance) }
        : {}),
    };
    await db.fixedAssets.put({ ...a, realEstateDetail: detail });
    propertyEditId = null;
  }

  function startEditLife(a: FixedAsset) {
    lifeEditId = a.id;
    const life: unknown = a.usefulLifeYears;
    lifeEditYears = typeof life === 'number' && Number.isFinite(life) ? life : undefined;
    lifeEditLeaseMonths = storedToInputText(a.leaseTermMonths);
    lifeEditError = '';
  }

  function cancelEditLife() {
    lifeEditId = null;
    lifeEditError = '';
  }
  // 耐用年数とリース期間は過去の年の償却額も変える。申告済みの年を確認に出すため、供用年から今の年までを並べる
  function lifeAffectedYears(a: FixedAsset): number[] {
    const start = Number(String(a.serviceStartDate ?? a.acquisitionDate).slice(0, 4));
    const end = Math.max(depreciationYear, ledger.currentYear);
    if (!Number.isInteger(start) || start < 1900 || start > end) {
      return [end];
    }
    return Array.from({ length: end - start + 1 }, (_, i) => start + i);
  }

  async function hasConfirmedAssetEntries(ids: readonly string[]): Promise<boolean> {
    const tags = ids.map((id) => `#${String(id).slice(0, 8)}`);
    if (tags.length === 0) {
      return false;
    }
    const found = await db.journalEntries
      .filter(
        (e) =>
          e.status === 'confirmed' &&
          e.originalEntryId === undefined &&
          tags.some((tag) => e.description.includes(tag)) &&
          ['減価償却', '固定資産除却', '固定資産売却'].some((k) => e.description.includes(k)),
      )
      .first();
    return found !== undefined;
  }

  async function saveLife() {
    const id = lifeEditId;
    if (!id) {
      return;
    }
    lifeEditError = '';
    const a = await db.fixedAssets.get(id);
    if (!a) {
      lifeEditId = null;
      return;
    }
    const isLease = a.depreciationMethod === 'lease-period-straight-line';
    const leaseTermMonths = isLease
      ? parseIntegerInput(lifeEditLeaseMonths, { min: 1, max: Number.MAX_SAFE_INTEGER })
      : undefined;
    const { leaseTermMonths: _lt, ...base } = a;
    const updated: FixedAsset = {
      ...base,
      usefulLifeYears: lifeEditYears ?? Number.NaN,
      ...(isLease && leaseTermMonths !== undefined ? { leaseTermMonths } : {}),
      ...(!isLease && a.leaseTermMonths !== undefined
        ? { leaseTermMonths: a.leaseTermMonths }
        : {}),
    };
    // 新規登録と同じ規則で耐用年数・リース期間を確かめる。ほかの問題はこの欄では直せない
    const ruleIssues = validateFixedAsset(updated).filter(
      (i) => i.kind === 'useful-life' || i.kind === 'lease-term',
    );
    if (ruleIssues.length > 0) {
      lifeEditError = describeFixedAssetIssues(ruleIssues);
      return;
    }
    const commit = async () => {
      if (!(await filedYearGuard.confirm(lifeAffectedYears(a)))) {
        return;
      }
      await db.transaction('rw', db.fixedAssets, async () => {
        const current = await db.fixedAssets.get(id);
        if (!current) {
          return;
        }
        const { leaseTermMonths: _clt, ...rest } = current;
        await db.fixedAssets.put({
          ...rest,
          usefulLifeYears: updated.usefulLifeYears,
          ...(updated.leaseTermMonths !== undefined
            ? { leaseTermMonths: updated.leaseTermMonths }
            : {}),
        });
      });
      lifeEditId = null;
    };
    if (await hasConfirmedAssetEntries([id])) {
      pendingConfirm = {
        title: m.settings_asset_fix_confirm_title(),
        desc: m.settings_asset_fix_confirm_desc({ name: fixedAssetLabel(a) }),
        action: m.settings_asset_fix_confirm_action(),
        run: commit,
      };
      confirmingDelete = true;
      return;
    }
    await commit();
  }
  // 計算に使う開業日・廃業日のうち変わるものの年
  function changedBusinessDateYears(
    before: BusinessDateSelection,
    after: BusinessDateSelection,
  ): number[] {
    const kept = new Set(
      before.businessStartDates.filter((d) => after.businessStartDates.includes(d)),
    );
    const dates = [...before.businessStartDates, ...after.businessStartDates].filter(
      (d) => !kept.has(d),
    );
    if (before.businessCloseDate !== after.businessCloseDate) {
      for (const d of [before.businessCloseDate, after.businessCloseDate]) {
        if (d !== undefined) {
          dates.push(d);
        }
      }
    }
    return dates.map((d) => Number(d.slice(0, 4)));
  }
  // 少額特例の枠は変わった年の償却額を変え、落選した資産の翌年以降の償却額も変える。lifeAffectedYears と同じく今の年まで並べる
  function businessDateAffectedYears(years: readonly number[]): number[] {
    const start = Math.min(...years);
    const end = Math.max(depreciationYear, ledger.currentYear);
    if (!Number.isInteger(start) || start < 1900) {
      return [end];
    }
    if (start > end) {
      return [...new Set(years)].sort((a, b) => a - b);
    }
    return Array.from({ length: end - start + 1 }, (_, i) => start + i);
  }
  // 食い違った欄だけ最新の値に戻す。もう片方の入力は残す
  function applyBusinessDateConflict(
    conflicts: BusinessDateField[],
    stored: Record<BusinessDateField, unknown>,
  ): void {
    if (conflicts.includes('start')) {
      startEdited = false;
      startBase = undefined;
      bizStartInput = storedDateText(readStoredBusinessDate(stored.start));
    }
    if (conflicts.includes('close')) {
      closeEdited = false;
      closeBase = undefined;
      bizCloseInput = storedDateText(readStoredBusinessDate(stored.close));
    }
    bizDatesConflict = m.settings_business_dates_conflict({
      fields:
        conflicts.length > 1
          ? m.settings_business_dates_field_both()
          : conflicts[0] === 'start'
            ? m.settings_business_dates_field_start()
            : m.settings_business_dates_field_close(),
    });
  }
  async function saveBusinessDates() {
    bizDatesError = '';
    bizDatesConflict = '';
    bizDatesSaved = false;
    if (businessDateSources.status !== 'ok') {
      return;
    }
    const startInput = bizStartInput;
    const closeInput = bizCloseInput;
    if (
      (startInput !== '' && !isValidIsoDate(startInput)) ||
      (closeInput !== '' && !isValidIsoDate(closeInput))
    ) {
      bizDatesError = m.settings_business_dates_input_invalid();
      return;
    }
    const sources = businessDateSources.sources;
    const writeStart = writesBusinessDate('start', sources);
    const writeClose = writesBusinessDate('close', sources);
    // 突き合わせる値：変えた欄は変え始めたときの値、変えていない欄はここで年を数えるのに使う値
    const expectedStart = startEdited ? startBase : sources.settingStart?.value;
    const expectedClose = closeEdited ? closeBase : sources.settingClose?.value;
    const changed = changedBusinessDateYears(
      selectEffectiveBusinessDates(sources),
      selectEffectiveBusinessDates(draftBusinessDateSources(sources)),
    );
    const commit = async () => {
      try {
        const result = await saveBusinessDateSettings({
          start: { value: writeStart ? startInput : undefined, expected: expectedStart },
          close: { value: writeClose ? closeInput : undefined, expected: expectedClose },
        });
        if (result.conflicts.length > 0) {
          applyBusinessDateConflict(result.conflicts, result.stored);
          return;
        }
        startEdited = false;
        closeEdited = false;
        startBase = undefined;
        closeBase = undefined;
        bizDatesSaved = true;
      } catch (e) {
        bizDatesError = describeStorageError(e);
      }
    };
    // 使われない設定値だけを変えたときは、どの年の計算も変わらない
    if (changed.length === 0) {
      await commit();
      return;
    }
    if (!(await filedYearGuard.confirm(businessDateAffectedYears(changed)))) {
      return;
    }
    if (await hasConfirmedAssetEntries(ledger.fixedAssets.map((a) => a.id))) {
      pendingConfirm = {
        title: m.settings_business_dates_confirm_title(),
        desc: m.settings_business_dates_confirm_desc(),
        action: m.settings_business_dates_confirm_action(),
        run: commit,
      };
      confirmingDelete = true;
      return;
    }
    await commit();
  }

  function startEditDisposal(a: FixedAsset) {
    disposeEditId = a.id;
    const disposed: unknown = a.disposedDate;
    disposeDate = typeof disposed === 'string' && disposed !== '' ? disposed : todayISO();
    disposeType = a.disposalType === 'sale' ? 'sale' : 'scrap';
    disposeSalePrice = storedToInputText(a.salePrice);
    disposeSaleExpenses = storedToInputText(a.saleExpenses);
    disposeCashAccount = '1110';
    disposeError = '';
  }

  function cancelEditDisposal() {
    disposeEditId = null;
    disposeError = '';
  }

  async function saveDisposal() {
    if (!disposeEditId) {
      return;
    }
    disposeError = '';
    const trimmedSalePrice = disposeSalePrice.trim();
    if (disposeType === 'sale' && !trimmedSalePrice) {
      disposeError = m.settings_asset_disposal_error_sale_price();
      return;
    }
    if (disposeAmountsInvalid) {
      disposeError = m.common_amount_invalid();
      return;
    }
    const a = await db.fixedAssets.get(disposeEditId);
    if (!a) {
      return;
    }
    const trimmedSaleExpenses = disposeSaleExpenses.trim();
    const { salePrice: _sp, saleExpenses: _se, ...base } = a;
    const updated: FixedAsset = {
      ...base,
      disposedDate: disposeDate,
      disposalType: disposeType,
      ...(disposeType === 'sale'
        ? {
            salePrice: canonicalAmount(trimmedSalePrice),
            ...(trimmedSaleExpenses ? { saleExpenses: canonicalAmount(trimmedSaleExpenses) } : {}),
          }
        : {}),
    };
    await db.fixedAssets.put(updated);
    disposeEditId = null;
  }

  async function clearDisposal(id: string) {
    const a = await db.fixedAssets.get(id);
    if (!a) {
      return;
    }
    const { disposedDate: _dd, disposalType: _dt, salePrice: _sp, saleExpenses: _se, ...rest } = a;
    await db.fixedAssets.put(rest);
    delete disposeStatus[id];
  }

  async function runDisposalEntry(id: string) {
    const asset = await db.fixedAssets.get(id);
    if (asset) {
      const issues = validateFixedAsset(asset).filter((i) => fixedAssetIssueScope(i) !== 'output');
      if (issues.length > 0) {
        disposeStatus = { ...disposeStatus, [id]: describeFixedAssetIssues(issues) };
        return;
      }
    }
    if (asset?.disposedDate) {
      const year = Number(asset.disposedDate.slice(0, 4));
      if (
        !(await filedYearGuard.confirm([year], {
          detail: m.filed_year_warning_detail_disposal({
            name: asset.name,
            cost: formatJPY(asset.acquisitionCost),
            date: asset.disposedDate,
          }),
        }))
      ) {
        return;
      }
    }
    let result: Awaited<ReturnType<typeof generateDisposalEntry>>;
    try {
      result = await generateDisposalEntry(id, disposeCashAccount, { allowFiledYear: true });
    } catch (e) {
      disposeStatus = { ...disposeStatus, [id]: describeStorageError(e) };
      return;
    }
    if (result.created) {
      disposeStatus = { ...disposeStatus, [id]: m.settings_asset_disposal_run_success() };
      return;
    }
    const messages: Record<NonNullable<typeof result.reason>, string> = {
      'no-disposal': m.settings_asset_disposal_run_error_no_disposal(),
      'already-exists': m.settings_asset_disposal_run_error_exists(),
      'missing-sale-price': m.settings_asset_disposal_error_sale_price(),
      'lump-sum-scrap-no-entry': m.settings_asset_disposal_run_error_lump_sum(),
      'needs-year-end-depreciation': m.settings_asset_disposal_run_error_needs_depreciation(),
    };
    disposeStatus = { ...disposeStatus, [id]: messages[result.reason!] };
  }

  async function runDepreciation() {
    depreciationStatus = '';
    if (depreciationYearInvalid || depreciationRunBlocked) {
      return;
    }
    if (!(await filedYearGuard.confirm([depreciationYear]))) {
      return;
    }
    try {
      const r = await generateYearEndDepreciation(depreciationYear, { allowFiledYear: true });
      const parts: string[] = [];
      parts.push(
        r.skipped > 0
          ? m.settings_asset_run_success_with_skipped({ created: r.created, skipped: r.skipped })
          : m.settings_asset_run_success({ created: r.created }),
      );
      if (r.smallAssetCapExceeded > 0) {
        parts.push(m.settings_asset_run_warn_small_cap({ count: r.smallAssetCapExceeded }));
      }
      if (r.smallAssetIneligible > 0) {
        parts.push(m.settings_asset_run_warn_small_ineligible({ count: r.smallAssetIneligible }));
      }
      const conversionNotice = describeConversionBasisOverCost(await db.fixedAssets.toArray());
      if (conversionNotice !== '') {
        parts.push(conversionNotice);
      }
      depreciationStatus = parts.join(' / ');
    } catch (e) {
      depreciationStatus = m.settings_asset_run_error({
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }

  async function saveGeminiKey() {
    await setSetting('geminiApiKey', geminiKey.trim());
    geminiKeySaved = m.settings_llm_saved();
    geminiTestStatus = '';
    geminiTestFailed = false;
    if (geminiKey.trim() === '') {
      return;
    }
    // 焼き込んだモデルは提供終了で 404 になる。鍵を保存した時点で一覧を引き、
    // 使える物を選んでおく（利用者は下の選択欄で変えられる）。
    try {
      const { listGeminiModels, pickDefaultGeminiModel } = await import('../domain/llm');
      geminiModels = await listGeminiModels(geminiKey.trim());
      geminiKeySaved = m.settings_llm_models_loaded({ count: geminiModels.length });
      if (geminiModel === '' || !geminiModels.includes(geminiModel)) {
        const picked = pickDefaultGeminiModel(geminiModels);
        if (picked !== undefined) {
          geminiModel = picked;
          await setSetting('geminiModel', picked);
          geminiKeySaved = m.settings_llm_model_picked({ model: picked });
        }
      }
    } catch (e) {
      geminiTestStatus = describeLlmError(e);
      geminiTestFailed = true;
    }
  }

  async function saveGeminiModel() {
    await setSetting('geminiModel', geminiModel);
    geminiKeySaved = m.settings_llm_saved();
    setTimeout(() => {
      geminiKeySaved = '';
    }, 2000);
  }

  async function testGeminiKey() {
    geminiTestStatus = m.settings_llm_testing();
    geminiTestFailed = false;
    try {
      if (geminiModel.trim() === '') {
        throw new Error(m.error_gemini_model_unset());
      }
      const { GeminiAdapter } = await import('../domain/llm');
      const adapter = new GeminiAdapter(geminiKey.trim(), geminiModel.trim());
      await adapter.generateJson(
        '日本語で "ok" だけを JSON 形式 {"status":"ok"} で返してください。',
      );
      geminiTestStatus = m.settings_llm_test_success();
      geminiTestFailed = false;
    } catch (e) {
      geminiTestStatus = m.settings_llm_test_error({ message: describeLlmError(e) });
      geminiTestFailed = true;
    }
  }

  async function saveOcrEngine() {
    await setSetting('aiEngine', aiEngine);
    // select を触らずに保存すると aiEngine は strandedAiEngine と同じ生値のまま。
    // ここで無条件に消すと disabled オプションが消えて選択肢が無い値だけが残り、
    // 再読み込みまで select が空欄になる。選び直した時だけ消す。
    if (
      aiEngine === 'gemini' ||
      aiEngine === 'openai-compatible' ||
      (aiEngine === 'apple-ai' && appleAiOptionShown) ||
      (aiEngine === 'chrome-ai' && chromeAiOptionShown)
    ) {
      strandedAiEngine = null;
    }
    await setSetting('openaiBaseUrl', openaiBaseUrl.trim());
    await setSetting('openaiOcrModel', openaiOcrModel.trim());
    await setSetting('openaiClassifyModel', openaiClassifyModel.trim());
    await setSetting('openaiApiKey', openaiApiKey.trim());
    openaiSaved = m.settings_llm_saved();
    setTimeout(() => {
      openaiSaved = '';
    }, 2000);
  }

  async function fetchOpenaiModels() {
    openaiStatus = m.settings_llm_testing();
    openaiTestFailed = false;
    try {
      const { listOpenAiModels } = await import('../domain/llm');
      openaiModels = await listOpenAiModels(openaiBaseUrl.trim(), openaiApiKey.trim());
      openaiStatus = m.settings_llm_models_loaded({
        count: openaiModels.length,
      });
    } catch (e) {
      openaiStatus = m.settings_llm_test_error({ message: describeLlmError(e) });
      openaiTestFailed = true;
    }
  }

  async function testOpenai() {
    openaiStatus = m.settings_llm_testing();
    openaiTestFailed = false;
    try {
      const { OpenAICompatibleAdapter } = await import('../domain/llm');
      const adapter = new OpenAICompatibleAdapter(
        openaiBaseUrl.trim(),
        openaiClassifyModel.trim() || openaiOcrModel.trim(),
        openaiApiKey.trim(),
      );
      await adapter.generateJson(
        '日本語で "ok" だけを JSON 形式 {"status":"ok"} で返してください。',
      );
      openaiStatus = m.settings_llm_test_success();
      openaiTestFailed = false;
    } catch (e) {
      openaiStatus = m.settings_llm_test_error({ message: describeLlmError(e) });
      openaiTestFailed = true;
    }
  }

  function resetRestoreState() {
    restoreError = '';
    restoreSuccess = '';
    restoreWarning = '';
    restorePayload = null;
    restoreAttachmentBlobs = new Map();
    restoreAttachmentCount = 0;
  }
  // 保存先フォルダから直接読む経路。同期フォルダには個別のファイルで置かれていて、
  // 利用者が「どのファイルか」を選べる形になっていないため、選ばせずに一番新しい
  // 復元可能なバージョンをこちらで選ぶ。
  async function handleRestoreFromFolder() {
    resetRestoreState();
    restoreFileName = '';
    restoringFromFolder = true;
    restoreProgressDone = 0;
    restoreProgressTotal = 0;
    try {
      const found = await backup.readLatestSnapshot({
        onProgress: (done, total) => {
          restoreProgressDone = done;
          restoreProgressTotal = total;
        },
      });
      if (found === null) {
        restoreError = m.settings_restore_folder_empty();
        return;
      }
      restorePayload = found.payload;
      restoreAttachmentBlobs = found.attachmentBlobs;
      restoreAttachmentCount = found.attachmentBlobs.size;
      restoreFileName = found.snapshotName;
      const warnings: string[] = [];
      if (found.corruptAttachmentCount > 0) {
        warnings.push(
          m.settings_restore_corrupt_attachments({ count: found.corruptAttachmentCount }),
        );
      }
      if (found.notDownloadedCount > 0) {
        warnings.push(m.settings_restore_not_downloaded({ count: found.notDownloadedCount }));
      }
      restoreWarning = warnings.join(' ');
    } catch (err) {
      restoreError = describeStorageError(err);
    } finally {
      restoringFromFolder = false;
    }
  }

  async function handleRestoreFile(e: Event) {
    resetRestoreState();
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) {
      return;
    }
    restoreFileName = file.name;
    try {
      // zip（帳簿データ + 証憑写真）と旧形式の純 JSON を自動判定して読む。
      const parsed = await parseBackupFile(file);
      restorePayload = parsed.payload;
      restoreAttachmentBlobs = parsed.attachmentBlobs;
      restoreAttachmentCount = parsed.attachmentBlobs.size;
      // 帳簿自体は復元可能。選択時点で「写真だけ失う」ことを警告として先に見せる。
      if (parsed.corruptAttachmentNames.length > 0) {
        restoreWarning = m.settings_restore_corrupt_attachments({
          count: parsed.corruptAttachmentNames.length,
        });
      }
      // 選択直後は確定ボタンが画面の下に隠れたままになるため、下端の safe area や下に重なるカードを避けて中央へ寄せる。
      await tick();
      restoreApplyButton?.scrollIntoView({ block: 'center' });
    } catch (err) {
      if (err instanceof BackupTooLargeError) {
        restoreError = m.common_file_too_large({
          size: formatBytes(err.fileSize),
          limit: formatBytes(err.limit),
        });
        input.value = '';
      } else if (err instanceof BackupCorruptError) {
        restoreError = m.settings_restore_corrupt({ count: err.entryNames.length });
        input.value = '';
      } else {
        restoreError = err instanceof Error ? err.message : String(err);
      }
    }
  }

  async function confirmRestore() {
    if (!restorePayload) {
      return;
    }
    confirmingRestore = false;
    try {
      // $state はオブジェクトを深く Proxy 化する。Proxy のまま IndexedDB に put すると
      // structured clone 不可で DataCloneError になるため、生のオブジェクトに戻して渡す。
      const result = await restoreFromPayload(
        $state.snapshot(restorePayload),
        restoreAttachmentBlobs,
      );
      // 画面に残った復元前の設定でどれか1つでも「保存」を押されると、復元した設定が
      // 上書きされる。DB を丸ごと置き換える clearAll と同じく、直後に読み直す。
      // 結果の表示は再読み込みをまたいで持ち越す（issue#387）。
      stashRestoreNotice({
        tables: result.tableCount,
        rows: result.rowCount,
        missingBlobCount: result.missingBlobCount,
      });
      location.reload();
    } catch (err) {
      restoreError = describeStorageError(err);
    }
  }

  async function downloadYayoiCsv() {
    if (currentYearInvalid) {
      return;
    }
    accountantExportError = '';
    try {
      const bytes = await exportYayoiCsv(currentYear);
      await saveFile(bytes, `aoiko-yayoi-${currentYear}.csv`, 'text/csv');
    } catch (err) {
      accountantExportError = err instanceof Error ? err.message : String(err);
    }
  }

  async function downloadGenericCsv() {
    if (currentYearInvalid) {
      return;
    }
    accountantExportError = '';
    try {
      const bytes = await exportGenericCsv(currentYear);
      await saveFile(bytes, `aoiko-journal-${currentYear}.csv`, 'text/csv');
    } catch (err) {
      accountantExportError = err instanceof Error ? err.message : String(err);
    }
  }

  async function downloadCorrectionHistoryCsv() {
    if (currentYearInvalid) {
      return;
    }
    accountantExportError = '';
    try {
      const bytes = await exportCorrectionHistoryCsv(currentYear);
      await saveFile(bytes, `aoiko-corrections-${currentYear}.csv`, 'text/csv');
    } catch (err) {
      accountantExportError = err instanceof Error ? err.message : String(err);
    }
  }

  function vendorEntityLabel(t: VendorEntityType | undefined): string {
    if (!t || t === 'unknown') {
      return '—';
    }
    switch (t) {
      case 'corporation':
        return m.settings_vendor_entity_corporation();
      case 'individual':
        return m.settings_vendor_entity_individual();
      case 'public':
        return m.settings_vendor_entity_public();
      case 'foreign':
        return m.settings_vendor_entity_foreign();
    }
  }

  function matchTypeLabel(t: ParserRuleMatchType): string {
    switch (t) {
      case 'description-includes':
        return m.settings_rule_match_includes();
      case 'vendor-name':
        return m.settings_rule_match_vendor();
      case 'regex':
        return m.settings_rule_match_regex();
    }
  }

  function categoryLabel(key: Account['category']): string {
    switch (key) {
      case 'asset':
        return m.settings_account_category_asset();
      case 'liability':
        return m.settings_account_category_liability();
      case 'equity':
        return m.settings_account_category_equity();
      case 'revenue':
        return m.settings_account_category_revenue();
      case 'expense':
        return m.settings_account_category_expense();
    }
  }
</script>

<div class="space-y-8">
  <h2 class="text-2xl font-bold">{m.settings_title()}</h2>

  <section class="space-y-4 border rounded-lg p-6 bg-card text-card-foreground">
    <h3 class="text-lg font-semibold">{m.language_label()}</h3>
    <p class="text-xs text-muted-foreground">
      {m.settings_language_hint()}
    </p>
    <label class="block sm:max-w-xs">
      <select
        value={currentLocale}
        name="uiLocale"
        aria-label={m.language_label()}
        onchange={onLocaleChange}
        class="mt-1 w-full px-3 py-2 bg-background border rounded text-foreground"
      >
        {#each locales as loc (loc)}
          <option value={loc}>{localeLabel(loc)}</option>
        {/each}
      </select>
    </label>
  </section>

  <form onsubmit={saveBasic} class="space-y-4 border rounded-lg p-6 bg-card text-card-foreground">
    <h3 class="text-lg font-semibold">{m.settings_basic_title()}</h3>
    <p class="text-xs text-muted-foreground">
      {@html m.settings_basic_intro_html()}
    </p>
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <label class="block sm:col-span-2">
        <span class="text-xs text-muted-foreground">{m.settings_basic_business_name()}</span>
        <input
          type="text"
          name="jigyoYago"
          autocomplete="off"
          bind:value={userBusinessName}
          placeholder={m.settings_basic_business_name_placeholder()}
          class="mt-1 w-full px-3 py-2 bg-background border rounded text-foreground"
        />
      </label>
      <label class="block">
        <span class="text-xs text-muted-foreground">{m.settings_basic_invoice_number()}</span>
        <input
          type="text"
          name="invoiceRegistrationNumber"
          autocomplete="off"
          bind:value={userInvoiceNumber}
          placeholder="T1234567890123"
          pattern={INVOICE_NUMBER_PATTERN}
          class="mt-1 w-full px-3 py-2 bg-background border rounded text-foreground font-mono"
        />
      </label>
      <label class="block">
        <span class="text-xs text-muted-foreground">{m.settings_basic_year()}</span>
        <input
          type="number"
          name="currentTaxNen"
          autocomplete="off"
          value={currentYear}
          oninput={assignInputNumberOrEmpty((v) => {
            currentYearDraft = v;
            if (
              v !== undefined &&
              parseIntegerInput(String(v), { min: 2020, max: 2099 }) !== undefined
            ) {
              currentYear = v;
            }
          })}
          min="2020"
          max="2099"
          step="1"
          class="mt-1 w-full px-3 py-2 bg-background border rounded text-foreground"
        />
        {#if currentYearInvalid}
          <span class="block mt-1 text-xs text-destructive"
            >{m.common_integer_invalid({ min: 2020, max: 2099 })}</span
          >
        {/if}
      </label>
      <label class="block">
        <span class="text-xs text-muted-foreground">{m.settings_invoice_number_prefix()}</span>
        <input
          type="text"
          name="invoiceNumberSettoji"
          autocomplete="off"
          bind:value={invoiceNumberPrefix}
          placeholder={DEFAULT_INVOICE_PREFIX}
          class="mt-1 w-full px-3 py-2 bg-background border rounded text-foreground font-mono"
        />
      </label>
      <label class="block">
        <span class="text-xs text-muted-foreground">{m.settings_quote_number_prefix()}</span>
        <input
          type="text"
          name="quoteNumberSettoji"
          autocomplete="off"
          bind:value={quoteNumberPrefix}
          placeholder={DEFAULT_QUOTE_PREFIX}
          class="mt-1 w-full px-3 py-2 bg-background border rounded text-foreground font-mono"
        />
      </label>
    </div>
    <label class="flex items-center gap-2 text-sm cursor-pointer">
      <input
        type="checkbox"
        checked={ledger.realEstateIncomeEnabled}
        onchange={(e) =>
          setSetting('realEstateIncomeEnabled', (e.target as HTMLInputElement).checked)}
      />
      {m.settings_basic_real_estate_income_enabled()}
    </label>
    <label class="flex items-center gap-2 text-sm cursor-pointer">
      <input
        type="checkbox"
        checked={ledger.inventoryAutoValuationEnabled}
        onchange={(e) =>
          setSetting('inventoryAutoValuationEnabled', (e.target as HTMLInputElement).checked)}
      />
      {m.settings_basic_inventory_auto_valuation_enabled()}
    </label>
    <label class="flex items-center gap-2 text-sm cursor-pointer">
      <input
        type="checkbox"
        checked={skipAttachmentConfirm}
        onchange={(e) => {
          skipAttachmentConfirm = (e.target as HTMLInputElement).checked;
          setSetting('skipAttachmentConfirm', skipAttachmentConfirm);
        }}
      />
      {m.settings_basic_skip_attachment_confirm()}
    </label>
    <label class="flex items-center gap-2 text-sm cursor-pointer">
      <input
        type="checkbox"
        checked={skipExternalSendConfirm}
        onchange={(e) => {
          skipExternalSendConfirm = (e.target as HTMLInputElement).checked;
          setSetting('skipExternalSendConfirm', skipExternalSendConfirm);
        }}
      />
      {m.settings_basic_skip_external_send_confirm()}
    </label>
    <div>
      <button
        type="button"
        onclick={resetSuppressedConfirmsClick}
        class="px-4 py-2 border rounded hover:bg-accent"
      >
        {m.settings_basic_reset_suppressed_confirms()}
      </button>
      <p class="mt-1 text-xs text-muted-foreground">
        {m.settings_basic_reset_suppressed_confirms_hint()}
      </p>
      {#if resetSuppressedConfirmsStatus}
        <p class="mt-1 text-xs text-green-600">{resetSuppressedConfirmsStatus}</p>
      {/if}
    </div>
    <div class="flex justify-end">
      <button
        type="submit"
        disabled={currentYearInvalid}
        class="px-4 py-2 bg-primary text-primary-foreground rounded hover:opacity-90 disabled:opacity-50"
      >
        {basicSaved ? m.settings_basic_saved() : m.settings_basic_save()}
      </button>
    </div>
  </form>

  <div class="border rounded-lg p-6 bg-card text-card-foreground flex items-center justify-between">
    <div>
      <h3 class="text-lg font-semibold">{m.opening_entry_title()}</h3>
      <p class="text-xs text-muted-foreground">{m.opening_entry_intro()}</p>
    </div>
    <a
      href="/opening-setup"
      use:link
      class="px-4 py-2 bg-primary text-primary-foreground rounded hover:opacity-90 whitespace-nowrap"
    >
      {m.opening_entry_action()}
    </a>
  </div>

  <section
    bind:this={ctSection}
    class="space-y-4 border rounded-lg p-6 bg-card text-card-foreground"
  >
    <h3 class="text-lg font-semibold">{m.settings_consumption_tax_title()}</h3>
    <p class="text-xs text-muted-foreground">
      {m.settings_consumption_tax_intro()}
    </p>
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <label class="block">
        <span class="text-xs text-muted-foreground"
          >{m.settings_consumption_tax_registration()}</span
        >
        <select
          bind:value={taxRegistration}
          name="taxRegistration"
          onchange={saveConsumptionTax}
          class="mt-1 w-full px-3 py-2 bg-background border rounded text-foreground"
        >
          <option value="tax-free">{m.settings_consumption_tax_registration_tax_free()}</option>
          <option value="taxable">{m.settings_consumption_tax_registration_taxable()}</option>
        </select>
      </label>
      {#if taxRegistration === 'taxable'}
        <label class="block">
          <span class="text-xs text-muted-foreground">{m.settings_consumption_tax_method()}</span>
          <select
            bind:value={taxFilingMethod}
            name="taxFilingMethod"
            onchange={saveConsumptionTax}
            class="mt-1 w-full px-3 py-2 bg-background border rounded text-foreground"
          >
            <option value="general">{m.settings_consumption_tax_method_general()}</option>
            <option value="simplified">{m.settings_consumption_tax_method_simplified()}</option>
            <option value="two-wari">{m.settings_consumption_tax_method_two_wari()}</option>
            <option value="three-wari">{m.settings_consumption_tax_method_three_wari()}</option>
          </select>
        </label>
        {#if taxFilingMethod === 'simplified'}
          <label class="block sm:col-span-2">
            <span class="text-xs text-muted-foreground"
              >{m.settings_consumption_tax_simplified_category()}</span
            >
            <select
              bind:value={simplifiedTaxCategory}
              name="simplifiedTaxCategory"
              onchange={saveConsumptionTax}
              class="mt-1 w-full px-3 py-2 bg-background border rounded text-foreground"
            >
              {#each [1, 2, 3, 4, 5, 6] as cat (cat)}
                <option value={cat}
                  >{simplifiedTaxCategoryLabel(cat as SimplifiedTaxCategory)}</option
                >
              {/each}
            </select>
          </label>
        {/if}
        {#if taxFilingMethod === 'general'}
          <label class="block sm:col-span-2">
            <span class="text-xs text-muted-foreground"
              >{m.settings_consumption_tax_attribution_method()}</span
            >
            <select
              bind:value={consumptionTaxAttributionMethod}
              name="consumptionTaxAttributionMethod"
              onchange={saveConsumptionTax}
              class="mt-1 w-full px-3 py-2 bg-background border rounded text-foreground"
            >
              <option value="proportional"
                >{m.settings_consumption_tax_attribution_proportional()}</option
              >
              <option value="individual"
                >{m.settings_consumption_tax_attribution_individual()}</option
              >
            </select>
            <span class="block mt-1 text-xs text-muted-foreground"
              >{m.settings_consumption_tax_attribution_hint()}</span
            >
          </label>
        {/if}
        <label class="block">
          <span class="text-xs text-muted-foreground"
            >{m.settings_ct_registration_start_date()}</span
          >
          <input
            type="date"
            name="ctRegistrationStartDate"
            autocomplete="off"
            bind:value={ctRegistrationStartDate}
            onfocus={(e) => trackCtFocus('ctRegistrationStartDate', e.currentTarget)}
            oninput={(e) => trackCtInput('ctRegistrationStartDate', e.currentTarget)}
            onchange={(e) => commitConsumptionTax('ctRegistrationStartDate', e.currentTarget)}
            onblur={(e) => blurCtDate('ctRegistrationStartDate', e.currentTarget)}
            class="mt-1 w-full px-3 py-2 bg-background border rounded text-foreground tabular-nums supports-[-webkit-touch-callout:none]:appearance-none [&::-webkit-date-and-time-value]:text-left"
          />
          {#each ctErrorMessages('ctRegistrationStartDate') as message (message)}
            <span class="block text-xs text-destructive">{message}</span>
          {/each}
        </label>
        <div class="block">
          <span class="text-xs text-muted-foreground">{m.settings_ct_taxable_election_filed()}</span
          >
          <div class="mt-1 flex items-center gap-2">
            <input
              type="text"
              name="ctTaxableElectionFrom"
              autocomplete="off"
              inputmode="numeric"
              maxlength="4"
              bind:value={ctTaxableElectionFrom}
              onfocus={(e) => trackCtFocus('ctTaxableElectionFrom', e.currentTarget)}
              oninput={(e) => trackCtInput('ctTaxableElectionFrom', e.currentTarget)}
              onchange={(e) => commitConsumptionTax('ctTaxableElectionFrom', e.currentTarget)}
              class="w-full px-3 py-2 bg-background border rounded text-foreground tabular-nums"
            />
            <span class="text-muted-foreground">〜</span>
            <input
              type="text"
              name="ctTaxableElectionTo"
              autocomplete="off"
              inputmode="numeric"
              maxlength="4"
              bind:value={ctTaxableElectionTo}
              onfocus={(e) => trackCtFocus('ctTaxableElectionTo', e.currentTarget)}
              oninput={(e) => trackCtInput('ctTaxableElectionTo', e.currentTarget)}
              onchange={(e) => commitConsumptionTax('ctTaxableElectionTo', e.currentTarget)}
              class="w-full px-3 py-2 bg-background border rounded text-foreground tabular-nums"
            />
          </div>
          {#each ctErrorMessages('ctTaxableElectionFrom', 'ctTaxableElectionTo') as message (message)}
            <span class="block mt-1 text-xs text-destructive">{message}</span>
          {/each}
        </div>
        <label class="block">
          <span class="text-xs text-muted-foreground">{m.settings_ct_inheritance_special()}</span>
          <input
            type="date"
            name="ctInheritanceDate"
            autocomplete="off"
            bind:value={ctInheritanceDate}
            onfocus={(e) => trackCtFocus('ctInheritanceDate', e.currentTarget)}
            oninput={(e) => trackCtInput('ctInheritanceDate', e.currentTarget)}
            onchange={(e) => commitConsumptionTax('ctInheritanceDate', e.currentTarget)}
            onblur={(e) => blurCtDate('ctInheritanceDate', e.currentTarget)}
            class="mt-1 w-full px-3 py-2 bg-background border rounded text-foreground tabular-nums supports-[-webkit-touch-callout:none]:appearance-none [&::-webkit-date-and-time-value]:text-left"
          />
          {#each ctErrorMessages('ctInheritanceDate') as message (message)}
            <span class="block text-xs text-destructive">{message}</span>
          {/each}
        </label>
        <label class="block">
          <span class="text-xs text-muted-foreground"
            >{m.settings_ct_adjusted_fixed_asset_date()}</span
          >
          <input
            type="date"
            name="ctAdjustedFixedAssetDate"
            autocomplete="off"
            bind:value={ctAdjustedFixedAssetDate}
            onfocus={(e) => trackCtFocus('ctAdjustedFixedAssetDate', e.currentTarget)}
            oninput={(e) => trackCtInput('ctAdjustedFixedAssetDate', e.currentTarget)}
            onchange={(e) => commitConsumptionTax('ctAdjustedFixedAssetDate', e.currentTarget)}
            onblur={(e) => blurCtDate('ctAdjustedFixedAssetDate', e.currentTarget)}
            class="mt-1 w-full px-3 py-2 bg-background border rounded text-foreground tabular-nums supports-[-webkit-touch-callout:none]:appearance-none [&::-webkit-date-and-time-value]:text-left"
          />
          {#each ctErrorMessages('ctAdjustedFixedAssetDate') as message (message)}
            <span class="block text-xs text-destructive">{message}</span>
          {/each}
        </label>
        <div class="block">
          <span class="text-xs text-muted-foreground">{m.settings_ct_shortened_period()}</span>
          <div class="mt-1 flex items-center gap-2">
            <input
              type="date"
              name="ctShortenedFrom"
              autocomplete="off"
              bind:value={ctShortenedFrom}
              onfocus={(e) => trackCtFocus('ctShortenedFrom', e.currentTarget)}
              oninput={(e) => trackCtInput('ctShortenedFrom', e.currentTarget)}
              onchange={(e) => commitConsumptionTax('ctShortenedFrom', e.currentTarget)}
              onblur={(e) => blurCtDate('ctShortenedFrom', e.currentTarget)}
              class="w-full min-w-0 px-3 py-2 bg-background border rounded text-foreground tabular-nums supports-[-webkit-touch-callout:none]:appearance-none [&::-webkit-date-and-time-value]:text-left"
            />
            <span class="text-muted-foreground">〜</span>
            <input
              type="date"
              name="ctShortenedTo"
              autocomplete="off"
              bind:value={ctShortenedTo}
              onfocus={(e) => trackCtFocus('ctShortenedTo', e.currentTarget)}
              oninput={(e) => trackCtInput('ctShortenedTo', e.currentTarget)}
              onchange={(e) => commitConsumptionTax('ctShortenedTo', e.currentTarget)}
              onblur={(e) => blurCtDate('ctShortenedTo', e.currentTarget)}
              class="w-full min-w-0 px-3 py-2 bg-background border rounded text-foreground tabular-nums supports-[-webkit-touch-callout:none]:appearance-none [&::-webkit-date-and-time-value]:text-left"
            />
          </div>
          {#each ctErrorMessages('ctShortenedFrom', 'ctShortenedTo') as message (message)}
            <span class="block mt-1 text-xs text-destructive">{message}</span>
          {/each}
        </div>
        <label class="block">
          <span class="text-xs text-muted-foreground">{m.settings_ct_base_period_sales()}</span>
          <input
            type="text"
            name="ctBasePeriodSales"
            autocomplete="off"
            inputmode="numeric"
            bind:value={ctBasePeriodSales}
            onfocus={(e) => trackCtFocus('ctBasePeriodSales', e.currentTarget)}
            oninput={(e) => trackCtInput('ctBasePeriodSales', e.currentTarget)}
            onchange={(e) => commitConsumptionTax('ctBasePeriodSales', e.currentTarget)}
            class="mt-1 w-full px-3 py-2 bg-background border rounded text-foreground text-right tabular-nums"
          />
          {#each ctErrorMessages('ctBasePeriodSales') as message (message)}
            <span class="block text-xs text-destructive">{message}</span>
          {/each}
        </label>
        <label class="block">
          <span class="text-xs text-muted-foreground">{m.settings_ct_specified_period_sales()}</span
          >
          <input
            type="text"
            name="ctSpecifiedPeriodSales"
            autocomplete="off"
            inputmode="numeric"
            bind:value={ctSpecifiedPeriodSales}
            onfocus={(e) => trackCtFocus('ctSpecifiedPeriodSales', e.currentTarget)}
            oninput={(e) => trackCtInput('ctSpecifiedPeriodSales', e.currentTarget)}
            onchange={(e) => commitConsumptionTax('ctSpecifiedPeriodSales', e.currentTarget)}
            class="mt-1 w-full px-3 py-2 bg-background border rounded text-foreground text-right tabular-nums"
          />
          {#each ctErrorMessages('ctSpecifiedPeriodSales') as message (message)}
            <span class="block text-xs text-destructive">{message}</span>
          {/each}
        </label>
        <label class="block">
          <span class="text-xs text-muted-foreground"
            >{m.settings_ct_simplified_election_filed_date()}</span
          >
          <input
            type="date"
            name="ctSimplifiedElectionFiledDate"
            autocomplete="off"
            bind:value={ctSimplifiedElectionFiledDate}
            onfocus={(e) => trackCtFocus('ctSimplifiedElectionFiledDate', e.currentTarget)}
            oninput={(e) => trackCtInput('ctSimplifiedElectionFiledDate', e.currentTarget)}
            onchange={(e) => commitConsumptionTax('ctSimplifiedElectionFiledDate', e.currentTarget)}
            onblur={(e) => blurCtDate('ctSimplifiedElectionFiledDate', e.currentTarget)}
            class="mt-1 w-full px-3 py-2 bg-background border rounded text-foreground tabular-nums supports-[-webkit-touch-callout:none]:appearance-none [&::-webkit-date-and-time-value]:text-left"
          />
          {#each ctErrorMessages('ctSimplifiedElectionFiledDate') as message (message)}
            <span class="block text-xs text-destructive">{message}</span>
          {/each}
        </label>
        <label class="flex items-center gap-2 text-sm cursor-pointer sm:col-span-2">
          <input
            type="checkbox"
            bind:checked={ctForeignWithoutDomesticPe}
            onchange={saveConsumptionTax}
          />
          {m.settings_ct_domestic_pe()}
        </label>
        <label class="flex items-center gap-2 text-sm cursor-pointer sm:col-span-2">
          <input
            type="checkbox"
            bind:checked={ctInterimVoluntaryFiled}
            onchange={saveConsumptionTax}
          />
          {m.settings_ct_interim_voluntary_filed()}
        </label>
        <label class="flex items-center gap-2 text-sm cursor-pointer sm:col-span-2">
          <input
            type="checkbox"
            bind:checked={ctInterimVoluntaryLapsed}
            onchange={saveConsumptionTax}
          />
          {m.settings_ct_interim_voluntary_lapsed()}
        </label>
      {/if}
    </div>
    {#if consumptionTaxSaved}
      <p class="text-xs text-green-600">{m.settings_consumption_tax_saved()}</p>
    {/if}
  </section>

  <form onsubmit={saveFiler} class="space-y-4 border rounded-lg p-6 bg-card text-card-foreground">
    <h3 class="text-lg font-semibold">{m.settings_filer_title()}</h3>
    <p class="text-xs text-muted-foreground">
      {@html m.settings_filer_intro_html()}
    </p>
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <label class="block">
        <span class="text-xs text-muted-foreground">{m.settings_filer_riyosha_id()}</span>
        <input
          type="text"
          name="etaxRiyoshaId"
          autocomplete="off"
          bind:value={userRiyoshaId}
          oninput={() => filerStoredUnreadable.delete('userRiyoshaId')}
          inputmode="numeric"
          maxlength="16"
          class="mt-1 w-full px-3 py-2 bg-background border rounded text-foreground font-mono"
        />
        {#if riyoshaIdInvalid}
          <span class="block mt-1 text-xs text-destructive"
            >{m.settings_filer_riyosha_id_invalid()}</span
          >
        {/if}
      </label>
      <label class="block">
        <span class="text-xs text-muted-foreground">{m.settings_filer_name()}</span>
        <input
          type="text"
          name="filerShimei"
          autocomplete="off"
          bind:value={userFilerName}
          oninput={() => filerStoredUnreadable.delete('userFilerName')}
          class="mt-1 w-full px-3 py-2 bg-background border rounded text-foreground"
        />
        {#if filerStoredUnreadable.has('userFilerName')}
          <span class="block mt-1 text-xs text-destructive"
            >{m.settings_filer_stored_unreadable()}</span
          >
        {/if}
      </label>
      <label class="block">
        <span class="text-xs text-muted-foreground">{m.settings_filer_zip()}</span>
        <input
          type="text"
          name="filerYubinBango"
          autocomplete="off"
          bind:value={userFilerZip}
          oninput={() => filerStoredUnreadable.delete('userFilerZip')}
          inputmode="numeric"
          maxlength="8"
          class="mt-1 w-full px-3 py-2 bg-background border rounded text-foreground font-mono"
        />
        {#if filerZipInvalid}
          <span class="block mt-1 text-xs text-destructive">{m.settings_filer_zip_invalid()}</span>
        {/if}
      </label>
      <label class="block">
        <span class="text-xs text-muted-foreground">{m.settings_filer_address()}</span>
        <input
          type="text"
          name="filerJusho"
          autocomplete="off"
          bind:value={userFilerAddress}
          oninput={() => filerStoredUnreadable.delete('userFilerAddress')}
          class="mt-1 w-full px-3 py-2 bg-background border rounded text-foreground"
        />
        {#if filerStoredUnreadable.has('userFilerAddress')}
          <span class="block mt-1 text-xs text-destructive"
            >{m.settings_filer_stored_unreadable()}</span
          >
        {/if}
      </label>
      <label class="block sm:col-span-2 relative">
        <span class="text-xs text-muted-foreground">{m.settings_filer_zeimusho()}</span>
        <input
          type="text"
          name="zeimushoSearch"
          value={zeimushoQuery}
          oninput={(e) => onZeimushoInput((e.target as HTMLInputElement).value)}
          onfocus={() => (zeimushoOpen = true)}
          onblur={() => setTimeout(() => (zeimushoOpen = false), 150)}
          placeholder={m.settings_filer_zeimusho_placeholder()}
          autocomplete="off"
          class="mt-1 w-full px-3 py-2 bg-background border rounded text-foreground"
        />
        {#if zeimushoResults.length > 0}
          <ul
            class="absolute z-10 mt-1 max-h-60 w-full overflow-auto rounded border bg-background shadow-lg"
          >
            {#each zeimushoResults as e (e.code)}
              <li>
                <button
                  type="button"
                  onmousedown={(ev) => {
                    ev.preventDefault();
                    selectZeimusho(e);
                  }}
                  class="block w-full px-3 py-2 text-left text-sm hover:bg-accent"
                >
                  <span class="text-foreground"
                    >{e.name || m.settings_filer_zeimusho_fallback()}</span
                  >
                  <span class="ml-2 font-mono text-xs text-muted-foreground">{e.code}</span>
                </button>
              </li>
            {/each}
          </ul>
        {/if}
        {#if filerStoredUnreadable.has('userZeimushoName')}
          <span class="text-xs text-red-600">{m.settings_filer_stored_unreadable()}</span>
        {:else if zeimushoCodeInvalid}
          <span class="text-xs text-red-600">{m.settings_filer_zeimusho_invalid()}</span>
        {:else if zeimushoUnresolved}
          <span class="text-xs text-red-600">{m.settings_filer_zeimusho_unresolved()}</span>
        {/if}
      </label>
      <div class="block sm:col-span-2">
        <span class="text-xs text-muted-foreground">{m.settings_filing_type_label()}</span>
        <div class="mt-1 flex gap-4 text-sm">
          <label class="flex items-center gap-1 py-2">
            <input
              type="radio"
              name="filingType"
              value="blue"
              bind:group={filingTypeChoice}
              onchange={() => requestFilingTypeChange('blue')}
            />
            {m.settings_filing_type_blue()}
          </label>
          <label class="flex items-center gap-1 py-2">
            <input
              type="radio"
              name="filingType"
              value="white"
              bind:group={filingTypeChoice}
              onchange={() => requestFilingTypeChange('white')}
            />
            {m.settings_filing_type_white()}
          </label>
        </div>
      </div>
      {#if filingType === 'blue'}
        <label class="block sm:col-span-2">
          <span class="text-xs text-muted-foreground">{m.settings_aoiro_label()}</span>
          <select
            bind:value={aoiroDeductionKind}
            name="aoiroDeductionKind"
            class="mt-1 w-full px-3 py-2 bg-background border rounded text-foreground"
          >
            <option value="electronic">{m.settings_aoiro_electronic()}</option>
            <option value="eTax">{m.settings_aoiro_etax()}</option>
            <option value="doubleEntry">{m.settings_aoiro_double_entry()}</option>
            <option value="simple">{m.settings_aoiro_simple()}</option>
            <option value="none">{m.settings_aoiro_none()}</option>
          </select>
        </label>
        <label class="flex items-center gap-2 py-2 sm:col-span-2">
          <input type="checkbox" bind:checked={cashBasisElection} />
          <span class="text-sm">{m.settings_cash_basis_election()}</span>
        </label>
      {/if}
    </div>
    <div class="flex items-center justify-end gap-3">
      {#if filerSaved}
        <span class="text-xs text-green-600">{m.settings_basic_saved()}</span>
      {/if}
      <button
        type="submit"
        disabled={zeimushoCodeInvalid ||
          zeimushoUnresolved ||
          riyoshaIdInvalid ||
          filerZipInvalid ||
          filerStoredUnreadable.size > 0}
        class="px-4 py-2 bg-primary text-primary-foreground rounded hover:opacity-90 disabled:opacity-50"
      >
        {m.settings_basic_save()}
      </button>
    </div>
  </form>

  <section class="space-y-4 border rounded-lg p-6 bg-card text-card-foreground">
    <h3 class="text-lg font-semibold">{m.settings_carryover_title()}</h3>
    <p class="text-xs text-muted-foreground">
      {@html m.settings_carryover_intro_html({ year: currentYear })}
    </p>
    <div class="flex flex-wrap gap-2">
      <button
        type="button"
        onclick={previewCarryover}
        disabled={currentYearInvalid}
        class="px-4 py-2 border rounded hover:bg-accent disabled:opacity-50"
      >
        {m.settings_carryover_preview_button()}
      </button>
      <button
        type="button"
        onclick={runCarryover}
        disabled={currentYearInvalid}
        class="px-4 py-2 bg-primary text-primary-foreground rounded hover:opacity-90 disabled:opacity-50"
      >
        {m.settings_carryover_apply_button()}
      </button>
      <button
        type="button"
        data-testid="carryover-reverse-button"
        onclick={() =>
          askReverseCarryover(m.settings_carryover_name({ year: currentYear }), deleteCarryover)}
        disabled={currentYearInvalid}
        class="px-4 py-2 border rounded text-destructive hover:bg-destructive/10 disabled:opacity-50"
      >
        {m.settings_carryover_delete_button()}
      </button>
      {#if currentYearInvalid}
        <span class="self-center text-xs text-destructive"
          >{m.common_integer_invalid({ min: 2020, max: 2099 })}</span
        >
      {/if}
    </div>
    {#if carryoverStatus}
      <p class="text-sm text-green-600">{carryoverStatus}</p>
    {/if}
    {#if carryoverError}
      <p class="text-sm text-destructive">{carryoverError}</p>
    {/if}
    {#if carryoverPreview && !currentYearInvalid}
      {@const p = carryoverPreview}
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm pt-2">
        <div>
          <h4 class="font-medium mb-1">{m.settings_carryover_assets_label()}</h4>
          {#if p.assets.length === 0}
            <p class="text-muted-foreground text-xs">{m.settings_carryover_none()}</p>
          {:else}
            <ul class="space-y-1">
              {#each p.assets as a (a.accountCode)}
                <li class="flex justify-between">
                  <span>{a.accountCode} {a.accountName}</span>
                  <span class="font-mono">{formatJPY(a.amount)}</span>
                </li>
              {/each}
            </ul>
          {/if}
        </div>
        <div>
          <h4 class="font-medium mb-1">{m.settings_carryover_liabilities_label()}</h4>
          {#if p.liabilities.length === 0 && p.capitalAmount === '0'}
            <p class="text-muted-foreground text-xs">{m.settings_carryover_none()}</p>
          {:else}
            <ul class="space-y-1">
              {#each p.liabilities as l (l.accountCode)}
                <li class="flex justify-between">
                  <span>{l.accountCode} {l.accountName}</span>
                  <span class="font-mono">{formatJPY(l.amount)}</span>
                </li>
              {/each}
              <li class="flex justify-between border-t pt-1">
                <span>{p.capitalCode} {m.settings_carryover_capital_label()}</span>
                <span class="font-mono">{formatJPY(p.capitalAmount)}</span>
              </li>
            </ul>
          {/if}
        </div>
      </div>
      <div class="text-xs text-muted-foreground border-t pt-2 space-y-0.5">
        <p>
          {m.settings_carryover_prior_net_income()}：<span class="font-mono"
            >{formatJPY(p.priorNetIncome)}</span
          >
        </p>
        <p>
          {m.settings_carryover_prior_capital()}：<span class="font-mono"
            >{formatJPY(p.priorEndingCapital)}</span
          >
        </p>
        <p>
          {m.settings_carryover_prior_owner_movements({
            withdrawals: formatJPY(p.priorOwnerWithdrawals),
            contributions: formatJPY(p.priorOwnerContributions),
          })}
        </p>
      </div>
    {/if}
    <div class="border-t pt-4 space-y-2">
      <h4 class="text-sm font-medium">{m.settings_bad_debt_reversal_title()}</h4>
      <p class="text-xs text-muted-foreground">
        {m.settings_bad_debt_reversal_intro({ year: currentYear })}
      </p>
      <button
        type="button"
        onclick={runBadDebtReversal}
        data-testid="bad-debt-reversal-run"
        disabled={currentYearInvalid}
        class="px-4 py-2 border rounded hover:bg-accent disabled:opacity-50"
      >
        {m.settings_bad_debt_reversal_button()}
      </button>
      {#if currentYearInvalid}
        <span class="ml-2 text-xs text-destructive"
          >{m.common_integer_invalid({ min: 2020, max: 2099 })}</span
        >
      {/if}
      {#if badDebtReversalStatus}
        <p class="text-sm text-green-600">{badDebtReversalStatus}</p>
      {/if}
      {#if badDebtReversalError}
        <p class="text-sm text-destructive">{badDebtReversalError}</p>
      {/if}
    </div>
  </section>

  <section class="space-y-4 border rounded-lg p-6 bg-card text-card-foreground">
    <h3 class="text-lg font-semibold">{m.settings_subaccount_title()}</h3>
    <p class="text-xs text-muted-foreground">
      {m.settings_subaccount_intro()}
    </p>
    <form onsubmit={addSubAccount} class="flex flex-wrap gap-3 items-center">
      <select
        bind:value={newSubParent}
        name="subAccountParent"
        aria-label={m.settings_subaccount_parent_select()}
        required
        class="flex-1 min-w-40 px-3 h-11 bg-background border rounded text-foreground"
      >
        <option value="">{m.settings_subaccount_parent_select()}</option>
        {#each accountGroups as group (group.category)}
          <optgroup label={group.label}>
            {#each group.items as a (a.code)}
              <option value={a.code}>{a.code} {a.name}</option>
            {/each}
          </optgroup>
        {/each}
      </select>
      <input
        type="text"
        name="subAccountTitle"
        aria-label={m.settings_subaccount_name_placeholder()}
        autocomplete="off"
        bind:value={newSubName}
        required
        placeholder={m.settings_subaccount_name_placeholder()}
        class="flex-1 min-w-40 px-3 h-11 bg-background border rounded text-foreground"
      />
      <button
        type="submit"
        class="ml-auto px-4 h-11 bg-primary text-primary-foreground rounded hover:opacity-90"
      >
        {m.settings_action_add()}
      </button>
    </form>
    {#if subError}
      <div class="text-sm text-destructive">{subError}</div>
    {/if}
    {#if subGroups.length > 0}
      <ul class="space-y-3">
        {#each subGroups as group (group.account.code)}
          <li class="space-y-1">
            <div class="text-xs text-muted-foreground">
              <span class="font-mono">{group.account.code}</span>
              {group.account.name}
            </div>
            <ul class="space-y-1">
              {#each group.items as sa (sa.id)}
                <li
                  class="flex items-center justify-between border rounded px-3 py-2 bg-background"
                >
                  <span>{sa.name}</span>
                  <button
                    type="button"
                    onclick={() => askDelete(sa.name, () => deleteSubAccount(sa.id))}
                    class="text-xs text-muted-foreground hover:text-destructive"
                  >
                    {m.settings_action_delete()}
                  </button>
                </li>
              {/each}
            </ul>
          </li>
        {/each}
      </ul>
    {:else}
      <p class="text-sm text-muted-foreground">{m.settings_subaccount_empty()}</p>
    {/if}
  </section>

  <section class="space-y-4 border rounded-lg p-6 bg-card text-card-foreground">
    <h3 class="text-lg font-semibold">{m.settings_vendor_title()}</h3>
    <p class="text-xs text-muted-foreground">
      {m.settings_vendor_intro()}
    </p>
    <form onsubmit={addVendor} class="flex flex-wrap gap-3 items-center">
      <input
        type="text"
        name="vendorTorihikisaki"
        aria-label={m.settings_vendor_name_placeholder()}
        autocomplete="off"
        bind:value={newVendorName}
        required
        placeholder={m.settings_vendor_name_placeholder()}
        class="flex-1 min-w-40 px-3 h-11 bg-background border rounded text-foreground"
      />
      <select
        bind:value={newVendorEntityType}
        name="vendorEntityType"
        aria-label={m.settings_vendor_entity_label()}
        class="px-3 h-11 bg-background border rounded text-foreground"
      >
        <option value="unknown">{m.settings_vendor_entity_label()}</option>
        <option value="corporation">{m.settings_vendor_entity_corporation()}</option>
        <option value="individual">{m.settings_vendor_entity_individual()}</option>
        <option value="public">{m.settings_vendor_entity_public()}</option>
        <option value="foreign">{m.settings_vendor_entity_foreign()}</option>
      </select>
      <input
        type="text"
        name="vendorInvoiceNumber"
        autocomplete="off"
        aria-label={m.settings_vendor_invoice_placeholder()}
        bind:value={newVendorInvoice}
        placeholder={m.settings_vendor_invoice_placeholder()}
        pattern={INVOICE_NUMBER_PATTERN}
        class="flex-1 min-w-48 px-3 h-11 bg-background border rounded text-foreground font-mono text-sm"
      />
      <select
        bind:value={newVendorAccountCode}
        name="vendorDefaultAccount"
        aria-label={m.settings_vendor_default_account()}
        class="flex-1 min-w-40 px-3 h-11 bg-background border rounded text-foreground"
      >
        <option value="">{m.settings_vendor_default_account()}</option>
        {#each accountGroups as group (group.category)}
          <optgroup label={group.label}>
            {#each group.items as a (a.code)}
              <option value={a.code}>{a.code} {a.name}</option>
            {/each}
          </optgroup>
        {/each}
      </select>
      <input
        type="text"
        name="vendorSofusaki"
        aria-label={m.settings_vendor_address_placeholder()}
        autocomplete="off"
        bind:value={newVendorAddress}
        placeholder={m.settings_vendor_address_placeholder()}
        class="flex-1 min-w-48 px-3 h-11 bg-background border rounded text-foreground"
      />
      <button
        type="submit"
        class="ml-auto px-4 h-11 bg-primary text-primary-foreground rounded hover:opacity-90"
      >
        {m.settings_action_add()}
      </button>
    </form>
    {#if vendorError}
      <div class="text-sm text-destructive">{vendorError}</div>
    {/if}
    {#if ledger.vendors.length > 0}
      <ul class="space-y-1">
        {#each ledger.vendors as v (v.id)}
          <li class="flex gap-3 items-center border rounded px-3 py-2 bg-background text-sm">
            <div class="flex-1 min-w-0">
              <span class="break-all">
                {v.name}
                <span class="text-xs text-muted-foreground ml-2"
                  >{vendorEntityLabel(v.entityType)}</span
                >
              </span>
              {#if v.invoiceNumber || v.defaultAccountCode}
                <div class="flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
                  {#if v.invoiceNumber}
                    <span class="font-mono">{v.invoiceNumber}</span>
                    <a
                      href={`https://www.invoice-kohyo.nta.go.jp/regno-search/list?selRegNo=${v.invoiceNumber.replace(/^T/, '')}`}
                      target="_blank"
                      rel="noreferrer noopener"
                      class="text-primary hover:underline"
                    >
                      {m.settings_vendor_official_site()}
                    </a>
                  {/if}
                  {#if v.defaultAccountCode}
                    <span>{v.defaultAccountCode}</span>
                  {/if}
                </div>
              {/if}
              {#if v.address}
                <div class="text-xs text-muted-foreground break-all">{v.address}</div>
              {/if}
            </div>
            <button
              type="button"
              onclick={() => askDelete(v.name, () => deleteVendor(v.id))}
              class="shrink-0 text-xs text-muted-foreground hover:text-destructive"
            >
              {m.settings_action_delete()}
            </button>
          </li>
        {/each}
      </ul>
    {:else}
      <p class="text-sm text-muted-foreground">{m.settings_vendor_empty()}</p>
    {/if}
  </section>

  {#if ledger.inventoryAutoValuationEnabled}
    <section class="space-y-4 border rounded-lg p-6 bg-card text-card-foreground">
      <h3 class="text-lg font-semibold">{m.settings_inventory_item_title()}</h3>
      <p class="text-xs text-muted-foreground">
        {m.settings_inventory_item_intro()}
      </p>
      <form onsubmit={addInventoryItem} class="flex flex-wrap gap-3 items-center">
        <input
          type="text"
          name="inventoryItemTitle"
          aria-label={m.settings_inventory_item_name_placeholder()}
          autocomplete="off"
          bind:value={newInventoryItemName}
          required
          placeholder={m.settings_inventory_item_name_placeholder()}
          class="flex-1 min-w-40 px-3 h-11 bg-background border rounded text-foreground"
        />
        <button
          type="submit"
          class="ml-auto px-4 h-11 bg-primary text-primary-foreground rounded hover:opacity-90"
        >
          {m.settings_action_add()}
        </button>
      </form>
      {#if inventoryItemError}
        <div class="text-sm text-destructive">{inventoryItemError}</div>
      {/if}
      {#if ledger.inventoryItems.length > 0}
        <ul class="space-y-1">
          {#each ledger.inventoryItems as it (it.id)}
            <li
              class="flex flex-wrap gap-3 items-center border rounded px-3 py-2 bg-background text-sm"
            >
              <span class="flex-1 min-w-40 break-all">{it.name}</span>
              <button
                type="button"
                onclick={() => askDelete(it.name, () => deleteInventoryItem(it.id))}
                class="text-xs text-muted-foreground hover:text-destructive"
              >
                {m.settings_action_delete()}
              </button>
            </li>
          {/each}
        </ul>
      {:else}
        <p class="text-sm text-muted-foreground">{m.settings_inventory_item_empty()}</p>
      {/if}
    </section>
  {/if}

  <section
    data-testid="business-dates-section"
    class="space-y-4 border rounded-lg p-6 bg-card text-card-foreground"
  >
    <h3 class="text-lg font-semibold">{m.settings_business_dates_title()}</h3>
    <p class="text-xs text-muted-foreground">{m.settings_business_dates_intro()}</p>
    {#if interruptedOpeningYears.length > 0}
      <p data-testid="settings-interrupted-opening-years" class="text-sm text-amber-600">
        {m.opening_interrupted_years({ years: interruptedOpeningYears.join('、') })}
        <a href="/opening-setup" use:link class="underline">{m.opening_entry_action()}</a>
      </p>
    {/if}
    {#if businessDateSources.status === 'loading'}
      <p class="text-sm text-muted-foreground">{m.settings_business_dates_loading()}</p>
    {:else if businessDateSources.status === 'error'}
      <p class="text-sm text-destructive" role="alert">
        {m.settings_business_dates_load_failed({ reason: businessDateSources.reason })}
      </p>
    {:else}
      {@const sources = businessDateSources.sources}
      <div class="space-y-1">
        <h4 class="text-sm font-medium">{m.settings_business_dates_effective_title()}</h4>
        {#if businessDateSelection && businessDateSelection.startSources.length > 0}
          <ul class="text-sm space-y-0.5 tabular-nums">
            {#each businessDateSelection.startSources as src (src.year)}
              <li>
                {m.settings_business_dates_effective_row({
                  year: src.year,
                  date: src.date,
                  source:
                    src.source === 'setting'
                      ? m.settings_business_dates_source_setting()
                      : m.settings_business_dates_source_opening_entry(),
                })}
              </li>
            {/each}
          </ul>
        {:else}
          <p class="text-sm text-muted-foreground">
            {m.settings_business_dates_effective_none()}
          </p>
        {/if}
        {#each sources.invalidOpeningDates as value, i (i)}
          <p class="text-xs text-destructive">
            {m.settings_business_dates_opening_entry_unreadable({ value: value.slice(0, 40) })}
          </p>
        {/each}
      </div>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <label class="block">
          <span class="text-xs text-muted-foreground"
            >{m.settings_business_dates_start_label()}</span
          >
          <input
            type="date"
            name="businessStartDateSetting"
            autocomplete="off"
            bind:value={bizStartInput}
            oninput={() => markBusinessDateEdited('start')}
            class="mt-1 block px-3 h-10 bg-background border rounded text-foreground text-sm tabular-nums supports-[-webkit-touch-callout:none]:appearance-none supports-[-webkit-touch-callout:none]:w-40 [&::-webkit-date-and-time-value]:text-left"
          />
          {#if sources.settingStart && !sources.settingStart.valid}
            <span class="block mt-1 text-xs text-destructive">
              {m.settings_business_dates_stored_unreadable({
                value: String(sources.settingStart.value).slice(0, 40),
              })}
            </span>
          {/if}
          {#if bizStartNote}
            <span class="block mt-1 text-xs text-muted-foreground">{bizStartNote}</span>
          {/if}
        </label>
        <label class="block">
          <span class="text-xs text-muted-foreground"
            >{m.settings_business_dates_close_label()}</span
          >
          <input
            type="date"
            name="businessCloseDateSetting"
            autocomplete="off"
            bind:value={bizCloseInput}
            oninput={() => markBusinessDateEdited('close')}
            class="mt-1 block px-3 h-10 bg-background border rounded text-foreground text-sm tabular-nums supports-[-webkit-touch-callout:none]:appearance-none supports-[-webkit-touch-callout:none]:w-40 [&::-webkit-date-and-time-value]:text-left"
          />
          {#if sources.settingClose && !sources.settingClose.valid}
            <span class="block mt-1 text-xs text-destructive">
              {m.settings_business_dates_stored_unreadable({
                value: String(sources.settingClose.value).slice(0, 40),
              })}
            </span>
          {/if}
          {#if bizCloseReopen}
            <span class="block mt-1 text-xs text-muted-foreground">
              {m.settings_business_dates_close_reopen()}
            </span>
          {/if}
        </label>
      </div>
      <div class="flex flex-wrap items-center justify-end gap-2">
        {#if bizDatesError}
          <span class="text-xs text-destructive">{bizDatesError}</span>
        {/if}
        {#if bizDatesConflict}
          <span data-testid="business-dates-conflict" class="text-xs text-destructive">
            {bizDatesConflict}
          </span>
        {/if}
        {#if bizDatesSaved}
          <span class="text-xs text-green-600">{m.settings_basic_saved()}</span>
        {/if}
        <button
          type="button"
          onclick={saveBusinessDates}
          class="px-4 py-2 bg-primary text-primary-foreground rounded hover:opacity-90"
        >
          {m.settings_action_save()}
        </button>
      </div>
    {/if}
  </section>

  <section class="space-y-4 border rounded-lg p-6 bg-card text-card-foreground">
    <h3 class="text-lg font-semibold">{m.settings_asset_title()}</h3>
    <p class="text-xs text-muted-foreground">
      {m.settings_asset_intro()}
    </p>

    <form onsubmit={addAsset} class="space-y-2">
      <input
        type="text"
        name="assetTitle"
        aria-label={m.settings_asset_name_placeholder()}
        autocomplete="off"
        bind:value={newAssetName}
        required
        placeholder={m.settings_asset_name_placeholder()}
        class="w-full px-3 py-2 bg-background border rounded text-foreground text-sm"
      />
      <div class="flex flex-wrap gap-2 items-center">
        <input
          type="date"
          name="assetAcquisitionDate"
          autocomplete="off"
          aria-label={m.settings_asset_date_title()}
          bind:value={newAssetDate}
          required
          title={m.settings_asset_date_title()}
          class="px-3 h-10 bg-background border rounded text-foreground text-sm tabular-nums supports-[-webkit-touch-callout:none]:appearance-none supports-[-webkit-touch-callout:none]:w-40 [&::-webkit-date-and-time-value]:text-left"
        />
        <input
          type="number"
          name="assetAcquisitionCost"
          autocomplete="off"
          aria-label={m.settings_asset_cost_placeholder()}
          value={newAssetCost}
          oninput={assignInputString((v) => (newAssetCost = v))}
          required
          min="0"
          step="1"
          placeholder={m.settings_asset_cost_placeholder()}
          class="flex-1 min-w-40 px-3 h-10 bg-background border rounded text-foreground text-sm tabular-nums text-right"
        />
        <input
          type="number"
          name="assetUsefulLife"
          autocomplete="off"
          aria-label={m.settings_asset_life_title()}
          value={newAssetLife}
          oninput={assignInputNumberOrEmpty((v) => (newAssetLife = v))}
          required
          min="1"
          step="1"
          title={m.settings_asset_life_title()}
          class="w-20 px-3 h-10 bg-background border rounded text-foreground text-sm tabular-nums"
        />
        <select
          value={newAssetAccount}
          name="assetAccount"
          aria-label={m.settings_asset_account_title()}
          onchange={(e) => selectNewAssetAccount(e.currentTarget.value)}
          title={m.settings_asset_account_title()}
          class="max-w-full px-3 h-10 bg-background border rounded text-foreground text-sm"
        >
          {#each DEPRECIABLE_ASSET_ACCOUNTS as acc (acc.code)}
            <option value={acc.code}>{acc.code} {acc.name}</option>
          {/each}
        </select>
        <select
          value={newAssetMethod}
          name="assetMethod"
          aria-label={m.settings_asset_method_title()}
          onchange={(e) => (newAssetMethod = e.currentTarget.value as DepreciationMethod)}
          title={m.settings_asset_method_title()}
          class="max-w-full px-3 py-2 bg-background border rounded text-foreground text-sm"
        >
          <option value="straight-line">{m.settings_asset_method_straight()}</option>
          <option value="declining-balance">{m.settings_asset_method_declining()}</option>
          {#if filingType === 'blue'}
            <option value="small-asset-special">{m.settings_asset_method_small_special()}</option>
          {/if}
          <option value="lump-sum">{m.settings_asset_method_lump_sum()}</option>
          <option value="lease-period-straight-line"
            >{m.settings_asset_method_lease_period()}</option
          >
          {#if newAssetDate <= '2007-03-31'}
            <option value="old-straight-line">{m.settings_asset_method_old_straight()}</option>
            <option value="old-declining-balance">{m.settings_asset_method_old_declining()}</option>
          {/if}
        </select>
        {#if ledger.realEstateIncomeEnabled}
          <select
            bind:value={newAssetIncomeType}
            name="assetIncomeType"
            aria-label={m.journal_form_income_type_label()}
            title={m.journal_form_income_type_label()}
            class="max-w-full px-3 py-2 bg-background border rounded text-foreground text-sm"
          >
            <option value="business">{m.journal_form_income_type_business()}</option>
            <option value="realEstate">{m.journal_form_income_type_real_estate()}</option>
          </select>
        {/if}
        <button
          type="submit"
          class="ml-auto px-4 py-2 bg-primary text-primary-foreground rounded hover:opacity-90"
        >
          {m.settings_action_add()}
        </button>
      </div>
      <div class="flex flex-wrap gap-2 items-center">
        <select
          bind:value={newAssetCategory}
          name="assetCategory"
          aria-label={m.settings_asset_category()}
          title={m.settings_asset_category()}
          class="max-w-full px-3 h-10 bg-background border rounded text-foreground text-sm"
        >
          <option value="">{m.settings_asset_category()}</option>
          {#each ASSET_CATEGORY_CHOICES as choice (choice.value)}
            <option value={choice.value}>{choice.label()}</option>
          {/each}
        </select>
        {#if newAssetMethod === 'small-asset-special'}
          <input
            type="number"
            name="assetEmployeeCount"
            autocomplete="off"
            aria-label={m.settings_asset_employee_count()}
            value={newAssetEmployeeCount}
            oninput={assignInputString((v) => (newAssetEmployeeCount = v))}
            min="0"
            step="1"
            placeholder={m.settings_asset_employee_count()}
            title={m.settings_asset_employee_count()}
            class="w-64 max-w-full px-3 h-10 bg-background border rounded text-foreground text-sm tabular-nums"
          />
        {/if}
        <label class="flex items-center gap-1 text-sm py-2">
          <input type="checkbox" bind:checked={newAssetLeasedOut} />
          {m.settings_asset_leased_out()}
        </label>
        <label class="flex items-center gap-1 text-sm py-2">
          <input type="checkbox" bind:checked={newAssetUsableLifeUnderOneYear} />
          {m.settings_asset_usable_life_under_one_year()}
        </label>
        <label class="flex items-center gap-1 text-sm py-2">
          <input type="checkbox" bind:checked={newAssetEssentialToBusiness} />
          {m.settings_asset_essential_to_business()}
        </label>
        {#if newAssetMethod === 'small-asset-special'}
          <label class="flex items-center gap-1 text-sm py-2">
            <input type="checkbox" bind:checked={newAssetDecliningBalanceElected} />
            {m.settings_asset_declining_balance_elected()}
          </label>
        {/if}
      </div>
      <div class="flex flex-wrap gap-2 items-center">
        <label class="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
          {m.settings_asset_lease_contract_date()}
          <input
            type="date"
            name="assetLeaseContractDate"
            autocomplete="off"
            bind:value={newAssetLeaseContractDate}
            class="px-3 h-10 bg-background border rounded text-foreground text-sm tabular-nums supports-[-webkit-touch-callout:none]:appearance-none supports-[-webkit-touch-callout:none]:w-40 [&::-webkit-date-and-time-value]:text-left"
          />
        </label>
        <input
          type="number"
          name="assetResidualGuarantee"
          autocomplete="off"
          aria-label={m.settings_asset_residual_guarantee()}
          value={newAssetResidualGuarantee}
          oninput={assignInputString((v) => (newAssetResidualGuarantee = v))}
          min="0"
          step="1"
          placeholder={m.settings_asset_residual_guarantee()}
          title={m.settings_asset_residual_guarantee()}
          class="w-48 max-w-full px-3 h-10 bg-background border rounded text-foreground text-sm tabular-nums text-right"
        />
        {#if newAssetMethod === 'lease-period-straight-line'}
          <input
            type="number"
            name="assetLeaseTermMonths"
            autocomplete="off"
            aria-label={m.settings_asset_lease_term_months()}
            value={newAssetLeaseTermMonths}
            oninput={assignInputString((v) => (newAssetLeaseTermMonths = v))}
            min="1"
            step="1"
            placeholder={m.settings_asset_lease_term_months()}
            title={m.settings_asset_lease_term_months()}
            class="w-48 max-w-full px-3 h-10 bg-background border rounded text-foreground text-sm tabular-nums text-right"
          />
        {/if}
      </div>
    </form>
    {#if newAssetMethod === 'small-asset-special'}
      {#if newAssetSmallCheck.state === 'eligible'}
        <p class="text-xs text-green-600">
          {m.settings_asset_small_eligible({
            date: newAssetDate,
            threshold: formatJPY(newAssetSmallCheck.threshold),
          })}
        </p>
      {:else if newAssetSmallCheck.state === 'cost'}
        <p class="text-xs text-destructive">
          {m.settings_asset_small_ineligible_cost({
            threshold: formatJPY(newAssetSmallCheck.threshold),
          })}
        </p>
      {:else if newAssetSmallCheck.state === 'expired'}
        <p class="text-xs text-destructive">
          {m.settings_asset_small_ineligible_expired()}
        </p>
      {/if}
    {:else if newAssetMethod === 'lump-sum'}
      {#if newAssetLumpSumEligible}
        <p class="text-xs text-green-600">{m.settings_asset_lump_sum_eligible()}</p>
      {:else}
        <p class="text-xs text-destructive">{m.settings_asset_lump_sum_ineligible()}</p>
      {/if}
    {/if}
    {#each newAssetFieldErrors as e (e.label)}
      <p class="text-xs text-destructive">{e.label}：{e.message}</p>
    {/each}
    {#if assetError}
      <div class="text-sm text-destructive">{assetError}</div>
    {/if}

    {#if ledger.fixedAssets.length > 0 && depreciationInputs.status === 'blocked'}
      <p class="text-xs text-destructive" role="alert">
        {m.settings_asset_calc_blocked({ reasons: depreciationInputs.reason })}
      </p>
    {/if}
    {#if conversionBasisNotice}
      <p class="text-xs text-amber-600" role="alert">{conversionBasisNotice}</p>
    {/if}
    {#if ledger.fixedAssets.length > 0}
      <!-- 列数が多く狭幅で溢れるため、ページ全体ではなく表だけ横スクロールさせる -->
      <ScrollX>
        <table class="w-full min-w-[720px] text-sm">
          <thead>
            <tr class="text-xs text-muted-foreground">
              <th class="text-left font-normal py-1">{m.settings_asset_th_name()}</th>
              <th class="text-left font-normal py-1">{m.settings_asset_th_date()}</th>
              <th class="text-right font-normal py-1">{m.settings_asset_th_cost()}</th>
              <th class="text-right font-normal py-1">{m.settings_asset_th_life()}</th>
              <th class="text-right font-normal py-1">{m.settings_asset_th_year_depreciation()}</th>
              <th class="text-right font-normal py-1">{m.settings_asset_th_book_value()}</th>
              <th class="py-1"></th>
            </tr>
          </thead>
          <tbody>
            {#each ledger.fixedAssets as a (a.id)}
              {@const issues = assetIssuesById.get(a.id) ?? []}
              {@const calc = assetRowCalcs.get(a.id)}
              {@const d = calc && 'amount' in calc.depreciation ? calc.depreciation : null}
              {@const estimate =
                calc?.transfer && !('error' in calc.transfer) ? calc.transfer : null}
              {@const calcErrors = [
                ...new Set(
                  [
                    calc && 'error' in calc.depreciation ? calc.depreciation.error : '',
                    calc?.transfer && 'error' in calc.transfer ? calc.transfer.error : '',
                  ].filter((t) => t !== ''),
                ),
              ]}
              <tr class="border-t border-border/50">
                <td class="py-2">
                  {a.name}
                  {#if a.disposedDate}
                    <span class="ml-1 text-xs text-muted-foreground">
                      ({a.disposalType === 'sale'
                        ? m.settings_asset_disposal_type_sale()
                        : m.settings_asset_disposal_type_scrap()}
                      {a.disposedDate})
                    </span>
                  {/if}
                  {#if issues.length > 0}
                    <span class="block text-xs text-destructive" role="alert">
                      {describeFixedAssetIssues(issues)}
                    </span>
                  {/if}
                  {#each calcErrors as calcError (calcError)}
                    <span class="block text-xs text-destructive" role="alert">{calcError}</span>
                  {/each}
                  {#if issues.length === 0 && a.conversionBasis !== undefined}
                    <span class="block text-xs text-muted-foreground">
                      {m.settings_asset_conversion_basis({
                        amount: formatJPY(depreciableCost(a)),
                        date: serviceStartDate(a),
                      })}
                    </span>
                  {/if}
                </td>
                <td class="py-2 tabular-nums text-muted-foreground">{a.acquisitionDate}</td>
                <td class="py-2 text-right tabular-nums">
                  {readStoredAmount(a.acquisitionCost) === undefined
                    ? m.common_stored_amount_unreadable()
                    : formatJPY(a.acquisitionCost)}
                </td>
                <td class="py-2 text-right tabular-nums"
                  >{m.settings_asset_life_years({ n: a.usefulLifeYears })}</td
                >
                <td class="py-2 text-right tabular-nums"
                  >{d ? formatJPY(d.amount) : m.common_dash()}</td
                >
                <td class="py-2 text-right tabular-nums text-muted-foreground"
                  >{d ? formatJPY(d.book) : m.common_dash()}</td
                >
                <td class="py-2 text-right whitespace-nowrap">
                  {#if hasComputeIssue(issues)}
                    <button
                      type="button"
                      onclick={() => startEditLife(a)}
                      class="text-xs text-primary hover:underline"
                    >
                      {m.settings_asset_fix_button()}
                    </button>
                  {/if}
                  {#if a.incomeType === 'realEstate'}
                    <button
                      type="button"
                      onclick={() => startEditProperty(a)}
                      class="text-xs text-muted-foreground hover:text-foreground"
                    >
                      {m.settings_asset_property_button()}
                    </button>
                  {/if}
                  <button
                    type="button"
                    onclick={() => startEditDisposal(a)}
                    class="ml-2 text-xs text-muted-foreground hover:text-foreground"
                  >
                    {a.disposedDate ? m.settings_action_edit() : m.settings_asset_disposal_button()}
                  </button>
                  <button
                    type="button"
                    onclick={() => askDelete(a.name, () => deleteAsset(a.id))}
                    class="ml-2 text-xs text-muted-foreground hover:text-destructive"
                  >
                    {m.settings_action_delete()}
                  </button>
                </td>
              </tr>
              {#if lifeEditId === a.id}
                <tr class="border-t border-border/50 bg-muted/30">
                  <td colspan="7" class="py-3">
                    <div class="space-y-2">
                      <p class="text-xs text-muted-foreground">{m.settings_asset_fix_intro()}</p>
                      <div class="flex flex-wrap items-end gap-2">
                        <label class="block">
                          <span class="text-xs text-muted-foreground"
                            >{m.settings_asset_life_title()}</span
                          >
                          <input
                            type="number"
                            name="assetFixUsefulLife"
                            autocomplete="off"
                            value={lifeEditYears}
                            oninput={assignInputNumberOrEmpty((v) => (lifeEditYears = v))}
                            min="1"
                            step="1"
                            class="mt-1 w-24 px-3 h-10 bg-background border rounded text-foreground text-sm tabular-nums"
                          />
                        </label>
                        {#if a.depreciationMethod === 'lease-period-straight-line'}
                          <label class="block">
                            <span class="text-xs text-muted-foreground"
                              >{m.settings_asset_lease_term_months()}</span
                            >
                            <input
                              type="number"
                              name="assetFixLeaseTermMonths"
                              autocomplete="off"
                              value={lifeEditLeaseMonths}
                              oninput={assignInputString((v) => (lifeEditLeaseMonths = v))}
                              min="1"
                              step="1"
                              class="mt-1 w-24 px-3 h-10 bg-background border rounded text-foreground text-sm tabular-nums"
                            />
                          </label>
                        {/if}
                        <button
                          type="button"
                          onclick={saveLife}
                          class="px-3 h-10 bg-primary text-primary-foreground rounded hover:opacity-90"
                        >
                          {m.settings_action_save()}
                        </button>
                        <button
                          type="button"
                          onclick={cancelEditLife}
                          class="px-3 h-10 text-sm text-muted-foreground hover:text-foreground"
                        >
                          {m.settings_action_cancel()}
                        </button>
                      </div>
                      {#if lifeEditError}
                        <p class="text-xs text-destructive">{lifeEditError}</p>
                      {/if}
                    </div>
                  </td>
                </tr>
              {/if}
              {#if propertyEditId === a.id}
                <tr class="border-t border-border/50 bg-muted/30">
                  <td colspan="7" class="py-3">
                    <div class="space-y-2">
                      <div class="grid grid-cols-1 sm:grid-cols-3 gap-2">
                        <input
                          type="text"
                          name="propertyType"
                          autocomplete="off"
                          aria-label={m.settings_asset_property_type_placeholder()}
                          bind:value={propertyType}
                          placeholder={m.settings_asset_property_type_placeholder()}
                          class="px-3 py-2 bg-background border rounded text-foreground text-sm"
                        />
                        <input
                          type="text"
                          name="propertyJusho"
                          aria-label={m.settings_asset_property_address_placeholder()}
                          autocomplete="off"
                          bind:value={propertyAddress}
                          placeholder={m.settings_asset_property_address_placeholder()}
                          class="sm:col-span-2 px-3 py-2 bg-background border rounded text-foreground text-sm"
                        />
                        <label class="flex items-center gap-1 text-sm py-2">
                          <input type="checkbox" bind:checked={propertyIsResidential} />
                          {m.settings_asset_property_residential()}
                        </label>
                        <input
                          type="text"
                          name="propertyTenantShimei"
                          aria-label={m.settings_asset_property_tenant_name_placeholder()}
                          autocomplete="off"
                          bind:value={propertyTenantName}
                          placeholder={m.settings_asset_property_tenant_name_placeholder()}
                          class="px-3 py-2 bg-background border rounded text-foreground text-sm"
                        />
                        <input
                          type="text"
                          name="propertyTenantJusho"
                          aria-label={m.settings_asset_property_tenant_address_placeholder()}
                          autocomplete="off"
                          bind:value={propertyTenantAddress}
                          placeholder={m.settings_asset_property_tenant_address_placeholder()}
                          class="px-3 py-2 bg-background border rounded text-foreground text-sm"
                        />
                        <input
                          type="date"
                          name="propertyRentalStart"
                          autocomplete="off"
                          aria-label={m.settings_asset_property_rental_start_title()}
                          bind:value={propertyRentalStart}
                          title={m.settings_asset_property_rental_start_title()}
                          class="w-full min-w-0 px-3 py-2 bg-background border rounded text-foreground text-sm tabular-nums supports-[-webkit-touch-callout:none]:appearance-none [&::-webkit-date-and-time-value]:text-left"
                        />
                        <input
                          type="date"
                          name="propertyRentalEnd"
                          autocomplete="off"
                          aria-label={m.settings_asset_property_rental_end_title()}
                          bind:value={propertyRentalEnd}
                          title={m.settings_asset_property_rental_end_title()}
                          class="w-full min-w-0 px-3 py-2 bg-background border rounded text-foreground text-sm tabular-nums supports-[-webkit-touch-callout:none]:appearance-none [&::-webkit-date-and-time-value]:text-left"
                        />
                        <input
                          type="number"
                          name="propertyMensekiSqm"
                          autocomplete="off"
                          aria-label={m.settings_asset_property_area_placeholder()}
                          value={propertyAreaSqm}
                          oninput={assignInputString((v) => (propertyAreaSqm = v))}
                          min="0"
                          placeholder={m.settings_asset_property_area_placeholder()}
                          class="px-3 py-2 bg-background border rounded text-foreground text-sm tabular-nums text-right"
                        />
                        <input
                          type="number"
                          name="propertyAnnualRent"
                          autocomplete="off"
                          aria-label={m.settings_asset_property_annual_rent_placeholder()}
                          value={propertyAnnualRent}
                          oninput={assignInputString((v) => (propertyAnnualRent = v))}
                          min="0"
                          step="1"
                          required
                          placeholder={m.settings_asset_property_annual_rent_placeholder()}
                          class="px-3 py-2 bg-background border rounded text-foreground text-sm tabular-nums text-right"
                        />
                        <input
                          type="number"
                          name="propertyKeyMoneyEtc"
                          autocomplete="off"
                          aria-label={m.settings_asset_property_key_money_placeholder()}
                          value={propertyKeyMoneyEtc}
                          oninput={assignInputString((v) => (propertyKeyMoneyEtc = v))}
                          min="0"
                          step="1"
                          placeholder={m.settings_asset_property_key_money_placeholder()}
                          class="px-3 py-2 bg-background border rounded text-foreground text-sm tabular-nums text-right"
                        />
                        <input
                          type="number"
                          name="propertyOtherIncome"
                          autocomplete="off"
                          aria-label={m.settings_asset_property_other_income_placeholder()}
                          value={propertyOtherIncome}
                          oninput={assignInputString((v) => (propertyOtherIncome = v))}
                          min="0"
                          step="1"
                          placeholder={m.settings_asset_property_other_income_placeholder()}
                          class="px-3 py-2 bg-background border rounded text-foreground text-sm tabular-nums text-right"
                        />
                        <input
                          type="number"
                          name="propertyDepositBalance"
                          autocomplete="off"
                          aria-label={m.settings_asset_property_deposit_placeholder()}
                          value={propertyDepositBalance}
                          oninput={assignInputString((v) => (propertyDepositBalance = v))}
                          min="0"
                          step="1"
                          placeholder={m.settings_asset_property_deposit_placeholder()}
                          class="px-3 py-2 bg-background border rounded text-foreground text-sm tabular-nums text-right"
                        />
                      </div>
                      {#if propertyAmountsInvalid}
                        <div class="text-xs text-destructive">{m.common_amount_invalid()}</div>
                      {/if}
                      {#if propertyError}
                        <div class="text-xs text-destructive">{propertyError}</div>
                      {/if}
                      <div class="flex gap-2">
                        <button
                          type="button"
                          onclick={saveProperty}
                          class="px-3 py-1.5 bg-primary text-primary-foreground rounded text-sm hover:opacity-90"
                        >
                          {m.settings_action_save()}
                        </button>
                        <button
                          type="button"
                          onclick={cancelEditProperty}
                          class="px-3 py-1.5 border rounded text-sm hover:bg-muted"
                        >
                          {m.settings_action_cancel()}
                        </button>
                      </div>
                    </div>
                  </td>
                </tr>
              {/if}
              {#if disposeEditId === a.id}
                <tr class="border-t border-border/50 bg-muted/30">
                  <td colspan="7" class="py-3">
                    <div class="space-y-2">
                      <div class="flex flex-wrap items-center gap-2">
                        <input
                          type="date"
                          name="disposeDate"
                          autocomplete="off"
                          aria-label={m.settings_asset_disposal_date()}
                          bind:value={disposeDate}
                          class="px-3 py-2 bg-background border rounded text-foreground text-sm tabular-nums supports-[-webkit-touch-callout:none]:appearance-none supports-[-webkit-touch-callout:none]:w-40 [&::-webkit-date-and-time-value]:text-left"
                        />
                        <label class="flex items-center gap-1 text-sm py-2">
                          <input type="radio" bind:group={disposeType} value="scrap" />
                          {m.settings_asset_disposal_type_scrap()}
                        </label>
                        <label class="flex items-center gap-1 text-sm py-2">
                          <input type="radio" bind:group={disposeType} value="sale" />
                          {m.settings_asset_disposal_type_sale()}
                        </label>
                        {#if disposeType === 'sale'}
                          <input
                            type="number"
                            name="disposeSalePrice"
                            autocomplete="off"
                            aria-label={m.settings_asset_disposal_sale_price_placeholder()}
                            value={disposeSalePrice}
                            oninput={assignInputString((v) => (disposeSalePrice = v))}
                            min="0"
                            step="1"
                            placeholder={m.settings_asset_disposal_sale_price_placeholder()}
                            class="w-36 px-3 py-2 bg-background border rounded text-foreground text-sm tabular-nums text-right"
                          />
                          <input
                            type="number"
                            name="disposeSaleKeihi"
                            autocomplete="off"
                            aria-label={m.settings_asset_disposal_sale_expenses_placeholder()}
                            value={disposeSaleExpenses}
                            oninput={assignInputString((v) => (disposeSaleExpenses = v))}
                            min="0"
                            step="1"
                            placeholder={m.settings_asset_disposal_sale_expenses_placeholder()}
                            class="w-36 px-3 py-2 bg-background border rounded text-foreground text-sm tabular-nums text-right"
                          />
                          <select
                            bind:value={disposeCashAccount}
                            name="disposeCashAccount"
                            aria-label={m.settings_asset_disposal_cash_account_title()}
                            title={m.settings_asset_disposal_cash_account_title()}
                            class="px-3 py-2 bg-background border rounded text-foreground text-sm"
                          >
                            <option value="1110">1110 現金</option>
                            <option value="1130">1130 普通預金</option>
                          </select>
                        {/if}
                      </div>
                      {#if disposeAmountsInvalid}
                        <div class="text-xs text-destructive">{m.common_amount_invalid()}</div>
                      {/if}
                      {#if disposeError}
                        <div class="text-xs text-destructive">{disposeError}</div>
                      {/if}
                      <div class="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onclick={saveDisposal}
                          class="px-3 py-1.5 bg-primary text-primary-foreground rounded text-sm hover:opacity-90"
                        >
                          {m.settings_action_save()}
                        </button>
                        <button
                          type="button"
                          onclick={cancelEditDisposal}
                          class="px-3 py-1.5 border rounded text-sm hover:bg-muted"
                        >
                          {m.settings_action_cancel()}
                        </button>
                        {#if a.disposedDate}
                          <button
                            type="button"
                            onclick={() => askClearDisposal(a.name, () => clearDisposal(a.id))}
                            class="px-3 py-1.5 text-sm text-muted-foreground hover:text-destructive"
                          >
                            {m.settings_asset_disposal_clear()}
                          </button>
                        {/if}
                      </div>
                    </div>
                  </td>
                </tr>
              {/if}
              {#if a.disposedDate && disposeEditId !== a.id}
                <tr class="border-t border-border/50 bg-muted/10">
                  <td colspan="7" class="py-2 text-xs text-muted-foreground space-y-1">
                    <div class="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onclick={() => runDisposalEntry(a.id)}
                        class="px-3 py-1 bg-primary text-primary-foreground rounded hover:opacity-90"
                      >
                        {m.settings_asset_disposal_run_button()}
                      </button>
                      {#if disposeStatus[a.id]}
                        <span>{disposeStatus[a.id]}</span>
                      {/if}
                    </div>
                    {#if estimate}
                      <p>
                        {m.settings_asset_disposal_transfer_estimate({
                          proceeds: formatJPY(estimate.proceeds),
                          acquisitionExpense: formatJPY(estimate.acquisitionExpense),
                          estimate: formatJPY(estimate.estimate),
                          years: estimate.holdingYears,
                        })}
                      </p>
                    {/if}
                  </td>
                </tr>
              {/if}
            {/each}
          </tbody>
        </table>
      </ScrollX>
    {:else}
      <p class="text-sm text-muted-foreground">{m.settings_asset_empty()}</p>
    {/if}
    {#if transferAssetsThisYear.some((a) => assetRowCalcs.get(a.id)?.transfer) || (depreciationInputs.status === 'blocked' && transferAssetsThisYear.length > 0)}
      <div class="space-y-2 pt-3 border-t border-border/50">
        <h4 class="text-sm font-semibold">
          {m.settings_transfer_income_aggregate_title({ year: depreciationYear })}
        </h4>
        <label class="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          {m.settings_transfer_income_occasional()}
          <input
            type="number"
            name="transferOccasionalIncome"
            autocomplete="off"
            value={transferOccasionalIncome}
            oninput={assignInputString((v) => (transferOccasionalIncome = v))}
            step="1"
            class="w-36 px-3 h-10 bg-background border rounded text-foreground text-sm tabular-nums text-right"
          />
        </label>
        {#if !transferIncomeAggregate}
          <p class="text-xs text-destructive" role="alert">
            {m.common_dash()}
            {#if !transferIncomeTotal.ok && transferIncomeTotal.names.length > 0}
              {m.settings_transfer_income_unavailable({
                names: transferIncomeTotal.names.join('、'),
              })}
            {/if}
          </p>
        {:else if transferOccasionalInvalid}
          <p class="text-xs text-destructive">{m.common_amount_invalid()}</p>
        {:else}
          <p class="text-xs text-muted-foreground">
            {m.settings_transfer_income_special_deduction({
              gain: formatJPY(transferIncomeAggregate.gain),
              deduction: formatJPY(transferIncomeAggregate.specialDeduction),
              shortTerm: formatJPY(transferIncomeAggregate.shortTermIncome),
              longTerm: formatJPY(transferIncomeAggregate.longTermIncome),
              half: formatJPY(transferIncomeAggregate.halfOfLongTermAndOccasional),
            })}
          </p>
        {/if}
      </div>
    {/if}

    <div class="flex flex-wrap items-end gap-3 pt-3 border-t border-border/50">
      <label class="block">
        <span class="text-xs text-muted-foreground">{m.settings_asset_target_year()}</span>
        <input
          type="number"
          name="depreciationTargetNen"
          autocomplete="off"
          value={depreciationYear}
          oninput={assignInputNumberOrEmpty((v) => {
            const y = parseIntegerInput(v === undefined ? '' : String(v), DEPRECIATION_YEAR_RANGE);
            depreciationYearInvalid = y === undefined;
            if (y !== undefined) {
              depreciationYear = y;
            }
          })}
          min="2020"
          max="2099"
          step="1"
          class="mt-1 w-24 px-3 h-10 bg-background border rounded text-foreground tabular-nums text-sm"
        />
        {#if depreciationYearInvalid}
          <span class="block mt-1 text-xs text-destructive"
            >{m.common_integer_invalid(DEPRECIATION_YEAR_RANGE)}</span
          >
        {/if}
      </label>
      <button
        type="button"
        onclick={runDepreciation}
        disabled={ledger.fixedAssets.length === 0 ||
          depreciationYearInvalid ||
          depreciationRunBlocked}
        class="px-4 h-10 bg-primary text-primary-foreground rounded hover:opacity-90 disabled:opacity-50"
      >
        {m.settings_asset_run_button()}
      </button>
      {#if depreciationStatus}
        <span class="text-sm">{depreciationStatus}</span>
      {/if}
    </div>
  </section>

  <section class="space-y-4 border rounded-lg p-6 bg-card text-card-foreground">
    <h3 class="text-lg font-semibold">{m.settings_rule_title()}</h3>
    <p class="text-xs text-muted-foreground">
      {m.settings_rule_intro()}
    </p>
    <form onsubmit={addRule} class="flex flex-wrap gap-3 items-center">
      <select
        bind:value={newRuleMatchType}
        name="ruleMatchType"
        aria-label={m.settings_rule_match_type()}
        class="px-3 h-11 bg-background border rounded text-foreground"
      >
        <option value="description-includes">{m.settings_rule_match_includes()}</option>
        <option value="vendor-name">{m.settings_rule_match_vendor()}</option>
        <option value="regex">{m.settings_rule_match_regex()}</option>
      </select>
      <input
        type="text"
        name="rulePattern"
        autocomplete="off"
        aria-label={m.settings_rule_pattern_placeholder()}
        bind:value={newRulePattern}
        required
        placeholder={m.settings_rule_pattern_placeholder()}
        class="flex-1 min-w-40 px-3 h-11 bg-background border rounded text-foreground"
      />
      <select
        bind:value={newRuleAccountCode}
        name="ruleAccount"
        aria-label={m.settings_rule_account_select()}
        required
        class="flex-1 min-w-40 px-3 h-11 bg-background border rounded text-foreground"
      >
        <option value="">{m.settings_rule_account_select()}</option>
        {#each accountGroups as group (group.category)}
          <optgroup label={group.label}>
            {#each group.items as a (a.code)}
              <option value={a.code}>{a.code} {a.name}</option>
            {/each}
          </optgroup>
        {/each}
      </select>
      <input
        type="number"
        name="rulePriority"
        autocomplete="off"
        aria-label={m.settings_rule_priority_title()}
        value={newRulePriority}
        oninput={assignInputNumberOrEmpty((v) => (newRulePriority = v))}
        min="0"
        step="1"
        title={m.settings_rule_priority_title()}
        class="w-20 px-3 h-11 bg-background border rounded text-foreground tabular-nums"
      />
      <button
        type="submit"
        class="ml-auto px-4 h-11 bg-primary text-primary-foreground rounded hover:opacity-90"
      >
        {m.settings_action_add()}
      </button>
    </form>
    {#if ruleError}
      <div class="text-sm text-destructive">{ruleError}</div>
    {/if}
    {#if ledger.parserRules.length > 0}
      <ul class="space-y-1">
        {#each ledger.parserRules as r (r.id)}
          <li
            class="flex flex-wrap gap-3 items-center border rounded px-3 py-2 bg-background text-sm"
          >
            <span class="text-xs text-muted-foreground">{matchTypeLabel(r.matchType)}</span>
            <span class="font-mono flex-1 min-w-32 break-all">{r.pattern}</span>
            <span class="font-mono text-xs text-muted-foreground">→ {r.accountCode}</span>
            <span class="text-xs text-muted-foreground tabular-nums"
              >{m.settings_rule_priority_short({ n: r.priority })}</span
            >
            <span class="text-xs text-muted-foreground tabular-nums"
              >{m.settings_rule_hits({ n: r.hitCount })}</span
            >
            <button
              type="button"
              onclick={() => askDelete(r.pattern, () => deleteRule(r.id))}
              class="ml-auto text-xs text-muted-foreground hover:text-destructive"
            >
              {m.settings_action_delete()}
            </button>
          </li>
        {/each}
      </ul>
    {:else}
      <p class="text-sm text-muted-foreground">{m.settings_rule_empty()}</p>
    {/if}
  </section>

  <section class="space-y-4 border rounded-lg p-6 bg-card text-card-foreground">
    <h3 class="text-lg font-semibold">{m.settings_account_title()}</h3>
    <p class="text-xs text-muted-foreground">
      {m.settings_account_intro()}
    </p>
    {#each allAccountGroups as group (group.category)}
      <details class="border rounded">
        <summary class="cursor-pointer px-3 py-2 text-sm font-medium">
          {group.label}
          <span class="text-xs text-muted-foreground ml-2">
            {m.settings_account_active_count({
              active: group.items.filter((a) => a.isActive !== false).length,
              total: group.items.length,
            })}
          </span>
        </summary>
        <ul class="border-t divide-y divide-border/50">
          {#each group.items as a (a.code)}
            <li class="flex items-center justify-between px-3 py-2 text-sm">
              <span>
                <span class="font-mono text-xs text-muted-foreground mr-2">{a.code}</span>
                <span
                  class:line-through={a.isActive === false}
                  class:opacity-50={a.isActive === false}
                >
                  {a.name}
                </span>
              </span>
              <label class="flex items-center gap-2 cursor-pointer text-xs py-2">
                <input
                  type="checkbox"
                  checked={a.isActive !== false}
                  onchange={() => toggleAccountActive(a)}
                />
                {m.settings_account_active_label()}
              </label>
            </li>
          {/each}
        </ul>
      </details>
    {/each}
  </section>

  <section class="space-y-4 border rounded-lg p-6 bg-card text-card-foreground">
    <h3 class="text-lg font-semibold">{m.settings_llm_title()}</h3>
    <p class="text-xs text-muted-foreground">
      {@html m.settings_llm_intro_html()}
    </p>

    <label class="block">
      <span class="text-xs text-muted-foreground">{m.settings_engine_label()}</span>
      <select
        bind:value={aiEngine}
        name="aiEngine"
        class="mt-1 w-full px-3 py-2 bg-background border rounded text-foreground text-sm"
      >
        <option value="gemini">{m.settings_engine_gemini()}</option>
        <option value="openai-compatible">{m.settings_engine_openai()}</option>
        <!-- 1/4 は利用者側でどうにもならないので選択肢ごと隠す。2/3/5 は選び直せるので
             disabled で残し、下に理由を出す。__NATIVE__ で畳むのは web のビルド成果物に
             この経路の文言を残さないため。 -->
        {#if appleAiOptionShown}
          <option value="apple-ai" disabled={appleAiAvailability !== 0}>
            {m.settings_engine_apple_ai()}
          </option>
        {/if}
        {#if chromeAiOptionShown}
          <option value="chrome-ai">{m.settings_engine_chrome_ai()}</option>
        {/if}
        {#if strandedAiEngine}
          <!-- 選択肢の無い値が保存に残っている（他環境の復元・選べなくなった旧値等）。
               空欄に見せず、生値のまま disabled で見せて理由を出す。 -->
          <option value={strandedAiEngine} disabled>
            {m.settings_engine_stranded({ value: strandedAiEngine })}
          </option>
        {/if}
      </select>
    </label>

    <div class="border-t pt-4 space-y-3">
      {#if __NATIVE__ && appleAiAvailability !== null && appleAiAvailability in APPLE_AI_UNAVAILABLE_MESSAGES}
        <p class="text-xs text-destructive">
          {APPLE_AI_UNAVAILABLE_MESSAGES[appleAiAvailability]?.()}
        </p>
      {/if}

      {#if aiEngine === 'gemini'}
        <p class="text-xs text-muted-foreground">
          {@html m.settings_llm_gemini_byok_html()}
        </p>
        <div class="space-y-3">
          <label class="block">
            <span class="text-xs text-muted-foreground">{m.settings_llm_key_label()}</span>
            <input
              type="password"
              name="geminiApiKey"
              autocomplete="off"
              bind:value={geminiKey}
              placeholder="AIza..."
              class="mt-1 w-full px-3 h-11 bg-background border rounded text-foreground font-mono text-sm"
            />
          </label>
          <div class="flex gap-3">
            <button
              type="button"
              onclick={saveGeminiKey}
              class="px-4 h-11 bg-primary text-primary-foreground rounded hover:opacity-90"
            >
              {m.settings_llm_fetch_models()}
            </button>
            <button
              type="button"
              onclick={testGeminiKey}
              disabled={!geminiKey.trim()}
              class="px-4 h-11 border rounded hover:bg-accent disabled:opacity-50"
            >
              {m.settings_llm_test()}
            </button>
          </div>
        </div>
        <div class="space-y-1 text-xs">
          {#if geminiKeySaved}
            <p>{geminiKeySaved}</p>
          {/if}
          {#if geminiTestStatus}
            <p>
              {#if geminiTestFailed}
                <span class="text-destructive" aria-hidden="true">⚠</span>
              {/if}
              {geminiTestStatus}
            </p>
          {/if}
        </div>

        <label class="block">
          <span class="text-xs text-muted-foreground">{m.settings_llm_model_label()}</span>
          {#if geminiModels.length > 0}
            <select
              bind:value={geminiModel}
              name="geminiModelSelect"
              onchange={saveGeminiModel}
              class="mt-1 w-full px-3 h-11 bg-background border rounded text-foreground text-sm"
            >
              {#each geminiModels as model (model)}
                <option value={model}>{model}</option>
              {/each}
            </select>
          {:else}
            <input
              type="text"
              name="geminiModelMei"
              autocomplete="off"
              readonly
              bind:value={geminiModel}
              placeholder={m.settings_llm_model_fetch_hint()}
              class="mt-1 w-full px-3 h-11 bg-muted text-muted-foreground border rounded font-mono text-sm cursor-default"
            />
          {/if}
        </label>
        <p class="text-xs text-muted-foreground">{m.settings_llm_model_test_notice()}</p>
      {/if}

      {#if __NATIVE__ && aiEngine === 'apple-ai'}
        <p class="text-xs text-muted-foreground">{m.settings_apple_ai_intro()}</p>
        <!-- 米国外へ配る物には記号を付けず、この帰属表示を出す（Apple の第三者向け規定）。 -->
        <p class="text-[10px] text-muted-foreground">{m.settings_apple_ai_trademark()}</p>
      {/if}

      {#if aiEngine === 'openai-compatible'}
        <p class="text-xs text-muted-foreground">
          {@html m.settings_openai_intro_html()}
        </p>
        <label class="block">
          <span class="text-xs text-muted-foreground">{m.settings_openai_baseurl_label()}</span>
          <input
            type="text"
            name="openaiBaseUrl"
            autocomplete="off"
            bind:value={openaiBaseUrl}
            placeholder="http://localhost:11434/v1"
            class="mt-1 w-full px-3 py-2 bg-background border rounded text-foreground font-mono text-sm"
          />
        </label>
        <label class="block">
          <span class="text-xs text-muted-foreground">{m.settings_openai_apikey_label()}</span>
          <input
            type="password"
            name="openaiApiKey"
            autocomplete="off"
            bind:value={openaiApiKey}
            placeholder={m.settings_openai_apikey_placeholder()}
            class="mt-1 w-full px-3 py-2 bg-background border rounded text-foreground font-mono text-sm"
          />
        </label>
        <div class="flex gap-3 items-end">
          <button
            type="button"
            onclick={fetchOpenaiModels}
            disabled={!openaiBaseUrl.trim()}
            class="px-4 py-2 border rounded hover:bg-accent disabled:opacity-50"
          >
            {m.settings_llm_fetch_models()}
          </button>
          <button
            type="button"
            onclick={testOpenai}
            disabled={!openaiBaseUrl.trim()}
            class="px-4 py-2 border rounded hover:bg-accent disabled:opacity-50"
          >
            {m.settings_llm_test()}
          </button>
        </div>
        <label class="block">
          <span class="text-xs text-muted-foreground">{m.settings_openai_ocr_model_label()}</span>
          {#if openaiModels.length > 0}
            <select
              bind:value={openaiOcrModel}
              name="openaiOcrModelSelect"
              class="mt-1 w-full px-3 py-2 bg-background border rounded text-foreground text-sm"
            >
              <option value="">—</option>
              {#each openaiModels as mdl (mdl)}
                <option value={mdl}>{mdl}</option>
              {/each}
            </select>
          {:else}
            <input
              type="text"
              name="openaiOcrModelMei"
              autocomplete="off"
              readonly
              bind:value={openaiOcrModel}
              placeholder={m.settings_llm_model_fetch_hint()}
              class="mt-1 w-full px-3 py-2 bg-muted text-muted-foreground border rounded font-mono text-sm cursor-default"
            />
          {/if}
        </label>
        <label class="block">
          <span class="text-xs text-muted-foreground"
            >{m.settings_openai_classify_model_label()}</span
          >
          {#if openaiModels.length > 0}
            <select
              bind:value={openaiClassifyModel}
              name="openaiClassifyModelSelect"
              class="mt-1 w-full px-3 py-2 bg-background border rounded text-foreground text-sm"
            >
              <option value="">—</option>
              {#each openaiModels as mdl (mdl)}
                <option value={mdl}>{mdl}</option>
              {/each}
            </select>
          {:else}
            <input
              type="text"
              name="openaiClassifyModelMei"
              autocomplete="off"
              readonly
              bind:value={openaiClassifyModel}
              placeholder={m.settings_llm_model_fetch_hint()}
              class="mt-1 w-full px-3 py-2 bg-muted text-muted-foreground border rounded font-mono text-sm cursor-default"
            />
          {/if}
        </label>
      {/if}

      <div>
        <button
          type="button"
          onclick={saveOcrEngine}
          class="px-4 py-2 bg-primary text-primary-foreground rounded hover:opacity-90"
        >
          {m.settings_llm_save()}
        </button>
      </div>
      <div class="space-y-1 text-xs">
        {#if openaiSaved}
          <p>{openaiSaved}</p>
        {/if}
        {#if openaiStatus}
          <p>
            {#if openaiTestFailed}
              <span class="text-destructive" aria-hidden="true">⚠</span>
            {/if}
            {openaiStatus}
          </p>
        {/if}
      </div>
    </div>
  </section>

  <div bind:this={backupSection} class="scroll-mt-20">
    <BackupPanel />
  </div>

  <section class="space-y-4 border rounded-lg p-6 bg-card text-card-foreground">
    <h3 class="text-lg font-semibold">{m.settings_accountant_export_title()}</h3>
    <p class="text-xs text-muted-foreground">
      {m.settings_accountant_export_intro({ year: currentYear })}
    </p>
    <div class="flex flex-wrap gap-2">
      <button
        type="button"
        onclick={downloadYayoiCsv}
        disabled={currentYearInvalid}
        class="px-4 py-2 bg-primary text-primary-foreground rounded hover:opacity-90 disabled:opacity-50"
      >
        {m.settings_accountant_export_yayoi()}
      </button>
      <button
        type="button"
        onclick={downloadGenericCsv}
        disabled={currentYearInvalid}
        class="px-4 py-2 border rounded hover:bg-accent disabled:opacity-50"
      >
        {m.settings_accountant_export_generic()}
      </button>
      <button
        type="button"
        onclick={downloadCorrectionHistoryCsv}
        disabled={currentYearInvalid}
        class="px-4 py-2 border rounded hover:bg-accent disabled:opacity-50"
      >
        {m.settings_accountant_export_corrections()}
      </button>
      {#if currentYearInvalid}
        <span class="self-center text-xs text-destructive"
          >{m.common_integer_invalid({ min: 2020, max: 2099 })}</span
        >
      {/if}
    </div>
    <p class="text-xs text-muted-foreground border-t pt-2">
      {m.settings_accountant_export_disclaimer()}
    </p>
    {#if accountantExportError}
      <div class="text-sm text-destructive">{accountantExportError}</div>
    {/if}
  </section>

  <section class="space-y-4 border rounded-lg p-6 bg-card text-card-foreground">
    <h3 class="text-lg font-semibold">{m.settings_qualified_book_title()}</h3>
    <p class="text-xs text-muted-foreground">
      {@html m.settings_qualified_book_intro_html()}
    </p>
    <ul class="space-y-2 text-sm">
      <li>
        <div class="font-medium">{m.settings_qualified_book_req1()}</div>
        <div class="text-xs text-muted-foreground">{m.settings_qualified_book_req1_status()}</div>
      </li>
      <li>
        <div class="font-medium">{m.settings_qualified_book_req2()}</div>
        <div class="text-xs text-muted-foreground">{m.settings_qualified_book_req2_status()}</div>
      </li>
      <li>
        <div class="font-medium">{m.settings_qualified_book_req3()}</div>
        <div class="text-xs text-muted-foreground">{m.settings_qualified_book_req3_status()}</div>
      </li>
      <li>
        <div class="font-medium">{m.settings_qualified_book_req4()}</div>
        <div class="text-xs text-muted-foreground">{m.settings_qualified_book_req4_status()}</div>
      </li>
    </ul>
    <p class="text-xs text-muted-foreground border-t pt-2">
      {@html m.settings_qualified_book_caveat_html()}
    </p>
  </section>

  <section
    bind:this={restoreSection}
    class="space-y-4 border rounded-lg p-6 bg-card text-card-foreground"
  >
    <h3 class="text-lg font-semibold">{m.settings_restore_title()}</h3>
    <p class="text-xs text-muted-foreground">
      {@html m.settings_restore_intro_html()}
    </p>
    {#if backup.canRead}
      <div class="space-y-1">
        <button
          type="button"
          onclick={handleRestoreFromFolder}
          disabled={restoringFromFolder}
          class="px-4 py-2 border rounded hover:bg-accent hover:text-accent-foreground disabled:opacity-50"
        >
          {m.settings_restore_folder()}
        </button>
        <p class="text-xs text-muted-foreground">{m.settings_restore_folder_hint()}</p>
        {#if restoringFromFolder && restoreProgressTotal > 0}
          <p class="text-xs text-muted-foreground">
            {m.settings_restore_folder_progress({
              done: restoreProgressDone,
              total: restoreProgressTotal,
            })}
          </p>
        {/if}
      </div>
    {/if}
    <FilePicker accept=".zip,application/zip,.json,application/json" onchange={handleRestoreFile} />
    {#if restoreFileName}
      <p class="text-xs text-muted-foreground">
        {m.settings_restore_selected({ name: restoreFileName })}
      </p>
    {/if}
    {#if restoreError}
      <div class="text-sm text-destructive">{restoreError}</div>
    {/if}
    {#if restoreSuccess}
      <div class="text-sm text-foreground border border-primary bg-primary/10 rounded px-3 py-2">
        ✓ {restoreSuccess}
      </div>
    {/if}
    {#if restoreOversized}
      <div
        class="text-sm text-foreground border border-destructive bg-destructive/10 rounded px-3 py-2"
        role="alert"
      >
        ⚠ {restoreOversized}
      </div>
    {/if}
    {#if restoreWarning}
      <div
        class="text-sm text-foreground border border-destructive bg-destructive/10 rounded px-3 py-2"
      >
        ⚠ {restoreWarning}
      </div>
    {/if}
    {#if restorePayload}
      <div class="text-xs text-muted-foreground">
        {m.settings_restore_summary({
          version: restorePayload.version,
          tables: Object.keys(restorePayload.tables).length,
          rows: Object.values(restorePayload.tables).reduce((s, t) => s + t.length, 0),
        })}
      </div>
      {#if restoreAttachmentCount > 0}
        <div class="text-xs text-muted-foreground">
          {m.settings_restore_summary_attachments({ count: restoreAttachmentCount })}
        </div>
      {/if}
      <button
        bind:this={restoreApplyButton}
        type="button"
        onclick={() => (confirmingRestore = true)}
        class="px-4 py-2 bg-destructive text-destructive-foreground rounded hover:opacity-90"
      >
        {m.settings_restore_apply()}
      </button>
    {/if}
  </section>

  <section class="space-y-4 border rounded-lg p-6 bg-card text-card-foreground">
    <h3 class="text-lg font-semibold">{m.settings_disclaimer_title()}</h3>
    {#if disclaimerAcceptedAt}
      <p class="text-sm">
        {m.settings_disclaimer_accepted({
          date: toISODateLocal(new Date(disclaimerAcceptedAt)),
          version: disclaimerAcceptedVersion ?? 0,
        })}
      </p>
      <div class="text-xs text-muted-foreground">
        {m.settings_disclaimer_full_text_label()}
        <PolicyDocViewer
          docs={[
            { doc: 'DISCLAIMER', label: 'DISCLAIMER.md' },
            { doc: 'THIRD_PARTY', label: 'THIRD_PARTY_LICENSES.txt' },
          ]}
        />
      </div>
      <div>
        <button
          type="button"
          onclick={revokeDisclaimer}
          class="px-4 py-2 border rounded text-destructive hover:bg-destructive/10"
        >
          {m.settings_disclaimer_revoke()}
        </button>
      </div>
    {:else}
      <p class="text-sm text-muted-foreground">{m.settings_disclaimer_not_accepted()}</p>
    {/if}
  </section>

  <section class="space-y-4 border rounded-lg p-6 bg-card text-card-foreground">
    <h3 class="text-lg font-semibold">{m.settings_home_office_title()}</h3>
    <p class="text-xs text-muted-foreground">{m.settings_home_office_intro()}</p>
    {#if Object.keys(homeOfficeRatios).length === 0}
      <p class="text-sm text-muted-foreground">{m.settings_home_office_empty()}</p>
    {:else}
      <ul class="space-y-1 text-sm">
        {#each Object.entries(homeOfficeRatios) as [code, ratio] (code)}
          <li class="flex items-center gap-3">
            <span>{accountLabel(code)}</span>
            <span class="tabular-nums text-muted-foreground">{ratio}</span>
            <button
              type="button"
              onclick={() => removeHomeOfficeRatio(code)}
              class="text-xs text-destructive hover:underline"
            >
              {m.settings_action_delete()}
            </button>
          </li>
        {/each}
      </ul>
    {/if}
    <form
      onsubmit={(e) => {
        e.preventDefault();
        addHomeOfficeRatio();
      }}
      class="flex flex-wrap gap-2 items-center"
    >
      <select
        bind:value={hoRatioAccount}
        name="homeOfficeAccount"
        aria-label={m.journal_form_account_select()}
        class="px-3 h-9 bg-background border rounded text-foreground text-sm"
      >
        <option value="">{m.journal_form_account_select()}</option>
        {#each expenseAccounts as a (a.code)}
          <option value={a.code}>{a.code} {a.name}</option>
        {/each}
      </select>
      <input
        type="number"
        name="homeOfficeRatio"
        autocomplete="off"
        aria-label={m.settings_home_office_title()}
        value={hoRatioValue}
        oninput={(e) => {
          hoRatioValue = (e.target as HTMLInputElement).value;
        }}
        min="0.01"
        max="0.99"
        step="0.01"
        placeholder="0.30"
        class="w-24 px-3 h-9 bg-background border rounded text-foreground text-sm tabular-nums"
      />
      <button
        type="submit"
        class="px-3 h-9 bg-primary text-primary-foreground rounded text-sm hover:opacity-90"
      >
        {m.settings_action_add()}
      </button>
    </form>
    {#if hoRatioError}
      <p class="text-xs text-destructive">{hoRatioError}</p>
    {/if}
  </section>

  <section class="space-y-4 border rounded-lg p-6 bg-card text-card-foreground">
    <h3 class="text-lg font-semibold">{m.settings_data_title()}</h3>
    <p class="text-xs text-muted-foreground">
      {nativeBridge() ? m.settings_data_intro_native() : m.settings_data_intro()}
    </p>
    <div>
      <button
        type="button"
        onclick={() => (confirmingClear = true)}
        class="px-4 py-2 bg-destructive text-destructive-foreground rounded hover:opacity-90"
      >
        {m.settings_data_clear_button()}
      </button>
    </div>
  </section>
  {#if __DOC_PREVIEW__}
    <section class="space-y-4 border border-dashed rounded-lg p-6 bg-card text-card-foreground">
      <h3 class="text-lg font-semibold">開発用：プレビュー対象</h3>
      <p class="text-xs text-muted-foreground">
        手引き・免責事項・プライバシーポリシー・セキュリティ方針と、画面の文言・選択肢をどの配布形態向けに表示するか。見た目の確認用で、ネイティブ専用の機能は動かない。dev
        server でのみ表示される。
      </p>
      <select
        value={devDocPreviewPlatform}
        name="docPreviewPlatform"
        aria-label="プレビュー対象"
        onchange={onDocPreviewPlatformChange}
        class="px-3 h-9 bg-background border rounded text-foreground text-sm"
      >
        {#each PLATFORMS as p (p)}
          <option value={p}>{DOC_PREVIEW_LABELS[p]}</option>
        {/each}
      </select>
    </section>
  {/if}
  {#if canSupport}
    <div class="text-center">
      <button
        type="button"
        onclick={() => (supportOpen = true)}
        class="px-4 py-2 border rounded hover:bg-accent"
      >
        {m.support_open()}
      </button>
    </div>
  {/if}
  <p class="text-center text-xs text-muted-foreground">
    aoiko v{__APP_VERSION__} ({__APP_COMMIT__})
  </p>
</div>

{#if canSupport && SupportDialog}
  {#await SupportDialog then Dialog}
    <Dialog open={supportOpen} onclose={() => (supportOpen = false)} />
  {/await}
{/if}

<AlertDialog.Root
  open={confirmingFilingType}
  onOpenChange={(o: boolean) => {
    if (!o) {
      cancelFilingTypeChange();
    }
  }}
>
  <AlertDialog.Content>
    <AlertDialog.Header>
      <AlertDialog.Title>{m.settings_filing_type_confirm_title()}</AlertDialog.Title>
      <AlertDialog.Description>
        {pendingFilingType === 'white'
          ? m.settings_filing_type_confirm_to_white()
          : m.settings_filing_type_confirm_to_blue()}
      </AlertDialog.Description>
    </AlertDialog.Header>
    <AlertDialog.Footer>
      <AlertDialog.Cancel onclick={cancelFilingTypeChange}>{m.common_cancel()}</AlertDialog.Cancel>
      <AlertDialog.Action onclick={applyFilingTypeChange}>
        {m.settings_filing_type_confirm_action()}
      </AlertDialog.Action>
    </AlertDialog.Footer>
  </AlertDialog.Content>
</AlertDialog.Root>

<AlertDialog.Root bind:open={confirmingClear}>
  <AlertDialog.Content>
    <AlertDialog.Header>
      <AlertDialog.Title>{m.settings_clear_confirm_title()}</AlertDialog.Title>
      <AlertDialog.Description>
        {nativeBridge() ? m.settings_clear_confirm_desc_native() : m.settings_clear_confirm_desc()}
      </AlertDialog.Description>
    </AlertDialog.Header>
    <AlertDialog.Footer>
      <AlertDialog.Cancel>{m.common_cancel()}</AlertDialog.Cancel>
      <AlertDialog.Action
        onclick={clearAll}
        class="bg-destructive text-destructive-foreground hover:bg-destructive/90"
      >
        {m.settings_clear_confirm_action()}
      </AlertDialog.Action>
    </AlertDialog.Footer>
  </AlertDialog.Content>
</AlertDialog.Root>

<AlertDialog.Root bind:open={confirmingRestore}>
  <AlertDialog.Content>
    <AlertDialog.Header>
      <AlertDialog.Title>{m.settings_restore_confirm_title()}</AlertDialog.Title>
      <AlertDialog.Description>
        {m.settings_restore_confirm_desc()}
      </AlertDialog.Description>
    </AlertDialog.Header>
    <AlertDialog.Footer>
      <AlertDialog.Cancel>{m.common_cancel()}</AlertDialog.Cancel>
      <AlertDialog.Action
        onclick={confirmRestore}
        class="bg-destructive text-destructive-foreground hover:bg-destructive/90"
      >
        {m.settings_restore_confirm_action()}
      </AlertDialog.Action>
    </AlertDialog.Footer>
  </AlertDialog.Content>
</AlertDialog.Root>

<AlertDialog.Root bind:open={confirmingDelete}>
  <AlertDialog.Content>
    <AlertDialog.Header>
      <AlertDialog.Title>{pendingConfirm?.title}</AlertDialog.Title>
      <AlertDialog.Description>{pendingConfirm?.desc}</AlertDialog.Description>
    </AlertDialog.Header>
    <AlertDialog.Footer>
      <AlertDialog.Cancel>{m.common_cancel()}</AlertDialog.Cancel>
      <AlertDialog.Action
        onclick={runPendingConfirm}
        class="bg-destructive text-destructive-foreground hover:bg-destructive/90"
      >
        {pendingConfirm?.action}
      </AlertDialog.Action>
    </AlertDialog.Footer>
  </AlertDialog.Content>
</AlertDialog.Root>
