import { describe, expect, test } from 'vitest';
import { D } from '../../lib/decimal';
import { homeWorkerGuaranteeAmount, homeWorkerNecessaryExpenses } from './home-worker-expense';

function summary(r: ReturnType<typeof homeWorkerNecessaryExpenses>): string[] {
  return [String(r.applied), r.businessExpenses.toString(), r.miscExpenses.toString()];
}

describe('homeWorkerGuaranteeAmount（措法27条の最低保障額）', () => {
  test('令和8年分以後は69万円、令和7年分以前は65万円（附則34条）', () => {
    expect(homeWorkerGuaranteeAmount(2026).toString()).toBe('690000');
    expect(homeWorkerGuaranteeAmount(2027).toString()).toBe('690000');
    expect(homeWorkerGuaranteeAmount(2025).toString()).toBe('650000');
  });

  test('給与所得を有する場合は給与所得控除額を差し引く', () => {
    // 令和8年分の給与所得控除額は収入60万円なら60万円（措法29条の4第1項括弧書）
    expect(homeWorkerGuaranteeAmount(2026, D(600_000)).toString()).toBe('90000');
  });

  test('給与所得控除額が最低保障額以上なら0', () => {
    expect(homeWorkerGuaranteeAmount(2026, D(2_000_000)).toString()).toBe('0');
    expect(homeWorkerGuaranteeAmount(2028, D(500_000)).toString()).toBe('0');
  });
});

describe('homeWorkerNecessaryExpenses', () => {
  test('家内労働者等でなければ（未設定）実額のまま', () => {
    const r = homeWorkerNecessaryExpenses({
      year: 2026,
      business: { totalRevenue: D(1_200_000), expenses: D(100_000) },
    });
    expect(summary(r)).toEqual(['false', '100000', '0']);
  });

  test('家内労働者等・給与所得なし・総収入120万円 → 69万円', () => {
    const r = homeWorkerNecessaryExpenses({
      year: 2026,
      isHomeWorker: true,
      business: { totalRevenue: D(1_200_000), expenses: D(100_000) },
    });
    expect(summary(r)).toEqual(['true', '690000', '0']);
  });

  test('総収入50万円なら総収入金額が上限', () => {
    const r = homeWorkerNecessaryExpenses({
      year: 2026,
      isHomeWorker: true,
      business: { totalRevenue: D(500_000), expenses: D(0) },
    });
    expect(summary(r)).toEqual(['true', '500000', '0']);
  });

  test('給与収入60万円あり → 69万円 − 給与所得控除額60万円 = 9万円', () => {
    const r = homeWorkerNecessaryExpenses({
      year: 2026,
      isHomeWorker: true,
      salaryPaidAmount: D(600_000),
      business: { totalRevenue: D(1_200_000), expenses: D(0) },
    });
    expect(summary(r)).toEqual(['true', '90000', '0']);
  });

  test('実額が最低保障額以上なら実額のまま', () => {
    const r = homeWorkerNecessaryExpenses({
      year: 2026,
      isHomeWorker: true,
      business: { totalRevenue: D(1_200_000), expenses: D(700_000) },
    });
    expect(summary(r)).toEqual(['false', '700000', '0']);
  });

  test('雑所得のみ（措令18条の2第2項1号）→ 雑所得側に69万円', () => {
    const r = homeWorkerNecessaryExpenses({
      year: 2026,
      isHomeWorker: true,
      misc: { totalRevenue: D(1_000_000), expenses: D(30_000) },
    });
    expect(summary(r)).toEqual(['true', '0', '690000']);
  });

  test('事業所得と雑所得の両方（同2号）：事業側は実額20万円、残り49万円が雑所得側', () => {
    const r = homeWorkerNecessaryExpenses({
      year: 2026,
      isHomeWorker: true,
      business: { totalRevenue: D(1_000_000), expenses: D(200_000) },
      misc: { totalRevenue: D(800_000), expenses: D(10_000) },
    });
    expect(summary(r)).toEqual(['true', '200000', '490000']);
  });

  test('同2号：雑所得の総収入金額30万円がロの49万円に満たない19万円は事業側へ加算', () => {
    const r = homeWorkerNecessaryExpenses({
      year: 2026,
      isHomeWorker: true,
      business: { totalRevenue: D(1_000_000), expenses: D(200_000) },
      misc: { totalRevenue: D(300_000), expenses: D(50_000) },
    });
    expect(summary(r)).toEqual(['true', '390000', '300000']);
  });
});
