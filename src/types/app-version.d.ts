// vite.config.ts の define で注入されるビルド時定数
declare const __APP_VERSION__: string;
declare const __APP_COMMIT__: string;
// ネイティブ版のビルドかどうか。vite.config.ts が build 時に畳む。
declare const __NATIVE__: boolean;
// dev server（vite dev）でだけ true。build 産物には残らない。
declare const __DOC_PREVIEW__: boolean;
// dev server 起動時の AOIKO_PLATFORM。文書プレビューの既定値に使う。
declare const __DOC_PLATFORM__: string;
// Tesseract の資産（worker・コア WASM・言語モデル）から build 時に導く現在のキャッシュ名。
// vite.config.ts の runtimeCaching と揃え、旧キャッシュの掃除で比較に使う。
declare const __TESSERACT_CACHE_NAME__: string;
