import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { db } from '../db/db';
import { setSetting } from '../lib/settings';
import {
  generateYearEndDepreciation,
  InvalidBusinessDateError,
  loadEffectiveBusinessDates,
  readBusinessDateSources,
  selectEffectiveBusinessDates,
  type BusinessDateSources,
} from './depreciation';
import { generateDisposalEntry } from './asset-disposal';
import { findInvalidStoredAmounts } from './stored-value-checks';
import { m } from '../paraglide/messages';
import type { FixedAsset, JournalEntry } from '../db/types';

const opts = { allowFiledYear: true } as const;

function opening(id: string, date: string, extra: Partial<JournalEntry> = {}): JournalEntry {
  return {
    id,
    date,
    year: Number(String(date).slice(0, 4)),
    description: '開業費計上（開業設定）',
    status: 'confirmed',
    source: 'opening',
    createdAt: 1,
    confirmedAt: 1,
    ...extra,
  };
}

function smallAsset(i: number, overrides: Partial<FixedAsset> = {}): FixedAsset {
  return {
    id: `asset-${i}`,
    name: `PC${i}`,
    acquisitionDate: `2026-08-0${i}`,
    acquisitionCost: '290000',
    usefulLifeYears: 4,
    depreciationMethod: 'small-asset-special',
    accountCode: '1510',
    ...overrides,
  };
}

async function debitTotal(): Promise<number> {
  const lines = await db.journalLines.where('side').equals('debit').toArray();
  return lines.reduce((s, l) => s + Number(l.amount), 0);
}

function sources(overrides: Partial<BusinessDateSources> = {}): BusinessDateSources {
  return { openingStartByYear: new Map(), invalidOpeningDates: [], ...overrides };
}

beforeEach(async () => {
  await db.delete();
  await db.open();
});

afterEach(async () => {
  await db.delete();
});

describe('readBusinessDateSources', () => {
  test('年ごとに最も早い有効な開業仕訳の日付を集め、読めない日付は記録して飛ばす', async () => {
    await db.journalEntries.bulkAdd([
      opening('a', '2026-07-01'),
      opening('b', '2026-09-01'),
      opening('c', '2023-05-01'),
      opening('bad', '2026-02-30'),
      opening('rev', '2025-01-01', { status: 'reversed' }),
      opening('fix', '2024-01-01', { originalEntryId: 'x' }),
      { ...opening('manual', '2022-01-01'), source: 'manual' },
    ]);
    await setSetting('businessStartDate', '2027-04-01');
    await setSetting('businessCloseDate', '2026/12/31');
    const s = await readBusinessDateSources();
    expect([...s.openingStartByYear]).toEqual([
      [2023, '2023-05-01'],
      [2026, '2026-07-01'],
    ]);
    expect(s.invalidOpeningDates).toEqual(['2026-02-30']);
    expect(s.settingStart).toEqual({ value: '2027-04-01', valid: true });
    expect(s.settingClose).toEqual({ value: '2026/12/31', valid: false });
  });

  test('設定が無い・空文字は未設定として読む', async () => {
    await setSetting('businessStartDate', '');
    const s = await readBusinessDateSources();
    expect(s.settingStart).toBeUndefined();
    expect(s.settingClose).toBeUndefined();
  });
});

