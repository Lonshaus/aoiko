// 小数のある金額欄とルール優先度の検査。ブラウザの検査（step・min）には頼らず、画面側で案内して保存しない。

import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { db } from '../db/db';
import { m } from '../paraglide/messages';

const { default: Settings } = await import('./Settings.svelte');

async function waitFor(predicate: () => boolean, timeoutMs = 4000): Promise<void> {
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

function text(): string {
  return container?.textContent ?? '';
}

function field(name: string): HTMLInputElement {
  return container!.querySelector<HTMLInputElement>(`[name="${name}"]`) as HTMLInputElement;
}

function type(name: string, value: string): void {
  const el = field(name);
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
}

function submit(name: string): void {
  field(name)
    .closest('form')!
    .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
}

beforeEach(async () => {
  await db.delete();
  await db.open();
  await db.settings.put({
    key: 'homeOfficeAccountRatios',
    value: { [MOUNT_SENTINEL]: '0.30' },
    updatedAt: Date.now(),
  });
  container = document.createElement('div');
  document.body.appendChild(container);
  instance = mount(Settings, { target: container, props: {} });
  await waitFor(() => text().includes(MOUNT_SENTINEL));
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

function fillAsset(): void {
  type('assetTitle', '作業用パソコン');
  type('assetAcquisitionDate', '2026-04-01');
  type('assetUsefulLife', '4');
}

describe('固定資産の追加：金額欄の小数', () => {
  test.each(['assetAcquisitionCost', 'assetResidualGuarantee'])(
    '%s に 1000.5 を入れると欄の下に案内を出し、資産を追加しない',
    async (name) => {
      fillAsset();
      type('assetAcquisitionCost', '300000');
      type(name, '1000.5');
      expect(text()).toContain(m.common_amount_invalid());
      submit('assetTitle');
      await new Promise((r) => setTimeout(r, 50));
      expect(await db.fixedAssets.count()).toBe(0);
    },
  );

  test.each(['1000.0', '1000'])('取得価額 %j は小数の誤りにならない', (value) => {
    fillAsset();
    type('assetAcquisitionCost', value);
    expect(text()).not.toContain(m.common_amount_invalid());
  });
});

describe('仕訳ルールの追加', () => {
  test('入力欄の検査はブラウザではなく画面側で行う', () => {
    expect(field('rulePattern').closest('form')!.noValidate).toBe(true);
  });

  test.each(['1.5', '-1', ''])('優先度 %j は案内を出し、ルールを登録しない', async (bad) => {
    type('rulePattern', 'コンビニ');
    type('ruleAccount', '5150');
    type('rulePriority', bad);
    submit('rulePattern');
    await waitFor(() => text().includes(m.settings_rule_priority_invalid()));
    expect(await db.parserRules.count()).toBe(0);
  });

  test('パターンが空なら必須の案内を出す', async () => {
    type('rulePattern', '');
    type('ruleAccount', '5150');
    submit('rulePattern');
    await waitFor(() => text().includes(m.settings_rule_error_required()));
    expect(await db.parserRules.count()).toBe(0);
  });

  test('科目が未選択でも必須の案内を出す', async () => {
    type('rulePattern', 'コンビニ');
    submit('rulePattern');
    await waitFor(() => text().includes(m.settings_rule_error_required()));
    expect(await db.parserRules.count()).toBe(0);
  });
});
