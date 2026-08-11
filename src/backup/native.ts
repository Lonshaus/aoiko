import { splitBackupPath } from './content-store';
import type { BackupAdapter } from './types';
// wrapper 版（ある環境 / ある環境 / ある環境 / ある環境）が注入するネイティブのフォルダ書き込み。
//
// web view に showDirectoryPicker は無く、今後も入らない（web view の standards-positions#28
// が oppose でクローズ済み、preference も存在しない）。web API に頼る限り一部の環境の app は
// 同期フォルダへの自動書き出しに到達できないため、選択と書き込みをネイティブへ出す。
//
// ネイティブ層の SDK は import せず、wrapper 側が束ねて注入する window.__aoikoNative 経由で
// 呼ぶ。公開 repo の依存を増やさないため（save-file の差し替えと同じ方針）。
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
  // 内容定址バックアップ用。wrapper 側が未実装のため optional にしてあり、
  // 呼び出し側は関数の有無で能力を判定する（別スライスで wrapper へ追加する）。
  // 見つからないファイルは wrapper 側で null にする。IO 失敗は例外のまま。
  backupRead?(token: string, path: string): Promise<Uint8Array<ArrayBuffer> | null>;
  backupListDir?(token: string, subdir: string): Promise<string[]>;
}

export interface NativeBackupFolder {
  token: string;
  name: string;
}

type GetFolder = () => Promise<NativeBackupFolder | null>;
type SetFolder = (folder: NativeBackupFolder) => Promise<void>;

export type NativeBackupState = 'idle' | 'unconfigured' | 'reconfigure-required';
// 起動時にどの状態から始めるかの判定。BackupManager はモジュール読込時に生成される
// singleton で単体テストしづらいが、ここを間違えると「自動バックアップが黙って止まる」に
// 直結する（reconfigure-required を取り違えて unconfigured にすると、利用者は設定済みの
// つもりのまま保存されなくなる）。判定だけ純粋関数に切り出して確かめられるようにする。
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

// backupWrite / backupRemove はファイル名だけを受け取る。スラッシュ入りの名前を
// そのまま渡すと wrapper 側が何を作るか保証できないため、ここで止める。
function requireFlatPath(path: string, method: string): void {
  if (splitBackupPath(path).length > 1) {
    throw new Error(`ネイティブ側の ${method} はサブフォルダに未対応です: ${path}`);
  }
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
  // ネイティブ側には「選び直す」以外に権限を取り戻す手段が無い。ある環境 の bookmark が
  // 解決できなくなった場合も、フォルダを移動・削除された場合も回復動線は同じなので、
  // 権限の再取得を独立した操作にはせず configure に一本化する。
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

  async backup(stream: ReadableStream<Uint8Array>, path: string): Promise<{ fileName: string }> {
    requireFlatPath(path, 'backupWrite');
    const api = bridge();
    const folder = await this.getFolder();
    if (!api || !folder) {
      throw new Error('バックアップフォルダが未設定です');
    }
    await api.backupWrite(folder.token, path, stream);
    return { fileName: path };
  }

  async list(subdir?: string): Promise<string[]> {
    const api = bridge();
    const folder = await this.getFolder();
    if (!api || !folder) {
      return [];
    }
    if (subdir === undefined) {
      return api.backupList(folder.token);
    }
    splitBackupPath(subdir);
    if (typeof api.backupListDir !== 'function') {
      throw new Error('ネイティブ側の backupListDir が未実装のため、サブフォルダを一覧できません');
    }
    return api.backupListDir(folder.token, subdir);
  }
  // 能力が無いことを null で返さない。「まだ同期されていない」と区別できなくなり、
  // 読めるはずのスナップショットを黙って捨てることになる。
  async read(path: string): Promise<Uint8Array<ArrayBuffer> | null> {
    splitBackupPath(path);
    const api = bridge();
    const folder = await this.getFolder();
    if (!api || !folder) {
      throw new Error('バックアップフォルダが未設定です');
    }
    if (typeof api.backupRead !== 'function') {
      throw new Error('ネイティブ側の backupRead が未実装のため、バックアップを読み出せません');
    }
    return api.backupRead(folder.token, path);
  }

  async remove(path: string): Promise<void> {
    requireFlatPath(path, 'backupRemove');
    const api = bridge();
    const folder = await this.getFolder();
    if (!api || !folder) {
      return;
    }
    await api.backupRemove(folder.token, path);
  }
}
