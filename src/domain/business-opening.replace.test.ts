// 開業仕訳の打消し・作成・開業日／廃業日の設定値を 1 つの取引で書く（H1・H3）。
// A 類：修正前に失敗するもの。replaceOpeningEntries を呼ぶものは修正前は関数が無く実行できない（画面層の対応する A 類で補う）。
// B 類：修正前後とも通るもの。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../db/db';
import { getSetting, setSetting } from '../lib/settings';
import { generateYearEndDepreciation } from './depreciation';
import {
  generateOpeningEntries,
  replaceOpeningEntries,
  type OpeningSetupInput,
} from './business-opening';

beforeEach(async () => {
  await db.delete();
  await db.open();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await db.delete();
});

function input(start: string, overrides: Partial<OpeningSetupInput> = {}): OpeningSetupInput {
  return {
    businessStartDate: start,
    expenses: [{ name: '名刺', amount: '10000' }],
    expenseAmortization: 'immediate',
    convertedAssets: [],
    customItems: [],
    ...overrides,
  };
}

function withAsset(start: string): OpeningSetupInput {
  return input(start, {
    convertedAssets: [
      {
        name: '私用PC',
        acquisitionDate: '2024-01-01',
        acquisitionCost: '300000',
        usefulLifeYears: 4,
        accountCode: '1510',
        depreciationMethod: 'straight-line',
      },
    ],
  });
}

async function openings(year: number, status: 'confirmed' | 'reversed' = 'confirmed') {
  return (await db.journalEntries.where('year').equals(year).toArray()).filter(
    (e) => e.source === 'opening' && e.status === status && e.originalEntryId === undefined,
  );
}

async function reversals(): Promise<number> {
  return (await db.journalEntries.toArray()).filter((e) => e.originalEntryId !== undefined).length;
}

describe('replaceOpeningEntries（A 類・修正前は関数が無く実行できない）', () => {
  it('R1：作成の明細の書き込みが失敗したら、打消しも資産の削除もせず設定値も変えない（画面層 R1 と対）', async () => {
    await generateOpeningEntries(withAsset('2026-07-01'));
    await setSetting('businessStartDate', '2026-07-01');
    vi.spyOn(db.journalLines, 'bulkAdd').mockRejectedValue(new Error('書き込み失敗（試験）'));
    const outcome = await replaceOpeningEntries(
      {
        reverseYear: 2026,
        input: withAsset('2026-08-01'),
        formClose: '',
        expectedStoredClose: undefined,
      },
      { allowFiledYear: true },
    ).catch((e: unknown) => e);
    expect(await openings(2026)).toHaveLength(3);
    expect(await openings(2026, 'reversed')).toHaveLength(0);
    expect(await reversals()).toBe(0);
    expect((await db.fixedAssets.toArray()).map((a) => a.name)).toEqual(['私用PC']);
    expect(await getSetting('businessStartDate')).toBe('2026-07-01');
    expect(outcome).toBeInstanceOf(Error);
  });

  it('打ち消した後に作成側が既存ありを返したら（試験用に差し込む）すべて取り消す（画面層 S7 と対）', async () => {
    await generateOpeningEntries(input('2026-07-01'));
    const seeded = (await openings(2026)).length;
    const original = db.journalEntries.update.bind(db.journalEntries);
    let injected = false;
    vi.spyOn(db.journalEntries, 'update').mockImplementation((async (
      ...args: Parameters<typeof original>
    ) => {
      const r = await original(...args);
      if (!injected) {
        injected = true;
        await db.journalEntries.add({
          id: 'other-tab',
          date: '2025-10-01',
          year: 2025,
          description: '開業費計上（開業設定）',
          status: 'confirmed',
          source: 'opening',
          createdAt: 1,
          confirmedAt: 1,
        });
      }
      return r;
    }) as typeof original);
    const result = await replaceOpeningEntries(
      {
        reverseYear: 2026,
        input: input('2025-10-01'),
        formClose: '',
        expectedStoredClose: undefined,
      },
      { allowFiledYear: true },
    );
    expect(injected).toBe(true);
    expect(await openings(2026)).toHaveLength(seeded);
    expect(await reversals()).toBe(0);
    expect(await openings(2025)).toHaveLength(0);
    expect(result).toEqual({ reason: 'already-exists', year: 2025 });
  });

  it('作り直しで作る項目が無ければ打ち消さない', async () => {
    await generateOpeningEntries(input('2026-07-01'));
    const result = await replaceOpeningEntries(
      {
        reverseYear: 2026,
        input: input('2026-07-01', { expenses: [{ name: '名刺', amount: '0' }] }),
        formClose: '',
        expectedStoredClose: undefined,
      },
      { allowFiledYear: true },
    );
    expect(await reversals()).toBe(0);
    expect(await openings(2026)).toHaveLength(2);
    expect(result).toEqual({ reason: 'empty' });
  });

  it('確認の前に読んだ廃業日と取引の中で読んだ廃業日が違えば書かない', async () => {
    await generateOpeningEntries(input('2026-07-01'));
    await setSetting('businessCloseDate', '2027-03-31');
    const result = await replaceOpeningEntries(
      {
        reverseYear: 2026,
        input: input('2026-07-01'),
        formClose: '',
        expectedStoredClose: '2026-12-31',
      },
      { allowFiledYear: true },
    );
    expect(await reversals()).toBe(0);
    expect(await getSetting('businessCloseDate')).toBe('2027-03-31');
    expect(await getSetting('businessStartDate')).toBeUndefined();
    expect(result).toEqual({ reason: 'dates-changed' });
  });

  it('開業日の設定値の書き込みが失敗したら打ち消さない', async () => {
    await generateOpeningEntries(input('2026-07-01'));
    const original = db.settings.put.bind(db.settings);
    vi.spyOn(db.settings, 'put').mockImplementation(((
      row: Parameters<typeof original>[0],
      key?: Parameters<typeof original>[1],
    ) =>
      row.key === 'businessStartDate'
        ? Promise.reject(new Error('書き込み失敗（試験）'))
        : original(row, key)) as typeof original);
    const outcome = await replaceOpeningEntries(
      {
        reverseYear: 2026,
        input: input('2026-08-01'),
        formClose: '',
        expectedStoredClose: undefined,
      },
      { allowFiledYear: true },
    ).catch((e: unknown) => e);
    expect(await reversals()).toBe(0);
    expect(await openings(2026)).toHaveLength(2);
    expect(outcome).toBeInstanceOf(Error);
  });
});

