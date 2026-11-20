import { describe, expect, test, vi } from 'vitest';
import { D } from '../../lib/decimal';
import { estimateTransferIncome, transferIncomeByTerm } from '../../domain/asset-disposal';
import type { FixedAsset } from '../../db/types';
import {
  NO_FIXED_ASSET_TRANSFER,
  aggregateIncomeAmount,
  computeGeneralIncome,
  dividendIncomeAmount,
  interestIncomeAmount,
  legalTotalIncomeAmount,
  occasionalIncomeAmount,
  resolveFixedAssetTransfer,
  totalIncomeAmountEtc,
  transferAndOccasionalAmount,
  type FixedAssetTransferTotals,
  type GeneralTransferItemInput,
} from './general-income';

function item(
  term: 'short' | 'long',
  revenue: number,
  acquisitionCost = 0,
  expenses = 0,
  nonEssential = false,
): GeneralTransferItemInput {
  return {
    term,
    revenue: D(revenue),
    acquisitionCost: D(acquisitionCost),
    expenses: D(expenses),
    nonEssential,
  };
}

function occasional(revenue: number, expenses = 0) {
  return {
    revenue: D(revenue),
    expenses: D(expenses),
    withholdingTax: D(0),
    category: '',
    payerName: '',
    payerAddress: '',
  };
}

interface Case {
  ordinary?: number;
  items?: GeneralTransferItemInput[];
  occasionalRevenue?: number;
  occasionalExpenses?: number;
  businessLoss?: boolean;
  realEstateLoss?: boolean;
  fixedAsset?: Partial<FixedAssetTransferTotals>;
}

function calc(c: Case = {}) {
  return computeGeneralIncome({
    ordinary: D(c.ordinary ?? 0),
    businessLoss: c.businessLoss ?? (c.ordinary ?? 0) < 0,
    realEstateLoss: c.realEstateLoss ?? false,
    input: {
      ...(c.items ? { generalTransferIncome: c.items } : {}),
      ...(c.occasionalRevenue !== undefined
        ? { occasionalIncome: occasional(c.occasionalRevenue, c.occasionalExpenses ?? 0) }
        : {}),
    },
    fixedAssetTransfer: { ...NO_FIXED_ASSET_TRANSFER.totals, ...c.fixedAsset },
  });
}

const s = (v: { toString(): string }) => v.toString();

describe('各所得の単独の金額', () => {
  test('利子は入力した金額、配当は収入−負債の利子で 0 を下回らない', () => {
    expect(
      s(interestIncomeAmount({ interestIncome: { amount: D(12_345), withholdingTax: D(0) } })),
    ).toBe('12345');
    const dividend = (revenue: number, debtInterest: number) =>
      s(
        dividendIncomeAmount({
          dividendIncome: {
            revenue: D(revenue),
            debtInterest: D(debtInterest),
            withholdingTax: D(0),
          },
        }),
      );
    expect(dividend(300_000, 100_000)).toBe('200000');
    expect(dividend(100_000, 150_000)).toBe('0');
    expect(s(dividendIncomeAmount({}))).toBe('0');
  });

  test('一時所得は収入−支出−50 万円で 0 を下回らない', () => {
    const amount = (revenue: number, expenses: number) =>
      s(occasionalIncomeAmount({ occasionalIncome: occasional(revenue, expenses) }));
    expect(amount(1_500_000, 0)).toBe('1000000');
    expect(amount(700_000, 100_000)).toBe('100000');
    expect(amount(500_000, 0)).toBe('0');
    expect(amount(300_000, 400_000)).toBe('0');
  });

  test('一時所得だけなら総所得金額に 1/2 を算入する（収入 150 万円→一時 100 万円→算入 50 万円）', () => {
    const r = calc({ occasionalRevenue: 1_500_000 });
    expect(s(r.occasional)).toBe('1000000');
    expect(s(r.aggregate)).toBe('500000');
    expect(s(transferAndOccasionalAmount(r))).toBe('500000');
  });
});

