import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { db } from '../db/db';
import { getSetting, setSetting } from '../lib/settings';
import { m } from '../paraglide/messages';

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
  await db.settings.put({
    key: 'homeOfficeAccountRatios',
    value: { [MOUNT_SENTINEL]: '0.30' },
    updatedAt: Date.now(),
  });
  container = document.createElement('div');
  document.body.appendChild(container);
  instance = mount(Settings, { target: container, props: {} });
  await waitFor(() => (container!.textContent ?? '').includes(MOUNT_SENTINEL));
}

function teardown(): void {
  if (instance !== undefined) {
    unmount(instance);
    instance = undefined;
  }
  if (container !== undefined) {
    container.remove();
    container = undefined;
  }
}

function input(name: string): HTMLInputElement | null {
  return container!.querySelector<HTMLInputElement>(`input[name="${name}"]`);
}

function field(name: string): HTMLInputElement {
  const el = input(name);
  if (el === null) {
    throw new Error(`${name} が見付からない`);
  }
  return el;
}

function kindSelect(): HTMLSelectElement {
  return container!.querySelector<HTMLSelectElement>('select[name="filerTaxPlaceKind"]')!;
}

function typeInto(name: string, value: string): void {
  const el = field(name);
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
}
// テスト環境は option の :checked を解決せず先頭の選択肢を返すため、選んだ option を返させる
function chooseKind(value: string): void {
  const el = kindSelect();
  const option = el.querySelector<HTMLOptionElement>(`option[value="${value}"]`)!;
  el.querySelector = ((q: string) =>
    q === ':checked'
      ? option
      : HTMLSelectElement.prototype.querySelector.call(el, q)) as typeof el.querySelector;
  el.dispatchEvent(new Event('change', { bubbles: true }));
  flushSync();
}

function saveButton(): HTMLButtonElement {
  return Array.from(field('etaxRiyoshaId').closest('form')!.querySelectorAll('button')).find(
    (b) => b.textContent?.trim() === m.settings_basic_save(),
  )!;
}

async function submitFiler(): Promise<void> {
  field('etaxRiyoshaId')
    .closest('form')!
    .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  flushSync();
  await waitFor(() => (container!.textContent ?? '').includes(m.settings_basic_saved()));
}

beforeEach(async () => {
  await db.delete();
  await db.open();
});

afterEach(async () => {
  teardown();
  await db.delete();
});

describe('申告者情報の納税地', () => {
  test('既定は住所地で、住所の欄は出ず、納税地の説明と事業所所在地の欄がある', async () => {
    await renderSettings();
    expect(kindSelect().value).toBe('domicile');
    expect(input('filerDomicileAddress')).toBeNull();
    expect(input('filerBusinessPlaceAddress')).not.toBeNull();
    expect(field('filerJusho').closest('label')!.textContent).toContain(
      m.settings_filer_address_hint(),
    );
  });

  test('納税地だけを保存していた利用者は住所地として開き、値はそのまま', async () => {
    await setSetting('userFilerAddress', '東京都千代田区1-1');
    await renderSettings();
    expect(kindSelect().value).toBe('domicile');
    expect(field('filerJusho').value).toBe('東京都千代田区1-1');
    expect(input('filerDomicileAddress')).toBeNull();
  });

  test.each(['abode', 'businessPlace'])(
    '区分に %s を選ぶと住所の欄が出て、空のあいだは必須の表示が出る',
    async (kind) => {
      await renderSettings();
      chooseKind(kind);
      const label = field('filerDomicileAddress').closest('label')!;
      expect(label.textContent).toContain(m.settings_filer_domicile_required());
      typeInto('filerDomicileAddress', '大阪府大阪市1-1');
      expect(label.textContent).not.toContain(m.settings_filer_domicile_required());
      chooseKind('domicile');
      expect(input('filerDomicileAddress')).toBeNull();
    },
  );

  test('区分・住所・事業所所在地は前後の空白を除いて保存され、開き直しても同じ', async () => {
    await renderSettings();
    typeInto('filerJusho', '  京都府京都市1-1  ');
    chooseKind('businessPlace');
    typeInto('filerDomicileAddress', ' 大阪府大阪市1-1 ');
    typeInto('filerBusinessPlaceAddress', ' 兵庫県神戸市1-1 ');
    await submitFiler();
    expect(await getSetting('userFilerAddress')).toBe('京都府京都市1-1');
    expect(await getSetting('userFilerTaxPlaceKind')).toBe('businessPlace');
    expect(await getSetting('userFilerDomicileAddress')).toBe('大阪府大阪市1-1');
    expect(await getSetting('userFilerBusinessPlaceAddress')).toBe('兵庫県神戸市1-1');
    teardown();
    await renderSettings();
    expect(field('filerJusho').value).toBe('京都府京都市1-1');
    expect(kindSelect().value).toBe('businessPlace');
    expect(field('filerDomicileAddress').value).toBe('大阪府大阪市1-1');
    expect(field('filerBusinessPlaceAddress').value).toBe('兵庫県神戸市1-1');
  });

  test('住所が空でも保存でき、保存した区分は住所地以外のまま残る', async () => {
    await renderSettings();
    chooseKind('abode');
    expect(saveButton().disabled).toBe(false);
    await submitFiler();
    expect(await getSetting('userFilerTaxPlaceKind')).toBe('abode');
    expect(await getSetting('userFilerDomicileAddress')).toBe('');
  });

  test('保存されている区分が三つの値以外だと誤りが出て、選び直すまで「保存」を押せない', async () => {
    await setSetting('userFilerTaxPlaceKind', 'residence' as never);
    await renderSettings();
    expect(kindSelect().closest('label')!.textContent).toContain(
      m.settings_filer_stored_unreadable(),
    );
    expect(saveButton().disabled).toBe(true);
    chooseKind('abode');
    expect(kindSelect().closest('label')!.textContent).not.toContain(
      m.settings_filer_stored_unreadable(),
    );
    expect(saveButton().disabled).toBe(false);
  });

  test('保存されている区分が読めないとき、住所地を選んでも誤りが消えて保存できる', async () => {
    await setSetting('userFilerTaxPlaceKind', 'residence' as never);
    await renderSettings();
    expect(kindSelect().value).toBe('');
    chooseKind('domicile');
    expect(kindSelect().closest('label')!.textContent).not.toContain(
      m.settings_filer_stored_unreadable(),
    );
    await submitFiler();
    expect(await getSetting('userFilerTaxPlaceKind')).toBe('domicile');
  });

  test('保存されている住所が文字列でないと、住所地でも欄が出て誤りを示す', async () => {
    await setSetting('userFilerDomicileAddress', {} as never);
    await renderSettings();
    expect(field('filerDomicileAddress').closest('label')!.textContent).toContain(
      m.settings_filer_stored_unreadable(),
    );
    expect(saveButton().disabled).toBe(true);
    typeInto('filerDomicileAddress', '大阪府大阪市1-1');
    expect(saveButton().disabled).toBe(false);
  });

  test('読めなかった住所は一文字入力しても欄が消えない', async () => {
    await setSetting('userFilerDomicileAddress', {} as never);
    await renderSettings();
    typeInto('filerDomicileAddress', '大');
    expect(input('filerDomicileAddress')).not.toBeNull();
    typeInto('filerDomicileAddress', '大阪府大阪市1-1');
    expect(field('filerDomicileAddress').value).toBe('大阪府大阪市1-1');
  });
});
