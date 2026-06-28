import { liveQuery, type Subscription } from 'dexie';
import { db } from '../db/db';
import {
  FsaBackupAdapter,
  OpfsBackupAdapter,
  buildPayload,
  type BackupAdapter,
} from '../backup';
import { getSetting, setSetting } from '../lib/settings';
import { todayISO } from '../lib/date';

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
      })
    );
  }

  private async initAdapter(): Promise<void> {
    const fsa = new FsaBackupAdapter(
      async () => (await getSetting('backupFolderHandle')) ?? null,
      async (h) => {
        await setSetting('backupFolderHandle', h);
        this.folderName = h.name;
      }
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
  }

  private async initOpfs(adapter: OpfsBackupAdapter): Promise<void> {
    await adapter.ensurePermission();
    this.lastBackupAt = (await getSetting('lastBackupAt')) ?? null;
    this.lastDownloadAt = (await getSetting('lastDownloadAt')) ?? null;
    this.status = 'idle';
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
      void this.backup();
    }, DEBOUNCE_MS);
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
      const payload = await buildPayload({ includeApiKeys, includeFilerInfo });
      await this.adapter.backup(payload);
      this.lastBackupAt = Date.now();
      await setSetting('lastBackupAt', this.lastBackupAt);
      this.lastError = '';
      this.status = 'idle';
    } catch (e: unknown) {
      this.lastError = e instanceof Error ? e.message : String(e);
      this.status = prev === 'permission-required' ? 'permission-required' : 'error';
    }
  }
  // ブラウザのダウンロード機能でユーザーの「ダウンロード」フォルダへ JSON を書き出す。
  // 全環境で動作。OPFS 使用環境では iCloud Drive 等への手動コピーの起点となる。
  async downloadJson(): Promise<void> {
    this.lastError = '';
    try {
      const includeApiKeys = (await getSetting('backupIncludeApiKeys')) ?? false;
      const includeFilerInfo = (await getSetting('backupIncludeFilerInfo')) ?? false;
      const payload = await buildPayload({ includeApiKeys, includeFilerInfo });
      const json = JSON.stringify(payload, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `aoiko-ledger-${todayISO()}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      this.lastDownloadAt = Date.now();
      await setSetting('lastDownloadAt', this.lastDownloadAt);
    } catch (e: unknown) {
      this.lastError = e instanceof Error ? e.message : String(e);
    }
  }
}

export const backup = new BackupManager();