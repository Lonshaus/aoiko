import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { db } from '../db/db';
import { getSetting } from '../lib/settings';
import { computeConvertedAssetBasis, generateOpeningEntries } from './business-opening';
import { m } from '../paraglide/messages';

beforeEach(async () => {
  await db.delete();
  await db.open();
});

afterEach(async () => {
  await db.delete();
});

describe('開業日より後に取得した転用資産', () => {
  test('取得日が開業日の翌日なら作らずに理由を示し、同じ日なら私用期間の減価は 0', () => {
    expect(() => computeConvertedAssetBasis('2026-07-02', '2026-07-01', '300000', 4)).toThrow(
      m.opening_asset_acquired_after_start({
        acquisitionDate: '2026-07-02',
        businessStartDate: '2026-07-01',
      }),
    );
    const same = computeConvertedAssetBasis('2026-07-01', '2026-07-01', '300000', 4);
    expect(same.nonBusinessDepreciation.toString()).toBe('0');
    expect(same.businessStartBasis.toString()).toBe('300000');
  });

  test.each([
    ['2026-02-30', '2026-07-01', m.opening_converted_acq_date_title],
    ['2026-01-01', '2026/07/01', m.opening_start_date_title],
    ['', '2026-07-01', m.opening_converted_acq_date_title],
  ])('日付として読めない %j / %j は日付の誤りとして止める', (acq, start, label) => {
    expect(() => computeConvertedAssetBasis(acq, start, '300000', 4)).toThrow(
      m.fixed_asset_issue_date({ field: label() }),
    );
  });

  test('開業費と一緒に作っても、何も書かずに止める', async () => {
    await expect(
      generateOpeningEntries(
        {
          businessStartDate: '2026-07-01',
          expenses: [{ name: '名刺', amount: '10000' }],
          expenseAmortization: 'immediate',
          convertedAssets: [
            {
              name: '未来PC',
              acquisitionDate: '2027-01-01',
              acquisitionCost: '300000',
              usefulLifeYears: 4,
              accountCode: '1510',
              depreciationMethod: 'straight-line',
            },
          ],
          customItems: [],
        },
        { allowFiledYear: true },
      ),
    ).rejects.toThrow('未来PC');
    expect(await db.journalEntries.count()).toBe(0);
    expect(await db.journalLines.count()).toBe(0);
    expect(await db.fixedAssets.count()).toBe(0);
    expect(await getSetting('businessStartDate')).toBeUndefined();
  });
});
