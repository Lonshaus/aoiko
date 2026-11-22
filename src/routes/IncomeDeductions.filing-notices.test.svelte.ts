import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { db } from '../db/db';
import { setSetting } from '../lib/settings';
import { ledger } from '../stores/ledger.svelte';
import { m } from '../paraglide/messages';
import type { PersonalDeductionInput } from '../db/types';

const { default: IncomeDeductions } = await import('./IncomeDeductions.svelte');

async function waitFor(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('waitFor タイムアウト');
    }
    await new Promise((r) => setTimeout(r, 10));
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let container: HTMLElement | undefined;
let instance: Record<string, unknown> | undefined;

function button(el: HTMLElement, label: string): HTMLButtonElement {
  return Array.from(el.querySelectorAll('button')).find((b) => b.textContent?.trim() === label)!;
}

const saveButton = (el: HTMLElement) => button(el, m.income_deductions_save());

async function switchYear(el: HTMLElement, year: number): Promise<void> {
  const yearInput = el.querySelector<HTMLInputElement>('input[name="deductionNen"]')!;
  yearInput.value = String(year);
  yearInput.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
  await sleep(100);
  await waitFor(() => !saveButton(el).disabled);
}

async function render(year = 2026): Promise<HTMLElement> {
  container = document.createElement('div');
  document.body.appendChild(container);
  instance = mount(IncomeDeductions, { target: container, props: {} });
  const el = container;
  await waitFor(() => el.querySelector('input[name="deductionNen"]') !== null);
  await switchYear(el, year);
  return el;
}

async function remount(year = 2026): Promise<HTMLElement> {
  unmount(instance!);
  instance = undefined;
  container?.remove();
  container = undefined;
  return render(year);
}

async function setRealEstateEnabled(enabled: boolean): Promise<void> {
  await setSetting('realEstateIncomeEnabled', enabled);
  await waitFor(() => ledger.realEstateIncomeEnabled === enabled);
}

function field(el: HTMLElement, name: string): HTMLInputElement | HTMLSelectElement {
  return el.querySelector<HTMLInputElement | HTMLSelectElement>(`[name="${name}"]`)!;
}

function fill(el: HTMLElement, name: string, value: string): void {
  const input = field(el, name);
  if (input instanceof input.ownerDocument.defaultView!.HTMLSelectElement) {
    const original = input.querySelector.bind(input);
    // happy-dom は option を :checked で選べないため、選択中の option を返して Svelte の change 処理に渡す
    input.querySelector = ((selector: string) =>
      selector === ':checked'
        ? (input.selectedOptions[0] ?? null)
        : original(selector)) as typeof input.querySelector;
    for (const option of Array.from(input.options)) {
      option.selected = option.value === value;
    }
    input.dispatchEvent(new Event('change', { bubbles: true }));
  } else {
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }
  flushSync();
}

function check(el: HTMLElement, name: string): void {
  (field(el, name) as HTMLInputElement).click();
  flushSync();
}

function addApp(el: HTMLElement, key: 'business' | 'realEstate'): void {
  const part = el.querySelector(`[data-filing-notices-part="${key}"]`)!;
  const add = Array.from(part.querySelectorAll('button')).find(
    (b) => b.textContent?.trim() === m.income_deductions_dependent_add(),
  )!;
  add.click();
  flushSync();
}

async function save(el: HTMLElement): Promise<void> {
  await waitFor(() => !saveButton(el).disabled);
  saveButton(el).click();
  await waitFor(() => (el.textContent ?? '').includes(m.income_deductions_saved()));
}

async function expectSaveBlocked(el: HTMLElement): Promise<void> {
  await waitFor(() => saveButton(el).disabled);
  saveButton(el).click();
  await sleep(50);
  expect(el.textContent).not.toContain(m.income_deductions_saved());
}

const section = (el: HTMLElement) => el.querySelector('[data-section="filing-notices"]');

function base(
  year: number,
  overrides: Partial<PersonalDeductionInput> = {},
): PersonalDeductionInput {
  return {
    year,
    socialInsurancePaid: '0',
    smallBusinessMutualAidPaid: '0',
    lifeInsurance: {},
    earthquakeInsurancePaid: '0',
    oldLongTermInsurancePaid: '0',
    medicalExpensePaid: '0',
    medicalInsuranceReimbursement: '0',
    donationAmount: '0',
    casualtyLossDeduction: '0',
    isDisabled: false,
    isSpecialDisabled: false,
    isSingleParent: false,
    isWidow: false,
    isWorkingStudent: false,
    dependents: [],
    updatedAt: 1,
    ...overrides,
  };
}

