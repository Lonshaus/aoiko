// 固定資産の登録欄：科目は科目表から作り、所令6条の号・一括償却のグループを資産に書き込む。
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { mount, unmount } from 'svelte';
import { db } from '../db/db';
import { m } from '../paraglide/messages';
import { DEPRECIABLE_ASSET_ACCOUNTS } from '../tax-schema/2026/accounts';
import type { FixedAsset } from '../db/types';

const { default: Settings } = await import('./Settings.svelte');

async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('waitFor タイムアウト');
    }
    await new Promise((r) => setTimeout(r, 10));
  }
}

let container: HTMLElement | undefined;
let instance: Record<string, unknown> | undefined;

function assetForm(): HTMLFormElement {
  const name = container!.querySelector<HTMLInputElement>(
    `input[placeholder="${m.settings_asset_name_placeholder()}"]`,
  );
  const form = name?.closest('form');
  if (!form) {
    throw new Error('固定資産の登録フォームが見付からない');
  }
  return form;
}

function field<T extends Element>(selector: string): T {
  const el = assetForm().querySelector<T>(selector);
  if (!el) {
    throw new Error(`${selector} が見付からない`);
  }
  return el;
}

function setValue(el: HTMLInputElement | HTMLSelectElement, value: string, event: string): void {
  el.value = value;
  el.dispatchEvent(new Event(event, { bubbles: true }));
}

async function tick(): Promise<void> {
  await new Promise((r) => setTimeout(r, 20));
}
// onMount の直列読み込みが終わる前に afterEach の db.delete() が走ると DatabaseClosedError が未処理で残るため、最後に読む設定に目印を仕込んで表示まで待つ。
const MOUNT_SENTINEL = 'ZZZ9';

