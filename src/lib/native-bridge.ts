// ネイティブのシェル（Windows / macOS / iPadOS / iOS の app）が起動時に注入する橋渡し。
// ブラウザで開いたときは存在しないので、呼ぶ前に必ず関数の有無を見る。橋渡しの実装は
// シェル側が持ち、こちらは SDK を import しない。
//
// 能力ごとに optional にしてあるのは、シェル側の実装が段階的に増えるため。オブジェクトが
// あることと、目的の関数があることは別に確かめる。
export type NativeBridge = {
  // 保存ダイアログを出してファイルを書く。false は利用者が取り消したことを表す。
  saveFile?(
    data: Uint8Array<ArrayBuffer> | ReadableStream<Uint8Array>,
    filename: string,
  ): Promise<boolean>;
  // ネイティブのメニューへ今の表示言語を渡す。メニューは WebView の外にあり、
  // こちらのメッセージカタログを読めないため、シェル側が別の辞書を持っている。
  setUiLocale?(locale: string): Promise<void>;
  // 商店で売っている品目。価格を自前で組み立てないのは、配信先が 175 地域あって
  // 通貨も表記も地域ごとに違うため。商店が返した文字列をそのまま出す。
  // 品目 ID は商店ごとに違う（macOS と iOS で別）ので、こちら側は kind でしか呼ばない。
  listIapProducts?(): Promise<IapProduct[]>;
  // 購入。'pending' は「家族の承認待ち」等、その場で確定しない状態。
  purchaseIap?(kind: IapProductKind): Promise<IapPurchaseResult>;
  // 機種変更・再インストール後に、購入済みの非消耗型を取り戻す。
  // 戻り値は復元できた品目。消耗型（スタンプ）は対象外。
  restoreIapPurchases?(): Promise<IapProductKind[]>;
};

export type IapProductKind = 'tip' | 'supporter-badge';

export type IapProduct = {
  kind: IapProductKind;
  // 商店が返す表示用の価格文字列（現地通貨・現地表記）。
  displayPrice: string;
};

export type IapPurchaseResult = 'purchased' | 'cancelled' | 'pending';

export function nativeBridge(): NativeBridge | null {
  if (typeof window === 'undefined') {
    return null;
  }
  return (window as unknown as { __aoikoNative?: NativeBridge }).__aoikoNative ?? null;
}
