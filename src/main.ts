import './lib/preview-platform-init';
import { mount } from 'svelte';
import './app.css';
import App from './App.svelte';
import { db, ensureAccountsForYears, seedAndReconcileAccounts } from './db';
import { startupAccountYears } from './db/year-accounts';
import { initialProcessingYear } from './lib/initial-processing-year';
import { getSetting, setSetting } from './lib/settings';
import {
  migrateBackupPartsSetting,
  migrateOcrEngineSetting,
  resetInvalidCurrentYear,
} from './lib/settings-migration';
import { applyUiLanguage } from './lib/ui-language';
import { cleanupStaleTesseractCaches } from './lib/ocr/tesseract-cache-cleanup';
import { renderStartupError } from './lib/startup-error';
async function start(): Promise<void> {
  // 初回起動時に勘定科目をシードし、currentYear が未設定なら起動時点の西暦年を入れる。
  // 読めない値は同じ年へ置き換え、ホームでその旨を知らせる。
  // 科目の無い年度（処理年度と仕訳のある年度）には近い年度の科目を複製する。
  await seedAndReconcileAccounts();
  await migrateOcrEngineSetting();
  await migrateBackupPartsSetting();
  await resetInvalidCurrentYear(new Date());
  if ((await getSetting('currentYear')) === undefined) {
    await setSetting('currentYear', initialProcessingYear(new Date()));
  }
  const currentYear = await getSetting('currentYear');
  const entryYears = await db.journalEntries.orderBy('year').uniqueKeys();
  await ensureAccountsForYears(startupAccountYears(currentYear, entryYears));
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
// IndexedDB に触らないので、start() が落ちる環境でも先に済ませられる。
applyUiLanguage();
try {
  await start();
} catch (e) {
  renderStartupError(e);
}
