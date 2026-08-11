import { db } from '../db/db';
import { D, type Decimal, toIndexable } from '../lib/decimal';
import { newId } from '../lib/id';
import { countsTowardTotals } from './journal';
import { assertYearsWritable } from './year-lock';
import type { JournalEntry, JournalLine } from '../db/types';
// 所得税法52条3項の洗替方式。基準を繰越残高でなく前年の繰入額に置くのは条文の文言どおりで、
// 引当金の負債科目が 2170 ひとつしか無い以上、事業／不動産の内訳もこちらでしか判別できない。
const RESERVE_LIABILITY = '2170';
const ACCRUAL_TO_REVERSAL = new Map<string, string>([
  ['5810', '4120'],
  ['5811', '4120'],
  ['5410', '4230'],
]);

export interface BadDebtReversalPreview {
  year: number;
  priorYear: number;
  date: string;
  // 繰戻先の科目ごとの金額（昇順）。前年に繰入れが無ければ空。
  reversals: Array<{ accountCode: string; amount: string }>;
  total: string;
}

export async function computeBadDebtReversal(year: number): Promise<BadDebtReversalPreview> {
  const priorYear = year - 1;
  const empty: BadDebtReversalPreview = {
    year,
    priorYear,
    date: `${year}-01-01`,
    reversals: [],
    total: '0',
  };

  const entries = await db.journalEntries
    .where('year')
    .equals(priorYear)
    .filter(countsTowardTotals)
    .toArray();
  if (entries.length === 0) {
    return empty;
  }

  const lines = await db.journalLines
    .where('entryId')
    .anyOf(entries.map((e) => e.id))
    .toArray();

  const byReversalAccount = new Map<string, Decimal>();
  for (const line of lines) {
    const reversalCode = ACCRUAL_TO_REVERSAL.get(line.accountCode);
    if (reversalCode === undefined) {
      continue;
    }
    // 繰入額は費用科目なので借方残。訂正で貸方に立った分は差し引く。
    const amount = D(line.amount);
    const signed = line.side === 'debit' ? amount : amount.negated();
    byReversalAccount.set(reversalCode, (byReversalAccount.get(reversalCode) ?? D(0)).plus(signed));
  }

  const reversals: Array<{ accountCode: string; amount: string }> = [];
  let total = D(0);
  for (const [accountCode, amount] of [...byReversalAccount].sort((a, b) =>
    a[0].localeCompare(b[0]),
  )) {
    // 差引がゼロ以下の科目は戻すものが無い（全額訂正された等）。
    if (!amount.isPositive()) {
      continue;
    }
    reversals.push({ accountCode, amount: amount.toString() });
    total = total.plus(amount);
  }

  return { year, priorYear, date: `${year}-01-01`, reversals, total: total.toString() };
}

export async function applyBadDebtReversal(
  year: number,
  options?: { allowFiledYear?: boolean },
): Promise<{ entryId: string; total: string } | { reason: 'already-exists' | 'empty' }> {
  await assertYearsWritable([year], options);
  const preview = await computeBadDebtReversal(year);
  if (preview.reversals.length === 0) {
    return { reason: 'empty' };
  }

  const entryId = newId();
  let alreadyExists = false;

  await db.transaction('rw', db.journalEntries, db.journalLines, async () => {
    // 書き込みと同一トランザクション内で判定する（applyCarryover と同じ既存判定）。
    const existing = await db.journalEntries
      .where('year')
      .equals(year)
      .filter(
        (e) =>
          e.source === 'badDebtReversal' &&
          e.status === 'confirmed' &&
          e.originalEntryId === undefined,
      )
      .first();
    if (existing) {
      alreadyExists = true;
      return;
    }

    const now = Date.now();
    await db.journalEntries.add({
      id: entryId,
      date: preview.date,
      year,
      description: `貸倒引当金の繰戻し（${preview.priorYear}年繰入分）`,
      status: 'confirmed',
      source: 'badDebtReversal',
      createdAt: now,
      confirmedAt: now,
    } satisfies JournalEntry);

    const memo = '洗替（所得税法52条3項）';
    const lines: JournalLine[] = [
      {
        id: newId(),
        entryId,
        side: 'debit',
        accountCode: RESERVE_LIABILITY,
        amount: preview.total,
        amountIndexed: toIndexable(D(preview.total)),
        taxRate: 0,
        taxIncluded: false,
        invoiceCompliant: false,
        memo,
      },
      ...preview.reversals.map((r): JournalLine => ({
        id: newId(),
        entryId,
        side: 'credit',
        accountCode: r.accountCode,
        amount: r.amount,
        amountIndexed: toIndexable(D(r.amount)),
        taxRate: 0,
        taxIncluded: false,
        invoiceCompliant: false,
        memo,
      })),
    ];
    await db.journalLines.bulkAdd(lines);
  });

  if (alreadyExists) {
    return { reason: 'already-exists' };
  }
  return { entryId, total: preview.total };
}
