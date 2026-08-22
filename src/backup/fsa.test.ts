import { describe, expect, test } from 'vitest';
import { FsaBackupAdapter } from './fsa';
// File System Access のハンドルを実ディスク無しで再現する最小のフェイク。
// happy-dom は showDirectoryPicker も OPFS も提供しないため、アダプタが使う
// getDirectoryHandle / getFileHandle / createWritable / getFile / keys / removeEntry
// だけをメモリ上に用意する。
function notFound(name: string): DOMException {
  return new DOMException(`${name} not found`, 'NotFoundError');
}

class FakeFileHandle {
  readonly kind = 'file' as const;
  committed = new Uint8Array(0);

  createWritable(): WritableStream<Uint8Array> {
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

  async getFile(): Promise<Blob> {
    return new Blob([this.committed]);
  }
}

class FakeDirectoryHandle {
  readonly kind = 'directory' as const;
  readonly files = new Map<string, FakeFileHandle>();
  readonly dirs = new Map<string, FakeDirectoryHandle>();
  // NotFoundError 以外を投げさせて、握り潰されないことを確かめるための注入口
  failure: Error | null = null;
  permission: PermissionState = 'granted';

  async queryPermission(): Promise<PermissionState> {
    return this.permission;
  }

  async requestPermission(): Promise<PermissionState> {
    return this.permission;
  }

  async getDirectoryHandle(
    name: string,
    options?: { create?: boolean },
  ): Promise<FakeDirectoryHandle> {
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
    created.permission = this.permission;
    this.dirs.set(name, created);
    return created;
  }

  async getFileHandle(name: string, options?: { create?: boolean }): Promise<FakeFileHandle> {
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

  async removeEntry(name: string): Promise<void> {
    if (!this.files.delete(name) && !this.dirs.delete(name)) {
      throw notFound(name);
    }
  }

  async *keys(): AsyncGenerator<string> {
    yield* this.files.keys();
    yield* this.dirs.keys();
  }

  async *entries(): AsyncGenerator<[string, FakeFileHandle | FakeDirectoryHandle]> {
    yield* this.files.entries();
    yield* this.dirs.entries();
  }
}

function adapterOn(root: FakeDirectoryHandle | null): FsaBackupAdapter {
  return new FsaBackupAdapter(
    async () => root as unknown as FileSystemDirectoryHandle | null,
    async () => undefined,
  );
}

function streamOf(bytes: number[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(bytes));
      controller.close();
    },
  });
}

async function bytesOf(handle: FakeFileHandle): Promise<number[]> {
  return Array.from(new Uint8Array(await (await handle.getFile()).arrayBuffer()));
}

describe('FsaBackupAdapter.backup', () => {
  test('単一セグメントは従来どおり直下に書く', async () => {
    const root = new FakeDirectoryHandle();
    const result = await adapterOn(root).backup(streamOf([1, 2]), 'aoiko-ledger-2026-07-28.zip');
    expect(result).toEqual({ fileName: 'aoiko-ledger-2026-07-28.zip' });
    expect(await bytesOf(root.files.get('aoiko-ledger-2026-07-28.zip')!)).toEqual([1, 2]);
  });

  test('ネストしたパスは途中のディレクトリを作って書く', async () => {
    const root = new FakeDirectoryHandle();
    const sha = 'a'.repeat(64);
    const result = await adapterOn(root).backup(streamOf([7, 8, 9]), `attachments/${sha}`);
    expect(result).toEqual({ fileName: `attachments/${sha}` });
    expect(root.files.size).toBe(0);
    expect(await bytesOf(root.dirs.get('attachments')!.files.get(sha)!)).toEqual([7, 8, 9]);
  });

  test('保存先の外を指すパスは書き込む前に拒否する', async () => {
    const root = new FakeDirectoryHandle();
    await expect(adapterOn(root).backup(streamOf([1]), '../escape.json')).rejects.toThrow(
      RangeError,
    );
    expect(root.dirs.size).toBe(0);
    expect(root.files.size).toBe(0);
  });
});

