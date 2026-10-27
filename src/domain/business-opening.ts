import { D, Decimal, formatJPY, toAmountString, toIndexable } from '../lib/decimal';
import { db } from '../db/db';
import { newId } from '../lib/id';
import { countsTowardTotals, validateLines } from './journal';
import { assertYearsWritable, markConfirmedWrite } from './year-lock';
import { calendarMonthsCeil, isSmallAssetEligible } from '../tax-schema/2026/limits';
import { DEPRECIABLE_ASSET_ACCOUNTS } from '../tax-schema/2026/accounts';
import { isValidIsoDate } from '../lib/date';
import { parseAmountInput, readStoredAmount } from '../lib/amount-input';
import { deleteSetting, getSetting, setSetting } from '../lib/settings';
import type { DepreciationMethod, FixedAsset, JournalEntry, JournalLine } from '../db/types';
import { InvalidFixedAssetError, validateFixedAsset } from './fixed-asset-check';
import { readStoredBusinessDate, sameStoredBusinessDate } from './depreciation';
import { m } from '../paraglide/messages';

const KAIGYOHI_CODE = '1530'; // 開業費
const CAPITAL_CODE = '3110'; // 元入金
const DEPRECIATION_EXPENSE_CODE = '5210'; // 減価償却費（繰延資産の償却もここに計上）
// 開業仕訳の転用資産の明細の memo。登録し直す資産を元に戻した仕訳から探すときも使う
export const CONVERTED_ASSET_MEMO_PREFIX = '転用資産：';
// 作り直しの途中で止まった年の開業仕訳を元に戻した仕訳の説明の先頭。資産タグ（#＋8 文字）と紛れない
export const OPENING_RESTORE_PREFIX = '[再計上] ';
// 所令137条1項1号：開業費は 60 で除し業務を行っていた期間の月数を乗じる。
const OPENING_EXPENSE_MONTHS = 60;
// 非業務用（私用）資産を業務の用に供した場合の未償却残高計算（所得税法施行令第135条・136条準拠）。
// 国税庁タックスアンサー No.2108「中古資産を非業務用から業務用に転用した場合の減価償却」に基づく。
// 手順：①耐用年数×1.5 の年数で旧定額法償却率を引く ②非業務期間（6ヶ月未満切り捨て・6ヶ月以上は1年）
// に応じた減価の額を計算 ③取得価額から控除した額が転用時点の未償却残高。
// 旧定額法償却率表（耐用年数 2〜100 年）。減価償却資産の耐用年数等に関する省令
// （昭和40年大蔵省令第15号）別表第七「旧定額法の償却率」。引くときのキーは
// 耐用年数×1.5 なので、木造22年→33・鉄筋47年→70 まで必要になる。
const OLD_STRAIGHT_LINE_RATE: Record<number, string> = {
  2: '0.500',
  3: '0.333',
  4: '0.250',
  5: '0.200',
  6: '0.166',
  7: '0.142',
  8: '0.125',
  9: '0.111',
  10: '0.100',
  11: '0.090',
  12: '0.083',
  13: '0.076',
  14: '0.071',
  15: '0.066',
  16: '0.062',
  17: '0.058',
  18: '0.055',
  19: '0.052',
  20: '0.050',
  21: '0.048',
  22: '0.046',
  23: '0.044',
  24: '0.042',
  25: '0.040',
  26: '0.039',
  27: '0.037',
  28: '0.036',
  29: '0.035',
  30: '0.034',
  31: '0.033',
  32: '0.032',
  33: '0.031',
  34: '0.030',
  35: '0.029',
  36: '0.028',
  37: '0.027',
  38: '0.027',
  39: '0.026',
  40: '0.025',
  41: '0.025',
  42: '0.024',
  43: '0.024',
  44: '0.023',
  45: '0.023',
  46: '0.022',
  47: '0.022',
  48: '0.021',
  49: '0.021',
  50: '0.020',
  51: '0.020',
  52: '0.020',
  53: '0.019',
  54: '0.019',
  55: '0.019',
  56: '0.018',
  57: '0.018',
  58: '0.018',
  59: '0.017',
  60: '0.017',
  61: '0.017',
  62: '0.017',
  63: '0.016',
  64: '0.016',
  65: '0.016',
  66: '0.016',
  67: '0.015',
  68: '0.015',
  69: '0.015',
  70: '0.015',
  71: '0.014',
  72: '0.014',
  73: '0.014',
  74: '0.014',
  75: '0.014',
  76: '0.014',
  77: '0.013',
  78: '0.013',
  79: '0.013',
  80: '0.013',
  81: '0.013',
  82: '0.013',
  83: '0.012',
  84: '0.012',
  85: '0.012',
  86: '0.012',
  87: '0.012',
  88: '0.012',
  89: '0.012',
  90: '0.012',
  91: '0.011',
  92: '0.011',
  93: '0.011',
  94: '0.011',
  95: '0.011',
  96: '0.011',
  97: '0.011',
  98: '0.011',
  99: '0.011',
  100: '0.010',
};
// 耐用年数×1.5 は 1 年未満切り捨て（国税庁の年数の丸め方に準拠）。
function extendedUsefulLife(usefulLifeYears: number): number {
  return Math.floor(usefulLifeYears * 1.5);
}
export function hasOldStraightLineRate(usefulLifeYears: number): boolean {
  return OLD_STRAIGHT_LINE_RATE[usefulLifeYears] !== undefined;
}
// 転用資産の未償却残高は耐用年数×1.5 の旧定額法償却率で求めるため、率表（2〜100 年）に収まる耐用年数だけ扱える
export function isConvertedAssetLifeSupported(usefulLifeYears: number): boolean {
  return (
    Number.isInteger(usefulLifeYears) && hasOldStraightLineRate(extendedUsefulLife(usefulLifeYears))
  );
}

