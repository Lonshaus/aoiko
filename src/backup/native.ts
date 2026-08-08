import type { BackupAdapter } from './types';
// wrapper 版が注入するネイティブのフォルダ書き込み。
//
// WKWebView に showDirectoryPicker は無く、今後も入らない（WebKit の standards-positions#28
// が oppose でクローズ済み）。web API に頼る限り Apple 側は同期フォルダへ自動書き出しできない。
//
// SDK は import せず window.__aoikoNative 経由で呼ぶ——公開 repo の依存を増やさないため。
interface NativeBackupBridge {
  // 取り消しは null。token は端末固有の不透明文字列で、中身は wrapper 側の都合で決まる。
  // web 側は保管して渡し直すだけで、解釈しない。
  backupChooseFolder(): Promise<{ token: string; name: string } | null>;
  backupIsReady(token: string): Promise<boolean>;
  // ReadableStream をそのまま渡す。plugin-fs の writeFile が open() + 逐次 write() へ
  // 切り替えるため、証憑写真込みの zip 全体をメモリに載せずに済む。
  backupWrite(token: string, fileName: string, data: ReadableStream<Uint8Array>): Promise<void>;
  backupList(token: string): Promise<string[]>;
  backupRemove(token: string, fileName: string): Promise<void>;
}

export interface NativeBackupFolder {
  token: string;
  name: string;
}

type GetFolder = () => Promise<NativeBackupFolder | null>;
type SetFolder = (folder: NativeBackupFolder) => Promise<void>;

export type NativeBackupState = 'idle' | 'unconfigured' | 'reconfigure-required';
// 起動時の状態判定。reconfigure-required を unconfigured と取り違えると、利用者は設定済みの
// つもりのまま一度も保存されなくなる。試せるよう判定だけ純粋関数に切り出してある。
export function decideNativeState(input: {
  hasFolder: boolean;
  hasLegacyHandle: boolean;
  ready: boolean;
}): NativeBackupState {
  if (!input.hasFolder) {
    // FSA の handle しか無い ＝ wrapper 版へ移ってきた既存利用者。未設定と区別する。
    return input.hasLegacyHandle ? 'reconfigure-required' : 'unconfigured';
  }
  return input.ready ? 'idle' : 'reconfigure-required';
}

function bridge(): NativeBackupBridge | null {
  if (typeof window === 'undefined') {
    return null;
  }
  const api = (window as unknown as { __aoikoNative?: Partial<NativeBackupBridge> }).__aoikoNative;
  return typeof api?.backupChooseFolder === 'function' ? (api as NativeBackupBridge) : null;
}

export class NativeFolderBackupAdapter implements BackupAdapter {
  readonly name = 'native';

  constructor(
    private getFolder: GetFolder,
    private setFolder: SetFolder,
  ) {}

  async isAvailable(): Promise<boolean> {
    return bridge() !== null;
  }

  async isReady(): Promise<boolean> {
    const api = bridge();
    const folder = await this.getFolder();
    if (!api || !folder) {
      return false;
    }
    return api.backupIsReady(folder.token);
  }
  // ネイティブ側には「選び直す」以外に権限を取り戻す手段が無い。bookmark の解決失敗も
  // フォルダの移動・削除も回復動線は同じなので configure に一本化する。
  async ensurePermission(): Promise<boolean> {
    return this.isReady();
  }

  async configure(): Promise<void> {
    const api = bridge();
    if (!api) {
      throw new Error('ネイティブのフォルダ選択が利用できません');
    }
    const chosen = await api.backupChooseFolder();
    if (!chosen) {
      // 取り消しを FSA と同じ形で返す。呼出元（backup.svelte.ts）は AbortError を
      // 「利用者が選択をやめた」として無視するため、状態遷移を共通にできる。
      throw new DOMException('フォルダ選択が取り消されました', 'AbortError');
    }
    await this.setFolder(chosen);
  }

  async backup(
    stream: ReadableStream<Uint8Array>,
    fileName: string,
  ): Promise<{ fileName: string }> {
    const api = bridge();
    const folder = await this.getFolder();
    if (!api || !folder) {
      throw new Error('バックアップフォルダが未設定です');
    }
    await api.backupWrite(folder.token, fileName, stream);
    return { fileName };
  }

  async list(): Promise<string[]> {
    const api = bridge();
    const folder = await this.getFolder();
    if (!api || !folder) {
      return [];
    }
    return api.backupList(folder.token);
  }

  async remove(fileName: string): Promise<void> {
    const api = bridge();
    const folder = await this.getFolder();
    if (!api || !folder) {
      return;
    }
    await api.backupRemove(folder.token, fileName);
  }
}
