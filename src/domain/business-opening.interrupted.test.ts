// 作り直しの途中で止まった年の判定（H6）と、その年の開業仕訳を元に戻すこと・転用資産の登録し直し（H7）。
// 新しい関数を呼ぶ A 類は修正前は関数が無く実行できない。対になる画面層の A 類は開業設定画面の中断年度のテストにある。
// B 類のうち既存の関数だけを使うもの（「既存の関数で通る」と書いたもの）は修正前後とも通る。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../db/db';
import { setSetting } from '../lib/settings';
import { toIndexable } from '../lib/decimal';
import { markYearFiled } from './snapshots';
import { reverseEntry } from './reverse';
import {
  dismissMissingOpeningAsset,
  findInterruptedOpeningYears,
  findMissingOpeningAssets,
  generateOpeningEntries,
  loadDismissedInterruptedOpeningYears,
  loadDismissedMissingOpeningAssets,
  OpeningRestoreAborted,
  readOpeningRecoveryState,
  registerMissingOpeningAsset,
  removeOpeningEntries,
  replaceOpeningEntries,
  restoreInterruptedOpeningEntries,
} from './business-opening';
import type { JournalLine, ReportSnapshotData } from '../db/types';

beforeEach(async () => {
  await db.delete();
  await db.open();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await db.delete();
});

async function later(): Promise<void> {
  await new Promise((r) => setTimeout(r, 5));
}

async function seedOpening(start: string, assetName?: string): Promise<void> {
  await generateOpeningEntries({
    businessStartDate: start,
    expenses: [{ name: '名刺', amount: '10000' }],
    expenseAmortization: 'immediate',
    convertedAssets: assetName
      ? [
          {
            name: assetName,
            acquisitionDate: `${Number(start.slice(0, 4)) - 2}-01-01`,
            acquisitionCost: '300000',
            usefulLifeYears: 4,
            accountCode: '1510',
            depreciationMethod: 'straight-line',
          },
        ]
      : [],
    customItems: [],
  });
}

async function interrupt(start: string, assetName?: string): Promise<void> {
  await seedOpening(start, assetName);
  await later();
  await removeOpeningEntries(Number(start.slice(0, 4)));
  await later();
}

async function lockYears(...years: number[]): Promise<void> {
  const pl: ReportSnapshotData & { type: 'pl' } = {
    type: 'pl',
    data: { rows: [], totalRevenue: '0', totalExpense: '0', netIncome: '0' },
  };
  const monthlySales: ReportSnapshotData & { type: 'monthly-sales' } = {
    type: 'monthly-sales',
    data: { months: [] },
  };
  for (const y of years) {
    await markYearFiled(y, { monthlySales, pl }, `${y}-12-31`);
  }
}

function line(
  entryId: string,
  id: string,
  side: 'debit' | 'credit',
  accountCode: string,
  amount: string,
  memo: string,
): JournalLine {
  return {
    id,
    entryId,
    side,
    accountCode,
    amount,
    amountIndexed: toIndexable(amount),
    taxRate: 0,
    taxIncluded: false,
    invoiceCompliant: false,
    memo,
  };
}

async function seedRestored(
  year: number,
  date: string,
  items: { name: string; amount: string }[],
): Promise<string> {
  const id = `restored-${year}`;
  await db.journalEntries.add({
    id,
    date,
    year,
    description: '[再計上] 開業時資産計上（開業設定）',
    status: 'confirmed',
    source: 'opening',
    createdAt: 1,
    confirmedAt: 1,
  });
  const total = items.reduce((s, i) => s + Number(i.amount), 0);
  await db.journalLines.bulkAdd([
    ...items.map((i, n) =>
      line(id, `${id}-d${n}`, 'debit', '1510', i.amount, `転用資産：${i.name}`),
    ),
    line(id, `${id}-c`, 'credit', '3110', String(total), '開業（元入金）'),
  ]);
  return id;
}
// 打ち消された元の開業仕訳の借方の明細（打消し仕訳の明細ではないもの）
async function originalLine(): Promise<JournalLine> {
  const originals = (await db.journalEntries.toArray()).filter(
    (e) => e.status === 'reversed' && e.originalEntryId === undefined,
  );
  const lines = await db.journalLines
    .where('entryId')
    .anyOf(originals.map((e) => e.id))
    .toArray();
  return lines.find((l) => l.side === 'debit')!;
}

async function restored(year: number) {
  return (await db.journalEntries.where('year').equals(year).toArray()).filter((e) =>
    e.description.startsWith('[再計上] '),
  );
}

