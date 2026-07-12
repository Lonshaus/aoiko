import { D, type Decimal } from '../lib/decimal';
import type { AccountCategory, JournalEntry, JournalLine } from '../db/types';
// 収益・費用は両建てで正味集計する：収益は貸方プラス・借方マイナス（売上値引・返品）、
// 費用は借方プラス・貸方マイナス（経費の返金）。null は損益集計の対象外の行。
export function plContribution(category: AccountCategory, line: JournalLine): Decimal | null {
  if (category === 'revenue') {
    return line.side === 'credit' ? D(line.amount) : D(line.amount).negated();
  }
  if (category === 'expense') {
    return line.side === 'debit' ? D(line.amount) : D(line.amount).negated();
  }
  return null;
}
// 集計対象の判定（成対排除方式）。
// 訂正は「原仕訳（status='reversed'）」と「訂正仕訳（originalEntryId 持ち）」のペアで
// 帳簿上に残るが、集計上は両方除外して正味ゼロにする。
// 片方だけ算入すると B/S・繰越が原仕訳 1 件分マイナスに歪むため、必ずペアで扱うこと。
export function countsTowardTotals(
  entry: Pick<JournalEntry, 'status' | 'originalEntryId'>,
): boolean {
  return entry.status === 'confirmed' && entry.originalEntryId === undefined;
}

export class JournalValidationError extends Error {
  constructor(
    message: string,
    public readonly code:
      'unbalanced' | 'negative-amount' | 'no-lines' | 'one-sided' | 'zero-amount',
  ) {
    super(message);
    this.name = 'JournalValidationError';
  }
}
// 訂正仕訳は負数ではなく借方↔貸方の入れ替えで表現する。
// 各 line の金額は常に非負。符号は `side` が担う。
export function validateLines(lines: JournalLine[]): void {
  if (lines.length === 0) {
    throw new JournalValidationError('no lines', 'no-lines');
  }

  const debits: typeof lines = [];
  const credits: typeof lines = [];

  for (const line of lines) {
    const amount = D(line.amount);
    if (amount.isNegative()) {
      throw new JournalValidationError(
        `negative amount on line ${line.id}: ${line.amount}`,
        'negative-amount',
      );
    }
    if (line.side === 'debit') {
      debits.push(line);
    } else {
      credits.push(line);
    }
  }

  if (debits.length === 0 || credits.length === 0) {
    throw new JournalValidationError('entry must have both debit and credit lines', 'one-sided');
  }

  const debitTotal = debits.reduce((sum, l) => sum.plus(l.amount), D(0));
  const creditTotal = credits.reduce((sum, l) => sum.plus(l.amount), D(0));

  if (!debitTotal.equals(creditTotal)) {
    throw new JournalValidationError(
      `unbalanced: debit=${debitTotal.toString()} credit=${creditTotal.toString()}`,
      'unbalanced',
    );
  }
  // 合計ゼロの仕訳（全行 0 円）は意味を持たないため拒否する。
  if (debitTotal.isZero()) {
    throw new JournalValidationError('entry total is zero', 'zero-amount');
  }
}
