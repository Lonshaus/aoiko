// 消費税欄は change（フォーカスを外す）で初めて保存される。入力中に閉じると失われるため、
// 未確定の入力がある間は画面が未保存として登録されること、保存の中身は従来どおりであることを見る。
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { db } from '../db/db';
import { getSetting, setSetting } from '../lib/settings';
import { m } from '../paraglide/messages';
import { hasUnsavedChanges } from '../router.svelte';

const { default: Settings } = await import('./Settings.svelte');

async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 3000,
): Promise<void> {
  const start = Date.now();
  while (!(await predicate())) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('waitFor タイムアウト');
    }
    await new Promise((r) => setTimeout(r, 10));
  }
}

const MOUNT_SENTINEL = 'ZZZ9';

let container: HTMLElement | undefined;
let instance: Record<string, unknown> | undefined;

async function renderSettings(): Promise<void> {
  await setSetting('taxRegistration', 'taxable');
  await db.settings.put({
    key: 'homeOfficeAccountRatios',
    value: { [MOUNT_SENTINEL]: '0.30' },
    updatedAt: Date.now(),
  });
  container = document.createElement('div');
  document.body.appendChild(container);
  instance = mount(Settings, { target: container, props: {} });
  await waitFor(() => (container!.textContent ?? '').includes(MOUNT_SENTINEL));
  await waitFor(() => container!.querySelector('input[name="ctBasePeriodSales"]') !== null);
}

function field(name: string): HTMLInputElement {
  const el = container!.querySelector<HTMLInputElement>(`input[name="${name}"]`);
  if (el === null) {
    throw new Error(`${name} が見付からない`);
  }
  return el;
}

function focusOn(name: string): void {
  field(name).dispatchEvent(new FocusEvent('focus'));
}

function typeInto(name: string, value: string): void {
  const el = field(name);
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
}

function blur(name: string): void {
  field(name).dispatchEvent(new FocusEvent('blur'));
  flushSync();
}

function commit(name: string): void {
  field(name).dispatchEvent(new Event('change', { bubbles: true }));
  flushSync();
}

async function waitForSaved(): Promise<void> {
  await waitFor(() => (container!.textContent ?? '').includes(m.settings_consumption_tax_saved()));
}

async function expectNoSavedNotice(): Promise<void> {
  const shown = () => (container!.textContent ?? '').includes(m.settings_consumption_tax_saved());
  await expect(waitFor(shown, 600)).rejects.toThrow('waitFor タイムアウト');
}

function enter(name: string, value: string): void {
  focusOn(name);
  typeInto(name, value);
  commit(name);
}
// テスト環境の日付欄は途中までの入力を作れないため、ブラウザと同じく value 空・badInput の状態を作る
function enterIncompleteDate(name: string): void {
  const el = field(name);
  Object.defineProperty(el, 'validity', { configurable: true, get: () => ({ badInput: true }) });
  enter(name, '');
}

interface Case {
  name: string;
  typed: string;
  key: string;
  seed?: unknown;
  expected: unknown;
}

const CASES: Case[] = [
  {
    name: 'ctRegistrationStartDate',
    typed: '2025-04-01',
    key: 'invoiceRegistrationStartDate',
    expected: '2025-04-01',
  },
  {
    name: 'ctTaxableElectionFrom',
    typed: '2024',
    key: 'taxableElectionPeriod',
    expected: { fromYear: 2024 },
  },
  {
    name: 'ctTaxableElectionTo',
    typed: '2026',
    key: 'taxableElectionPeriod',
    seed: { fromYear: 2024 },
    expected: { fromYear: 2024, toYear: 2026 },
  },
  {
    name: 'ctInheritanceDate',
    typed: '2025-05-06',
    key: 'inheritanceSpecialDate',
    expected: '2025-05-06',
  },
  {
    name: 'ctAdjustedFixedAssetDate',
    typed: '2025-07-08',
    key: 'adjustedFixedAssetDate',
    expected: '2025-07-08',
  },
  {
    name: 'ctShortenedFrom',
    typed: '2025-01-01',
    key: 'shortenedTaxPeriod',
    expected: { from: '2025-01-01' },
  },
  {
    name: 'ctShortenedTo',
    typed: '2025-06-30',
    key: 'shortenedTaxPeriod',
    seed: { from: '2025-01-01' },
    expected: { from: '2025-01-01', to: '2025-06-30' },
  },
  {
    name: 'ctBasePeriodSales',
    typed: '6000000',
    key: 'basePeriodTaxableSales',
    seed: '5000000',
    expected: '6000000',
  },
  {
    name: 'ctSpecifiedPeriodSales',
    typed: '7000000',
    key: 'specifiedPeriodTaxableSales',
    expected: '7000000',
  },
  {
    name: 'ctSimplifiedElectionFiledDate',
    typed: '2025-09-10',
    key: 'simplifiedElectionFiledDate',
    expected: '2025-09-10',
  },
];

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

