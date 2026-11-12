import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import Dexie from 'dexie';
import { db } from '../db/db';
import { dataCheck } from '../stores/data-check.svelte';
import { takeSettingsTarget } from '../lib/settings-target';
import { m } from '../paraglide/messages';

const { default: DataCheckNotice } = await import('./DataCheckNotice.svelte');

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

let target: HTMLElement | null = null;
let component: Record<string, unknown> | null = null;

function text(): string {
  return target?.textContent ?? '';
}

function button(label: string): HTMLElement {
  const el = [...(target?.querySelectorAll<HTMLElement>('a, button') ?? [])].find(
    (e) => e.textContent?.trim() === label,
  );
  if (el === undefined) {
    throw new Error(`見つからない: ${label}`);
  }
  return el;
}
// シングルトンの状態は前のテストの結果を持ち越すので、毎回データを変えてから点検し直す。
async function render(): Promise<void> {
  target = document.createElement('div');
  document.body.appendChild(target);
  component = mount(DataCheckNotice, { target });
  await dataCheck.rerun();
  flushSync();
}

async function rerun(): Promise<void> {
  await dataCheck.rerun();
  flushSync();
}

beforeEach(async () => {
  sessionStorage.clear();
  await db.delete();
  await db.open();
});

afterEach(async () => {
  if (component !== null) {
    unmount(component);
    component = null;
  }
  target?.remove();
  target = null;
  await db.delete();
});

describe('DataCheckNotice', () => {
  test('問題が無ければ出さない', async () => {
    await render();
    await new Promise((r) => setTimeout(r, 50));
    flushSync();
    expect(dataCheck.status).toBe('done');
    expect(text()).toBe('');
  });

  test('問題があれば件数を出す', async () => {
    await db.table('vendors').bulkPut([
      { id: 'v1', name: null },
      { id: 'v2', name: null },
    ]);
    await render();
    await waitFor(() => text().includes(m.data_check_notice({ count: 2 })));
  });

  test('確認したら隠し、指紋を保存する。問題が変われば再び出す', async () => {
    await db.table('vendors').put({ id: 'v1', name: null });
    await render();
    await waitFor(() => text().includes(m.data_check_notice({ count: 1 })));
    const acknowledged = dataCheck.result?.fingerprint;
    button(m.data_check_notice_action_ack()).click();
    flushSync();
    await waitFor(() => text() === '');
    await waitFor(
      async () => (await db.settings.get('dataCheckAcknowledged'))?.value === acknowledged,
    );
    await rerun();
    expect(text()).toBe('');
    await db.table('vendors').put({ id: 'v2', name: null });
    await rerun();
    await waitFor(() => text().includes(m.data_check_notice({ count: 2 })));
  });

  test('確認した行を同じ表の別の行に入れ替えると、件数が同じでも再び出す', async () => {
    await db.table('vendors').put({ id: 'v1', name: null });
    await render();
    await waitFor(() => text().includes(m.data_check_notice({ count: 1 })));
    button(m.data_check_notice_action_ack()).click();
    flushSync();
    await waitFor(async () => (await db.settings.get('dataCheckAcknowledged')) !== undefined);
    await db.vendors.delete('v1');
    await db.table('vendors').put({ id: 'v9', name: null });
    await rerun();
    await waitFor(() => text().includes(m.data_check_notice({ count: 1 })));
  });

  test('保存が済むまでは出したままでボタンを止め、済んだら隠す', async () => {
    await db.table('vendors').put({ id: 'v1', name: null });
    await render();
    await waitFor(() => text().includes(m.data_check_notice({ count: 1 })));
    let markStarted!: () => void;
    const started = new Promise<void>((r) => {
      markStarted = r;
    });
    let release!: () => void;
    const released = new Promise<void>((r) => {
      release = r;
    });
    // 先に settings の書き込み取引を開いて止め、「確認した」の保存をその後ろに並ばせる。
    const holding = db.transaction('rw', db.settings, async () => {
      await db.settings.get('dataCheckAcknowledged');
      markStarted();
      await Dexie.waitFor(released);
    });
    await started;
    const ack = button(m.data_check_notice_action_ack()) as HTMLButtonElement;
    // 止めている取引の文脈がここまで引き継がれるため、外して押す。中で押すと保存がその取引に入ってしまう。
    Dexie.ignoreTransaction(() => {
      expect(Dexie.currentTransaction).toBeNull();
      ack.click();
    });
    flushSync();
    expect(ack.disabled).toBe(true);
    await new Promise((r) => setTimeout(r, 50));
    flushSync();
    expect(text()).toContain(m.data_check_notice({ count: 1 }));
    expect(ack.disabled).toBe(true);
    release();
    await holding;
    await waitFor(() => text() === '');
  });

  test('保存できなければ出したまま失敗を知らせ、ボタンを戻す', async () => {
    await db.table('vendors').put({ id: 'v1', name: null });
    await render();
    await waitFor(() => text().includes(m.data_check_notice({ count: 1 })));
    const ack = button(m.data_check_notice_action_ack()) as HTMLButtonElement;
    db.close();
    try {
      ack.click();
      flushSync();
      expect(ack.disabled).toBe(true);
      await waitFor(() => text().includes(m.data_check_notice_ack_failed({ message: '' })));
      flushSync();
      expect(ack.disabled).toBe(false);
      expect(text()).toContain(m.data_check_notice({ count: 1 }));
    } finally {
      await db.open();
    }
    expect(await db.settings.get('dataCheckAcknowledged')).toBeUndefined();
  });

  test('続けて押しても書き込みは 1 回', async () => {
    await db.table('vendors').put({ id: 'v1', name: null });
    await render();
    await waitFor(() => text().includes(m.data_check_notice({ count: 1 })));
    let writes = 0;
    const count = () => {
      writes++;
    };
    db.settings.hook('creating', count);
    db.settings.hook('updating', count);
    try {
      const ack = button(m.data_check_notice_action_ack());
      ack.click();
      ack.click();
      flushSync();
      ack.click();
      await waitFor(() => text() === '');
      expect(writes).toBe(1);
    } finally {
      db.settings.hook('creating').unsubscribe(count);
      db.settings.hook('updating').unsubscribe(count);
    }
  });

  test('「詳しく見る」は設定画面の点検欄を行き先として預ける', async () => {
    await db.table('vendors').put({ id: 'v1', name: null });
    await render();
    await waitFor(() => text().includes(m.data_check_notice({ count: 1 })));
    button(m.data_check_notice_action_details()).click();
    expect(takeSettingsTarget()).toBe('dataCheck');
  });

  test('値や主キーに HTML の文字列があっても要素を作らない', async () => {
    const html = '<b id="inj">x</b>';
    await db.table('vendors').put({ id: html, name: 'A', entityType: html });
    await render();
    await waitFor(() => text().includes(m.data_check_notice({ count: 1 })));
    expect(document.querySelector('#inj')).toBeNull();
  });
});
