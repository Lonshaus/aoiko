// 開業設定：転用資産の少額特例判定（原始取得価額基準、所令135条）・開業日／廃業日の設定書き込み。
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { mount, unmount } from 'svelte';
import { db } from '../db/db';
import { m } from '../paraglide/messages';
import { getSetting } from '../lib/settings';
import {
  computeDepreciation,
  generateYearEndDepreciation,
  smallAssetSpecialStatuses,
} from '../domain/depreciation';
import { D } from '../lib/decimal';
import { mapKoa210RepeatedValues } from '../tax-schema/2026/xtx-mapping-koa210';
import type { XtxContext } from '../tax-schema/2026/xtx';

const { default: OpeningSetup } = await import('./OpeningSetup.svelte');
const { default: Settings } = await import('./Settings.svelte');

function minimalXtxCtx(
  fixedAssets: XtxContext['fixedAssets'],
  dataYear: number,
  businessStartDate?: string,
): XtxContext {
  return {
    year: dataYear,
    dataYear,
    ...(businessStartDate ? { businessStartDate } : {}),
    businessName: '',
    invoiceNumber: '',
    monthly: { year: dataYear, months: [], totalSales: '0', totalExpense: '0' },
    pl: {
      year: dataYear,
      revenue: [],
      expense: [],
      totalRevenue: '0',
      totalExpense: '0',
      netIncome: '0',
      entryCount: 0,
    },
    bs: {
      year: dataYear,
      asOf: `${dataYear}-12-31`,
      assets: [],
      liabilities: [],
      equity: [],
      netIncome: '0',
      totalAssets: '0',
      totalLiabilitiesAndEquity: '0',
      balanced: true,
    },
    filer: { riyoshaId: '', name: '', zip: '', address: '', zeimushoCode: '', zeimushoName: '' },
    filingType: 'blue',
    aoiroDeductionKind: 'electronic',
    fixedAssets,
  };
}

async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 4000,
): Promise<void> {
  const start = Date.now();
  while (!(await predicate())) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('waitFor タイムアウト');
    }
    await new Promise((r) => setTimeout(r, 10));
  }
}

async function tick(): Promise<void> {
  await new Promise((r) => setTimeout(r, 20));
}

function setValue(el: HTMLInputElement | HTMLSelectElement, value: string, event: string): void {
  el.value = value;
  el.dispatchEvent(new Event(event, { bubbles: true }));
}

let container: HTMLElement | undefined;
let instance: Record<string, unknown> | undefined;
// onMount の直列読み込みが終わる前に afterEach の db.delete() が走ると DatabaseClosedError が未処理で残るため、最後に読む設定に目印を仕込んで表示まで待つ。
const MOUNT_SENTINEL = 'ZZZ9';