describe('findInterruptedOpeningYears（A 類・修正前は関数が無く実行できない）', () => {
  it('R1 の結果の年を返す', async () => {
    await interrupt('2026-07-01', '私用PC');
    expect(await findInterruptedOpeningYears()).toEqual([2026]);
  });

  it('2023 に開業仕訳があり 2026 が止まっていれば 2026 だけ', async () => {
    await seedOpening('2023-04-01');
    await later();
    await interrupt('2026-07-01');
    expect(await findInterruptedOpeningYears()).toEqual([2026]);
  });

  it('作り直し（replaceOpeningEntries）で 2026→2025 を済ませた後に 2025 が止まったら 2025 だけ', async () => {
    await seedOpening('2026-07-01');
    await later();
    await replaceOpeningEntries(
      {
        reverseYear: 2026,
        input: {
          businessStartDate: '2025-10-01',
          expenses: [{ name: '名刺', amount: '10000' }],
          expenseAmortization: 'immediate',
          convertedAssets: [],
          customItems: [],
        },
        formClose: '',
        expectedStoredClose: undefined,
      },
      { allowFiledYear: true },
    );
    expect(await findInterruptedOpeningYears()).toEqual([]);
    await later();
    await removeOpeningEntries(2025);
    expect(await findInterruptedOpeningYears()).toEqual([2025]);
  });

  it('止まった後に 2027 に再開業しても 2026 を返す', async () => {
    await interrupt('2026-07-01');
    await seedOpening('2027-04-01');
    expect(await findInterruptedOpeningYears()).toEqual([2026]);
  });
});

describe('findInterruptedOpeningYears（B 類・修正前は関数が無く実行できない。画面層の B 類で修正前を確かめる）', () => {
  it('作り直しが済んだ後に新しい開業仕訳を利用者が打ち消しても返さない', async () => {
    await interrupt('2026-07-01');
    await seedOpening('2026-07-01');
    for (const e of await db.journalEntries.toArray()) {
      if (e.status === 'confirmed' && e.originalEntryId === undefined) {
        await reverseEntry(e.id);
      }
    }
    expect(await findInterruptedOpeningYears()).toEqual([]);
  });

  it('打消しの入力時刻が読めなければ返さない', async () => {
    await interrupt('2026-07-01');
    for (const e of await db.journalEntries.toArray()) {
      if (e.originalEntryId !== undefined) {
        await db.journalEntries.update(e.id, { createdAt: Number.NaN });
      }
    }
    expect(await findInterruptedOpeningYears()).toEqual([]);
  });

  it('仕訳を読めなければ空を返す', async () => {
    await interrupt('2026-07-01');
    vi.spyOn(db.journalEntries, 'each').mockRejectedValue(new Error('読み込み失敗（試験）'));
    expect(await findInterruptedOpeningYears()).toEqual([]);
  });

  it('表示しないにした年の設定は整数の配列だけを読む', async () => {
    await setSetting('dismissedInterruptedOpeningYears', [2026, 2023]);
    expect(await loadDismissedInterruptedOpeningYears()).toEqual([2026, 2023]);
    await db.settings.put({
      key: 'dismissedInterruptedOpeningYears',
      value: [2026, '2023'],
      updatedAt: 1,
    });
    expect(await loadDismissedInterruptedOpeningYears()).toEqual([]);
    await db.settings.put({ key: 'dismissedMissingOpeningAssets', value: 'a:b', updatedAt: 1 });
    expect(await loadDismissedMissingOpeningAssets()).toEqual([]);
  });
});

