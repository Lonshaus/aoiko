import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { mount, unmount } from 'svelte';
import { db } from '../db/db';
import { m } from '../paraglide/messages';
import { ACCOUNTS_2026 } from '../tax-schema/2026';

const { default: OpeningSetup } = await import('./OpeningSetup.svelte');

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

function setValue(el: HTMLInputElement, value: string): void {
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

function buttonByText(root: ParentNode, text: string): HTMLButtonElement | undefined {
  return [...root.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.textContent?.trim() === text,
  );
}

let container: HTMLElement | undefined;
let instance: Record<string, unknown> | undefined;

async function render(): Promise<void> {
  container = document.createElement('div');
  document.body.appendChild(container);
  instance = mount(OpeningSetup, { target: container, props: {} });
  await waitFor(() => container!.querySelector('input[name="jigyoStartDate"]') !== null);
  const dateInputs = [...container.querySelectorAll<HTMLInputElement>('input[type="date"]')];
  setValue(dateInputs[0]!, '2026-07-01');
}

async function addExpense(name: string, amount: string): Promise<void> {
  setValue(
    container!.querySelector<HTMLInputElement>(
      `input[placeholder="${m.opening_expense_name_placeholder()}"]`,
    )!,
    name,
  );
  const amountInput = container!.querySelector<HTMLInputElement>(
    `input[placeholder="${m.opening_amount_placeholder()}"]`,
  )!;
  setValue(amountInput, amount);
  amountInput.closest('form')!.querySelector<HTMLButtonElement>('button[type="submit"]')!.click();
  await tick();
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
  container?.remove();
  container = undefined;
  await db.delete();
});

