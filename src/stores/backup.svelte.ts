import { liveQuery, type Subscription } from 'dexie';
import { db } from '../db/db';
import {
  FsaBackupAdapter,
  OpfsBackupAdapter,
  buildBackupZip,
  buildPayload,
  collectAttachmentBlobs,
  type BackupAdapter,
} from '../backup';
import { getSetting, setSetting } from '../lib/settings';
import { describeStorageError } from '../lib/storage-error';
import { selectExpiredBackups, shouldBackupNow } from '../backup/schedule';
import { todayISO } from '../lib/date';
import { saveFile } from '../lib/save-file';

async function buildBackupZipBytes(options: {
  includeApiKeys: boolean;
  includeFilerInfo: boolean;
}): Promise<Uint8Array> {
  const payload = await buildPayload(options);
  const attachmentBlobs = await collectAttachmentBlobs();
  return buildBackupZip(payload, attachmentBlobs);
}

export type BackupAdapterKind = 'fsa' | 'opfs' | 'none';

export type BackupStatus =
  | 'initializing'
  | 'unsupported'
  | 'unconfigured'
  | 'permission-required'
  | 'idle'
  | 'writing'
  | 'error';

const DEBOUNCE_MS = 1000;

class BackupManager {
  status = $state<BackupStatus>('initializing');
  adapterKind = $state<BackupAdapterKind>('none');
  folderName = $state<string | null>(null);
  lastBackupAt = $state<number | null>(null);
  lastDownloadAt = $state<number | null>(null);
  lastError = $state<string>('');
  // navigator.storage.persist() の結果。false ならブラウザは storage 逼迫時に
  // IndexedDB を勝手に破棄できる＝帳簿本体が消え得る。判定できない環境では null。
  storagePersisted = $state<boolean | null>(null);

  private adapter: BackupAdapter | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private subs: Subscription[] = [];
  private skipFirstAutoBackup = true;

  constructor() {
    void this.initAdapter();
    // 仕訳・明細・取引先・固定資産の変更を購読し、デバウンスでバックアップ
    this.subs.push(
      liveQuery(async () => ({
        e: await db.journalEntries.count(),
        l: await db.journalLines.count(),
        v: await db.vendors.count(),
        a: await db.fixedAssets.count(),
      })).subscribe({
        next: () => {
          if (this.skipFirstAutoBackup) {
            this.skipFirstAutoBackup = false;
            return;
          }
          this.scheduleBackup();
        },
        error: (e: unknown) => {
          this.lastError = e instanceof Error ? e.message : String(e);
          this.status = 'error';
        },
      }),
    );
  }

  // 永続化ストレージはアダプタに関係なく要求する。IndexedDB（帳簿本体）が
  // 破棄対象かどうかの話であり、FSA を使える環境でも同じく必要。
  private async requestPersistentStorage(): Promise<void> {
    if (typeof navigator === 'undefined' || !('storage' in navigator)) {
      return;
    }
    try {
      if (
        typeof navigator.storage.persisted === 'function' &&
        (await navigator.storage.persisted())
      ) {
        this.storagePersisted = true;
        return;
      }
      if (typeof navigator.storage.persist === 'function') {
        this.storagePersisted = await navigator.storage.persist();
      }
    } catch {
      // 判定できない環境では null のままにし、警告も出さない
    }
  }

  private async initAdapter(): Promise<void> {
    await this.requestPersistentStorage();
    const fsa = new FsaBackupAdapter(
      async () => (await getSetting('backupFolderHandle')) ?? null,
      async (h) => {
        await setSetting('backupFolderHandle', h);
        this.folderName = h.name;
      },
    );

    if (await fsa.isAvailable()) {
      this.adapter = fsa;
      this.adapterKind = 'fsa';
      await this.initFsa(fsa);
      return;
    }

    const opfs = new OpfsBackupAdapter();
    if (await opfs.isAvailable()) {
      this.adapter = opfs;
      this.adapterKind = 'opfs';
      await this.initOpfs(opfs);
      return;
    }

    this.status = 'unsupported';
  }

  private async initFsa(adapter: FsaBackupAdapter): Promise<void> {
    const handle = await getSetting('backupFolderHandle');
    if (!handle) {
      this.status = 'unconfigured';
      this.lastDownloadAt = (await getSetting('lastDownloadAt')) ?? null;
      return;
    }
    this.folderName = handle.name;
    this.lastBackupAt = (await getSetting('lastBackupAt')) ?? null;
    this.lastDownloadAt = (await getSetting('lastDownloadAt')) ?? null;
    const perm = await handle.queryPermission({ mode: 'readwrite' });
    this.status = perm === 'granted' ? 'idle' : 'permission-required';
    if (this.status === 'idle') {
      void this.maybeStartupBackup();
    }
  }

  private async initOpfs(adapter: OpfsBackupAdapter): Promise<void> {
    await adapter.ensurePermission();
    this.lastBackupAt = (await getSetting('lastBackupAt')) ?? null;
    this.lastDownloadAt = (await getSetting('lastDownloadAt')) ?? null;
    this.status = 'idle';
    void this.maybeStartupBackup();
  }

  async configure(): Promise<void> {
    if (this.adapterKind !== 'fsa' || !this.adapter) {
      return;
    }
    this.lastError = '';
    try {
      await this.adapter.configure();
      this.status = 'idle';
      await this.backup();
    } catch (e: unknown) {
      if (e instanceof DOMException && e.name === 'AbortError') {
        return;
      }
      this.lastError = e instanceof Error ? e.message : String(e);
      this.status = 'error';
    }
  }

