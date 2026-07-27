import type { BackupAdapter } from './types';
// Origin Private File System によるブラウザ内サンドボックス書き込み。
// FSA API 非対応（あるブラウザ / あるブラウザ / ある環境）の主要な永続化フォルバック。
// 同期フォルダではないため、ブラウザのデータ削除で失われる。
// 定期的な JSON ダウンロードでユーザーが iCloud 等に手動コピーする運用前提。
export class OpfsBackupAdapter implements BackupAdapter {
  readonly name = 'opfs';

  // getDirectory だけでは足りない。書き込みに使う createWritable は後から実装された
  // API で、あるブラウザ は getDirectory が 15.2、createWritable が 26。判定を getDirectory
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
  // OPFS は明示的なユーザー許可不要。永続化ストレージの要求は
  // アダプタ非依存の関心事なので BackupManager 側が一括で行う。
  async ensurePermission(): Promise<boolean> {
    return this.isAvailable();
  }

  async configure(): Promise<void> {
    await this.ensurePermission();
  }

  async backup(bytes: Uint8Array, fileName: string): Promise<{ fileName: string }> {
    const root = await navigator.storage.getDirectory();
    const ext = fileName.includes('.') ? fileName.slice(fileName.lastIndexOf('.')) : '';
    // 当日分（複数回上書き可、無視で OK）
    const dailyHandle = await root.getFileHandle(fileName, { create: true });
    const dailyWritable = await dailyHandle.createWritable();
    // TS の Uint8Array<ArrayBufferLike> vs FileSystemWriteChunkType の ArrayBuffer 限定の
    // 型不一致を吸収する（fflate の出力は ArrayBufferLike 型のまま）。
    await dailyWritable.write(bytes.slice());
    await dailyWritable.close();
    // 復元時に参照しやすいよう「最新」固定名のコピーも保持
    const latestHandle = await root.getFileHandle(`aoiko-ledger-latest${ext}`, {
      create: true,
    });
    const latestWritable = await latestHandle.createWritable();
    await latestWritable.write(bytes.slice());
    await latestWritable.close();

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
