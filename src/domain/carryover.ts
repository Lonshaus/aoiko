import { db } from '../db/db';
import { D, type Decimal, toIndexable } from '../lib/decimal';
import { newId } from '../lib/id';
import { countsTowardTotals } from './journal';
import type { JournalEntry, JournalLine } from '../db/types';

export interface CarryoverPreview {
  year: number;
  priorYear: number;
  openingDate: string;
  assets: Array<{ accountCode: string; accountName: string; amount: string }>;
  liabilities: Array<{ accountCode: string; accountName: string; amount: string }>;
  capitalCode: string;
  capitalAmount: string;
  priorNetIncome: string;
  priorOwnerWithdrawals: string;
  priorOwnerContributions: string;
  priorEndingCapital: string;
}

const CAPITAL_CODE = '3110'; // 元入金
const OWNER_WITHDRAW_CODE = '1610'; // 事業主貸
const OWNER_CONTRIB_CODE = '3120'; // 事業主借
// 個人事業主の期首振替仕訳を生成する。
// 仕組み：前年の資産・負債残高をそのまま翌年期首に持ち越し、
// 事業主貸・事業主借・前期純利益はすべて元入金へ吸収する。
//
// 新元入金 = 前年末元入金 + 前年純利益 + 事業主借残高 − 事業主貸残高
//
// 期首振替仕訳（YYYY-01-01）：
//   借方：各資産科目（事業主貸を除く）の前年末残高
//   貸方：各負債科目の前年末残高 + 新元入金
export async function computeCarryover(year: number): Promise<CarryoverPreview> {
  const priorYear = year - 1;

  const entries = await db.journalEntries
    .where('year')
    .equals(priorYear)
    .filter(countsTowardTotals)
    .toArray();
  const accounts = await db.accounts.where('year').equals(priorYear).toArray();
  const accountMap = new Map(accounts.map((a) => [a.code, a]));

  if (entries.length === 0) {
    return {
      year,
      priorYear,
      openingDate: `${year}-01-01`,
      assets: [],
      liabilities: [],
      capitalCode: CAPITAL_CODE,
      capitalAmount: '0',
      priorNetIncome: '0',
      priorOwnerWithdrawals: '0',
      priorOwnerContributions: '0',
      priorEndingCapital: '0',
    };
  }

  const lines = await db.journalLines
    .where('entryId')
    .anyOf(entries.map((e) => e.id))
    .toArray();
  // 残高集計：資産=借方残、負債/純資産=貸方残、収益=貸方残、費用=借方残。
  const balances = new Map<string, Decimal>();
  for (const line of lines) {
    const acc = accountMap.get(line.accountCode);
    if (!acc) {
      continue;
    }
    const cur = balances.get(line.accountCode) ?? D(0);
    const amount = D(line.amount);
    const signed =
      acc.category === 'asset' || acc.category === 'expense'
        ? line.side === 'debit'
          ? amount
          : amount.negated()
        : line.side === 'credit'
          ? amount
          : amount.negated();
    balances.set(line.accountCode, cur.plus(signed));
  }
  // 前年純利益 = 収益合計 − 費用合計
  let revenue = D(0);
  let expense = D(0);
  for (const [code, bal] of balances) {
    const acc = accountMap.get(code);
    if (!acc) {
      continue;
    }
    if (acc.category === 'revenue') {
      revenue = revenue.plus(bal);
    } else if (acc.category === 'expense') {
      expense = expense.plus(bal);
    }
  }
  const netIncome = revenue.minus(expense);

  const ownerWithdrawals = balances.get(OWNER_WITHDRAW_CODE) ?? D(0);
  const ownerContributions = balances.get(OWNER_CONTRIB_CODE) ?? D(0);
  const priorCapital = balances.get(CAPITAL_CODE) ?? D(0);
  // 元入金更新：前期末元入金 + 純利益 + 事業主借 − 事業主貸
  const newCapital = priorCapital.plus(netIncome).plus(ownerContributions).minus(ownerWithdrawals);

  const buildList = (cat: 'asset' | 'liability') => {
    const out: Array<{ accountCode: string; accountName: string; amount: string }> = [];
    for (const [code, bal] of balances) {
      const acc = accountMap.get(code);
      if (!acc || acc.category !== cat) {
        continue;
      }
      if (code === OWNER_WITHDRAW_CODE) {
        continue;
      }
      if (bal.isZero()) {
        continue;
      }
      out.push({ accountCode: code, accountName: acc.name, amount: bal.toString() });
    }
    out.sort((a, b) => a.accountCode.localeCompare(b.accountCode));
    return out;
  };

  return {
    year,
    priorYear,
    openingDate: `${year}-01-01`,
    assets: buildList('asset'),
    liabilities: buildList('liability'),
    capitalCode: CAPITAL_CODE,
    capitalAmount: newCapital.toString(),
    priorNetIncome: netIncome.toString(),
    priorOwnerWithdrawals: ownerWithdrawals.toString(),
    priorOwnerContributions: ownerContributions.toString(),
    priorEndingCapital: priorCapital.toString(),
  };
}
// 期首振替を実際の仕訳としてデータベースへ書き込む。
// 同年度内に既存の carryover 仕訳がある場合はエラー（先に削除する想定）。
export async function applyCarryover(
  year: number,
): Promise<{ entryId: string } | { reason: 'already-exists' | 'empty' }> {
  const preview = await computeCarryover(year);
  if (
    preview.assets.length === 0 &&
    preview.liabilities.length === 0 &&
    D(preview.capitalAmount).isZero()
  ) {
    return { reason: 'empty' };
  }

  const existing = await db.journalEntries
    .where('year')
    .equals(year)
    .filter((e) => e.source === 'carryover' && e.status === 'confirmed')
    .first();
  if (existing) {
    return { reason: 'already-exists' };
  }

  const now = Date.now();
  const entry: JournalEntry = {
    id: newId(),
    date: preview.openingDate,
    year,
    description: `前期繰越（${preview.priorYear}年から）`,
    status: 'confirmed',
    source: 'carryover',
    createdAt: now,
    confirmedAt: now,
  };

  // amount の符号に応じて positiveSide／その逆側へ振り分けた JournalLine を積む。
  const pushSignedLine = (
    lines: JournalLine[],
    accountCode: string,
    amount: Decimal,
    positiveSide: 'debit' | 'credit',
    memo: string,
  ): void => {
    if (amount.isZero()) {
      return;
    }
    const negativeSide = positiveSide === 'debit' ? 'credit' : 'debit';
    lines.push({
      id: newId(),
      entryId: entry.id,
      side: amount.isPositive() ? positiveSide : negativeSide,
      accountCode,
      amount: amount.abs().toString(),
      amountIndexed: toIndexable(amount.abs()),
      taxRate: 0,
      taxIncluded: false,
      invoiceCompliant: false,
      memo,
    });
  };

  const lines: JournalLine[] = [];
  for (const a of preview.assets) {
    pushSignedLine(lines, a.accountCode, D(a.amount), 'debit', '前期繰越');
  }
  for (const l of preview.liabilities) {
    pushSignedLine(lines, l.accountCode, D(l.amount), 'credit', '前期繰越');
  }
  pushSignedLine(
    lines,
    preview.capitalCode,
    D(preview.capitalAmount),
    'credit',
    '前期繰越（元入金）',
  );

  await db.transaction('rw', db.journalEntries, db.journalLines, async () => {
    await db.journalEntries.add(entry);
    await db.journalLines.bulkAdd(lines);
  });

  return { entryId: entry.id };
}

export async function removeCarryover(year: number): Promise<{ removed: boolean }> {
  const existing = await db.journalEntries
    .where('year')
    .equals(year)
    .filter((e) => e.source === 'carryover')
    .toArray();
  if (existing.length === 0) {
    return { removed: false };
  }
  await db.transaction('rw', db.journalEntries, db.journalLines, async () => {
    for (const e of existing) {
      await db.journalLines.where('entryId').equals(e.id).delete();
      await db.journalEntries.delete(e.id);
    }
  });
  return { removed: true };
}
