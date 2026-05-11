import Dexie, { type Table } from 'dexie';
import type {
  Account,
  CandidateEntry,
  FixedAsset,
  HomeOfficeRule,
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
  homeOfficeRules!: Table<HomeOfficeRule, string>;
  candidateEntries!: Table<CandidateEntry, string>;
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
  }
}

export const db = new AoikoDB();