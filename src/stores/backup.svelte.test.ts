// scheduleBackup は間隔判定を挟まず backup() を呼ぶため、圧縮中に来た保存が
// 捨てられると「どのバックアップにも入らない変更」が生まれる（#316）。
// backup() は private フィールドへ直接アダプタを差し込む以外に注入口が無いため、
// ledger.svelte.test.ts と同じくシングルトンをキャストして駆動する。

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { db } from '../db/db';
import { backup as backupManager } from './backup.svelte';
import { getSetting, setSetting } from '../lib/settings';
import * as saveFileModule from '../lib/save-file';
import type { BackupAdapter } from '../backup/types';
import type { SaveFileResult } from '../lib/save-file';

interface Pending {
  resolve: () => void;
  reject: (e: unknown) => void;
}

class FakeAdapter implements BackupAdapter {
  readonly name = 'fake';
  calls = 0;
  pending: Pending[] = [];
  failNext = false;

  isAvailable(): Promise<boolean> {
    return Promise.resolve(true);
  }
  isReady(): Promise<boolean> {
    return Promise.resolve(true);
  }
  ensurePermission(): Promise<boolean> {
    return Promise.resolve(true);
  }
  configure(): Promise<void> {
    return Promise.resolve();
  }
  backup(_stream: ReadableStream<Uint8Array>, fileName: string): Promise<{ fileName: string }> {
    this.calls++;
    const shouldFail = this.failNext;
    this.failNext = false;
    return new Promise((resolve, reject) => {
      this.pending.push({
        resolve: () => {
          if (shouldFail) {
            reject(new Error('書き込み失敗'));
          } else {
            resolve({ fileName });
          }
        },
        reject,
      });
    });
  }
  list(): Promise<string[]> {
    return Promise.resolve([]);
  }
  remove(_fileName: string): Promise<void> {
    return Promise.resolve();
  }
  // 進行中の1件を完了させる
  settleOne(): void {
    this.pending.shift()?.resolve();
  }
}

type Injectable = { adapter: BackupAdapter | null; status: string; adapterKind: string };

// backup() は adapter.backup() に届くまでに設定読込と zip 生成を挟むため、
// マイクロタスク1回では足りない。実際に呼ばれるまで待つ。
async function waitForCalls(expected: number): Promise<void> {
  for (let i = 0; i < 200 && fake.calls < expected; i++) {
    await new Promise((r) => setTimeout(r, 0));
  }
}

let fake: FakeAdapter;

beforeEach(async () => {
  await db.delete();
  await db.open();
  fake = new FakeAdapter();
  const injectable = backupManager as unknown as Injectable;
  injectable.adapter = fake;
  injectable.status = 'idle';
  injectable.adapterKind = 'none';
  backupManager.lastDownloadAt = null;
});

afterEach(async () => {
  await db.delete();
  vi.restoreAllMocks();
});

function mockSaveFile(result: SaveFileResult): void {
  vi.spyOn(saveFileModule, 'saveFile').mockResolvedValue(result);
}

describe('backupManager.backup（書込中に来た要求の追い掛け）', () => {
  test('writing 中に来た要求は完了後に1回だけ再実行される', async () => {
    const first = backupManager.backup();
    await waitForCalls(1);
    expect(fake.calls).toBe(1);

    await backupManager.backup(); // writing 中なので即 return（追い掛け予約のみ）
    expect(fake.calls).toBe(1);

    fake.settleOne();
    await waitForCalls(2);
    fake.settleOne();
    await first;
    expect(fake.calls).toBe(2);
  });

  test('書込中に何件来ても追い掛けは1回に合流する', async () => {
    const first = backupManager.backup();
    await waitForCalls(1);
    await backupManager.backup();
    await backupManager.backup();
    await backupManager.backup();
    expect(fake.calls).toBe(1);

    fake.settleOne();
    await waitForCalls(2);
    fake.settleOne();
    await first;
    expect(fake.calls).toBe(2);
  });

  test('失敗したら追い掛けない（失敗中のアダプタへ再突入しない）', async () => {
    fake.failNext = true;
    const first = backupManager.backup();
    await waitForCalls(1);
    await backupManager.backup();
    expect(fake.calls).toBe(1);

    fake.settleOne();
    await first;
    expect(fake.calls).toBe(1);
    expect(backupManager.status).toBe('error');
  });
});

describe('backupManager.downloadBackup（issue#390：保存できたかの確認）', () => {
  test('取消（cancelled）は刻まず、確認も不要', async () => {
    mockSaveFile('cancelled');
    const needsConfirm = await backupManager.downloadBackup();
    expect(needsConfirm).toBe(false);
    expect(backupManager.lastDownloadAt).toBeNull();
    expect(await getSetting('lastDownloadAt')).toBeUndefined();
  });

  test('picker 経由の成功（saved）は刻み、確認は不要', async () => {
    mockSaveFile('saved');
    const needsConfirm = await backupManager.downloadBackup();
    expect(needsConfirm).toBe(false);
    expect(backupManager.lastDownloadAt).not.toBeNull();
    expect(await getSetting('lastDownloadAt')).toBe(backupManager.lastDownloadAt);
  });

  test('unknown かつ警告が出ている状態なら、刻まず確認を要求する', async () => {
    const injectable = backupManager as unknown as { adapterKind: string };
    injectable.adapterKind = 'opfs'; // フォルダ自動保存が動いていない
    mockSaveFile('unknown');
    const needsConfirm = await backupManager.downloadBackup();
    expect(needsConfirm).toBe(true);
    expect(backupManager.lastDownloadAt).toBeNull();
    expect(await getSetting('lastDownloadAt')).toBeUndefined();
  });

  test('unknown でも警告が出ていなければ、黙って刻む', async () => {
    const injectable = backupManager as unknown as { adapterKind: string };
    injectable.adapterKind = 'fsa'; // フォルダ自動保存が動いている＝警告なし
    mockSaveFile('unknown');
    const needsConfirm = await backupManager.downloadBackup();
    expect(needsConfirm).toBe(false);
    expect(backupManager.lastDownloadAt).not.toBeNull();
    expect(await getSetting('lastDownloadAt')).toBe(backupManager.lastDownloadAt);
  });

  test('unknown かつ抑止設定済みなら、警告が出ていても黙って刻む', async () => {
    const injectable = backupManager as unknown as { adapterKind: string };
    injectable.adapterKind = 'opfs';
    await setSetting('skipDownloadSavedConfirm', true);
    mockSaveFile('unknown');
    const needsConfirm = await backupManager.downloadBackup();
    expect(needsConfirm).toBe(false);
    expect(backupManager.lastDownloadAt).not.toBeNull();
    expect(await getSetting('lastDownloadAt')).toBe(backupManager.lastDownloadAt);
  });

  test('confirmDownloadSaved は利用者の「保存できた」回答を刻む', async () => {
    await backupManager.confirmDownloadSaved();
    expect(backupManager.lastDownloadAt).not.toBeNull();
    expect(await getSetting('lastDownloadAt')).toBe(backupManager.lastDownloadAt);
  });
});