export function oldStraightLineRate(usefulLifeYears: number): Decimal {
  const rate = OLD_STRAIGHT_LINE_RATE[usefulLifeYears];
  if (rate === undefined) {
    throw new Error(m.error_old_straight_line_rate_undefined({ years: usefulLifeYears }));
  }
  return D(rate);
}
interface YMD {
  y: number;
  m: number;
  d: number;
}
function parseYMD(iso: string): YMD {
  const [y, m, d] = iso.split('-').map(Number);
  return { y: y ?? 0, m: m ?? 0, d: d ?? 0 };
}
// 取得日から供用日までの満了月数。応当日（取得日の「日」）に達していない月は満了に数えない。
// 応当日が存在しない月（例：1/31 取得の 2 月）は民法の期間計算に従いその月の末日を満期日とする。
function elapsedFullMonths(acq: YMD, start: YMD): number {
  let months = (start.y - acq.y) * 12 + (start.m - acq.m);
  // 供用日の属する月の末日（1 始まりの月をそのまま渡すと翌月 0 日＝当月末日になる）。
  const lastDayOfStartMonth = new Date(start.y, start.m, 0).getDate();
  const anniversaryDay = Math.min(acq.d, lastDayOfStartMonth);
  if (start.d < anniversaryDay) {
    months -= 1;
  }
  return months;
}
// 非業務期間の年数。6ヶ月未満切り捨て、6ヶ月以上は1年に切り上げ。
function nonBusinessPeriodYears(acquisitionDate: string, businessStartDate: string): number {
  const totalMonths = elapsedFullMonths(parseYMD(acquisitionDate), parseYMD(businessStartDate));
  const years = Math.floor(totalMonths / 12);
  const remainderMonths = totalMonths % 12;
  return remainderMonths >= 6 ? years + 1 : years;
}
interface ConvertedAssetBasis {
  nonBusinessDepreciation: Decimal;
  businessStartBasis: Decimal;
}
// 非業務用期間の減価の額の上限（所令85条1項の第2文が所令134条1項1号イ「償却累積額による
// 償却費の特例」を参照）。国税庁タックスアンサー No.2108 も同じ閾値を書いている。
const NON_BUSINESS_DEPRECIATION_LIMIT_RATE = '0.95';
// 私用資産を事業供用日時点の未償却残高に変換する。
export function computeConvertedAssetBasis(
  acquisitionDate: string,
  businessStartDate: string,
  acquisitionCost: string,
  usefulLifeYears: number,
): ConvertedAssetBasis {
  if (!isValidIsoDate(acquisitionDate)) {
    throw new Error(m.fixed_asset_issue_date({ field: m.opening_converted_acq_date_title() }));
  }
  if (!isValidIsoDate(businessStartDate)) {
    throw new Error(m.fixed_asset_issue_date({ field: m.opening_start_date_title() }));
  }
  // 開業後に取得した資産を転用資産にすると、私用期間が負になり未償却残高が取得価額を超える
  if (acquisitionDate > businessStartDate) {
    throw new Error(m.opening_asset_acquired_after_start({ acquisitionDate, businessStartDate }));
  }
  const extendedLife = extendedUsefulLife(usefulLifeYears);
  const rate = oldStraightLineRate(extendedLife);
  const years = nonBusinessPeriodYears(acquisitionDate, businessStartDate);
  const cost = D(acquisitionCost);
  const raw = cost.times('0.9').times(rate).times(years).toDecimalPlaces(0, Decimal.ROUND_DOWN);
  // 上限が無いと保有期間が長い資産で控除額が取得価額を超え、未償却残高が負になる。
  const limit = cost
    .times(NON_BUSINESS_DEPRECIATION_LIMIT_RATE)
    .toDecimalPlaces(0, Decimal.ROUND_DOWN);
  const nonBusinessDepreciation = Decimal.min(raw, limit);
  const businessStartBasis = cost.minus(nonBusinessDepreciation);
  return { nonBusinessDepreciation, businessStartBasis };
}
// 開業費（繰延資産）の開業年の償却額。月数は開業日から年末まで、1 月未満は 1 月（所令137条2項）。
export function openingExpenseAmortization(
  expenseTotal: Decimal,
  businessStartDate: string,
  method: ExpenseAmortization,
  customAmount?: string,
): Decimal {
  if (method === 'immediate') {
    return expenseTotal;
  }
  if (method === 'custom') {
    const amount = D(customAmount ?? '0');
    return Decimal.max(0, Decimal.min(amount, expenseTotal));
  }
  const year = Number(businessStartDate.slice(0, 4));
  const months = calendarMonthsCeil(businessStartDate, `${year + 1}-01-01`);
  const amount = expenseTotal
    .times(months)
    .dividedBy(OPENING_EXPENSE_MONTHS)
    .toDecimalPlaces(0, Decimal.ROUND_DOWN);
  return Decimal.min(amount, expenseTotal);
}

