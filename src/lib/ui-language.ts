import { getLocale } from '../paraglide/runtime';
// 解決済みのロケールを `<html lang>` へ反映する。`index.html` の `lang="ja"` は paraglide が
// 読み込まれる前のための初期値でしかなく、paraglide 自身は documentElement を触らない。
// 切り替えても ja のままだと、支援技術が日本語の音声合成で繁體中文や English を読み上げ、
// ブラウザの翻訳提案も誤った言語対で出て、`:lang()` と CJK のフォント選択も日本語に寄る。
//
// 切り替え時に個別で呼ぶ必要は無い。paraglide の setLocale は reload を伴うので、
// 起動経路のここ 1 か所で足りる。
export function applyUiLanguage(): void {
  document.documentElement.lang = getLocale();
}
