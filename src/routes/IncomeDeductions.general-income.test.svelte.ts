// 総合課税の利子・配当・譲渡・一時所得を入力すると、合計所得金額・基礎控除・課税所得が変わる。
// 固定資産の売却（総合部分）も計上し、計算できないときは部分的な金額を出さない。

import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { db } from '../db/db';
import { newId } from '../lib/id';
import { D, formatJPY, toIndexable } from '../lib/decimal';
import { setSetting } from '../lib/settings';
import { estimateTransferIncome, transferIncomeByTerm } from '../domain/asset-disposal';
import { smallAssetSpecialStatuses } from '../domain/depreciation';
import { m } from '../paraglide/messages';
import type { Account, FixedAsset, JournalLine } from '../db/types';

const { default: IncomeDeductions } = await import('./IncomeDeductions.svelte');

async function waitFor(predicate: () => boolean, timeoutMs = 4000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('waitFor タイムアウト');
    }
    await new Promise((r) => setTimeout(r, 10));
  }
}

const settle = () => new Promise((r) => setTimeout(r, 60));

let container: HTMLElement | undefined;
let instance: Record<string, unknown> | undefined;

function saveButton(el: HTMLElement): HTMLButtonElement {
  return Array.from(el.querySelectorAll('button')).find(
    (b) => b.textContent?.trim() === m.income_deductions_save(),
  )!;
}

async function render(): Promise<HTMLElement> {
  container = document.createElement('div');
  document.body.appendChild(container);
  instance = mount(IncomeDeductions, { target: container, props: {} });
  const el = container;
  await waitFor(() => el.querySelector('input[name="deductionNen"]') !== null);
  const yearInput = el.querySelector<HTMLInputElement>('input[name="deductionNen"]')!;
  yearInput.value = '2026';
  yearInput.dispatchEvent(new Event('input', { bubbles: true }));
  await waitFor(() => !saveButton(el).disabled);
  await settle();
  return el;
}

function type(el: HTMLElement, name: string, value: string): void {
  const input = el.querySelector<HTMLInputElement>(`input[name="${name}"]`)!;
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
}

function legalTotal(el: HTMLElement): string {
  return el.querySelector('[data-testid="legal-total-income"]')?.textContent?.trim() ?? '';
}

function resultValue(el: HTMLElement, label: string): string {
  const span = Array.from(el.querySelectorAll('span')).find((s) => s.textContent?.trim() === label);
  return span?.nextElementSibling?.textContent?.trim() ?? '';
}

const TEST_ACCOUNTS: Account[] = [
  { code: '1130', year: 2026, name: '普通預金', category: 'asset', displayOrder: 130 },
  { code: '4110', year: 2026, name: '売上高', category: 'revenue', displayOrder: 110 },
];

async function addBusinessRevenue(amount: string): Promise<void> {
  await db.accounts.bulkAdd(TEST_ACCOUNTS);
  const entryId = newId();
  const now = Date.now();
  await db.journalEntries.add({
    id: entryId,
    date: '2026-05-01',
    year: 2026,
    description: 'テスト売上',
    status: 'confirmed',
    source: 'manual',
    createdAt: now,
    confirmedAt: now,
  });
  const line = (side: 'debit' | 'credit', accountCode: string): JournalLine => ({
    id: newId(),
    entryId,
    side,
    accountCode,
    amount,
    amountIndexed: toIndexable(amount),
    taxRate: 0,
    taxIncluded: true,
    invoiceCompliant: false,
  });
  await db.journalLines.bulkAdd([line('debit', '1130'), line('credit', '4110')]);
}

function asset(over: Partial<FixedAsset> = {}): FixedAsset {
  return {
    id: 'asset-1',
    name: '売却した機材',
    acquisitionDate: '2020-01-01',
    acquisitionCost: '1000000',
    usefulLifeYears: 10,
    depreciationMethod: 'straight-line',
    accountCode: '1510',
    disposedDate: '2026-06-30',
    disposalType: 'sale',
    salePrice: '1500000',
    ...over,
  };
}

beforeEach(async () => {
  await db.delete();
  await db.open();
});

afterEach(async () => {
  if (instance !== undefined) {
    unmount(instance);
    instance = undefined;
  }
  if (container !== undefined) {
    container.remove();
    container = undefined;
  }
  await db.delete();
});

