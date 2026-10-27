<script lang="ts">
  import { onMount } from 'svelte';
  import { liveQuery } from 'dexie';
  import { router, link, clearUnsavedGuard, setUnsavedGuard } from '../router.svelte';
  import { ledger } from '../stores/ledger.svelte';
  import { m } from '../paraglide/messages';
  import { D, formatJPY, type Decimal } from '../lib/decimal';
  import {
    isAmountInputInvalid,
    isJournalAmountTooLarge,
    normalizeAmountInput,
    parseAmountInput,
  } from '../lib/amount-input';
  import { isValidIsoDate, todayISO } from '../lib/date';
  import { assignInputNumberOrEmpty, assignInputString } from '../lib/number-input';
  import { validateFixedAsset } from '../domain/fixed-asset-check';
  import { isSmallAssetEligible, smallAssetThreshold } from '../tax-schema/2026/limits';
  import { DEPRECIABLE_ASSET_ACCOUNTS } from '../tax-schema/2026/accounts';
  import {
    buildMissingOpeningAsset,
    computeConvertedAssetBasis,
    dismissInterruptedOpeningYear,
    dismissMissingOpeningAsset,
    generateOpeningEntries,
    isConvertedAssetLifeSupported,
    missingOpeningAssetBasis,
    OpeningRestoreAborted,
    previewInterruptedOpeningRestore,
    readOpeningRecoveryState,
    readOpeningYears,
    registerMissingOpeningAsset,
    replaceOpeningEntries,
    restoreInterruptedOpeningEntries,
    showDismissedInterruptedOpeningYears,
    type ExpenseAmortization,
    type MissingOpeningAsset,
    type OpeningCustomItem,
    type OpeningRecoveryState,
    type OpeningRestorePreview,
    type OpeningSetupInput,
  } from '../domain/business-opening';
  import { readBusinessDateSources, type BusinessDateSources } from '../domain/depreciation';
  import * as AlertDialog from '$lib/components/ui/alert-dialog';
  import { getSetting } from '../lib/settings';
  import { describeStorageError } from '../lib/storage-error';
  import { filedYearGuard } from '../lib/filed-year-guard.svelte';
  import type { DepreciationMethod } from '../db/types';
  import type { FilingType } from '../tax-schema/2026/xtx';

  let businessStartDate = $state(todayISO());
  // 少額特例の年合計上限の月割（措法28の2）に使う。未入力は廃業なし（全年扱い）。
  let businessCloseDate = $state('');
  // 少額特例は青色申告限定（措法28の2）。
  let filingType = $state<FilingType>('blue');
  onMount(async () => {
    filingType = (await getSetting('filingType')) ?? 'blue';
  });
  type Preload =
    | { status: 'loading' }
    | { status: 'ready'; sources: BusinessDateSources }
    | { status: 'failed'; reason: string };
  // 保存済みの値を読み終えるまで欄を出さない。読んだ後に入れ直すと、利用者の入力を上書きしてしまう
  let preload = $state.raw<Preload>({ status: 'loading' });
  onMount(async () => {
    try {
      const sources = await readBusinessDateSources();
      const latestYear = Math.max(...sources.openingStartByYear.keys());
      const settingStart = sources.settingStart?.valid
        ? String(sources.settingStart.value)
        : undefined;
      businessStartDate = sources.openingStartByYear.get(latestYear) ?? settingStart ?? todayISO();
      const close = storedClose(sources);
      businessCloseDate = close !== undefined && close >= businessStartDate ? close : '';
      preload = { status: 'ready', sources };
    } catch (e) {
      preload = { status: 'failed', reason: describeStorageError(e) };
    }
  });
  function storedClose(sources: BusinessDateSources): string | undefined {
    return sources.settingClose?.valid ? String(sources.settingClose.value) : undefined;
  }
  const datesInvalid = $derived(
    !isValidIsoDate(businessStartDate) ||
      (businessCloseDate !== '' && !isValidIsoDate(businessCloseDate)),
  );

  interface ExpenseRow {
    name: string;
    amount: string;
  }
  let expenses = $state<ExpenseRow[]>([]);
  let expenseAmortization = $state<ExpenseAmortization>('immediate');
  let customAmortizationAmount = $state('');
  let expenseName = $state('');
  let expenseAmount = $state('');
  // 名前を入れたのに金額が空のまま追加しようとしたとき、黙って無視せず示す
  let expenseAddAttempted = $state(false);
  // 金額欄の入力に対する案内。空欄は追加を試みた後にだけ誤りとして示す
  function amountHint(raw: string, emptyIsError: boolean): string {
    if (normalizeAmountInput(raw) === '') {
      return emptyIsError ? m.common_amount_invalid() : '';
    }
    if (parseAmountInput(raw) === undefined) {
      return m.common_amount_invalid();
    }
    return isJournalAmountTooLarge(raw) ? m.common_amount_too_large() : '';
  }
  const expenseAmountHint = $derived(
    amountHint(expenseAmount, expenseAddAttempted && expenseName.trim() !== ''),
  );
  function addExpense() {
    expenseAddAttempted = true;
    if (!expenseName.trim() || expenseAmountHint !== '') {
      return;
    }
    expenses.push({
      name: expenseName.trim(),
      amount: (parseAmountInput(expenseAmount) ?? D(0)).toFixed(),
    });
    expenseName = '';
    expenseAmount = '';
    expenseAddAttempted = false;
  }
  function removeExpense(i: number) {
    expenses.splice(i, 1);
  }
  const expenseTotal = $derived(expenses.reduce((sum, e) => sum.plus(D(e.amount || '0')), D(0)));

  interface ConvertedAssetRow {
    name: string;
    acquisitionDate: string;
    acquisitionCost: string;
    usefulLifeYears: number;
    accountCode: string;
    depreciationMethod: DepreciationMethod;
    applySmallAssetSpecial: boolean;
  }
  let convertedAssets = $state<ConvertedAssetRow[]>([]);
  let newAssetName = $state('');
  let newAssetAcqDate = $state('');
  let newAssetCost = $state('');
  let newAssetLife = $state<number | undefined>(4);
  let newAssetAccount = $state('1510');
  const newAssetCostError = $derived.by(() => {
    if (normalizeAmountInput(newAssetCost) === '') {
      return '';
    }
    if (parseAmountInput(newAssetCost) === undefined) {
      return m.common_amount_invalid();
    }
    return isJournalAmountTooLarge(newAssetCost) ? m.common_amount_too_large() : '';
  });
  // 開業時に登録する資産も減価償却・.xtx の検査（validateFixedAsset）を通る形に限る
  const newAssetLifeError = $derived(
    validateFixedAsset({
      id: '',
      name: '',
      acquisitionDate: newAssetAcqDate,
      acquisitionCost: '0',
      usefulLifeYears: newAssetLife ?? Number.NaN,
      depreciationMethod: 'straight-line',
      accountCode: newAssetAccount,
    }).some((i) => i.kind === 'useful-life')
      ? m.fixed_asset_issue_useful_life()
      : newAssetLife !== undefined && !isConvertedAssetLifeSupported(newAssetLife)
        ? m.opening_asset_life_unsupported()
        : '',
  );

  const newAssetAcqDateError = $derived(
    isValidIsoDate(businessStartDate) &&
      isValidIsoDate(newAssetAcqDate) &&
      newAssetAcqDate > businessStartDate
      ? m.opening_asset_acquired_after_start({
          acquisitionDate: newAssetAcqDate,
          businessStartDate,
        })
      : '',
  );

  function addConvertedAsset() {
    const cost = parseAmountInput(newAssetCost);
    if (
      !newAssetName.trim() ||
      !newAssetAcqDate ||
      cost === undefined ||
      newAssetCostError !== '' ||
      newAssetLifeError !== '' ||
      newAssetAcqDateError !== '' ||
      newAssetLife === undefined
    ) {
      return;
    }
    convertedAssets.push({
      name: newAssetName.trim(),
      acquisitionDate: newAssetAcqDate,
      acquisitionCost: cost.toFixed(),
      usefulLifeYears: newAssetLife,
      accountCode: newAssetAccount,
      depreciationMethod: 'straight-line',
      applySmallAssetSpecial: false,
    });
    newAssetName = '';
    newAssetAcqDate = '';
    newAssetCost = '';
  }
  function removeConvertedAsset(i: number) {
    convertedAssets.splice(i, 1);
  }
  type AssetBasisResult =
    { basis: ReturnType<typeof computeConvertedAssetBasis> } | { error: string } | null;
  // 計算できない行を 0 円として数えると、上限の判定と作成の結果が食い違う
  function assetBasisResult(row: ConvertedAssetRow): AssetBasisResult {
    if (!row.acquisitionDate || !businessStartDate || !row.acquisitionCost) {
      return null;
    }
    try {
      return {
        basis: computeConvertedAssetBasis(
          row.acquisitionDate,
          businessStartDate,
          row.acquisitionCost,
          row.usefulLifeYears,
        ),
      };
    } catch (e) {
      return {
        error: m.fixed_asset_invalid({
          name: row.name,
          reasons: e instanceof Error ? e.message : String(e),
        }),
      };
    }
  }
  function assetBasis(row: ConvertedAssetRow) {
    const r = assetBasisResult(row);
    return r !== null && 'basis' in r ? r.basis : null;
  }
  const convertedAssetErrors = $derived(
    convertedAssets.flatMap((row) => {
      const r = assetBasisResult(row);
      return r !== null && 'error' in r ? [r.error] : [];
    }),
  );
  // 少額特例の適用の閾値は原始取得価額で判定する（所令135条：転用資産も所令126条の取得価額が基準）。
  // 30/40 万円閾値切替（令和8年改正、2026-04-01）は取得日で判定する（措法 28 の 2）
  function smallAssetEligibleByAcquisition(row: ConvertedAssetRow): boolean {
    if (!row.acquisitionDate || !row.acquisitionCost) {
      return false;
    }
    return isSmallAssetEligible(row.acquisitionDate, row.acquisitionCost);
  }
  function toggleSmallAssetSpecial(row: ConvertedAssetRow) {
    row.applySmallAssetSpecial = !row.applySmallAssetSpecial;
    row.depreciationMethod = row.applySmallAssetSpecial ? 'small-asset-special' : 'straight-line';
  }

  let showInventory = $state(false);
  let showDeposit = $state(false);
  interface CustomRow {
    name: string;
    amount: string;
    accountCode: string;
    side: 'debit' | 'credit';
  }
  let customItems = $state<CustomRow[]>([]);
  let customName = $state('');
  let customAmount = $state('');
  let customAccount = $state('');
  let customSide = $state<'debit' | 'credit'>('debit');

  let customAddAttempted = $state(false);
  const customAmountHint = $derived(
    amountHint(customAmount, customAddAttempted && customName.trim() !== ''),
  );
  function addCustomItem() {
    customAddAttempted = true;
    if (!customName.trim() || !customAccount || customAmountHint !== '') {
      return;
    }
    customItems.push({
      name: customName.trim(),
      amount: (parseAmountInput(customAmount) ?? D(0)).toFixed(),
      accountCode: customAccount,
      side: customSide,
    });
    customName = '';
    customAmount = '';
    customAccount = '';
    customAddAttempted = false;
  }
  function removeCustomItem(i: number) {
    customItems.splice(i, 1);
  }

  let step = $state<'form' | 'preview' | 'done'>('form');
  let generating = $state(false);
  let error = $state('');
  // 書き込みが失敗して取引ごと取り消されたときに、何も変えていないことを添える
  let writeFailed = $state(false);
  // 既存の開業仕訳で作らなかった年。開業日を変えたら作り直しの案内と前回の結果を消す
  let redoOfferYear = $state<number | null>(null);
  const canRedo = $derived(
    redoOfferYear !== null && redoOfferYear === Number(businessStartDate.slice(0, 4)),
  );
  let redoConfirmOpen = $state(false);
  // 作り直しで打ち消す年。打ち消すのはいつも 1 つの年だけ
  let redoYear = $state<number | null>(null);
  // 入力の年に開業仕訳が無く、ほかの年にある。再開業か開業日の変更かはデータから分からないので選んでもらう
  let crossYear = $state<{ years: number[]; latest: number }>({ years: [], latest: 0 });
  let crossYearOpen = $state(false);

  const hasAnyItem = $derived(
    expenses.length > 0 || convertedAssets.length > 0 || customItems.length > 0,
  );
  // 仕訳を生成する前に画面を離れると、入力した開業費・転用資産が全て消える。
  // 入力途中の行（追加ボタンを押していないもの）も対象に含める。
  const isDirty = $derived(
    step !== 'done' &&
      (hasAnyItem ||
        expenseName !== '' ||
        expenseAmount !== '' ||
        newAssetName !== '' ||
        newAssetCost !== '' ||
        customName !== '' ||
        customAmount !== ''),
  );
  const unsavedToken = {};
  $effect(() => {
    setUnsavedGuard(unsavedToken, isDirty);
    return () => clearUnsavedGuard(unsavedToken);
  });
  // 読めない額のまま作成に進むと内部のエラー文が出るか、償却 0 として作られてしまう。
  // 開業費の合計が 0 ならドメインは償却額を読まない
  function customAmortizationInvalid(): boolean {
    if (
      expenseAmortization !== 'custom' ||
      parseAmountInput(customAmortizationAmount) !== undefined
    ) {
      return false;
    }
    try {
      return !expenses.reduce((sum, e) => sum.plus(D(e.amount)), D(0)).isZero();
    } catch {
      // 読めない開業費の額はドメインが作成時にエラーとして示す
      return false;
    }
  }
  // 作成で書き込まれる各仕訳明細の金額（開業費合計・償却額・転用資産・自由項目・元入金）が上限に収まるか
  function openingAmountsTooLarge(): boolean {
    const exceeds = (d: Decimal): boolean => d.abs().gte('1e14');
    const expenseSum = expenses.reduce((sum, e) => sum.plus(D(e.amount)), D(0));
    if (exceeds(expenseSum)) {
      return true;
    }
    if (expenseAmortization === 'custom' && isJournalAmountTooLarge(customAmortizationAmount)) {
      return true;
    }
    let net = D(0);
    for (const row of convertedAssets) {
      const basis = assetBasis(row)?.businessStartBasis;
      if (basis !== undefined) {
        if (exceeds(basis)) {
          return true;
        }
        net = net.plus(basis);
      }
    }
    for (const c of customItems) {
      const amount = D(c.amount);
      if (exceeds(amount)) {
        return true;
      }
      net = c.side === 'debit' ? net.plus(amount) : net.minus(amount);
    }
    return exceeds(net);
  }
  // 作成・作り直しの前にすべて確かめる。打ち消した後で止まると、開業仕訳が無いまま残る
  function blockingError(): string {
    if (convertedAssetErrors.length > 0) {
      return convertedAssetErrors.join(' / ');
    }
    if (datesInvalid) {
      return m.opening_dates_invalid();
    }
    if (customAmortizationInvalid()) {
      return m.common_amount_invalid();
    }
    if (openingAmountsTooLarge()) {
      return m.common_amount_too_large();
    }
    return '';
  }
  // 作成後に保存される廃業日。空欄なら開業日以後の保存済みの値は消し、それより前（再開業前の廃業日）は残す
  function nextStoredClose(sources: BusinessDateSources): string | undefined {
    if (businessCloseDate !== '') {
      return businessCloseDate;
    }
    const stored = storedClose(sources);
    return stored !== undefined && stored >= businessStartDate ? undefined : stored;
  }
  function closeChangeYears(sources: BusinessDateSources): number[] {
    const stored = storedClose(sources);
    const next = nextStoredClose(sources);
    if (stored === next) {
      return [];
    }
    return [stored, next].flatMap((d) => (d === undefined ? [] : [Number(d.slice(0, 4))]));
  }
  // 申告済みの確認に出す年。書き込む年・廃業日の変わる年の最も早い年から、今の年までを並べる
  function affectedYears(years: number[]): number[] {
    const from = Math.min(...years);
    const to = Math.max(...years, ledger.currentYear);
    if (!Number.isInteger(from) || from < 1900) {
      return [...new Set(years)];
    }
    return Array.from({ length: to - from + 1 }, (_, i) => from + i);
  }
  const closeReplaceNotice = $derived.by(() => {
    if (preload.status !== 'ready' || businessCloseDate === '') {
      return '';
    }
    const stored = storedClose(preload.sources);
    return stored !== undefined && stored < businessStartDate && stored !== businessCloseDate
      ? m.opening_close_date_replace_notice({ old: stored, year: Number(stored.slice(0, 4)) })
      : '';
  });
  function openingDetail(): string {
    return m.filed_year_warning_detail_opening({
      expenses: expenses.length,
      assets: convertedAssets.length,
      custom: customItems.length,
    });
  }
  function openingInput(): OpeningSetupInput {
    const items: OpeningCustomItem[] = customItems.map((c) => ({
      name: c.name,
      amount: c.amount,
      accountCode: c.accountCode,
      side: c.side,
    }));
    return {
      businessStartDate,
      expenses,
      expenseAmortization,
      ...(expenseAmortization === 'custom'
        ? { customAmortizationAmount: normalizeAmountInput(customAmortizationAmount) }
        : {}),
      convertedAssets: convertedAssets.map((a) => ({
        name: a.name,
        acquisitionDate: a.acquisitionDate,
        acquisitionCost: a.acquisitionCost,
        usefulLifeYears: a.usefulLifeYears,
        accountCode: a.accountCode,
        // チェック後に取得日等を書き換えて不適格になった行の取りこぼし防止
        depreciationMethod:
          a.depreciationMethod === 'small-asset-special' && !smallAssetEligibleByAcquisition(a)
            ? 'straight-line'
            : a.depreciationMethod,
      })),
      customItems: items,
    };
  }
  function showWriteFailure(e: unknown): void {
    error = describeStorageError(e);
    writeFailed = true;
  }
  // 確認は呼出元で済ませておく。開業日・廃業日の設定値（少額特例の年合計上限の月割に使う）も同じ取引で書き、作らなかったときは書かない
  async function createOpening(sources: BusinessDateSources): Promise<void> {
    let result: Awaited<ReturnType<typeof generateOpeningEntries>>;
    try {
      result = await generateOpeningEntries(openingInput(), {
        allowFiledYear: true,
        dateSettings: {
          formClose: businessCloseDate,
          expectedStoredClose: sources.settingClose?.value,
        },
      });
    } catch (e) {
      showWriteFailure(e);
      return;
    }
    if ('reason' in result) {
      if (result.reason === 'dates-changed') {
        error = m.opening_dates_changed();
        return;
      }
      error = m.opening_already_exists();
      redoOfferYear = Number(businessStartDate.slice(0, 4));
      return;
    }
    step = 'done';
  }
  async function runGuarded(work: () => Promise<void>): Promise<void> {
    if (preload.status !== 'ready' || generating) {
      return;
    }
    const blocked = blockingError();
    if (blocked !== '') {
      error = blocked;
      return;
    }
    generating = true;
    error = '';
    writeFailed = false;
    try {
      await work();
    } catch (e) {
      error = describeStorageError(e);
    } finally {
      generating = false;
    }
  }
  async function confirmAndCreate(sources: BusinessDateSources): Promise<void> {
    const year = Number(businessStartDate.slice(0, 4));
    const years = affectedYears([year, ...closeChangeYears(sources)]);
    if (!(await filedYearGuard.confirm(years, { detail: openingDetail() }))) {
      return;
    }
    await createOpening(sources);
  }
  // 入力の年に開業仕訳があれば作成（既存ありの案内へ）、無くてほかの年にあれば選んでもらい、どこにも無ければそのまま作る
  async function routeCreate(sources: BusinessDateSources, openingYears: number[]): Promise<void> {
    const year = Number(businessStartDate.slice(0, 4));
    const otherYears = openingYears.filter((y) => y !== year);
    if (!openingYears.includes(year) && otherYears.length > 0) {
      crossYear = { years: otherYears, latest: otherYears[otherYears.length - 1]! };
      crossYearOpen = true;
      return;
    }
    await confirmAndCreate(sources);
  }
  async function handleGenerate() {
    await runGuarded(async () => {
      await routeCreate(await readBusinessDateSources(), await readOpeningYears());
    });
  }
  async function chooseRestart() {
    crossYearOpen = false;
    await runGuarded(async () => {
      await confirmAndCreate(await readBusinessDateSources());
    });
  }
  function chooseChangeStart() {
    crossYearOpen = false;
    redoYear = crossYear.latest;
    redoConfirmOpen = true;
  }
  // 打ち消す年は押した時点のデータで決める。入力の年の開業仕訳が無くなっていれば作成と同じ流れにする
  async function openRedo() {
    const year = Number(businessStartDate.slice(0, 4));
    let openingYears: number[];
    try {
      openingYears = await readOpeningYears();
    } catch (e) {
      error = describeStorageError(e);
      return;
    }
    if (openingYears.includes(year)) {
      redoYear = year;
      redoConfirmOpen = true;
      return;
    }
    redoOfferYear = null;
    await handleGenerate();
  }
  // 1 つの年の開業仕訳を打ち消し、いまの入力で作る。打消し・作成・設定値の書き込みは 1 つの取引で行い、
  // 途中で止まれば何も変えない。確認は打ち消す前に 1 度だけ出す。ここでの読み取りは早めの判定で、決めるのは取引の中の読み直し
  async function handleRedo() {
    redoConfirmOpen = false;
    const reverseYear = redoYear;
    if (reverseYear === null) {
      return;
    }
    await runGuarded(async () => {
      const sources = await readBusinessDateSources();
      const openingYears = await readOpeningYears();
      if (!openingYears.includes(reverseYear)) {
        redoOfferYear = null;
        await routeCreate(sources, openingYears);
        return;
      }
      const createYear = Number(businessStartDate.slice(0, 4));
      const years = affectedYears([reverseYear, createYear, ...closeChangeYears(sources)]);
      if (!(await filedYearGuard.confirm(years, { detail: openingDetail() }))) {
        return;
      }
      let result: Awaited<ReturnType<typeof replaceOpeningEntries>>;
      try {
        result = await replaceOpeningEntries(
          {
            reverseYear,
            input: openingInput(),
            formClose: businessCloseDate,
            expectedStoredClose: sources.settingClose?.value,
          },
          { allowFiledYear: true },
        );
      } catch (e) {
        showWriteFailure(e);
        return;
      }
      if (!('reason' in result)) {
        redoOfferYear = null;
        step = 'done';
        return;
      }
      switch (result.reason) {
        case 'nothing-to-reverse':
          redoOfferYear = null;
          await routeCreate(await readBusinessDateSources(), await readOpeningYears());
          return;
        case 'already-exists':
          error = m.opening_already_exists();
          redoOfferYear = result.year;
          return;
        case 'has-depreciation':
          error = m.opening_redo_blocked({ assets: result.assetNames.join('、') });
          return;
        case 'empty':
          error = m.opening_redo_empty();
          return;
        case 'dates-changed':
          error = m.opening_dates_changed();
          return;
      }
    });
  }
  // 作り直しの途中で止まった年と、元に戻した年の登録し直す転用資産。ほかの画面での変更にも追従する
  let recovery = $state.raw<OpeningRecoveryState>({
    interrupted: [],
    dismissedYears: [],
    missing: [],
    assumed: [],
    dismissedAssets: [],
  });
  $effect(() => {
    const sub = liveQuery(() => readOpeningRecoveryState()).subscribe({
      next: (state) => {
        recovery = state;
      },
    });
    return () => sub.unsubscribe();
  });
  const visibleInterrupted = $derived(
    recovery.interrupted.filter((y) => !recovery.dismissedYears.includes(y)),
  );
  const hiddenInterruptedCount = $derived(recovery.interrupted.length - visibleInterrupted.length);
  const visibleMissing = $derived(
    recovery.missing.filter((x) => !recovery.dismissedAssets.includes(x.key)),
  );
  let recoveryMessage = $state('');
  let recoveryError = $state('');
  let recoveryBusy = $state(false);
  let restoreTarget = $state.raw<{ year: number; preview: OpeningRestorePreview } | null>(null);
  let restoreOpen = $state(false);
  let dismissOpen = $state(false);
  let dismissYear = $state<number | null>(null);
  function recoveryFailure(e: unknown): string {
    if (e instanceof OpeningRestoreAborted) {
      return e.reason === 'target-invalid'
        ? m.opening_restore_target_invalid()
        : m.opening_restore_amount_invalid();
    }
    return `${describeStorageError(e)} ${m.opening_nothing_changed()}`;
  }
  function restoreDateNotice(preview: OpeningRestorePreview): string {
    const setting = preview.settingStart;
    const differing = preview.entries.find((e) => e.date !== setting);
    return setting !== undefined && differing !== undefined
      ? m.opening_restore_date_differs({ entryDate: differing.date, settingDate: setting })
      : '';
  }
  async function openRestore(year: number): Promise<void> {
    recoveryMessage = '';
    recoveryError = '';
    try {
      restoreTarget = { year, preview: await previewInterruptedOpeningRestore(year) };
      restoreOpen = true;
    } catch (e) {
      recoveryError = recoveryFailure(e);
    }
  }
  async function confirmRestore(): Promise<void> {
    restoreOpen = false;
    const target = restoreTarget;
    if (target === null || recoveryBusy) {
      return;
    }
    recoveryBusy = true;
    try {
      if (!(await filedYearGuard.confirm(affectedYears([target.year])))) {
        return;
      }
      const result = await restoreInterruptedOpeningEntries(target.year, { allowFiledYear: true });
      if ('reason' in result) {
        recoveryError = m.opening_restore_not_interrupted();
        return;
      }
      recoveryMessage = m.opening_restore_success({ count: result.entryIds.length });
    } catch (e) {
      recoveryError = recoveryFailure(e);
    } finally {
      recoveryBusy = false;
    }
  }
  async function confirmDismiss(): Promise<void> {
    dismissOpen = false;
    const year = dismissYear;
    if (year === null) {
      return;
    }
    try {
      await dismissInterruptedOpeningYear(year);
    } catch (e) {
      recoveryError = describeStorageError(e);
    }
  }
  async function showHiddenYears(): Promise<void> {
    try {
      await showDismissedInterruptedOpeningYears();
    } catch (e) {
      recoveryError = describeStorageError(e);
    }
  }
  async function dismissAsset(key: string): Promise<void> {
    try {
      await dismissMissingOpeningAsset(key);
    } catch (e) {
      recoveryError = describeStorageError(e);
    }
  }
  let registeringKey = $state<string | null>(null);
  let regAcqDate = $state('');
  let regCost = $state('');
  let regLife = $state<number | undefined>(4);
  let regSmallAsset = $state(false);
  let regError = $state('');
  let regDiffers = $state('');
  function openRegister(target: MissingOpeningAsset): void {
    registeringKey = target.key;
    regAcqDate = '';
    regCost = '';
    regLife = 4;
    regSmallAsset = false;
    regError = '';
    regDiffers = '';
    recoveryMessage = '';
    recoveryError = '';
  }
  function resetRegisterChecks(): void {
    regError = '';
    regDiffers = '';
  }
  // 確認を通った後に、その明細がまだ足りないかを取引の中で数え直して登録する
  async function submitRegister(target: MissingOpeningAsset, acknowledged: boolean): Promise<void> {
    if (recoveryBusy) {
      return;
    }
    regError = '';
    const form = {
      acquisitionDate: regAcqDate,
      acquisitionCost: normalizeAmountInput(regCost),
      usefulLifeYears: regLife ?? Number.NaN,
      depreciationMethod:
        regSmallAsset && filingType === 'blue'
          ? ('small-asset-special' as const)
          : ('straight-line' as const),
    };
    let booked: string;
    try {
      booked = buildMissingOpeningAsset(target, form).conversionBasis!;
    } catch (e) {
      regError = e instanceof Error ? e.message : String(e);
      regDiffers = '';
      return;
    }
    // 帳簿の額（仕訳の金額）で登録する。入力から計算した額と違えば、両方を見せてから登録する
    const computed = computeConvertedAssetBasis(
      form.acquisitionDate,
      target.openingDate,
      form.acquisitionCost,
      form.usefulLifeYears,
    ).businessStartBasis;
    if (!acknowledged && !computed.eq(booked)) {
      regDiffers = m.opening_missing_assets_basis_differs({
        computed: formatJPY(computed),
        booked: formatJPY(booked),
      });
      return;
    }
    recoveryBusy = true;
    try {
      if (!(await filedYearGuard.confirm(affectedYears([target.year])))) {
        return;
      }
      const result = await registerMissingOpeningAsset({
        entryId: target.entryId,
        lineId: target.lineId,
        ...form,
      });
      registeringKey = null;
      if ('reason' in result) {
        recoveryError = m.opening_missing_assets_not_missing();
        return;
      }
      recoveryMessage = m.opening_missing_assets_registered({ name: target.name });
    } catch (e) {
      regError = recoveryFailure(e);
    } finally {
      recoveryBusy = false;
    }
  }
