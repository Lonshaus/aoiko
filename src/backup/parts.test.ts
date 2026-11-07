import { describe, expect, test } from 'vitest';
import { db } from '../db/db';
import type { SettingsMap } from '../lib/settings';
import {
  AI_SETTING_KEYS,
  API_KEY_SETTING_KEYS,
  ATTACHMENT_TABLES,
  BACKUP_PART_IDS,
  BACKUP_PART_SETTING_KEYS,
  BACKUP_PART_TABLES,
  BOOK_TABLES,
  BUSINESS_SETTING_KEYS,
  EXPORT_DEFAULT_PARTS,
  normalizeAutoBackupParts,
  payloadVersionForParts,
  type BackupPartId,
  DEVICE_ONLY_SETTING_KEYS,
  DEVICE_ONLY_TABLES,
  FILER_SETTING_KEYS,
  isRestorableSettingKey,
  RESTORABLE_SETTING_KEYS,
  RESTORABLE_TABLES,
  SETTINGS_TABLE,
} from './parts';
import { FILER_INFO_SETTING_KEYS, SENSITIVE_SETTING_KEYS, SKIP_SETTING_KEYS } from './payload';

type Categorized =
  | (typeof BUSINESS_SETTING_KEYS)[number]
  | (typeof AI_SETTING_KEYS)[number]
  | (typeof API_KEY_SETTING_KEYS)[number]
  | (typeof FILER_SETTING_KEYS)[number]
  | (typeof DEVICE_ONLY_SETTING_KEYS)[number];
// SettingsMap にキーを足して区分を決め忘れると、ここがコンパイルで止まる。
const everyKeyCategorized: [Exclude<keyof SettingsMap, Categorized>] extends [never]
  ? true
  : false = true;
// 欠けても余ってもコンパイルで止まる、SettingsMap のキーの実行時の一覧。
const ALL_SETTING_KEYS: Record<keyof SettingsMap, true> = {
  currentYear: true,
  backupFolderHandle: true,
  nativeBackupFolder: true,
  supporterBadgeAt: true,
  lastBackupAt: true,
  lastDownloadAt: true,
  backupRetentionCount: true,
  blobRetentionDays: true,
  lastBlobSweepAt: true,
  homeOfficeAccountRatios: true,
  userBusinessName: true,
  userInvoiceNumber: true,
  geminiApiKey: true,
  geminiModel: true,
  aiEngine: true,
  receiptMethod: true,
  receiptRuleEngine: true,
  openaiBaseUrl: true,
  openaiOcrModel: true,
  openaiClassifyModel: true,
  openaiApiKey: true,
  skipExternalSendConfirm: true,
  backupParts: true,
  disclaimerAcceptedAt: true,
  disclaimerAcceptedVersion: true,
  taxRegistration: true,
  taxFilingMethod: true,
  simplifiedTaxCategory: true,
  consumptionTaxAttributionMethod: true,
  invoiceRegistrationStartDate: true,
  taxableElectionPeriod: true,
  inheritanceSpecialDate: true,
  adjustedFixedAssetDate: true,
  shortenedTaxPeriod: true,
  foreignWithoutDomesticPe: true,
  basePeriodTaxableSales: true,
  specifiedPeriodTaxableSales: true,
  simplifiedElectionFiledDate: true,
  interimVoluntaryFiled: true,
  interimVoluntaryLapsed: true,
  interimPriorPeriodMonths: true,
  wariBaseAdjustments: true,
  userRiyoshaId: true,
  userFilerName: true,
  userFilerZip: true,
  userFilerAddress: true,
  userZeimushoCode: true,
  userZeimushoName: true,
  filingType: true,
  aoiroDeductionKind: true,
  cashBasisElection: true,
  realEstateIncomeEnabled: true,
  inventoryAutoValuationEnabled: true,
  skipAttachmentConfirm: true,
  skipDownloadSavedConfirm: true,
  skipFiledYearWarning: true,
  invoiceNumberPrefix: true,
  quoteNumberPrefix: true,
  businessStartDate: true,
  businessCloseDate: true,
  dataCheckAcknowledged: true,
  processingYearResetTo: true,
};

