import type { BackupAdapter, BackupPayload } from './types';

type GetHandle = () => Promise<FileSystemDirectoryHandle | null>;
type SetHandle = (handle: FileSystemDirectoryHandle) => Promise<void>;

export class FsaBackupAdapter implements BackupAdapter {
  readonly name = 'fsa';

  constructor(private getHandle: GetHandle, private setHandle: SetHandle) {}

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

  async backup(payload: BackupPayload): Promise<{ fileName: string }> {
    const h = await this.getHandle();
    if (!h) {
      throw new Error('バックアップフォルダが未設定です');
    }
    if (!(await this.ensurePermission())) {
      throw new Error('フォルダへのアクセス許可が拒否されました');
    }
    const date = payload.exportedAt.slice(0, 10);
    const fileName = `aoiko-ledger-${date}.json`;
    const fileHandle = await h.getFileHandle(fileName, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(JSON.stringify(payload, null, 2));
    await writable.close();
    return { fileName };
  }
}