import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { db } from '../db/db';
import { getSetting } from '../lib/settings';
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

function field(name: string): HTMLInputElement {
  const el = container!.querySelector<HTMLInputElement>(`input[name="${name}"]`);
  if (el === null) {
    throw new Error(`${name} が見付からない`);
  }
  return el;
}

function typeInto(name: string, value: string): void {
  const el = field(name);
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
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

describe('申告者情報の番号欄', () => {
  test('全角の利用者識別番号は前後の空白を除いた半角で保存される', async () => {
    await renderSettings();
    typeInto('etaxRiyoshaId', '　１２３４５６７８９０１２３４５６　');
    await submitFiler();
    expect(await getSetting('userRiyoshaId')).toBe('1234567890123456');
  });

  test.each([
    ['１２３－４５６７', '1234567'],
    ['〒１２３ー４５６７', '1234567'],
    ['123-4567', '1234567'],
  ])('郵便番号 %j は数字だけの %s で保存される', async (typed, expected) => {
    await renderSettings();
    typeInto('filerYubinBango', typed);
    await submitFiler();
    expect(await getSetting('userFilerZip')).toBe(expected);
  });
});

describe('申告者情報の番号欄の検査', () => {
  test.each(['123456789012345', '123456789012345a', '12345678901234567'])(
    '利用者識別番号 %j は保存されず、欄の下に誤りが出る',
    async (typed) => {
      await renderSettings();
      typeInto('etaxRiyoshaId', typed);
      expect(container!.textContent).toContain(m.settings_filer_riyosha_id_invalid());
      field('etaxRiyoshaId')
        .closest('form')!
        .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      flushSync();
      await new Promise((r) => setTimeout(r, 50));
      expect(await getSetting('userRiyoshaId')).toBeUndefined();
      expect(container!.textContent).not.toContain(m.settings_basic_saved());
    },
  );

  test('郵便番号 123 は保存されず、欄の下に誤りが出る', async () => {
    await renderSettings();
    typeInto('filerYubinBango', '123');
    expect(container!.textContent).toContain(m.settings_filer_zip_invalid());
    field('filerYubinBango')
      .closest('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    flushSync();
    await new Promise((r) => setTimeout(r, 50));
    expect(await getSetting('userFilerZip')).toBeUndefined();
  });

  test('空欄は保存できる（任意項目）', async () => {
    await renderSettings();
    typeInto('etaxRiyoshaId', '');
    typeInto('filerYubinBango', '');
    await submitFiler();
    expect(await getSetting('userRiyoshaId')).toBe('');
  });
});
