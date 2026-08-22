import { splitBackupPath } from './content-store';
import { descendDir, isNotFoundError, listFileNames, resolveParent } from './fs-handle';
import type { BackupAdapter } from './types';

type GetHandle = () => Promise<FileSystemDirectoryHandle | null>;
type SetHandle = (handle: FileSystemDirectoryHandle) => Promise<void>;

export class FsaBackupAdapter implements BackupAdapter {
  readonly name = 'fsa';

  constructor(
    private getHandle: GetHandle,
    private setHandle: SetHandle,
  ) {}

  async isAvailable(): Promise<boolean> {
    return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
  }

  async isReady(): Promise<boolean> {
    const h = await this.getHandle();
    if (!h) {
      return false;
    }
    const perm = await h.queryPermission({ mode: 'readwrite' });
    return perm === 'granted';
  }
  // ユーザージェスチャー直後に呼ぶこと（許可ダイアログを表示する）
  async ensurePermission(): Promise<boolean> {
    const h = await this.getHandle();
    if (!h) {
      return false;
    }
    let perm = await h.queryPermission({ mode: 'readwrite' });
    if (perm === 'granted') {
      return true;
    }
    perm = await h.requestPermission({ mode: 'readwrite' });
    return perm === 'granted';
  }

  async configure(): Promise<void> {
    const handle = await window.showDirectoryPicker({
      mode: 'readwrite',
      id: 'aoiko-backup',
    });
    await this.setHandle(handle);
  }

  async backup(stream: ReadableStream<Uint8Array>, path: string): Promise<{ fileName: string }> {
    const h = await this.getHandle();
    if (!h) {
      throw new Error('バックアップフォルダが未設定です');
    }
    if (!(await this.ensurePermission())) {
      throw new Error('フォルダへのアクセス許可が拒否されました');
    }
    const { dir, name } = await resolveParent(h, path, true);
    const fileHandle = await dir.getFileHandle(name, { create: true });
    // pipeTo は成功時に書き込み先を close するため、明示的な close は不要。
    await stream.pipeTo(await fileHandle.createWritable());
    return { fileName: path };
  }

  async list(subdir?: string): Promise<string[]> {
    const h = await this.getHandle();
    if (!h) {
      return [];
    }
    if (!(await this.ensurePermission())) {
      return [];
    }
    let dir = h;
    if (subdir !== undefined) {
      const segments = splitBackupPath(subdir);
      try {
        dir = await descendDir(h, segments, false);
      } catch (e) {
        if (isNotFoundError(e)) {
          return [];
        }
        throw e;
      }
    }
    return listFileNames(dir);
  }
  // 権限拒否は例外のまま返す。null は「まだ同期されていない」を表すので、
  // アクセスできない状態と取り違えると古いスナップショットへ黙って退行する。
  async read(path: string): Promise<Uint8Array<ArrayBuffer> | null> {
    const h = await this.getHandle();
    if (!h) {
      throw new Error('バックアップフォルダが未設定です');
    }
    if (!(await this.ensurePermission())) {
      throw new Error('フォルダへのアクセス許可が拒否されました');
    }
    try {
      const { dir, name } = await resolveParent(h, path, false);
      const file = await (await dir.getFileHandle(name)).getFile();
      return new Uint8Array(await file.arrayBuffer());
    } catch (e) {
      if (isNotFoundError(e)) {
        return null;
      }
      throw e;
    }
  }

  async remove(path: string): Promise<void> {
    const h = await this.getHandle();
    if (!h) {
      return;
    }
    const { dir, name } = await resolveParent(h, path, false);
    await dir.removeEntry(name);
  }
}
