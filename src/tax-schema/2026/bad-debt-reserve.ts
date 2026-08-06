// 所得税法52条4項：貸倒引当金の繰入れは、確定申告書に繰入額の計算に関する明細の記載
// （個別評価は明細書の添付）がある場合に限り適用される。5項に宥恕の定めはあるが、
// 通達52-1の2 で狭く運用される。
// aoiko は繰入額そのものは出力するが、その根拠となる明細は出力しない——貸金（債務者ごとの
// 債権残高）を持たないため、一括評価の貸金の合計額・繰入限度額（決算書第2頁 AMF01030／
// AMF01040）も、個別評価の明細書（KOB120）の取立て見込額等も埋められない。
// 埋まらない欄が繰入限度額を決める欄なので、推定して印字すると過大な限度額を主張すること
// になり、控除を守るための書類が控除を否認する根拠になる。よって生成せず、記帳の時点で
// 補記が要ることを利用者に伝える。
export type BadDebtReserveEvaluation = 'lumpSum' | 'individual';

// 一括評価（52条2項、青色申告の事業所得限定）。
const LUMP_SUM_ACCOUNTS = new Set(['5810']);
// 個別評価（52条1項、青白共通）。5410 は不動産所得用で、一括評価は事業所得が要件のため
// 不動産所得の引当金は必然的に個別評価だけになる。
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

// 仕訳の行全体から、注意を出すべき評価方法を求める。両方の科目を1本の仕訳に混ぜることも
// できるため、集合で返す。
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
