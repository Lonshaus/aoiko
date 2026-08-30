import { mount } from 'svelte';
import './app.css';
import App from './App.svelte';
import { seedAndReconcileAccounts } from './db';
import { getSetting, setSetting } from './lib/settings';
import { applyUiLanguage } from './lib/ui-language';
// IndexedDB が使えない環境（プライベートモード・ストレージ拒否・容量枯渇）では
// シードや設定読み書きが失敗する。例外を握りつぶして白画面にせず、状況を表示する。
// paraglide（多言語メッセージ）はまだ読み込まれておらず、失敗の理由次第では
// ロケール判定自体が動く保証もないため、この画面だけは日本語・英語・繁體中文を
// すべて直書きで同時表示する（1 言語を選んで外すという判断ができない場面）。
function renderStartupError(e: unknown): void {
  const target = document.getElementById('app');
  if (!target) {
    return;
  }
  const detail = (e instanceof Error ? e.message : String(e)).replace(/[<>&]/g, '');
  target.innerHTML = `
    <div style="max-width:36rem;margin:4rem auto;padding:0 1.5rem;font-family:system-ui,sans-serif;line-height:1.8;color:#15374a">
      <section>
        <h1 style="font-size:1.25rem;margin:0 0 1rem">aoiko を起動できませんでした</h1>
        <p>ブラウザのストレージ（IndexedDB）にアクセスできませんでした。次をお試しください：</p>
        <ul style="padding-left:1.4rem">
          <li>プライベート／シークレットモードを解除して通常ウィンドウで開く</li>
          <li>サイトのストレージ許可を確認する（ブラウザ設定）</li>
          <li>端末の空き容量を確認する</li>
        </ul>
      </section>
      <hr style="margin:1.5rem 0;border:none;border-top:1px solid #cbd5e1" />
      <section>
        <h1 style="font-size:1.25rem;margin:0 0 1rem">aoiko failed to start</h1>
        <p>Could not access browser storage (IndexedDB). Please try:</p>
        <ul style="padding-left:1.4rem">
          <li>Leaving private/incognito mode and opening a normal window</li>
          <li>Checking the site's storage permission in your browser settings</li>
          <li>Checking your device's free storage space</li>
        </ul>
      </section>
      <hr style="margin:1.5rem 0;border:none;border-top:1px solid #cbd5e1" />
      <section>
        <h1 style="font-size:1.25rem;margin:0 0 1rem">aoiko 無法啟動</h1>
        <p>無法存取瀏覽器儲存空間（IndexedDB）。請嘗試：</p>
        <ul style="padding-left:1.4rem">
          <li>關閉隱私／無痕模式，改用一般視窗開啟</li>
          <li>確認瀏覽器設定中此網站的儲存權限</li>
          <li>確認裝置的可用儲存空間</li>
        </ul>
      </section>
      <p style="color:#64748b;font-size:0.85rem;margin-top:1.5rem">詳細 / Detail / 詳細：${detail}</p>
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

// IndexedDB に触らないので、start() が落ちる環境でも先に済ませられる。
applyUiLanguage();
try {
  await start();
} catch (e) {
  renderStartupError(e);
}
