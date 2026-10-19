// Reports.svelte の2割／3割特例の基礎調整欄（売上対価の返還等）が
// 設定へ保存され、再マウント（＝再読込相当）後も保持されることを見る。
import { afterEach, beforeEach, describe, expect, test, vi, type MockInstance } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { db } from '../db/db';
import { ACCOUNTS_2026 } from '../tax-schema/2026';
import { getSetting, setSetting, type StoredWariBaseAdjustments } from '../lib/settings';
import { m } from '../paraglide/messages';
import { hasUnsavedChanges } from '../router.svelte';
import type { Account } from '../db/types';

vi.mock('../lib/save-file', () => ({
  saveTextFile: vi.fn(async () => 'saved' as const),
}));

const { default: Reports } = await import('./Reports.svelte');

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

async function seedAccounts(year: number): Promise<void> {
  const accs: Account[] = ACCOUNTS_2026.map((a) => ({ ...a, year }));
  await db.accounts.bulkPut(accs);
}

let container: HTMLElement | undefined;
let instance: Record<string, unknown> | undefined;

beforeEach(async () => {
  await db.delete();
  await db.open();
  await seedAccounts(2026);
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
  vi.clearAllMocks();
});

function findInputByLabelText(el: HTMLElement, labelText: string): HTMLInputElement {
  const label = Array.from(el.querySelectorAll('label')).find((l) =>
    (l.textContent ?? '').includes(labelText),
  );
  if (label === undefined) {
    throw new Error(`label "${labelText}" not found`);
  }
  const input = label.querySelector('input');
  if (input === null) {
    throw new Error(`input under label "${labelText}" not found`);
  }
  return input;
}

describe('wariSalesReturnTax78/624 の設定保存と再読込後の保持', () => {
  test('入力して change すると設定へ保存され、再マウント後も同じ値が表示される', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    instance = mount(Reports, { target: container, props: {} });

    await waitFor(() =>
      Array.from(container!.querySelectorAll('label')).some((l) =>
        (l.textContent ?? '').includes('売上対価の返還等に係る消費税額（税率7.8%分）'),
      ),
    );
    const input = findInputByLabelText(container, '売上対価の返還等に係る消費税額（税率7.8%分）');
    input.value = '10000';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));

    await waitFor(() => {
      // liveQuery/非同期保存が終わるまで待つ
      return true;
    }, 50);
    const saved = await new Promise<Record<number, { salesReturnTax78?: string }> | undefined>(
      (resolve) => {
        const check = async () => {
          const v = await getSetting('wariBaseAdjustments');
          if (v?.[2026]?.salesReturnTax78 === '10000') {
            resolve(v);
          } else {
            setTimeout(check, 10);
          }
        };
        check();
      },
    );
    expect(saved?.[2026]?.salesReturnTax78).toBe('10000');

    unmount(instance);
    instance = undefined;
    container.remove();
    container = document.createElement('div');
    document.body.appendChild(container);
    instance = mount(Reports, { target: container, props: {} });
    await waitFor(() =>
      Array.from(container!.querySelectorAll('label')).some((l) =>
        (l.textContent ?? '').includes('売上対価の返還等に係る消費税額（税率7.8%分）'),
      ),
    );
    await waitFor(() => {
      const reloaded = findInputByLabelText(
        container!,
        '売上対価の返還等に係る消費税額（税率7.8%分）',
      );
      return reloaded.value === '10000';
    });
    const reloaded = findInputByLabelText(
      container,
      '売上対価の返還等に係る消費税額（税率7.8%分）',
    );
    expect(reloaded.value).toBe('10000');
  });
});

