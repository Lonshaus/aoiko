// scheduleBackup は間隔判定を挟まず backup() を呼ぶため、圧縮中に来た保存が
// 捨てられると「どのバックアップにも入らない変更」が生まれる（#316）。
// backup() は private フィールドへ直接アダプタを差し込む以外に注入口が無いため、
// ledger.svelte.test.ts と同じくシングルトンをキャストして駆動する。

import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { db } from '../db/db';
import { backup as backupManager } from './backup.svelte';
import type { BackupAdapter } from '../backup/types';

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

type Injectable = { adapter: BackupAdapter | null; status: string };

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
});

afterEach(async () => {
  await db.delete();
});

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
