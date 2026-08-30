import { m } from '../paraglide/messages';
import { getLocale } from '../paraglide/runtime';
import { nativeBridge } from './native-bridge';
// 解決済みのロケールを `<html lang>` へ反映する。`index.html` の `lang="ja"` は paraglide が
// 読み込まれる前のための初期値でしかなく、paraglide 自身は documentElement を触らない。
// 切り替えても ja のままだと、支援技術が日本語の音声合成で繁體中文や English を読み上げ、
// ブラウザの翻訳提案も誤った言語対で出て、`:lang()` と CJK のフォント選択も日本語に寄る。
//
// 切り替え時に個別で呼ぶ必要は無い。paraglide の setLocale は reload を伴うので、
// 起動経路のここ 1 か所で足りる。
export function applyUiLanguage(): void {
  const locale = getLocale();
  document.documentElement.lang = locale;
  // ネイティブのメニューがある環境では、そちらへも今の言語を渡す。メニューは WebView の
  // 外にあってこちらのメッセージカタログを読めないため、シェル側が別の辞書を持っており、
  // 言語が変わったら作り直す必要がある。
  //
  // 切り替えの瞬間ではなく読み込みのたびに渡している。paraglide の setLocale は reload を
  // 伴うので、reload の直前に渡すとページの破棄と IPC の到達が競合する。同じ言語なら
  // シェル側は何もしないため、通常の再読み込みで作り直されることは無い。
  const bridge = nativeBridge();
  if (typeof bridge?.setUiLocale === 'function') {
    // メニューが作り直せなくても画面は動く。起動を止めるほどの失敗ではない。
    void bridge.setUiLocale(locale).catch(() => {});
  }
  // 破棄確認のダイアログもシェル側が出す。こちらはメニューと違い WebView から呼ぶので、
  // 辞書を持たせるのではなく訳した文言を渡す。渡すまではシェル側の既定（日本語）が出る。
  if (typeof bridge?.setDiscardText === 'function') {
    bridge.setDiscardText({
      closeMessage: m.native_discard_close_message(),
      closeOk: m.native_discard_close_ok(),
      reloadMessage: m.native_discard_reload_message(),
      reloadOk: m.native_discard_reload_ok(),
      cancel: m.native_discard_cancel(),
    });
  }
}