describe('開業設定の金額入力', () => {
  test('名前だけで金額が空の開業費は、黙って無視せず案内を出す', async () => {
    await render();
    await addExpense('名刺', '');
    expect(container!.textContent).toContain(m.common_amount_invalid());
    expect(container!.textContent).not.toContain('名刺（');
    expect(container!.querySelector('ul')).toBeNull();
  });

  test.each(['1e3', '100000000000000'])('開業費 %j は追加されず案内が出る', async (bad) => {
    await render();
    await addExpense('名刺', bad);
    expect(container!.querySelector('ul')).toBeNull();
    expect(container!.textContent).toContain(
      bad === '1e3' ? m.common_amount_invalid() : m.common_amount_too_large(),
    );
  });

  test.each([
    ['1e3', () => m.common_amount_invalid()],
    ['100000000000000', () => m.common_amount_too_large()],
  ])(
    '任意償却の当年の償却額 %j は、読めない値と 100 兆円以上で別々の案内が出る',
    async (bad, message) => {
      await render();
      await addExpense('名刺', '100000');
      container!.querySelector<HTMLInputElement>('input[type="radio"][value="custom"]')!.click();
      await tick();
      const amount = container!.querySelector<HTMLInputElement>(
        'input[name="openingKeihiCustomAmortization"]',
      )!;
      expect(container!.textContent).not.toContain(m.common_amount_invalid());
      setValue(amount, bad);
      await tick();
      expect(container!.textContent).toContain(message());
      const other = bad === '1e3' ? m.common_amount_too_large() : m.common_amount_invalid();
      expect(container!.textContent).not.toContain(other);
    },
  );

  describe('自由項目', () => {
    async function addCustom(amount: string, name = '預り金', account = '2110'): Promise<void> {
      await waitFor(
        () =>
          container!.querySelector(
            `select[name="customItemAccount"] option[value="${account}"]`,
          ) !== null,
      );
      const form = container!
        .querySelector<HTMLInputElement>('input[name="customItemTitle"]')!
        .closest('form')!;
      setValue(container!.querySelector<HTMLInputElement>('input[name="customItemTitle"]')!, name);
      const select = container!.querySelector<HTMLSelectElement>(
        'select[name="customItemAccount"]',
      )!;
      select.value = account;
      select.dispatchEvent(new Event('change', { bubbles: true }));
      container!.querySelector<HTMLSelectElement>('select[name="customItemSide"]')!.value =
        'credit';
      container!
        .querySelector<HTMLSelectElement>('select[name="customItemSide"]')!
        .dispatchEvent(new Event('change', { bubbles: true }));
      setValue(
        container!.querySelector<HTMLInputElement>('input[name="customItemAmount"]')!,
        amount,
      );
      await tick();
      form.querySelector<HTMLButtonElement>('button[type="submit"]')!.click();
      await tick();
    }

    beforeEach(async () => {
      await db.accounts.bulkPut(ACCOUNTS_2026.map((a) => ({ ...a, year: 2026 })));
      await db.settings.put({ key: 'currentYear', value: 2026, updatedAt: 1 });
    });

    test.each([
      ['1e3', () => m.common_amount_invalid()],
      ['100000000000000', () => m.common_amount_too_large()],
      ['', () => m.common_amount_invalid()],
    ])('金額 %j は、開業費と同じ案内を出して追加しない', async (bad, message) => {
      await render();
      await addCustom(bad);
      expect(container!.textContent).toContain(message());
      expect(
        [...container!.querySelectorAll('span')].some(
          (el) => el.textContent?.includes('預り金（2110）') === true,
        ),
      ).toBe(false);
    });
  });

  describe('作成の前に 100 兆円以上の額を止める', () => {
    async function confirmAndExpectBlocked(): Promise<void> {
      buttonByText(container!, m.opening_action_preview())!.click();
      await tick();
      buttonByText(container!, m.opening_action_confirm())!.click();
      await waitFor(() => (container!.textContent ?? '').includes(m.common_amount_too_large()));
      await new Promise((r) => setTimeout(r, 100));
      expect(await db.journalEntries.count()).toBe(0);
      expect(await db.fixedAssets.count()).toBe(0);
    }

    test('開業費の合計が 100 兆円以上なら作成しない', async () => {
      await render();
      await addExpense('車', '60000000000000');
      await addExpense('家', '60000000000000');
      await confirmAndExpectBlocked();
    });

    test('任意償却の償却額が 100 兆円以上なら作成しない', async () => {
      await render();
      await addExpense('名刺', '100000');
      container!.querySelector<HTMLInputElement>('input[type="radio"][value="custom"]')!.click();
      await tick();
      setValue(
        container!.querySelector<HTMLInputElement>('input[name="openingKeihiCustomAmortization"]')!,
        '100000000000000',
      );
      await tick();
      await confirmAndExpectBlocked();
    });

    test('転用資産の未償却残高の合計（元入金の額）が 100 兆円以上なら作成しない', async () => {
      await render();
      const add = async (name: string): Promise<void> => {
        setValue(
          container!.querySelector<HTMLInputElement>('input[name="convertedAssetTitle"]')!,
          name,
        );
        setValue(
          container!.querySelector<HTMLInputElement>(
            'input[name="convertedAssetAcquisitionDate"]',
          )!,
          '2026-07-01',
        );
        setValue(
          container!.querySelector<HTMLInputElement>(
            'input[name="convertedAssetAcquisitionCost"]',
          )!,
          '60000000000000',
        );
        setValue(
          container!.querySelector<HTMLInputElement>('input[name="convertedAssetUsefulLife"]')!,
          '4',
        );
        await tick();
        container!
          .querySelector<HTMLInputElement>('input[name="convertedAssetTitle"]')!
          .closest('form')!
          .querySelector<HTMLButtonElement>('button[type="submit"]')!
          .click();
        await tick();
      };
      await add('機械A');
      await add('機械B');
      await confirmAndExpectBlocked();
    });
  });

  test('作り直しは、合計が大きすぎるとき既存の開業仕訳を打ち消さない', async () => {
    await render();
    await addExpense('名刺', '100000');
    buttonByText(container!, m.opening_action_preview())!.click();
    await tick();
    buttonByText(container!, m.opening_action_confirm())!.click();
    await waitFor(async () => (await db.journalEntries.count()) === 2);

    unmount(instance!);
    container!.remove();
    await render();
    await addExpense('名刺', '100000');
    buttonByText(container!, m.opening_action_preview())!.click();
    await tick();
    buttonByText(container!, m.opening_action_confirm())!.click();
    await waitFor(() => buttonByText(container!, m.opening_redo_button()) !== undefined);

    buttonByText(container!, m.opening_action_back())!.click();
    await tick();
    await addExpense('車', '60000000000000');
    await addExpense('家', '60000000000000');
    buttonByText(container!, m.opening_action_preview())!.click();
    await tick();
    buttonByText(container!, m.opening_redo_button())!.click();
    await waitFor(() => buttonByText(document.body, m.opening_redo_confirm_action()) !== undefined);
    buttonByText(document.body, m.opening_redo_confirm_action())!.click();

    await waitFor(() => (container!.textContent ?? '').includes(m.common_amount_too_large()));
    await new Promise((r) => setTimeout(r, 100));
    expect(await db.journalEntries.count()).toBe(2);
    const originals = await db.journalEntries.toArray();
    expect(originals.every((e) => e.originalEntryId === undefined)).toBe(true);
  });
});