describe('replaceOpeningEntries（B 類・修正前は関数が無く実行できない）', () => {
  it('開業日の変更（2026 を打ち消し 2025 を作る）は打消しと作成の入力時刻が同じで、設定値も同じ取引で書く', async () => {
    await generateOpeningEntries(withAsset('2026-07-01'));
    await setSetting('businessCloseDate', '2026-12-31');
    await setSetting('businessStartDate', '2026-07-01');
    const result = await replaceOpeningEntries(
      {
        reverseYear: 2026,
        input: input('2025-10-01'),
        formClose: '',
        expectedStoredClose: '2026-12-31',
      },
      { allowFiledYear: true },
    );
    expect('entryIds' in result).toBe(true);
    expect(await openings(2026)).toHaveLength(0);
    expect(await openings(2026, 'reversed')).toHaveLength(3);
    const created = await openings(2025);
    expect(created).toHaveLength(2);
    const reversalTimes = (await db.journalEntries.toArray())
      .filter((e) => e.originalEntryId !== undefined)
      .map((e) => e.createdAt);
    expect(new Set([...reversalTimes, ...created.map((e) => e.createdAt)]).size).toBe(1);
    expect(await db.fixedAssets.count()).toBe(0);
    expect(await getSetting('businessStartDate')).toBe('2025-10-01');
    expect(await getSetting('businessCloseDate')).toBeUndefined();
  });

  it('打ち消す年の有効な開業仕訳が無ければ何も書かない', async () => {
    const result = await replaceOpeningEntries(
      {
        reverseYear: 2026,
        input: input('2026-07-01'),
        formClose: '',
        expectedStoredClose: undefined,
      },
      { allowFiledYear: true },
    );
    expect(result).toEqual({ reason: 'nothing-to-reverse' });
    expect(await db.journalEntries.count()).toBe(0);
    expect(await getSetting('businessStartDate')).toBeUndefined();
  });

  it('作る年に有効な開業仕訳が既にあれば打ち消さない', async () => {
    await generateOpeningEntries(input('2026-07-01'));
    await generateOpeningEntries(input('2025-10-01'));
    const result = await replaceOpeningEntries(
      {
        reverseYear: 2026,
        input: input('2025-10-01'),
        formClose: '',
        expectedStoredClose: undefined,
      },
      { allowFiledYear: true },
    );
    expect(result).toEqual({ reason: 'already-exists', year: 2025 });
    expect(await reversals()).toBe(0);
  });

  it('打ち消す年の資産に償却仕訳があれば何も書かない', async () => {
    await generateOpeningEntries(withAsset('2026-07-01'));
    await generateYearEndDepreciation(2026, { allowFiledYear: true });
    const before = await db.journalEntries.count();
    const result = await replaceOpeningEntries(
      {
        reverseYear: 2026,
        input: input('2025-10-01'),
        formClose: '',
        expectedStoredClose: undefined,
      },
      { allowFiledYear: true },
    );
    expect(result).toEqual({ reason: 'has-depreciation', assetNames: ['私用PC'] });
    expect(await db.journalEntries.count()).toBe(before);
    expect(await getSetting('businessStartDate')).toBeUndefined();
  });

  it('廃業日が空欄なら、開業日より前の保存済みの廃業日は残し、読めない値には触らない', async () => {
    await generateOpeningEntries(input('2026-07-01'));
    await setSetting('businessCloseDate', '2024-03-31');
    await replaceOpeningEntries(
      {
        reverseYear: 2026,
        input: input('2026-07-01'),
        formClose: '',
        expectedStoredClose: '2024-03-31',
      },
      { allowFiledYear: true },
    );
    expect(await getSetting('businessCloseDate')).toBe('2024-03-31');
    await db.settings.put({ key: 'businessCloseDate', value: '2026/12/31', updatedAt: 1 });
    await replaceOpeningEntries(
      {
        reverseYear: 2026,
        input: input('2026-07-01'),
        formClose: '',
        expectedStoredClose: '2026/12/31',
      },
      { allowFiledYear: true },
    );
    expect(await getSetting('businessCloseDate')).toBe('2026/12/31');
    await replaceOpeningEntries(
      {
        reverseYear: 2026,
        input: input('2026-07-01'),
        formClose: '2027-06-30',
        expectedStoredClose: '2026/12/31',
      },
      { allowFiledYear: true },
    );
    expect(await getSetting('businessCloseDate')).toBe('2027-06-30');
  });
});