describe('interimPriorPeriodMonths の設定保存と再読込後の保持', () => {
  test('直前課税期間の月数を入力すると設定へ保存され、再マウント後も保持される', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    instance = mount(Reports, { target: container, props: {} });

    await waitFor(() =>
      Array.from(container!.querySelectorAll('label')).some((l) =>
        (l.textContent ?? '').includes('直前の課税期間の月数'),
      ),
    );
    const input = findInputByLabelText(container, '直前の課税期間の月数');
    input.value = '3';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));

    const saved = await new Promise<Record<number, number> | undefined>((resolve) => {
      const check = async () => {
        const v = await getSetting('interimPriorPeriodMonths');
        if (v?.[2026] === 3) {
          resolve(v);
        } else {
          setTimeout(check, 10);
        }
      };
      check();
    });
    expect(saved?.[2026]).toBe(3);

    unmount(instance);
    instance = undefined;
    container.remove();
    container = document.createElement('div');
    document.body.appendChild(container);
    instance = mount(Reports, { target: container, props: {} });
    await waitFor(() => {
      const found = Array.from(container!.querySelectorAll('label')).find((l) =>
        (l.textContent ?? '').includes('直前の課税期間の月数'),
      );
      return found?.querySelector('input')?.value === '3';
    });
    const reloaded = findInputByLabelText(container, '直前の課税期間の月数');
    expect(reloaded.value).toBe('3');
  });
});

describe('2割／3割特例の基礎調整欄は change まで未保存として登録される', () => {
  function named(name: string): HTMLInputElement {
    const el = container!.querySelector<HTMLInputElement>(`input[name="${name}"]`);
    if (el === null) {
      throw new Error(`${name} が見付からない`);
    }
    return el;
  }
  function focusOn(name: string): void {
    named(name).dispatchEvent(new FocusEvent('focus'));
  }
  function typeInto(name: string, value: string): void {
    const el = named(name);
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
  }
  // 保存関数末尾の再読込（getSetting）は put 完了直後に発行されるため、その後に読めば終わりが保証される
  async function drainSettings(): Promise<void> {
    await db.settings.toArray();
  }
  async function mountWithRows(count: number): Promise<void> {
    await setSetting('wariBaseAdjustments', {
      2026: {
        specifiedSmallAssetTransfers: Array.from({ length: count }, (_, i) => ({
          date: `2026-01-0${i + 1}`,
          rate: 0.1,
          netTax: `${(i + 1) * 100}`,
        })),
      },
    });
    container = document.createElement('div');
    document.body.appendChild(container);
    instance = mount(Reports, { target: container, props: {} });
    await waitFor(
      () => container!.querySelector(`input[name="wariTransfer-netTax-${count - 1}"]`) !== null,
    );
  }
  function removeButtons(): HTMLButtonElement[] {
    return Array.from(container!.querySelectorAll('button')).filter(
      (b) => (b.textContent ?? '').trim() === m.income_deductions_dependent_remove(),
    );
  }

  test.each([
    ['wariSalesReturnTax78', '10000'],
    ['wariSalesReturnTax624', '20000'],
  ])('%s：input だけでは未保存・保存されず、change で解除され保存される', async (name, value) => {
    container = document.createElement('div');
    document.body.appendChild(container);
    instance = mount(Reports, { target: container, props: {} });
    await waitFor(() => container!.querySelector(`input[name="${name}"]`) !== null);
    expect(hasUnsavedChanges()).toBe(false);
    focusOn(name);
    typeInto(name, value);
    expect(hasUnsavedChanges()).toBe(true);
    expect(await getSetting('wariBaseAdjustments')).toBeUndefined();

    named(name).dispatchEvent(new Event('change', { bubbles: true }));
    flushSync();
    expect(hasUnsavedChanges()).toBe(false);
    await waitFor(async () =>
      (JSON.stringify(await getSetting('wariBaseAdjustments')) ?? '').includes(value),
    );
    await drainSettings();
  });

  test.each([
    ['wariTransfer-date-0', '2026-03-01'],
    ['wariTransfer-netTax-0', '30000'],
  ])('%s：input で未保存として登録され、blur だけでは解除されない', async (name, value) => {
    await mountWithRows(1);
    expect(hasUnsavedChanges()).toBe(false);
    focusOn(name);
    typeInto(name, value);
    expect(hasUnsavedChanges()).toBe(true);
    named(name).dispatchEvent(new FocusEvent('blur'));
    flushSync();
    expect(hasUnsavedChanges()).toBe(true);
  });

  test.each([
    ['wariTransfer-date-0', '2026-03-01'],
    ['wariTransfer-netTax-0', '30000'],
    ['wariSalesReturnTax78', '5'],
  ])('%s：元の値へ戻すと（blur なしで）未保存は解除される', async (name, value) => {
    await mountWithRows(1);
    focusOn(name);
    const original = named(name).value;
    typeInto(name, value);
    expect(hasUnsavedChanges()).toBe(true);
    typeInto(name, original);
    expect(hasUnsavedChanges()).toBe(false);
  });

  test('行を消すとその行の未確定入力の登録も消える', async () => {
    await mountWithRows(1);
    focusOn('wariTransfer-netTax-0');
    typeInto('wariTransfer-netTax-0', '2');
    expect(hasUnsavedChanges()).toBe(true);
    removeButtons()[0]!.click();
    flushSync();
    expect(hasUnsavedChanges()).toBe(false);
    await waitFor(async () => (await getSetting('wariBaseAdjustments'))?.[2026] !== undefined);
    await drainSettings();
  });
  test('複数行の途中の行を消すと、後ろの行の登録は1つ前へ詰まり、消した行の登録は無くなる', async () => {
    await mountWithRows(3);
    for (const [name, value] of [
      ['wariTransfer-netTax-0', '11'],
      ['wariTransfer-netTax-1', '22'],
      ['wariTransfer-netTax-2', '33'],
    ] as const) {
      focusOn(name);
      typeInto(name, value);
    }
    expect(hasUnsavedChanges()).toBe(true);

    removeButtons()[1]!.click();
    flushSync();
    await waitFor(
      async () =>
        (await getSetting('wariBaseAdjustments'))?.[2026]?.specifiedSmallAssetTransfers?.length ===
        2,
    );
    await drainSettings();
    expect(container!.querySelector('input[name="wariTransfer-netTax-2"]')).toBeNull();
    expect(hasUnsavedChanges()).toBe(true);

    typeInto('wariTransfer-netTax-0', '100');
    expect(hasUnsavedChanges()).toBe(true);
    typeInto('wariTransfer-netTax-1', '300');
    expect(hasUnsavedChanges()).toBe(false);
  });

  test('未確定の入力を残したままアンマウントすると登録は残らない', async () => {
    await mountWithRows(1);
    focusOn('wariSalesReturnTax78');
    typeInto('wariSalesReturnTax78', '1');
    expect(hasUnsavedChanges()).toBe(true);
    unmount(instance!);
    instance = undefined;
    expect(hasUnsavedChanges()).toBe(false);
  });
});

