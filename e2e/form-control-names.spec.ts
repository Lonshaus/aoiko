import { expect, test, type CDPSession, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';
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
  observe: () => Promise<void>;
  nodes: () => string[];
  duplicates: () => string[];
  stop: () => Promise<void>;
}
// 空白ページで有効化してから遷移し（遷移前の文書の報告を混ぜない）、同じ部品の重複報告はノードで除く。
async function startAudit(page: Page): Promise<Audit> {
  await page.goto('about:blank');
  const cdp: CDPSession = await page.context().newCDPSession(page);
  const nodeIds = new Set<number>();
  const found = new Map<number, string>();
  const duplicates = new Set<string>();
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
    // 定期検査を待たずに今の DOM を検査させる。見つかった分は応答より先に issueAdded で届く。
    observe: async () => {
      await cdp.send('Audits.checkFormsIssues');
      for (const backendNodeId of nodeIds) {
        if (found.has(backendNodeId)) {
          continue;
        }
        const { object } = await cdp.send('DOM.resolveNode', { backendNodeId });
        const { result } = await cdp.send('Runtime.callFunctionOn', {
          objectId: object.objectId,
          functionDeclaration: 'function () { return this.outerHTML.slice(0, 160); }',
          returnByValue: true,
        });
        found.set(backendNodeId, String(result.value));
      }
      for (const name of await duplicatedNames(page)) {
        duplicates.add(name);
      }
    },
    nodes: () => [...found.values()],
    duplicates: () => [...duplicates],
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
// 同じ文言の「＋追加」が並ぶため、見出しと同じ行のボタンを押す。
async function addRowUnder(page: Page, heading: string): Promise<void> {
  await page
    .getByRole('heading', { name: heading, exact: true })
    .locator('..')
    .getByRole('button', { name: '＋追加' })
    .click();
}
const MOCK_GEMINI_MODEL = 'gemini-2.5-flash';
// 設定の読み込みは入力欄を後から上書きするため、鍵より後に読む課税区分が反映されるのを待ってから入力する。
async function waitForSettingsLoaded(page: Page): Promise<void> {
  await expect(page.locator('[name=taxRegistration]')).toHaveValue('taxable');
}
// 外部 AI には繋がず、Gemini の応答を差し替えてから鍵とモデルを設定画面で保存する。
async function useMockGemini(page: Page, reply: object): Promise<void> {
  await page.route('https://generativelanguage.googleapis.com/v1beta/models?*', (route) =>
    route.fulfill({
      json: {
        models: [
          { name: `models/${MOCK_GEMINI_MODEL}`, supportedGenerationMethods: ['generateContent'] },
        ],
      },
    }),
  );
  await page.route(
    'https://generativelanguage.googleapis.com/v1beta/models/*:generateContent?*',
    (route) =>
      route.fulfill({
        json: { candidates: [{ content: { parts: [{ text: JSON.stringify(reply) }] } }] },
      }),
  );
  await page.goto('/settings');
  await waitForSettingsLoaded(page);
  await page.locator('[name=geminiApiKey]').fill('form-audit-dummy-key');
  await page.getByRole('button', { name: 'モデル一覧取得' }).click();
  await expect(page.getByText(`✓ モデルを ${MOCK_GEMINI_MODEL} に設定しました`)).toBeVisible();
}
const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
// 画面ごとの手順。復元直後の状態から、ここに書いた操作で出る部品を検査する。
const PINNED_ROUTES: ReadonlyArray<{
  path: string;
  steps: string;
  drive: (page: Page) => Promise<void>;
}> = [
  {
    path: '/',
    steps: '新規仕訳フォームをそのまま表示（借方・貸方とも 1 行、科目は未選択）',
    drive: async (page) => {
      await expect(page.getByRole('combobox', { name: '貸方 税率', exact: true })).toBeVisible();
    },
  },
  {
    path: '/journal',
    steps: '年月・摘要・金額・取引先の絞り込みをそのまま表示',
    drive: async (page) => {
      await expect(page.locator('[name=filterVendor]')).toBeVisible();
    },
  },
  {
    path: '/reports',
    steps: '2026 年度をそのまま表示し、開閉部（details）を全て開く',
    drive: async (page) => {
      await expect(
        page.getByRole('spinbutton', { name: '12 月 支出予算', exact: true }),
      ).toBeVisible();
      await expect(page.locator('[name=interimPriorPeriodMonths]')).toBeVisible();
      await openAllDetails(page);
    },
  },
  {
    path: '/income-deductions',
    steps: '所得控除の入力をそのまま表示し、開閉部を全て開く（チェック項目は触らない）',
    drive: async (page) => {
      await expect(page.locator('[name=disasterExemptionAmount]')).toBeVisible();
      await openAllDetails(page);
    },
  },
  {
    path: '/import',
    steps: 'CSV 取込画面を、ファイル未選択のまま表示（取込元の口座に補助科目あり）',
    drive: async (page) => {
      await expect(page.locator('[name=importKnownSubAccount]')).toBeVisible();
    },
  },
  {
    path: '/order-import',
    steps: '注文取込画面を、貼り付け前のまま表示',
    drive: async (page) => {
      await expect(
        page.getByRole('textbox', { name: '1. 注文ページのテキストを貼り付け' }),
      ).toBeVisible();
    },
  },
  {
    path: '/settings',
    steps:
      '設定画面を表示し、勘定科目の開閉部を全て開く（取引先・固定資産・自動分類ルールの行は復元済み）',
    drive: async (page) => {
      await expect(page.getByText('サンプル商店')).toBeVisible();
      await expect(page.getByText('サンプル機材')).toBeVisible();
      await expect(page.locator('[name=homeOfficeRatio]')).toBeVisible();
      await openAllDetails(page);
    },
  },
  {
    path: '/opening-setup',
    steps: '開業設定をそのまま表示（開業費・転用資産・自由項目の入力欄）',
    drive: async (page) => {
      await expect(page.locator('[name=customItemAmount]')).toBeVisible();
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
    await route.drive(page);
    await audit.observe();
    await audit.stop();
    expect(audit.nodes(), `${audit.nodes().length} 件`).toEqual([]);
    expect(audit.duplicates()).toEqual([]);
  });
}
// 条件付きで現れる部品（科目を選ぶと出る行、チェックで開く欄、追加した行など）。
// 途中で消える部品があるため、状態ごとに observe を呼ぶ。
const CONDITIONAL_STATES: ReadonlyArray<{
  name: string;
  path: string;
  before?: (page: Page) => Promise<void>;
  drive: (page: Page, observe: () => Promise<void>) => Promise<void>;
}> = [
  {
    name: '仕訳フォーム：商品管理の科目を借方・貸方に選び、商品と数量まで出す',
    path: '/',
    drive: async (page) => {
      await page
        .getByRole('combobox', { name: '借方 科目を選択', exact: true })
        .selectOption('5020');
      await page
        .getByRole('combobox', { name: '貸方 科目を選択', exact: true })
        .selectOption('4110');
      for (const select of await page
        .getByRole('combobox', { name: '商品を選択（任意・在庫管理）', exact: true })
        .all()) {
        await select.selectOption('i1');
      }
      await expect(page.getByPlaceholder('数量')).toHaveCount(2);
    },
  },
  {
    name: '仕訳フォーム：補助科目のある普通預金を借方・貸方に選ぶ',
    path: '/',
    drive: async (page) => {
      await page
        .getByRole('combobox', { name: '借方 科目を選択', exact: true })
        .selectOption('1130');
      await page
        .getByRole('combobox', { name: '貸方 科目を選択', exact: true })
        .selectOption('1130');
      await expect(
        page.getByRole('combobox', { name: '補助科目を選択（任意）', exact: true }),
      ).toHaveCount(2);
    },
  },
  {
    name: '所得控除：給与所得・配偶者・不動産所得の内訳・扶養親族・専従者の欄を出す',
    path: '/income-deductions',
    drive: async (page) => {
      await page.getByRole('checkbox', { name: /給与所得がある/ }).check();
      await page.getByRole('checkbox', { name: '配偶者がいる' }).check();
      for (const heading of [
        '地代家賃の内訳',
        '借入金利子の内訳',
        '税理士・弁護士等の報酬・料金の内訳',
        '扶養親族',
        '事業専従者（白色申告）',
      ]) {
        await addRowUnder(page, heading);
      }
      await expect(page.locator('[name$="-incomeType"]')).toBeVisible();
    },
  },
  {
    name: '開業設定：開業費を 1 件足し、任意償却の額の欄を出す',
    path: '/opening-setup',
    drive: async (page) => {
      await page.locator('[name=openingKeihiTitle]').fill('名刺作成');
      await page.locator('[name=openingKeihiAmount]').fill('3000');
      await page
        .locator('form')
        .filter({ has: page.locator('[name=openingKeihiTitle]') })
        .getByRole('button', { name: '追加' })
        .click();
      await page.getByRole('radio', { name: '任意償却（所令137条3項）' }).check();
      await expect(page.locator('[name=openingKeihiCustomAmortization]')).toBeVisible();
    },
  },
  {
    name: '請求書：新規作成フォームを開く',
    path: '/invoices',
    drive: async (page) => {
      await page.getByRole('button', { name: '新規作成' }).click();
      await expect(page.locator('[name=invoiceMemo]')).toBeVisible();
    },
  },
  {
    name: 'CSV 取込：見本 CSV を読み込み、1 行目の相手科目を補助科目のある口座にする',
    path: '/import',
    drive: async (page) => {
      await page.locator('[name=importParser]').selectOption('sbi-shinsei');
      await page
        .locator('input[type=file][accept*=".csv"]')
        .setInputFiles(
          fileURLToPath(new URL('../src/parsers/fixtures/sbi-shinsei-sample.csv', import.meta.url)),
        );
      const counterpart = page.locator('[name="import-0-counterpart"]');
      // 科目の選択肢は開くまで作られない（AccountSelect）。
      await counterpart.focus();
      await counterpart.selectOption('1130');
      await expect(page.locator('[name="import-0-subaccount"]')).toBeVisible();
    },
  },
  {
    name: '注文取込：AI の応答を差し替えて解析し、確認表を出す',
    path: '/order-import',
    before: async (page) => {
      await useMockGemini(page, {
        date: '2026-10-01',
        vendor: 'サンプル商店',
        orderNumber: 'A-0001',
        totalAmount: '3300',
        items: [{ description: 'サンプル品', amount: '3300' }],
      });
    },
    drive: async (page) => {
      await page
        .getByRole('textbox', { name: '1. 注文ページのテキストを貼り付け' })
        .fill('サンプル注文 3,300 円');
      await page.getByRole('button', { name: '解析する' }).click();
      await page.getByRole('button', { name: '送信する' }).click();
      await expect(page.locator('[name=orderPaymentAccount]')).toBeVisible();
    },
  },
  {
    // 読み取りエンジンの選択欄はネイティブ版で文字認識が使えるときだけ出るため、ここでは出ない。
    name: '領収書：AI の応答を差し替えて解析し、確認欄を出す',
    path: '/receipt',
    before: async (page) => {
      await useMockGemini(page, {
        date: '2026-10-01',
        vendorName: 'サンプル商店',
        totalAmount: '1100',
        items: [{ description: 'サンプル品', amount: '1100' }],
        taxRate: 0.1,
      });
    },
    drive: async (page) => {
      await page.locator('input[type=file][accept*="image"]').setInputFiles({
        name: 'receipt.png',
        mimeType: 'image/png',
        buffer: ONE_PIXEL_PNG,
      });
      await page.getByRole('button', { name: '添付する' }).click();
      await page.getByRole('button', { name: '解析する' }).click();
      await page.getByRole('button', { name: '送信する' }).click();
      await expect(page.locator('[name=receiptKnownAccount]')).toBeVisible();
    },
  },
  {
    name: '設定：簡易課税・リース期間定額法・少額特例・物件明細・除却/売却・譲渡所得・AI のモデル選択を出す',
    path: '/settings',
    before: async (page) => {
      await page.route('https://generativelanguage.googleapis.com/v1beta/models?*', (route) =>
        route.fulfill({
          json: {
            models: [
              {
                name: `models/${MOCK_GEMINI_MODEL}`,
                supportedGenerationMethods: ['generateContent'],
              },
            ],
          },
        }),
      );
      await page.route('http://localhost:11434/v1/models', (route) =>
        route.fulfill({ json: { data: [{ id: 'form-audit-model' }] } }),
      );
    },
    drive: async (page, observe) => {
      await expect(page.getByText('サンプル機材')).toBeVisible();
      await waitForSettingsLoaded(page);
      await page.locator('[name=taxFilingMethod]').selectOption('simplified');
      await expect(page.locator('[name=simplifiedTaxCategory]')).toBeVisible();
      await observe();
      await page.locator('[name=assetMethod]').selectOption('lease-period-straight-line');
      await expect(page.locator('[name=assetLeaseTermMonths]')).toBeVisible();
      await observe();
      await page.locator('[name=assetMethod]').selectOption('small-asset-special');
      await expect(page.locator('[name=assetEmployeeCount]')).toBeVisible();
      await page.getByRole('button', { name: '物件明細' }).click();
      await expect(page.locator('[name=propertyDepositBalance]')).toBeVisible();
      await page.getByRole('button', { name: '除却・売却', exact: true }).click();
      await page.getByRole('radio', { name: '売却', exact: true }).check();
      await expect(page.locator('[name=disposeCashAccount]')).toBeVisible();
      await observe();
      await page.locator('[name=disposeDate]').fill('2026-10-01');
      await page.locator('[name=disposeSalePrice]').fill('150000');
      await page
        .getByRole('row')
        .filter({ has: page.locator('[name=disposeDate]') })
        .getByRole('button', { name: '保存' })
        .click();
      await expect(page.locator('[name=transferOccasionalIncome]')).toBeVisible();
      await page.locator('[name=geminiApiKey]').fill('form-audit-dummy-key');
      await page.getByRole('button', { name: 'モデル一覧取得' }).click();
      await expect(page.locator('[name=geminiModelSelect]')).toBeVisible();
      await observe();
      await page.locator('[name=aiEngine]').selectOption('openai-compatible');
      await expect(page.locator('[name=openaiClassifyModelMei]')).toBeVisible();
      await observe();
      await page.locator('[name=openaiBaseUrl]').fill('http://localhost:11434/v1');
      await page.getByRole('button', { name: 'モデル一覧取得' }).click();
      await expect(page.locator('[name=openaiClassifyModelSelect]')).toBeVisible();
    },
  },
  {
    name: '集計：売掛を 1 件登録し、特定少額資産の譲渡・中間申告の期・申告済みロックの方式を出す',
    path: '/reports',
    drive: async (page) => {
      const arap = page
        .locator('section')
        .filter({ has: page.getByRole('heading', { name: '売掛金・買掛金', exact: true }) });
      await arap.locator('[name=arapDescription]').fill('サンプル請求');
      await arap.locator('[name=arapDueDate]').fill('2026-12-31');
      await arap.locator('[name=arapAmount]').fill('1000');
      await arap.getByRole('button', { name: '追加', exact: true }).click();
      await expect(arap.getByPlaceholder('金額')).toBeVisible();
      await page
        .getByText('特定少額資産の譲渡（3 割特例の基礎から控除）', { exact: true })
        .locator('..')
        .getByRole('button', { name: '追加', exact: true })
        .click();
      await expect(page.locator('[name="wariTransfer-netTax-0"]')).toBeVisible();
      await page.locator('[name=interimPriorNenAmount]').fill('600000');
      await expect(page.locator('[name=interimInstallment]')).toBeVisible();
      await page.getByRole('button', { name: '申告済みとしてロック' }).click();
      await expect(page.locator('[name=lockMethod]')).toBeVisible();
    },
  },
];
for (const state of CONDITIONAL_STATES) {
  test(`条件付きの部品：${state.name}`, async ({ page }) => {
    await restoreSeed(page);
    await state.before?.(page);
    const audit = await startAudit(page);
    await page.goto(state.path);
    await state.drive(page, audit.observe);
    await audit.observe();
    await audit.stop();
    expect(audit.nodes(), `${audit.nodes().length} 件`).toEqual([]);
    expect(audit.duplicates()).toEqual([]);
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
