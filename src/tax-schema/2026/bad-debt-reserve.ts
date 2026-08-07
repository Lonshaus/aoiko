// 所得税法52条4項により、繰入額の計算に関する明細（個別評価は明細書の添付）が適用要件。
// aoiko は貸金残高を持たず明細を作れないので、記帳時に補記が要ることを伝える（#392）。
export type BadDebtReserveEvaluation = 'lumpSum' | 'individual';

// 一括評価（52条2項、青色申告の事業所得限定）。
const LUMP_SUM_ACCOUNTS = new Set(['5810']);
// 個別評価（52条1項、青白共通）。一括評価は事業所得が要件なので不動産（5410）はここだけ。
const INDIVIDUAL_ACCOUNTS = new Set(['5410', '5811']);

export function badDebtReserveEvaluation(accountCode: string): BadDebtReserveEvaluation | null {
  if (LUMP_SUM_ACCOUNTS.has(accountCode)) {
    return 'lumpSum';
  }
  if (INDIVIDUAL_ACCOUNTS.has(accountCode)) {
    return 'individual';
  }
  return null;
}

// 1 本の仕訳に両方の科目を混ぜられるため、集合で返す。
export function badDebtReserveEvaluations(
  accountCodes: Iterable<string>,
): Set<BadDebtReserveEvaluation> {
  const found = new Set<BadDebtReserveEvaluation>();
  for (const code of accountCodes) {
    const kind = badDebtReserveEvaluation(code);
    if (kind !== null) {
      found.add(kind);
    }
  }
  return found;
}
