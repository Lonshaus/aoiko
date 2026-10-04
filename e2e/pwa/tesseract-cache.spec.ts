import { expect, test, type Page } from '@playwright/test';
import { acceptDisclaimer } from '../helpers';
// 実際の領収書ではなく、OCR 資産の取得経路だけを確かめるための無地の 8x8 白グレースケール PNG。
const TINY_RECEIPT_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAAAAADhZOFXAAAADklEQVR4nGP4DwUMlDEA98A/wbI0QbsAAAAASUVORK5CYII=',
  'base64',
);

async function stageReceiptFile(page: Page): Promise<void> {
  await page.goto('/receipt');
  await page.locator('input[type="file"]').setInputFiles({
    name: 'receipt.png',
    mimeType: 'image/png',
    buffer: TINY_RECEIPT_PNG,
  });
  await page.getByRole('button', { name: '添付する' }).click();
  await page.getByRole('radio', { name: '内蔵のルールベースエンジン' }).click();
}

async function analyzeAndExpectSuccess(page: Page): Promise<void> {
  await stageReceiptFile(page);
  const analyzeButton = page.getByRole('button', { name: '解析する' });
  await expect(analyzeButton).toBeEnabled();
  await analyzeButton.click();
  await expect(page.getByRole('button', { name: '仕訳を登録' })).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.border-destructive')).toHaveCount(0);
}

async function analyzeAndExpectFailure(page: Page): Promise<void> {
  await stageReceiptFile(page);
  const analyzeButton = page.getByRole('button', { name: '解析する' });
  await expect(analyzeButton).toBeEnabled();
  await analyzeButton.click();
  // worker 自体の読み込みも失敗するため、tesseract-wasm 側は例外を返さずそのまま
  // 応答が来なくなる（エラー表示は出ない）。数秒経っても登録ボタンが出ないことで確認する。
  await page.waitForTimeout(5_000);
  await expect(page.getByRole('button', { name: '仕訳を登録' })).toBeHidden();
}

async function tesseractCachePaths(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const names = await caches.keys();
    const target = names.find((name) => name.startsWith('aoiko-tesseract-'));
    if (!target) {
      return [];
    }
    const cache = await caches.open(target);
    const requests = await cache.keys();
    return requests.map((request) => new URL(request.url).pathname);
  });
}

async function deleteTesseractCaches(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const names = await caches.keys();
    await Promise.all(
      names
        .filter((name) => name.startsWith('aoiko-tesseract-'))
        .map((name) => caches.delete(name)),
    );
  });
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await acceptDisclaimer(page);
  // clientsClaim により初回訪問でもこの待ちで真になる（インストール中の解析は本テストの対象外）。
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
});

test('初回取得後はネットワークを止めても Tesseract で解析できる', async ({ page, context }) => {
  await analyzeAndExpectSuccess(page);

  const cached = await tesseractCachePaths(page);
  expect(cached.some((path) => path.endsWith('tesseract-worker.js'))).toBe(true);
  expect(cached.some((path) => path.endsWith('jpn.traineddata'))).toBe(true);
  expect(cached.some((path) => /tesseract-core.*\.wasm$/.test(path))).toBe(true);

  await context.route('**/tesseract/**', (route) => route.abort());
  await page.reload();
  await analyzeAndExpectSuccess(page);
});
// 対照群：同じ build でも、キャッシュを消してからネットワークを止めれば解析は失敗するはず。
// 上のテストが「キャッシュが無くても実は動いていた」を拾えることの確認。
test('（対照）キャッシュを消してからネットワークを止めると解析は失敗する', async ({
  page,
  context,
}) => {
  await analyzeAndExpectSuccess(page);
  expect((await tesseractCachePaths(page)).length).toBeGreaterThan(0);

  await deleteTesseractCaches(page);
  await context.route('**/tesseract/**', (route) => route.abort());
  await page.reload();
  await analyzeAndExpectFailure(page);
});