async function renderOpeningSetup(): Promise<void> {
  container = document.createElement('div');
  document.body.appendChild(container);
  instance = mount(OpeningSetup, { target: container, props: {} });
  await waitFor(() => container!.querySelector('h2') !== null);
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

describe('開業設定', () => {
  test('転用資産は原始取得価額で少額特例の閾値を判定し、転用日価額を保存する', async () => {
    await db.settings.put({ key: 'filingType', value: 'blue', updatedAt: Date.now() });
    await renderOpeningSetup();

    const dateInputs = [...container!.querySelectorAll<HTMLInputElement>('input[type="date"]')];
    // 最初の date input が開業日
    setValue(dateInputs[0]!, '2026-05-01', 'input');
    await tick();

    setValue(
      container!.querySelector<HTMLInputElement>(
        `input[placeholder="${m.settings_asset_name_placeholder()}"]`,
      )!,
      '中古複合機',
      'input',
    );
    const acqDateInput = container!.querySelector<HTMLInputElement>(
      `input[title="${m.opening_converted_acq_date_title()}"]`,
    )!;
    setValue(acqDateInput, '2020-05-01', 'input');
    setValue(
      container!.querySelector<HTMLInputElement>(
        `input[placeholder="${m.settings_asset_cost_placeholder()}"]`,
      )!,
      '250000',
      'input',
    );
    const lifeInput = container!.querySelector<HTMLInputElement>(
      `input[title="${m.settings_asset_life_title()}"]`,
    )!;
    setValue(lifeInput, '4', 'input');

    const convertedForm = acqDateInput.closest('form')!;
    convertedForm.querySelector<HTMLButtonElement>('button[type="submit"]')!.click();
    await tick();

    const smallAssetCheckbox = [
      ...container!.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'),
    ].find((el) => !el.disabled);
    expect(
      smallAssetCheckbox,
      '少額特例のチェックボックスが有効（原始取得価額 250,000 は 30 万円未満）',
    ).toBeDefined();
    smallAssetCheckbox!.click();
    await tick();

    const previewButton = [...container!.querySelectorAll('button')].find(
      (b) => b.textContent?.trim() === m.opening_action_preview(),
    )!;
    previewButton.click();
    await tick();

    const confirmButton = [...container!.querySelectorAll('button')].find(
      (b) => b.textContent?.trim() === m.opening_action_confirm(),
    )!;
    confirmButton.click();

    await waitFor(async () => (await db.fixedAssets.toArray()).length > 0);
    const [asset] = await db.fixedAssets.toArray();
    expect(asset?.depreciationMethod).toBe('small-asset-special');
    // 250,000 − 250,000×0.9×0.166×6 = 25,900
    expect(asset?.conversionBasis).toBe('25900');

    const r = await generateYearEndDepreciation(2026, { businessStartDate: '2026-05-01' });
    expect(r.created).toBe(1);
    const lines = await db.journalLines.toArray();
    const expenseLine = lines.find((l) => l.accountCode === '5210');
    expect(expenseLine?.amount).toBe('25900');
    // 少額特例の年度上限累計は原始取得価額（250,000）で計る（所令126条・所令135条）。
    const statuses = smallAssetSpecialStatuses([asset!], '2026-05-01');
    expect(statuses.get(asset!.id)).toBe('applicable');

    const koa210 = mapKoa210RepeatedValues(minimalXtxCtx([asset!], 2026, '2026-05-01'));
    const summary = koa210.AMF01600?.find((r2) => r2.AMF01610 === '中古複合機');
    expect(summary?.AMF01640).toBe('250000');
    expect(summary?.AMF01650).toBe('250000');
    // 本年分の普通償却費・償却費合計・必要経費算入額は、いずれも2026年の仕訳借方（25,900）と一致する。
    expect(summary?.AMF01730).toBe('25900');
    expect(summary?.AMF01750).toBe('25900');
    expect(summary?.AMF01770).toBe('25900');
    expect(summary?.AMF01780).toBe('0');
    // 資産科目（1510、転用日価額 25,900 相当）から 1520 の累計償却額を引いても負にならない。
    for (let y = 2026; y <= 2030; y++) {
      const result = computeDepreciation(asset!, y, undefined, statuses);
      expect(D(result.bookValueEnd).isNegative()).toBe(false);
    }
  });

  test('開業日・廃業日が設定に書き込まれる', async () => {
    await renderOpeningSetup();
    const dateInputs = [...container!.querySelectorAll<HTMLInputElement>('input[type="date"]')];
    setValue(dateInputs[0]!, '2026-07-01', 'input');
    setValue(dateInputs[1]!, '2026-09-30', 'input');
    await tick();

    setValue(
      container!.querySelector<HTMLInputElement>(
        `input[placeholder="${m.opening_expense_name_placeholder()}"]`,
      )!,
      '名刺',
      'input',
    );
    setValue(
      container!.querySelector<HTMLInputElement>(
        `input[placeholder="${m.opening_amount_placeholder()}"]`,
      )!,
      '10000',
      'input',
    );
    const expenseForm = container!
      .querySelector<HTMLInputElement>(`input[placeholder="${m.opening_amount_placeholder()}"]`)!
      .closest('form')!;
    expenseForm.querySelector<HTMLButtonElement>('button[type="submit"]')!.click();
    await tick();

    const previewButton = [...container!.querySelectorAll('button')].find(
      (b) => b.textContent?.trim() === m.opening_action_preview(),
    )!;
    previewButton.click();
    await tick();
    const confirmButton = [...container!.querySelectorAll('button')].find(
      (b) => b.textContent?.trim() === m.opening_action_confirm(),
    )!;
    confirmButton.click();

    await waitFor(async () => (await getSetting('businessStartDate')) !== undefined);
    expect(await getSetting('businessStartDate')).toBe('2026-07-01');
    expect(await getSetting('businessCloseDate')).toBe('2026-09-30');
  });

  test('開業設定で開業日 2026-07-01・開業費 100,000 → Settings で少額特例4件登録 → 2026・2027生成（開業日渡さず）で4件目が落選しつつ翌年も定額法で継続', async () => {
    await renderOpeningSetup();
    const dateInputs = [...container!.querySelectorAll<HTMLInputElement>('input[type="date"]')];
    setValue(dateInputs[0]!, '2026-07-01', 'input');
    await tick();
    setValue(
      container!.querySelector<HTMLInputElement>(
        `input[placeholder="${m.opening_expense_name_placeholder()}"]`,
      )!,
      '名刺',
      'input',
    );
    setValue(
      container!.querySelector<HTMLInputElement>(
        `input[placeholder="${m.opening_amount_placeholder()}"]`,
      )!,
      '100000',
      'input',
    );
    const expenseForm = container!
      .querySelector<HTMLInputElement>(`input[placeholder="${m.opening_amount_placeholder()}"]`)!
      .closest('form')!;
    expenseForm.querySelector<HTMLButtonElement>('button[type="submit"]')!.click();
    await tick();
    const previewButton = [...container!.querySelectorAll('button')].find(
      (b) => b.textContent?.trim() === m.opening_action_preview(),
    )!;
    previewButton.click();
    await tick();
    const confirmButton = [...container!.querySelectorAll('button')].find(
      (b) => b.textContent?.trim() === m.opening_action_confirm(),
    )!;
    confirmButton.click();
    await waitFor(async () => (await getSetting('businessStartDate')) === '2026-07-01');
    await waitFor(
      async () => (await db.journalEntries.filter((e) => e.source === 'opening').count()) > 0,
    );

    unmount(instance!);
    instance = undefined;
    container!.remove();
    container = undefined;

    await db.settings.put({
      key: 'homeOfficeAccountRatios',
      value: { [MOUNT_SENTINEL]: '0.30' },
      updatedAt: Date.now(),
    });
    // Settings の固定資産登録フォームから、転用資産ではない通常の少額特例資産を4件登録する
    // （conversionBasis は付かない）。
    container = document.createElement('div');
    document.body.appendChild(container);
    instance = mount(Settings, { target: container, props: {} });
    await waitFor(
      () =>
        container!.querySelector(`input[placeholder="${m.settings_asset_name_placeholder()}"]`) !==
        null,
    );
    await waitFor(() => (container!.textContent ?? '').includes(MOUNT_SENTINEL));

    function assetForm(): HTMLFormElement {
      const nameInput = container!.querySelector<HTMLInputElement>(
        `input[placeholder="${m.settings_asset_name_placeholder()}"]`,
      )!;
      return nameInput.closest('form')!;
    }

    const acqDates = ['2026-08-01', '2026-09-01', '2026-10-01', '2026-11-01'];
    for (const [i, acqDate] of acqDates.entries()) {
      const form = assetForm();
      setValue(
        form.querySelector<HTMLInputElement>(
          `input[placeholder="${m.settings_asset_name_placeholder()}"]`,
        )!,
        `少額特例資産${i + 1}`,
        'input',
      );
      setValue(
        form.querySelector<HTMLInputElement>(
          `input[placeholder="${m.settings_asset_cost_placeholder()}"]`,
        )!,
        '390000',
        'input',
      );
      setValue(
        form.querySelector<HTMLInputElement>(`input[title="${m.settings_asset_date_title()}"]`)!,
        acqDate,
        'input',
      );
      setValue(
        form.querySelector<HTMLSelectElement>(
          `select[title="${m.settings_asset_method_title()}"]`,
        )!,
        'small-asset-special',
        'change',
      );
      await tick();
      form.querySelector<HTMLButtonElement>('button[type="submit"]')!.click();
      await tick();
    }
    await waitFor(async () => (await db.fixedAssets.toArray()).length === 4);
    // 2026 → 2027 の順で、開業日を渡さずに年末償却を生成する（earliestOpeningDate のフォールバックに委ねる）。
    const r2026 = await generateYearEndDepreciation(2026);
    expect(r2026.smallAssetCapExceeded).toBe(1);
    expect(r2026.created).toBe(4); // 3件は少額特例で全額費用化、4件目は落選し定額法の月割で作成

    const fourth = (await db.fixedAssets.toArray()).find(
      (a) => a.acquisitionDate === '2026-11-01',
    )!;
    expect(fourth.depreciationMethod).toBe('small-asset-special');
    const tag = `#${fourth.id.slice(0, 8)}`;
    const entries2026 = await db.journalEntries.where('year').equals(2026).toArray();
    const entry2026 = entries2026.find((e) => e.description.includes(tag));
    expect(entry2026?.description).not.toContain('措法28の2');
    const lines2026 = await db.journalLines.where('entryId').equals(entry2026!.id).toArray();
    // 定額法・耐用4年（率0.250）、取得月11月なので月割：390,000×0.250×2/12=16,250
    expect(lines2026.find((l) => l.accountCode === '5210')?.amount).toBe('16250');

    const r2027 = await generateYearEndDepreciation(2027);
    expect(r2027.created).toBe(1); // 他の3件は前年に全額費用化済みで当年分は0円のためスキップ
    const entries2027 = await db.journalEntries.where('year').equals(2027).toArray();
    const entry2027 = entries2027.find((e) => e.description.includes(tag));
    expect(entry2027).toBeDefined();
    const lines2027 = await db.journalLines.where('entryId').equals(entry2027!.id).toArray();
    // 2年目は全年：390,000×0.250=97,500（原始取得価額そのまま）
    expect(lines2027.find((l) => l.accountCode === '5210')?.amount).toBe('97500');

    const fixedAssets = await db.fixedAssets.toArray();
    const koa210Row2027 = mapKoa210RepeatedValues(
      minimalXtxCtx(fixedAssets, 2027, '2026-07-01'),
    ).AMF01600?.find((r) => r.AMF01610 === `少額特例資産4`);
    expect(koa210Row2027?.AMF01660).toBe('定額法');
    expect(koa210Row2027?.AMF01730).toBe('97500');
  });
});