describe('一時所得の入力', () => {
  test('収入 150 万円・支出 0 → 一時所得 100 万円、総所得金額への算入は 50 万円で、合計所得金額に入る', async () => {
    const el = await render();
    expect(legalTotal(el)).toBe(formatJPY(0));
    type(el, 'occasionalRevenue', '1500000');
    type(el, 'occasionalExpenses', '0');
    await settle();
    const result = el.querySelector('[data-testid="occasional-result"]')!.textContent!;
    expect(result).toContain(formatJPY(1_000_000));
    expect(result).toContain(formatJPY(500_000));
    expect(legalTotal(el)).toBe(formatJPY(500_000));
  });

  test('保存すると occasionalIncome に種目・支払者を含めて残り、入力しなかった欄は保存しない', async () => {
    const el = await render();
    saveButton(el).click();
    await settle();
    const blank = await db.personalDeductions.get(2026);
    expect(blank).toBeDefined();
    for (const key of [
      'interestIncome',
      'dividendIncome',
      'generalTransferIncome',
      'occasionalIncome',
    ]) {
      expect(blank).not.toHaveProperty(key);
    }
    type(el, 'occasionalRevenue', '1500000');
    type(el, 'occasionalCategory', '生命保険の満期返戻金');
    type(el, 'occasionalPayerName', '青空生命保険');
    type(el, 'occasionalPayerAddress', '東京都千代田区1-1');
    type(el, 'interestAmount', '1000');
    saveButton(el).click();
    await settle();
    const saved = await db.personalDeductions.get(2026);
    expect(saved?.occasionalIncome).toEqual({
      revenue: '1500000',
      expenses: '0',
      withholdingTax: '0',
      category: '生命保険の満期返戻金',
      payerName: '青空生命保険',
      payerAddress: '東京都千代田区1-1',
    });
    expect(saved?.interestIncome).toEqual({ amount: '1000', withholdingTax: '0' });
  });

  test('種目は 10 字・所在地等は 100 字までの入力欄', async () => {
    const el = await render();
    expect(el.querySelector<HTMLInputElement>('input[name="occasionalCategory"]')!.maxLength).toBe(
      10,
    );
    expect(
      el.querySelector<HTMLInputElement>('input[name="occasionalPayerAddress"]')!.maxLength,
    ).toBe(100);
  });

  test('読めない金額は欄の誤りを示す', async () => {
    const el = await render();
    type(el, 'occasionalRevenue', 'abc');
    await settle();
    expect(el.textContent).toContain(m.common_amount_invalid());
  });
});

describe('合計所得金額と基礎控除の区分', () => {
  test('配当を足して合計所得金額が 489 万円を超えると、基礎控除が 104 万円から 67 万円へ変わる', async () => {
    await addBusinessRevenue('4000000');
    const el = await render();
    // 事業所得は収入 400 万円−青色申告特別控除 65 万円＝335 万円
    expect(legalTotal(el)).toBe(formatJPY(3_350_000));
    type(el, 'dividendRevenue', '1540000');
    await settle();
    expect(legalTotal(el)).toBe(formatJPY(4_890_000));
    expect(resultValue(el, m.income_deductions_result_basic())).toBe(formatJPY(1_040_000));
    type(el, 'dividendRevenue', '1540001');
    await settle();
    expect(legalTotal(el)).toBe(formatJPY(4_890_001));
    expect(resultValue(el, m.income_deductions_result_basic())).toBe(formatJPY(670_000));
    expect(resultValue(el, m.income_deductions_result_taxable_income())).toBe(
      formatJPY(4_890_001 - 670_000),
    );
  });

  test('長期の総合譲渡を 1 件入力すると 50 万円の特別控除の後の 1/2 が合計所得金額に入る（短期なら全額）', async () => {
    const el = await render();
    Array.from(el.querySelectorAll('button'))
      .find((b) => b.textContent?.trim() === m.income_general_transfer_add())!
      .click();
    flushSync();
    const term = el.querySelector<HTMLSelectElement>('select[name$="-term"]')!;
    term.value = 'long';
    term.dispatchEvent(new Event('change', { bubbles: true }));
    flushSync();
    const revenue = el.querySelector<HTMLInputElement>('input[name$="-revenue"]')!;
    revenue.value = '800000';
    revenue.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    await settle();
    expect(legalTotal(el)).toBe(formatJPY(150_000));
  });
});