describe('消費税欄の未確定入力は未保存として登録される', () => {
  test.each(CASES)(
    '$name：input だけでは未保存・保存値は不変、change で解除され従来どおり保存される',
    async (c) => {
      if (c.seed !== undefined) {
        await setSetting(c.key as never, c.seed as never);
      }
      await renderSettings();
      const before = await getSetting(c.key as never);
      expect(hasUnsavedChanges()).toBe(false);

      focusOn(c.name);
      typeInto(c.name, c.typed);
      expect(hasUnsavedChanges()).toBe(true);
      expect(await getSetting(c.key as never)).toEqual(before);

      commit(c.name);
      expect(hasUnsavedChanges()).toBe(false);
      await waitForSaved();
      expect(await getSetting(c.key as never)).toEqual(c.expected);
    },
  );

  test('ctBasePeriodSales に「1200万」を入れて change しても保存済みの値は変わらず、保存済みとも表示しない', async () => {
    await setSetting('basePeriodTaxableSales', '5000000');
    await renderSettings();
    focusOn('ctBasePeriodSales');
    typeInto('ctBasePeriodSales', '1200万');
    expect(hasUnsavedChanges()).toBe(true);
    commit('ctBasePeriodSales');
    expect(container!.textContent).toContain(m.common_amount_invalid());
    await expectNoSavedNotice();
    expect(hasUnsavedChanges()).toBe(true);
    expect(await getSetting('basePeriodTaxableSales')).toBe('5000000');
  });

  test('入力後に元の値へ戻すと（blur なしで）未保存は解除され、再度変えると再登録される', async () => {
    await setSetting('basePeriodTaxableSales', '5000000');
    await renderSettings();
    const original = field('ctBasePeriodSales').value;
    focusOn('ctBasePeriodSales');
    typeInto('ctBasePeriodSales', '1');
    expect(hasUnsavedChanges()).toBe(true);
    typeInto('ctBasePeriodSales', original);
    expect(hasUnsavedChanges()).toBe(false);
    typeInto('ctBasePeriodSales', '2');
    expect(hasUnsavedChanges()).toBe(true);
  });

  test('未確定の入力があるとき blur だけでは未保存は解除されない', async () => {
    await renderSettings();
    focusOn('ctBasePeriodSales');
    typeInto('ctBasePeriodSales', '1');
    expect(hasUnsavedChanges()).toBe(true);
    field('ctBasePeriodSales').dispatchEvent(new FocusEvent('blur'));
    flushSync();
    expect(hasUnsavedChanges()).toBe(true);
  });

  test('未確定の入力を残したままアンマウントすると登録は残らない', async () => {
    await renderSettings();
    focusOn('ctBasePeriodSales');
    typeInto('ctBasePeriodSales', '9');
    expect(hasUnsavedChanges()).toBe(true);
    unmount(instance!);
    instance = undefined;
    expect(hasUnsavedChanges()).toBe(false);
  });
});

