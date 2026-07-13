import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { acceptDisclaimer } from './helpers';
// UI 播種 → /reports → .xtx ダウンロードまでを 1 本で通す。過去の回帰（exportYear 錯位・
// BS 欄錯置・リバースチャージ漏配線）は「unit は各自緑・繋ぐと壊れる」接線層だったため、
// 出力フロー全体を通して封包後の値・ファイル名・文書構造を確かめる。
// ドメイン計算そのものは Vitest（xtx.test.ts 等）で網羅済み。ここは統合のみ。

// JournalEntryForm へ 1 仕訳を UI 操作で投入する（journal.spec.ts と同じ操作パターン）。
async function addEntry(
  page: import('@playwright/test').Page,
  opts: {
    date: string;
    description: string;
    debitCode: string;
    creditCode: string;
    amount: string;
  },
): Promise<void> {
  await page.locator('input[type="date"]').first().fill(opts.date);
  await page.getByPlaceholder('例：電気代').fill(opts.description);
  // required は科目 select のみ。税区分・用途区分 select の増減に影響されず借方/貸方を特定できる。
  await page.locator('form select[required]').nth(0).selectOption(opts.debitCode);
  await page.getByPlaceholder('金額').nth(0).fill(opts.amount);
  await page.locator('form select[required]').nth(1).selectOption(opts.creditCode);
  await page.getByPlaceholder('金額').nth(1).fill(opts.amount);
  await page.getByRole('button', { name: /仕訳を追加/ }).click();
  await expect(page.getByText(opts.description).first()).toBeVisible({ timeout: 5000 });
}

test('UIで播種した仕訳が .xtx 出力に反映され、年・売上・経費・文書構造が一致する', async ({
  page,
}) => {
  await page.goto('/');
  await acceptDisclaimer(page);

  // 申告者情報（IT部 必須）が欠けると downloadXtx は lockError を出して中断するため、先に播種する。
  // これは検証対象（仕訳→数字）ではない前提設定なので、UI フォームの税務署コンボボックス等を
  // 避けて設定テーブルへ直接入れる。ponytail: 前提設定は最短経路で、検証は本物のフローで。
  await page.evaluate(async () => {
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open('aoiko');
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction('settings', 'readwrite');
        const store = tx.objectStore('settings');
        const now = Date.now();
        const put = (key: string, value: string) => store.put({ key, value, updatedAt: now });
        put('userRiyoshaId', '1234567890123456');
        put('userFilerName', '青井 太郎');
        put('userFilerZip', '1800001');
        put('userFilerAddress', '東京都武蔵野市〇〇1-2-3');
        put('userZeimushoCode', '01101');
        put('userZeimushoName', '麹町');
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
      req.onerror = () => reject(req.error);
    });
  });

  // 売上 550,000（借方 現金／貸方 売上高）と 経費 消耗品費 11,000（借方 消耗品費／貸方 現金）。
  // aoiko は税込経理で PL は仕訳金額をそのまま集計するため、封包後の leaf は税抜換算されず
  // この金額がそのまま入る（xtx-mapping-koa020/210 の toKingaku は整数化のみ）。
  const today = new Date().toISOString().slice(0, 10);
  await addEntry(page, {
    date: today,
    description: 'e2e売上 550000',
    debitCode: '1110',
    creditCode: '4110',
    amount: '550000',
  });
  await addEntry(page, {
    date: today,
    description: 'e2e消耗品費 11000',
    debitCode: '5200',
    creditCode: '1110',
    amount: '11000',
  });

  await page.goto('/reports');
  const downloadButton = page.getByRole('button', { name: '.xtx をダウンロード', exact: true });
  await expect(downloadButton).toBeVisible();

  const downloadPromise = page.waitForEvent('download');
  await downloadButton.click();
  const download = await downloadPromise;

  // ファイル名の年は処理年度（既定＝今年 2026）と一致する（#169 exportYear 錯位の回帰防護）。
  const processYear = new Date().getFullYear();
  expect(download.suggestedFilename()).toBe(`aoiko-${processYear}.xtx`);

  const path = await download.path();
  const xml = readFileSync(path, 'utf-8');

  // 整形式 XML（ブラウザの DOMParser で parsererror が出ない）。xtx.test.ts と同じ判定。
  const parseErrorCount = await page.evaluate((content) => {
    const doc = new DOMParser().parseFromString(content, 'text/xml');
    return doc.getElementsByTagName('parsererror').length;
  }, xml);
  expect(parseErrorCount).toBe(0);

  // 売上 550,000 が第一表（営業等 金額）と決算書 KOA210（売上（収入）金額）の leaf に入る。
  expect(xml).toContain('>550000<');
  // 経費 消耗品費 11,000 が KOA210 損益計算書の消耗品費 行に入る。
  expect(xml).toContain('>11000<');

  // 文書構造の要：手続 RKO0010・申告書 KOA020 と青色決算書 KOA210 の併載。
  expect(xml).toContain('<procedure_CD>RKO0010</procedure_CD>');
  expect(xml).toMatch(/<KOA020 VR="23\.0"/);
  expect(xml).toMatch(/<KOA210 VR="11\.0"/);
});