const SETTING_PARTS: readonly (readonly string[])[] = [
  BUSINESS_SETTING_KEYS,
  AI_SETTING_KEYS,
  API_KEY_SETTING_KEYS,
  FILER_SETTING_KEYS,
  DEVICE_ONLY_SETTING_KEYS,
];
const TABLE_PARTS: readonly (readonly string[])[] = [
  BOOK_TABLES,
  ATTACHMENT_TABLES,
  [SETTINGS_TABLE],
  DEVICE_ONLY_TABLES,
];

function countIn(parts: readonly (readonly string[])[], name: string): number {
  return parts.filter((p) => p.includes(name)).length;
}

describe('設定キーの区分', () => {
  test('SettingsMap の全キーがどれかの区分に入っている（コンパイル時）', () => {
    expect(everyKeyCategorized).toBe(true);
  });

  test('SettingsMap の各キーはちょうど 1 つの区分に属する（実行時）', () => {
    const wrong = Object.keys(ALL_SETTING_KEYS).filter((k) => countIn(SETTING_PARTS, k) !== 1);
    expect(wrong).toEqual([]);
  });

  test('区分に載っているのは SettingsMap のキーと旧キー ocrEngine だけ', () => {
    const known = new Set([...Object.keys(ALL_SETTING_KEYS), 'ocrEngine']);
    const extra = SETTING_PARTS.flat().filter((k) => !known.has(k));
    expect(extra).toEqual([]);
  });

  test('ocrEngine は AI と外部送信の区分', () => {
    expect(countIn(SETTING_PARTS, 'ocrEngine')).toBe(1);
    expect(AI_SETTING_KEYS).toContain('ocrEngine');
  });

  test('復元する設定キーは ③④⑤⑥ の和で、端末専用を含まない', () => {
    expect([...RESTORABLE_SETTING_KEYS].sort()).toEqual(
      [
        ...BUSINESS_SETTING_KEYS,
        ...AI_SETTING_KEYS,
        ...API_KEY_SETTING_KEYS,
        ...FILER_SETTING_KEYS,
      ].sort(),
    );
    for (const k of DEVICE_ONLY_SETTING_KEYS) {
      expect(isRestorableSettingKey(k)).toBe(false);
    }
  });

  test('Object.prototype の名前や文字列以外のキーは復元対象にならない', () => {
    expect(isRestorableSettingKey('constructor')).toBe(false);
    expect(isRestorableSettingKey('toString')).toBe(false);
    expect(isRestorableSettingKey('__proto__')).toBe(false);
    expect(isRestorableSettingKey(1)).toBe(false);
    expect(isRestorableSettingKey(undefined)).toBe(false);
  });
});

describe('表の区分', () => {
  test('db の各表はちょうど 1 つの区分に属する', () => {
    const wrong = db.tables.map((t) => t.name).filter((n) => countIn(TABLE_PARTS, n) !== 1);
    expect(wrong).toEqual([]);
  });

  test('区分に載っている表はすべて db にある', () => {
    const names = new Set(db.tables.map((t) => t.name));
    expect(TABLE_PARTS.flat().filter((n) => !names.has(n))).toEqual([]);
  });

  test('① ② に settings と stamps は入らない', () => {
    expect(RESTORABLE_TABLES.has('settings')).toBe(false);
    expect(RESTORABLE_TABLES.has('stamps')).toBe(false);
    expect([...RESTORABLE_TABLES].sort()).toEqual([...BOOK_TABLES, ...ATTACHMENT_TABLES].sort());
  });
});