interface OpeningExpenseItem {
  name: string;
  amount: string;
}
// five-year：所令137条1項1号（÷60×業務月数）。custom：同条3項の任意償却（金額は customAmortizationAmount）。
export type ExpenseAmortization = 'immediate' | 'five-year' | 'custom';
interface OpeningConvertedAsset {
  name: string;
  acquisitionDate: string;
  acquisitionCost: string;
  usefulLifeYears: number;
  accountCode: string;
  depreciationMethod: DepreciationMethod;
}
export interface OpeningCustomItem {
  name: string;
  amount: string;
  accountCode: string;
  side: 'debit' | 'credit';
}
export interface OpeningSetupInput {
  businessStartDate: string;
  expenses: OpeningExpenseItem[];
  expenseAmortization: ExpenseAmortization;
  /** expenseAmortization === 'custom' のときの当年償却額。開業費の額を上限とする */
  customAmortizationAmount?: string;
  convertedAssets: OpeningConvertedAsset[];
  customItems: OpeningCustomItem[];
}
export interface OpeningSetupResult {
  entryIds: string[];
  assetIds: string[];
}
function newLine(
  entryId: string,
  side: 'debit' | 'credit',
  accountCode: string,
  amount: Decimal,
  memo: string,
): JournalLine {
  return {
    id: newId(),
    entryId,
    side,
    accountCode,
    amount: toAmountString(amount),
    amountIndexed: toIndexable(amount),
    taxRate: 0,
    taxIncluded: false,
    invoiceCompliant: false,
    memo,
  };
}
function newEntry(date: string, description: string, now: number): JournalEntry {
  const year = Number(date.slice(0, 4));
  return {
    id: newId(),
    date,
    year,
    description,
    status: 'confirmed',
    source: 'opening',
    createdAt: now,
    confirmedAt: now,
  };
}
type OpeningReplaceAbortReason =
  'nothing-to-reverse' | 'already-exists' | 'empty' | 'dates-changed';
// 取引の中で書き込みを始めた後に成功以外で終わるときに投げる。投げれば取引ごと取り消される
export class OpeningReplaceAborted extends Error {
  readonly reason: OpeningReplaceAbortReason;
  constructor(reason: OpeningReplaceAbortReason) {
    super(reason);
    this.name = 'OpeningReplaceAborted';
    this.reason = reason;
  }
}
async function hasOpeningEntries(year: number): Promise<boolean> {
  const found = await db.journalEntries
    .where('year')
    .equals(year)
    .filter((e) => e.source === 'opening' && countsTowardTotals(e))
    .first();
  return found !== undefined;
}
// 取引の中から呼ぶ。開業費・転用資産・自由項目をまとめて仕訳・固定資産登録として書き込む。
// 転用資産は本体（固定資産テーブルへの登録）のみ行い、以後の減価償却は既存の
// 年末一括生成（generateYearEndDepreciation）に委ねる。ここでは開業時点の
// 未償却残高を計上する開業仕訳のみを作る。
async function createOpeningInTx(
  input: OpeningSetupInput,
  date: string,
  now: number,
): Promise<OpeningSetupResult | { reason: 'already-exists' }> {
  const entryIds: string[] = [];
  const assetIds: string[] = [];
  const year = Number(date.slice(0, 4));
  // 二度押しで開業費・転用資産が倍になり、固定資産ももう一組登録されるのを防ぐ。
  // 書き込みと同一トランザクション内で判定する（applyCarryover と同じ既存判定）。
  if (await hasOpeningEntries(year)) {
    return { reason: 'already-exists' };
  }
  // 開業費（繰延資産）
  const expenseTotal = input.expenses.reduce((sum, e) => sum.plus(D(e.amount)), D(0));
  if (!expenseTotal.isZero()) {
    const entry = newEntry(date, '開業費計上（開業設定）', now);
    const lines = [
      newLine(entry.id, 'debit', KAIGYOHI_CODE, expenseTotal, '開業費'),
      newLine(entry.id, 'credit', CAPITAL_CODE, expenseTotal, '開業費（元入金）'),
    ];
    await db.journalEntries.add(entry);
    await db.journalLines.bulkAdd(lines);
    entryIds.push(entry.id);

    const amortized = openingExpenseAmortization(
      expenseTotal,
      date,
      input.expenseAmortization,
      input.customAmortizationAmount,
    );
    if (!amortized.isZero()) {
      const amortEntry = newEntry(date, '開業費償却（開業設定）', now);
      const amortLines = [
        newLine(amortEntry.id, 'debit', DEPRECIATION_EXPENSE_CODE, amortized, '繰延資産償却'),
        newLine(amortEntry.id, 'credit', KAIGYOHI_CODE, amortized, '開業費償却'),
      ];
      await db.journalEntries.add(amortEntry);
      await db.journalLines.bulkAdd(amortLines);
      entryIds.push(amortEntry.id);
    }
  }
  // 転用資産・自由項目 → 1本の開業仕訳にまとめ、元入金で貸借を合わせる
  const assetLines: Array<{
    side: 'debit' | 'credit';
    accountCode: string;
    amount: Decimal;
    memo: string;
  }> = [];
  for (const asset of input.convertedAssets) {
    let basis: ReturnType<typeof computeConvertedAssetBasis>;
    try {
      basis = computeConvertedAssetBasis(
        asset.acquisitionDate,
        date,
        asset.acquisitionCost,
        asset.usefulLifeYears,
      );
    } catch (e) {
      throw new Error(
        m.fixed_asset_invalid({
          name: asset.name,
          reasons: e instanceof Error ? e.message : String(e),
        }),
        { cause: e },
      );
    }
    const fixedAsset: FixedAsset = {
      id: newId(),
      name: asset.name,
      acquisitionDate: asset.acquisitionDate,
      acquisitionCost: asset.acquisitionCost,
      usefulLifeYears: asset.usefulLifeYears,
      depreciationMethod: asset.depreciationMethod,
      accountCode: asset.accountCode,
      source: 'opening',
      conversionBasis: toAmountString(basis.businessStartBasis),
      serviceStartDate: date,
      openingYear: year,
    };
    // 減価償却・.xtx が読めない形の資産を書かない。投げるとトランザクションごと取り消される
    const issues = validateFixedAsset(fixedAsset);
    if (issues.length > 0) {
      throw new InvalidFixedAssetError([{ asset: fixedAsset, issues }]);
    }
    await db.fixedAssets.add(fixedAsset);
    assetIds.push(fixedAsset.id);
    if (!basis.businessStartBasis.isZero()) {
      assetLines.push({
        side: 'debit',
        accountCode: asset.accountCode,
        amount: basis.businessStartBasis,
        memo: `${CONVERTED_ASSET_MEMO_PREFIX}${asset.name}`,
      });
    }
  }
  for (const item of input.customItems) {
    const amount = D(item.amount);
    if (amount.isZero()) {
      continue;
    }
    assetLines.push({ side: item.side, accountCode: item.accountCode, amount, memo: item.name });
  }
  if (assetLines.length > 0) {
    const entry = newEntry(date, '開業時資産計上（開業設定）', now);
    const netDebit = assetLines.reduce(
      (sum, l) => (l.side === 'debit' ? sum.plus(l.amount) : sum.minus(l.amount)),
      D(0),
    );
    const lines = assetLines.map((l) => newLine(entry.id, l.side, l.accountCode, l.amount, l.memo));
    if (!netDebit.isZero()) {
      const capitalSide = netDebit.isPositive() ? 'credit' : 'debit';
      lines.push(newLine(entry.id, capitalSide, CAPITAL_CODE, netDebit.abs(), '開業（元入金）'));
    }
    await db.journalEntries.add(entry);
    await db.journalLines.bulkAdd(lines);
    entryIds.push(entry.id);
  }
  return { entryIds, assetIds };
}
// 取引の中から呼ぶ。開業日は入力の値を書く。廃業日は入力があれば書き、空欄なら開業日以後の保存済みの値は消し、
// それより前（再開業前の廃業日）と読めない値は残す。申告済みの確認に出した年は確認の前に読んだ廃業日で数えているので、
// 取引の中で読んだ値が違えば書かない
async function writeOpeningDateSettingsInTx(
  formStart: string,
  formClose: string,
  expectedStoredClose: unknown,
): Promise<void> {
  const storedClose: unknown = await getSetting('businessCloseDate');
  if (!sameStoredBusinessDate(storedClose, expectedStoredClose)) {
    throw new OpeningReplaceAborted('dates-changed');
  }
  await setSetting('businessStartDate', formStart);
  if (formClose !== '') {
    await setSetting('businessCloseDate', formClose);
    return;
  }
  const stored = readStoredBusinessDate(storedClose);
  if (stored?.valid === true && String(stored.value) >= formStart) {
    await deleteSetting('businessCloseDate');
  }
}
export interface OpeningDateSettings {
  /** 入力の廃業日。空文字列は空欄 */
  formClose: string;
  /** 確認の前に読んだ保存済みの廃業日（元の値のまま） */
  expectedStoredClose: unknown;
}
// 開業設定：開業費・転用資産・自由項目をまとめて仕訳・固定資産登録として書き込む。
// dateSettings を渡すと、開業日・廃業日の設定値も同じ取引で書く（作らなかったときは書かない）。
export async function generateOpeningEntries(
  input: OpeningSetupInput,
  options?: { allowFiledYear?: boolean; dateSettings?: OpeningDateSettings },
): Promise<OpeningSetupResult | { reason: 'already-exists' } | { reason: 'dates-changed' }> {
  const date = input.businessStartDate;
  const year = Number(date.slice(0, 4));
  await assertYearsWritable([year], options);
  try {
    return await db.transaction(
      'rw',
      db.journalEntries,
      db.journalLines,
      db.fixedAssets,
      db.settings,
      async () => {
        markConfirmedWrite(options);
        const created = await createOpeningInTx(input, date, Date.now());
        if ('reason' in created) {
          return created;
        }
        if (options?.dateSettings !== undefined) {
          await writeOpeningDateSettingsInTx(
            date,
            options.dateSettings.formClose,
            options.dateSettings.expectedStoredClose,
          );
        }
        return created;
      },
    );
  } catch (e) {
    if (e instanceof OpeningReplaceAborted && e.reason === 'dates-changed') {
      return { reason: 'dates-changed' };
    }
    throw e;
  }
}
// 開業設定で作った有効な開業仕訳のある年。generateOpeningEntries・removeOpeningEntries と同じく year の値で数え、日付が読めなくても数える
export async function readOpeningYears(): Promise<number[]> {
  const years = new Set<number>();
  await db.journalEntries.each((e) => {
    if (e.source === 'opening' && countsTowardTotals(e)) {
      years.add(e.year);
    }
  });
  return [...years].sort((a, b) => a - b);
}

