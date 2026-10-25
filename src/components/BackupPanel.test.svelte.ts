import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { db } from '../db/db';
import { setSetting } from '../lib/settings';
import { setLocale } from '../paraglide/runtime';
import BackupPanel from './BackupPanel.svelte';

vi.mock('../stores/backup.svelte', () => ({
  backup: {
    status: 'ok',
    adapterKind: 'none',
    folderName: null,
    lastBackupAt: null,
    lastDownloadAt: null,
    lastError: '',
    storagePersisted: null,
  },
}));

let container: HTMLElement | undefined;
let instance: Record<string, unknown> | undefined;

async function mountPanel(): Promise<{ count: HTMLSelectElement; days: HTMLSelectElement }> {
  instance = mount(BackupPanel, { target: container! });
  flushSync();
  await new Promise((resolve) => setTimeout(resolve, 30));
  flushSync();
  return {
    count: container!.querySelector<HTMLSelectElement>('#backup-retention-count')!,
    days: container!.querySelector<HTMLSelectElement>('#blob-retention-days')!,
  };
}
// 型付きの setSetting を通さず、復元や旧バージョンが残した想定外の値を直接置く。
async function putRaw(key: string, value: unknown): Promise<void> {
  await db.settings.put({ key, value, updatedAt: Date.now() });
}

beforeEach(async () => {
  setLocale('ja', { reload: false });
  await db.settings.clear();
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(async () => {
  if (instance !== undefined) {
    unmount(instance);
    instance = undefined;
  }
  container?.remove();
  container = undefined;
  await db.settings.clear();
});

describe('保持の設定の読み込み', () => {
  test('選択肢にある値はそのまま表示する', async () => {
    await setSetting('backupRetentionCount', 30);
    await setSetting('blobRetentionDays', 180);
    const { count, days } = await mountPanel();
    expect(count.value).toBe('30');
    expect(days.value).toBe('180');
  });

  test('未設定なら 0 を表示する', async () => {
    const { count, days } = await mountPanel();
    expect(count.value).toBe('0');
    expect(days.value).toBe('0');
  });

  test.each([
    ['選択肢に無い数値', 14, 60],
    ['数字の文字列', '30', '90'],
    ['数値でない値', null, { days: 30 }],
  ])('%s が残っていれば 0 を表示する', async (_name, countValue, daysValue) => {
    await putRaw('backupRetentionCount', countValue);
    await putRaw('blobRetentionDays', daysValue);
    const { count, days } = await mountPanel();
    expect(count.value).toBe('0');
    expect(days.value).toBe('0');
  });
});
