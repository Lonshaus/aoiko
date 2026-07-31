import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { db } from '../db/db';
import { backup, type BackupStatus } from './backup.svelte';
import type { BackupAdapter } from '../backup/types';

async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('waitFor タイムアウト');
    }
    await new Promise((r) => setTimeout(r, 5));
  }
}

interface PendingCall {
  resolve: () => void;
  reject: (e: unknown) => void;
}
// 実際の保存を待たせ、テストが任意のタイミングで完了/失敗させられるようにする偽アダプタ。
function createFakeAdapter(): { adapter: BackupAdapter; calls: PendingCall[] } {
  const calls: PendingCall[] = [];
  const adapter: BackupAdapter = {
    name: 'fake',
    isAvailable: async () => true,
    isReady: async () => true,
    ensurePermission: async () => true,
    configure: async () => {},
    backup: async (stream, fileName) => {
      await stream.cancel();
      await new Promise<void>((resolve, reject) => {
        calls.push({ resolve, reject });
      });
      return { fileName };
    },
    list: async () => [],
    remove: async () => {},
  };
  return { adapter, calls };
}

// private フィールドへ直接アクセスして偽アダプタへ差し替える（#316 の再入・再キュー挙動のテスト用）。
function asInternal(): {
  adapter: BackupAdapter | null;
  status: BackupStatus;
  backupPending: boolean;
} {
  return backup as unknown as {
    adapter: BackupAdapter | null;
    status: BackupStatus;
    backupPending: boolean;
  };
}

beforeEach(async () => {
  await db.delete();
  await db.open();
});

afterEach(async () => {
  asInternal().status = 'idle';
  await db.delete();
});

describe('backup() の書込中の再キュー（#316）', () => {
  test('writing 中に来た要求は捨てられず、完了後に1回だけ追い掛けて実行する', async () => {
    const { adapter, calls } = createFakeAdapter();
    const internal = asInternal();
    internal.adapter = adapter;
    internal.status = 'idle';

    // backup() は再帰ではなくループで追い掛けるため、追い掛け分も含めて全て終わるまで
    // 呼び出し元の Promise は解決しない。したがって各段階の進み具合は calls.length /
    // status を通して観測する。
    const first = backup.backup();
    await waitFor(() => calls.length === 1);

    void backup.backup();
    expect(calls).toHaveLength(1);
    expect(internal.status).toBe('writing');

    calls[0]!.resolve();
    await waitFor(() => calls.length === 2);
    expect(internal.status).toBe('writing');

    calls[1]!.resolve();
    await first;
    expect(internal.status).toBe('idle');
    expect(calls).toHaveLength(2);
  });

  test('writing 中に複数回要求しても追い掛けは1回に合流する', async () => {
    const { adapter, calls } = createFakeAdapter();
    const internal = asInternal();
    internal.adapter = adapter;
    internal.status = 'idle';

    const first = backup.backup();
    await waitFor(() => calls.length === 1);

    void backup.backup();
    void backup.backup();
    void backup.backup();
    expect(calls).toHaveLength(1);

    calls[0]!.resolve();
    await waitFor(() => calls.length === 2);

    calls[1]!.resolve();
    await first;
    // 3件の要求が1回だけの追い掛けに合流している（2件目以降は増えない）
    expect(internal.status).toBe('idle');
    expect(calls).toHaveLength(2);
  });

  test('失敗した回は追い掛けない', async () => {
    const { adapter, calls } = createFakeAdapter();
    const internal = asInternal();
    internal.adapter = adapter;
    internal.status = 'idle';

    const first = backup.backup();
    await waitFor(() => calls.length === 1);

    void backup.backup();
    expect(internal.status).toBe('writing');

    calls[0]!.reject(new Error('保存失敗'));
    await first;

    expect(internal.status).toBe('error');
    // pending が立っていても失敗中のアダプタへ再突入しない
    await new Promise((r) => setTimeout(r, 50));
    expect(calls).toHaveLength(1);
  });
});
