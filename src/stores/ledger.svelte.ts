import { liveQuery, type Subscription } from 'dexie';
import { db } from '../db/db';
import { D } from '../lib/decimal';
import type {
  Account,
  AccountCategory,
  FixedAsset,
  JournalEntry,
  ParserRule,
  SubAccount,
  Vendor,
} from '../db/types';

const CATEGORY_ORDER: AccountCategory[] = [
  'asset',
  'liability',
  'equity',
  'revenue',
  'expense',
];

const CATEGORY_LABEL: Record<AccountCategory, string> = {
  asset: '資産',
  liability: '負債',
  equity: '純資産',
  revenue: '収益',
  expense: '費用',
};

export interface AccountGroup {
  category: AccountCategory;
  label: string;
  items: Account[];
}

export interface LedgerRowSide {
  code: string;
  name: string;
  subAccountName?: string;
  amount: string;
  taxRate: number;
  memo?: string;
}

export interface LedgerRow {
  entry: JournalEntry;
  debits: LedgerRowSide[];
  credits: LedgerRowSide[];
  totalAmount: string;
}

export interface MonthlyOverview {
  year: number;
  month: number;
  revenue: string;
  expense: string;
  netIncome: string;
  entryCount: number;
}

// 仕訳一覧 / 直近の仕訳で共通利用する LedgerRow 構築ヘルパー。
// 与えられた entries に対して lines / accounts / subAccounts を一括取得して結合する。
export async function buildLedgerRows(
  entries: JournalEntry[],
  year: number
): Promise<LedgerRow[]> {
  if (entries.length === 0) {
    return [];
  }
  const lines = await db.journalLines
    .where('entryId')
    .anyOf(entries.map((e) => e.id))
    .toArray();
  const accounts = await db.accounts.where({ year }).toArray();
  const subAccounts = await db.subAccounts.toArray();

  const accountMap = new Map(accounts.map((a) => [a.code, a.name]));
  const subMap = new Map(subAccounts.map((s) => [s.id, s.name]));

  return entries.map((entry) => {
    const entryLines = lines.filter((l) => l.entryId === entry.id);
    const buildSide = (side: 'debit' | 'credit'): LedgerRowSide[] =>
      entryLines
        .filter((l) => l.side === side)
        .map((l) => {
          const subName = l.subAccountId ? subMap.get(l.subAccountId) : undefined;
          return {
            code: l.accountCode,
            name: accountMap.get(l.accountCode) ?? l.accountCode,
            ...(subName ? { subAccountName: subName } : {}),
            amount: l.amount,
            taxRate: l.taxRate,
            ...(l.memo ? { memo: l.memo } : {}),
          };
        });

    const debits = buildSide('debit');
    const credits = buildSide('credit');
    const totalAmount = debits
      .reduce((sum, l) => sum.plus(l.amount), D(0))
      .toString();
    return { entry, debits, credits, totalAmount };
  });
}

function emptyOverview(): MonthlyOverview {
  const now = new Date();
  return {
    year: now.getFullYear(),
    month: now.getMonth() + 1,
    revenue: '0',
    expense: '0',
    netIncome: '0',
    entryCount: 0,
  };
}

// Dexie の liveQuery を Svelte 5 のルーンへ橋渡しするシングルトン。
// SPA のライフサイクル全体で生存するので unsubscribe は不要。
class LedgerStore {
  accounts = $state<Account[]>([]);
  allAccounts = $state<Account[]>([]);
  subAccounts = $state<SubAccount[]>([]);
  vendors = $state<Vendor[]>([]);
  parserRules = $state<ParserRule[]>([]);
  fixedAssets = $state<FixedAsset[]>([]);
  accountsCount = $state<number | undefined>(undefined);
  entriesCount = $state<number | undefined>(undefined);
  linesCount = $state<number | undefined>(undefined);
  recentEntries = $state<JournalEntry[]>([]);
  recentLedgerRows = $state<LedgerRow[]>([]);
  monthlyOverview = $state<MonthlyOverview>(emptyOverview());

  private subs: Subscription[] = [];