async function renderSettings(): Promise<void> {
  await db.settings.put({
    key: 'homeOfficeAccountRatios',
    value: { [MOUNT_SENTINEL]: '0.30' },
    updatedAt: Date.now(),
  });
  container = document.createElement('div');
  document.body.appendChild(container);
  instance = mount(Settings, { target: container, props: {} });
  await waitFor(
    () =>
      container!.querySelector(`input[placeholder="${m.settings_asset_name_placeholder()}"]`) !==
      null,
  );
  await waitFor(() => (container!.textContent ?? '').includes(MOUNT_SENTINEL));
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

describe('固定資産の登録欄', () => {
  test('科目の選択肢は科目表の減価償却資産科目と一致する', async () => {
    await renderSettings();
    const select = field<HTMLSelectElement>(`select[title="${m.settings_asset_account_title()}"]`);
    expect([...select.options].map((o) => o.value)).toEqual(
      DEPRECIABLE_ASSET_ACCOUNTS.map((a) => a.code),
    );
  });

  test('科目を選ぶと所令6条の号が推定され、一括償却資産はグループ付きで登録される', async () => {
    await renderSettings();
    const account = field<HTMLSelectElement>(`select[title="${m.settings_asset_account_title()}"]`);
    const category = field<HTMLSelectElement>(`select[title="${m.settings_asset_category()}"]`);
    setValue(account, '1516', 'change');
    await tick();
    expect(category.value).toBe('8');

    setValue(account, '1510', 'change');
    await tick();
    expect(category.value).toBe('7');
    setValue(
      field<HTMLInputElement>(`input[placeholder="${m.settings_asset_name_placeholder()}"]`),
      'モニター',
      'input',
    );
    setValue(
      field<HTMLInputElement>(`input[placeholder="${m.settings_asset_cost_placeholder()}"]`),
      '150000',
      'input',
    );
    setValue(
      field<HTMLInputElement>(`input[title="${m.settings_asset_date_title()}"]`),
      '2026-05-01',
      'input',
    );
    setValue(
      field<HTMLSelectElement>(`select[title="${m.settings_asset_method_title()}"]`),
      'lump-sum',
      'change',
    );
    await tick();
    field<HTMLButtonElement>('button[type="submit"]').click();

    let stored: FixedAsset[] = [];
    for (let i = 0; i < 100 && stored.length === 0; i++) {
      await tick();
      stored = await db.fixedAssets.toArray();
    }
    expect(stored[0]).toMatchObject({
      name: 'モニター',
      accountCode: '1510',
      depreciationMethod: 'lump-sum',
      assetCategory: 7,
      lumpSumPoolId: 'business-2026',
    });
    expect(stored[0]?.isMineShaft).toBeUndefined();
    expect(stored[0]?.isLeasedOut).toBeUndefined();
  });

  test('当年に売却した資産があれば譲渡所得の年分集計を表示する', async () => {
    const year = new Date().getFullYear();
    await db.fixedAssets.add({
      id: 'sold',
      name: '売却した機材',
      acquisitionDate: `${year - 10}-01-01`,
      acquisitionCost: '1000000',
      usefulLifeYears: 4,
      depreciationMethod: 'straight-line',
      accountCode: '1510',
      disposedDate: `${year}-03-31`,
      disposalType: 'sale',
      salePrice: '700000',
    });
    await renderSettings();
    const title = m.settings_transfer_income_aggregate_title({ year });
    await waitFor(() => container!.textContent?.includes(title) === true);
    // 長期 699,999（簿価 1 円）− 特別控除 500,000 = 199,999、その 1/2 は 99,999
    expect(container!.textContent).toContain('¥99,999');
  });
});

describe('少額特例落選資産の画面での扱い', () => {
  test('新しい方法選択肢・essentialToBusiness／usableLifeUnderOneYear／leaseTermMonths／decliningBalanceElected を保存できる', async () => {
    await renderSettings();
    const methodSelect = field<HTMLSelectElement>(
      `select[title="${m.settings_asset_method_title()}"]`,
    );
    const optionValues = [...methodSelect.options].map((o) => o.value);
    expect(optionValues).toContain('lease-period-straight-line');

    setValue(
      field<HTMLInputElement>(`input[placeholder="${m.settings_asset_name_placeholder()}"]`),
      'リース複合機',
      'input',
    );
    setValue(
      field<HTMLInputElement>(`input[placeholder="${m.settings_asset_cost_placeholder()}"]`),
      '1200000',
      'input',
    );
    setValue(methodSelect, 'lease-period-straight-line', 'change');
    await tick();
    const leaseTermInput = field<HTMLInputElement>(
      `input[title="${m.settings_asset_lease_term_months()}"]`,
    );
    setValue(leaseTermInput, '60', 'input');
    const essentialCheckbox =
      assetForm().querySelector<HTMLInputElement>(`input[type="checkbox"]`)!;
    // essentialToBusiness・usableLifeUnderOneYear はチェックボックス。名前でラベルを特定する。
    const labels = [...assetForm().querySelectorAll('label')];
    const essentialLabel = labels.find((l) =>
      l.textContent?.includes(m.settings_asset_essential_to_business()),
    );
    const usableLifeLabel = labels.find((l) =>
      l.textContent?.includes(m.settings_asset_usable_life_under_one_year()),
    );
    essentialLabel?.querySelector('input')?.click();
    usableLifeLabel?.querySelector('input')?.click();
    await tick();
    field<HTMLButtonElement>('button[type="submit"]').click();

    let stored: FixedAsset[] = [];
    for (let i = 0; i < 100 && stored.length === 0; i++) {
      await tick();
      stored = await db.fixedAssets.toArray();
    }
    expect(essentialCheckbox).toBeDefined();
    expect(stored[0]).toMatchObject({
      name: 'リース複合機',
      depreciationMethod: 'lease-period-straight-line',
      leaseTermMonths: 60,
      essentialToBusiness: true,
      usableLifeUnderOneYear: true,
    });
  });

  test('少額特例のとき decliningBalanceElected チェックボックスを保存できる', async () => {
    await renderSettings();
    setValue(
      field<HTMLInputElement>(`input[placeholder="${m.settings_asset_name_placeholder()}"]`),
      '定率法落選予定資産',
      'input',
    );
    setValue(
      field<HTMLInputElement>(`input[placeholder="${m.settings_asset_cost_placeholder()}"]`),
      '250000',
      'input',
    );
    setValue(
      field<HTMLSelectElement>(`select[title="${m.settings_asset_method_title()}"]`),
      'small-asset-special',
      'change',
    );
    await tick();
    const labels = [...assetForm().querySelectorAll('label')];
    const decliningLabel = labels.find((l) =>
      l.textContent?.includes(m.settings_asset_declining_balance_elected()),
    );
    expect(decliningLabel, 'decliningBalanceElected チェックボックスが表示される').toBeDefined();
    decliningLabel!.querySelector('input')!.click();
    await tick();
    field<HTMLButtonElement>('button[type="submit"]').click();

    let stored: FixedAsset[] = [];
    for (let i = 0; i < 100 && stored.length === 0; i++) {
      await tick();
      stored = await db.fixedAssets.toArray();
    }
    expect(stored[0]?.decliningBalanceElected).toBe(true);
  });

  test('落選資産の処分は定額法の累計償却額で1520を借方に計上する（修正前は390,000）', async () => {
    const { generateYearEndDepreciation } = await import('../domain/depreciation');
    const dates = ['04-01', '05-01', '06-01', '07-01', '08-01', '09-01', '10-01', '11-01'];
    await db.fixedAssets.bulkAdd(
      dates.map((d, i) => ({
        id: `f12b-${i}`,
        name: `資産${i}`,
        acquisitionDate: `2026-${d}`,
        acquisitionCost: '390000',
        usefulLifeYears: 4,
        depreciationMethod: 'small-asset-special' as const,
        accountCode: '1510',
      })),
    );
    await generateYearEndDepreciation(2026);
    const eighth = await db.fixedAssets.get('f12b-7');
    await db.fixedAssets.put({ ...eighth!, disposedDate: '2027-06-01' });
    await generateYearEndDepreciation(2027);

    await renderSettings();
    await waitFor(
      () =>
        [...container!.querySelectorAll('button')].some(
          (b) => b.textContent?.trim() === m.settings_asset_disposal_run_button(),
        ),
      4000,
    );
    const runButton = [...container!.querySelectorAll('button')].find(
      (b) => b.textContent?.trim() === m.settings_asset_disposal_run_button(),
    );
    expect(runButton).toBeDefined();
    runButton!.click();

    let lines: Array<{ accountCode: string; amount: string; entryId: string; side: string }> = [];
    for (let i = 0; i < 100; i++) {
      await tick();
      lines = await db.journalLines.toArray();
      if (lines.some((l) => l.accountCode === '1520' && l.side === 'debit')) {
        break;
      }
    }
    // 除却仕訳の 1520 借方（既存の年末償却仕訳は 1520 貸方のため side で絞る）
    const accDepLine = lines.find((l) => l.accountCode === '1520' && l.side === 'debit');
    expect(accDepLine?.amount).toBe('65000');
  });
});
