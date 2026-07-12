import { mount } from 'svelte';
import './app.css';
import App from './App.svelte';
import { seedAndReconcileAccounts } from './db';
import { getSetting, setSetting } from './lib/settings';
// IndexedDB が使えない環境（Safari プライベートモード・ストレージ拒否・容量枯渇）では
// シードや設定読み書きが失敗する。例外を握りつぶして白画面にせず、状況を日本語で表示する。
function renderStartupError(e: unknown): void {
  const target = document.getElementById('app');
  if (!target) {
    return;
  }
  const detail = e instanceof Error ? e.message : String(e);
  target.innerHTML = `
    <div style="max-width:36rem;margin:4rem auto;padding:0 1.5rem;font-family:system-ui,sans-serif;line-height:1.8;color:#15374a">
      <h1 style="font-size:1.25rem;margin:0 0 1rem">aoiko を起動できませんでした</h1>
      <p>ブラウザのストレージ（IndexedDB）にアクセスできませんでした。次をお試しください：</p>
      <ul style="padding-left:1.4rem">
        <li>プライベート／シークレットモードを解除して通常ウィンドウで開く</li>
        <li>サイトのストレージ許可を確認する（ブラウザ設定）</li>
        <li>端末の空き容量を確認する</li>
      </ul>
      <p style="color:#64748b;font-size:0.85rem;margin-top:1.5rem">詳細：${detail.replace(/[<>&]/g, '')}</p>
    </div>`;
}

async function start(): Promise<void> {
  // 初回起動時に勘定科目をシードし、currentYear が未設定なら 2026 を入れる
  await seedAndReconcileAccounts();
  if ((await getSetting('currentYear')) === undefined) {
    await setSetting('currentYear', 2026);
  }
  mount(App, {
    target: document.getElementById('app')!,
  });
}

try {
  await start();
} catch (e) {
  renderStartupError(e);
}