  constructor() {
    this.subs.push(
      liveQuery(() =>
        db.accounts.where({ year: 2026 }).sortBy('code')
      ).subscribe((v) => {
        this.allAccounts = v;
        this.accounts = v.filter((a) => a.isActive !== false);
      }),
      liveQuery(() => db.subAccounts.orderBy('name').toArray()).subscribe((v) => {
        this.subAccounts = v;
      }),
      liveQuery(() => db.vendors.orderBy('name').toArray()).subscribe((v) => {
        this.vendors = v;
      }),
      liveQuery(() =>
        db.parserRules.orderBy('priority').reverse().toArray()
      ).subscribe((v) => {
        this.parserRules = v;
      }),
      liveQuery(() =>
        db.fixedAssets.orderBy('acquisitionDate').toArray()
      ).subscribe((v) => {
        this.fixedAssets = v;
      }),
      liveQuery(() => db.accounts.count()).subscribe((v) => {
        this.accountsCount = v;
      }),
      liveQuery(() => db.journalEntries.count()).subscribe((v) => {
        this.entriesCount = v;
      }),
      liveQuery(() => db.journalLines.count()).subscribe((v) => {
        this.linesCount = v;
      }),
      liveQuery(() =>
        db.journalEntries.orderBy('date').reverse().limit(5).toArray()
      ).subscribe((v) => {
        this.recentEntries = v;
      }),
      liveQuery(async () => this.computeRecentRows()).subscribe((v) => {
        this.recentLedgerRows = v;
      }),
      liveQuery(async () => this.computeMonthlyOverview()).subscribe((v) => {
        this.monthlyOverview = v;
      })
    );
  }

  subAccountsFor(accountCode: string): SubAccount[] {
    return this.subAccounts.filter((s) => s.accountCode === accountCode);
  }

  groupedAccounts(): AccountGroup[] {
    const byCategory = new Map<AccountCategory, Account[]>();
    for (const a of this.accounts) {
      const arr = byCategory.get(a.category) ?? [];
      arr.push(a);
      byCategory.set(a.category, arr);
    }
    return CATEGORY_ORDER.flatMap((cat) => {
      const items = byCategory.get(cat);
      return items
        ? [{ category: cat, label: CATEGORY_LABEL[cat], items }]
        : [];
    });
  }

  private async computeRecentRows(): Promise<LedgerRow[]> {
    const entries = await db.journalEntries
      .orderBy('date')
      .reverse()
      .limit(10)
      .toArray();
    return buildLedgerRows(entries, 2026);
  }

  private async computeMonthlyOverview(): Promise<MonthlyOverview> {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    const monthStart = `${year}-${String(month).padStart(2, '0')}-01`;
    const nextMonthStart =
      month === 12
        ? `${year + 1}-01-01`
        : `${year}-${String(month + 1).padStart(2, '0')}-01`;

    const entries = await db.journalEntries
      .where('[year+date]')
      .between([year, monthStart], [year, nextMonthStart], true, false)
      .toArray();
    const confirmed = entries.filter((e) => e.status === 'confirmed');

    if (confirmed.length === 0) {
      return { year, month, revenue: '0', expense: '0', netIncome: '0', entryCount: 0 };
    }

    const lines = await db.journalLines
      .where('entryId')
      .anyOf(confirmed.map((e) => e.id))
      .toArray();
    const accounts = await db.accounts.where({ year }).toArray();
    const accountMap = new Map(accounts.map((a) => [a.code, a]));

    let revenue = D(0);
    let expense = D(0);
    for (const line of lines) {
      const acc = accountMap.get(line.accountCode);
      if (!acc) {
        continue;
      }
      if (acc.category === 'revenue' && line.side === 'credit') {
        revenue = revenue.plus(line.amount);
      } else if (acc.category === 'expense' && line.side === 'debit') {
        expense = expense.plus(line.amount);
      }
    }
    return {
      year,
      month,
      revenue: revenue.toString(),
      expense: expense.toString(),
      netIncome: revenue.minus(expense).toString(),
      entryCount: confirmed.length,
    };
  }
}

export const ledger = new LedgerStore();