  async grantPermission(): Promise<void> {
    if (!this.adapter) {
      return;
    }
    this.lastError = '';
    try {
      const ok = await this.adapter.ensurePermission();
      if (ok) {
        this.status = 'idle';
        await this.backup();
      } else {
        this.status = 'permission-required';
      }
    } catch (e: unknown) {
      this.lastError = e instanceof Error ? e.message : String(e);
      this.status = 'error';
    }
  }

  scheduleBackup(): void {
    if (this.status === 'unsupported' || this.status === 'unconfigured') {
      return;
    }
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      void this.maybeAutoBackup();
    }, DEBOUNCE_MS);
  }
  // データ変更による自動実行の入口。手動実行（backup()）は間隔設定に関係なく常に走らせる。
  private async maybeAutoBackup(): Promise<void> {
    const intervalHours = (await getSetting('backupIntervalHours')) ?? 0;
    if (!shouldBackupNow(this.lastBackupAt, Date.now(), intervalHours)) {
      return;
    }
    await this.backup();
  }
  // 起動時の取りこぼし回収。間隔を空けていると、最後に記帳した分が未保存のまま
  // アプリを閉じている場合があるため、経過していれば起動時に保存する。
  // 「変更のたび」設定では従来どおり、起動しただけでは保存しない。
  private async maybeStartupBackup(): Promise<void> {
    const intervalHours = (await getSetting('backupIntervalHours')) ?? 0;
    if (intervalHours === 0) {
      return;
    }
    if (!shouldBackupNow(this.lastBackupAt, Date.now(), intervalHours)) {
      return;
    }
    await this.backup();
  }
  // 日付入りの古いバックアップを保持件数まで減らす。
  // 呼ばれる時点でバックアップ本体は成功しているため、設定の読み取り失敗も含めて
  // 例外を外へ出さない。ここで throw すると成功した保存が失敗として表示されてしまう。
  private async pruneOldBackups(): Promise<void> {
    try {
      const keepCount = (await getSetting('backupRetentionCount')) ?? 0;
      if (keepCount === 0 || !this.adapter) {
        return;
      }
      const expired = selectExpiredBackups(await this.adapter.list(), keepCount);
      for (const fileName of expired) {
        await this.adapter.remove(fileName);
      }
    } catch (e: unknown) {
      this.lastError = e instanceof Error ? e.message : String(e);
    }
  }

  // 「全データ削除」から呼ぶ。OPFS のバックアップは帳簿と証憑写真の完全な複製で
  // ありながら、利用者が ファイル管理 / ファイル管理から見ることも消すこともできない。
  // IndexedDB だけ消して放置すると、譲渡・廃棄した端末に帳簿が丸ごと残る。
  // FSA の保存先は利用者自身のフォルダなので、こちらからは消さない。
  async clearStoredBackups(): Promise<void> {
    if (this.adapterKind !== 'opfs' || !this.adapter) {
      return;
    }
    for (const fileName of await this.adapter.list()) {
      await this.adapter.remove(fileName);
    }
  }

  async backup(): Promise<void> {
    if (!this.adapter) {
      return;
    }
    if (this.status === 'unsupported' || this.status === 'unconfigured') {
      return;
    }
    if (this.status === 'writing') {
      return;
    }
    const prev = this.status;
    this.status = 'writing';
    try {
      const includeApiKeys = (await getSetting('backupIncludeApiKeys')) ?? false;
      const includeFilerInfo = (await getSetting('backupIncludeFilerInfo')) ?? false;
      const bytes = await buildBackupZipBytes({ includeApiKeys, includeFilerInfo });
      const fileName = `aoiko-ledger-${todayISO()}.zip`;
      await this.adapter.backup(bytes, fileName);
      this.lastBackupAt = Date.now();
      await setSetting('lastBackupAt', this.lastBackupAt);
      this.lastError = '';
      // 汰換が終わるまで status は 'writing' のままにする。先に 'idle' へ戻すと
      // デバウンス経由の次のバックアップが再入ガードをすり抜けて並走する。
      await this.pruneOldBackups();
      this.status = 'idle';
    } catch (e: unknown) {
      this.lastError = describeStorageError(e);
      this.status = prev === 'permission-required' ? 'permission-required' : 'error';
    }
  }
  // ブラウザのダウンロード機能でユーザーの「ダウンロード」フォルダへ zip を書き出す
  // （帳簿データ + 証憑写真原本を同梱）。全環境で動作。
  // OPFS 使用環境では iCloud Drive 等への手動コピーの起点となる。
  async downloadBackup(): Promise<void> {
    this.lastError = '';
    try {
      const includeApiKeys = (await getSetting('backupIncludeApiKeys')) ?? false;
      const includeFilerInfo = (await getSetting('backupIncludeFilerInfo')) ?? false;
      const bytes = await buildBackupZipBytes({ includeApiKeys, includeFilerInfo });
      await saveFile(bytes, `aoiko-ledger-${todayISO()}.zip`, 'application/zip');
      this.lastDownloadAt = Date.now();
      await setSetting('lastDownloadAt', this.lastDownloadAt);
    } catch (e: unknown) {
      this.lastError = e instanceof Error ? e.message : String(e);
    }
  }
}

export const backup = new BackupManager();