interface OpeningRemovalBlocked {
  reason: 'has-depreciation';
  assetNames: string[];
}
// 取引の中から呼ぶ。開業仕訳は打消し仕訳で相殺し（確定仕訳は物理削除しない＝電子帳簿
// 保存法。removeCarryover と同じ方式）、開業設定が登録した固定資産は取り除く。
//
// 固定資産は仕訳ではないので打ち消せず、削除するしかない。ところが減価償却・除却の仕訳は
// description の資産タグ（#<id 先頭 8 文字>）でしか資産と結び付いておらず、外部キーが無い。
// 参照が残っている資産を消すと、存在しない資産を指す仕訳が帳簿に残るため、その場合は
// 何も書かずに中止して、先にそちらを訂正してもらう。
//
// 印（source: 'opening'）が付くのはこの仕組みを入れて以降に作られた資産だけ。それ以前の
// 資産は判別できないので削除対象にせず、呼出側が手で消すよう案内する。
async function reverseOpeningYearInTx(
  year: number,
  now: number,
): Promise<{ removed: boolean } | OpeningRemovalBlocked> {
  const originals = await db.journalEntries
    .where('year')
    .equals(year)
    .filter((e) => e.source === 'opening' && countsTowardTotals(e))
    .toArray();
  if (originals.length === 0) {
    return { removed: false };
  }
  // openingYear の無い旧データは取得日＝開業日で登録されているので取得日の年で絞れる。
  const targets = await db.fixedAssets
    .filter(
      (a) =>
        a.source === 'opening' && (a.openingYear ?? Number(a.acquisitionDate.slice(0, 4))) === year,
    )
    .toArray();
  if (targets.length > 0) {
    const byTag = new Map(targets.map((a) => [`#${a.id.slice(0, 8)}`, a.name]));
    const referenced = new Set<string>();
    await db.journalEntries.each((e) => {
      if (!countsTowardTotals(e)) {
        return;
      }
      for (const [tag, name] of byTag) {
        if (e.description.includes(tag)) {
          referenced.add(name);
        }
      }
    });
    if (referenced.size > 0) {
      return { reason: 'has-depreciation', assetNames: [...referenced] };
    }
  }

  for (const orig of originals) {
    const lines = await db.journalLines.where('entryId').equals(orig.id).toArray();
    const reversalId = newId();
    await db.journalEntries.add({
      id: reversalId,
      // 打消し仕訳は原仕訳と同じ開業日に記帳する。年をまたぐと開業年度が変わってしまう。
      date: orig.date,
      year: orig.year,
      description: `[訂正] ${orig.description}`,
      status: 'confirmed',
      originalEntryId: orig.id,
      source: 'opening',
      createdAt: now,
      confirmedAt: now,
    });
    for (const line of lines) {
      await db.journalLines.add({
        ...line,
        id: newId(),
        entryId: reversalId,
        side: line.side === 'debit' ? 'credit' : 'debit',
      });
    }
    await db.journalEntries.update(orig.id, {
      status: 'reversed',
      reversedByEntryId: reversalId,
    });
  }
  await db.fixedAssets.bulkDelete(targets.map((a) => a.id));
  return { removed: true };
}
// 開業設定のやり直しのうち、打消しだけを行う。
export async function removeOpeningEntries(
  year: number,
  options?: { allowFiledYear?: boolean },
): Promise<{ removed: boolean } | OpeningRemovalBlocked> {
  await assertYearsWritable([year], options);
  return db.transaction('rw', db.journalEntries, db.journalLines, db.fixedAssets, async () => {
    markConfirmedWrite(options);
    return reverseOpeningYearInTx(year, Date.now());
  });
}
export type OpeningReplaceResult =
  | OpeningSetupResult
  | { reason: 'nothing-to-reverse' }
  | { reason: 'already-exists'; year: number }
  | OpeningRemovalBlocked
  | { reason: 'empty' }
  | { reason: 'dates-changed' };
