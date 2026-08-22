import { splitBackupPath } from './content-store';
import { descendDir, isNotFoundError, listFileNames, resolveParent } from './fs-handle';
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

  async backup(stream: ReadableStream<Uint8Array>, path: string): Promise<{ fileName: string }> {
    const root = await navigator.storage.getDirectory();
    const { dir, name } = await resolveParent(root, path, true);
    // 当日分（複数回上書き可、無視で OK）
    const dailyHandle = await dir.getFileHandle(name, { create: true });
    await stream.pipeTo(await dailyHandle.createWritable());
    // 「最新」固定名のコピーは単層の zip 運用のためのもの。内容定址の blob まで複製すると
    // 中身が同じだけの重複が延々と増えるので、ネストしたパスでは作らない。
    if (name === path) {
      const ext = name.includes('.') ? name.slice(name.lastIndexOf('.')) : '';
      // 復元時に参照しやすいよう「最新」固定名のコピーも保持する。ReadableStream は
      // 一度しか読めず tee() は両者の読み出し速度差を吸収するため結局バッファするので、
      // ディスク上の当日分ファイルから直接コピーする（メモリに全体を乗せない）。
      const latestHandle = await root.getFileHandle(`aoiko-ledger-latest${ext}`, {
        create: true,
      });
      await (await dailyHandle.getFile()).stream().pipeTo(await latestHandle.createWritable());
    }
    return { fileName: path };
  }

  async list(subdir?: string): Promise<string[]> {
    const root = await navigator.storage.getDirectory();
    let dir = root;
    if (subdir !== undefined) {
      const segments = splitBackupPath(subdir);
      try {
        dir = await descendDir(root, segments, false);
      } catch (e) {
        if (isNotFoundError(e)) {
          return [];
        }
        throw e;
      }
    }
    return listFileNames(dir);
  }

  async read(path: string): Promise<Uint8Array<ArrayBuffer> | null> {
    const root = await navigator.storage.getDirectory();
    try {
      const { dir, name } = await resolveParent(root, path, false);
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
    const root = await navigator.storage.getDirectory();
    const { dir, name } = await resolveParent(root, path, false);
    await dir.removeEntry(name);
  }
}
