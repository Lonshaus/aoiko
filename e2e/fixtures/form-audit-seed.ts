import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
// 同意画面を出さないよう、今要求されている同意バージョンを原文から読む。
export function readDisclaimerVersion(): number {
  const source = readFileSync(
    fileURLToPath(new URL('../../src/lib/settings.ts', import.meta.url)),
    'utf-8',
  );
  const match = /export const DISCLAIMER_VERSION = (\d+);/.exec(source);
  if (match === null) {
    throw new Error('settings.ts から DISCLAIMER_VERSION を読めない');
  }
  return Number(match[1]);
}
// 全て架空の値：確定仕訳 19 件に、取引先・固定資産・自動分類ルール・補助科目・商品を 1 件ずつ足した復元用バックアップ。
const ENTRIES: ReadonlyArray<readonly [string, string, string, string, number]> = [
  ['01-10', 'デザイン制作売上', '1110', '4110', 120000],
  ['01-25', '事務所電気代', '5130', '1110', 8200],
  ['02-05', '納品売上（雑貨）', '1110', '4110', 95000],
  ['02-15', 'インターネット通信費', '5150', '1110', 6600],
  ['02-28', '名刺・封筒印刷代', '5200', '1110', 4400],
  ['03-10', '制作物売上', '1110', '4110', 150000],
  ['03-20', '広告掲載費', '5160', '1110', 15000],
  ['04-08', '継続契約売上', '1110', '4110', 110000],
  ['04-22', '事務所電気代', '5130', '1110', 7900],
  ['05-12', 'ワークショップ売上', '1110', '4110', 80000],
  ['05-25', '文房具・消耗品購入', '5200', '1110', 3300],
  ['06-15', '制作物売上', '1110', '4110', 135000],
  ['06-25', 'インターネット通信費', '5150', '1110', 6600],
  ['07-10', '納品売上（雑貨）', '1110', '4110', 98000],
  ['07-28', '事務所電気代', '5130', '1110', 9100],
  ['10-05', '広告掲載費', '5160', '1110', 12000],
  ['10-07', '継続契約売上', '1110', '4110', 110000],
  ['10-12', '制作物売上', '1110', '4110', 142000],
  ['10-18', '事務所電気代', '5130', '1110', 8600],
];
const BASE_TIME = 1781000000000;
export function buildFormAuditBackup(disclaimerVersion: number): string {
  const journalEntries: object[] = [];
  const journalLines: object[] = [];
  ENTRIES.forEach(([date, description, debit, credit, amount], index) => {
    const id = `e${String(index + 1).padStart(2, '0')}`;
    const at = BASE_TIME + (index + 1) * 1000;
    journalEntries.push({
      id,
      date: `2026-${date}`,
      year: 2026,
      description,
      status: 'confirmed',
      source: 'manual',
      createdAt: at,
      confirmedAt: at,
    });
    for (const [side, accountCode] of [
      ['debit', debit],
      ['credit', credit],
    ] as const) {
      journalLines.push({
        id: `${id}-${side === 'debit' ? 'd' : 'c'}`,
        entryId: id,
        side,
        accountCode,
        amount: String(amount),
        amountIndexed: `${String(amount).padStart(14, '0')}.00`,
        taxRate: 0,
        taxIncluded: true,
        invoiceCompliant: false,
      });
    }
  });
  const settingValues: Record<string, unknown> = {
    currentYear: 2026,
    userRiyoshaId: '9999999999999999',
    userFilerName: 'サンプル 花子',
    userFilerZip: '0000000',
    userFilerAddress: 'サンプル県サンプル市1-2-3',
    userZeimushoCode: '01108',
    userZeimushoName: 'サンプル',
    disclaimerAcceptedAt: BASE_TIME,
    disclaimerAcceptedVersion: disclaimerVersion,
    lastDownloadAt: BASE_TIME,
  };
  const settings = Object.entries(settingValues).map(([key, value]) => ({
    key,
    value,
    updatedAt: BASE_TIME,
  }));
  return JSON.stringify({
    version: 1,
    exportedAt: '2026-10-04T00:00:00.000Z',
    tables: {
      journalEntries,
      journalLines,
      settings,
      vendors: [
        {
          id: 'v1',
          name: 'サンプル商店',
          entityType: 'corporation',
          invoiceNumber: 'T0000000000000',
          defaultAccountCode: '5200',
          address: 'サンプル県サンプル市4-5-6',
        },
      ],
      fixedAssets: [
        {
          id: 'fa1',
          name: 'サンプル機材',
          acquisitionDate: '2026-04-01',
          acquisitionCost: '200000',
          usefulLifeYears: 4,
          depreciationMethod: 'straight-line',
          accountCode: '1510',
        },
      ],
      parserRules: [
        {
          id: 'r1',
          matchType: 'description-includes',
          pattern: 'sample',
          vendorId: 'v1',
          accountCode: '5200',
          priority: 10,
          hitCount: 0,
        },
      ],
      subAccounts: [{ id: 's1', accountCode: '1120', name: 'サンプル銀行 本店' }],
      inventoryItems: [{ id: 'i1', name: 'サンプル商品' }],
    },
  });
}
