// ネイティブのシェルが起動時に注入する橋渡し。
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
};

export function nativeBridge(): NativeBridge | null {
  if (typeof window === 'undefined') {
    return null;
  }
  return (window as unknown as { __aoikoNative?: NativeBridge }).__aoikoNative ?? null;
}