describe('消費税欄の読めない値は保存済みと表示しない', () => {
  test.each([
    ['ctBasePeriodSales', 'basePeriodTaxableSales', '５，０００'],
    ['ctBasePeriodSales', 'basePeriodTaxableSales', '　５０００　'],
    ['ctSpecifiedPeriodSales', 'specifiedPeriodTaxableSales', '５０００'],
  ])('%s（%s）に全角の %j を入れると半角で保存され、欄も半角になる', async (name, key, typed) => {
    await setSetting(key as never, '3000' as never);
    await renderSettings();
    enter(name, typed);
    await waitForSaved();
    expect(await getSetting(key as never)).toBe('5000');
    expect(field(name).value).toBe('5000');
    expect(container!.textContent).not.toContain(m.common_amount_invalid());
    expect(hasUnsavedChanges()).toBe(false);
  });

  test.each([
    ['ctBasePeriodSales', 'basePeriodTaxableSales', '５,０００円'],
    ['ctBasePeriodSales', 'basePeriodTaxableSales', '-5000'],
    ['ctSpecifiedPeriodSales', 'specifiedPeriodTaxableSales', '－5000'],
    ['ctSpecifiedPeriodSales', 'specifiedPeriodTaxableSales', '1e3'],
  ])(
    '%s（%s）の %j は保存せず、欄の下に誤りを出し、未保存のまま残し、直すと保存される',
    async (name, key, typed) => {
      await setSetting(key as never, '3000' as never);
      await renderSettings();
      enter(name, typed);
      expect(container!.textContent).toContain(m.common_amount_invalid());
      await expectNoSavedNotice();
      expect(hasUnsavedChanges()).toBe(true);
      expect(await getSetting(key as never)).toBe('3000');

      enter(name, '5000');
      await waitForSaved();
      expect(await getSetting(key as never)).toBe('5000');
      expect(container!.textContent).not.toContain(m.common_amount_invalid());
      expect(hasUnsavedChanges()).toBe(false);
    },
  );

  test('全角の年は半角で保存され、欄も半角になる', async () => {
    await renderSettings();
    enter('ctTaxableElectionFrom', '２０２５');
    await waitForSaved();
    expect(await getSetting('taxableElectionPeriod')).toEqual({ fromYear: 2025 });
    expect(field('ctTaxableElectionFrom').value).toBe('2025');
    enter('ctTaxableElectionTo', '２０２６');
    await waitFor(async () => (await getSetting('taxableElectionPeriod'))?.toYear === 2026);
    await waitForSaved();
    expect(await getSetting('taxableElectionPeriod')).toEqual({ fromYear: 2025, toYear: 2026 });
    expect(field('ctTaxableElectionTo').value).toBe('2026');
  });

  test.each([
    ['ctTaxableElectionFrom', '20x5'],
    ['ctTaxableElectionFrom', '205'],
    ['ctTaxableElectionFrom', '20256'],
    ['ctTaxableElectionTo', '20x5'],
    ['ctTaxableElectionTo', '205'],
    ['ctTaxableElectionTo', '20256'],
  ])('%s の %j は保存せず、もう片方の保存済みの年も消さない', async (name, typed) => {
    const seed = { fromYear: 2024, toYear: 2026 };
    await setSetting('taxableElectionPeriod', seed);
    await renderSettings();
    enter(name, typed);
    expect(container!.textContent).toContain(m.settings_ct_year_invalid());
    await expectNoSavedNotice();
    expect(hasUnsavedChanges()).toBe(true);
    expect(await getSetting('taxableElectionPeriod')).toEqual(seed);
  });

  test('開始年が空のまま終了年だけ入れても保存せず、開始年の入力を求め、終了年を消すと解除される', async () => {
    const seed = { fromYear: 2024, toYear: 2026 };
    await setSetting('taxableElectionPeriod', seed);
    await renderSettings();
    enter('ctTaxableElectionFrom', '');
    expect(container!.textContent).toContain(m.settings_ct_period_start_required());
    await expectNoSavedNotice();
    expect(hasUnsavedChanges()).toBe(true);
    expect(await getSetting('taxableElectionPeriod')).toEqual(seed);

    enter('ctTaxableElectionTo', '');
    await waitForSaved();
    expect(await getSetting('taxableElectionPeriod')).toBeUndefined();
    expect(container!.textContent).not.toContain(m.settings_ct_period_start_required());
    expect(hasUnsavedChanges()).toBe(false);
  });

  test.each([
    ['ctRegistrationStartDate', 'invoiceRegistrationStartDate'],
    ['ctInheritanceDate', 'inheritanceSpecialDate'],
    ['ctAdjustedFixedAssetDate', 'adjustedFixedAssetDate'],
    ['ctSimplifiedElectionFiledDate', 'simplifiedElectionFiledDate'],
  ])(
    '%s を途中まで消した日付は空欄として消さず、誤りを出し、直すと保存される',
    async (name, key) => {
      await setSetting(key as never, '2025-05-06' as never);
      await renderSettings();
      enterIncompleteDate(name);
      expect(container!.textContent).toContain(m.settings_ct_date_incomplete());
      await expectNoSavedNotice();
      expect(hasUnsavedChanges()).toBe(true);
      expect(await getSetting(key as never)).toBe('2025-05-06');

      delete (field(name) as { validity?: unknown }).validity;
      enter(name, '2025-06-07');
      await waitForSaved();
      expect(await getSetting(key as never)).toBe('2025-06-07');
      expect(container!.textContent).not.toContain(m.settings_ct_date_incomplete());
      expect(hasUnsavedChanges()).toBe(false);
    },
  );

  test.each(['ctShortenedFrom', 'ctShortenedTo'])(
    '課税期間の短縮の %s が途中までなら、期間を保存し直さない',
    async (name) => {
      const seed = { from: '2025-01-01', to: '2025-06-30' };
      await setSetting('shortenedTaxPeriod', seed);
      await renderSettings();
      enterIncompleteDate(name);
      expect(container!.textContent).toContain(m.settings_ct_date_incomplete());
      await expectNoSavedNotice();
      expect(hasUnsavedChanges()).toBe(true);
      expect(await getSetting('shortenedTaxPeriod')).toEqual(seed);
    },
  );

  test('途中までの日付を残したまま免税事業者へ切り替えて戻しても、保存済みの日付を消さない', async () => {
    await setSetting('inheritanceSpecialDate', '2025-05-06');
    await renderSettings();
    enterIncompleteDate('ctInheritanceDate');
    expect(container!.textContent).toContain(m.settings_ct_date_incomplete());
    const select = container!.querySelector<HTMLSelectElement>('select[name="taxRegistration"]')!;
    for (const next of ['tax-free', 'taxable']) {
      const option = select.querySelector<HTMLOptionElement>(`option[value="${next}"]`)!;
      // テスト環境は option の :checked を解決せず先頭の選択肢を返すため、選んだ option を返させる
      select.querySelector = ((q: string) =>
        q === ':checked'
          ? option
          : HTMLSelectElement.prototype.querySelector.call(
              select,
              q,
            )) as typeof select.querySelector;
      select.dispatchEvent(new Event('change', { bubbles: true }));
      flushSync();
      await waitFor(async () => (await getSetting('taxRegistration')) === next);
    }
    await waitFor(() => container!.querySelector('input[name="ctInheritanceDate"]') !== null);
    await expectNoSavedNotice();
    expect(await getSetting('inheritanceSpecialDate')).toBe('2025-05-06');
    expect(container!.textContent).toContain(m.settings_ct_date_incomplete());
    expect(hasUnsavedChanges()).toBe(true);
  });

  test.each([
    ['ctRegistrationStartDate', 'invoiceRegistrationStartDate', '2025-05-06'],
    ['ctInheritanceDate', 'inheritanceSpecialDate', '2025-05-06'],
    ['ctAdjustedFixedAssetDate', 'adjustedFixedAssetDate', '2025-05-06'],
    ['ctSimplifiedElectionFiledDate', 'simplifiedElectionFiledDate', '2025-05-06'],
    ['ctShortenedFrom', 'shortenedTaxPeriod', { from: '2025-01-01', to: '2025-06-30' }],
    ['ctShortenedTo', 'shortenedTaxPeriod', { from: '2025-01-01', to: '2025-06-30' }],
  ])(
    '%s を途中まで消したまま免税事業者へ切り替えて戻し、別の欄を保存しても、保存済みの日付を消さず誤りも残す',
    async (name, key, seed) => {
      await setSetting(key as never, seed as never);
      await renderSettings();
      enterIncompleteDate(name);
      const select = container!.querySelector<HTMLSelectElement>('select[name="taxRegistration"]')!;
      for (const next of ['tax-free', 'taxable']) {
        const option = select.querySelector<HTMLOptionElement>(`option[value="${next}"]`)!;
        // テスト環境は option の :checked を解決せず先頭の選択肢を返すため、選んだ option を返させる
        select.querySelector = ((q: string) =>
          q === ':checked'
            ? option
            : HTMLSelectElement.prototype.querySelector.call(
                select,
                q,
              )) as typeof select.querySelector;
        select.dispatchEvent(new Event('change', { bubbles: true }));
        flushSync();
        await waitFor(async () => (await getSetting('taxRegistration')) === next);
      }
      await waitFor(() => container!.querySelector(`input[name="${name}"]`) !== null);
      const checkbox = Array.from(container!.querySelectorAll('label'))
        .find((l) => (l.textContent ?? '').includes(m.settings_ct_interim_voluntary_filed()))!
        .querySelector<HTMLInputElement>('input[type="checkbox"]')!;
      checkbox.click();
      flushSync();
      await waitFor(async () => (await getSetting('interimVoluntaryFiled')) === true);
      await expectNoSavedNotice();
      expect(await getSetting(key as never)).toEqual(seed);
      expect(container!.textContent).toContain(m.settings_ct_date_incomplete());
      expect(hasUnsavedChanges()).toBe(true);
    },
  );

  test.each([
    ['ctRegistrationStartDate', 'invoiceRegistrationStartDate', '2025-05-06'],
    ['ctInheritanceDate', 'inheritanceSpecialDate', '2025-05-06'],
    ['ctAdjustedFixedAssetDate', 'adjustedFixedAssetDate', '2025-05-06'],
    ['ctSimplifiedElectionFiledDate', 'simplifiedElectionFiledDate', '2025-05-06'],
    ['ctShortenedFrom', 'shortenedTaxPeriod', { from: '2025-01-01', to: '2025-06-30' }],
    ['ctShortenedTo', 'shortenedTaxPeriod', { from: '2025-01-01', to: '2025-06-30' }],
  ])(
    '%s を途中まで消したまま免税事業者へ切り替えて戻し、描画し直した欄に触れてフォーカスを外すだけなら、保存済みの日付を消さず誤りも残す',
    async (name, key, seed) => {
      await setSetting(key as never, seed as never);
      await renderSettings();
      enterIncompleteDate(name);
      const select = container!.querySelector<HTMLSelectElement>('select[name="taxRegistration"]')!;
      for (const next of ['tax-free', 'taxable']) {
        const option = select.querySelector<HTMLOptionElement>(`option[value="${next}"]`)!;
        // テスト環境は option の :checked を解決せず先頭の選択肢を返すため、選んだ option を返させる
        select.querySelector = ((q: string) =>
          q === ':checked'
            ? option
            : HTMLSelectElement.prototype.querySelector.call(
                select,
                q,
              )) as typeof select.querySelector;
        select.dispatchEvent(new Event('change', { bubbles: true }));
        flushSync();
        await waitFor(async () => (await getSetting('taxRegistration')) === next);
      }
      await waitFor(() => container!.querySelector(`input[name="${name}"]`) !== null);
      expect(field(name).value).toBe('');
      focusOn(name);
      blur(name);
      const checkbox = Array.from(container!.querySelectorAll('label'))
        .find((l) => (l.textContent ?? '').includes(m.settings_ct_interim_voluntary_filed()))!
        .querySelector<HTMLInputElement>('input[type="checkbox"]')!;
      checkbox.click();
      flushSync();
      await waitFor(async () => (await getSetting('interimVoluntaryFiled')) === true);
      await expectNoSavedNotice();
      expect(await getSetting(key as never)).toEqual(seed);
      expect(container!.textContent).toContain(m.settings_ct_date_incomplete());
      expect(hasUnsavedChanges()).toBe(true);
    },
  );

  const DATE_CLEAR_CASES = [
    {
      name: 'ctRegistrationStartDate',
      key: 'invoiceRegistrationStartDate',
      seed: '2025-05-06',
      cleared: undefined,
      typed: '2025-06-07',
      saved: '2025-06-07',
    },
    {
      name: 'ctInheritanceDate',
      key: 'inheritanceSpecialDate',
      seed: '2025-05-06',
      cleared: undefined,
      typed: '2025-06-07',
      saved: '2025-06-07',
    },
    {
      name: 'ctAdjustedFixedAssetDate',
      key: 'adjustedFixedAssetDate',
      seed: '2025-05-06',
      cleared: undefined,
      typed: '2025-06-07',
      saved: '2025-06-07',
    },
    {
      name: 'ctSimplifiedElectionFiledDate',
      key: 'simplifiedElectionFiledDate',
      seed: '2025-05-06',
      cleared: undefined,
      typed: '2025-06-07',
      saved: '2025-06-07',
    },
    {
      name: 'ctShortenedFrom',
      key: 'shortenedTaxPeriod',
      seed: { from: '2025-01-01' },
      cleared: undefined,
      typed: '2025-02-01',
      saved: { from: '2025-02-01' },
    },
    {
      name: 'ctShortenedTo',
      key: 'shortenedTaxPeriod',
      seed: { from: '2025-01-01', to: '2025-05-06' },
      cleared: { from: '2025-01-01' },
      typed: '2025-06-07',
      saved: { from: '2025-01-01', to: '2025-06-07' },
    },
  ];

  test.each(DATE_CLEAR_CASES)(
    '$name を区画ごとに全部消すと（change は最初の区画だけ）、フォーカスを外した時に保存済みの日付が消え、誤りも消える',
    async (c) => {
      await setSetting(c.key as never, c.seed as never);
      await renderSettings();
      enterIncompleteDate(c.name);
      expect(container!.textContent).toContain(m.settings_ct_date_incomplete());
      await expectNoSavedNotice();
      expect(await getSetting(c.key as never)).toEqual(c.seed);
      // 残りの区画を消した後は value が空のまま badInput が false になり、イベントは出ない
      delete (field(c.name) as { validity?: unknown }).validity;
      expect(field(c.name).value).toBe('');
      expect(hasUnsavedChanges()).toBe(true);

      blur(c.name);
      await waitForSaved();
      expect(await getSetting(c.key as never)).toEqual(c.cleared);
      expect(container!.textContent).not.toContain(m.settings_ct_date_incomplete());
      expect(hasUnsavedChanges()).toBe(false);
    },
  );

  test.each(DATE_CLEAR_CASES)(
    '$name を途中まで消した後に change なしで日付を入れ直してフォーカスを外すと、入れた日付が保存される',
    async (c) => {
      await setSetting(c.key as never, c.seed as never);
      await renderSettings();
      enterIncompleteDate(c.name);
      delete (field(c.name) as { validity?: unknown }).validity;
      typeInto(c.name, c.typed);

      blur(c.name);
      await waitForSaved();
      expect(await getSetting(c.key as never)).toEqual(c.saved);
      expect(container!.textContent).not.toContain(m.settings_ct_date_incomplete());
      expect(hasUnsavedChanges()).toBe(false);
    },
  );

  test('途中までの日付が残っている間は、フォーカスを外しても保存済みの日付を消さず誤りも残す', async () => {
    await setSetting('inheritanceSpecialDate', '2025-05-06');
    await renderSettings();
    enterIncompleteDate('ctInheritanceDate');
    blur('ctInheritanceDate');
    await expectNoSavedNotice();
    expect(await getSetting('inheritanceSpecialDate')).toBe('2025-05-06');
    expect(container!.textContent).toContain(m.settings_ct_date_incomplete());
    expect(hasUnsavedChanges()).toBe(true);
  });

  test('課税期間の短縮で開始日を空にして終了日だけ残すと、保存せず開始日の入力を求める', async () => {
    const seed = { from: '2025-01-01', to: '2025-06-30' };
    await setSetting('shortenedTaxPeriod', seed);
    await renderSettings();
    enter('ctShortenedFrom', '');
    expect(container!.textContent).toContain(m.settings_ct_period_start_required());
    await expectNoSavedNotice();
    expect(hasUnsavedChanges()).toBe(true);
    expect(await getSetting('shortenedTaxPeriod')).toEqual(seed);
  });

  test('誤りを示した金額欄は、入力を打ち直してフォーカス時の文字列に戻っても未保存のまま残す', async () => {
    await setSetting('basePeriodTaxableSales', '3000');
    await renderSettings();
    enter('ctBasePeriodSales', '5000円');
    expect(container!.textContent).toContain(m.common_amount_invalid());
    await expectNoSavedNotice();
    expect(hasUnsavedChanges()).toBe(true);
    focusOn('ctBasePeriodSales');
    typeInto('ctBasePeriodSales', '5000円x');
    expect(hasUnsavedChanges()).toBe(true);
    typeInto('ctBasePeriodSales', '5000円');
    expect(hasUnsavedChanges()).toBe(true);
    expect(await getSetting('basePeriodTaxableSales')).toBe('3000');
  });

  test('読めない欄が残る間は、ほかの欄の保存でも保存済みと表示しない', async () => {
    await setSetting('basePeriodTaxableSales', '3000');
    await renderSettings();
    enter('ctBasePeriodSales', 'abc');
    expect(container!.textContent).toContain(m.common_amount_invalid());
    const checkbox = Array.from(container!.querySelectorAll('label'))
      .find((l) => (l.textContent ?? '').includes(m.settings_ct_domestic_pe()))!
      .querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    checkbox.click();
    flushSync();
    await waitFor(async () => (await getSetting('foreignWithoutDomesticPe')) === true);
    await expectNoSavedNotice();
    expect(container!.textContent).toContain(m.common_amount_invalid());
    expect(hasUnsavedChanges()).toBe(true);
    expect(await getSetting('basePeriodTaxableSales')).toBe('3000');
  });
});
