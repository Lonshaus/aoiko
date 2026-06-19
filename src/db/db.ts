import Dexie, { type Table } from 'dexie';
import type {
  Account,
  FixedAsset,
  ImportBatch,
  JournalEntry,
  JournalLine,
  ParserRule,
  ReportSnapshot,
  Setting,
  SubAccount,
  Vendor,
} from './types';

export class AoikoDB extends Dexie {
  journalEntries!: Table<JournalEntry, string>;
  journalLines!: Table<JournalLine, string>;
  accounts!: Table<Account, [string, number]>;
  subAccounts!: Table<SubAccount, string>;
  vendors!: Table<Vendor, string>;
  fixedAssets!: Table<FixedAsset, string>;
  parserRules!: Table<ParserRule, string>;
  importBatches!: Table<ImportBatch, string>;
  reportSnapshots!: Table<ReportSnapshot, string>;
  settings!: Table<Setting, string>;

  constructor() {
    super('aoiko');

    this.version(1).stores({
      journalEntries:
        'id, date, year, status, originalEntryId, [year+date], [date+status]',
      journalLines:
        'id, entryId, accountCode, vendorId, side, amountIndexed, [entryId+side], [accountCode+vendorId], [accountCode+amountIndexed], [vendorId+amountIndexed]',
      accounts: '[code+year], year, category, parentCode',
      subAccounts: 'id, accountCode, name',
      vendors: 'id, name, invoiceNumber, entityType, *aliases',
      fixedAssets: 'id, acquisitionDate, accountCode',
      homeOfficeRules: 'id, accountCode, [accountCode+validFrom]',
      candidateEntries:
        'id, importBatchId, status, date, [importBatchId+status]',
      parserRules: 'id, matchType, vendorId, accountCode, priority',
      importBatches: 'id, parserName, fileHash, importedAt',
      reportSnapshots: 'id, year, type, status, [year+type+status]',
      settings: 'key, updatedAt',
    });
    // v2: sourceImportId 索引を追加（インポート履歴の全件走査・バッチ訂正の全件走査を解消）。
    // 既存 index への追加のみで、Dexie が既存データから自動でインデックスを再構築する。
    this.version(2).stores({
      journalEntries:
        'id, date, year, status, originalEntryId, sourceImportId, [year+date], [date+status]',
    });
    // v3: 未使用テーブルを削除。candidateEntries（候補ワークフローは未実装、確定仕訳を直接書く）と
    // homeOfficeRules（家事按分は入力時にインライン計算）はどちらも読み書きされていなかった。
    this.version(3).stores({
      homeOfficeRules: null,
      candidateEntries: null,
    });
  }
}

export const db = new AoikoDB();