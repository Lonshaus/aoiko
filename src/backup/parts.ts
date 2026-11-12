import type { SettingsMap } from '../lib/settings';
// バックアップの区分と、端末から出さない項目の唯一の定義。書き出し（payload.ts）と
// 復元（restore.ts / restore-validate.ts）は、表や設定キーの一覧をここからだけ読む。
export const BOOK_TABLES = [
  'journalEntries',
  'journalLines',
  'accounts',
  'subAccounts',
  'vendors',
  'inventoryItems',
  'fixedAssets',
  'reportSnapshots',
  'personalDeductions',
  'budgets',
  'arApEntries',
  'invoices',
  'parserRules',
  'importBatches',
] as const;
export const ATTACHMENT_TABLES = ['attachments'] as const;
// settings 表は区分を持たず、行ごとにキーで区分を決める。
export const SETTINGS_TABLE = 'settings';
export const DEVICE_ONLY_TABLES = ['stamps'] as const;

export const BUSINESS_SETTING_KEYS = [
  'currentYear',
  'userBusinessName',
  'userInvoiceNumber',
  'invoiceNumberPrefix',
  'quoteNumberPrefix',
  'filingType',
  'aoiroDeductionKind',
  'cashBasisElection',
  'realEstateIncomeEnabled',
  'businessStartDate',
  'businessCloseDate',
  'homeOfficeAccountRatios',
  'inventoryAutoValuationEnabled',
  'taxRegistration',
  'taxFilingMethod',
  'simplifiedTaxCategory',
  'consumptionTaxAttributionMethod',
  'invoiceRegistrationStartDate',
  'taxableElectionPeriod',
  'inheritanceSpecialDate',
  'adjustedFixedAssetDate',
  'shortenedTaxPeriod',
  'foreignWithoutDomesticPe',
  'basePeriodTaxableSales',
  'specifiedPeriodTaxableSales',
  'simplifiedElectionFiledDate',
  'interimVoluntaryFiled',
  'interimVoluntaryLapsed',
  'interimPriorPeriodMonths',
  'wariBaseAdjustments',
] as const satisfies readonly (keyof SettingsMap)[];
// ocrEngine は SettingsMap から消えた旧キー。復元後に migrateOcrEngineSetting が移し替える。
export const AI_SETTING_KEYS = [
  'aiEngine',
  'geminiModel',
  'openaiBaseUrl',
  'openaiOcrModel',
  'openaiClassifyModel',
  'receiptMethod',
  'receiptRuleEngine',
  'ocrEngine',
] as const satisfies readonly (keyof SettingsMap | 'ocrEngine')[];
export const API_KEY_SETTING_KEYS = [
  'geminiApiKey',
  'openaiApiKey',
] as const satisfies readonly (keyof SettingsMap)[];
export const FILER_SETTING_KEYS = [
  'userRiyoshaId',
  'userFilerName',
  'userFilerZip',
  'userFilerAddress',
  'userZeimushoCode',
  'userZeimushoName',
] as const satisfies readonly (keyof SettingsMap)[];
// 同意の記録と「次回から確認しない」も端末ごとに取り直す。バックアップで運ぶと、
// 送信前の確認を切った状態を別の端末へ持ち込めてしまう。
export const DEVICE_ONLY_SETTING_KEYS = [
  'backupFolderHandle',
  'nativeBackupFolder',
  'supporterBadgeAt',
  'lastBackupAt',
  'lastDownloadAt',
  'lastBlobSweepAt',
  'backupRetentionCount',
  'blobRetentionDays',
  'backupParts',
  'disclaimerAcceptedAt',
  'disclaimerAcceptedVersion',
  'skipExternalSendConfirm',
  'skipAttachmentConfirm',
  'skipFiledYearWarning',
  'skipDownloadSavedConfirm',
  'dataCheckAcknowledged',
  'processingYearResetTo',
  'dismissedInterruptedOpeningYears',
  'dismissedMissingOpeningAssets',
] as const satisfies readonly (keyof SettingsMap)[];

export const RESTORABLE_TABLES: ReadonlySet<string> = new Set([
  ...BOOK_TABLES,
  ...ATTACHMENT_TABLES,
]);
export const RESTORABLE_SETTING_KEYS: ReadonlySet<string> = new Set([
  ...BUSINESS_SETTING_KEYS,
  ...AI_SETTING_KEYS,
  ...API_KEY_SETTING_KEYS,
  ...FILER_SETTING_KEYS,
]);
export const DEVICE_ONLY_SETTING_KEY_SET: ReadonlySet<string> = new Set(DEVICE_ONLY_SETTING_KEYS);

