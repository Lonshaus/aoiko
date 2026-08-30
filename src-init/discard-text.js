// 未保存の入力を破棄するか尋ねるダイアログの文言。ダイアログはネイティブ側が出すので、
// 文言もこちら（初期化スクリプト）から渡す。
//
// ここは公開 repo のメッセージカタログを読めない。paraglide の生成物を取り込むと bundle が
// 桁で増えるうえ、生成した道具（CLI か vite plugin か）によって locale の解決方法まで
// 変わってしまう。app 側は自分の bundle で正しく訳せるので、訳した結果だけ受け取る。
const DEFAULTS = {
  closeMessage: '保存していない入力内容があります。破棄して終了しますか？',
  closeOk: '破棄して終了',
  reloadMessage: '保存していない入力内容があります。破棄して再読み込みしますか？',
  reloadOk: '破棄して再読み込み',
  cancel: '編集を続ける',
};

export function createDiscardText() {
  let text = { ...DEFAULTS };
  return {
    get() {
      return text;
    },
    // app が起動しきる前に押されることはある。届いた分だけ差し替え、残りは日本語のまま。
    // 空文字と非文字列は採らない（既定を消してしまうと文言の無いボタンが出る）。
    set(next) {
      const merged = { ...text };
      for (const key of Object.keys(DEFAULTS)) {
        const value = next?.[key];
        if (typeof value === 'string' && value !== '') {
          merged[key] = value;
        }
      }
      text = merged;
    },
  };
}
