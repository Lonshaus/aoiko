// クロスオリジンのスクリプト例外は、ブラウザが内容を伏せて `Script error.` だけを渡す。
// 何が起きたか分からず利用者にできることも無いので、エラーバナーの対象から外す。
// 共有シートを開くだけでこの形の error を投げるブラウザがある（#459）。
export function isOpaqueError(event: Event): boolean {
  if (!(event instanceof ErrorEvent)) {
    return false;
  }
  return !event.filename && (event.message === '' || event.message === 'Script error.');
}