describe('総合譲渡の特別控除 50 万円と 1/2', () => {
  test('短期の譲渡益から先に控除する（収入 120 万円・取得費 50 万円・費用 10 万円→短期 10 万円）', () => {
    const r = calc({ items: [item('short', 1_200_000, 500_000, 100_000)] });
    expect(s(r.short)).toBe('100000');
    expect(s(r.long)).toBe('0');
    expect(s(r.aggregate)).toBe('100000');
  });

  test('長期の譲渡益 80 万円は控除後 30 万円、算入するのはその 1/2', () => {
    const r = calc({ items: [item('long', 800_000)] });
    expect(s(r.long)).toBe('300000');
    expect(s(r.aggregate)).toBe('150000');
    expect(s(transferAndOccasionalAmount(r))).toBe('150000');
  });

  test('短期 30 万円・長期 40 万円は、短期から 30 万円・長期から 20 万円控除する', () => {
    const r = calc({ items: [item('short', 300_000), item('long', 400_000)] });
    expect(s(r.short)).toBe('0');
    expect(s(r.long)).toBe('200000');
    expect(s(r.aggregate)).toBe('100000');
  });

  test('短期の損失は長期の益と通算してから特別控除を引く', () => {
    const r = calc({ items: [item('short', 0, 200_000), item('long', 900_000)] });
    expect(s(r.short)).toBe('0');
    expect(s(r.long)).toBe('200000');
  });

  test('1/2 は通算後に求め、1 円未満を切り捨てる', () => {
    const r = calc({ items: [item('long', 700_001)] });
    expect(s(r.long)).toBe('200001');
    expect(s(r.aggregate)).toBe('100000');
    expect(s(transferAndOccasionalAmount(r))).toBe('100000');
  });

  test('固定資産の売却（台帳）の短期・長期を合算する', () => {
    const r = calc({
      fixedAsset: { shortTerm: D(100_000), longTerm: D(900_000), shortCount: 1, longCount: 1 },
      items: [item('long', 100_000)],
    });
    expect(s(r.short)).toBe('0');
    expect(s(r.long)).toBe('600000');
    expect(r.hasTransfer).toBe(true);
  });
});

describe('損益通算（所法69条1項・所令198条）', () => {
  // 短期 10 万円（収入 60 万円−特別控除 50 万円）、長期 80 万円、一時 30 万円（収入 80 万円−50 万円）
  const gains = {
    items: [item('short', 600_000), item('long', 800_000)],
    occasionalRevenue: 800_000,
  };

  test('通算前の各所得', () => {
    const r = calc(gains);
    expect(s(r.short)).toBe('100000');
    expect(s(r.long)).toBe('800000');
    expect(s(r.occasional)).toBe('300000');
  });

  test('事業の赤字は経常所得から引き、残りは短期→長期→一時の順に引く', () => {
    const afterShort = calc({ ...gains, ordinary: -50_000 });
    expect(s(afterShort.nettedShort)).toBe('50000');
    expect(s(afterShort.nettedLong)).toBe('800000');

    const intoLong = calc({ ...gains, ordinary: -500_000 });
    expect(s(intoLong.nettedShort)).toBe('0');
    expect(s(intoLong.nettedLong)).toBe('400000');
    expect(s(intoLong.nettedOccasional)).toBe('300000');
    expect(s(intoLong.aggregate)).toBe('350000');

    const intoOccasional = calc({ ...gains, ordinary: -1_000_000 });
    expect(s(intoOccasional.nettedLong)).toBe('0');
    expect(s(intoOccasional.nettedOccasional)).toBe('200000');
    expect(s(intoOccasional.aggregate)).toBe('100000');
  });

  test('経常所得の赤字が全部の所得を引いても残るときは、負のまま残る', () => {
    const r = calc({ ...gains, ordinary: -1_300_000 });
    expect(s(r.nettedOrdinary)).toBe('-100000');
    expect(s(r.aggregate)).toBe('-100000');
  });

  test('経常所得の赤字が他の経常所得で埋まるときは、譲渡・一時所得に影響しない', () => {
    const r = calc({ ...gains, ordinary: 0, businessLoss: true });
    expect(s(r.nettedShort)).toBe('100000');
    expect(s(r.aggregate)).toBe('650000');
  });

  test('短期譲渡の赤字は一時所得から引き、残りを経常所得から引く', () => {
    const short60 = item('short', 400_000, 1_000_000);
    const intoOccasional = calc({
      ordinary: 300_000,
      items: [short60],
      occasionalRevenue: 1_100_000,
    });
    expect(s(intoOccasional.nettedOccasional)).toBe('0');
    expect(s(intoOccasional.nettedOrdinary)).toBe('300000');
    expect(s(intoOccasional.aggregate)).toBe('300000');

    const intoOrdinary = calc({
      ordinary: 300_000,
      items: [item('short', 100_000, 1_000_000)],
      occasionalRevenue: 1_100_000,
    });
    expect(s(intoOrdinary.nettedOccasional)).toBe('0');
    expect(s(intoOrdinary.nettedOrdinary)).toBe('0');
    expect(s(intoOrdinary.aggregate)).toBe('0');

    const leftover = calc({
      ordinary: 300_000,
      items: [item('short', 0, 1_200_000)],
      occasionalRevenue: 1_100_000,
    });
    expect(s(leftover.nettedShort)).toBe('-300000');
    expect(s(leftover.aggregate)).toBe('-300000');
  });

  test('経常所得と短期譲渡の両方が赤字なら、一時所得からは譲渡の赤字を先に引く（所令198条2号→3号）', () => {
    const r = calc({
      ordinary: -100_000,
      items: [item('short', 0, 100_000)],
      occasionalRevenue: 650_000,
    });
    expect(s(r.nettedShort)).toBe('0');
    expect(s(r.nettedOccasional)).toBe('0');
    expect(s(r.nettedOrdinary)).toBe('-50000');
    expect(s(r.aggregate)).toBe('-50000');
  });

  test('手引きが計算書を求める組み合わせ：赤字があり、総合譲渡か一時所得がある', () => {
    expect(calc({ ordinary: -1, occasionalRevenue: 600_000 }).nettingStatementRequired).toBe(true);
    expect(calc({ ordinary: -1 }).nettingStatementRequired).toBe(false);
    expect(calc({ ordinary: 100, occasionalRevenue: 600_000 }).nettingStatementRequired).toBe(
      false,
    );
    expect(
      calc({ ordinary: 100, businessLoss: true, occasionalRevenue: 600_000 })
        .nettingStatementRequired,
    ).toBe(true);
    expect(
      calc({ ordinary: 100, realEstateLoss: true, items: [item('long', 800_000)] })
        .nettingStatementRequired,
    ).toBe(true);
    expect(
      calc({ ordinary: 100, items: [item('long', 0, 100_000)] }).nettingStatementRequired,
    ).toBe(true);
  });
});