describe('generateOpeningEntries の日付設定（dateSettings）', () => {
  it('A 類：開業日の設定値の書き込みが失敗したら開業仕訳・資産を作らない', async () => {
    const original = db.settings.put.bind(db.settings);
    vi.spyOn(db.settings, 'put').mockImplementation(((
      row: Parameters<typeof original>[0],
      key?: Parameters<typeof original>[1],
    ) =>
      row.key === 'businessStartDate'
        ? Promise.reject(new Error('書き込み失敗（試験）'))
        : original(row, key)) as typeof original);
    const outcome = await generateOpeningEntries(withAsset('2026-07-01'), {
      allowFiledYear: true,
      dateSettings: { formClose: '', expectedStoredClose: undefined },
    }).catch((e: unknown) => e);
    expect(await db.journalEntries.count()).toBe(0);
    expect(await db.fixedAssets.count()).toBe(0);
    expect(outcome).toBeInstanceOf(Error);
  });

  it('A 類：確認の前に読んだ廃業日と取引の中の廃業日が違えば作らない', async () => {
    await setSetting('businessCloseDate', '2027-03-31');
    const result = await generateOpeningEntries(input('2026-07-01'), {
      allowFiledYear: true,
      dateSettings: { formClose: '', expectedStoredClose: '2026-12-31' },
    });
    expect(await db.journalEntries.count()).toBe(0);
    expect(await getSetting('businessCloseDate')).toBe('2027-03-31');
    expect(result).toEqual({ reason: 'dates-changed' });
  });

  it('A 類：作成と同じ取引で開業日を書き、開業日以後の保存済みの廃業日は消す', async () => {
    await setSetting('businessCloseDate', '2026-12-31');
    await generateOpeningEntries(input('2026-07-01'), {
      allowFiledYear: true,
      dateSettings: { formClose: '', expectedStoredClose: '2026-12-31' },
    });
    expect(await getSetting('businessStartDate')).toBe('2026-07-01');
    expect(await getSetting('businessCloseDate')).toBeUndefined();
  });

  it('B 類：既に開業仕訳がある年は作らず、設定値も書かない', async () => {
    await generateOpeningEntries(input('2026-07-01'));
    const result = await generateOpeningEntries(input('2026-08-01'), {
      allowFiledYear: true,
      dateSettings: { formClose: '2026-12-31', expectedStoredClose: undefined },
    });
    expect(result).toEqual({ reason: 'already-exists' });
    expect(await getSetting('businessStartDate')).toBeUndefined();
    expect(await getSetting('businessCloseDate')).toBeUndefined();
  });

  it('B 類：保存済みの値が空文字列でも、未設定と同じとして比べる', async () => {
    await db.settings.put({ key: 'businessCloseDate', value: '', updatedAt: 1 });
    const result = await generateOpeningEntries(input('2026-07-01'), {
      allowFiledYear: true,
      dateSettings: { formClose: '', expectedStoredClose: undefined },
    });
    expect('entryIds' in result).toBe(true);
  });
});