describe('selectEffectiveBusinessDates', () => {
  test('開業仕訳のある年はその日付、無い年だけ設定値を使う', () => {
    const byYear = new Map([[2023, '2023-05-01']]);
    const used = selectEffectiveBusinessDates(
      sources({ openingStartByYear: byYear, settingStart: { value: '2026-07-01', valid: true } }),
    );
    expect(used.businessStartDates).toEqual(['2023-05-01', '2026-07-01']);
    expect(used.startSources).toEqual([
      { year: 2023, date: '2023-05-01', source: 'opening-entry' },
      { year: 2026, date: '2026-07-01', source: 'setting' },
    ]);
    const unused = selectEffectiveBusinessDates(
      sources({ openingStartByYear: byYear, settingStart: { value: '2023-01-01', valid: true } }),
    );
    expect(unused.businessStartDates).toEqual(['2023-05-01']);
    expect(unused.issues).toEqual([]);
  });

  test('読めない設定値と、その年の開業日が無い読めない開業仕訳を問題として返す', () => {
    const r = selectEffectiveBusinessDates(
      sources({
        settingStart: { value: '2026/07/01', valid: false },
        settingClose: { value: 5, valid: false },
        invalidOpeningDates: ['2026-02-30'],
      }),
    );
    expect(r.issues).toEqual([
      { source: 'setting-start', value: '2026/07/01' },
      { source: 'setting-close', value: '5' },
      { source: 'opening-entry', value: '2026-02-30' },
    ]);
    expect(r.businessStartDates).toEqual([]);
    expect(r.businessCloseDate).toBeUndefined();
  });

  test('読めない開業仕訳の年に開業日があれば問題にしない。年が読めなければ開業日が 1 つでもあればよい', () => {
    const covered = selectEffectiveBusinessDates(
      sources({
        settingStart: { value: '2026-03-01', valid: true },
        invalidOpeningDates: ['2026-02-30', 'xx'],
      }),
    );
    expect(covered.issues).toEqual([]);
    expect(covered.businessStartDates).toEqual(['2026-03-01']);
    const other = selectEffectiveBusinessDates(
      sources({
        openingStartByYear: new Map([[2025, '2025-04-01']]),
        invalidOpeningDates: ['2026-02-30'],
      }),
    );
    expect(other.issues).toEqual([{ source: 'opening-entry', value: '2026-02-30' }]);
  });
});

describe('InvalidBusinessDateError の文言は値の出どころで変わる', () => {
  test.each([
    ['setting-start', m.business_date_invalid_setting_start],
    ['setting-close', m.business_date_invalid_setting_close],
    ['opening-entry', m.business_date_invalid_opening_entry],
    ['argument', m.business_date_invalid_argument],
  ] as const)('%s', (source, message) => {
    const e = new InvalidBusinessDateError(source, '2026/07/01');
    expect(e.source).toBe(source);
    expect(e.message).toBe(message({ value: '2026/07/01' }));
    expect(e.message).toContain('2026/07/01');
  });

  test('loadEffectiveBusinessDates は最初の問題を出どころ付きで投げる', async () => {
    await db.journalEntries.add(opening('bad', '2026-02-30'));
    await expect(loadEffectiveBusinessDates()).rejects.toThrow(
      m.business_date_invalid_opening_entry({ value: '2026-02-30' }),
    );
    await setSetting('businessStartDate', '2026-03-01');
    expect(await loadEffectiveBusinessDates()).toEqual({ businessStartDates: ['2026-03-01'] });
  });
});