describe('生活に通常必要でない資産の損失（所法69条2項）', () => {
  test('ゴルフ会員権の損失と金地金の利益は譲渡内で通算する', () => {
    const r = calc({
      ordinary: 1_000_000,
      items: [item('long', 200_000, 500_000, 0, true), item('long', 800_000)],
    });
    expect(s(r.long)).toBe('0');
    expect(r.unconfirmed).toBe(false);
    expect(s(r.aggregate)).toBe('1000000');
  });

  test('ゴルフ会員権の損失だけなら、経常所得はそのまま', () => {
    const r = calc({ ordinary: 1_000_000, items: [item('long', 200_000, 500_000, 0, true)] });
    expect(s(r.long)).toBe('-300000');
    expect(r.unconfirmed).toBe(false);
    expect(s(r.nettedOrdinary)).toBe('1000000');
    expect(s(r.aggregate)).toBe('1000000');
  });

  test('それ以外の資産の損失は経常所得から引く', () => {
    const r = calc({ ordinary: 1_000_000, items: [item('long', 200_000, 500_000)] });
    expect(s(r.aggregate)).toBe('700000');
  });

  test('生活に通常必要でない資産とそれ以外の資産の両方に損失があり純額が損失なら UNCONFIRMED', () => {
    const r = calc({
      ordinary: 1_000_000,
      items: [item('long', 200_000, 500_000, 0, true), item('short', 100_000, 300_000)],
    });
    expect(r.unconfirmed).toBe(true);
  });

  test('台帳の資産の損失とゴルフ会員権の損失が両方あっても UNCONFIRMED', () => {
    const r = calc({
      items: [item('long', 200_000, 500_000, 0, true)],
      fixedAsset: { shortTerm: D(-100_000), shortCount: 1, lossAssetCount: 1 },
    });
    expect(r.unconfirmed).toBe(true);
  });

  test('両方に損失があっても通算後に益になれば UNCONFIRMED ではない', () => {
    const r = calc({
      items: [
        item('long', 200_000, 500_000, 0, true),
        item('long', 100_000, 300_000),
        item('long', 3_000_000),
      ],
    });
    expect(r.unconfirmed).toBe(false);
  });
});

describe('3 種類の金額', () => {
  test('現時点では同じ値を返す', () => {
    const r = calc({ ordinary: 2_000_000, occasionalRevenue: 1_500_000 });
    expect(s(legalTotalIncomeAmount(r))).toBe('2500000');
    expect(s(totalIncomeAmountEtc(r))).toBe('2500000');
    expect(s(aggregateIncomeAmount(r))).toBe('2500000');
  });
});

function asset(over: Partial<FixedAsset> & { id: string }): FixedAsset {
  return {
    name: over.id,
    acquisitionDate: '2022-01-01',
    acquisitionCost: '1000000',
    usefulLifeYears: 4,
    depreciationMethod: 'straight-line',
    accountCode: '1510',
    ...over,
  };
}

