import './lib/preview-platform-init';
import { mount } from 'svelte';
import './app.css';
import App from './App.svelte';
import { seedAndReconcileAccounts } from './db';
import { getSetting, setSetting } from './lib/settings';
import { migrateOcrEngineSetting } from './lib/settings-migration';
import { applyUiLanguage } from './lib/ui-language';
import { cleanupStaleTesseractCaches } from './lib/ocr/tesseract-cache-cleanup';
import { installAnalysisNotifyListener } from './lib/analysis-notify-listener';
import { renderStartupError } from './lib/startup-error';
async function start(): Promise<void> {
  // 初回起動時に勘定科目をシードし、currentYear が未設定なら 2026 を入れる
  await seedAndReconcileAccounts();
  await migrateOcrEngineSetting();
  if ((await getSetting('currentYear')) === undefined) {
    await setSetting('currentYear', 2026);
  }
  mount(App, {
    target: document.getElementById('app')!,
  });
}
// ハッシュ違いで残った旧い Tesseract アセットのキャッシュを削除する。SW を使うのは web 版だけなので、
// __NATIVE__ で畳んで native 版のビルド成果物には残さない。http（非セキュアコンテキスト）では caches
// 自体が存在しないため、参照前に typeof で確かめる（修飾なしの参照は ReferenceError になる）。
if (!__NATIVE__) {
  void cleanupStaleTesseractCaches(
    typeof caches !== 'undefined' ? caches : undefined,
    __TESSERACT_CACHE_NAME__,
  );
}
// web ではサービスワーカーから、ネイティブ側では OS の通知から、画面を開く合図が届く。
installAnalysisNotifyListener();
// IndexedDB に触らないので、start() が落ちる環境でも先に済ませられる。
applyUiLanguage();
try {
  await start();
} catch (e) {
  renderStartupError(e);
}
