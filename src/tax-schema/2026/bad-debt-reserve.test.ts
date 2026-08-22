import { describe, it, expect } from 'vitest';
import { badDebtReserveEvaluation, badDebtReserveEvaluations } from './bad-debt-reserve';
import { ACCOUNTS_2026 } from './accounts';

describe('badDebtReserveEvaluation', () => {
  it('一括評価は 5810 のみ', () => {
    expect(badDebtReserveEvaluation('5810')).toBe('lumpSum');
  });

  it('個別評価は事業（5811）と不動産（5410）', () => {
    expect(badDebtReserveEvaluation('5811')).toBe('individual');
    expect(badDebtReserveEvaluation('5410')).toBe('individual');
  });

  it('繰戻額・貸倒金そのものは対象外（明細を要するのは繰入れ）', () => {
    expect(badDebtReserveEvaluation('4120')).toBeNull();
    expect(badDebtReserveEvaluation('5400')).toBeNull();
  });

  it('空文字・未知のコードは null', () => {
    expect(badDebtReserveEvaluation('')).toBeNull();
    expect(badDebtReserveEvaluation('9999')).toBeNull();
  });

  // 科目コードを直接持っているので、accounts.ts 側の改称・削除で無言の空振りになりうる。
  it('対象コードは 2026 年分の勘定科目に実在する', () => {
    const codes = new Set(ACCOUNTS_2026.map((a) => a.code));
    for (const code of ['5810', '5811', '5410']) {
      expect(codes.has(code)).toBe(true);
    }
  });
});

describe('badDebtReserveEvaluations', () => {
  it('該当が無ければ空', () => {
    expect(badDebtReserveEvaluations(['5020', '4110', ''])).toEqual(new Set());
  });

  it('重複しても 1 つにまとまる', () => {
    expect(badDebtReserveEvaluations(['5811', '5410'])).toEqual(new Set(['individual']));
  });

  it('一括と個別が同じ仕訳に混ざれば両方返す', () => {
    expect(badDebtReserveEvaluations(['5810', '5811', '1310'])).toEqual(
      new Set(['lumpSum', 'individual']),
    );
  });
});
