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
  // あるブラウザ 15.2〜18 相当。getDirectory はあるが書き込み API が無い環境で、
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

function notFound(name: string): DOMException {
  return new DOMException(`${name} not found`, 'NotFoundError');
}

class FakeDirectoryHandle {
  readonly files = new Map<string, FakeFileHandle>();
  readonly dirs = new Map<string, FakeDirectoryHandle>();
  // NotFoundError 以外を投げさせて、握り潰されないことを確かめるための注入口
  failure: Error | null = null;

  async getFileHandle(name: string, options?: { create?: boolean }) {
    if (this.failure) {
      throw this.failure;
    }
    const existing = this.files.get(name);
    if (existing) {
      return existing;
    }
    if (!options?.create) {
      throw notFound(name);
    }
    const created = new FakeFileHandle();
    this.files.set(name, created);
    return created;
  }

  async getDirectoryHandle(name: string, options?: { create?: boolean }) {
    if (this.failure) {
      throw this.failure;
    }
    const existing = this.dirs.get(name);
    if (existing) {
      return existing;
    }
    if (!options?.create) {
      throw notFound(name);
    }
    const created = new FakeDirectoryHandle();
    this.dirs.set(name, created);
    return created;
  }

  async removeEntry(name: string): Promise<void> {
    if (!this.files.delete(name) && !this.dirs.delete(name)) {
      throw notFound(name);
    }
  }

  async *keys(): AsyncGenerator<string> {
    yield* this.files.keys();
    yield* this.dirs.keys();
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

  test('ネストしたパスは途中のディレクトリを作って書く', async () => {
    const root = new FakeDirectoryHandle();
    vi.stubGlobal('navigator', { storage: { getDirectory: async () => root } });

    const sha = 'a'.repeat(64);
    const result = await new OpfsBackupAdapter().backup(
      streamOf([new Uint8Array([9, 8])]),
      `attachments/${sha}`,
    );
    expect(result).toEqual({ fileName: `attachments/${sha}` });
    const handle = root.dirs.get('attachments')?.files.get(sha);
    expect(Array.from(new Uint8Array(await (await handle!.getFile()).arrayBuffer()))).toEqual([
      9, 8,
    ]);
  });
  // 内容定址の blob ごとに「最新」複製を作ると、中身が同じだけの重複が延々と増える。
  test('ネストしたパスでは aoiko-ledger-latest を作らない', async () => {
    const root = new FakeDirectoryHandle();
    vi.stubGlobal('navigator', { storage: { getDirectory: async () => root } });

    await new OpfsBackupAdapter().backup(
      streamOf([new Uint8Array([1])]),
      `attachments/${'b'.repeat(64)}`,
    );
    expect([...root.files.keys()]).toEqual([]);
  });
});

describe('OpfsBackupAdapter.read', () => {
  test('書いたバイト列をそのまま読み戻す', async () => {
    const root = new FakeDirectoryHandle();
    vi.stubGlobal('navigator', { storage: { getDirectory: async () => root } });

    const adapter = new OpfsBackupAdapter();
    await adapter.backup(
      streamOf([new Uint8Array([1, 2, 3])]),
      'snapshots/2026-08-09T120000Z.json',
    );
    const bytes = await adapter.read('snapshots/2026-08-09T120000Z.json');
    expect(Array.from(bytes!)).toEqual([1, 2, 3]);
  });

  test('ファイルもディレクトリも無ければ null', async () => {
    const root = new FakeDirectoryHandle();
    vi.stubGlobal('navigator', { storage: { getDirectory: async () => root } });

    const adapter = new OpfsBackupAdapter();
    expect(await adapter.read('attachments/x')).toBeNull();
    await adapter.backup(streamOf([new Uint8Array([1])]), `attachments/${'c'.repeat(64)}`);
    expect(await adapter.read(`attachments/${'d'.repeat(64)}`)).toBeNull();
  });
  // NotFoundError 以外まで null にすると、IO 失敗が「まだ同期されていない」に化ける。
  test('NotFoundError 以外はそのまま投げる', async () => {
    const root = new FakeDirectoryHandle();
    root.failure = new DOMException('disk', 'NotReadableError');
    vi.stubGlobal('navigator', { storage: { getDirectory: async () => root } });

    await expect(new OpfsBackupAdapter().read('snapshots/a.json')).rejects.toThrow('disk');
  });
});

describe('OpfsBackupAdapter.list / remove', () => {
  test('subdir を渡すとその直下の名前だけを返す', async () => {
    const root = new FakeDirectoryHandle();
    vi.stubGlobal('navigator', { storage: { getDirectory: async () => root } });

    const adapter = new OpfsBackupAdapter();
    await adapter.backup(streamOf([new Uint8Array([1])]), 'snapshots/2026-08-09T120000Z.json');
    await adapter.backup(streamOf([new Uint8Array([1])]), `attachments/${'e'.repeat(64)}`);
    expect(await adapter.list('snapshots')).toEqual(['2026-08-09T120000Z.json']);
    expect((await adapter.list()).sort()).toEqual(['attachments', 'snapshots']);
  });

  test('ディレクトリが無ければ空配列', async () => {
    const root = new FakeDirectoryHandle();
    vi.stubGlobal('navigator', { storage: { getDirectory: async () => root } });

    expect(await new OpfsBackupAdapter().list('attachments')).toEqual([]);
  });

  test('list も NotFoundError 以外はそのまま投げる', async () => {
    const root = new FakeDirectoryHandle();
    root.failure = new DOMException('denied', 'NotAllowedError');
    vi.stubGlobal('navigator', { storage: { getDirectory: async () => root } });

    await expect(new OpfsBackupAdapter().list('attachments')).rejects.toThrow('denied');
  });

  test('ネストしたパスのファイルを消す（親ディレクトリは残す）', async () => {
    const root = new FakeDirectoryHandle();
    vi.stubGlobal('navigator', { storage: { getDirectory: async () => root } });

    const adapter = new OpfsBackupAdapter();
    const sha = 'f'.repeat(64);
    await adapter.backup(streamOf([new Uint8Array([1])]), `attachments/${sha}`);
    await adapter.remove(`attachments/${sha}`);
    expect(root.dirs.get('attachments')?.files.has(sha)).toBe(false);
    expect(root.dirs.has('attachments')).toBe(true);
  });
});