export function isRestorableSettingKey(key: unknown): boolean {
  return typeof key === 'string' && RESTORABLE_SETTING_KEYS.has(key);
}
// 区分の ID。この並びを標準の順序とし、バックアップの parts もこの順に書く。
export const BACKUP_PART_IDS = [
  'books',
  'attachments',
  'business',
  'ai',
  'apiKeys',
  'filer',
] as const;
export type BackupPartId = (typeof BACKUP_PART_IDS)[number];
const BACKUP_PART_ID_SET: ReadonlySet<string> = new Set(BACKUP_PART_IDS);

export function isBackupPartId(v: unknown): v is BackupPartId {
  return typeof v === 'string' && BACKUP_PART_ID_SET.has(v);
}

export const BACKUP_PART_TABLES: Readonly<Record<BackupPartId, readonly string[]>> = {
  books: BOOK_TABLES,
  attachments: ATTACHMENT_TABLES,
  business: [],
  ai: [],
  apiKeys: [],
  filer: [],
};
export const BACKUP_PART_SETTING_KEYS: Readonly<Record<BackupPartId, readonly string[]>> = {
  books: [],
  attachments: [],
  business: BUSINESS_SETTING_KEYS,
  ai: AI_SETTING_KEYS,
  apiKeys: API_KEY_SETTING_KEYS,
  filer: FILER_SETTING_KEYS,
};
const PART_OF_SETTING_KEY: ReadonlyMap<string, BackupPartId> = new Map(
  BACKUP_PART_IDS.flatMap((part) =>
    BACKUP_PART_SETTING_KEYS[part].map((key) => [key, part] as const),
  ),
);

export function settingKeyPart(key: unknown): BackupPartId | undefined {
  return typeof key === 'string' ? PART_OF_SETTING_KEY.get(key) : undefined;
}
// 書き出しの既定。従来（API キーと申告者情報を含めない）と同じ中身。
export const EXPORT_DEFAULT_PARTS: readonly BackupPartId[] = [
  'books',
  'attachments',
  'business',
  'ai',
];
// 復元で最初から選んでおく区分。AI と外部送信の設定・API キーは、送信先を差し替えられた
// バックアップでも黙って入らないよう、利用者が自分で選んだときだけ復元する。
export const IMPORT_DEFAULT_PARTS: ReadonlySet<BackupPartId> = new Set([
  'books',
  'attachments',
  'business',
  'filer',
]);
// 旧バージョンの復元は全表と全設定を消してから書くので、この 4 区分のどれかが欠けた
// バックアップを読ませると、消したまま書き戻せない。
const FULL_PAYLOAD_PARTS: readonly BackupPartId[] = ['books', 'attachments', 'business', 'ai'];
export const FULL_PAYLOAD_VERSION = 1;
export const PARTIAL_PAYLOAD_VERSION = 2;

export function payloadVersionForParts(parts: ReadonlySet<BackupPartId>): number {
  return FULL_PAYLOAD_PARTS.every((p) => parts.has(p))
    ? FULL_PAYLOAD_VERSION
    : PARTIAL_PAYLOAD_VERSION;
}

export function hasFullPayloadParts(parts: ReadonlySet<BackupPartId>): boolean {
  return payloadVersionForParts(parts) === FULL_PAYLOAD_VERSION;
}

export function sortBackupParts(parts: Iterable<BackupPartId>): BackupPartId[] {
  const set = new Set(parts);
  return BACKUP_PART_IDS.filter((p) => set.has(p));
}
// 自動バックアップは帳簿を守るためのものなので、帳簿データは必ず含める。
export function normalizeAutoBackupParts(value: unknown): BackupPartId[] {
  if (!Array.isArray(value)) {
    return [...EXPORT_DEFAULT_PARTS];
  }
  const parts = new Set<BackupPartId>(['books']);
  for (const v of value) {
    if (isBackupPartId(v)) {
      parts.add(v);
    }
  }
  return sortBackupParts(parts);
}
// 以前の書き出しが除外に使っていた一覧（中身は従来のまま）。今の書き出しは区分から含めるキーを選ぶ。
// - backupFolderHandle：FileSystemDirectoryHandle でシリアライズできない
// - nativeBackupFolder：端末固有（パス / security-scoped bookmark）で、別端末では
//   存在しない場所や他人のフォルダを指し得る
// - supporterBadgeAt：ストアから復元できるもので、運ぶと買っていない端末へ持ち込める
export const SKIP_SETTING_KEYS: ReadonlySet<string> = new Set([
  'backupFolderHandle',
  'nativeBackupFolder',
  'supporterBadgeAt',
]);
export const SKIP_TABLES: ReadonlySet<string> = new Set(DEVICE_ONLY_TABLES);
export const SENSITIVE_SETTING_KEYS: ReadonlySet<string> = new Set(API_KEY_SETTING_KEYS);
export const FILER_INFO_SETTING_KEYS: ReadonlySet<string> = new Set(FILER_SETTING_KEYS);