</script>

<div class="space-y-6">
  <div class="flex items-center justify-between">
    <h2 class="text-xl font-semibold">{m.opening_title()}</h2>
    <a href="/settings" use:link class="text-sm text-muted-foreground hover:text-foreground">
      {m.nav_settings()}
    </a>
  </div>
  <p class="text-sm text-muted-foreground">{m.opening_intro()}</p>
  {#if preload.status === 'failed'}
    <p class="text-sm text-destructive" role="alert">
      {m.opening_preload_failed({ reason: preload.reason })}
    </p>
  {/if}
  {#if visibleInterrupted.length > 0}
    <section
      data-testid="opening-interrupted-years"
      class="space-y-2 border border-amber-500/50 rounded-lg p-4 bg-card text-card-foreground"
    >
      <p class="text-sm">
        {m.opening_interrupted_years({ years: visibleInterrupted.join('、') })}
      </p>
      <ul class="space-y-1">
        {#each visibleInterrupted as year (year)}
          <li
            data-testid="opening-interrupted-year-{year}"
            class="flex flex-wrap items-center gap-2 text-sm"
          >
            <span class="tabular-nums font-medium">{year}</span>
            <button
              type="button"
              data-testid="opening-restore-{year}"
              disabled={recoveryBusy}
              onclick={() => openRestore(year)}
              class="px-3 py-1 border rounded hover:bg-accent disabled:opacity-50"
            >
              {m.opening_restore_button()}
            </button>
            <button
              type="button"
              data-testid="opening-dismiss-{year}"
              onclick={() => {
                dismissYear = year;
                dismissOpen = true;
              }}
              class="px-3 py-1 text-xs text-muted-foreground hover:text-foreground"
            >
              {m.opening_interrupted_dismiss()}
            </button>
          </li>
        {/each}
      </ul>
    </section>
  {/if}
  {#if hiddenInterruptedCount > 0}
    <button
      type="button"
      data-testid="opening-show-dismissed"
      onclick={showHiddenYears}
      class="text-xs text-muted-foreground hover:text-foreground underline"
    >
      {m.opening_interrupted_show_dismissed({ count: hiddenInterruptedCount })}
    </button>
  {/if}
  {#if recoveryMessage}
    <p data-testid="opening-recovery-message" class="text-sm text-green-600">{recoveryMessage}</p>
  {/if}
  {#if recoveryError}
    <p data-testid="opening-recovery-error" class="text-sm text-destructive" role="alert">
      {recoveryError}
    </p>
  {/if}
  {#if visibleMissing.length > 0 || recovery.assumed.length > 0}
    <section
      data-testid="opening-missing-assets"
      class="space-y-3 border rounded-lg p-6 bg-card text-card-foreground"
    >
      <h3 class="text-lg font-semibold">{m.opening_missing_assets_title()}</h3>
      <p class="text-xs text-muted-foreground">{m.opening_missing_assets_intro()}</p>
      {#if recovery.assumed.length > 0}
        <ul data-testid="opening-missing-assets-assumed" class="text-xs text-amber-600 space-y-0.5">
          {#each recovery.assumed as a, i (i)}
            <li>{m.opening_missing_assets_assumed({ name: a.name, date: a.acquisitionDate })}</li>
          {/each}
        </ul>
      {/if}
      <ul class="space-y-3">
        {#each visibleMissing as item (item.key)}
          {@const basis = missingOpeningAssetBasis(item)}
          <li data-testid="opening-missing-asset" class="border rounded p-3 text-sm space-y-2">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <span>
                {m.opening_missing_assets_row({
                  name: item.name,
                  year: item.year,
                  amount: basis !== undefined ? formatJPY(basis) : m.common_dash(),
                })}
              </span>
              <span class="flex items-center gap-3">
                {#if basis !== undefined && registeringKey !== item.key}
                  <button
                    type="button"
                    data-testid="opening-missing-asset-register"
                    onclick={() => openRegister(item)}
                    class="px-3 py-1 border rounded hover:bg-accent"
                  >
                    {m.opening_missing_assets_register()}
                  </button>
                {/if}
                <button
                  type="button"
                  data-testid="opening-missing-asset-dismiss"
                  onclick={() => dismissAsset(item.key)}
                  class="text-xs text-muted-foreground hover:text-foreground"
                >
                  {m.opening_missing_assets_dismiss()}
                </button>
              </span>
            </div>
            {#if basis === undefined}
              <p class="text-xs text-destructive">{m.opening_missing_assets_basis_unreadable()}</p>
            {:else if registeringKey === item.key}
              <form
                onsubmit={(e) => {
                  e.preventDefault();
                  submitRegister(item, false);
                }}
                class="space-y-2"
              >
                <p class="text-xs text-muted-foreground">
                  {m.opening_missing_assets_opening_date({ date: item.openingDate })}
                </p>
                <p class="text-xs text-muted-foreground">
                  {item.accountCode}
                  {DEPRECIABLE_ASSET_ACCOUNTS.find((a) => a.code === item.accountCode)?.name ?? ''}
                </p>
                <div class="flex flex-wrap gap-2 items-center">
                  <input
                    type="date"
                    name="missingAssetAcqDate"
                    autocomplete="off"
                    aria-label={m.opening_converted_acq_date_title()}
                    title={m.opening_converted_acq_date_title()}
                    value={regAcqDate}
                    oninput={assignInputString((v) => {
                      regAcqDate = v;
                      resetRegisterChecks();
                    })}
                    class="px-3 py-2 bg-background border rounded text-foreground text-sm tabular-nums supports-[-webkit-touch-callout:none]:appearance-none supports-[-webkit-touch-callout:none]:w-40 [&::-webkit-date-and-time-value]:text-left"
                  />
                  <input
                    type="number"
                    name="missingAssetCost"
                    autocomplete="off"
                    aria-label={m.settings_asset_cost_placeholder()}
                    placeholder={m.settings_asset_cost_placeholder()}
                    value={regCost}
                    oninput={assignInputString((v) => {
                      regCost = v;
                      resetRegisterChecks();
                    })}
                    min="0"
                    step="1"
                    class="flex-1 min-w-40 px-3 py-2 bg-background border rounded text-foreground text-sm tabular-nums text-right"
                  />
                  <input
                    type="number"
                    name="missingAssetLife"
                    autocomplete="off"
                    aria-label={m.settings_asset_life_title()}
                    title={m.settings_asset_life_title()}
                    value={regLife}
                    oninput={assignInputNumberOrEmpty((v) => {
                      regLife = v;
                      resetRegisterChecks();
                    })}
                    min="1"
                    step="1"
                    class="w-20 px-3 py-2 bg-background border rounded text-foreground text-sm tabular-nums"
                  />
                </div>
                {#if filingType === 'blue'}
                  <label class="flex items-start gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={regSmallAsset}
                      onchange={() => {
                        regSmallAsset = !regSmallAsset;
                        resetRegisterChecks();
                      }}
                    />
                    <span>{m.opening_small_asset_apply_label()}</span>
                  </label>
                {/if}
                {#if regError}
                  <p data-testid="opening-missing-asset-error" class="text-xs text-destructive">
                    {regError}
                  </p>
                {/if}
                {#if regDiffers}
                  <p
                    data-testid="opening-missing-asset-basis-differs"
                    class="text-xs text-amber-600"
                  >
                    {regDiffers}
                  </p>
                {/if}
                <div class="flex flex-wrap justify-end gap-2">
                  <button
                    type="button"
                    onclick={() => (registeringKey = null)}
                    class="px-3 py-1 border rounded hover:bg-accent"
                  >
                    {m.common_cancel()}
                  </button>
                  {#if regDiffers}
                    <button
                      type="button"
                      data-testid="opening-missing-asset-submit-anyway"
                      disabled={recoveryBusy}
                      onclick={() => submitRegister(item, true)}
                      class="px-3 py-1 bg-primary text-primary-foreground rounded hover:opacity-90 disabled:opacity-50"
                    >
                      {m.opening_missing_assets_submit_anyway()}
                    </button>
                  {:else}
                    <button
                      type="submit"
                      data-testid="opening-missing-asset-submit"
                      disabled={recoveryBusy}
                      class="px-3 py-1 bg-primary text-primary-foreground rounded hover:opacity-90 disabled:opacity-50"
                    >
                      {m.opening_missing_assets_register()}
                    </button>
                  {/if}
                </div>
              </form>
            {/if}
          </li>
        {/each}
      </ul>
    </section>
  {/if}

  {#if preload.status === 'loading'}
    <p class="text-sm text-muted-foreground">{m.opening_loading()}</p>
  {:else if step === 'form'}
    <section class="space-y-2 border rounded-lg p-6 bg-card text-card-foreground">
      <h3 class="text-lg font-semibold">{m.opening_start_date_title()}</h3>
      <input
        type="date"
        name="jigyoStartDate"
        autocomplete="off"
        aria-label={m.opening_start_date_title()}
        bind:value={businessStartDate}
        oninput={() => {
          redoOfferYear = null;
          error = '';
          writeFailed = false;
        }}
        class="px-3 py-2 bg-background border rounded text-foreground text-sm tabular-nums supports-[-webkit-touch-callout:none]:appearance-none supports-[-webkit-touch-callout:none]:w-40 [&::-webkit-date-and-time-value]:text-left"
      />
      <label class="block text-sm font-medium mt-4">
        {m.opening_business_close_date()}
        <input
          type="date"
          name="jigyoCloseDate"
          autocomplete="off"
          bind:value={businessCloseDate}
          class="px-3 py-2 bg-background border rounded text-foreground text-sm tabular-nums supports-[-webkit-touch-callout:none]:appearance-none supports-[-webkit-touch-callout:none]:w-40 [&::-webkit-date-and-time-value]:text-left"
        />
      </label>
      {#if datesInvalid}
        <p class="text-xs text-destructive">{m.opening_dates_invalid()}</p>
      {/if}
    </section>

    <section class="space-y-3 border rounded-lg p-6 bg-card text-card-foreground">
      <h3 class="text-lg font-semibold">{m.opening_expense_title()}</h3>
      <p class="text-xs text-muted-foreground">{m.opening_expense_intro()}</p>
      <form
        onsubmit={(e) => {
          e.preventDefault();
          addExpense();
        }}
        class="flex flex-wrap gap-2 items-center"
      >
        <input
          type="text"
          name="openingKeihiTitle"
          aria-label={m.opening_expense_name_placeholder()}
          autocomplete="off"
          bind:value={expenseName}
          placeholder={m.opening_expense_name_placeholder()}
          class="flex-1 min-w-40 px-3 py-2 bg-background border rounded text-foreground text-sm"
        />
        <input
          type="number"
          name="openingKeihiAmount"
          autocomplete="off"
          aria-label={m.opening_amount_placeholder()}
          value={expenseAmount}
          oninput={assignInputString((v) => (expenseAmount = v))}
          min="0"
          step="1"
          placeholder={m.opening_amount_placeholder()}
          class="w-32 px-3 py-2 bg-background border rounded text-foreground text-sm tabular-nums text-right"
        />
        <button
          type="submit"
          class="px-4 py-2 bg-primary text-primary-foreground rounded hover:opacity-90"
        >
          {m.settings_action_add()}
        </button>
      </form>
      {#if expenseAmountHint}
        <p class="text-xs text-destructive">{expenseAmountHint}</p>
      {/if}
      {#if expenses.length > 0}
        <ul class="text-sm divide-y divide-border/50">
          {#each expenses as ex, i}
            <li class="flex items-center justify-between py-1.5">
              <span>{ex.name}</span>
              <span class="flex items-center gap-3">
                <span class="font-mono">{formatJPY(ex.amount)}</span>
                <button
                  type="button"
                  onclick={() => removeExpense(i)}
                  class="text-xs text-destructive hover:underline"
                >
                  {m.settings_action_delete()}
                </button>
              </span>
            </li>
          {/each}
        </ul>
        <p class="text-sm font-semibold text-right">
          {m.opening_expense_total({ amount: formatJPY(String(expenseTotal)) })}
        </p>
        <div class="flex gap-4 text-sm">
          <label class="flex items-center gap-1">
            <input type="radio" bind:group={expenseAmortization} value="immediate" />
            {m.opening_expense_amortize_immediate()}
          </label>
          <label class="flex items-center gap-1">
            <input type="radio" bind:group={expenseAmortization} value="five-year" />
            {m.opening_expense_amortize_five_year()}
          </label>
          <label class="flex items-center gap-1">
            <input type="radio" bind:group={expenseAmortization} value="custom" />
            {m.opening_expense_amortize_custom()}
          </label>
        </div>
        {#if expenseAmortization === 'custom'}
          <input
            type="text"
            name="openingKeihiCustomAmortization"
            autocomplete="off"
            aria-label={m.opening_expense_custom_amount()}
            inputmode="numeric"
            value={customAmortizationAmount}
            oninput={assignInputString((v) => (customAmortizationAmount = v))}
            placeholder={m.opening_expense_custom_amount()}
            class="px-3 py-2 bg-background border rounded text-foreground text-sm tabular-nums w-40"
          />
          {#if isAmountInputInvalid(customAmortizationAmount)}
            <p class="text-xs text-destructive">{m.common_amount_invalid()}</p>
          {:else if isJournalAmountTooLarge(customAmortizationAmount)}
            <p class="text-xs text-destructive">{m.common_amount_too_large()}</p>
          {/if}
        {/if}
      {/if}
    </section>

    <section class="space-y-3 border rounded-lg p-6 bg-card text-card-foreground">
      <h3 class="text-lg font-semibold">{m.opening_converted_title()}</h3>
      <p class="text-xs text-muted-foreground">{m.opening_converted_intro()}</p>
      <form
        onsubmit={(e) => {
          e.preventDefault();
          addConvertedAsset();
        }}
        class="space-y-2"
      >
        <input
          type="text"
          name="convertedAssetTitle"
          aria-label={m.settings_asset_name_placeholder()}
          autocomplete="off"
          bind:value={newAssetName}
          placeholder={m.settings_asset_name_placeholder()}
          class="w-full px-3 py-2 bg-background border rounded text-foreground text-sm"
        />
        <div class="flex flex-wrap gap-2 items-center">
          <input
            type="date"
            name="convertedAssetAcquisitionDate"
            autocomplete="off"
            aria-label={m.opening_converted_acq_date_title()}
            bind:value={newAssetAcqDate}
            title={m.opening_converted_acq_date_title()}
            class="px-3 py-2 bg-background border rounded text-foreground text-sm tabular-nums supports-[-webkit-touch-callout:none]:appearance-none supports-[-webkit-touch-callout:none]:w-40 [&::-webkit-date-and-time-value]:text-left"
          />
          <input
            type="number"
            name="convertedAssetAcquisitionCost"
            autocomplete="off"
            aria-label={m.settings_asset_cost_placeholder()}
            value={newAssetCost}
            oninput={assignInputString((v) => (newAssetCost = v))}
            min="0"
            step="1"
            placeholder={m.settings_asset_cost_placeholder()}
            class="flex-1 min-w-40 px-3 py-2 bg-background border rounded text-foreground text-sm tabular-nums text-right"
          />
          <input
            type="number"
            name="convertedAssetUsefulLife"
            autocomplete="off"
            aria-label={m.settings_asset_life_title()}
            value={newAssetLife}
            oninput={assignInputNumberOrEmpty((v) => (newAssetLife = v))}
            min="1"
            step="1"
            title={m.settings_asset_life_title()}
            class="w-20 px-3 py-2 bg-background border rounded text-foreground text-sm tabular-nums"
          />
          <select
            bind:value={newAssetAccount}
            name="convertedAssetAccount"
            aria-label={m.settings_asset_account_title()}
            title={m.settings_asset_account_title()}
            class="px-3 py-2 bg-background border rounded text-foreground text-sm"
          >
            {#each DEPRECIABLE_ASSET_ACCOUNTS as acc (acc.code)}
              <option value={acc.code}>{acc.code} {acc.name}</option>
            {/each}
          </select>
          <button
            type="submit"
            class="ml-auto px-4 py-2 bg-primary text-primary-foreground rounded hover:opacity-90"
          >
            {m.settings_action_add()}
          </button>
        </div>
        {#if newAssetCostError}
          <p class="text-xs text-destructive">
            {m.settings_asset_cost_placeholder()}：{newAssetCostError}
          </p>
        {/if}
        {#if newAssetLifeError}
          <p class="text-xs text-destructive">
            {m.settings_asset_life_title()}：{newAssetLifeError}
          </p>
        {/if}
        {#if newAssetAcqDateError}
          <p class="text-xs text-destructive">{newAssetAcqDateError}</p>
        {/if}
      </form>
      {#if convertedAssets.length > 0}
        <ul class="space-y-3">
          {#each convertedAssets as row, i}
            {@const basis = assetBasis(row)}
            {@const basisResult = assetBasisResult(row)}
            <li class="border rounded p-3 text-sm space-y-1">
              <div class="flex items-center justify-between">
                <span class="font-medium">{row.name}</span>
                <button
                  type="button"
                  onclick={() => removeConvertedAsset(i)}
                  class="text-xs text-destructive hover:underline"
                >
                  {m.settings_action_delete()}
                </button>
              </div>
              {#if basisResult !== null && 'error' in basisResult}
                <p class="text-xs text-destructive">{basisResult.error}</p>
              {/if}
              {#if basis}
                <p class="text-muted-foreground">
                  {m.opening_converted_basis_result({
                    nonBusiness: formatJPY(basis.nonBusinessDepreciation.toString()),
                    basis: formatJPY(basis.businessStartBasis.toString()),
                  })}
                </p>
                {#if filingType === 'blue'}
                  {@const eligible = smallAssetEligibleByAcquisition(row)}
                  <label class="flex items-start gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={row.applySmallAssetSpecial && eligible}
                      disabled={!eligible}
                      onchange={() => toggleSmallAssetSpecial(row)}
                    />
                    <span>
                      {m.opening_small_asset_apply_label()}
                      <span class="text-muted-foreground">
                        {m.opening_small_asset_threshold_note({
                          threshold: formatJPY(String(smallAssetThreshold(row.acquisitionDate))),
                        })}
                      </span>
                    </span>
                  </label>
                  <p class="text-xs text-amber-600">{m.opening_gray_area_warning()}</p>
                {/if}
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
    </section>

    <section class="border rounded-lg p-6 bg-card text-card-foreground">
      <button
        type="button"
        class="text-sm font-semibold"
        onclick={() => (showInventory = !showInventory)}
      >
        {showInventory ? '▾' : '▸'}
        {m.opening_inventory_title()}
      </button>
      {#if showInventory}
        <p class="text-xs text-muted-foreground mt-2">{m.opening_inventory_hint()}</p>
      {/if}
    </section>

    <section class="border rounded-lg p-6 bg-card text-card-foreground">
      <button
        type="button"
        class="text-sm font-semibold"
        onclick={() => (showDeposit = !showDeposit)}
      >
        {showDeposit ? '▾' : '▸'}
        {m.opening_deposit_title()}
      </button>
      {#if showDeposit}
        <p class="text-xs text-muted-foreground mt-2">{m.opening_deposit_hint()}</p>
      {/if}
    </section>

    <section class="space-y-3 border rounded-lg p-6 bg-card text-card-foreground">
      <h3 class="text-lg font-semibold">{m.opening_custom_title()}</h3>
      <form
        onsubmit={(e) => {
          e.preventDefault();
          addCustomItem();
        }}
        class="flex flex-wrap gap-2 items-center"
      >
        <input
          type="text"
          name="customItemTitle"
          aria-label={m.opening_custom_name_placeholder()}
          autocomplete="off"
          bind:value={customName}
          placeholder={m.opening_custom_name_placeholder()}
          class="flex-1 min-w-32 px-3 py-2 bg-background border rounded text-foreground text-sm"
        />
        <select
          bind:value={customAccount}
          name="customItemAccount"
          aria-label={m.opening_custom_account_placeholder()}
          class="px-3 py-2 bg-background border rounded text-foreground text-sm"
        >
          <option value="">{m.opening_custom_account_placeholder()}</option>
          {#each ledger.allAccounts as a (a.code)}
            <option value={a.code}>{a.code} {a.name}</option>
          {/each}
        </select>
        <select
          bind:value={customSide}
          name="customItemSide"
          aria-label={m.opening_custom_side_label()}
          class="px-3 py-2 bg-background border rounded text-foreground text-sm"
        >
          <option value="debit">{m.opening_custom_side_debit()}</option>
          <option value="credit">{m.opening_custom_side_credit()}</option>
        </select>
        <input
          type="number"
          name="customItemAmount"
          autocomplete="off"
          aria-label={m.opening_amount_placeholder()}
          value={customAmount}
          oninput={assignInputString((v) => (customAmount = v))}
          min="0"
          step="1"
          placeholder={m.opening_amount_placeholder()}
          class="w-32 px-3 py-2 bg-background border rounded text-foreground text-sm tabular-nums text-right"
        />
        <button
          type="submit"
          class="px-4 py-2 bg-primary text-primary-foreground rounded hover:opacity-90"
        >
          {m.settings_action_add()}
        </button>
      </form>
      {#if customAmountHint}
        <p class="text-xs text-destructive">{customAmountHint}</p>
      {/if}
      {#if customItems.length > 0}
        <ul class="text-sm divide-y divide-border/50">
          {#each customItems as c, i}
            <li class="flex items-center justify-between py-1.5">
              <span>{c.name}（{c.accountCode}）</span>
              <span class="flex items-center gap-3">
                <span class="font-mono">{formatJPY(c.amount)}</span>
                <button
                  type="button"
                  onclick={() => removeCustomItem(i)}
                  class="text-xs text-destructive hover:underline"
                >
                  {m.settings_action_delete()}
                </button>
              </span>
            </li>
          {/each}
        </ul>
      {/if}
    </section>

    <div class="flex justify-end">
      <button
        type="button"
        disabled={!hasAnyItem || datesInvalid}
        onclick={() => (step = 'preview')}
        class="px-6 py-2 bg-primary text-primary-foreground rounded hover:opacity-90 disabled:opacity-50"
      >
        {m.opening_action_preview()}
      </button>
    </div>
  {:else if step === 'preview'}
    <section class="space-y-3 border rounded-lg p-6 bg-card text-card-foreground">
      <h3 class="text-lg font-semibold">{m.opening_preview_title()}</h3>
      {#if expenses.length > 0}
        <p class="text-sm">
          {m.opening_preview_expense({ amount: formatJPY(String(expenseTotal)) })}
        </p>
      {/if}
      {#if convertedAssets.length > 0}
        <p class="text-sm">{m.opening_preview_assets({ count: convertedAssets.length })}</p>
      {/if}
      {#if customItems.length > 0}
        <p class="text-sm">{m.opening_preview_custom({ count: customItems.length })}</p>
      {/if}
      {#if closeReplaceNotice}
        <p class="text-sm text-amber-600">{closeReplaceNotice}</p>
      {/if}
      {#if convertedAssetErrors.length > 0}
        <p class="text-sm text-destructive">{convertedAssetErrors.join(' / ')}</p>
      {:else if error}
        <p data-testid="opening-error" class="text-sm text-destructive">{error}</p>
        {#if writeFailed}
          <p
            data-testid="opening-write-failed-nothing-changed"
            class="text-sm text-muted-foreground"
          >
            {m.opening_write_failed_nothing_changed()}
          </p>
        {/if}
      {/if}
      {#if canRedo}
        <button
          type="button"
          onclick={openRedo}
          disabled={generating || preload.status !== 'ready'}
          class="px-4 py-2 border rounded hover:bg-accent disabled:opacity-50"
        >
          {m.opening_redo_button()}
        </button>
      {/if}
      <div class="flex justify-end gap-2">
        <button
          type="button"
          onclick={() => (step = 'form')}
          class="px-4 py-2 border rounded hover:bg-accent"
        >
          {m.opening_action_back()}
        </button>
        <button
          type="button"
          disabled={generating ||
            convertedAssetErrors.length > 0 ||
            datesInvalid ||
            preload.status !== 'ready'}
          onclick={handleGenerate}
          class="px-4 py-2 bg-primary text-primary-foreground rounded hover:opacity-90 disabled:opacity-50"
        >
          {m.opening_action_confirm()}
        </button>
      </div>
    </section>
  {:else}
    <section class="space-y-3 border rounded-lg p-6 bg-card text-card-foreground text-center">
      <p class="text-sm">{m.opening_done_message()}</p>
      <a
        href="/journal"
        use:link
        class="inline-block px-4 py-2 bg-primary text-primary-foreground rounded hover:opacity-90"
      >
        {m.nav_journal()}
      </a>
    </section>
  {/if}
</div>

<AlertDialog.Root
  open={redoConfirmOpen}
  onOpenChange={(o: boolean) => {
    if (!o) {
      redoConfirmOpen = false;
    }
  }}
>
  <AlertDialog.Content>
    <AlertDialog.Header>
      <AlertDialog.Title>{m.opening_redo_confirm_title()}</AlertDialog.Title>
      <AlertDialog.Description>
        {m.opening_redo_confirm_desc({
          reverseYear: redoYear ?? Number(businessStartDate.slice(0, 4)),
          createYear: Number(businessStartDate.slice(0, 4)),
        })}
      </AlertDialog.Description>
    </AlertDialog.Header>
    <AlertDialog.Footer>
      <AlertDialog.Cancel>{m.common_cancel()}</AlertDialog.Cancel>
      <AlertDialog.Action onclick={handleRedo}>
        {m.opening_redo_confirm_action()}
      </AlertDialog.Action>
    </AlertDialog.Footer>
  </AlertDialog.Content>
</AlertDialog.Root>

<AlertDialog.Root
  open={crossYearOpen}
  onOpenChange={(o: boolean) => {
    if (!o) {
      crossYearOpen = false;
    }
  }}
>
  <AlertDialog.Content>
    <AlertDialog.Header>
      <AlertDialog.Title>{m.opening_cross_year_title()}</AlertDialog.Title>
      <AlertDialog.Description>
        {m.opening_cross_year_desc({
          years: crossYear.years.join('、'),
          year: Number(businessStartDate.slice(0, 4)),
        })}
      </AlertDialog.Description>
    </AlertDialog.Header>
    <AlertDialog.Footer>
      <AlertDialog.Cancel>{m.common_cancel()}</AlertDialog.Cancel>
      <AlertDialog.Action onclick={chooseRestart}>
        {m.opening_cross_year_restart({ year: crossYear.latest })}
      </AlertDialog.Action>
      <AlertDialog.Action onclick={chooseChangeStart}>
        {m.opening_cross_year_change({ year: crossYear.latest })}
      </AlertDialog.Action>
    </AlertDialog.Footer>
  </AlertDialog.Content>
</AlertDialog.Root>

<AlertDialog.Root
  open={restoreOpen}
  onOpenChange={(o: boolean) => {
    if (!o) {
      restoreOpen = false;
    }
  }}
>
  <AlertDialog.Content>
    <AlertDialog.Header>
      <AlertDialog.Title>
        {m.opening_restore_confirm_title({ year: restoreTarget?.year ?? 0 })}
      </AlertDialog.Title>
      <AlertDialog.Description>
        {m.opening_restore_confirm_desc()}
      </AlertDialog.Description>
    </AlertDialog.Header>
    {#if restoreTarget !== null}
      <ul data-testid="opening-restore-confirm" class="text-sm space-y-0.5">
        {#each restoreTarget.preview.entries as e (e.id)}
          <li>
            {m.opening_restore_entry_row({
              description: e.description,
              amount: e.amount !== undefined ? formatJPY(e.amount) : m.common_dash(),
            })}
          </li>
        {/each}
      </ul>
      {#if restoreDateNotice(restoreTarget.preview)}
        <p class="text-sm text-amber-600">{restoreDateNotice(restoreTarget.preview)}</p>
      {/if}
    {/if}
    <AlertDialog.Footer>
      <AlertDialog.Cancel>{m.common_cancel()}</AlertDialog.Cancel>
      <AlertDialog.Action data-testid="opening-restore-confirm-action" onclick={confirmRestore}>
        {m.opening_restore_confirm_action()}
      </AlertDialog.Action>
    </AlertDialog.Footer>
  </AlertDialog.Content>
</AlertDialog.Root>

<AlertDialog.Root
  open={dismissOpen}
  onOpenChange={(o: boolean) => {
    if (!o) {
      dismissOpen = false;
    }
  }}
>
  <AlertDialog.Content>
    <AlertDialog.Header>
      <AlertDialog.Title>
        {m.opening_interrupted_dismiss_confirm_title({ year: dismissYear ?? 0 })}
      </AlertDialog.Title>
      <AlertDialog.Description>
        {m.opening_interrupted_dismiss_confirm_desc()}
      </AlertDialog.Description>
    </AlertDialog.Header>
    <AlertDialog.Footer>
      <AlertDialog.Cancel>{m.common_cancel()}</AlertDialog.Cancel>
      <AlertDialog.Action data-testid="opening-dismiss-confirm-action" onclick={confirmDismiss}>
        {m.opening_interrupted_dismiss()}
      </AlertDialog.Action>
    </AlertDialog.Footer>
  </AlertDialog.Content>
</AlertDialog.Root>
