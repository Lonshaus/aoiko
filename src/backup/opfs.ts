import type { BackupAdapter } from './types';
// FSA API 非対応（Safari / Firefox / iOS）向けのフォルバック。同期フォルダではないので
// ブラウザのデータ削除で失われる——端末外へ出すには手動ダウンロードが要る。
export class OpfsBackupAdapter implements BackupAdapter {
  readonly name = 'opfs';
  // getDirectory だけでは足りない。書き込みに使う createWritable は後から実装された
  // API で、Safari は getDirectory が 15.2、createWritable が 26。判定を getDirectory
  // だけにすると、書けない環境で status が idle のまま「動いているように見えて一度も
  // 保存されない」状態になる。
  async isAvailable(): Promise<boolean> {
    return (
      typeof navigator !== 'undefined' &&
      'storage' in navigator &&
      typeof navigator.storage.getDirectory === 'function' &&
      typeof FileSystemFileHandle !== 'undefined' &&
      typeof FileSystemFileHandle.prototype.createWritable === 'function'
    );
  }

  async isReady(): Promise<boolean> {
    return this.isAvailable();
  }
  // OPFS は利用者の許可が要らない。永続化ストレージの要求は BackupManager 側が一括で行う。
  async ensurePermission(): Promise<boolean> {
    return this.isAvailable();
  }

  async configure(): Promise<void> {
    await this.ensurePermission();
  }

  async backup(
    stream: ReadableStream<Uint8Array>,
    fileName: string,
  ): Promise<{ fileName: string }> {
    const root = await navigator.storage.getDirectory();
    const ext = fileName.includes('.') ? fileName.slice(fileName.lastIndexOf('.')) : '';
    // 当日分（複数回上書き可、無視で OK）
    const dailyHandle = await root.getFileHandle(fileName, { create: true });
    await stream.pipeTo(await dailyHandle.createWritable());
    // 「最新」固定名のコピーも置く。ReadableStream は一度しか読めず、tee() は速度差を
    // 吸収するため結局バッファするので、ディスク上の当日分から直接コピーする。
    const latestHandle = await root.getFileHandle(`aoiko-ledger-latest${ext}`, {
      create: true,
    });
    await (await dailyHandle.getFile()).stream().pipeTo(await latestHandle.createWritable());

    return { fileName };
  }

  async list(): Promise<string[]> {
    const root = await navigator.storage.getDirectory();
    const names: string[] = [];
    for await (const name of root.keys()) {
      names.push(name);
    }
    return names;
  }

  async remove(fileName: string): Promise<void> {
    const root = await navigator.storage.getDirectory();
    await root.removeEntry(fileName);
  }
}
