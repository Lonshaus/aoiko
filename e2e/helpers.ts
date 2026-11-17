import type { Page } from '@playwright/test';
// DISCLAIMER モーダルを閉じてからテストを進める。
// 初回訪問では必ず表示されるため、ほとんどのテストの beforeEach で呼ぶ。
export async function acceptDisclaimer(page: Page): Promise<void> {
  await page.getByTestId('disclaimer-accept').click();
  await page.getByTestId('disclaimer-accept').waitFor({ state: 'detached' });
}
// 初回起動の処理年度は起動時点の西暦年になるため、年度を固定したいテストは設定を書き換えて読み込み直す。
export async function setProcessingYear(page: Page, year: number): Promise<void> {
  await page.evaluate(async (y) => {
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open('aoiko');
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction('settings', 'readwrite');
        tx.objectStore('settings').put({ key: 'currentYear', value: y, updatedAt: Date.now() });
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
      req.onerror = () => reject(req.error);
    });
  }, year);
  await page.reload();
}
