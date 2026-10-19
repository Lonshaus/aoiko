import { expect, test, type CDPSession, type Page } from '@playwright/test';
import { acceptDisclaimer } from './helpers';
import { buildFormAuditBackup, readDisclaimerVersion } from './fixtures/form-audit-seed';
// DevTools Issues の「id も name も無いフォーム部品」を画面ごとに 0 件へ保つ（CDP は Chromium 専用）。
test.skip(({ browserName }) => browserName !== 'chromium', 'CDP Audits は Chromium 専用');
// 既定の headless shell はこの issue を出さないため、完全版の Chromium（新 headless）で動かす。
test.use({ channel: 'chromium' });
const ISSUE_TYPE = 'FormEmptyIdAndNameAttributesForInputError';
// 設定画面の復元を実際に通して架空データを入れる（完了すると再読み込みされるので通知を待つ）。
async function restoreSeed(page: Page): Promise<void> {
  await page.goto('/');
  await acceptDisclaimer(page);
  await page.goto('/settings');
  await page.locator('input[type=file][accept*=".json"]').setInputFiles({
    name: 'aoiko-form-audit-seed.json',
    mimeType: 'application/json',
    buffer: Buffer.from(buildFormAuditBackup(readDisclaimerVersion())),
  });
  await page.getByRole('button', { name: '全データを置換して復元' }).click();
  await page.getByRole('button', { name: '置換して復元', exact: true }).click();
  await expect(page.getByText('テーブル / ')).toBeVisible();
}
interface Audit {
  nodes: () => Promise<string[]>;
  stop: () => Promise<void>;
}
// 空白ページで有効化してから遷移し（遷移前の文書の報告を混ぜない）、同じ部品の重複報告はノードで除く。
async function startAudit(page: Page): Promise<Audit> {
  await page.goto('about:blank');
  const cdp: CDPSession = await page.context().newCDPSession(page);
  const nodeIds = new Set<number>();
  cdp.on('Audits.issueAdded', ({ issue }) => {
    const details = issue.details.genericIssueDetails;
    if (
      issue.code === 'GenericIssue' &&
      details?.errorType === ISSUE_TYPE &&
      details.violatingNodeId !== undefined
    ) {
      nodeIds.add(details.violatingNodeId);
    }
  });
  await cdp.send('DOM.enable');
  await cdp.send('Audits.enable');
  return {
    nodes: async () => {
      // 部品が出来てから Chrome が報告するまでに少し間があるため、報告が出揃うのを待つ。
      await page.waitForTimeout(1000);
      const out: string[] = [];
      for (const backendNodeId of nodeIds) {
        const { object } = await cdp.send('DOM.resolveNode', { backendNodeId });
        const { result } = await cdp.send('Runtime.callFunctionOn', {
          objectId: object.objectId,
          functionDeclaration: 'function () { return this.outerHTML.slice(0, 160); }',
          returnByValue: true,
        });
        out.push(String(result.value));
      }
      return out;
    },
    stop: async () => {
      await cdp.detach();
    },
  };
}
async function openAllDetails(page: Page): Promise<void> {
  await page.evaluate(() => {
    for (const el of document.querySelectorAll('details')) {
      el.open = true;
    }
  });
}
// 名前は画面内で一意にする。ラジオボタンは同じ name で 1 組が正しいので除く。
async function duplicatedNames(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const seen = new Map<string, number>();
    for (const el of document.querySelectorAll<HTMLInputElement>('input, select, textarea')) {
      if (el.name !== '' && el.type !== 'radio') {
        seen.set(el.name, (seen.get(el.name) ?? 0) + 1);
      }
    }
    return [...seen].filter(([, count]) => count > 1).map(([name]) => name);
  });
}
// 画面ごとの手順。復元直後の状態から、ここに書いた操作だけで報告対象の部品が全て出る。
const PINNED_ROUTES: ReadonlyArray<{
  path: string;
  steps: string;
  drive: (page: Page) => Promise<void>;
}> = [
  {
    path: '/',
    steps: '新規仕訳フォームをそのまま表示（借方・貸方とも 1 行、科目は未選択）',
    drive: async (page) => {
      await expect(page.getByRole('heading', { name: '新規仕訳' })).toBeVisible();
    },
  },
  {
    path: '/journal',
    steps: '年月・摘要・金額・取引先の絞り込みをそのまま表示',
    drive: async (page) => {
      await expect(page.getByRole('heading', { name: '仕訳一覧' })).toBeVisible();
    },
  },
  {
    path: '/reports',
    steps: '2026 年度をそのまま表示し、開閉部（details）を全て開く',
    drive: async (page) => {
      await expect(page.getByRole('heading', { name: '予算管理' })).toBeVisible();
      await openAllDetails(page);
    },
  },
  {
    path: '/income-deductions',
    steps: '所得控除の入力をそのまま表示し、開閉部を全て開く（チェック項目は触らない）',
    drive: async (page) => {
      await expect(page.getByRole('heading', { name: '社会保険料・生命保険料等' })).toBeVisible();
      await openAllDetails(page);
    },
  },
  {
    path: '/import',
    steps: 'CSV 取込画面を、取込元の既定のまま（ファイル未選択）表示',
    drive: async (page) => {
      await expect(page.getByText('1. 取込元')).toBeVisible();
    },
  },
  {
    path: '/order-import',
    steps: '注文取込画面を、貼り付け前のまま表示',
    drive: async (page) => {
      await expect(page.locator('textarea')).toBeVisible();
    },
  },
  {
    path: '/settings',
    steps:
      '設定画面を表示し、勘定科目の開閉部を全て開く（取引先・固定資産・自動分類ルールの行は復元済み）',
    drive: async (page) => {
      await expect(page.getByText('サンプル商店')).toBeVisible();
      await expect(page.getByText('サンプル機材')).toBeVisible();
      await openAllDetails(page);
    },
  },
  {
    path: '/opening-setup',
    steps: '開業設定をそのまま表示（開業費・転用資産・自由項目の入力欄）',
    drive: async (page) => {
      await expect(page.getByRole('heading', { name: '自由項目' })).toBeVisible();
    },
  },
  {
    path: '/manual',
    steps: '手引きの検索欄をそのまま表示',
    drive: async (page) => {
      await expect(page.getByPlaceholder('検索…')).toBeVisible();
    },
  },
];
for (const route of PINNED_ROUTES) {
  test(`${route.path}：id も name も無い部品が無い（${route.steps}）`, async ({ page }) => {
    await restoreSeed(page);
    const audit = await startAudit(page);
    await page.goto(route.path);
    await page.waitForLoadState('networkidle');
    await route.drive(page);
    const nodes = await audit.nodes();
    await audit.stop();
    expect(nodes, `${nodes.length} 件`).toEqual([]);
    expect(await duplicatedNames(page)).toEqual([]);
  });
}
// 条件付きで現れる部品（科目を選ぶと出る行、チェックで開く欄、追加した行など）。
const CONDITIONAL_STATES: ReadonlyArray<{
  name: string;
  path: string;
  drive: (page: Page) => Promise<void>;
}> = [
  {
    name: '仕訳フォーム：商品管理の科目を借方・貸方に選び、商品と数量まで出す',
    path: '/',
    drive: async (page) => {
      await page.locator('form select[required]').nth(0).selectOption('5020');
      await page.locator('form select[required]').nth(1).selectOption('4110');
      for (const select of await page
        .locator('select')
        .filter({ has: page.locator('option', { hasText: '商品を選択' }) })
        .all()) {
        await select.selectOption('i1');
      }
      await expect(page.getByPlaceholder('数量')).toHaveCount(2);
    },
  },
  {
    name: '所得控除：給与所得・配偶者・扶養親族・専従者の欄を出す',
    path: '/income-deductions',
    drive: async (page) => {
      await page.getByRole('checkbox', { name: /給与所得がある/ }).check();
      await page.getByRole('checkbox', { name: '配偶者がいる' }).check();
      await page.getByRole('button', { name: '＋追加' }).nth(0).click();
      await page.getByRole('button', { name: '＋追加' }).nth(1).click();
    },
  },
  {
    name: '設定：課税事業者（本則課税）・リース期間定額法・外部 AI の欄を出す',
    path: '/settings',
    drive: async (page) => {
      await page.getByText('課税事業者').first().waitFor();
      await page.locator('select').filter({ hasText: '免税事業者' }).selectOption('taxable');
      await page
        .locator('select')
        .filter({ hasText: 'リース期間定額法' })
        .selectOption('lease-period-straight-line');
      await page
        .locator('select')
        .filter({ hasText: 'OpenAI 互換' })
        .selectOption('openai-compatible');
    },
  },
  {
    name: '売掛・買掛：1 件登録して入金欄の行を出す',
    path: '/reports',
    drive: async (page) => {
      await page.locator('input[type=text][required]').fill('サンプル請求');
      await page.locator('input[type=date][required]').fill('2026-12-31');
      await page.locator('input[type=number][required]').fill('1000');
      await page.getByRole('button', { name: '追加', exact: true }).first().click();
      await expect(page.getByPlaceholder('金額').first()).toBeVisible();
    },
  },
];
for (const state of CONDITIONAL_STATES) {
  test(`条件付きの部品：${state.name}`, async ({ page }) => {
    await restoreSeed(page);
    const audit = await startAudit(page);
    await page.goto(state.path);
    await page.waitForLoadState('networkidle');
    await state.drive(page);
    const nodes = await audit.nodes();
    await audit.stop();
    expect(nodes, `${nodes.length} 件`).toEqual([]);
    expect(await duplicatedNames(page)).toEqual([]);
  });
}
// 名前の無かった部品が、読み上げ・label 検索で見つかる名前を持つこと。
test('名前の無かった部品がアクセシブルネームを持つ', async ({ page }) => {
  await restoreSeed(page);
  await page.goto('/');
  await expect(page.getByRole('combobox', { name: '借方 科目を選択', exact: true })).toBeVisible();
  await expect(page.getByRole('spinbutton', { name: '借方 金額', exact: true })).toBeVisible();
  await expect(page.getByRole('combobox', { name: '借方 税率', exact: true })).toBeVisible();
  await expect(page.getByRole('combobox', { name: '貸方 科目を選択', exact: true })).toBeVisible();
  await expect(page.getByRole('spinbutton', { name: '貸方 金額', exact: true })).toBeVisible();
  await expect(page.getByRole('combobox', { name: '貸方 税率', exact: true })).toBeVisible();

  await page.goto('/reports');
  await expect(page.getByRole('spinbutton', { name: '1 月 収入予算', exact: true })).toBeVisible();
  await expect(page.getByRole('spinbutton', { name: '12 月 支出予算', exact: true })).toBeVisible();

  await page.goto('/settings');
  await expect(page.getByRole('combobox', { name: '言語', exact: true })).toBeVisible();
  await expect(page.getByRole('combobox', { name: '親科目を選択', exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: /^補助科目名/ })).toBeVisible();
  await expect(page.getByRole('textbox', { name: '取引先名', exact: true })).toBeVisible();
  await expect(page.getByRole('combobox', { name: '区分', exact: true })).toBeVisible();
  await expect(page.getByRole('combobox', { name: /^既定の相手科目/ })).toBeVisible();
  await expect(page.getByRole('textbox', { name: /^送付先住所/ })).toBeVisible();
  await expect(page.getByRole('textbox', { name: '商品名', exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: /^名前（例：MacBook Pro）/ })).toBeVisible();
  await expect(page.getByRole('spinbutton', { name: '取得価額', exact: true })).toBeVisible();
  await expect(page.getByRole('spinbutton', { name: '耐用年数', exact: true })).toBeVisible();
  await expect(page.getByRole('combobox', { name: '償却方法', exact: true })).toBeVisible();
  await expect(page.getByRole('combobox', { name: '照合方法', exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: '例：amazon', exact: true })).toBeVisible();
  await expect(page.getByRole('spinbutton', { name: '優先度', exact: true })).toBeVisible();
  await expect(
    page.getByRole('spinbutton', { name: '家事按分の既定比率', exact: true }),
  ).toBeVisible();

  await page.goto('/opening-setup');
  await expect(page.getByRole('textbox', { name: /^項目名（例：名刺作成）/ })).toBeVisible();
  await expect(page.getByRole('textbox', { name: /^名前（例：MacBook Pro）/ })).toBeVisible();
  await expect(page.getByRole('combobox', { name: '借方・貸方の別', exact: true })).toBeVisible();

  await page.goto('/manual');
  await expect(page.getByRole('searchbox', { name: '検索…', exact: true })).toBeVisible();
});