describe('restoreInterruptedOpeningEntries（A 類・修正前は関数が無く実行できない）', () => {
  it('同じ年に 2 回打ち消されていれば（1 回目の作り直しは済み、2 回目で止まった）最後の打消しの元の仕訳だけを戻す', async () => {
    await seedOpening('2026-07-01');
    await later();
    await removeOpeningEntries(2026);
    await later();
    await generateOpeningEntries({
      businessStartDate: '2026-07-01',
      expenses: [{ name: '看板', amount: '20000' }],
      expenseAmortization: 'immediate',
      convertedAssets: [],
      customItems: [],
    });
    await later();
    await removeOpeningEntries(2026);
    await restoreInterruptedOpeningEntries(2026, { allowFiledYear: true });
    const rows = await restored(2026);
    expect(rows).toHaveLength(2);
    const lines = await db.journalLines
      .where('entryId')
      .anyOf(rows.map((r) => r.id))
      .toArray();
    expect(new Set(lines.map((l) => l.amount))).toEqual(new Set(['20000']));
  });

  it.each([
    [
      '存在しない記録',
      async (revId: string) => {
        await db.journalEntries.update(revId, { originalEntryId: 'missing' });
      },
    ],
    [
      '一般の仕訳',
      async (revId: string) => {
        const rev = (await db.journalEntries.get(revId))!;
        await db.journalEntries.update(rev.originalEntryId!, { source: 'manual' });
      },
    ],
    [
      'ほかの年の仕訳',
      async (revId: string) => {
        const rev = (await db.journalEntries.get(revId))!;
        await db.journalEntries.update(rev.originalEntryId!, { year: 2025 });
      },
    ],
  ])('打消しの元が%sを指していれば書かない', async (_label, corrupt) => {
    await interrupt('2026-07-01');
    const rev = (await db.journalEntries.toArray()).find((e) => e.originalEntryId !== undefined)!;
    await corrupt(rev.id);
    const before = await db.journalEntries.count();
    const outcome = await restoreInterruptedOpeningEntries(2026, { allowFiledYear: true }).catch(
      (e: unknown) => e,
    );
    expect(await db.journalEntries.count()).toBe(before);
    expect(outcome).toBeInstanceOf(OpeningRestoreAborted);
    expect((outcome as OpeningRestoreAborted).reason).toBe('target-invalid');
  });

  it('元の明細の金額 1e3 は 1000 として戻し、索引も計算し直す', async () => {
    await interrupt('2026-07-01');
    for (const l of await db.journalLines.toArray()) {
      await db.journalLines.update(l.id, { amount: '1e3', amountIndexed: 'x' });
    }
    await restoreInterruptedOpeningEntries(2026, { allowFiledYear: true });
    const rows = await restored(2026);
    const lines = await db.journalLines
      .where('entryId')
      .anyOf(rows.map((r) => r.id))
      .toArray();
    expect(lines.length).toBeGreaterThan(0);
    for (const l of lines) {
      expect(l.amount).toBe('1000');
      expect(l.amountIndexed).toBe(toIndexable('1000'));
    }
  });

  it('元の明細の金額が 1e14 なら書かない', async () => {
    await interrupt('2026-07-01');
    for (const l of await db.journalLines.toArray()) {
      await db.journalLines.update(l.id, { amount: '100000000000000' });
    }
    const before = await db.journalEntries.count();
    await expect(
      restoreInterruptedOpeningEntries(2026, { allowFiledYear: true }),
    ).rejects.toThrow();
    expect(await db.journalEntries.count()).toBe(before);
  });

  it('元の明細の金額が読めなければ書かない', async () => {
    await interrupt('2026-07-01');
    const l = await originalLine();
    await db.journalLines.update(l.id, { amount: 'abc' });
    const before = await db.journalEntries.count();
    const outcome = await restoreInterruptedOpeningEntries(2026, { allowFiledYear: true }).catch(
      (e: unknown) => e,
    );
    expect(await db.journalEntries.count()).toBe(before);
    expect((outcome as OpeningRestoreAborted).reason).toBe('amount-invalid');
  });

  it('申告済みの年は確認を通した書き込みだけ通す', async () => {
    await interrupt('2026-07-01');
    await lockYears(2026);
    await expect(restoreInterruptedOpeningEntries(2026)).rejects.toThrow();
    expect(await restored(2026)).toHaveLength(0);
    await restoreInterruptedOpeningEntries(2026, { allowFiledYear: true });
    expect(await restored(2026)).toHaveLength(2);
  });

  it('止まった年でなくなっていれば書かない', async () => {
    await interrupt('2026-07-01');
    await seedOpening('2026-07-01');
    const before = await db.journalEntries.count();
    expect(await restoreInterruptedOpeningEntries(2026, { allowFiledYear: true })).toEqual({
      reason: 'not-interrupted',
    });
    expect(await db.journalEntries.count()).toBe(before);
  });

  it('明細の任意の項目も写す', async () => {
    await interrupt('2026-07-01');
    const l = await originalLine();
    await db.journalLines.update(l.id, {
      taxCategory: 'nontaxable',
      taxableTransferConsideration: '5000',
    });
    await restoreInterruptedOpeningEntries(2026, { allowFiledYear: true });
    const rows = await restored(2026);
    const lines = await db.journalLines
      .where('entryId')
      .anyOf(rows.map((r) => r.id))
      .toArray();
    expect(
      lines.some(
        (x) => x.taxCategory === 'nontaxable' && x.taxableTransferConsideration === '5000',
      ),
    ).toBe(true);
  });
});

describe('findMissingOpeningAssets・registerMissingOpeningAsset（A 類・修正前は関数が無く実行できない）', () => {
  it('同時に 2 度登録しても 1 件だけ', async () => {
    await seedRestored(2026, '2026-07-01', [{ name: '私用PC', amount: '165540' }]);
    const target = (await findMissingOpeningAssets()).missing[0]!;
    const args = {
      entryId: target.entryId,
      lineId: target.lineId,
      acquisitionDate: '2024-01-01',
      acquisitionCost: '300000',
      usefulLifeYears: 4,
      depreciationMethod: 'straight-line' as const,
    };
    const results = await Promise.all([
      registerMissingOpeningAsset(args),
      registerMissingOpeningAsset(args),
    ]);
    expect(await db.fixedAssets.count()).toBe(1);
    expect(results.filter((r) => 'reason' in r)).toEqual([{ reason: 'not-missing' }]);
  });

  it('元に戻した仕訳だけを見る（ほかの開業仕訳の転用資産の明細は見ない）', async () => {
    await seedOpening('2026-07-01', '私用PC');
    await db.fixedAssets.clear();
    expect((await findMissingOpeningAssets()).missing).toEqual([]);
  });
});

