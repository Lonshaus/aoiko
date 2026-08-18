// vite.config.ts の define で注入されるビルド時定数
declare const __APP_VERSION__: string;
declare const __APP_COMMIT__: string;
// ネイティブ版（Tauri）のビルドかどうか。vite.config.ts が build 時に畳む。
declare const __NATIVE__: boolean;