describe('転用資産の入力（R13・R15）', () => {
  function assetInput(name: string): HTMLInputElement {
    return container!.querySelector<HTMLInputElement>(`input[name="${name}"]`)!;
  }

  function listed(): boolean {
    return [...container!.querySelectorAll('li')].some((li) => li.textContent?.includes('私用 PC'));
  }

  async function addAsset(cost: string, life: string): Promise<void> {
    setValue(assetInput('convertedAssetTitle'), '私用 PC');
    setValue(assetInput('convertedAssetAcquisitionDate'), '2020-01-01');
    setValue(assetInput('convertedAssetAcquisitionCost'), cost);
    setValue(assetInput('convertedAssetUsefulLife'), life);
    await tick();
    assetInput('convertedAssetTitle')
      .closest('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await tick();
  }

  test.each([
    ['-5', '4', m.common_amount_invalid()],
    ['100000000000000', '4', m.common_amount_too_large()],
    ['300000', '1', m.opening_asset_life_unsupported()],
    ['300000', '68', m.opening_asset_life_unsupported()],
  ])('取得価額 %j・耐用年数 %j は案内を出して加えない', async (cost, life, message) => {
    await render();
    await addAsset(cost, life);
    expect(container!.textContent).toContain(message);
    expect(listed()).toBe(false);
    expect(await db.fixedAssets.count()).toBe(0);
  });

  test.each([
    ['-5', '4', () => `${m.settings_asset_cost_placeholder()}：${m.common_amount_invalid()}`],
    [
      '100000000000000',
      '4',
      () => `${m.settings_asset_cost_placeholder()}：${m.common_amount_too_large()}`,
    ],
    ['300000', '0', () => `${m.settings_asset_life_title()}：${m.fixed_asset_issue_useful_life()}`],
    [
      '300000',
      '1',
      () => `${m.settings_asset_life_title()}：${m.opening_asset_life_unsupported()}`,
    ],
    [
      '300000',
      '68',
      () => `${m.settings_asset_life_title()}：${m.opening_asset_life_unsupported()}`,
    ],
  ])(
    '取得価額 %j・耐用年数 %j のエラーは「欄名：メッセージ」の形で示す',
    async (cost, life, message) => {
      await render();
      await addAsset(cost, life);
      expect(container!.textContent).toContain(message());
    },
  );

  test('耐用年数 67 は加えられ、未償却残高を示す', async () => {
    await render();
    await addAsset('300000', '67');
    expect(container!.textContent).not.toContain(m.opening_asset_life_unsupported());
    expect(listed()).toBe(true);
  });
});