describe('A 類：「登録しない」にした明細は資産との突き合わせから外す（検証での指摘）', () => {
  it('同じ名前・科目・金額の 2 本のうち 1 本を「登録しない」にし、もう 1 本を登録すると、2 度目の登録は書かない', async () => {
    await seedRestored(2026, '2026-07-01', [
      { name: 'モニター', amount: '50000' },
      { name: 'モニター', amount: '50000' },
    ]);
    await dismissMissingOpeningAsset('restored-2026:restored-2026-d0');
    const form = {
      entryId: 'restored-2026',
      lineId: 'restored-2026-d1',
      acquisitionDate: '2026-01-01',
      acquisitionCost: '300000',
      usefulLifeYears: 4,
      depreciationMethod: 'straight-line' as const,
    };
    const first = await registerMissingOpeningAsset(form);
    const second = await registerMissingOpeningAsset(form);
    expect(await db.fixedAssets.count()).toBe(1);
    expect('assetId' in first).toBe(true);
    expect(second).toEqual({ reason: 'not-missing' });
    expect((await findMissingOpeningAssets()).missing).toEqual([]);
  });
});

describe('B 類：元に戻した仕訳をのちに作り直す（既存の関数で通る）', () => {
  it('元に戻した仕訳と登録し直した資産は、作り直しで打ち消され資産も消える', async () => {
    await seedRestored(2026, '2026-07-01', [{ name: '私用PC', amount: '165540' }]);
    await db.fixedAssets.add({
      id: 'reg-asset',
      name: '私用PC',
      acquisitionDate: '2024-01-01',
      acquisitionCost: '300000',
      usefulLifeYears: 4,
      depreciationMethod: 'straight-line',
      accountCode: '1510',
      source: 'opening',
      conversionBasis: '165540',
      serviceStartDate: '2026-07-01',
      openingYear: 2026,
    });
    expect(await removeOpeningEntries(2026)).toEqual({ removed: true });
    expect(await db.fixedAssets.count()).toBe(0);
    expect((await db.journalEntries.get('restored-2026'))?.status).toBe('reversed');
  });

  it('登録し直した資産に償却仕訳があれば作り直しは止まる', async () => {
    await seedRestored(2026, '2026-07-01', [{ name: '私用PC', amount: '165540' }]);
    await db.fixedAssets.add({
      id: 'reg-asset',
      name: '私用PC',
      acquisitionDate: '2024-01-01',
      acquisitionCost: '300000',
      usefulLifeYears: 4,
      depreciationMethod: 'straight-line',
      accountCode: '1510',
      source: 'opening',
      conversionBasis: '165540',
      serviceStartDate: '2026-07-01',
      openingYear: 2026,
    });
    await db.journalEntries.add({
      id: 'dep',
      date: '2026-12-31',
      year: 2026,
      description: '減価償却 私用PC #reg-asse',
      status: 'confirmed',
      source: 'manual',
      createdAt: 1,
      confirmedAt: 1,
    });
    expect(await removeOpeningEntries(2026)).toEqual({
      reason: 'has-depreciation',
      assetNames: ['私用PC'],
    });
    expect(await db.fixedAssets.count()).toBe(1);
  });
});

describe('readOpeningRecoveryState（登録し直す転用資産の読み込み失敗）', () => {
  it('読めたときは missingError が null', async () => {
    expect((await readOpeningRecoveryState()).missingError).toBeNull();
  });

  it('表示しない資産の設定を読めなければ、一覧は空にして失敗の原因を missingError で返す', async () => {
    await seedOpening('2026-07-01', '私用PC');
    const injected = new Error('読み込み失敗（試験）');
    const original = db.settings.get.bind(db.settings);
    vi.spyOn(db.settings, 'get').mockImplementation(((key: unknown, ...rest: unknown[]) =>
      key === 'dismissedMissingOpeningAssets'
        ? Promise.reject(injected)
        : (original as (...a: unknown[]) => unknown)(key, ...rest)) as never);
    const state = await readOpeningRecoveryState();
    expect(state.missing).toEqual([]);
    expect(state.assumed).toEqual([]);
    expect(state.missingError).toBe(injected);
  });
});