describe('resolveFixedAssetTransfer', () => {
  const dates = async () => ({ businessStartDates: [] as string[] });

  test('当年に処分した資産がなければ、開業日を読まず 0 を返す', async () => {
    const loader = vi.fn(dates);
    const result = await resolveFixedAssetTransfer(
      [asset({ id: 'old', disposedDate: '2025-06-30', disposalType: 'sale', salePrice: '300000' })],
      2026,
      loader,
    );
    expect(loader).not.toHaveBeenCalled();
    expect(result).toBe(NO_FIXED_ASSET_TRANSFER);
  });

  test('当年に売却した資産の総合譲渡は transferIncomeByTerm と同じ金額で、収入・費用も集める', async () => {
    const sold = asset({
      id: 'sold',
      disposedDate: '2026-06-30',
      disposalType: 'sale',
      salePrice: '1500000',
      saleExpenses: '20000',
    });
    const result = await resolveFixedAssetTransfer([sold], 2026, dates);
    const expected = transferIncomeByTerm([sold], 2026);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(s(result.totals.shortTerm)).toBe(expected.shortTerm);
      expect(s(result.totals.longTerm)).toBe(expected.longTerm);
      const estimate = estimateTransferIncome(sold)!;
      const [revenue, expense, count] =
        estimate.term === 'short'
          ? [result.totals.shortRevenue, result.totals.shortExpense, result.totals.shortCount]
          : [result.totals.longRevenue, result.totals.longExpense, result.totals.longCount];
      expect(s(revenue)).toBe('1500000');
      expect(s(expense)).toBe(
        D(estimate.acquisitionExpense).plus(estimate.saleExpenses).toString(),
      );
      expect(count).toBe(1);
    }
  });

  test('建物等の売却は総合譲渡に入れず、名前だけを返す', async () => {
    const building = asset({
      id: 'b',
      name: '事務所建物',
      accountCode: '1511',
      usefulLifeYears: 24,
      disposedDate: '2026-12-01',
      disposalType: 'sale',
      salePrice: '12000000',
    });
    const result = await resolveFixedAssetTransfer([building], 2026, dates);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(s(result.totals.shortTerm)).toBe('0');
      expect(s(result.totals.longTerm)).toBe('0');
      expect(result.totals.shortCount + result.totals.longCount).toBe(0);
      expect(result.totals.separateNames).toEqual(['事務所建物']);
    }
  });

  test('開業日を読めないときは、当年に処分した資産の名前で失敗する', async () => {
    const result = await resolveFixedAssetTransfer(
      [
        asset({
          id: 'sold',
          name: '売却機材',
          disposedDate: '2026-06-30',
          disposalType: 'sale',
          salePrice: '1',
        }),
      ],
      2026,
      async () => {
        throw new Error('invalid');
      },
    );
    expect(result).toEqual({ ok: false, names: ['売却機材'] });
  });

  test('当年に処分した資産に計算に効く問題があれば、名前で失敗する', async () => {
    const result = await resolveFixedAssetTransfer(
      [
        asset({
          id: 'bad',
          name: '耐用年数が不正',
          usefulLifeYears: 0,
          disposedDate: '2026-06-30',
          disposalType: 'sale',
          salePrice: '100000',
        }),
      ],
      2026,
      dates,
    );
    expect(result).toEqual({ ok: false, names: ['耐用年数が不正'] });
  });

  test('当年に売却した資産の売却価額が読めないときも名前で失敗する', async () => {
    const result = await resolveFixedAssetTransfer(
      [
        asset({
          id: 'bad',
          name: '売価が不正',
          disposedDate: '2026-06-30',
          disposalType: 'sale',
          salePrice: 'abc',
        }),
      ],
      2026,
      dates,
    );
    expect(result).toEqual({ ok: false, names: ['売価が不正'] });
  });

  test('当年に除却しただけの資産は、問題があっても開業日を読まず 0 を返す', async () => {
    const loader = vi.fn(async () => {
      throw new Error('invalid');
    });
    const result = await resolveFixedAssetTransfer(
      [
        asset({
          id: 'scrap',
          name: '除却した機材',
          usefulLifeYears: 0,
          disposedDate: '2026-06-30',
          disposalType: 'scrap',
        }),
      ],
      2026,
      loader,
    );
    expect(loader).not.toHaveBeenCalled();
    expect(result).toBe(NO_FIXED_ASSET_TRANSFER);
  });

  test('当年に処分していない資産の問題は、当年の譲渡所得の計算を止めない', async () => {
    const result = await resolveFixedAssetTransfer(
      [
        asset({ id: 'bad', name: '耐用年数が不正', usefulLifeYears: 0 }),
        asset({
          id: 'sold',
          disposedDate: '2026-06-30',
          disposalType: 'sale',
          salePrice: '1500000',
        }),
      ],
      2026,
      dates,
    );
    expect(result.ok).toBe(true);
  });
});