describe('FsaBackupAdapter.read', () => {
  test('ネストしたパスの中身を読める', async () => {
    const root = new FakeDirectoryHandle();
    const adapter = adapterOn(root);
    await adapter.backup(streamOf([4, 5, 6]), 'snapshots/2026-08-09T120000Z.json');
    const bytes = await adapter.read('snapshots/2026-08-09T120000Z.json');
    expect(Array.from(bytes!)).toEqual([4, 5, 6]);
  });
  // 同期が半分だけ進んだフォルダでは日常的に起きる。例外にすると復元が止まる。
  test('ファイルが無ければ null', async () => {
    const root = new FakeDirectoryHandle();
    await root.getDirectoryHandle('attachments', { create: true });
    expect(await adapterOn(root).read(`attachments/${'b'.repeat(64)}`)).toBeNull();
  });

  test('ディレクトリごと無くても null', async () => {
    expect(await adapterOn(new FakeDirectoryHandle()).read('attachments/x')).toBeNull();
  });
  // NotFoundError 以外まで null にすると、権限拒否や IO 失敗が「まだ同期されていない」
  // に化けて、古いスナップショットへ黙って退行する。
  test('NotFoundError 以外はそのまま投げる', async () => {
    const root = new FakeDirectoryHandle();
    root.failure = new DOMException('disk', 'NotReadableError');
    await expect(adapterOn(root).read('snapshots/a.json')).rejects.toThrow('disk');
  });

  test('許可が下りなければ null ではなく例外', async () => {
    const root = new FakeDirectoryHandle();
    root.permission = 'denied';
    await expect(adapterOn(root).read('snapshots/a.json')).rejects.toThrow(
      'フォルダへのアクセス許可が拒否されました',
    );
  });
});

describe('FsaBackupAdapter.list', () => {
  test('引数無しは直下のファイル名だけを返す（ディレクトリは含まない）', async () => {
    const root = new FakeDirectoryHandle();
    const adapter = adapterOn(root);
    await adapter.backup(streamOf([1]), 'aoiko-ledger-2026-07-28.zip');
    await adapter.backup(streamOf([1]), 'snapshots/2026-08-09T120000Z.json');
    expect(await adapter.list()).toEqual(['aoiko-ledger-2026-07-28.zip']);
  });

  test('subdir を渡すとその直下の名前だけを返す（パスではない）', async () => {
    const root = new FakeDirectoryHandle();
    const adapter = adapterOn(root);
    await adapter.backup(streamOf([1]), 'snapshots/2026-08-09T120000Z.json');
    await adapter.backup(streamOf([1]), 'snapshots/2026-08-08T120000Z.json');
    await adapter.backup(streamOf([1]), `attachments/${'c'.repeat(64)}`);
    expect((await adapter.list('snapshots')).sort()).toEqual([
      '2026-08-08T120000Z.json',
      '2026-08-09T120000Z.json',
    ]);
  });
  // 内容定址バックアップでは snapshots/attachments が並ぶため、「何件あるか」が
  // ディレクトリを誤って数えないことを保証する。
  test('直下にディレクトリがあってもファイルだけを返す', async () => {
    const root = new FakeDirectoryHandle();
    const adapter = adapterOn(root);
    await adapter.backup(streamOf([1]), 'aoiko-ledger-2026-07-28.zip');
    await root.getDirectoryHandle('snapshots', { create: true });
    await root.getDirectoryHandle('attachments', { create: true });
    expect(await adapter.list()).toEqual(['aoiko-ledger-2026-07-28.zip']);
  });

  test('subdir 配下にディレクトリがあってもファイルだけを返す', async () => {
    const root = new FakeDirectoryHandle();
    const adapter = adapterOn(root);
    await adapter.backup(streamOf([1]), 'snapshots/2026-08-09T120000Z.json');
    const snapshots = await root.getDirectoryHandle('snapshots', { create: true });
    await snapshots.getDirectoryHandle('nested', { create: true });
    expect(await adapter.list('snapshots')).toEqual(['2026-08-09T120000Z.json']);
  });
  // 一度もバックアップしていない同期フォルダでは attachments/ がまだ存在しない。
  test('ディレクトリが無ければ空配列', async () => {
    expect(await adapterOn(new FakeDirectoryHandle()).list('attachments')).toEqual([]);
  });

  test('NotFoundError 以外はそのまま投げる', async () => {
    const root = new FakeDirectoryHandle();
    root.failure = new DOMException('denied', 'NotAllowedError');
    await expect(adapterOn(root).list('attachments')).rejects.toThrow('denied');
  });

  test('フォルダ未設定なら空配列', async () => {
    expect(await adapterOn(null).list('attachments')).toEqual([]);
  });
});

describe('FsaBackupAdapter.remove', () => {
  test('ネストしたパスのファイルを消す（親ディレクトリは残す）', async () => {
    const root = new FakeDirectoryHandle();
    const adapter = adapterOn(root);
    const sha = 'd'.repeat(64);
    await adapter.backup(streamOf([1]), `attachments/${sha}`);
    await adapter.remove(`attachments/${sha}`);
    expect(root.dirs.get('attachments')!.files.has(sha)).toBe(false);
    expect(root.dirs.has('attachments')).toBe(true);
  });

  test('単一セグメントは従来どおり直下から消す', async () => {
    const root = new FakeDirectoryHandle();
    const adapter = adapterOn(root);
    await adapter.backup(streamOf([1]), 'aoiko-ledger-2026-07-01.zip');
    await adapter.remove('aoiko-ledger-2026-07-01.zip');
    expect(root.files.size).toBe(0);
  });
});