// 作り直し：1 つの年の開業仕訳を打ち消し、いまの入力で作り、開業日・廃業日の設定値を書く。
// 途中で止まると開業仕訳が無いまま残るので、すべてを 1 つの取引で行う。
// 判定は確認の前の読み取りではなく取引の中で読み直した値で行う（確認の間のほかの画面での変更も見つける）。
export async function replaceOpeningEntries(
  args: {
    reverseYear: number;
    input: OpeningSetupInput;
    formClose: string;
    expectedStoredClose: unknown;
  },
  options?: { allowFiledYear?: boolean },
): Promise<OpeningReplaceResult> {
  const { reverseYear, input } = args;
  const date = input.businessStartDate;
  const createYear = Number(date.slice(0, 4));
  await assertYearsWritable([reverseYear, createYear], options);
  try {
    return await db.transaction(
      'rw',
      db.journalEntries,
      db.journalLines,
      db.fixedAssets,
      db.settings,
      async (): Promise<OpeningReplaceResult> => {
        markConfirmedWrite(options);
        if (!(await hasOpeningEntries(reverseYear))) {
          return { reason: 'nothing-to-reverse' };
        }
        if (createYear !== reverseYear && (await hasOpeningEntries(createYear))) {
          return { reason: 'already-exists', year: createYear };
        }
        // 打消しと作成の入力時刻を揃える。途中で止まった年の判定（findInterruptedOpeningYears）がこれで済んだと分かる
        const now = Date.now();
        const removal = await reverseOpeningYearInTx(reverseYear, now);
        if ('reason' in removal) {
          return removal;
        }
        if (!removal.removed) {
          throw new OpeningReplaceAborted('nothing-to-reverse');
        }
        // ここから先は打消しを書いた後なので、成功以外は投げて取引ごと取り消す
        const created = await createOpeningInTx(input, date, now);
        if ('reason' in created) {
          throw new OpeningReplaceAborted('already-exists');
        }
        if (created.entryIds.length === 0 && created.assetIds.length === 0) {
          throw new OpeningReplaceAborted('empty');
        }
        await writeOpeningDateSettingsInTx(date, args.formClose, args.expectedStoredClose);
        return created;
      },
    );
  } catch (e) {
    if (!(e instanceof OpeningReplaceAborted)) {
      throw e;
    }
    if (e.reason === 'already-exists') {
      return { reason: 'already-exists', year: createYear };
    }
    return { reason: e.reason };
  }
}
function isRestoredOpening(e: JournalEntry): boolean {
  return typeof e.description === 'string' && e.description.startsWith(OPENING_RESTORE_PREFIX);
}
// 作り直しの途中で止まった年：開業仕訳の打消しがあり、有効な開業仕訳が無く、最後の打消しの後に作り直した開業仕訳も無い年。
// 同じ年の作り直しは、打消し以後に作った開業仕訳（のちに打ち消されたものも含む）があれば済んでいる。
// 開業日の変更（ほかの年を作る）は打消しと作成の入力時刻が同じなので、それと同じ時刻のほかの年の開業仕訳があれば済んでいる。
// 元に戻した仕訳（[再計上]）は済んだ根拠にしない。入力時刻が読めない記録（復元由来）も根拠にしない。
// 取引の中からも呼ぶので、読めないときに握りつぶさない
async function scanInterruptedYears(): Promise<number[]> {
  const valid = new Set<number>();
  const reversalTimes = new Map<number, number[]>();
  const originals: { year: number; createdAt: number }[] = [];
  await db.journalEntries.each((e) => {
    if (e.source !== 'opening') {
      return;
    }
    if (countsTowardTotals(e)) {
      valid.add(e.year);
    }
    if (!Number.isFinite(e.createdAt)) {
      return;
    }
    if (e.originalEntryId !== undefined) {
      reversalTimes.set(e.year, [...(reversalTimes.get(e.year) ?? []), e.createdAt]);
    } else if (!isRestoredOpening(e)) {
      originals.push({ year: e.year, createdAt: e.createdAt });
    }
  });
  const years: number[] = [];
  for (const [year, times] of reversalTimes) {
    if (valid.has(year)) {
      continue;
    }
    const latest = Math.max(...times);
    const redone = originals.some((o) =>
      o.year === year ? o.createdAt >= latest : o.createdAt === latest,
    );
    if (!redone) {
      years.push(year);
    }
  }
  return years.sort((a, b) => a - b);
}
// 読めないときは案内を出さないだけにして、画面のほかの部分を止めない
export async function findInterruptedOpeningYears(): Promise<number[]> {
  try {
    return await scanInterruptedYears();
  } catch {
    return [];
  }
}