beforeEach(async () => {
  await db.delete();
  await db.open();
  await setRealEstateEnabled(false);
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

describe('届出事項の段落の表示', () => {
  test('2026 年分では案内の文を表示し、「必要はありません」「書き込まれます」は含まない', async () => {
    const el = await render(2026);
    const text = section(el)?.textContent ?? '';
    expect(text).toContain(m.income_filing_notices_intro());
    expect(text).toContain(m.income_filing_notices_not_in_xtx());
    expect(text).not.toContain('必要はありません');
    expect(text).not.toContain('書き込まれます');
  });

  test('2025 年分には段落が無く、保存しても届出事項を書かない（記録に残っていても消える）', async () => {
    await db.personalDeductions.put(
      base(2025, {
        filingNotices: { business: { closureDate: '2025-05-01', methodApplications: [] } },
      }),
    );
    const el = await render(2025);
    expect(section(el)).toBeNull();
    expect(el.textContent).not.toContain(m.income_filing_notices_title());
    await save(el);
    expect(await db.personalDeductions.get(2025)).not.toHaveProperty('filingNotices');
    await switchYear(el, 2026);
    expect(section(el)).not.toBeNull();
  });

  test('不動産用の欄は不動産所得を使う設定のときだけ表示する', async () => {
    const el = await render(2026);
    expect(el.querySelector('[data-filing-notices-part="business"]')).not.toBeNull();
    expect(el.querySelector('[data-filing-notices-part="realEstate"]')).toBeNull();
    await setRealEstateEnabled(true);
    await waitFor(() => el.querySelector('[data-filing-notices-part="realEstate"]') !== null);
  });
});

describe('届出事項の保存・再読込', () => {
  test('評価方法・償却方法を複数追加・削除して保存し、再読込しても同じ', async () => {
    const el = await render(2026);
    addApp(el, 'business');
    addApp(el, 'business');
    addApp(el, 'business');
    fill(el, 'filingNotice-business-app-0-kind', 'change');
    fill(el, 'filingNotice-business-app-0-assetType', 'depreciable');
    fill(el, 'filingNotice-business-app-0-businessOrAssetType', '製造業');
    fill(el, 'filingNotice-business-app-0-assetClass', '備品');
    fill(el, 'filingNotice-business-app-0-newMethod', '定額法');
    fill(el, 'filingNotice-business-app-0-currentMethod', '定率法');
    fill(el, 'filingNotice-business-app-0-currentAdoptedYear', '2020');
    fill(el, 'filingNotice-business-app-0-memo', '令和8年分から');
    fill(el, 'filingNotice-business-app-1-newMethod', '削除する行');
    fill(el, 'filingNotice-business-app-2-assetType', 'crypto');
    fill(el, 'filingNotice-business-app-2-newMethod', '移動平均法');
    const part = el.querySelector('[data-filing-notices-part="business"]')!;
    const removeButtons = Array.from(part.querySelectorAll('button')).filter(
      (b) => b.textContent?.trim() === m.income_deductions_dependent_remove(),
    );
    expect(removeButtons).toHaveLength(3);
    removeButtons[1]!.click();
    flushSync();
    await save(el);

    expect((await db.personalDeductions.get(2026))?.filingNotices).toEqual({
      business: {
        methodApplications: [
          {
            kind: 'change',
            assetType: 'depreciable',
            businessOrAssetType: '製造業',
            assetClass: '備品',
            newMethod: '定額法',
            currentMethod: '定率法',
            currentAdoptedYear: 2020,
            memo: '令和8年分から',
          },
          {
            kind: 'notice',
            assetType: 'crypto',
            businessOrAssetType: '',
            assetClass: '',
            newMethod: '移動平均法',
          },
        ],
      },
    });

    const reloaded = await remount(2026);
    expect(field(reloaded, 'filingNotice-business-app-0-kind').value).toBe('change');
    expect(field(reloaded, 'filingNotice-business-app-0-newMethod').value).toBe('定額法');
    expect(field(reloaded, 'filingNotice-business-app-0-currentAdoptedYear').value).toBe('2020');
    expect(field(reloaded, 'filingNotice-business-app-1-assetType').value).toBe('crypto');
    expect(field(reloaded, 'filingNotice-business-app-1-newMethod').value).toBe('移動平均法');
    expect(reloaded.querySelector('[name="filingNotice-business-app-2-kind"]')).toBeNull();
  });

  test('何も入力しなければ filingNotices を書かない', async () => {
    const el = await render(2026);
    await save(el);
    expect(await db.personalDeductions.get(2026)).not.toHaveProperty('filingNotices');
  });

  test('事業用だけのときは realEstate を書かない', async () => {
    const el = await render(2026);
    addApp(el, 'business');
    fill(el, 'filingNotice-business-app-0-newMethod', '先入先出法');
    await save(el);
    const stored = (await db.personalDeductions.get(2026))?.filingNotices;
    expect(stored).toBeDefined();
    expect(stored).not.toHaveProperty('realEstate');
    expect(stored).not.toHaveProperty('blueReturnWithdrawalYear');
  });

  test('廃業と取りやめを不動産用とあわせて保存し、再読込しても同じ（取りやめは人単位で 1 つ）', async () => {
    await setRealEstateEnabled(true);
    const el = await render(2026);
    check(el, 'filingNoticeWithdrawalChecked');
    fill(el, 'filingNoticeWithdrawalYear', '2027');
    check(el, 'filingNotice-business-closureChecked');
    fill(el, 'filingNotice-business-closureDate', '2026-06-30');
    check(el, 'filingNotice-realEstate-closureChecked');
    fill(el, 'filingNotice-realEstate-closureDate', '2026-09-30');
    await save(el);

    const stored = (await db.personalDeductions.get(2026))?.filingNotices;
    expect(stored).toEqual({
      blueReturnWithdrawalYear: 2027,
      business: { closureDate: '2026-06-30', methodApplications: [] },
      realEstate: { closureDate: '2026-09-30', methodApplications: [] },
    });
    expect(stored?.business).not.toHaveProperty('blueReturnWithdrawalYear');
    expect(stored?.realEstate).not.toHaveProperty('blueReturnWithdrawalYear');
    expect(el.querySelectorAll('[name="filingNoticeWithdrawalYear"]')).toHaveLength(1);

    const reloaded = await remount(2026);
    expect(field(reloaded, 'filingNoticeWithdrawalYear').value).toBe('2027');
    expect(field(reloaded, 'filingNotice-business-closureDate').value).toBe('2026-06-30');
    expect(field(reloaded, 'filingNotice-realEstate-closureDate').value).toBe('2026-09-30');
  });

  test('不動産用の届出を入力したあと不動産所得の設定を切って保存すると、不動産用は書かない', async () => {
    await setRealEstateEnabled(true);
    const el = await render(2026);
    check(el, 'filingNotice-business-closureChecked');
    fill(el, 'filingNotice-business-closureDate', '2026-06-30');
    check(el, 'filingNotice-realEstate-closureChecked');
    fill(el, 'filingNotice-realEstate-closureDate', '2026-09-30');
    await setRealEstateEnabled(false);
    await waitFor(() => el.querySelector('[data-filing-notices-part="realEstate"]') === null);
    await save(el);
    expect((await db.personalDeductions.get(2026))?.filingNotices).toEqual({
      business: { closureDate: '2026-06-30', methodApplications: [] },
    });
  });
});

describe('年分を切り替えたときの届出欄', () => {
  test('届出を保存した年分から、記録の無い年分・届出の無い記録の年分へ移ると欄が空になり、保存しても書かない', async () => {
    await db.personalDeductions.put(base(2028));
    await setRealEstateEnabled(true);
    const el = await render(2026);
    check(el, 'filingNotice-realEstate-closureChecked');
    fill(el, 'filingNotice-realEstate-closureDate', '2026-09-30');
    check(el, 'filingNoticeWithdrawalChecked');
    check(el, 'filingNotice-business-closureChecked');
    fill(el, 'filingNotice-business-closureDate', '2026-06-30');
    addApp(el, 'business');
    fill(el, 'filingNotice-business-app-0-newMethod', '定額法');
    await save(el);
    expect((await db.personalDeductions.get(2026))?.filingNotices).toBeDefined();

    for (const year of [2027, 2028]) {
      await switchYear(el, year);
      expect((field(el, 'filingNoticeWithdrawalChecked') as HTMLInputElement).checked).toBe(false);
      expect(el.querySelector('[name="filingNoticeWithdrawalYear"]')).toBeNull();
      expect((field(el, 'filingNotice-business-closureChecked') as HTMLInputElement).checked).toBe(
        false,
      );
      expect(el.querySelector('[name="filingNotice-business-app-0-newMethod"]')).toBeNull();
      expect(
        (field(el, 'filingNotice-realEstate-closureChecked') as HTMLInputElement).checked,
      ).toBe(false);
      await save(el);
      expect(await db.personalDeductions.get(year)).not.toHaveProperty('filingNotices');
      await switchYear(el, 2026);
      expect((field(el, 'filingNoticeWithdrawalChecked') as HTMLInputElement).checked).toBe(true);
    }
  });
});

describe('廃業日', () => {
  test('設定の廃業日が本年分なら既定で入り、異なる日付に直すと提示を出す（保存は止めない）', async () => {
    await setSetting('businessCloseDate', '2026-03-31');
    const el = await render(2026);
    check(el, 'filingNotice-business-closureChecked');
    expect(field(el, 'filingNotice-business-closureDate').value).toBe('2026-03-31');
    const differs = m.income_filing_notices_closure_differs({ date: '2026-03-31' });
    expect(el.textContent).not.toContain(differs);

    fill(el, 'filingNotice-business-closureDate', '2026-04-30');
    expect(el.textContent).toContain(differs);
    await save(el);
    expect((await db.personalDeductions.get(2026))?.filingNotices?.business?.closureDate).toBe(
      '2026-04-30',
    );
  });

  test('設定の廃業日が本年分でないときは既定で入れない', async () => {
    await setSetting('businessCloseDate', '2025-03-31');
    const el = await render(2026);
    check(el, 'filingNotice-business-closureChecked');
    expect(field(el, 'filingNotice-business-closureDate').value).toBe('');
  });

  test('不動産用は設定の廃業日を既定で入れない', async () => {
    await setSetting('businessCloseDate', '2026-03-31');
    await setRealEstateEnabled(true);
    const el = await render(2026);
    check(el, 'filingNotice-realEstate-closureChecked');
    expect(field(el, 'filingNotice-realEstate-closureDate').value).toBe('');
  });

  test.each([
    ['2025-12-31', false],
    ['2027-01-01', false],
    ['', false],
    ['2026-06-30', true],
  ])('2026 年分に廃業日 %j を入れたとき保存できるか: %s', async (date, ok) => {
    const el = await render(2026);
    check(el, 'filingNotice-business-closureChecked');
    fill(el, 'filingNotice-business-closureDate', date);
    if (ok) {
      await save(el);
      expect((await db.personalDeductions.get(2026))?.filingNotices?.business?.closureDate).toBe(
        date,
      );
    } else {
      expect(el.textContent).toContain(
        m.income_filing_notices_closure_date_invalid({ year: 2026 }),
      );
      await expectSaveBlocked(el);
      expect(await db.personalDeductions.get(2026)).toBeUndefined();
    }
  });
});

describe('青色申告の取りやめ', () => {
  test('白色申告では本年分を既定にし、本年分は保存できる', async () => {
    await setSetting('filingType', 'white');
    const el = await render(2026);
    check(el, 'filingNoticeWithdrawalChecked');
    expect(field(el, 'filingNoticeWithdrawalYear').value).toBe('2026');
    await save(el);
    expect((await db.personalDeductions.get(2026))?.filingNotices).toEqual({
      blueReturnWithdrawalYear: 2026,
    });
  });

  test.each(['2025', '2027'])('白色申告で %s を入れると保存できない', async (value) => {
    await setSetting('filingType', 'white');
    const el = await render(2026);
    check(el, 'filingNoticeWithdrawalChecked');
    fill(el, 'filingNoticeWithdrawalYear', value);
    expect(el.textContent).toContain(m.income_filing_notices_withdrawal_year_white({ year: 2026 }));
    await expectSaveBlocked(el);
    expect(await db.personalDeductions.get(2026)).toBeUndefined();
  });

  test('青色申告では翌年分を既定にし、そのまま保存できる', async () => {
    await setSetting('filingType', 'blue');
    const el = await render(2026);
    check(el, 'filingNoticeWithdrawalChecked');
    expect(field(el, 'filingNoticeWithdrawalYear').value).toBe('2027');
    await save(el);
    expect((await db.personalDeductions.get(2026))?.filingNotices?.blueReturnWithdrawalYear).toBe(
      2027,
    );
  });

  test.each(['2026', '2118', '', '2027.5'])(
    '青色申告で %j を入れると保存できない',
    async (value) => {
      const el = await render(2026);
      check(el, 'filingNoticeWithdrawalChecked');
      fill(el, 'filingNoticeWithdrawalYear', value);
      expect(el.textContent).toContain(
        m.income_filing_notices_withdrawal_year_blue({ min: 2027, max: 2117 }),
      );
      await expectSaveBlocked(el);
      expect(await db.personalDeductions.get(2026)).toBeUndefined();
    },
  );

  test('青色申告で 2117 は保存できる', async () => {
    const el = await render(2026);
    check(el, 'filingNoticeWithdrawalChecked');
    fill(el, 'filingNoticeWithdrawalYear', '2117');
    await save(el);
    expect((await db.personalDeductions.get(2026))?.filingNotices?.blueReturnWithdrawalYear).toBe(
      2117,
    );
  });
});

describe('評価方法・償却方法の入力検査', () => {
  test.each([
    ['1925', false],
    ['2027', false],
    ['1926', true],
    ['2026', true],
  ])('採用した年 %s を入れたとき保存できるか: %s', async (value, ok) => {
    const el = await render(2026);
    addApp(el, 'business');
    fill(el, 'filingNotice-business-app-0-currentAdoptedYear', value);
    if (ok) {
      await save(el);
      expect(
        (await db.personalDeductions.get(2026))?.filingNotices?.business?.methodApplications[0]
          ?.currentAdoptedYear,
      ).toBe(Number(value));
    } else {
      await expectSaveBlocked(el);
      expect(await db.personalDeductions.get(2026)).toBeUndefined();
    }
  });

  test.each([
    ['businessOrAssetType', 20],
    ['assetClass', 40],
    ['newMethod', 20],
    ['currentMethod', 20],
    ['memo', 40],
  ])('%s は %i 文字までで、超えると保存できない', async (key, max) => {
    const el = await render(2026);
    addApp(el, 'business');
    const name = `filingNotice-business-app-0-${key}`;
    fill(el, name, 'あ'.repeat(max));
    await save(el);
    expect(el.textContent).not.toContain(m.income_filing_notices_text_too_long({ max }));

    fill(el, name, 'あ'.repeat(max + 1));
    expect(el.textContent).toContain(m.income_filing_notices_text_too_long({ max }));
    await waitFor(() => saveButton(el).disabled);
    expect(saveButton(el).disabled).toBe(true);
  });
});

describe('保存済みの記録が壊れているとき', () => {
  test('事業用が文字列の記録でも例外にならず、空の入力と読めない欄の案内を表示する', async () => {
    await db.personalDeductions.put(
      base(2026, {
        filingNotices: { business: 'x' },
      } as unknown as Partial<PersonalDeductionInput>),
    );
    const el = await render(2026);
    expect((field(el, 'filingNotice-business-closureChecked') as HTMLInputElement).checked).toBe(
      false,
    );
    expect(el.querySelector('[name="filingNotice-business-app-0-kind"]')).toBeNull();
    const alert = el.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain(
      m.income_deductions_stored_invalid({ fields: m.income_filing_notices_title() }),
    );
  });
});

describe('フォーム部品の name', () => {
  test('届出事項の欄の input・select は name が空でなく、画面内で重複しない', async () => {
    await setRealEstateEnabled(true);
    const el = await render(2026);
    check(el, 'filingNoticeWithdrawalChecked');
    for (const key of ['business', 'realEstate'] as const) {
      check(el, `filingNotice-${key}-closureChecked`);
      addApp(el, key);
      addApp(el, key);
    }
    const controls = Array.from(
      section(el)!.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input, select'),
    );
    expect(controls.length).toBeGreaterThan(30);
    expect(controls.every((c) => c.name !== '')).toBe(true);
    const counts = new Map<string, number>();
    for (const c of el.querySelectorAll<HTMLInputElement>('input, select, textarea')) {
      if (c.name !== '' && c.type !== 'radio') {
        counts.set(c.name, (counts.get(c.name) ?? 0) + 1);
      }
    }
    expect(controls.filter((c) => counts.get(c.name) !== 1).map((c) => c.name)).toEqual([]);
  });
});
