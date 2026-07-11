<script lang="ts">
  import { onMount } from 'svelte';
  import { link } from '../router.svelte';
  import { db } from '../db';
  import { newId } from '../lib/id';
  import { toISODateLocal, todayISO } from '../lib/date';
  import { exceedsLimit, formatBytes, MAX_BACKUP_BYTES } from '../lib/file-limit';
  import { DISCLAIMER_VERSION, deleteSetting, getSetting, setSetting } from '../lib/settings';
  import { m } from '../paraglide/messages';
  import { getLocale, setLocale, locales, type Locale } from '../paraglide/runtime';
  import { ledger } from '../stores/ledger.svelte';
  import { parseBackupFile, restoreFromPayload } from '../domain/restore';
  import {
    exportCorrectionHistoryCsv,
    exportGenericCsv,
    exportYayoiCsv,
  } from '../domain/accountant-export';
  import {
    computeDepreciation,
    generateYearEndDepreciation,
  } from '../domain/depreciation';
  import {
    estimateTransferIncome,
    generateDisposalEntry,
  } from '../domain/asset-disposal';
  import {
    applyCarryover,
    computeCarryover,
    removeCarryover,
    type CarryoverPreview,
  } from '../domain/carryover';
  import {
    SMALL_ASSET_EXPIRY,
    isLumpSumEligible,
    isSmallAssetEligible,
    smallAssetThreshold,
  } from '../tax-schema/2026/limits';
  import { formatJPY } from '../lib/decimal';
  import BackupPanel from '../components/BackupPanel.svelte';
  import { DEFAULT_INVOICE_PREFIX, DEFAULT_QUOTE_PREFIX } from '../domain/invoice';
  import * as AlertDialog from '$lib/components/ui/alert-dialog';
  import type {
    Account,
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
  import { simplifiedTaxCategoryLabel, type SimplifiedTaxCategory } from '../tax-schema/2026/simplified-tax';
  import type { AoiroDeductionKind } from '../tax-schema/2026/aoiro-deduction';
  import type { FilingType } from '../tax-schema/2026/xtx';
  import {
    isValidZeimushoCode,
    searchZeimusho,
    zeimushoName,
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
  let userBusinessName = $state('');
  let userInvoiceNumber = $state('');
  let skipAttachmentConfirm = $state(false);
  let basicSaved = $state(false);
  let confirmingClear = $state(false);
  let confirmingRestore = $state(false);
  let restorePayload = $state<Awaited<ReturnType<typeof parseBackupFile>>['payload'] | null>(null);
  let restoreAttachmentCount = $state(0);
  let restoreAttachmentBlobs: Map<string, Uint8Array> = new Map();
  let restoreFileName = $state('');
  let restoreError = $state('');
  let restoreSuccess = $state('');
  let restoreWarning = $state('');

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
  let newRulePriority = $state(10);
  let ruleError = $state('');

  let newAssetName = $state('');
  let newAssetDate = $state(todayISO());
  let newAssetCost = $state('');
  let newAssetLife = $state(4);
  let newAssetAccount = $state('1510');
  let newAssetMethod = $state<DepreciationMethod>('straight-line');
  let newAssetIncomeType = $state<IncomeType>('business');
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
  let depreciationYear = $state(new Date().getFullYear());
  let depreciationStatus = $state('');
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
  let ocrEngine = $state<'gemini' | 'openai-compatible' | 'tesseract'>('gemini');
  let openaiBaseUrl = $state('');
  let tesseractLangPath = $state('');
  let openaiOcrModel = $state('');
  let openaiClassifyModel = $state('');
  let openaiApiKey = $state('');
  let openaiModels = $state<string[]>([]);
  let openaiStatus = $state('');
  let openaiSaved = $state('');

  let carryoverPreview = $state<CarryoverPreview | null>(null);
  let carryoverStatus = $state('');
  let carryoverError = $state('');

  let disclaimerAcceptedAt = $state<number | null>(null);
  let disclaimerAcceptedVersion = $state<number | null>(null);

  let taxRegistration = $state<TaxRegistration>('tax-free');
  let taxFilingMethod = $state<TaxFilingMethod>('general');
  let simplifiedTaxCategory = $state<SimplifiedTaxCategory>(4);
  let consumptionTaxAttributionMethod = $state<'individual' | 'proportional'>('proportional');
  let consumptionTaxSaved = $state(false);
  // 申告者情報（e-Tax 提出用）
  let userRiyoshaId = $state('');
  let userFilerName = $state('');
  let userFilerZip = $state('');
  let userFilerAddress = $state('');
  let userZeimushoCode = $state('');
  let userZeimushoName = $state('');
  let filingType = $state<FilingType>('blue');
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
  async function runPendingConfirm() {
    confirmingDelete = false;
    await pendingConfirm?.run();
  }
  let aoiroDeductionKind = $state<AoiroDeductionKind>('electronic');
  let filerSaved = $state(false);
  const zeimushoCodeInvalid = $derived(
    userZeimushoCode.trim() !== '' && !isValidZeimushoCode(userZeimushoCode)
  );
  // 税務署サジェスト（署名・コードで検索 → コード+署名を確定）
  let zeimushoQuery = $state('');
  let zeimushoOpen = $state(false);
  const zeimushoResults = $derived(zeimushoOpen ? searchZeimusho(zeimushoQuery) : []);
  function displayZeimusho(code: string, name: string): string {
    if (!code) {
      return '';
    }
    return name ? `${name}（${code}）` : code;
  }
  function selectZeimusho(e: ZeimushoEntry): void {
    userZeimushoCode = e.code;
    userZeimushoName = e.name;
    zeimushoQuery = displayZeimusho(e.code, e.name);
    zeimushoOpen = false;
  }
  function onZeimushoInput(value: string): void {
    zeimushoQuery = value;
    zeimushoOpen = true;
    // 5桁コードを直接入力した場合は確定（署名は master から補完）
    const code = value.trim();
    if (/^\d{5}$/.test(code) && isValidZeimushoCode(code)) {
      userZeimushoCode = code;
      userZeimushoName = zeimushoName(code) ?? '';
    } else {
      userZeimushoCode = '';
      userZeimushoName = '';
    }
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
      (a, b) => a.account.displayOrder - b.account.displayOrder
    );
  });

  const allAccountGroups = $derived.by(() => {
    type G = { category: string; label: string; items: Account[] };
    const groups: G[] = [];
    const order: Account['category'][] = [
      'asset',
      'liability',
      'equity',
      'revenue',
      'expense',
    ];
    for (const key of order) {
      const items = ledger.allAccounts.filter((a) => a.category === key);
      if (items.length > 0) {
        groups.push({ category: key, label: categoryLabel(key), items });
      }
    }
    return groups;
  });

  onMount(async () => {
    currentYear = (await getSetting('currentYear')) ?? 2026;
    userBusinessName = (await getSetting('userBusinessName')) ?? '';
    userInvoiceNumber = (await getSetting('userInvoiceNumber')) ?? '';
    invoiceNumberPrefix = (await getSetting('invoiceNumberPrefix')) ?? DEFAULT_INVOICE_PREFIX;
    quoteNumberPrefix = (await getSetting('quoteNumberPrefix')) ?? DEFAULT_QUOTE_PREFIX;
    geminiKey = (await getSetting('geminiApiKey')) ?? '';
    ocrEngine = (await getSetting('ocrEngine')) ?? 'gemini';
    openaiBaseUrl = (await getSetting('openaiBaseUrl')) ?? '';
    tesseractLangPath = (await getSetting('tesseractLangPath')) ?? '';
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
    userRiyoshaId = (await getSetting('userRiyoshaId')) ?? '';
    userFilerName = (await getSetting('userFilerName')) ?? '';
    userFilerZip = (await getSetting('userFilerZip')) ?? '';
    userFilerAddress = (await getSetting('userFilerAddress')) ?? '';
    userZeimushoCode = (await getSetting('userZeimushoCode')) ?? '';
    userZeimushoName = (await getSetting('userZeimushoName')) ?? '';
    zeimushoQuery = displayZeimusho(userZeimushoCode, userZeimushoName);
    filingType = (await getSetting('filingType')) ?? 'blue';
    aoiroDeductionKind = (await getSetting('aoiroDeductionKind')) ?? 'electronic';
    skipAttachmentConfirm = (await getSetting('skipAttachmentConfirm')) ?? false;
  });

  async function saveConsumptionTax() {
    await setSetting('taxRegistration', taxRegistration);
    await setSetting('taxFilingMethod', taxFilingMethod);
    await setSetting('simplifiedTaxCategory', simplifiedTaxCategory);
    await setSetting('consumptionTaxAttributionMethod', consumptionTaxAttributionMethod);
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
    pendingFilingType = null;
    confirmingFilingType = false;
  }

  function cancelFilingTypeChange() {
    pendingFilingType = null;
    confirmingFilingType = false;
  }

  async function saveFiler(e: Event) {
    e.preventDefault();
    if (zeimushoCodeInvalid) {
      return;
    }
    await setSetting('userRiyoshaId', userRiyoshaId.trim());
    await setSetting('userFilerName', userFilerName.trim());
    await setSetting('userFilerZip', userFilerZip.replace(/[^0-9]/g, ''));
    await setSetting('userFilerAddress', userFilerAddress.trim());
    await setSetting('userZeimushoCode', userZeimushoCode.trim());
    await setSetting('userZeimushoName', userZeimushoName.trim());
    await setSetting('filingType', filingType);
    await setSetting('aoiroDeductionKind', aoiroDeductionKind);
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
    await setSetting('currentYear', currentYear);
    await setSetting('userBusinessName', userBusinessName);
    await setSetting('userInvoiceNumber', userInvoiceNumber);
    await setSetting('invoiceNumberPrefix', invoiceNumberPrefix);
    await setSetting('quoteNumberPrefix', quoteNumberPrefix);
    basicSaved = true;
    setTimeout(() => {
      basicSaved = false;
    }, 2000);
  }

  async function clearAll() {
    confirmingClear = false;
    await db.delete();
    location.reload();
  }

  async function previewCarryover() {
    carryoverError = '';
    carryoverStatus = '';
    try {
      carryoverPreview = await computeCarryover(currentYear);
    } catch (err) {
      carryoverError = err instanceof Error ? err.message : String(err);
    }
  }

  async function runCarryover() {
    carryoverError = '';
    carryoverStatus = '';
    try {
      const r = await applyCarryover(currentYear);
      if ('entryId' in r) {
        carryoverStatus = m.settings_carryover_applied();
        carryoverPreview = null;
      } else if (r.reason === 'already-exists') {
        carryoverError = m.settings_carryover_already_exists();
      } else {
        carryoverError = m.settings_carryover_no_prior();
      }
    } catch (err) {
      carryoverError = err instanceof Error ? err.message : String(err);
    }
  }

  async function deleteCarryover() {
    carryoverError = '';
    carryoverStatus = '';
    try {
      const r = await removeCarryover(currentYear);
      carryoverStatus = r.removed ? m.settings_carryover_deleted() : m.settings_carryover_no_target();
    } catch (err) {
      carryoverError = err instanceof Error ? err.message : String(err);
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
    const exists = ledger.subAccounts.some(
      (s) => s.accountCode === parent && s.name === name
    );
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
    if (!pattern || !newRuleAccountCode) {
      ruleError = m.settings_rule_error_required();
      return;
    }
    const rule: ParserRule = {
      id: newId(),
      matchType: newRuleMatchType,
      pattern,
      accountCode: newRuleAccountCode,
      priority: newRulePriority,
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
  const newAssetLumpSumEligible = $derived(isLumpSumEligible(newAssetCost.trim()));

  async function addAsset(e: Event) {
    e.preventDefault();
    assetError = '';
    if (!newAssetName.trim() || !newAssetCost.trim()) {
      assetError = m.settings_asset_error_required();
      return;
    }
    if (newAssetLife < 1) {
      assetError = m.settings_asset_error_life();
      return;
    }
    if (
      newAssetMethod === 'small-asset-special' &&
      (filingType !== 'blue' || newAssetSmallCheck.state !== 'eligible')
    ) {
      assetError = m.settings_asset_error_small_ineligible();
      return;
    }
    if (newAssetMethod === 'lump-sum' && !newAssetLumpSumEligible) {
      assetError = m.settings_asset_error_lump_sum_ineligible();
      return;
    }
    const a: FixedAsset = {
      id: newId(),
      name: newAssetName.trim(),
      acquisitionDate: newAssetDate,
      acquisitionCost: newAssetCost.trim(),
      usefulLifeYears: newAssetLife,
      depreciationMethod: newAssetMethod,
      accountCode: newAssetAccount,
      ...(newAssetIncomeType === 'realEstate' ? { incomeType: 'realEstate' as const } : {}),
    };
    await db.fixedAssets.add(a);
    newAssetName = '';
    newAssetCost = '';
    newAssetLife = 4;
  }

  async function deleteAsset(id: string) {
    await db.fixedAssets.delete(id);
  }

  function startEditProperty(a: FixedAsset) {
    propertyEditId = a.id;
    const d = a.realEstateDetail;
    propertyType = d?.propertyType ?? '';
    propertyIsResidential = d?.isResidential ?? true;
    propertyAddress = d?.address ?? '';
    propertyTenantName = d?.tenantName ?? '';
    propertyTenantAddress = d?.tenantAddress ?? '';
    propertyRentalStart = d?.rentalPeriodStart ?? '';
    propertyRentalEnd = d?.rentalPeriodEnd ?? '';
    propertyAreaSqm = d?.areaSqm ?? '';
    propertyAnnualRent = d?.annualRent ?? '';
    propertyKeyMoneyEtc = d?.keyMoneyEtc ?? '';
    propertyOtherIncome = d?.otherIncome ?? '';
    propertyDepositBalance = d?.depositBalance ?? '';
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
    const a = await db.fixedAssets.get(propertyEditId);
    if (!a) {
      return;
    }
    const detail: RealEstatePropertyDetail = {
      propertyType: propertyType.trim(),
      isResidential: propertyIsResidential,
      address: propertyAddress.trim(),
      annualRent: propertyAnnualRent.trim(),
      ...(propertyTenantName.trim() ? { tenantName: propertyTenantName.trim() } : {}),
      ...(propertyTenantAddress.trim() ? { tenantAddress: propertyTenantAddress.trim() } : {}),
      ...(propertyRentalStart ? { rentalPeriodStart: propertyRentalStart } : {}),
      ...(propertyRentalEnd ? { rentalPeriodEnd: propertyRentalEnd } : {}),
      ...(propertyAreaSqm.trim() ? { areaSqm: propertyAreaSqm.trim() } : {}),
      ...(propertyKeyMoneyEtc.trim() ? { keyMoneyEtc: propertyKeyMoneyEtc.trim() } : {}),
      ...(propertyOtherIncome.trim() ? { otherIncome: propertyOtherIncome.trim() } : {}),
      ...(propertyDepositBalance.trim() ? { depositBalance: propertyDepositBalance.trim() } : {}),
    };
    await db.fixedAssets.put({ ...a, realEstateDetail: detail });
    propertyEditId = null;
  }

  function startEditDisposal(a: FixedAsset) {
    disposeEditId = a.id;
    disposeDate = a.disposedDate ?? todayISO();
    disposeType = a.disposalType ?? 'scrap';
    disposeSalePrice = a.salePrice ?? '';
    disposeSaleExpenses = a.saleExpenses ?? '';
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
            salePrice: trimmedSalePrice,
            ...(trimmedSaleExpenses ? { saleExpenses: trimmedSaleExpenses } : {}),
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
    const result = await generateDisposalEntry(id, disposeCashAccount);
    if (result.created) {
      disposeStatus = { ...disposeStatus, [id]: m.settings_asset_disposal_run_success() };
      return;
    }
    const messages: Record<NonNullable<typeof result.reason>, string> = {
      'no-disposal': m.settings_asset_disposal_run_error_no_disposal(),
      'already-exists': m.settings_asset_disposal_run_error_exists(),
      'missing-sale-price': m.settings_asset_disposal_error_sale_price(),
      'lump-sum-unsupported': m.settings_asset_disposal_run_error_lump_sum(),
    };
    disposeStatus = { ...disposeStatus, [id]: messages[result.reason!] };
  }

  async function runDepreciation() {
    depreciationStatus = '';
    try {
      const r = await generateYearEndDepreciation(depreciationYear);
      const parts: string[] = [];
      parts.push(
        r.skipped > 0
          ? m.settings_asset_run_success_with_skipped({ created: r.created, skipped: r.skipped })
          : m.settings_asset_run_success({ created: r.created })
      );
      if (r.smallAssetCapExceeded > 0) {
        parts.push(m.settings_asset_run_warn_small_cap({ count: r.smallAssetCapExceeded }));
      }
      if (r.smallAssetIneligible > 0) {
        parts.push(m.settings_asset_run_warn_small_ineligible({ count: r.smallAssetIneligible }));
      }
      depreciationStatus = parts.join(' / ');
    } catch (e) {
      depreciationStatus = m.settings_asset_run_error({ message: e instanceof Error ? e.message : String(e) });
    }
  }

  function assetCurrentDepreciation(asset: FixedAsset): {
    amount: string;
    book: string;
  } {
    const r = computeDepreciation(asset, depreciationYear);
    return { amount: r.amount, book: r.bookValueEnd };
  }

  async function saveGeminiKey() {
    await setSetting('geminiApiKey', geminiKey.trim());
    geminiKeySaved = m.settings_llm_saved();
    setTimeout(() => {
      geminiKeySaved = '';
    }, 2000);
  }

  async function testGeminiKey() {
    geminiTestStatus = m.settings_llm_testing();
    try {
      const { GeminiAdapter } = await import('../domain/llm');
      const adapter = new GeminiAdapter(geminiKey.trim());
      await adapter.generateJson(
        '日本語で "ok" だけを JSON 形式 {"status":"ok"} で返してください。'
      );
      geminiTestStatus = m.settings_llm_test_success();
    } catch (e) {
      geminiTestStatus = m.settings_llm_test_error({ message: e instanceof Error ? e.message : String(e) });
    }
  }

  async function saveOcrEngine() {
    await setSetting('ocrEngine', ocrEngine);
    await setSetting('openaiBaseUrl', openaiBaseUrl.trim());
    await setSetting('tesseractLangPath', tesseractLangPath.trim());
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
    try {
      const { listOpenAiModels } = await import('../domain/llm');
      openaiModels = await listOpenAiModels(
        openaiBaseUrl.trim(),
        openaiApiKey.trim()
      );
      openaiStatus = m.settings_openai_models_loaded({
        count: openaiModels.length,
      });
    } catch (e) {
      openaiStatus = m.settings_llm_test_error({
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }

  async function testOpenai() {
    openaiStatus = m.settings_llm_testing();
    try {
      const { OpenAICompatibleAdapter } = await import('../domain/llm');
      const adapter = new OpenAICompatibleAdapter(
        openaiBaseUrl.trim(),
        openaiClassifyModel.trim() || openaiOcrModel.trim(),
        openaiApiKey.trim()
      );
      await adapter.generateJson(
        '日本語で "ok" だけを JSON 形式 {"status":"ok"} で返してください。'
      );
      openaiStatus = m.settings_llm_test_success();
    } catch (e) {
      openaiStatus = m.settings_llm_test_error({
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }

  async function handleRestoreFile(e: Event) {
    restoreError = '';
    restoreSuccess = '';
    restoreWarning = '';
    restorePayload = null;
    restoreAttachmentBlobs = new Map();
    restoreAttachmentCount = 0;
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) {
      return;
    }
    if (exceedsLimit(file.size, MAX_BACKUP_BYTES)) {
      restoreError = m.common_file_too_large({ size: formatBytes(file.size), limit: formatBytes(MAX_BACKUP_BYTES) });
      input.value = '';
      return;
    }
    restoreFileName = file.name;
    try {
      // zip（帳簿データ + 証憑写真）と旧形式の純 JSON を自動判定して読む（C7-4）。
      const parsed = await parseBackupFile(file);
      restorePayload = parsed.payload;
      restoreAttachmentBlobs = parsed.attachmentBlobs;
      restoreAttachmentCount = parsed.attachmentBlobs.size;
    } catch (err) {
      restoreError = err instanceof Error ? err.message : String(err);
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
      const result = await restoreFromPayload($state.snapshot(restorePayload), restoreAttachmentBlobs);
      restoreSuccess = m.settings_restore_success({ tables: result.tableCount, rows: result.rowCount });
      restoreWarning = result.missingBlobCount > 0 ? m.settings_restore_missing_blobs({ count: result.missingBlobCount }) : '';
      restorePayload = null;
      restoreAttachmentBlobs = new Map();
      restoreAttachmentCount = 0;
    } catch (err) {
      restoreError = err instanceof Error ? err.message : String(err);
    }
  }

  function downloadBytes(bytes: Uint8Array, filename: string, mimeType: string): void {
    const blob = new Blob([bytes.slice()], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  async function downloadYayoiCsv() {
    accountantExportError = '';
    try {
      const bytes = await exportYayoiCsv(currentYear);
      downloadBytes(bytes, `aoiko-yayoi-${currentYear}.csv`, 'text/csv');
    } catch (err) {
      accountantExportError = err instanceof Error ? err.message : String(err);
    }
  }

  async function downloadGenericCsv() {
    accountantExportError = '';
    try {
      const bytes = await exportGenericCsv(currentYear);
      downloadBytes(bytes, `aoiko-journal-${currentYear}.csv`, 'text/csv');
    } catch (err) {
      accountantExportError = err instanceof Error ? err.message : String(err);
    }
  }

  async function downloadCorrectionHistoryCsv() {
    accountantExportError = '';
    try {
      const bytes = await exportCorrectionHistoryCsv(currentYear);
      downloadBytes(bytes, `aoiko-corrections-${currentYear}.csv`, 'text/csv');
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
        onchange={onLocaleChange}
        class="mt-1 w-full px-3 py-2 bg-background border rounded text-foreground"
      >
        {#each locales as loc (loc)}
          <option value={loc}>{localeLabel(loc)}</option>
        {/each}
      </select>
    </label>
  </section>

  <form
    onsubmit={saveBasic}
    class="space-y-4 border rounded-lg p-6 bg-card text-card-foreground"
  >
    <h3 class="text-lg font-semibold">{m.settings_basic_title()}</h3>
    <p class="text-xs text-muted-foreground">
      {@html m.settings_basic_intro_html()}
    </p>
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <label class="block sm:col-span-2">
        <span class="text-xs text-muted-foreground">{m.settings_basic_business_name()}</span>
        <input
          type="text"
          bind:value={userBusinessName}
          placeholder={m.settings_basic_business_name_placeholder()}
          class="mt-1 w-full px-3 py-2 bg-background border rounded text-foreground"
        />
      </label>
      <label class="block">
        <span class="text-xs text-muted-foreground">{m.settings_basic_invoice_number()}</span>
        <input
          type="text"
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
          bind:value={currentYear}
          min="2020"
          max="2099"
          step="1"
          class="mt-1 w-full px-3 py-2 bg-background border rounded text-foreground"
        />
      </label>
      <label class="block">
        <span class="text-xs text-muted-foreground">{m.settings_invoice_number_prefix()}</span>
        <input
          type="text"
          bind:value={invoiceNumberPrefix}
          placeholder={DEFAULT_INVOICE_PREFIX}
          class="mt-1 w-full px-3 py-2 bg-background border rounded text-foreground font-mono"
        />
      </label>
      <label class="block">
        <span class="text-xs text-muted-foreground">{m.settings_quote_number_prefix()}</span>
        <input
          type="text"
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
    <div class="flex justify-end">
      <button
        type="submit"
        class="px-4 py-2 bg-primary text-primary-foreground rounded hover:opacity-90"
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

  <section class="space-y-4 border rounded-lg p-6 bg-card text-card-foreground">
    <h3 class="text-lg font-semibold">{m.settings_consumption_tax_title()}</h3>
    <p class="text-xs text-muted-foreground">
      {m.settings_consumption_tax_intro()}
    </p>
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <label class="block">
        <span class="text-xs text-muted-foreground">{m.settings_consumption_tax_registration()}</span>
        <select
          bind:value={taxRegistration}
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
            <span class="text-xs text-muted-foreground">{m.settings_consumption_tax_simplified_category()}</span>
            <select
              bind:value={simplifiedTaxCategory}
              onchange={saveConsumptionTax}
              class="mt-1 w-full px-3 py-2 bg-background border rounded text-foreground"
            >
              {#each [1, 2, 3, 4, 5, 6] as cat (cat)}
                <option value={cat}>{simplifiedTaxCategoryLabel(cat as SimplifiedTaxCategory)}</option>
              {/each}
            </select>
          </label>
        {/if}
        {#if taxFilingMethod === 'general'}
          <label class="block sm:col-span-2">
            <span class="text-xs text-muted-foreground">{m.settings_consumption_tax_attribution_method()}</span>
            <select
              bind:value={consumptionTaxAttributionMethod}
              onchange={saveConsumptionTax}
              class="mt-1 w-full px-3 py-2 bg-background border rounded text-foreground"
            >
              <option value="proportional">{m.settings_consumption_tax_attribution_proportional()}</option>
              <option value="individual">{m.settings_consumption_tax_attribution_individual()}</option>
            </select>
            <span class="block mt-1 text-xs text-muted-foreground">{m.settings_consumption_tax_attribution_hint()}</span>
          </label>
        {/if}
      {/if}
    </div>
    {#if consumptionTaxSaved}
      <p class="text-xs text-green-600">{m.settings_consumption_tax_saved()}</p>
    {/if}
  </section>

  <form
    onsubmit={saveFiler}
    class="space-y-4 border rounded-lg p-6 bg-card text-card-foreground"
  >
    <h3 class="text-lg font-semibold">{m.settings_filer_title()}</h3>
    <p class="text-xs text-muted-foreground">
      {@html m.settings_filer_intro_html()}
    </p>
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <label class="block">
        <span class="text-xs text-muted-foreground">{m.settings_filer_riyosha_id()}</span>
        <input
          type="text"
          bind:value={userRiyoshaId}
          inputmode="numeric"
          maxlength="16"
          class="mt-1 w-full px-3 py-2 bg-background border rounded text-foreground font-mono"
        />
      </label>
      <label class="block">
        <span class="text-xs text-muted-foreground">{m.settings_filer_name()}</span>
        <input
          type="text"
          bind:value={userFilerName}
          class="mt-1 w-full px-3 py-2 bg-background border rounded text-foreground"
        />
      </label>
      <label class="block">
        <span class="text-xs text-muted-foreground">{m.settings_filer_zip()}</span>
        <input
          type="text"
          bind:value={userFilerZip}
          inputmode="numeric"
          maxlength="8"
          class="mt-1 w-full px-3 py-2 bg-background border rounded text-foreground font-mono"
        />
      </label>
      <label class="block">
        <span class="text-xs text-muted-foreground">{m.settings_filer_address()}</span>
        <input
          type="text"
          bind:value={userFilerAddress}
          class="mt-1 w-full px-3 py-2 bg-background border rounded text-foreground"
        />
      </label>
      <label class="block sm:col-span-2 relative">
        <span class="text-xs text-muted-foreground">{m.settings_filer_zeimusho()}</span>
        <input
          type="text"
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
                  <span class="text-foreground">{e.name || '（局・事務所）'}</span>
                  <span class="ml-2 font-mono text-xs text-muted-foreground">{e.code}</span>
                </button>
              </li>
            {/each}
          </ul>
        {/if}
        {#if zeimushoCodeInvalid}
          <span class="text-xs text-red-600">{m.settings_filer_zeimusho_invalid()}</span>
        {/if}
      </label>
      <div class="block sm:col-span-2">
        <span class="text-xs text-muted-foreground">{m.settings_filing_type_label()}</span>
        <div class="mt-1 flex gap-4 text-sm">
          <label class="flex items-center gap-1">
            <input
              type="radio"
              name="filingType"
              checked={filingType === 'blue'}
              onchange={() => requestFilingTypeChange('blue')}
            />
            {m.settings_filing_type_blue()}
          </label>
          <label class="flex items-center gap-1">
            <input
              type="radio"
              name="filingType"
              checked={filingType === 'white'}
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
            class="mt-1 w-full px-3 py-2 bg-background border rounded text-foreground"
          >
            <option value="electronic">{m.settings_aoiro_electronic()}</option>
            <option value="doubleEntry">{m.settings_aoiro_double_entry()}</option>
            <option value="simple">{m.settings_aoiro_simple()}</option>
            <option value="none">{m.settings_aoiro_none()}</option>
          </select>
        </label>
      {/if}
    </div>
    <div class="flex items-center justify-end gap-3">
      {#if filerSaved}
        <span class="text-xs text-green-600">{m.settings_basic_saved()}</span>
      {/if}
      <button
        type="submit"
        disabled={zeimushoCodeInvalid}
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
        class="px-4 py-2 border rounded hover:bg-accent"
      >
        {m.settings_carryover_preview_button()}
      </button>
      <button
        type="button"
        onclick={runCarryover}
        class="px-4 py-2 bg-primary text-primary-foreground rounded hover:opacity-90"
      >
        {m.settings_carryover_apply_button()}
      </button>
      <button
        type="button"
        onclick={deleteCarryover}
        class="px-4 py-2 border rounded text-destructive hover:bg-destructive/10"
      >
        {m.settings_carryover_delete_button()}
      </button>
    </div>
    {#if carryoverStatus}
      <p class="text-sm text-green-600">{carryoverStatus}</p>
    {/if}
    {#if carryoverError}
      <p class="text-sm text-destructive">{carryoverError}</p>
    {/if}
    {#if carryoverPreview}
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
        <p>{m.settings_carryover_prior_net_income()}：<span class="font-mono">{formatJPY(p.priorNetIncome)}</span></p>
        <p>{m.settings_carryover_prior_capital()}：<span class="font-mono">{formatJPY(p.priorEndingCapital)}</span></p>
        <p>{m.settings_carryover_prior_owner_movements({ withdrawals: formatJPY(p.priorOwnerWithdrawals), contributions: formatJPY(p.priorOwnerContributions) })}</p>
      </div>
    {/if}
  </section>

  <section class="space-y-4 border rounded-lg p-6 bg-card text-card-foreground">
    <h3 class="text-lg font-semibold">{m.settings_subaccount_title()}</h3>
    <p class="text-xs text-muted-foreground">
      {m.settings_subaccount_intro()}
    </p>
    <form onsubmit={addSubAccount} class="flex flex-wrap gap-3 items-center">
      <select
        bind:value={newSubParent}
        required
        class="flex-1 min-w-40 px-3 py-2 bg-background border rounded text-foreground"
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
        bind:value={newSubName}
        required
        placeholder={m.settings_subaccount_name_placeholder()}
        class="flex-1 min-w-40 px-3 py-2 bg-background border rounded text-foreground"
      />
      <button
        type="submit"
        class="ml-auto px-4 py-2 bg-primary text-primary-foreground rounded hover:opacity-90"
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
              <span class="font-mono">{group.account.code}</span> {group.account.name}
            </div>
            <ul class="space-y-1">
              {#each group.items as sa (sa.id)}
                <li class="flex items-center justify-between border rounded px-3 py-2 bg-background">
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
        bind:value={newVendorName}
        required
        placeholder={m.settings_vendor_name_placeholder()}
        class="flex-1 min-w-40 px-3 py-2 bg-background border rounded text-foreground"
      />
      <select
        bind:value={newVendorEntityType}
        class="px-3 py-2 bg-background border rounded text-foreground"
      >
        <option value="unknown">{m.settings_vendor_entity_label()}</option>
        <option value="corporation">{m.settings_vendor_entity_corporation()}</option>
        <option value="individual">{m.settings_vendor_entity_individual()}</option>
        <option value="public">{m.settings_vendor_entity_public()}</option>
        <option value="foreign">{m.settings_vendor_entity_foreign()}</option>
      </select>
      <input
        type="text"
        bind:value={newVendorInvoice}
        placeholder={m.settings_vendor_invoice_placeholder()}
        pattern={INVOICE_NUMBER_PATTERN}
        class="flex-1 min-w-48 px-3 py-2 bg-background border rounded text-foreground font-mono text-sm"
      />
      <select
        bind:value={newVendorAccountCode}
        class="flex-1 min-w-40 px-3 py-2 bg-background border rounded text-foreground"
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
        bind:value={newVendorAddress}
        placeholder={m.settings_vendor_address_placeholder()}
        class="flex-1 min-w-48 px-3 py-2 bg-background border rounded text-foreground"
      />
      <button
        type="submit"
        class="ml-auto px-4 py-2 bg-primary text-primary-foreground rounded hover:opacity-90"
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
          <li class="flex flex-wrap gap-3 items-center border rounded px-3 py-2 bg-background text-sm">
            <span class="flex-1 min-w-40 break-all">
              {v.name}
              <span class="text-xs text-muted-foreground ml-2">{vendorEntityLabel(v.entityType)}</span>
              {#if v.address}
                <span class="block text-xs text-muted-foreground">{v.address}</span>
              {/if}
            </span>
            <span class="font-mono text-xs text-muted-foreground">{v.invoiceNumber ?? ''}</span>
            <span class="text-xs text-muted-foreground">
              {v.defaultAccountCode ?? ''}
            </span>
            <div class="ml-auto flex gap-2">
              {#if v.invoiceNumber}
                <a
                  href={`https://www.invoice-kohyo.nta.go.jp/regno-search/list?selRegNo=${v.invoiceNumber.replace(/^T/, '')}`}
                  target="_blank"
                  rel="noreferrer noopener"
                  class="text-xs text-primary hover:underline"
                >
                  {m.settings_vendor_official_site()}
                </a>
              {/if}
              <button
                type="button"
                onclick={() => askDelete(v.name, () => deleteVendor(v.id))}
                class="text-xs text-muted-foreground hover:text-destructive"
              >
                {m.settings_action_delete()}
              </button>
            </div>
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
          bind:value={newInventoryItemName}
          required
          placeholder={m.settings_inventory_item_name_placeholder()}
          class="flex-1 min-w-40 px-3 py-2 bg-background border rounded text-foreground"
        />
        <button
          type="submit"
          class="ml-auto px-4 py-2 bg-primary text-primary-foreground rounded hover:opacity-90"
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
            <li class="flex flex-wrap gap-3 items-center border rounded px-3 py-2 bg-background text-sm">
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

  <section class="space-y-4 border rounded-lg p-6 bg-card text-card-foreground">
    <h3 class="text-lg font-semibold">{m.settings_asset_title()}</h3>
    <p class="text-xs text-muted-foreground">
      {m.settings_asset_intro()}
    </p>

    <form onsubmit={addAsset} class="space-y-2">
      <input
        type="text"
        bind:value={newAssetName}
        required
        placeholder={m.settings_asset_name_placeholder()}
        class="w-full px-3 py-2 bg-background border rounded text-foreground text-sm"
      />
      <div class="flex flex-wrap gap-2 items-center">
        <input
          type="date"
          bind:value={newAssetDate}
          required
          title={m.settings_asset_date_title()}
          class="px-3 py-2 bg-background border rounded text-foreground text-sm tabular-nums"
        />
        <input
          type="number"
          value={newAssetCost}
          oninput={(e) => {
            newAssetCost = (e.target as HTMLInputElement).value;
          }}
          required
          min="0"
          step="1"
          placeholder={m.settings_asset_cost_placeholder()}
          class="flex-1 min-w-40 px-3 py-2 bg-background border rounded text-foreground text-sm tabular-nums text-right"
        />
        <input
          type="number"
          bind:value={newAssetLife}
          required
          min="1"
          max="50"
          step="1"
          title={m.settings_asset_life_title()}
          class="w-20 px-3 py-2 bg-background border rounded text-foreground text-sm tabular-nums"
        />
        <select
          bind:value={newAssetAccount}
          title={m.settings_asset_account_title()}
          class="px-3 py-2 bg-background border rounded text-foreground text-sm"
        >
          <option value="1510">1510 工具器具備品</option>
          <option value="1511">1511 建物</option>
          <option value="1540">1540 車両運搬具</option>
          <option value="1550">1550 建物附属設備</option>
        </select>
        <select
          bind:value={newAssetMethod}
          title={m.settings_asset_method_title()}
          class="px-3 py-2 bg-background border rounded text-foreground text-sm"
        >
          <option value="straight-line">{m.settings_asset_method_straight()}</option>
          <option value="declining-balance">{m.settings_asset_method_declining()}</option>
          {#if filingType === 'blue'}
            <option value="small-asset-special">{m.settings_asset_method_small_special()}</option>
          {/if}
          <option value="lump-sum">{m.settings_asset_method_lump_sum()}</option>
        </select>
        {#if ledger.realEstateIncomeEnabled}
          <select
            bind:value={newAssetIncomeType}
            title={m.journal_form_income_type_label()}
            class="px-3 py-2 bg-background border rounded text-foreground text-sm"
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
    </form>
    {#if newAssetMethod === 'small-asset-special'}
      {#if newAssetSmallCheck.state === 'eligible'}
        <p class="text-xs text-green-600">
          {m.settings_asset_small_eligible({ date: newAssetDate, threshold: formatJPY(newAssetSmallCheck.threshold) })}
        </p>
      {:else if newAssetSmallCheck.state === 'cost'}
        <p class="text-xs text-destructive">
          {m.settings_asset_small_ineligible_cost({ threshold: formatJPY(newAssetSmallCheck.threshold) })}
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
    {#if assetError}
      <div class="text-sm text-destructive">{assetError}</div>
    {/if}

    {#if ledger.fixedAssets.length > 0}
      <table class="w-full text-sm">
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
            {@const d = assetCurrentDepreciation(a)}
            {@const estimate = estimateTransferIncome(a)}
            <tr class="border-t border-border/50">
              <td class="py-2">
                {a.name}
                {#if a.disposedDate}
                  <span class="ml-1 text-xs text-muted-foreground">
                    ({a.disposalType === 'sale' ? m.settings_asset_disposal_type_sale() : m.settings_asset_disposal_type_scrap()}
                    {a.disposedDate})
                  </span>
                {/if}
              </td>
              <td class="py-2 tabular-nums text-muted-foreground">{a.acquisitionDate}</td>
              <td class="py-2 text-right tabular-nums">{formatJPY(a.acquisitionCost)}</td>
              <td class="py-2 text-right tabular-nums">{m.settings_asset_life_years({ n: a.usefulLifeYears })}</td>
              <td class="py-2 text-right tabular-nums">{formatJPY(d.amount)}</td>
              <td class="py-2 text-right tabular-nums text-muted-foreground">{formatJPY(d.book)}</td>
              <td class="py-2 text-right whitespace-nowrap">
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
            {#if propertyEditId === a.id}
              <tr class="border-t border-border/50 bg-muted/30">
                <td colspan="7" class="py-3">
                  <div class="space-y-2">
                    <div class="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      <input
                        type="text"
                        bind:value={propertyType}
                        placeholder={m.settings_asset_property_type_placeholder()}
                        class="px-3 py-2 bg-background border rounded text-foreground text-sm"
                      />
                      <input
                        type="text"
                        bind:value={propertyAddress}
                        placeholder={m.settings_asset_property_address_placeholder()}
                        class="sm:col-span-2 px-3 py-2 bg-background border rounded text-foreground text-sm"
                      />
                      <label class="flex items-center gap-1 text-sm">
                        <input type="checkbox" bind:checked={propertyIsResidential} />
                        {m.settings_asset_property_residential()}
                      </label>
                      <input
                        type="text"
                        bind:value={propertyTenantName}
                        placeholder={m.settings_asset_property_tenant_name_placeholder()}
                        class="px-3 py-2 bg-background border rounded text-foreground text-sm"
                      />
                      <input
                        type="text"
                        bind:value={propertyTenantAddress}
                        placeholder={m.settings_asset_property_tenant_address_placeholder()}
                        class="px-3 py-2 bg-background border rounded text-foreground text-sm"
                      />
                      <input
                        type="date"
                        bind:value={propertyRentalStart}
                        title={m.settings_asset_property_rental_start_title()}
                        class="px-3 py-2 bg-background border rounded text-foreground text-sm tabular-nums"
                      />
                      <input
                        type="date"
                        bind:value={propertyRentalEnd}
                        title={m.settings_asset_property_rental_end_title()}
                        class="px-3 py-2 bg-background border rounded text-foreground text-sm tabular-nums"
                      />
                      <input
                        type="number"
                        bind:value={propertyAreaSqm}
                        min="0"
                        placeholder={m.settings_asset_property_area_placeholder()}
                        class="px-3 py-2 bg-background border rounded text-foreground text-sm tabular-nums text-right"
                      />
                      <input
                        type="number"
                        bind:value={propertyAnnualRent}
                        min="0"
                        step="1"
                        required
                        placeholder={m.settings_asset_property_annual_rent_placeholder()}
                        class="px-3 py-2 bg-background border rounded text-foreground text-sm tabular-nums text-right"
                      />
                      <input
                        type="number"
                        bind:value={propertyKeyMoneyEtc}
                        min="0"
                        step="1"
                        placeholder={m.settings_asset_property_key_money_placeholder()}
                        class="px-3 py-2 bg-background border rounded text-foreground text-sm tabular-nums text-right"
                      />
                      <input
                        type="number"
                        bind:value={propertyOtherIncome}
                        min="0"
                        step="1"
                        placeholder={m.settings_asset_property_other_income_placeholder()}
                        class="px-3 py-2 bg-background border rounded text-foreground text-sm tabular-nums text-right"
                      />
                      <input
                        type="number"
                        bind:value={propertyDepositBalance}
                        min="0"
                        step="1"
                        placeholder={m.settings_asset_property_deposit_placeholder()}
                        class="px-3 py-2 bg-background border rounded text-foreground text-sm tabular-nums text-right"
                      />
                    </div>
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
                        bind:value={disposeDate}
                        class="px-3 py-2 bg-background border rounded text-foreground text-sm tabular-nums"
                      />
                      <label class="flex items-center gap-1 text-sm">
                        <input type="radio" bind:group={disposeType} value="scrap" />
                        {m.settings_asset_disposal_type_scrap()}
                      </label>
                      <label class="flex items-center gap-1 text-sm">
                        <input type="radio" bind:group={disposeType} value="sale" />
                        {m.settings_asset_disposal_type_sale()}
                      </label>
                      {#if disposeType === 'sale'}
                        <input
                          type="number"
                          bind:value={disposeSalePrice}
                          min="0"
                          step="1"
                          placeholder={m.settings_asset_disposal_sale_price_placeholder()}
                          class="w-36 px-3 py-2 bg-background border rounded text-foreground text-sm tabular-nums text-right"
                        />
                        <input
                          type="number"
                          bind:value={disposeSaleExpenses}
                          min="0"
                          step="1"
                          placeholder={m.settings_asset_disposal_sale_expenses_placeholder()}
                          class="w-36 px-3 py-2 bg-background border rounded text-foreground text-sm tabular-nums text-right"
                        />
                        <select
                          bind:value={disposeCashAccount}
                          title={m.settings_asset_disposal_cash_account_title()}
                          class="px-3 py-2 bg-background border rounded text-foreground text-sm"
                        >
                          <option value="1110">1110 現金</option>
                          <option value="1130">1130 普通預金</option>
                        </select>
                      {/if}
                    </div>
                    {#if disposeError}
                      <div class="text-xs text-destructive">{disposeError}</div>
                    {/if}
                    <div class="flex gap-2">
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
    {:else}
      <p class="text-sm text-muted-foreground">{m.settings_asset_empty()}</p>
    {/if}

    <div class="flex items-end gap-3 pt-3 border-t border-border/50">
      <label class="block">
        <span class="text-xs text-muted-foreground">{m.settings_asset_target_year()}</span>
        <input
          type="number"
          bind:value={depreciationYear}
          min="2020"
          max="2099"
          step="1"
          class="mt-1 w-24 px-3 py-2 bg-background border rounded text-foreground tabular-nums text-sm"
        />
      </label>
      <button
        type="button"
        onclick={runDepreciation}
        disabled={ledger.fixedAssets.length === 0}
        class="px-4 py-2 bg-primary text-primary-foreground rounded hover:opacity-90 disabled:opacity-50"
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
        class="px-3 py-2 bg-background border rounded text-foreground"
      >
        <option value="description-includes">{m.settings_rule_match_includes()}</option>
        <option value="vendor-name">{m.settings_rule_match_vendor()}</option>
        <option value="regex">{m.settings_rule_match_regex()}</option>
      </select>
      <input
        type="text"
        bind:value={newRulePattern}
        required
        placeholder={m.settings_rule_pattern_placeholder()}
        class="flex-1 min-w-40 px-3 py-2 bg-background border rounded text-foreground"
      />
      <select
        bind:value={newRuleAccountCode}
        required
        class="flex-1 min-w-40 px-3 py-2 bg-background border rounded text-foreground"
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
        bind:value={newRulePriority}
        min="0"
        step="1"
        title={m.settings_rule_priority_title()}
        class="w-20 px-3 py-2 bg-background border rounded text-foreground tabular-nums"
      />
      <button
        type="submit"
        class="ml-auto px-4 py-2 bg-primary text-primary-foreground rounded hover:opacity-90"
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
          <li class="flex flex-wrap gap-3 items-center border rounded px-3 py-2 bg-background text-sm">
            <span class="text-xs text-muted-foreground">{matchTypeLabel(r.matchType)}</span>
            <span class="font-mono flex-1 min-w-32 break-all">{r.pattern}</span>
            <span class="font-mono text-xs text-muted-foreground">→ {r.accountCode}</span>
            <span class="text-xs text-muted-foreground tabular-nums">{m.settings_rule_priority_short({ n: r.priority })}</span>
            <span class="text-xs text-muted-foreground tabular-nums">{m.settings_rule_hits({ n: r.hitCount })}</span>
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
            {m.settings_account_active_count({ active: group.items.filter((a) => a.isActive !== false).length, total: group.items.length })}
          </span>
        </summary>
        <ul class="border-t divide-y divide-border/50">
          {#each group.items as a (a.code)}
            <li class="flex items-center justify-between px-3 py-2 text-sm">
              <span>
                <span class="font-mono text-xs text-muted-foreground mr-2">{a.code}</span>
                <span class:line-through={a.isActive === false} class:opacity-50={a.isActive === false}>
                  {a.name}
                </span>
              </span>
              <label class="flex items-center gap-2 cursor-pointer text-xs">
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
    <div class="flex gap-3 items-end">
      <label class="block flex-1">
        <span class="text-xs text-muted-foreground">{m.settings_llm_key_label()}</span>
        <input
          type="password"
          bind:value={geminiKey}
          placeholder="AIza..."
          class="mt-1 w-full px-3 py-2 bg-background border rounded text-foreground font-mono text-sm"
        />
      </label>
      <button
        type="button"
        onclick={saveGeminiKey}
        class="px-4 py-2 bg-primary text-primary-foreground rounded hover:opacity-90"
      >
        {m.settings_llm_save()}
      </button>
      <button
        type="button"
        onclick={testGeminiKey}
        disabled={!geminiKey.trim()}
        class="px-4 py-2 border rounded hover:bg-accent disabled:opacity-50"
      >
        {m.settings_llm_test()}
      </button>
    </div>
    <div class="flex gap-3 text-xs">
      {#if geminiKeySaved}
        <span>{geminiKeySaved}</span>
      {/if}
      {#if geminiTestStatus}
        <span>{geminiTestStatus}</span>
      {/if}
    </div>

    <div class="border-t pt-4 space-y-3">
      <label class="block">
        <span class="text-xs text-muted-foreground">{m.settings_engine_label()}</span>
        <select
          bind:value={ocrEngine}
          class="mt-1 w-full px-3 py-2 bg-background border rounded text-foreground text-sm"
        >
          <option value="gemini">{m.settings_engine_gemini()}</option>
          <option value="openai-compatible">{m.settings_engine_openai()}</option>
          <option value="tesseract">{m.settings_engine_tesseract()}</option>
        </select>
      </label>

      {#if ocrEngine === 'tesseract'}
        <p class="text-xs text-muted-foreground">
          {@html m.settings_tesseract_intro_html()}
        </p>
        <label class="block">
          <span class="text-xs text-muted-foreground">{m.settings_tesseract_langpath_label()}</span>
          <input
            type="text"
            bind:value={tesseractLangPath}
            placeholder={m.settings_tesseract_langpath_placeholder()}
            class="mt-1 w-full px-3 py-2 bg-background border rounded text-foreground font-mono text-sm"
          />
        </label>
      {/if}

      {#if ocrEngine === 'openai-compatible'}
        <p class="text-xs text-muted-foreground">
          {@html m.settings_openai_intro_html()}
        </p>
        <label class="block">
          <span class="text-xs text-muted-foreground">{m.settings_openai_baseurl_label()}</span>
          <input
            type="text"
            bind:value={openaiBaseUrl}
            placeholder="http://localhost:11434/v1"
            class="mt-1 w-full px-3 py-2 bg-background border rounded text-foreground font-mono text-sm"
          />
        </label>
        <label class="block">
          <span class="text-xs text-muted-foreground">{m.settings_openai_apikey_label()}</span>
          <input
            type="password"
            bind:value={openaiApiKey}
            placeholder="(Ollama 等ローカルでは不要)"
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
            {m.settings_openai_fetch_models()}
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
              bind:value={openaiOcrModel}
              placeholder="llama3.2-vision 等（vision 必須）"
              class="mt-1 w-full px-3 py-2 bg-background border rounded text-foreground font-mono text-sm"
            />
          {/if}
        </label>
        <label class="block">
          <span class="text-xs text-muted-foreground">{m.settings_openai_classify_model_label()}</span>
          {#if openaiModels.length > 0}
            <select
              bind:value={openaiClassifyModel}
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
              bind:value={openaiClassifyModel}
              placeholder="任意のテキストモデル"
              class="mt-1 w-full px-3 py-2 bg-background border rounded text-foreground font-mono text-sm"
            />
          {/if}
        </label>
      {/if}

      <div class="flex gap-3 items-center">
        <button
          type="button"
          onclick={saveOcrEngine}
          class="px-4 py-2 bg-primary text-primary-foreground rounded hover:opacity-90"
        >
          {m.settings_llm_save()}
        </button>
        {#if openaiSaved}
          <span class="text-xs">{openaiSaved}</span>
        {/if}
        {#if openaiStatus}
          <span class="text-xs">{openaiStatus}</span>
        {/if}
      </div>
    </div>
  </section>

  <BackupPanel />

  <section class="space-y-4 border rounded-lg p-6 bg-card text-card-foreground">
    <h3 class="text-lg font-semibold">{m.settings_accountant_export_title()}</h3>
    <p class="text-xs text-muted-foreground">{m.settings_accountant_export_intro({ year: currentYear })}</p>
    <div class="flex flex-wrap gap-2">
      <button
        type="button"
        onclick={downloadYayoiCsv}
        class="px-4 py-2 bg-primary text-primary-foreground rounded hover:opacity-90"
      >
        {m.settings_accountant_export_yayoi()}
      </button>
      <button
        type="button"
        onclick={downloadGenericCsv}
        class="px-4 py-2 border rounded hover:bg-accent"
      >
        {m.settings_accountant_export_generic()}
      </button>
      <button
        type="button"
        onclick={downloadCorrectionHistoryCsv}
        class="px-4 py-2 border rounded hover:bg-accent"
      >
        {m.settings_accountant_export_corrections()}
      </button>
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

  <section class="space-y-4 border rounded-lg p-6 bg-card text-card-foreground">
    <h3 class="text-lg font-semibold">{m.settings_restore_title()}</h3>
    <p class="text-xs text-muted-foreground">
      {@html m.settings_restore_intro_html()}
    </p>
    <input
      type="file"
      accept=".zip,application/zip,.json,application/json"
      onchange={handleRestoreFile}
      class="w-full text-sm text-muted-foreground"
    />
    {#if restoreFileName}
      <p class="text-xs text-muted-foreground">{m.settings_restore_selected({ name: restoreFileName })}</p>
    {/if}
    {#if restoreError}
      <div class="text-sm text-destructive">{restoreError}</div>
    {/if}
    {#if restoreSuccess}
      <div class="text-sm text-foreground border border-primary bg-primary/10 rounded px-3 py-2">
        ✓ {restoreSuccess}
        <button
          type="button"
          onclick={() => location.reload()}
          class="ml-2 text-primary underline"
        >
          {m.settings_restore_reload()}
        </button>
      </div>
    {/if}
    {#if restoreWarning}
      <div class="text-sm text-foreground border border-destructive bg-destructive/10 rounded px-3 py-2">
        ⚠ {restoreWarning}
      </div>
    {/if}
    {#if restorePayload}
      <div class="text-xs text-muted-foreground">
        {m.settings_restore_summary({ version: restorePayload.version, tables: Object.keys(restorePayload.tables).length, rows: Object.values(restorePayload.tables).reduce((s, t) => s + t.length, 0) })}
      </div>
      {#if restoreAttachmentCount > 0}
        <div class="text-xs text-muted-foreground">
          {m.settings_restore_summary_attachments({ count: restoreAttachmentCount })}
        </div>
      {/if}
      <button
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
        {m.settings_disclaimer_accepted({ date: toISODateLocal(new Date(disclaimerAcceptedAt)), version: disclaimerAcceptedVersion ?? 0 })}
      </p>
      <p class="text-xs text-muted-foreground">
        {m.settings_disclaimer_full_text_label()}
        <a
          href="https://github.com/Lonshaus/aoiko/blob/master/DISCLAIMER.md"
          target="_blank"
          rel="noopener noreferrer"
          class="underline hover:text-foreground"
        >DISCLAIMER.md</a>
      </p>
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
    <h3 class="text-lg font-semibold">{m.settings_data_title()}</h3>
    <p class="text-xs text-muted-foreground">
      {m.settings_data_intro()}
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
</div>

<AlertDialog.Root bind:open={confirmingFilingType}>
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
        {m.settings_clear_confirm_desc()}
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