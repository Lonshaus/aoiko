import { D } from '../lib/decimal';
import type { JournalLine } from '../db/types';

export class JournalValidationError extends Error {
  constructor(
    message: string,
    public readonly code: 'unbalanced' | 'negative-amount' | 'no-lines' | 'one-sided'
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
        'negative-amount'
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
      'unbalanced'
    );
  }
}