describe('固定資産の売却（総合部分）', () => {
  test('長期の譲渡益だけの利用者の合計所得金額・基礎控除・課税所得（S1 前は譲渡所得を含めなかった）', async () => {
    await addBusinessRevenue('4000000');
    const book = D(1).minus(estimateTransferIncome(asset({ salePrice: '1' }))!.estimate);
    // 譲渡所得 358 万 2 円 → 特別控除 50 万円の後 308 万 2 円の 1/2＝154 万 1 円
    const sold = asset({ salePrice: book.plus(3_580_002).toString() });
    expect(estimateTransferIncome(sold)!.estimate).toBe('3580002');
    await db.fixedAssets.add(sold);
    const el = await render();
    expect(el.querySelector('[data-testid="asset-transfer-income"]')?.textContent).toContain(
      formatJPY(3_580_002),
    );
    // S1 前は 3,350,000・基礎控除 1,040,000・課税所得 2,310,000
    expect(legalTotal(el)).toBe(formatJPY(4_890_001));
    expect(resultValue(el, m.income_deductions_result_basic())).toBe(formatJPY(670_000));
    expect(resultValue(el, m.income_deductions_result_taxable_income())).toBe(formatJPY(4_220_001));
  });

  test('少額特例の資産の譲渡所得は、設定画面と同じ算法（状態を反映した transferIncomeByTerm）の金額', async () => {
    const small = asset({
      id: 'small',
      name: '少額特例の機材',
      acquisitionDate: '2026-02-01',
      acquisitionCost: '250000',
      depreciationMethod: 'small-asset-special',
      disposedDate: '2026-09-01',
      salePrice: '100000',
    });
    await db.fixedAssets.add(small);
    const statuses = smallAssetSpecialStatuses([small], [], undefined);
    const expected = transferIncomeByTerm([small], 2026, statuses);
    const el = await render();
    const text = el.querySelector('[data-testid="asset-transfer-income"]')!.textContent!;
    expect(text).toContain(
      m.income_general_asset_transfer({
        shortTerm: formatJPY(expected.shortTerm),
        longTerm: formatJPY(expected.longTerm),
      }),
    );
  });

  test('当年に売却した資産を計算できなければ、資産名つきの通知を出し、金額と控除・税額を出さない', async () => {
    await addBusinessRevenue('4000000');
    await db.fixedAssets.add(asset({ name: '耐用年数が不正の機材', usefulLifeYears: 0 }));
    const el = await render();
    const alert = Array.from(el.querySelectorAll('[role="alert"]')).find((e) =>
      (e.textContent ?? '').includes('耐用年数が不正の機材'),
    );
    expect(alert).toBeDefined();
    expect(legalTotal(el)).toBe(m.common_dash());
    expect(el.textContent).not.toContain(m.income_deductions_result_title());
  });

  test('建物の売却は総合譲渡に入れず、未計入の通知に資産名を出す', async () => {
    await addBusinessRevenue('4000000');
    await db.fixedAssets.add(
      asset({
        name: '事務所建物',
        accountCode: '1511',
        usefulLifeYears: 24,
        salePrice: '9000000',
      }),
    );
    const el = await render();
    expect(legalTotal(el)).toBe(formatJPY(3_350_000));
    const notice = el.querySelector('[data-testid="separate-transfer-notice"]')!;
    expect(notice.textContent).toContain('事務所建物');
    expect(el.querySelector('[data-testid="asset-transfer-income"]')).toBeNull();
  });

  test('当年に売却した資産がなければ、開業日が不正・未売却の資産に問題があっても、計算は変わらず通知も出ない', async () => {
    await addBusinessRevenue('4000000');
    await setSetting('businessStartDate', 'banana');
    const {
      disposedDate: _d,
      disposalType: _t,
      salePrice: _p,
      ...unsold
    } = asset({
      id: 'unsold',
      name: '未売却の機材',
      usefulLifeYears: 0,
    });
    await db.fixedAssets.add(unsold);
    await db.fixedAssets.add(asset({ id: 'old', name: '前年に売却', disposedDate: '2025-06-30' }));
    const { salePrice: _s, ...scrapped } = asset({
      id: 'scrap',
      name: '当年に除却',
      usefulLifeYears: 0,
      disposalType: 'scrap',
    });
    await db.fixedAssets.add(scrapped);
    const el = await render();
    expect(legalTotal(el)).toBe(formatJPY(3_350_000));
    expect(resultValue(el, m.income_deductions_result_basic())).toBe(formatJPY(1_040_000));
    expect(resultValue(el, m.income_deductions_result_taxable_income())).toBe(formatJPY(2_310_000));
    expect(el.querySelector('[role="alert"]')).toBeNull();
    expect(el.querySelector('[data-testid="asset-transfer-income"]')).toBeNull();
  });
});

describe('生活に通常必要でない資産の損失', () => {
  test('それ以外の資産の損失もあって配分が決まらないときは通知を出し、金額を出さない', async () => {
    await addBusinessRevenue('4000000');
    const el = await render();
    const add = () =>
      Array.from(el.querySelectorAll('button'))
        .find((b) => b.textContent?.trim() === m.income_general_transfer_add())!
        .click();
    add();
    add();
    flushSync();
    const revenues = Array.from(el.querySelectorAll<HTMLInputElement>('input[name$="-revenue"]'));
    const costs = Array.from(
      el.querySelectorAll<HTMLInputElement>('input[name$="-acquisitionCost"]'),
    );
    const set = (input: HTMLInputElement, v: string) => {
      input.value = v;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    };
    set(revenues[0]!, '200000');
    set(costs[0]!, '500000');
    set(revenues[1]!, '100000');
    set(costs[1]!, '300000');
    const golf = el.querySelector<HTMLInputElement>('input[name$="-nonEssential"]')!;
    golf.checked = true;
    golf.dispatchEvent(new Event('change', { bubbles: true }));
    flushSync();
    await settle();
    expect(el.textContent).toContain(m.income_general_unconfirmed());
    expect(legalTotal(el)).toBe(m.common_dash());
    expect(el.textContent).not.toContain(m.income_deductions_result_title());
  });
});