export async function loadDismissedInterruptedOpeningYears(): Promise<number[]> {
  const v: unknown = await getSetting('dismissedInterruptedOpeningYears');
  return Array.isArray(v) && v.every((y) => Number.isInteger(y)) ? (v as number[]) : [];
}

export async function loadDismissedMissingOpeningAssets(): Promise<string[]> {
  const v: unknown = await getSetting('dismissedMissingOpeningAssets');
  return Array.isArray(v) && v.every((k) => typeof k === 'string') ? (v as string[]) : [];
}

export async function dismissInterruptedOpeningYear(year: number): Promise<void> {
  await db.transaction('rw', db.settings, async () => {
    const current = await loadDismissedInterruptedOpeningYears();
    if (!current.includes(year)) {
      await setSetting('dismissedInterruptedOpeningYears', [...current, year]);
    }
  });
}

export async function showDismissedInterruptedOpeningYears(): Promise<void> {
  await deleteSetting('dismissedInterruptedOpeningYears');
}

export async function dismissMissingOpeningAsset(key: string): Promise<void> {
  await db.transaction('rw', db.settings, async () => {
    const current = await loadDismissedMissingOpeningAssets();
    if (!current.includes(key)) {
      await setSetting('dismissedMissingOpeningAssets', [...current, key]);
    }
  });
}

export class OpeningRestoreAborted extends Error {
  readonly reason: 'target-invalid' | 'amount-invalid';
  constructor(reason: 'target-invalid' | 'amount-invalid') {
    super(reason);
    this.name = 'OpeningRestoreAborted';
    this.reason = reason;
  }
}
// 元に戻すのは最後の打消し（removeOpeningEntries は 1 回の打消しに同じ入力時刻を付ける）の元の仕訳だけ。
// 元が開業設定の原仕訳でない・この打消しで打ち消されていない・ほかの年のものなら、何も書かずに止める
async function restoreTargets(year: number): Promise<JournalEntry[]> {
  const reversals = (await db.journalEntries.where('year').equals(year).toArray()).filter(
    (e) =>
      e.source === 'opening' && e.originalEntryId !== undefined && Number.isFinite(e.createdAt),
  );
  if (reversals.length === 0) {
    return [];
  }
  const latest = Math.max(...reversals.map((e) => e.createdAt));
  const targets = new Map<string, JournalEntry>();
  for (const rev of reversals.filter((e) => e.createdAt === latest)) {
    const origId: unknown = rev.originalEntryId;
    const orig = typeof origId === 'string' ? await db.journalEntries.get(origId) : undefined;
    if (
      orig === undefined ||
      orig.source !== 'opening' ||
      orig.originalEntryId !== undefined ||
      orig.status !== 'reversed' ||
      orig.reversedByEntryId !== rev.id ||
      orig.year !== year
    ) {
      throw new OpeningRestoreAborted('target-invalid');
    }
    targets.set(orig.id, orig);
  }
  return [...targets.values()];
}