describe('年末の減価償却が使う開業日・廃業日', () => {
  test('引数なしでも保存済みの廃業日で月割し、引数で渡した廃業日はそれより優先する', async () => {
    await setSetting('businessCloseDate', '2026-09-30');
    for (const year of [2026, 2027]) {
      for (let i = 0; i < 6; i++) {
        await db.fixedAssets.add(
          smallAsset(i, {
            id: `asset-${year}-${i}`,
            acquisitionDate: `${year}-0${i + 4}-01`,
            acquisitionCost: '399999',
          }),
        );
      }
    }
    // 399,999 × 5 = 1,999,995、6 件目で 9 か月分の 2,250,000 を超える
    expect((await generateYearEndDepreciation(2026, opts)).smallAssetCapExceeded).toBe(1);
    expect(
      (await generateYearEndDepreciation(2027, { ...opts, businessCloseDate: '2027-09-30' }))
        .smallAssetCapExceeded,
    ).toBe(1);
  });

  test('保存済みの開業日が読めなくても、引数で開業日を渡せば止めない', async () => {
    await setSetting('businessStartDate', '2026/07/01');
    await db.fixedAssets.add(smallAsset(1));
    await expect(
      generateYearEndDepreciation(2026, { ...opts, businessStartDates: ['2026-07-01'] }),
    ).resolves.toMatchObject({ created: 1 });
    await expect(generateYearEndDepreciation(2027, opts)).rejects.toThrow(
      m.business_date_invalid_setting_start({ value: '2026/07/01' }),
    );
  });

  test('引数の日付が読めなければ出どころ argument で止める', async () => {
    await db.fixedAssets.add(smallAsset(1));
    await expect(
      generateYearEndDepreciation(2026, { ...opts, businessStartDates: ['2026-13-01'] }),
    ).rejects.toThrow(m.business_date_invalid_argument({ value: '2026-13-01' }));
  });

  test('開業設定の値が無くても開業仕訳の日付で月割し、保存済みの開業日より開業仕訳を優先する', async () => {
    await db.journalEntries.add(opening('op', '2026-07-01'));
    await setSetting('businessStartDate', '2026-01-01');
    await db.fixedAssets.bulkAdd([1, 2, 3, 4, 5, 6].map((i) => smallAsset(i)));
    expect(await loadEffectiveBusinessDates()).toEqual({ businessStartDates: ['2026-07-01'] });
    const r = await generateYearEndDepreciation(2026, opts);
    expect(r.smallAssetCapExceeded).toBe(1);
    expect(await debitTotal()).toBe(1480208);
  });

  test('同じ年に廃業 3/31・再開業 7/1 でも止めず、上限は 300 万円の 9/12', async () => {
    await db.journalEntries.add(opening('op', '2026-07-01'));
    await setSetting('businessCloseDate', '2026-03-31');
    await db.fixedAssets.bulkAdd([1, 2, 3, 4, 5, 6, 7, 8].map((i) => smallAsset(i)));
    const r = await generateYearEndDepreciation(2026, opts);
    // 290,000 × 7 = 2,030,000 は 2,250,000 以内、8 件目で超える
    expect(r.smallAssetCapExceeded).toBe(1);
    expect(r.created).toBe(8);
  });
});

describe('除却・保存値の検査も年末の減価償却と同じ開業日を使う', () => {
  test('開業仕訳の日付で枠を外れた資産は、除却でも通常の償却後の帳簿価額を落とす', async () => {
    await db.journalEntries.add(opening('op', '2026-07-01'));
    await db.fixedAssets.bulkAdd([1, 2, 3, 4, 5, 6].map((i) => smallAsset(i)));
    await generateYearEndDepreciation(2026, opts);
    await db.fixedAssets.update('asset-6', { disposedDate: '2026-12-31', disposalType: 'scrap' });
    expect(await generateDisposalEntry('asset-6', '1110', opts)).toEqual({ created: true });
    const entry = (await db.journalEntries.toArray()).find((e) =>
      e.description.startsWith('固定資産除却'),
    )!;
    const lines = await db.journalLines.where('entryId').equals(entry.id).toArray();
    expect(lines.find((l) => l.accountCode === '5280')?.amount).toBe('259792');
  });

  test('枠を外れると計算できない資産は、.xtx 前の検査でも年末の減価償却でも同じく止まる', async () => {
    await db.journalEntries.add(opening('op', '2026-07-01'));
    await db.fixedAssets.bulkAdd([
      ...[1, 2, 3, 4, 5].map((i) => smallAsset(i)),
      smallAsset(6, { usefulLifeYears: 1, decliningBalanceElected: true }),
    ]);
    const found = await findInvalidStoredAmounts(2026, 'income');
    expect(found.join(' ')).toContain('PC6');
    await expect(generateYearEndDepreciation(2026, opts)).rejects.toThrow('PC6');
  });
});
