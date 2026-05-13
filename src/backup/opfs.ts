import type { BackupAdapter, BackupPayload } from './types';
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

  async backup(payload: BackupPayload): Promise<{ fileName: string }> {
    const root = await navigator.storage.getDirectory();
    const date = payload.exportedAt.slice(0, 10);
    const dailyName = `aoiko-ledger-${date}.json`;
    const json = JSON.stringify(payload, null, 2);
    // 当日分（複数回上書き可、無視で OK）
    const dailyHandle = await root.getFileHandle(dailyName, { create: true });
    const dailyWritable = await dailyHandle.createWritable();
    await dailyWritable.write(json);
    await dailyWritable.close();
    // 復元時に参照しやすいよう「最新」固定名のコピーも保持
    const latestHandle = await root.getFileHandle('aoiko-ledger-latest.json', {
      create: true,
    });
    const latestWritable = await latestHandle.createWritable();
    await latestWritable.write(json);
    await latestWritable.close();

    return { fileName: dailyName };
  }
}