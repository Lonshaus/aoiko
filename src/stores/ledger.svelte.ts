import { liveQuery, type Subscription } from 'dexie';
import { db } from '../db/db';
import { D } from '../lib/decimal';
import { countsTowardTotals, plContribution } from '../domain/journal';
import { getSetting } from '../lib/settings';
// 現状の勘定科目スキーマは 2026 年分のみ。年度セレクタ／翌年分スキーマ追加までの既定値。
const DEFAULT_YEAR = 2026;
import type {
  Account,
  AccountCategory,
  FixedAsset,
  IncomeType,
  InventoryItem,
  JournalEntry,
  ParserRule,
  SubAccount,
  Vendor,
} from '../db/types';

const CATEGORY_ORDER: AccountCategory[] = ['asset', 'liability', 'equity', 'revenue', 'expense'];

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
export async function buildLedgerRows(entries: JournalEntry[], year: number): Promise<LedgerRow[]> {
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
    const totalAmount = debits.reduce((sum, l) => sum.plus(l.amount), D(0)).toString();
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
  currentYear = $state<number>(DEFAULT_YEAR);
  // 不動産所得を使うか（Settings.svelte のオプトイン設定、既定 false）。
  realEstateIncomeEnabled = $state<boolean>(false);
  inventoryItems = $state<InventoryItem[]>([]);
  // 部門タグ（C5）。既存の journalEntries.department に実際に使われている値の一覧
  // （入力補完用、マスタテーブルは持たない——軽量な自由記述タグのため）。
  departments = $state<string[]>([]);
  // 簡易在庫管理（C4）の期末棚卸高自動計算を使うか（既定 true、未設定時は法定デフォルトの
  // 最終仕入原価法が適用されるため）。
  inventoryAutoValuationEnabled = $state<boolean>(true);
  // liveQuery がエラー（DB 障害・容量超過等）を出した場合のメッセージ。null＝正常。
  lastError = $state<string | null>(null);

  private subs: Subscription[] = [];
  private yearSubs: Subscription[] = [];

  constructor() {
    // 年度に依存しない購読
    this.subs.push(
      this.sub(
        () => db.subAccounts.orderBy('name').toArray(),
        (v) => {
          this.subAccounts = v;
        },
      ),
      this.sub(
        () => db.vendors.orderBy('name').toArray(),
        (v) => {
          this.vendors = v;
        },
      ),
      this.sub(
        () => db.parserRules.orderBy('priority').reverse().toArray(),
        (v) => {
          this.parserRules = v;
        },
      ),
      this.sub(
        () => db.fixedAssets.orderBy('acquisitionDate').toArray(),
        (v) => {
          this.fixedAssets = v;
        },
      ),
      this.sub(
        () => db.accounts.count(),
        (v) => {
          this.accountsCount = v;
        },
      ),
      this.sub(
        () => db.journalEntries.count(),
        (v) => {
          this.entriesCount = v;
        },
      ),
      this.sub(
        () => db.journalLines.count(),
        (v) => {
          this.linesCount = v;
        },
      ),
      this.sub(
        () => db.journalEntries.orderBy('date').reverse().limit(5).toArray(),
        (v) => {
          this.recentEntries = v;
        },
      ),
      this.sub(
        () => db.settings.get('realEstateIncomeEnabled'),
        (v) => {
          this.realEstateIncomeEnabled = v?.value === true;
        },
      ),
      this.sub(
        () => db.inventoryItems.orderBy('name').toArray(),
        (v) => {
          this.inventoryItems = v;
        },
      ),
      this.sub(
        () => db.settings.get('inventoryAutoValuationEnabled'),
        (v) => {
          this.inventoryAutoValuationEnabled = v?.value !== false;
        },
      ),
      this.sub(
        () => db.journalEntries.orderBy('department').uniqueKeys(),
        (v) => {
          this.departments = v.filter((d): d is string => typeof d === 'string' && d !== '');
        },
      ),
    );
    // 年度依存の購読は currentYear 設定を読んでから（既定値で先に張り、設定値が違えば張り直す）
    this.subscribeYearScoped();
    void getSetting('currentYear').then((y) => {
      if (typeof y === 'number' && y !== this.currentYear) {
        this.currentYear = y;
        this.subscribeYearScoped();
      }
    });
  }
  // liveQuery を購読し、エラーを lastError に集約する共通ラッパー。
  private sub<T>(query: () => T | Promise<T>, next: (v: T) => void): Subscription {
    return liveQuery(query).subscribe({
      next: (v) => {
        this.lastError = null;
        next(v);
      },
      error: (e: unknown) => {
        this.lastError = e instanceof Error ? e.message : String(e);
      },
    });
  }
  // currentYear に依存する購読を張り直す（年度切替時に呼ぶ）。
  private subscribeYearScoped(): void {
    for (const s of this.yearSubs) {
      s.unsubscribe();
    }
    const year = this.currentYear;
    this.yearSubs = [
      this.sub(
        () => db.accounts.where({ year }).sortBy('code'),
        (v) => {
          this.allAccounts = v;
          this.accounts = v.filter((a) => a.isActive !== false);
        },
      ),
      this.sub(
        () => this.computeRecentRows(year),
        (v) => {
          this.recentLedgerRows = v;
        },
      ),
      this.sub(
        () => this.computeMonthlyOverview(year),
        (v) => {
          this.monthlyOverview = v;
        },
      ),
    ];
  }

  subAccountsFor(accountCode: string): SubAccount[] {
    return this.subAccounts.filter((s) => s.accountCode === accountCode);
  }

  groupedAccounts(incomeType: IncomeType = 'business'): AccountGroup[] {
    const byCategory = new Map<AccountCategory, Account[]>();
    for (const a of this.accounts) {
      if ((a.incomeType ?? 'business') !== incomeType) {
        continue;
      }
      const arr = byCategory.get(a.category) ?? [];
      arr.push(a);
      byCategory.set(a.category, arr);
    }
    return CATEGORY_ORDER.flatMap((cat) => {
      const items = byCategory.get(cat);
      return items ? [{ category: cat, label: CATEGORY_LABEL[cat], items }] : [];
    });
  }

  private async computeRecentRows(year: number): Promise<LedgerRow[]> {
    const entries = await db.journalEntries.orderBy('date').reverse().limit(10).toArray();
    return buildLedgerRows(entries, year);
  }

  private async computeMonthlyOverview(year: number): Promise<MonthlyOverview> {
    const month = new Date().getMonth() + 1;
    const monthStart = `${year}-${String(month).padStart(2, '0')}-01`;
    const nextMonthStart =
      month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, '0')}-01`;

    const entries = await db.journalEntries
      .where('[year+date]')
      .between([year, monthStart], [year, nextMonthStart], true, false)
      .toArray();
    const confirmed = entries.filter(countsTowardTotals);

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
      const contrib = plContribution(acc.category, line);
      if (contrib === null) {
        continue;
      }
      if (acc.category === 'revenue') {
        revenue = revenue.plus(contrib);
      } else {
        expense = expense.plus(contrib);
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
