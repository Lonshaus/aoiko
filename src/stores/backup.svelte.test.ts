// 書き出し中に来た保存が捨てられると「どのバックアップにも入らない変更」が
// 生まれる（#316）。backup() は private フィールドへ直接アダプタを差し込む以外に
// 注入口が無いため、ledger.svelte.test.ts と同じくシングルトンをキャストして駆動する。

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
  paths: string[] = [];
  backup(_stream: ReadableStream<Uint8Array>, fileName: string): Promise<{ fileName: string }> {
    this.calls++;
    this.paths.push(fileName);
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
  // 保存先にある物の一覧。汰換・全削除の対象選びを見るために持つ。
  stored = new Set<string>();
  list(subdir?: string): Promise<string[]> {
    const prefix = subdir === undefined ? '' : `${subdir}/`;
    return Promise.resolve(
      [...this.stored]
        .filter((p) => p.startsWith(prefix) && !p.slice(prefix.length).includes('/'))
        .map((p) => p.slice(prefix.length)),
    );
  }
  // 読み出しの回数と、返ってこない状態を作れるようにする。クラウド同期フォルダが
  // 端末から中身を追い出したファイルは、オフラインで読むと例外も返らないまま返らない。
  reads = 0;
  hangReads = false;
  read(_path: string): Promise<Uint8Array<ArrayBuffer> | null> {
    this.reads++;
    if (this.hangReads) {
      return new Promise<never>(() => {});
    }
    return Promise.resolve(null);
  }
  remove(path: string): Promise<void> {
    this.stored.delete(path);
    return Promise.resolve();
  }
  // 進行中の1件を完了させる
  settleOne(): void {
    this.pending.shift()?.resolve();
  }
}

type Injectable = {
  adapter: BackupAdapter | null;
  status: string;
  adapterKind: string;
  sweepInFlight: boolean;
  sweepDeadlineMs: number;
};

// backup() は adapter.backup() に届くまでに設定読込と payload 組み立てを挟むため、
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
  injectable.sweepInFlight = false;
  injectable.sweepDeadlineMs = 30;
  backupManager.lastDownloadAt = null;
  backupManager.lastError = '';
});

afterEach(async () => {
  await db.delete();
  vi.restoreAllMocks();
});

function mockSaveFile(result: SaveFileResult): void {
  vi.spyOn(saveFileModule, 'saveFile').mockResolvedValue(result);
}

describe('backupManager.backup（保存先への書き方）', () => {
  // zip を作り直さず、変わった分だけ書く（#397）。ここが zip 名に戻ると、写真が増える
  // ほど毎回の同期量が膨らむ元の作りへ逆戻りする。
  test('自動保存はスナップショットとして書く', async () => {
    const p = backupManager.backup();
    await waitForCalls(1);
    fake.settleOne();
    await p;

    expect(fake.paths).toEqual([
      expect.stringMatching(/^snapshots\/\d{4}-\d{2}-\d{2}T\d{6}Z\.json$/),
    ]);
  });
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

// 参照されなくなった証憑の実体の掃除。消えると困るのは利用者の写真そのものなので、
// 「既定では走らない」と「毎回は走らない」を書き込み側から確かめる。
describe('backupManager.backup（実体の掃除の起動条件）', () => {
  async function runBackup(): Promise<void> {
    const p = backupManager.backup();
    await waitForCalls(1);
    fake.settleOne();
    await p;
  }

  test('既定（0 日）では走らない', async () => {
    await runBackup();
    expect(await getSetting('lastBlobSweepAt')).toBeUndefined();
  });

  test('日数を設定していれば走る', async () => {
    await setSetting('blobRetentionDays', 30);
    await runBackup();
    expect(await getSetting('lastBlobSweepAt')).toEqual(expect.any(Number));
  });

  test('前回から 1 日経っていなければ走らない', async () => {
    await setSetting('blobRetentionDays', 30);
    const stamped = Date.now() - 60_000;
    await setSetting('lastBlobSweepAt', stamped);
    await runBackup();
    expect(await getSetting('lastBlobSweepAt')).toBe(stamped);
  });

  test('前回から 1 日以上経っていれば走る', async () => {
    await setSetting('blobRetentionDays', 30);
    const stamped = Date.now() - 25 * 60 * 60 * 1000;
    await setSetting('lastBlobSweepAt', stamped);
    await runBackup();
    expect(await getSetting('lastBlobSweepAt')).not.toBe(stamped);
  });
});
// 掃除は backup() の中で status = 'writing' のまま await される。クラウドから追い出された
// スナップショットをオフラインで読むと返ってこないので、時限が無いと status が二度と
// 'idle' に戻らず、以降のバックアップが 1 件も走らなくなる（例外ではないので catch にも
// 掛からない）。利用者の帳簿が黙って保存されなくなるため、ここは落とせない。
describe('backupManager.backup（掃除が返ってこない場合）', () => {
  async function runBackup(): Promise<void> {
    const p = backupManager.backup();
    await waitForCalls(fake.calls + 1);
    fake.settleOne();
    await p;
  }

  beforeEach(async () => {
    await setSetting('blobRetentionDays', 30);
    fake.stored = new Set(['snapshots/2026-08-09T120000Z.json']);
    fake.hangReads = true;
  });

  test('status は idle に戻り、次のバックアップが走る', async () => {
    await runBackup();

    expect(fake.reads).toBeGreaterThan(0);
    expect(backupManager.status).toBe('idle');

    const before = fake.calls;
    await runBackup();
    expect(fake.calls).toBe(before + 1);
  });
  // 元の読み出しは止められないので、重ねると返らない処理が積み上がる。
  test('裏で走ったままの掃除がある間は次の掃除を始めない', async () => {
    await runBackup();
    const reads = fake.reads;

    await setSetting('lastBlobSweepAt', 0);
    await runBackup();

    expect(fake.reads).toBe(reads);
  });

  test('時限切れは利用者向けのエラーにしない', async () => {
    await runBackup();
    expect(backupManager.lastError).toBe('');
  });

  test('掃除が終わらなかった回は記録を進めない（次の機会に持ち越す）', async () => {
    await runBackup();
    expect(await getSetting('lastBlobSweepAt')).toBeUndefined();
  });
});

// OPFS の控えは帳簿と証憑写真の完全な複製なのに、利用者は ファイル管理 から見ることも
// 消すこともできない。ここに取りこぼしがあると、譲渡・廃棄した端末に帳簿が残る。
describe('backupManager.clearStoredBackups（OPFS の控えの全削除）', () => {
  test('散ファイルも旧形式の zip も残さない', async () => {
    const injectable = backupManager as unknown as { adapterKind: string };
    injectable.adapterKind = 'opfs';
    fake.stored = new Set([
      'snapshots/2026-08-09T120000Z.json',
      `attachments/${'a'.repeat(64)}`,
      'aoiko-ledger-2026-07-01.zip',
      'aoiko-ledger-latest.zip',
    ]);

    await backupManager.clearStoredBackups();

    expect([...fake.stored]).toEqual([]);
  });

  test('利用者が選んだフォルダ（fsa / native）には手を出さない', async () => {
    const injectable = backupManager as unknown as { adapterKind: string };
    injectable.adapterKind = 'fsa';
    fake.stored = new Set(['snapshots/2026-08-09T120000Z.json']);

    await backupManager.clearStoredBackups();

    expect([...fake.stored]).toHaveLength(1);
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
