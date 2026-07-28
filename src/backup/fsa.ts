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

  async backup(
    stream: ReadableStream<Uint8Array>,
    fileName: string,
  ): Promise<{ fileName: string }> {
    const h = await this.getHandle();
    if (!h) {
      throw new Error('バックアップフォルダが未設定です');
    }
    if (!(await this.ensurePermission())) {
      throw new Error('フォルダへのアクセス許可が拒否されました');
    }
    const fileHandle = await h.getFileHandle(fileName, { create: true });
    // pipeTo は成功時に書き込み先を close するため、明示的な close は不要。
    await stream.pipeTo(await fileHandle.createWritable());
    return { fileName };
  }

  async list(): Promise<string[]> {
    const h = await this.getHandle();
    if (!h) {
      return [];
    }
    if (!(await this.ensurePermission())) {
      return [];
    }
    const names: string[] = [];
    for await (const name of h.keys()) {
      names.push(name);
    }
    return names;
  }

  async remove(fileName: string): Promise<void> {
    const h = await this.getHandle();
    if (!h) {
      return;
    }
    await h.removeEntry(fileName);
  }
}
