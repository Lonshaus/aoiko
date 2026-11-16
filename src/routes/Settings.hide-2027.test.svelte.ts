import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { mount, unmount } from 'svelte';
import { db } from '../db/db';
import { setSetting } from '../lib/settings';

const flag = vi.hoisted(() => ({ on: false }));
vi.mock('../lib/tax-reform-2027-ui', () => ({
  get TAX_REFORM_2027_UI() {
    return flag.on;
  },
}));

const { default: Settings } = await import('./Settings.svelte');

async function waitFor(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('waitFor タイムアウト');
    }
    await new Promise((r) => setTimeout(r, 10));
  }
}

const MOUNT_SENTINEL = 'ZZZ9';

let container: HTMLElement | undefined;
let instance: Record<string, unknown> | undefined;

async function renderSettings(method: 'general' | 'three-wari'): Promise<HTMLSelectElement> {
  await setSetting('taxRegistration', 'taxable');
  await setSetting('taxFilingMethod', method);
  await db.settings.put({
    key: 'homeOfficeAccountRatios',
    value: { [MOUNT_SENTINEL]: '0.30' },
    updatedAt: Date.now(),
  });
  container = document.createElement('div');
  document.body.appendChild(container);
  instance = mount(Settings, { target: container, props: {} });
  await waitFor(() => (container!.textContent ?? '').includes(MOUNT_SENTINEL));
  await waitFor(() => container!.querySelector('select[name="taxFilingMethod"]') !== null);
  await new Promise((r) => setTimeout(r, 100));
  return container.querySelector<HTMLSelectElement>('select[name="taxFilingMethod"]')!;
}

function optionValues(select: HTMLSelectElement): string[] {
  return Array.from(select.options).map((o) => o.value);
}

beforeEach(async () => {
  flag.on = false;
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

describe('3 割特例の選択肢は令和9年分以後の画面が出るまで隠す', () => {
  test('保存された値が general なら、three-wari の選択肢は出ない', async () => {
    const select = await renderSettings('general');
    expect(optionValues(select)).toEqual(['general', 'simplified', 'two-wari']);
  });

  test('保存された値が three-wari なら、選択肢が出て選ばれている', async () => {
    const select = await renderSettings('three-wari');
    expect(optionValues(select)).toContain('three-wari');
    expect(select.value).toBe('three-wari');
  });

  test('定数が true なら、保存された値が general でも出る', async () => {
    flag.on = true;
    const select = await renderSettings('general');
    expect(optionValues(select)).toContain('three-wari');
  });
});
