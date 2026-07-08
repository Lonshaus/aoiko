import type { BackupAdapter } from './types';
// Origin Private File System によるブラウザ内サンドボックス書き込み。
// FSA API 非対応（Safari / Firefox / iOS）の主要な永続化フォルバック。
// 同期フォルダではないため、ブラウザのデータ削除で失われる。
// 定期的な JSON ダウンロードでユーザーが iCloud 等に手動コピーする運用前提。
export class OpfsBackupAdapter implements BackupAdapter {
  readonly name = 'opfs';

  async isAvailable(): Promise<boolean> {
    return (
      typeof navigator !== 'undefined' &&
      'storage' in navigator &&
      typeof navigator.storage.getDirectory === 'function'
    );
  }

  async isReady(): Promise<boolean> {
    return this.isAvailable();
  }
  // OPFS は明示的なユーザー許可不要
  async ensurePermission(): Promise<boolean> {
    if (!(await this.isAvailable())) return false;
    if (typeof navigator.storage.persist === 'function') {
      try {
        await navigator.storage.persist();
      } catch {
        // 既に persist 済 or 拒否された場合も処理続行
      }
    }
    return true;
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
}