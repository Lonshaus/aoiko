import { liveQuery, type Subscription } from 'dexie';
import { db } from '../db/db';
import {
  ATTACHMENT_DIR,
  FsaBackupAdapter,
  NativeFolderBackupAdapter,
  OpfsBackupAdapter,
  SNAPSHOT_DIR,
  decideNativeState,
  buildBackupZipStream,
  buildPayload,
  iterateAttachmentBlobs,
  iterateAttachmentSources,
  pruneSnapshots,
  readLatestSnapshot,
  writeLooseBackup,
  type BackupAdapter,
  type FolderRestoreSource,
} from '../backup';
import { deleteSetting, getSetting, setSetting } from '../lib/settings';
import { describeStorageError } from '../lib/storage-error';
import { daysSince, needsOffsiteBackupWarning, shouldBackupNow } from '../backup/schedule';
import { todayISO } from '../lib/date';
import { saveFile } from '../lib/save-file';

async function backupZipStream(options: {
  includeApiKeys: boolean;
  includeFilerInfo: boolean;
}): Promise<ReadableStream<Uint8Array>> {
  const payload = await buildPayload(options);
  return buildBackupZipStream(payload, iterateAttachmentBlobs());
}

type BackupAdapterKind = 'native' | 'fsa' | 'opfs' | 'none';