describe('特定少額資産の譲渡行は入力して change すると保存され、再マウント後も保持される', () => {
  function named(name: string): HTMLInputElement {
    const el = container!.querySelector<HTMLInputElement>(`[name="${name}"]`);
    if (el === null) {
      throw new Error(`${name} が見付からない`);
    }
    return el;
  }
  function commit(name: string, value: string): void {
    const el = named(name);
    el.dispatchEvent(new FocusEvent('focus'));
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    flushSync();
  }
  async function mountReports(): Promise<void> {
    container = document.createElement('div');
    document.body.appendChild(container);
    instance = mount(Reports, { target: container, props: {} });
    await waitFor(() => container!.querySelector('input[name="wariSalesReturnTax78"]') !== null);
  }
  async function remount(): Promise<void> {
    unmount(instance!);
    instance = undefined;
    container!.remove();
    await mountReports();
  }
  function addButton(): HTMLButtonElement {
    const hint = Array.from(container!.querySelectorAll('p')).find(
      (p) => (p.textContent ?? '').trim() === m.reports_wari_specified_small_asset_transfers_hint(),
    );
    const b = Array.from(hint?.parentElement?.querySelectorAll('button') ?? []).find(
      (x) => (x.textContent ?? '').trim() === m.settings_action_add(),
    );
    if (b === undefined) {
      throw new Error('追加ボタンが見付からない');
    }
    return b;
  }
  function removeButtons(): HTMLButtonElement[] {
    return Array.from(container!.querySelectorAll('button')).filter(
      (b) => (b.textContent ?? '').trim() === m.income_deductions_dependent_remove(),
    );
  }
  async function addRow(index: number, date: string, netTax: string): Promise<void> {
    addButton().click();
    flushSync();
    await waitFor(
      () => container!.querySelector(`input[name="wariTransfer-netTax-${index}"]`) !== null,
    );
    commit(`wariTransfer-date-${index}`, date);
    commit(`wariTransfer-netTax-${index}`, netTax);
  }
  async function storedTransfers() {
    return (await getSetting('wariBaseAdjustments'))?.[2026]?.specifiedSmallAssetTransfers;
  }
  // 値が変わらない保存でも終わりを待てるよう、put の完了を直接待つ
  let putSpy: MockInstance<typeof db.settings.put> | undefined;
  beforeEach(() => {
    putSpy = vi.spyOn(db.settings, 'put');
  });
  afterEach(() => {
    putSpy?.mockRestore();
    putSpy = undefined;
  });
  async function settled(action: () => void): Promise<void> {
    const spy = putSpy!;
    const before = spy.mock.calls.length;
    action();
    await waitFor(() => spy.mock.calls.length > before);
    await Promise.all(spy.mock.results.slice(before).map((r) => r.value));
    await db.settings.toArray();
  }
  async function commitSettled(name: string, value: string): Promise<void> {
    await settled(() => commit(name, value));
  }
  async function addEmptyRow(index: number): Promise<void> {
    addButton().click();
    flushSync();
    await waitFor(
      () => container!.querySelector(`input[name="wariTransfer-netTax-${index}"]`) !== null,
    );
  }
  async function storedNetTaxes() {
    return (await storedTransfers())?.map((t) => t.netTax);
  }
  async function mountWithStored(
    stored: StoredWariBaseAdjustments,
    readyName: string,
    readyValue: string,
  ): Promise<void> {
    await setSetting('wariBaseAdjustments', { 2026: stored });
    await mountReports();
    await waitFor(() => container!.querySelector(`input[name="${readyName}"]`) !== null);
    await waitFor(() => named(readyName).value === readyValue);
  }

  test('追加した行を入力して change すると保存され、再マウント後も同じ日付と金額が表示される', async () => {
    await mountReports();
    await addRow(0, '2026-03-01', '5000');
    await waitFor(async () => (await storedTransfers())?.[0]?.netTax === '5000');
    expect(await storedTransfers()).toEqual([{ date: '2026-03-01', rate: 0.1, netTax: '5000' }]);

    await remount();
    await waitFor(() => container!.querySelector('input[name="wariTransfer-netTax-0"]') !== null);
    await waitFor(() => named('wariTransfer-netTax-0').value === '5000');
    expect(named('wariTransfer-date-0').value).toBe('2026-03-01');
    expect(named('wariTransfer-netTax-0').value).toBe('5000');
    await db.settings.toArray();
  });

  test('2行を保存した状態で先頭の行を消すと、保存済みの配列には後ろの行だけが残る', async () => {
    await mountReports();
    await addRow(0, '2026-03-01', '5000');
    await addRow(1, '2026-04-01', '7000');
    await waitFor(async () => (await storedTransfers())?.length === 2);

    removeButtons()[0]!.click();
    flushSync();
    await waitFor(async () => (await storedTransfers())?.length === 1);
    expect(await storedTransfers()).toEqual([{ date: '2026-04-01', rate: 0.1, netTax: '7000' }]);
    await db.settings.toArray();
  });

  test('カンマ付きの金額は半角に揃えて保存され、読めない金額は保存されず保存済みの値が残る', async () => {
    await mountReports();
    await addEmptyRow(0);
    await commitSettled('wariTransfer-date-0', '2026-03-01');
    await commitSettled('wariTransfer-netTax-0', '5,000');
    expect(await storedNetTaxes()).toEqual(['5000']);
    await addEmptyRow(1);
    await commitSettled('wariTransfer-date-1', '2026-04-01');
    expect(await storedNetTaxes()).toEqual(['5000', '']);

    await commitSettled('wariTransfer-netTax-1', 'abc');
    expect(container!.textContent).toContain(m.common_amount_invalid());
    expect(await storedNetTaxes()).toEqual(['5000', '']);

    await remount();
    await waitFor(() => container!.querySelector('input[name="wariTransfer-netTax-1"]') !== null);
    await waitFor(() => named('wariTransfer-netTax-0').value === '5000');
    expect(named('wariTransfer-netTax-1').value).toBe('0');
    expect(container!.textContent).not.toContain(m.common_amount_invalid());

    await commitSettled('wariSalesReturnTax78', '100');
    expect(await storedNetTaxes()).toEqual(['5000', '0']);
  });

  test('全角で入力した金額は半角に揃えて保存され、欄にも半角で表示され、再マウント後も同じ値が残る', async () => {
    await mountReports();
    await addRow(0, '2026-03-01', '５，０００');
    await waitFor(async () => (await storedTransfers())?.[0]?.netTax === '5000');
    expect(named('wariTransfer-netTax-0').value).toBe('5000');
    expect(container!.textContent).not.toContain(m.common_amount_invalid());
    expect(hasUnsavedChanges()).toBe(false);

    await remount();
    await waitFor(() => container!.querySelector('input[name="wariTransfer-netTax-0"]') !== null);
    await waitFor(() => named('wariTransfer-netTax-0').value === '5000');
    expect(named('wariTransfer-netTax-0').value).toBe('5000');
    await db.settings.toArray();
  });

  test('読めない金額は欄の下に入力の誤りを表示し、未保存の確認を残す', async () => {
    await mountReports();
    await addEmptyRow(0);
    await commitSettled('wariTransfer-date-0', '2026-03-01');
    await commitSettled('wariTransfer-netTax-0', '-5000');
    expect(await storedNetTaxes()).toEqual(['']);
    expect(container!.textContent).toContain(m.common_amount_invalid());
    expect(hasUnsavedChanges()).toBe(true);

    await commitSettled('wariTransfer-netTax-0', '5000');
    expect(await storedNetTaxes()).toEqual(['5000']);
    expect(container!.textContent).not.toContain(m.common_amount_invalid());
    expect(hasUnsavedChanges()).toBe(false);
  });

  test('全角で入力した返還等の税額は半角に揃えて保存される', async () => {
    await mountReports();
    commit('wariSalesReturnTax78', '５０００');
    await waitFor(
      async () => (await getSetting('wariBaseAdjustments'))?.[2026]?.salesReturnTax78 === '5000',
    );
    expect(named('wariSalesReturnTax78').value).toBe('5000');
    await db.settings.toArray();
  });

  function retypeWithoutChange(name: string): void {
    const el = named(name);
    el.dispatchEvent(new FocusEvent('focus'));
    const before = el.value;
    el.value = `${before}1`;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.value = before;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new FocusEvent('blur'));
    flushSync();
  }

  test('読めない返還等の税額は、入力し直して同じ文字列に戻しても未保存の確認が残り、読める値を保存すると消える', async () => {
    await mountReports();
    await commitSettled('wariSalesReturnTax78', '-5000');
    expect((await getSetting('wariBaseAdjustments'))?.[2026]).not.toHaveProperty(
      'salesReturnTax78',
    );
    expect(hasUnsavedChanges()).toBe(true);

    retypeWithoutChange('wariSalesReturnTax78');
    expect(named('wariSalesReturnTax78').value).toBe('-5000');
    expect(container!.textContent).toContain(m.common_amount_invalid());
    expect(hasUnsavedChanges()).toBe(true);

    await commitSettled('wariSalesReturnTax78', '5000');
    expect((await getSetting('wariBaseAdjustments'))?.[2026]?.salesReturnTax78).toBe('5000');
    expect(hasUnsavedChanges()).toBe(false);
  });

  test('読めない特定少額資産の税額は、入力し直して同じ文字列に戻しても未保存の確認が残り、読める値を保存すると消える', async () => {
    await mountReports();
    await addEmptyRow(0);
    await commitSettled('wariTransfer-date-0', '2026-03-01');
    await commitSettled('wariTransfer-netTax-0', '-5000');
    expect(await storedNetTaxes()).toEqual(['']);
    expect(hasUnsavedChanges()).toBe(true);

    retypeWithoutChange('wariTransfer-netTax-0');
    expect(named('wariTransfer-netTax-0').value).toBe('-5000');
    expect(container!.textContent).toContain(m.common_amount_invalid());
    expect(hasUnsavedChanges()).toBe(true);

    await commitSettled('wariTransfer-netTax-0', '5000');
    expect(await storedNetTaxes()).toEqual(['5000']);
    expect(hasUnsavedChanges()).toBe(false);
  });

  test.each([
    ['wariSalesReturnTax78', '5000円'],
    ['wariSalesReturnTax624', '-5000'],
  ] as const)(
    '%s：保存済みの値の上に読めない値を change しても上書きされず、読める値を保存すると未保存が解除される',
    async (name, invalid) => {
      const key = name === 'wariSalesReturnTax78' ? 'salesReturnTax78' : 'salesReturnTax624';
      await mountWithStored({ [key]: '5000' }, name, '5000');

      await commitSettled(name, invalid);
      expect((await getSetting('wariBaseAdjustments'))?.[2026]?.[key]).toBe('5000');
      expect(container!.textContent).toContain(m.common_amount_invalid());
      expect(hasUnsavedChanges()).toBe(true);

      await commitSettled(name, '6000');
      expect((await getSetting('wariBaseAdjustments'))?.[2026]?.[key]).toBe('6000');
      expect(container!.textContent).not.toContain(m.common_amount_invalid());
      expect(hasUnsavedChanges()).toBe(false);
    },
  );

  test('保存済みの行の金額を読めない値に変えても行は上書きされず、他の欄の読める変更は保存される', async () => {
    await mountWithStored(
      { specifiedSmallAssetTransfers: [{ date: '2026-03-01', rate: 0.1, netTax: '7000' }] },
      'wariTransfer-netTax-0',
      '7000',
    );

    await commitSettled('wariTransfer-netTax-0', 'abc');
    expect(await storedTransfers()).toEqual([{ date: '2026-03-01', rate: 0.1, netTax: '7000' }]);
    expect(container!.textContent).toContain(m.common_amount_invalid());
    expect(hasUnsavedChanges()).toBe(true);

    await commitSettled('wariSalesReturnTax78', '100');
    const stored = (await getSetting('wariBaseAdjustments'))?.[2026];
    expect(stored?.salesReturnTax78).toBe('100');
    expect(stored?.specifiedSmallAssetTransfers).toEqual([
      { date: '2026-03-01', rate: 0.1, netTax: '7000' },
    ]);
    expect(hasUnsavedChanges()).toBe(true);
  });

  test('読めない金額の行を消すと、保存済みの配列には他の行だけが残る', async () => {
    await mountWithStored(
      {
        specifiedSmallAssetTransfers: [
          { date: '2026-03-01', rate: 0.1, netTax: '7000' },
          { date: '2026-04-01', rate: 0.08, netTax: '8000' },
        ],
      },
      'wariTransfer-netTax-1',
      '8000',
    );

    await commitSettled('wariTransfer-netTax-1', 'abc');
    expect(await storedNetTaxes()).toEqual(['7000', '8000']);
    expect(hasUnsavedChanges()).toBe(true);

    await settled(() => {
      removeButtons()[1]!.click();
      flushSync();
    });
    expect(await storedTransfers()).toEqual([{ date: '2026-03-01', rate: 0.1, netTax: '7000' }]);
    expect(hasUnsavedChanges()).toBe(false);
  });
});