export interface OpeningRestorePreview {
  entries: { id: string; date: string; description: string; amount: Decimal | undefined }[];
  /** 保存済みの開業日（読めるときだけ） */
  settingStart: string | undefined;
}
// 元に戻す前の確認に出す内容。金額は借方の合計で、読めない明細があれば undefined
export async function previewInterruptedOpeningRestore(
  year: number,
): Promise<OpeningRestorePreview> {
  const targets = await restoreTargets(year);
  const entries: OpeningRestorePreview['entries'] = [];
  for (const orig of targets) {
    const lines = await db.journalLines.where('entryId').equals(orig.id).toArray();
    let amount: Decimal | undefined = D(0);
    for (const l of lines.filter((x) => x.side === 'debit')) {
      const a = readStoredAmount(l.amount);
      amount = a === undefined || amount === undefined ? undefined : amount.plus(a);
    }
    entries.push({
      id: orig.id,
      date: String(orig.date),
      description: String(orig.description),
      amount,
    });
  }
  const start = readStoredBusinessDate(await getSetting('businessStartDate'));
  return {
    entries,
    settingStart: start?.valid === true ? String(start.value) : undefined,
  };
}
// 作り直しの途中で止まった年の開業仕訳を、元の仕訳を写した新しい確定仕訳として作る。元の仕訳と打消し仕訳は変えない。
// 転用資産の固定資産は記録が残っていないので、利用者が登録し直す（findMissingOpeningAssets）
export async function restoreInterruptedOpeningEntries(
  year: number,
  options?: { allowFiledYear?: boolean },
): Promise<{ entryIds: string[] } | { reason: 'not-interrupted' }> {
  await assertYearsWritable([year], options);
  return db.transaction('rw', db.journalEntries, db.journalLines, async () => {
    markConfirmedWrite(options);
    if (!(await scanInterruptedYears()).includes(year)) {
      return { reason: 'not-interrupted' as const };
    }
    const targets = await restoreTargets(year);
    const now = Date.now();
    const planned: { entry: JournalEntry; lines: JournalLine[] }[] = [];
    for (const orig of targets) {
      const entryId = newId();
      const lines = (await db.journalLines.where('entryId').equals(orig.id).toArray()).map(
        (line): JournalLine => {
          const amount = readStoredAmount(line.amount);
          if (amount === undefined || amount.isNegative()) {
            throw new OpeningRestoreAborted('amount-invalid');
          }
          return {
            ...line,
            id: newId(),
            entryId,
            amount: toAmountString(amount),
            amountIndexed: toIndexable(amount),
          };
        },
      );
      validateLines(lines);
      const { reversedByEntryId: _reversedBy, ...rest } = orig;
      planned.push({
        entry: {
          ...rest,
          id: entryId,
          description: `${OPENING_RESTORE_PREFIX}${String(orig.description)}`,
          status: 'confirmed',
          createdAt: now,
          confirmedAt: now,
        },
        lines,
      });
    }
    for (const p of planned) {
      await db.journalEntries.add(p.entry);
      await db.journalLines.bulkAdd(p.lines);
    }
    return { entryIds: planned.map((p) => p.entry.id) };
  });
}

export interface MissingOpeningAsset {
  /** `${仕訳 id}:${明細 id}`。「登録しない」の記録に使う */
  key: string;
  entryId: string;
  lineId: string;
  year: number;
  /** 元に戻した仕訳の日付（開業日） */
  openingDate: string;
  name: string;
  accountCode: string;
  /** 明細の金額（保存されている元の値） */
  amount: unknown;
}
export interface AssumedOpeningAsset {
  name: string;
  acquisitionDate: string;
  year: number;
}
function openingYearOf(a: FixedAsset): number {
  return a.openingYear ?? Number(String(a.serviceStartDate ?? a.acquisitionDate).slice(0, 4));
}
// 元に戻した開業仕訳（[再計上]）の転用資産の明細のうち、対応する固定資産が無いもの。ほかの開業仕訳は見ない
// （旧データの開業資産には openingYear や source が無く、対応を判定できない）。
// 年・名前・科目ごとに明細の数から対応する資産の数を引く。開業設定の資産はその年のもの、
// 設定画面で登録した資産は取得日が開業日以前のものを対応とみなす。登録し直した資産は未償却残高が明細の額と同じなので、その明細に充てる。
// 「登録しない」にした明細は数えない（数えると、その明細に資産が充てられて別の明細が残り続ける）
export async function findMissingOpeningAssets(): Promise<{
  missing: MissingOpeningAsset[];
  assumed: AssumedOpeningAsset[];
}> {
  const entries = new Map<string, JournalEntry>();
  const [, dismissedKeys] = await Promise.all([
    db.journalEntries.each((e) => {
      if (e.source === 'opening' && countsTowardTotals(e) && isRestoredOpening(e)) {
        entries.set(e.id, e);
      }
    }),
    loadDismissedMissingOpeningAssets(),
  ]);
  const dismissed = new Set(dismissedKeys);
  if (entries.size === 0) {
    return { missing: [], assumed: [] };
  }
  const assetCodes = new Set(DEPRECIABLE_ASSET_ACCOUNTS.map((a) => a.code));
  const lines = (
    await db.journalLines
      .where('entryId')
      .anyOf([...entries.keys()])
      .toArray()
  )
    .filter(
      (l) =>
        l.side === 'debit' &&
        assetCodes.has(l.accountCode) &&
        typeof l.memo === 'string' &&
        l.memo.startsWith(CONVERTED_ASSET_MEMO_PREFIX) &&
        !dismissed.has(`${l.entryId}:${l.id}`),
    )
    .sort((a, b) => a.entryId.localeCompare(b.entryId) || a.id.localeCompare(b.id));
  const groups = new Map<string, MissingOpeningAsset[]>();
  for (const l of lines) {
    const entry = entries.get(l.entryId)!;
    const item: MissingOpeningAsset = {
      key: `${l.entryId}:${l.id}`,
      entryId: l.entryId,
      lineId: l.id,
      year: entry.year,
      openingDate: String(entry.date),
      name: l.memo!.slice(CONVERTED_ASSET_MEMO_PREFIX.length),
      accountCode: l.accountCode,
      amount: l.amount,
    };
    const groupKey = JSON.stringify([item.year, item.name, item.accountCode]);
    groups.set(groupKey, [...(groups.get(groupKey) ?? []), item]);
  }
  const assets = await db.fixedAssets.toArray();
  const used = new Set<string>();
  const missing: MissingOpeningAsset[] = [];
  const assumed: AssumedOpeningAsset[] = [];
  const ordered = [...groups.values()].sort((a, b) => a[0]!.year - b[0]!.year);
  for (const group of ordered) {
    const { year, name, accountCode } = group[0]!;
    const openingDate = group.map((g) => g.openingDate).sort()[0]!;
    const candidates = assets.filter(
      (a) =>
        !used.has(a.id) &&
        a.name === name &&
        a.accountCode === accountCode &&
        (a.source === 'opening'
          ? openingYearOf(a) === year
          : isValidIsoDate(a.acquisitionDate) && a.acquisitionDate <= openingDate),
    );
    const uncovered = [...group];
    const take = (a: FixedAsset, index: number) => {
      uncovered.splice(index, 1);
      used.add(a.id);
      if (a.source !== 'opening') {
        assumed.push({ name: a.name, acquisitionDate: a.acquisitionDate, year });
      }
    };
    const rest: FixedAsset[] = [];
    for (const a of candidates) {
      const basis = readStoredAmount(a.conversionBasis);
      const index =
        basis === undefined
          ? -1
          : uncovered.findIndex((u) => readStoredAmount(u.amount)?.eq(basis) === true);
      if (index >= 0) {
        take(a, index);
      } else {
        rest.push(a);
      }
    }
    for (const a of rest) {
      if (uncovered.length === 0) {
        break;
      }
      take(a, 0);
    }
    missing.push(...uncovered);
  }
  return { missing, assumed };
}
// 明細の額を開業時の未償却残高として使う。読めない・上限を超える額は登録できない
export function missingOpeningAssetBasis(target: MissingOpeningAsset): Decimal | undefined {
  const basis = readStoredAmount(target.amount);
  return basis === undefined || basis.isNegative() || basis.gte('1e14') ? undefined : basis;
}