describe('payload.ts が使う一覧は従来の中身のまま', () => {
  test('SKIP_SETTING_KEYS', () => {
    expect([...SKIP_SETTING_KEYS].sort()).toEqual(
      ['backupFolderHandle', 'nativeBackupFolder', 'supporterBadgeAt'].sort(),
    );
  });

  test('SENSITIVE_SETTING_KEYS', () => {
    expect([...SENSITIVE_SETTING_KEYS].sort()).toEqual(['geminiApiKey', 'openaiApiKey']);
  });

  test('FILER_INFO_SETTING_KEYS', () => {
    expect([...FILER_INFO_SETTING_KEYS].sort()).toEqual(
      [
        'userRiyoshaId',
        'userFilerName',
        'userFilerZip',
        'userFilerAddress',
        'userZeimushoCode',
        'userZeimushoName',
      ].sort(),
    );
  });

  test('書き出しで除く設定キーは端末専用の一部', () => {
    for (const k of SKIP_SETTING_KEYS) {
      expect(DEVICE_ONLY_SETTING_KEYS as readonly string[]).toContain(k);
    }
  });
});

describe('区分 ID と表・キーの対応', () => {
  test('ID は標準の順序で 6 つ', () => {
    expect(BACKUP_PART_IDS).toEqual(['books', 'attachments', 'business', 'ai', 'apiKeys', 'filer']);
  });

  test('各 ID の表', () => {
    expect(BACKUP_PART_TABLES).toEqual({
      books: BOOK_TABLES,
      attachments: ATTACHMENT_TABLES,
      business: [],
      ai: [],
      apiKeys: [],
      filer: [],
    });
  });

  test('各 ID の設定キー', () => {
    expect(BACKUP_PART_SETTING_KEYS).toEqual({
      books: [],
      attachments: [],
      business: BUSINESS_SETTING_KEYS,
      ai: AI_SETTING_KEYS,
      apiKeys: API_KEY_SETTING_KEYS,
      filer: FILER_SETTING_KEYS,
    });
  });
});

describe('payloadVersionForParts', () => {
  const full: BackupPartId[] = ['books', 'attachments', 'business', 'ai'];

  test('① ② ③ ④ がそろえば 1（⑤ ⑥ の有無は問わない）', () => {
    expect(payloadVersionForParts(new Set(full))).toBe(1);
    expect(payloadVersionForParts(new Set<BackupPartId>([...full, 'apiKeys', 'filer']))).toBe(1);
  });

  test.each(full)('%s が欠けると 2', (missing) => {
    const parts = new Set<BackupPartId>([...full, 'apiKeys', 'filer']);
    parts.delete(missing);
    expect(payloadVersionForParts(parts)).toBe(2);
  });

  test('⑤ だけなら 2', () => {
    expect(payloadVersionForParts(new Set<BackupPartId>(['apiKeys']))).toBe(2);
  });
});

describe('normalizeAutoBackupParts', () => {
  test.each([undefined, null, 'books', { books: true }])('配列でない %s は書き出しの既定', (v) => {
    expect(normalizeAutoBackupParts(v)).toEqual(EXPORT_DEFAULT_PARTS);
  });

  test('未知の値と重複を除く', () => {
    expect(normalizeAutoBackupParts(['books', 'x', 'filer', 'filer', 'constructor', 1])).toEqual([
      'books',
      'filer',
    ]);
  });

  test('帳簿データが無ければ足す', () => {
    expect(normalizeAutoBackupParts(['business'])).toEqual(['books', 'business']);
    expect(normalizeAutoBackupParts([])).toEqual(['books']);
  });

  test('証憑写真は帳簿データを足したうえで残す', () => {
    expect(normalizeAutoBackupParts(['attachments'])).toEqual(['books', 'attachments']);
  });

  test('標準の順序に並べる', () => {
    expect(normalizeAutoBackupParts(['filer', 'ai', 'books', 'attachments'])).toEqual([
      'books',
      'attachments',
      'ai',
      'filer',
    ]);
  });
});
