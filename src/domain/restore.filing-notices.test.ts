import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { db } from '../db/db';
import { buildPayload, PAYLOAD_VERSION } from '../backup';
import { BACKUP_PART_IDS } from '../backup/parts';
import type { PersonalDeductionInput } from '../db/types';
import {
  inspectBackupPayload,
  parseBackupJson,
  restoreFromJson,
  restoreFromPayload,
} from './restore';
import { BackupValidationError } from './restore-validate';

const base: PersonalDeductionInput = {
  year: 2026,
  socialInsurancePaid: '0',
  smallBusinessMutualAidPaid: '0',
  lifeInsurance: {},
  earthquakeInsurancePaid: '0',
  oldLongTermInsurancePaid: '0',
  medicalExpensePaid: '0',
  medicalInsuranceReimbursement: '0',
  donationAmount: '0',
  casualtyLossDeduction: '0',
  isDisabled: false,
  isSpecialDisabled: false,
  isSingleParent: false,
  isWidow: false,
  isWorkingStudent: false,
  dependents: [],
  updatedAt: 1,
};

const withNotices: PersonalDeductionInput = {
  ...base,
  filingNotices: {
    blueReturnWithdrawalYear: 2027,
    business: {
      closureDate: '2026-06-30',
      methodApplications: [
        {
          kind: 'change',
          assetType: 'depreciable',
          businessOrAssetType: '製造業',
          assetClass: '備品',
          newMethod: '定額法',
          currentMethod: '定率法',
          currentAdoptedYear: 2020,
          memo: '令和8年分から変更',
        },
        {
          kind: 'notice',
          assetType: 'inventory',
          businessOrAssetType: '小売業',
          assetClass: '商品',
          newMethod: '先入先出法',
        },
      ],
    },
    realEstate: { methodApplications: [] },
  },
};

function backup(row: unknown) {
  return {
    version: PAYLOAD_VERSION,
    exportedAt: '2026-11-22',
    tables: { personalDeductions: [row] },
  };
}

beforeEach(async () => {
  await db.delete();
  await db.open();
});

afterEach(async () => {
  await db.delete();
});

describe('届出事項（filingNotices）の復元', () => {
  test('届出事項を含むバックアップを復元できる', async () => {
    await restoreFromJson(backup(withNotices));
    expect(await db.personalDeductions.get(2026)).toEqual(withNotices);
  });

  test('届出事項の欄が無い従来のバックアップも復元できる', async () => {
    await restoreFromJson(backup(base));
    const restored = await db.personalDeductions.get(2026);
    expect(restored).toEqual(base);
    expect(restored).not.toHaveProperty('filingNotices');
  });

  test.each([
    ['届出事項が文字列', { ...base, filingNotices: 'x' }],
    ['取りやめ年分が文字列', { ...base, filingNotices: { blueReturnWithdrawalYear: '2027' } }],
    ['取りやめ年分が小数', { ...base, filingNotices: { blueReturnWithdrawalYear: 2027.5 } }],
    ['事業用が文字列', { ...base, filingNotices: { business: 'x' } }],
    ['明細が配列でない', { ...base, filingNotices: { business: { methodApplications: {} } } }],
    [
      '明細の区分が不正',
      {
        ...base,
        filingNotices: {
          business: {
            methodApplications: [
              {
                kind: 'other',
                assetType: 'inventory',
                businessOrAssetType: '',
                assetClass: '',
                newMethod: '',
              },
            ],
          },
        },
      },
    ],
    [
      '明細の資産種別が不正',
      {
        ...base,
        filingNotices: {
          realEstate: {
            methodApplications: [
              {
                kind: 'notice',
                assetType: 'land',
                businessOrAssetType: '',
                assetClass: '',
                newMethod: '',
              },
            ],
          },
        },
      },
    ],
    [
      '新たな方法が文字列でない',
      {
        ...base,
        filingNotices: {
          business: {
            methodApplications: [
              {
                kind: 'notice',
                assetType: 'inventory',
                businessOrAssetType: '',
                assetClass: '',
                newMethod: 1,
              },
            ],
          },
        },
      },
    ],
    [
      '採用した年が文字列',
      {
        ...base,
        filingNotices: {
          business: {
            methodApplications: [
              {
                kind: 'notice',
                assetType: 'inventory',
                businessOrAssetType: '',
                assetClass: '',
                newMethod: '',
                currentAdoptedYear: '2020',
              },
            ],
          },
        },
      },
    ],
    [
      '廃業日が日付の形式でない',
      {
        ...base,
        filingNotices: { business: { closureDate: '2026/06/30', methodApplications: [] } },
      },
    ],
    [
      '廃業日が空文字列',
      { ...base, filingNotices: { business: { closureDate: '', methodApplications: [] } } },
    ],
  ])('%s のバックアップは既存データを消さずに弾く', async (_title, row) => {
    await db.personalDeductions.put({ ...base, year: 2025 });
    await expect(restoreFromJson(backup(row))).rejects.toThrow(BackupValidationError);
    expect(await db.personalDeductions.toArray()).toEqual([{ ...base, year: 2025 }]);
  });

  test('届出事項を含む行は書き出し→復元で同じ内容に戻る', async () => {
    await db.personalDeductions.put(withNotices);
    const payload = await buildPayload({ parts: new Set(BACKUP_PART_IDS) });
    const parsed = parseBackupJson(JSON.stringify(payload));
    await db.personalDeductions.clear();
    await restoreFromPayload(parsed, new Map(), new Set(inspectBackupPayload(parsed).parts));
    expect(await db.personalDeductions.toArray()).toEqual([withNotices]);
  });
});
