import { afterEach, describe, expect, test, vi } from 'vitest';
import { OpfsBackupAdapter } from './opfs';

afterEach(() => {
  vi.unstubAllGlobals();
});

// createWritable を持つ最小のダミー。実体は使わず prototype の有無だけを見る。
class WritableCapableHandle {
  createWritable() {}
}

class ReadOnlyHandle {}

describe('OpfsBackupAdapter.isAvailable', () => {
  test('getDirectory と createWritable が揃っていれば利用可能', async () => {
    vi.stubGlobal('navigator', { storage: { getDirectory: () => {} } });
    vi.stubGlobal('FileSystemFileHandle', WritableCapableHandle);
    expect(await new OpfsBackupAdapter().isAvailable()).toBe(true);
  });
  // Safari 15.2〜18 相当。getDirectory はあるが書き込み API が無い環境で、
  // 利用可能と誤判定すると書き込み時まで失敗が表面化しない。
  test('createWritable が無ければ利用不可', async () => {
    vi.stubGlobal('navigator', { storage: { getDirectory: () => {} } });
    vi.stubGlobal('FileSystemFileHandle', ReadOnlyHandle);
    expect(await new OpfsBackupAdapter().isAvailable()).toBe(false);
  });

  test('FileSystemFileHandle 自体が無ければ利用不可', async () => {
    vi.stubGlobal('navigator', { storage: { getDirectory: () => {} } });
    vi.stubGlobal('FileSystemFileHandle', undefined);
    expect(await new OpfsBackupAdapter().isAvailable()).toBe(false);
  });

  test('getDirectory が無ければ利用不可', async () => {
    vi.stubGlobal('navigator', { storage: {} });
    vi.stubGlobal('FileSystemFileHandle', WritableCapableHandle);
    expect(await new OpfsBackupAdapter().isAvailable()).toBe(false);
  });

  test('storage 自体が無ければ利用不可', async () => {
    vi.stubGlobal('navigator', {});
    vi.stubGlobal('FileSystemFileHandle', WritableCapableHandle);
    expect(await new OpfsBackupAdapter().isAvailable()).toBe(false);
  });
});

// OPFS の最小フェイク。happy-dom は OPFS を提供しないため、backup() が使う
// getFileHandle / createWritable / getFile だけを実ディスクなしで再現する。
class FakeFileHandle {
  committed = new Uint8Array(0);

  createWritable() {
    const chunks: Uint8Array[] = [];
    return new WritableStream<Uint8Array>({
      write: (chunk) => {
        chunks.push(chunk);
      },
      close: () => {
        const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
        const merged = new Uint8Array(total);
        let offset = 0;
        for (const chunk of chunks) {
          merged.set(chunk, offset);
          offset += chunk.length;
        }
        this.committed = merged;
      },
    });
  }

  async getFile() {
    return new Blob([this.committed]);
  }
}

class FakeDirectoryHandle {
  private handles = new Map<string, FakeFileHandle>();

  async getFileHandle(name: string, _options?: { create?: boolean }) {
    let handle = this.handles.get(name);
    if (!handle) {
      handle = new FakeFileHandle();
      this.handles.set(name, handle);
    }
    return handle;
  }
}

function streamOf(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(chunk);
      }
      controller.close();
    },
  });
}

describe('OpfsBackupAdapter.backup', () => {
  test('複数チャンクのストリームが日付ファイルに順序通り結合される', async () => {
    const root = new FakeDirectoryHandle();
    vi.stubGlobal('navigator', { storage: { getDirectory: async () => root } });

    const chunks = [new Uint8Array([1, 2, 3]), new Uint8Array([4, 5]), new Uint8Array([6])];
    await new OpfsBackupAdapter().backup(streamOf(chunks), 'aoiko-ledger-2026-07-28.zip');

    const dailyHandle = await root.getFileHandle('aoiko-ledger-2026-07-28.zip');
    const bytes = new Uint8Array(await (await dailyHandle.getFile()).arrayBuffer());
    expect(Array.from(bytes)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  test('aoiko-ledger-latest が日付ファイルとバイト単位で一致する', async () => {
    const root = new FakeDirectoryHandle();
    vi.stubGlobal('navigator', { storage: { getDirectory: async () => root } });

    const chunks = [new Uint8Array([10, 20]), new Uint8Array([30])];
    await new OpfsBackupAdapter().backup(streamOf(chunks), 'aoiko-ledger-2026-07-28.zip');

    const dailyHandle = await root.getFileHandle('aoiko-ledger-2026-07-28.zip');
    const latestHandle = await root.getFileHandle('aoiko-ledger-latest.zip');
    const dailyBytes = new Uint8Array(await (await dailyHandle.getFile()).arrayBuffer());
    const latestBytes = new Uint8Array(await (await latestHandle.getFile()).arrayBuffer());
    expect(Array.from(latestBytes)).toEqual(Array.from(dailyBytes));
  });

  test('拡張子はファイル名から導出され、ドットが無ければ latest にも拡張子が付かない', async () => {
    const root = new FakeDirectoryHandle();
    vi.stubGlobal('navigator', { storage: { getDirectory: async () => root } });

    await new OpfsBackupAdapter().backup(streamOf([new Uint8Array([1])]), 'aoiko-ledger-noext');

    const latestHandle = await root.getFileHandle('aoiko-ledger-latest');
    const bytes = new Uint8Array(await (await latestHandle.getFile()).arrayBuffer());
    expect(Array.from(bytes)).toEqual([1]);
  });

  test('backup の解決値は fileName をそのまま返す', async () => {
    const root = new FakeDirectoryHandle();
    vi.stubGlobal('navigator', { storage: { getDirectory: async () => root } });

    const result = await new OpfsBackupAdapter().backup(
      streamOf([new Uint8Array([1])]),
      'aoiko-ledger-2026-07-28.zip',
    );
    expect(result).toEqual({ fileName: 'aoiko-ledger-2026-07-28.zip' });
  });
});
