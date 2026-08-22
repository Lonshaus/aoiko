// navigator.onLine はブラウザの接続断定を返すだけ（キャプティブポータル等は検知しない）が、
// 「ネットワークエラー＝設定ミス」と誤解させないための一次判定としては十分。
export function isOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}