type BackupStatus =
  | 'initializing'
  | 'unsupported'
  | 'unconfigured'
  // 保存先が失われ、選び直す以外に回復手段が無い状態。FSA 時代の handle しか無い
  // wrapper 版と、ある環境 の bookmark が失効した場合の両方で使う（回復動線が同じため）。
  | 'reconfigure-required'
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
  // writing 中に来た要求を1件だけ覚えておき、書込完了後に追い掛けて再実行する
  private backupPending = false;

  constructor() {
    // 初期化が落ちたまま 'initializing' に留まると、表示は「初期化中…」のままなのに
    // scheduleBackup / backup() はその状態を弾かないため、保存要求だけが走り続けて
    // 毎回失敗する。アダプタ側の不調（ネイティブ層の IPC 失敗・権限拒否等）を
    // 利用者に見える形へ落とす。
    void this.initAdapter().catch((e: unknown) => {
      this.lastError = describeStorageError(e);
      this.status = 'error';
    });
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
    // web view に showDirectoryPicker は無いため、wrapper 版はネイティブ層を先に見る。
    // これが無いと ある環境 / ある環境 / ある環境 の app は opfs 止まりになり、同期フォルダへの
    // 自動書き出しに到達できない。
    const native = new NativeFolderBackupAdapter(
      async () => (await getSetting('nativeBackupFolder')) ?? null,
      async (folder) => {
        await setSetting('nativeBackupFolder', folder);
        this.folderName = folder.name;
        // FSA 時代の handle は用済み。残すと次回起動でも再選択を促し続ける。
        await deleteSetting('backupFolderHandle');
      },
    );

    if (await native.isAvailable()) {
      this.adapter = native;
      this.adapterKind = 'native';
      await this.initNative(native);
      return;
    }

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

  private async initNative(adapter: NativeFolderBackupAdapter): Promise<void> {
    const folder = await getSetting('nativeBackupFolder');
    // FSA 時代の handle は名前しか使えない（ネイティブ層からは読めない）。どのフォルダ
    // だったかを名指しして選び直しを促すためだけに拾う。
    const legacy = folder ? null : ((await getSetting('backupFolderHandle')) ?? null);
    this.lastBackupAt = (await getSetting('lastBackupAt')) ?? null;
    this.lastDownloadAt = (await getSetting('lastDownloadAt')) ?? null;
    this.folderName = folder?.name ?? legacy?.name ?? null;
    // token が解決できない場合（ある環境 の bookmark 失効・フォルダの削除や移動）も、ネイティブ層に
    // 権限を取り直す手段は無く回復は選び直しだけ。permission-required には倒さない。
    this.status = decideNativeState({
      hasFolder: folder !== null && folder !== undefined,
      hasLegacyHandle: legacy !== null,
      ready: await adapter.isReady(),
    });
    if (this.status === 'idle') {
      void this.maybeStartupBackup();
    }
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
    if ((this.adapterKind !== 'fsa' && this.adapterKind !== 'native') || !this.adapter) {
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
    if (
      this.status === 'unsupported' ||
      this.status === 'unconfigured' ||
      this.status === 'reconfigure-required'
    ) {
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
  // 古いスナップショットを保持件数まで減らす。証憑写真の実体は消さない（内容定址で、
  // 消した版以外からも参照され得るため。参照されなくなった実体の掃除は別立て）。
  // 呼ばれる時点でバックアップ本体は成功しているため、設定の読み取り失敗も含めて
  // 例外を外へ出さない。ここで throw すると成功した保存が失敗として表示されてしまう。
  private async pruneOldBackups(): Promise<void> {
    try {
      const keepCount = (await getSetting('backupRetentionCount')) ?? 0;
      if (keepCount === 0 || !this.adapter) {
        return;
      }
      await pruneSnapshots(this.adapter, keepCount);
    } catch (e: unknown) {
      this.lastError = e instanceof Error ? e.message : String(e);
    }
  }
  // 復元画面から使う。保存先の握りは manager が持ったままにしたいのでアダプタは外へ出さない。
  async readLatestSnapshot(): Promise<FolderRestoreSource | null> {
    if (!this.adapter || !this.canRead) {
      return null;
    }
    return readLatestSnapshot(this.adapter);
  }
  // 保存先が確定していて読み書きできる状態か。
  get canRead(): boolean {
    return (
      this.status !== 'initializing' &&
      this.status !== 'unsupported' &&
      this.status !== 'unconfigured' &&
      this.status !== 'reconfigure-required'
    );
  }
  // 「全データ削除」から呼ぶ。OPFS のバックアップは帳簿と証憑写真の完全な複製で
  // ありながら、利用者が ファイル管理 / ファイル管理から見ることも消すこともできない。
  // IndexedDB だけ消して放置すると、譲渡・廃棄した端末に帳簿が丸ごと残る。
  // FSA・ネイティブの保存先は利用者自身が選んだフォルダなので、こちらからは消さない。
  async clearStoredBackups(): Promise<void> {
    if (this.adapterKind !== 'opfs' || !this.adapter) {
      return;
    }
    for (const subdir of [SNAPSHOT_DIR, ATTACHMENT_DIR]) {
      for (const fileName of await this.adapter.list(subdir)) {
        await this.adapter.remove(`${subdir}/${fileName}`);
      }
    }
    // 直下には散ファイル以前に書いた zip が残っている。帳簿と証憑写真の完全な複製な
    // ので、これも消さないと「全データ削除」の意味が無くなる。
    for (const fileName of await this.adapter.list()) {
      await this.adapter.remove(fileName);
    }
  }

  async backup(): Promise<void> {
    if (!this.adapter) {
      return;
    }
    if (
      this.status === 'unsupported' ||
      this.status === 'unconfigured' ||
      this.status === 'reconfigure-required'
    ) {
      return;
    }
    if (this.status === 'writing') {
      // 進行中の書込みが終わったら1回だけ追い掛ける。複数件来ても1回に合流させる。
      // scheduleBackup は間隔判定を挟まずここへ来るため、これが無いと圧縮中の
      // 保存はどのバックアップにも入らないまま捨てられる。
      this.backupPending = true;
      return;
    }
    const prev = this.status;
    // ループで追い掛ける（再帰だと高速な保存の連打でスタックが伸びる）。
    // 失敗時はループを抜ける ＝ 失敗中のアダプタへ再突入して空回りしない。
    do {
      this.backupPending = false;
      this.status = 'writing';
      try {
        const includeApiKeys = (await getSetting('backupIncludeApiKeys')) ?? false;
        const includeFilerInfo = (await getSetting('backupIncludeFilerInfo')) ?? false;
        // zip を作り直さず、変わった分だけ書く。証憑写真は中身が同じなら 1 つしか置かない
        // ので、写真が増えても毎回の同期量は帳簿本体＋新しい写真だけで済む（#397）。
        const payload = await buildPayload({ includeApiKeys, includeFilerInfo });
        await writeLooseBackup(this.adapter, payload, iterateAttachmentSources());
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
        return;
      }
    } while (this.backupPending);
  }
  private async stampDownloadedNow(): Promise<void> {
    this.lastDownloadAt = Date.now();
    await setSetting('lastDownloadAt', this.lastDownloadAt);
  }
  // <a download> 経路（あるブラウザ / あるブラウザ）は保存できたか観測できないため、利用者に
  // 「保存できましたか？」の確認を出した後にこちらを呼んで刻む（issue#390）。
  async confirmDownloadSaved(): Promise<void> {
    await this.stampDownloadedNow();
  }
  // ブラウザのダウンロード機能でユーザーの「ダウンロード」フォルダへ zip を書き出す
  // （帳簿データ + 証憑写真原本を同梱）。全環境で動作。
  // OPFS 使用環境では iCloud Drive 等への手動コピーの起点となる。
  //
  // 戻り値は「利用者に保存できたか確かめる必要があるか」。true のときだけ呼出側は
  // 確認ダイアログを出し、答えが来たら confirmDownloadSaved() を呼ぶ。それ以外の結果
  // （成功・取消・失敗）は lastDownloadAt / lastError に既に反映されている。
  async downloadBackup(): Promise<boolean> {
    this.lastError = '';
    // 「保存できたか聞くべきか」はダウンロードを押した時点の警告表示状態で決める。
    // 刻んだ後に判定すると、既に刻んだ時刻のせいで warning が偽になってしまう。
    const daysSinceDownload = daysSince(this.lastDownloadAt);
    const warningWasShowing = needsOffsiteBackupWarning(
      this.adapterKind,
      this.status,
      daysSinceDownload,
    );
    try {
      // zip の組み立ては saveFile が保存先を確定させた後に走らせる。先にやると
      // showSaveFilePicker のユーザー操作の有効時間が切れる（issue#386）。
      const result = await saveFile(
        async () => {
          const includeApiKeys = (await getSetting('backupIncludeApiKeys')) ?? false;
          const includeFilerInfo = (await getSetting('backupIncludeFilerInfo')) ?? false;
          return backupZipStream({ includeApiKeys, includeFilerInfo });
        },
        `aoiko-ledger-${todayISO()}.zip`,
        'application/zip',
        { confirmCompletion: true },
      );
      // 取り消した場合に時刻を刻むと、書き出されていないバックアップのために
      // 「端末外バックアップがありません」の警告が抑止されてしまう。
      if (result === 'cancelled') {
        return false;
      }
      if (result === 'saved') {
        await this.stampDownloadedNow();
        return false;
      }
      // result === 'unknown'（<a download> 経路）。警告が出ていなければ取り違えても
      // 実害が無いので黙って刻む。抑止設定があれば従来どおり無条件に刻む。
      const skipConfirm = (await getSetting('skipDownloadSavedConfirm')) ?? false;
      if (!warningWasShowing || skipConfirm) {
        await this.stampDownloadedNow();
        return false;
      }
      return true;
    } catch (e: unknown) {
      this.lastError = e instanceof Error ? e.message : String(e);
      return false;
    }
  }
}

export const backup = new BackupManager();
