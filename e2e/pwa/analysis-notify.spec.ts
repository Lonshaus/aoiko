import { expect, test, type Page } from '@playwright/test';
import { acceptDisclaimer } from '../helpers';
// 実際の領収書ではなく、解析を走らせるためだけの無地の 8x8 白グレースケール PNG。
const TINY_RECEIPT_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAAAAADhZOFXAAAADklEQVR4nGP4DwUMlDEA98A/wbI0QbsAAAAASUVORK5CYII=',
  'base64',
);
const LLM_BASE_URL = 'http://localhost:11434/v1';
const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
};
const VENDOR_IN_RESULT = 'テスト商店';
// ANALYSIS_ROUTE の値。src/ の store は Svelte のルーンを含み Playwright からは読めないため、
// ここには写しを置く。SW 側の表との一致は src/lib/analysis-notify-sw.test.ts が見る。
const RECEIPT_ROUTE = '/receipt';
// 通知を出せるのは chromium 本体（pwa-chromium の channel: 'chromium'）だけ。headless shell は許可を与えても denied のまま。
test.use({ permissions: ['notifications'] });

async function putSettings(page: Page, settings: Record<string, unknown>): Promise<void> {
  await page.evaluate(async (entries) => {
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open('aoiko');
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction('settings', 'readwrite');
        const now = Date.now();
        for (const [key, value] of Object.entries(entries)) {
          tx.objectStore('settings').put({ key, value, updatedAt: now });
        }
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
      req.onerror = () => reject(req.error);
    });
  }, settings);
}

async function readSetting(page: Page, key: string): Promise<unknown> {
  return page.evaluate(
    (name) =>
      new Promise<unknown>((resolve, reject) => {
        const req = indexedDB.open('aoiko');
        req.onsuccess = () => {
          const db = req.result;
          const get = db.transaction('settings').objectStore('settings').get(name);
          get.onsuccess = () => {
            db.close();
            resolve(get.result?.value);
          };
          get.onerror = () => reject(get.error);
        };
        req.onerror = () => reject(req.error);
      }),
    key,
  );
}

async function shownNotifications(page: Page) {
  return page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    const list = await registration.getNotifications();
    return list.map((n) => ({ tag: n.tag, title: n.title, body: n.body, data: n.data }));
  });
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await acceptDisclaimer(page);
  // clientsClaim により初回訪問でもこの待ちで真になる。
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
});

test('離れている間に解析が終わると通知が 1 件出て、クリックで解析した画面に戻る', async ({
  page,
  context,
}) => {
  expect(await page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
  const swSource = await (await page.request.get('/sw.js')).text();
  expect(swSource).toContain('analysis-notify-sw.js');

  await putSettings(page, {
    aiEngine: 'openai-compatible',
    openaiBaseUrl: LLM_BASE_URL,
    openaiOcrModel: 'mock-model',
  });
  await page.goto('/settings');
  await page.getByRole('checkbox', { name: '解析が終わったら通知する' }).check();
  await expect.poll(() => readSetting(page, 'analysisNotifyEnabled')).toBe(true);

  let reachedLlm!: () => void;
  const llmRequested = new Promise<void>((resolve) => {
    reachedLlm = resolve;
  });
  let answerLlm!: () => void;
  const llmMayAnswer = new Promise<void>((resolve) => {
    answerLlm = resolve;
  });
  await context.route(`${LLM_BASE_URL}/chat/completions`, async (route) => {
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: CORS_HEADERS });
      return;
    }
    reachedLlm();
    await llmMayAnswer;
    await route.fulfill({
      status: 200,
      headers: CORS_HEADERS,
      contentType: 'application/json',
      body: JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                date: '2026-01-05',
                vendorName: VENDOR_IN_RESULT,
                totalAmount: '1500',
                items: [],
              }),
            },
          },
        ],
      }),
    });
  });

  await page.goto(RECEIPT_ROUTE);
  await page.locator('input[type="file"]').setInputFiles({
    name: 'receipt.png',
    mimeType: 'image/png',
    buffer: TINY_RECEIPT_PNG,
  });
  await page.getByRole('button', { name: '添付する' }).click();
  await page.getByRole('button', { name: '解析する' }).click();
  await llmRequested;
  // 解析の途中で画面を離れた状態にする。ヘッドレスのページは常にフォーカスを持つので、判定の入力を差し替える。
  await page.evaluate(() => {
    Object.defineProperty(document, 'hasFocus', { configurable: true, value: () => false });
  });
  expect(await shownNotifications(page)).toEqual([]);
  answerLlm();

  await expect
    .poll(() => shownNotifications(page))
    .toEqual([
      {
        tag: 'aoiko-analysis-receipt',
        title: 'aoiko',
        body: '領収書の解析が終わりました',
        data: { kind: 'receipt' },
      },
    ]);
  const shown = JSON.stringify(await shownNotifications(page));
  expect(shown).not.toContain(VENDOR_IN_RESULT);
  expect(shown).not.toContain('1500');
  // クリックの経路。別の画面を開いた状態から、SW 内でクリック時の処理を通知のデータで直接呼ぶ。
  // 合成した notificationclick は信頼されないイベントで waitUntil が例外になるため、イベントは使わない。
  await page.goto('/settings');
  await expect(page.getByRole('heading', { name: '設定', exact: true })).toBeVisible();
  const worker =
    context.serviceWorkers().find((w) => w.url().endsWith('/sw.js')) ??
    (await context.waitForEvent('serviceworker'));
  await worker.evaluate(async () => {
    const scope = self as unknown as {
      registration: ServiceWorkerRegistration;
      clients: unknown;
      aoikoNotificationClick: (data: unknown, clients: unknown) => Promise<void>;
    };
    const [notification] = await scope.registration.getNotifications();
    await scope.aoikoNotificationClick(notification!.data, scope.clients);
  });
  await expect.poll(() => new URL(page.url()).pathname).toBe(RECEIPT_ROUTE);
  // 解析した画面へ戻ったので、その画面の通知は閉じられている。
  await expect.poll(() => shownNotifications(page)).toEqual([]);
});