export interface MissingOpeningAssetForm {
  acquisitionDate: string;
  acquisitionCost: string;
  usefulLifeYears: number;
  depreciationMethod: DepreciationMethod;
}
// 開業設定の転用資産と同じ検査を通した固定資産を返す。通らなければ理由を投げる
export function buildMissingOpeningAsset(
  target: MissingOpeningAsset,
  form: MissingOpeningAssetForm,
): FixedAsset {
  if (!isValidIsoDate(form.acquisitionDate)) {
    throw new Error(m.fixed_asset_issue_date({ field: m.opening_converted_acq_date_title() }));
  }
  if (form.acquisitionDate > target.openingDate) {
    throw new Error(
      m.opening_asset_acquired_after_start({
        acquisitionDate: form.acquisitionDate,
        businessStartDate: target.openingDate,
      }),
    );
  }
  if (!isConvertedAssetLifeSupported(form.usefulLifeYears)) {
    throw new Error(m.opening_asset_life_unsupported());
  }
  const cost = parseAmountInput(form.acquisitionCost);
  if (cost === undefined) {
    throw new Error(m.common_amount_invalid());
  }
  if (cost.gte('1e14')) {
    throw new Error(m.common_amount_too_large());
  }
  const basis = missingOpeningAssetBasis(target);
  if (basis === undefined) {
    throw new Error(m.opening_missing_assets_basis_unreadable());
  }
  if (cost.lt(basis)) {
    throw new Error(m.opening_missing_assets_cost_below_basis({ basis: formatJPY(basis) }));
  }
  const acquisitionCost = toAmountString(cost);
  const asset: FixedAsset = {
    id: newId(),
    name: target.name,
    acquisitionDate: form.acquisitionDate,
    acquisitionCost,
    usefulLifeYears: form.usefulLifeYears,
    depreciationMethod:
      form.depreciationMethod === 'small-asset-special' &&
      !isSmallAssetEligible(form.acquisitionDate, acquisitionCost)
        ? 'straight-line'
        : form.depreciationMethod,
    accountCode: target.accountCode,
    source: 'opening',
    conversionBasis: toAmountString(basis),
    serviceStartDate: target.openingDate,
    openingYear: target.year,
  };
  const issues = validateFixedAsset(asset);
  if (issues.length > 0) {
    throw new InvalidFixedAssetError([{ asset, issues }]);
  }
  return asset;
}
// 取引の中で数え直し、その明細がまだ足りず元の仕訳が有効なときだけ登録する
export async function registerMissingOpeningAsset(
  args: { entryId: string; lineId: string } & MissingOpeningAssetForm,
): Promise<{ assetId: string } | { reason: 'not-missing' }> {
  return db.transaction(
    'rw',
    db.journalEntries,
    db.journalLines,
    db.fixedAssets,
    db.settings,
    async () => {
      const { missing } = await findMissingOpeningAssets();
      const target = missing.find((x) => x.entryId === args.entryId && x.lineId === args.lineId);
      if (target === undefined) {
        return { reason: 'not-missing' as const };
      }
      const asset = buildMissingOpeningAsset(target, args);
      await db.fixedAssets.add(asset);
      return { assetId: asset.id };
    },
  );
}

export interface OpeningRecoveryState {
  /** 作り直しの途中で止まった年（「表示しない」にした年も含む） */
  interrupted: number[];
  dismissedYears: number[];
  missing: MissingOpeningAsset[];
  assumed: AssumedOpeningAsset[];
  dismissedAssets: string[];
}
// 画面の案内に使う。読めない部分は空として扱い、画面のほかの部分を止めない。
// liveQuery が読んだ表を追えるよう、読み取りはすべて呼ばれた時点で始める（別の await の後に始めると追えない）
export async function readOpeningRecoveryState(): Promise<OpeningRecoveryState> {
  const [interrupted, dismissedYears, found, dismissedAssets] = await Promise.all([
    findInterruptedOpeningYears(),
    loadDismissedInterruptedOpeningYears().catch((): number[] => []),
    findMissingOpeningAssets().catch(() => ({ missing: [], assumed: [] })),
    loadDismissedMissingOpeningAssets().catch((): string[] => []),
  ]);
  return { interrupted, dismissedYears, ...found, dismissedAssets };
}
// 案内に出す年（「表示しない」にした年を除く）
export async function readVisibleInterruptedOpeningYears(): Promise<number[]> {
  const { interrupted, dismissedYears } = await readOpeningRecoveryState();
  return interrupted.filter((y) => !dismissedYears.includes(y));
}
