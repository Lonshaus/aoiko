import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { Blob as NodeBlob } from 'node:buffer';
import { db } from '../db/db';
import { buildBackupZipStream, buildPayload, PAYLOAD_VERSION, type BackupPayload } from '../backup';
import { m } from '../paraglide/messages';
import { newId } from '../lib/id';
import { toIndexable } from '../lib/decimal';
import {
  BackupTooLargeError,
  IncompatibleBackupError,
  isBackupTooLarge,
  parseBackupFile,
  parseBackupJson,
  inspectBackupPayload,
  restoreFromJson,
  restoreFromPayload,
} from './restore';
import { MAX_BACKUP_BYTES } from '../lib/file-limit';
import { BackupValidationError } from './restore-validate';
import {
  BACKUP_PART_IDS,
  BOOK_TABLES,
  BUSINESS_SETTING_KEYS,
  IMPORT_DEFAULT_PARTS,
  RESTORABLE_SETTING_KEYS,
  type BackupPartId,
} from '../backup/parts';
import { migrateBackupPartsSetting } from '../lib/settings-migration';
import { FiledYearError } from '../db/filed-year-guard';
import { markYearFiled } from './snapshots';
import { sha256Hex } from '../lib/sha256';
import type { SettingsMap } from '../lib/settings';
import type {
  Account,
  ArApEntry,
  Budget,
  FixedAsset,
  ImportBatch,
  InventoryItem,
  Invoice,
  JournalEntry,
  JournalLine,
  ParserRule,
  PersonalDeductionInput,
  ReportSnapshot,
  SubAccount,
  Vendor,
} from '../db/types';
// happy-dom の Blob は Node 組込みの structuredClone（fake-indexeddb が内部で使う）に
// 認識されず保存時にプレーンオブジェクトへ潰れてしまうため、実体バイトを読み戻す
// テストだけ Node 組込みの Blob を使う。
function nodeBlob(bytes: Uint8Array<ArrayBuffer>): Blob {
  return new NodeBlob([bytes]) as unknown as Blob;
}

const validInvoice: Invoice = {
  id: 'inv-1',
  documentType: 'invoice',
  status: 'draft',
  number: '',
  vendorId: 'v1',
  date: '2026-05-01',
  lineItems: [],
  createdAt: 1,
};

beforeEach(async () => {
  await db.delete();
  await db.open();
});

afterEach(async () => {
  await db.delete();
});

describe('parseBackupJson', () => {
  test('不正な JSON は例外を投げる', () => {
    expect(() => parseBackupJson('{ not json')).toThrow(/JSON として/);
  });

  test('必須項目が無ければ例外を投げる', () => {
    expect(() => parseBackupJson('{"foo":"bar"}')).toThrow(/バックアップ形式ではありません/);
  });

  test('正しければオブジェクトを返す', () => {
    const json = JSON.stringify({ version: 1, tables: {}, exportedAt: 'x' });
    expect(parseBackupJson(json).version).toBe(1);
  });
});

describe('restoreFromJson', () => {
  test('互換性のないバージョンは例外を投げる', async () => {
    await expect(
      restoreFromJson({ version: 999, exportedAt: '2026-05-10', tables: {} }),
    ).rejects.toThrow(IncompatibleBackupError);
  });

  test('往復：書き出し → 復元で同じ状態になる', async () => {
    const entryId = newId();
    const now = Date.now();
    await db.transaction('rw', [db.journalEntries, db.journalLines, db.vendors], async () => {
      await db.journalEntries.add({
        id: entryId,
        date: '2026-05-01',
        year: 2026,
        description: '電気代',
        status: 'confirmed',
        source: 'manual',
        createdAt: now,
        confirmedAt: now,
      });
      await db.journalLines.bulkAdd([
        {
          id: newId(),
          entryId,
          side: 'debit',
          accountCode: '5130',
          amount: '5000',
          amountIndexed: toIndexable('5000'),
          taxRate: 0,
          taxIncluded: true,
          invoiceCompliant: false,
        },
        {
          id: newId(),
          entryId,
          side: 'credit',
          accountCode: '1130',
          amount: '5000',
          amountIndexed: toIndexable('5000'),
          taxRate: 0,
          taxIncluded: true,
          invoiceCompliant: false,
        },
      ]);
      await db.vendors.add({ id: newId(), name: '東京電力' });
    });

    const payload = await buildPayload();
    expect(payload.version).toBe(PAYLOAD_VERSION);

    const result = await restoreFromJson(payload);
    expect(result.tableCount).toBeGreaterThan(0);

    const entries = await db.journalEntries.toArray();
    const lines = await db.journalLines.toArray();
    const vendors = await db.vendors.toArray();
    expect(entries).toHaveLength(1);
    expect(lines).toHaveLength(2);
    expect(vendors).toHaveLength(1);
    expect(vendors[0]?.name).toBe('東京電力');
  });

  test('不正な payload では既存データを消さずに例外を投げる（検証は削除前）', async () => {
    await db.vendors.add({ id: 'keep-1', name: '残る業者' });

    await expect(
      restoreFromJson({
        version: PAYLOAD_VERSION,
        exportedAt: '2026-05-10',
        // 不正：side が不正な明細
        tables: {
          journalLines: [
            { id: 'x', entryId: 'y', side: 'bogus', accountCode: '1', amount: '1', taxRate: 0 },
          ],
        },
      }),
    ).rejects.toThrow(/side/);

    const vendors = await db.vendors.toArray();
    expect(vendors).toHaveLength(1);
    expect(vendors[0]?.name).toBe('残る業者');
  });

  test('不正な invoices 行（id 欠落）は全消去の前に弾かれ既存データが残る', async () => {
    await db.vendors.add({ id: 'keep-1', name: '残る業者' });
    await expect(
      restoreFromJson({
        version: PAYLOAD_VERSION,
        exportedAt: '2026-05-10',
        tables: { invoices: [{ documentType: 'invoice' }] },
      }),
    ).rejects.toThrow(/invoices/);
    const vendors = await db.vendors.toArray();
    expect(vendors).toHaveLength(1);
    expect(vendors[0]?.name).toBe('残る業者');
  });

  test('書き込み途中の失敗はトランザクションで全ロールバックされ半書き込みを残さない', async () => {
    // 検証は型定義外の欄を見ないため関数値を持つ行は検証を通過するが、
    // structured clone 不可で bulkPut が例外を投げる。全消去後の書き込み失敗を再現する。
    const restoring = restoreFromJson({
      version: PAYLOAD_VERSION,
      exportedAt: '2026-05-10',
      tables: {
        vendors: [{ id: 'v1', name: '業者' }],
        invoices: [{ ...validInvoice, notCloneable: () => {} }],
      },
    });
    await expect(restoring).rejects.toThrow();
    await expect(restoring).rejects.not.toBeInstanceOf(BackupValidationError);
    // vendors は invoices より先に処理されるが、ロールバックで空になる（半書き込みが残らない）。
    const vendors = await db.vendors.toArray();
    expect(vendors).toHaveLength(0);
  });

  test('書き込みが失敗しても既存の帳簿データはロールバックで戻る', async () => {
    const entryId = 'keep-entry';
    const now = Date.now();
    await db.journalEntries.add({
      id: entryId,
      date: '2026-05-01',
      year: 2026,
      description: '復元前からある仕訳',
      status: 'confirmed',
      source: 'manual',
      createdAt: now,
      confirmedAt: now,
    });
    await db.vendors.add({ id: 'keep-vendor', name: '残るべき業者' });

    const restoring = restoreFromJson({
      version: PAYLOAD_VERSION,
      exportedAt: '2026-05-10',
      tables: {
        vendors: [{ id: 'v1', name: '新業者' }],
        invoices: [{ ...validInvoice, notCloneable: () => {} }],
      },
    });
    await expect(restoring).rejects.toThrow();
    await expect(restoring).rejects.not.toBeInstanceOf(BackupValidationError);

    const entries = await db.journalEntries.toArray();
    const vendors = await db.vendors.toArray();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.description).toBe('復元前からある仕訳');
    expect(vendors).toHaveLength(1);
    expect(vendors[0]?.name).toBe('残るべき業者');
  });

  test('書き込みが失敗して巻き戻ったら、申告済みの年度は待たずに止まったまま', async () => {
    const pl = {
      type: 'pl' as const,
      data: { rows: [], totalRevenue: '0', totalExpense: '0', netIncome: '0' },
    };
    await markYearFiled(
      2025,
      { monthlySales: { type: 'monthly-sales', data: { months: [] } }, pl },
      '2025-12-31',
    );
    const restoring = restoreFromJson({
      version: PAYLOAD_VERSION,
      exportedAt: '2026-05-10',
      tables: {
        reportSnapshots: [
          {
            id: 'rs-old',
            year: 2025,
            type: 'pl',
            status: 'superseded',
            payload: pl,
            generatedAt: 1,
            generatedFromEntriesUpTo: '2025-12-31',
          },
        ],
        invoices: [{ ...validInvoice, notCloneable: () => {} }],
      },
    });
    await expect(restoring).rejects.not.toBeInstanceOf(BackupValidationError);
    await expect(
      db.journalEntries.add({
        id: 'e-2025',
        date: '2025-05-01',
        year: 2025,
        description: '申告済みの年度',
        status: 'confirmed',
        source: 'manual',
        createdAt: 1,
        confirmedAt: 1,
      }),
    ).rejects.toThrow(FiledYearError);
  });

  test('復元の前に既存データを消す', async () => {
    await db.vendors.add({ id: newId(), name: '消える業者' });

    await restoreFromJson({
      version: PAYLOAD_VERSION,
      exportedAt: '2026-05-10',
      tables: { vendors: [{ id: 'new-1', name: '新業者' }] },
    });

    const vendors = await db.vendors.toArray();
    expect(vendors).toHaveLength(1);
    expect(vendors[0]?.name).toBe('新業者');
  });

  test('申告者情報がバックアップに無ければこの端末の値を保持する', async () => {
    const now = Date.now();
    await db.settings.bulkPut([
      { key: 'userRiyoshaId', value: '1234567890123456', updatedAt: now },
      { key: 'userFilerName', value: '青井 太郎', updatedAt: now },
    ]);
    // 申告者情報を含まないバックアップ（既定の除外状態）を復元
    await restoreFromJson({
      version: PAYLOAD_VERSION,
      exportedAt: '2026-05-10',
      tables: { vendors: [{ id: 'v1', name: '業者' }] },
    });
    expect((await db.settings.get('userRiyoshaId'))?.value).toBe('1234567890123456');
    expect((await db.settings.get('userFilerName'))?.value).toBe('青井 太郎');
  });

  test('申告者情報がバックアップに含まれていればそれで上書きする', async () => {
    const now = Date.now();
    await db.settings.put({ key: 'userRiyoshaId', value: 'OLD', updatedAt: now });
    await restoreFromJson({
      version: PAYLOAD_VERSION,
      exportedAt: '2026-05-10',
      tables: {
        settings: [{ key: 'userRiyoshaId', value: 'NEW', updatedAt: now }],
      },
    });
    expect((await db.settings.get('userRiyoshaId'))?.value).toBe('NEW');
  });
});
// 復元は全テーブルを clear してから書き戻す。スタンプ帳とバッジはバックアップに
// 入っていないので、素通りさせると「復元しただけで消える」ことになる。
describe('支援の記録は復元で消えない', () => {
  test('スタンプ帳は復元後も残る', async () => {
    await db.stamps.put({
      id: 's1',
      shape: 'yarn',
      color: 'orange',
      at: '2026-08-18',
      createdAt: 1,
    });
    await restoreFromJson({ version: PAYLOAD_VERSION, exportedAt: '2026-08-18', tables: {} });
    expect(await db.stamps.count()).toBe(1);
  });

  test('支援者バッジは復元後も残る', async () => {
    await db.settings.put({ key: 'supporterBadgeAt', value: '2026-08-18', updatedAt: Date.now() });
    await restoreFromJson({ version: PAYLOAD_VERSION, exportedAt: '2026-08-18', tables: {} });
    expect((await db.settings.get('supporterBadgeAt'))?.value).toBe('2026-08-18');
  });
});

describe('証憑写真の zip 往復', () => {
  // 備考：happy-dom + fake-indexeddb の組み合わせでは Blob の structured clone が
  // 中身（バイト列）を保持しない既知の制限があるため（実ブラウザの IndexedDB では問題ない、
  // 生 Node の IndexedDB でも別途動作確認済み）、ここでは attachments 行のメタデータ
  // （entryId・fileName・mimeType）の紐付けのみ検証する。バイト列の往復自体は
  // Dexie を介さない archive.test.ts / attachments.test.ts で厳密に検証済み。
  test('restoreFromPayload は attachments のメタデータを復元する', async () => {
    const entryId = newId();
    const now = Date.now();
    await db.journalEntries.add({
      id: entryId,
      date: '2026-05-01',
      year: 2026,
      description: 'テスト',
      status: 'confirmed',
      source: 'manual',
      createdAt: now,
      confirmedAt: now,
    });

    const payload = await buildPayload();
    const attachmentBlobs = new Map([['att-1', nodeBlob(new Uint8Array([1, 2, 3]))]]);
    payload.tables['attachments'] = [
      { id: 'att-1', entryId, mimeType: 'image/jpeg', fileName: 'r.jpg', createdAt: now },
    ];

    await restoreFromPayload(
      payload,
      attachmentBlobs,
      new Set(inspectBackupPayload(payload).parts),
    );

    const restored = await db.attachments.toArray();
    expect(restored).toHaveLength(1);
    expect(restored[0]!.entryId).toBe(entryId);
    expect(restored[0]!.fileName).toBe('r.jpg');
    expect(restored[0]!.mimeType).toBe('image/jpeg');
  });

  test('復元した添付の blob.type はメタデータの mimeType と一致し、バイト列も保たれる', async () => {
    const entryId = newId();
    const now = Date.now();
    await db.journalEntries.add({
      id: entryId,
      date: '2026-05-01',
      year: 2026,
      description: 'テスト',
      status: 'confirmed',
      source: 'manual',
      createdAt: now,
      confirmedAt: now,
    });

    const payload = await buildPayload();
    // 元の Blob 自体は mimeType を持たない状態で渡し、restoreFromPayload が
    // メタデータの mimeType で張り替えることを検証する。
    const attachmentBlobs = new Map([['att-1', nodeBlob(new Uint8Array([1, 2, 3]))]]);
    payload.tables['attachments'] = [
      { id: 'att-1', entryId, mimeType: 'image/png', fileName: 'r.png', createdAt: now },
    ];

    await restoreFromPayload(
      payload,
      attachmentBlobs,
      new Set(inspectBackupPayload(payload).parts),
    );

    const restored = await db.attachments.toArray();
    expect(restored).toHaveLength(1);
    expect(restored[0]!.blob.type).toBe('image/png');
    expect(new Uint8Array(await restored[0]!.blob.arrayBuffer())).toEqual(
      new Uint8Array([1, 2, 3]),
    );
  });

  test('実体の無い添付は missingBlobCount に計上される', async () => {
    const now = Date.now();
    const payload = {
      version: PAYLOAD_VERSION,
      exportedAt: '2026-05-10',
      tables: {
        attachments: [
          { id: 'has', entryId: 'e', mimeType: 'image/jpeg', fileName: 'a.jpg', createdAt: now },
          {
            id: 'missing',
            entryId: 'e',
            mimeType: 'image/jpeg',
            fileName: 'b.jpg',
            createdAt: now,
          },
        ],
      },
    };
    const blobs = new Map([['has', nodeBlob(new Uint8Array([1, 2, 3]))]]);
    // 実体が無い行の Blob 組み立て（new Blob(...)）自体は Dexie の書き込み前なので、
    // happy-dom の structuredClone 制限を経由せずに直接検証できるよう global Blob を差し替える。
    vi.stubGlobal('Blob', NodeBlob);
    try {
      const result = await restoreFromPayload(
        payload,
        blobs,
        new Set(inspectBackupPayload(payload).parts),
      );
      expect(result.missingBlobCount).toBe(1);
      const restored = await db.attachments.toArray();
      const missing = restored.find((r) => r.id === 'missing');
      expect(missing!.blob.size).toBe(0);
      expect(missing!.blob.type).toBe('image/jpeg');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  test('旧 JSON 形式（attachmentBlobs 空）でも欠損を計上する', async () => {
    const now = Date.now();
    const result = await restoreFromJson({
      version: PAYLOAD_VERSION,
      exportedAt: '2026-05-10',
      tables: {
        attachments: [
          { id: 'a', entryId: 'e', mimeType: 'image/jpeg', fileName: 'a.jpg', createdAt: now },
        ],
      },
    });
    expect(result.missingBlobCount).toBe(1);
  });

  test('parseBackupFile は zip / 旧 JSON を自動判定する', async () => {
    const payload = {
      version: PAYLOAD_VERSION,
      exportedAt: '2026-05-10',
      tables: { vendors: [{ id: 'v1', name: '業者' }] },
    };
    async function* attachments(): AsyncGenerator<readonly [string, Uint8Array]> {
      yield ['a1', new Uint8Array([9, 9])];
    }
    const stream = buildBackupZipStream(payload, attachments());
    const zipBytes = new Uint8Array(await new Response(stream).arrayBuffer());
    const zipFile = new File([zipBytes.slice()], 'backup.zip', { type: 'application/zip' });
    const zipParsed = await parseBackupFile(zipFile);
    expect(zipParsed.payload.tables['vendors']).toHaveLength(1);
    expect(new Uint8Array(await zipParsed.attachmentBlobs.get('a1')!.arrayBuffer())).toEqual(
      new Uint8Array([9, 9]),
    );

    const jsonFile = new File([JSON.stringify(payload)], 'backup.json', {
      type: 'application/json',
    });
    const jsonParsed = await parseBackupFile(jsonFile);
    expect(jsonParsed.payload.tables['vendors']).toHaveLength(1);
    expect(jsonParsed.attachmentBlobs.size).toBe(0);
  });

  test('旧 JSON 形式で上限超過なら BackupTooLargeError（内容は読まずに弾く）', async () => {
    const jsonFile = new File(['{"version":1,"tables":{}}'], 'backup.json', {
      type: 'application/json',
    });
    // 実際に 100MB のファイルは作らず、size だけ上限超過を装う。
    Object.defineProperty(jsonFile, 'size', { value: MAX_BACKUP_BYTES + 1 });
    await expect(parseBackupFile(jsonFile)).rejects.toThrow(BackupTooLargeError);
  });
});

describe('固定資産の復元', () => {
  const minimalAsset: FixedAsset = {
    id: 'fa-min',
    name: '什器',
    acquisitionDate: '2025-01-01',
    acquisitionCost: '300000',
    usefulLifeYears: 5,
    depreciationMethod: 'straight-line',
    accountCode: '1510',
  };
  const fullAsset: FixedAsset = {
    ...minimalAsset,
    id: 'fa-full',
    disposedDate: '2026-03-31',
    disposalType: 'sale',
    salePrice: '100000',
    saleExpenses: '5000',
    incomeType: 'realEstate',
    conversionBasis: '250000',
    serviceStartDate: '2025-02-01',
    assetCategory: 2,
    isMineShaft: false,
    leaseContractDate: '2025-01-01',
    residualGuaranteeAmount: '10000',
    lumpSumPoolId: 'pool-1',
    usableLifeUnderOneYear: false,
    employeeCountAtAcquisition: 3,
    isLeasedOut: false,
    openingYear: 2025,
    essentialToBusiness: true,
    leaseTermMonths: 60,
    decliningBalanceElected: false,
    realEstateDetail: {
      propertyType: '貸家',
      isResidential: true,
      address: '東京都',
      tenantName: '山田',
      tenantAddress: '東京都',
      rentalPeriodStart: '2025-01-01',
      rentalPeriodEnd: '2025-12-31',
      areaSqm: '45',
      annualRent: '1200000',
      keyMoneyEtc: '100000',
      otherIncome: '0',
      depositBalance: '200000',
    },
  };

  test('最初のバージョンの欄だけの資産と全欄の資産は書き出し→復元で同じ内容に戻る', async () => {
    await db.fixedAssets.bulkAdd([minimalAsset, fullAsset]);
    const payload = await buildPayload();
    await restoreFromPayload(payload, new Map(), new Set(inspectBackupPayload(payload).parts));
    const restored = await db.fixedAssets.orderBy('id').toArray();
    expect(restored).toEqual([fullAsset, minimalAsset]);
  });

  test('salePrice が数値の資産を含むバックアップは既存データを消さずに弾く', async () => {
    const entryId = newId();
    await db.fixedAssets.add(minimalAsset);
    await db.journalEntries.add({
      id: entryId,
      date: '2026-05-01',
      year: 2026,
      description: '電気代',
      status: 'confirmed',
      source: 'manual',
      createdAt: 1,
      confirmedAt: 1,
    });
    const payload = await buildPayload();
    payload.tables['fixedAssets'] = [{ ...fullAsset, salePrice: 1000 }];
    await expect(restoreFromPayload(payload, new Map(), new Set(['books']))).rejects.toThrow(
      BackupValidationError,
    );
    expect(await db.fixedAssets.toArray()).toEqual([minimalAsset]);
    expect(await db.journalEntries.count()).toBe(1);
  });
});

describe('isBackupTooLarge', () => {
  test('zip は上限を超えても許容する', () => {
    expect(isBackupTooLarge(true, MAX_BACKUP_BYTES + 1)).toBe(false);
  });

  test('旧 JSON は上限超過で弾く', () => {
    expect(isBackupTooLarge(false, MAX_BACKUP_BYTES + 1)).toBe(true);
  });

  test('境界値（ちょうど上限）は許容する', () => {
    expect(isBackupTooLarge(false, MAX_BACKUP_BYTES)).toBe(false);
    expect(isBackupTooLarge(true, MAX_BACKUP_BYTES)).toBe(false);
  });

  test('上限未満はどちらも許容する', () => {
    expect(isBackupTooLarge(false, 100)).toBe(false);
    expect(isBackupTooLarge(true, 100)).toBe(false);
  });
});

describe('区分ごとの復元', () => {
  const entry: JournalEntry = {
    id: 'e1',
    date: '2026-05-01',
    year: 2026,
    description: '家賃',
    status: 'confirmed',
    originalEntryId: 'e0',
    reversedByEntryId: 'e2',
    source: 'csv',
    sourceImportId: 'ib1',
    createdAt: 1,
    confirmedAt: 2,
    department: '本店',
  };
  const line: JournalLine = {
    id: 'l1',
    entryId: 'e1',
    side: 'debit',
    accountCode: '5130',
    subAccountId: 'sa1',
    vendorId: 'v1',
    amount: '5000',
    amountIndexed: toIndexable('5000'),
    taxRate: 0.1,
    taxIncluded: true,
    invoiceCompliant: true,
    homeOfficeRatio: '0.5',
    memo: 'メモ',
    taxCategory: 'taxable10',
    inputUsageCategory: 'common',
    itemId: 'it1',
    quantity: '2',
    taxableTransferConsideration: '1000',
  };
  const account: Account = {
    code: '5130',
    year: 2026,
    name: '水道光熱費',
    category: 'expense',
    taxCategory: 'taxable10',
    parentCode: '5100',
    displayOrder: 10,
    isActive: true,
    incomeType: 'business',
  };
  const subAccount: SubAccount = {
    id: 'sa1',
    accountCode: '5130',
    name: '電気',
    metadata: { k: 'v' },
  };
  const vendor: Vendor = {
    id: 'v1',
    name: '業者',
    entityType: 'corporation',
    invoiceNumber: 'T1234567890123',
    invoiceVerifiedAt: 1,
    invoiceValid: true,
    defaultAccountCode: '5130',
    defaultTaxRate: 0.1,
    aliases: ['別名'],
    address: '東京都',
  };
  const item: InventoryItem = { id: 'it1', name: '商品' };
  const asset: FixedAsset = {
    id: 'fa1',
    name: '貸家',
    acquisitionDate: '2025-01-01',
    acquisitionCost: '3000000',
    usefulLifeYears: 22,
    depreciationMethod: 'straight-line',
    accountCode: '1510',
    disposedDate: '2026-03-31',
    disposalType: 'sale',
    salePrice: '100000',
    saleExpenses: '5000',
    incomeType: 'realEstate',
    source: 'opening',
    realEstateDetail: {
      propertyType: '貸家',
      isResidential: true,
      address: '東京都',
      tenantName: '山田',
      tenantAddress: '東京都',
      rentalPeriodStart: '2025-01-01',
      rentalPeriodEnd: '2025-12-31',
      areaSqm: '45',
      annualRent: '1200000',
      keyMoneyEtc: '100000',
      otherIncome: '0',
      depositBalance: '200000',
    },
    conversionBasis: '2500000',
    serviceStartDate: '2025-02-01',
    assetCategory: 1,
    isMineShaft: false,
    leaseContractDate: '2025-01-01',
    residualGuaranteeAmount: '10000',
    lumpSumPoolId: 'pool-1',
    usableLifeUnderOneYear: false,
    employeeCountAtAcquisition: 3,
    isLeasedOut: false,
    openingYear: 2025,
    essentialToBusiness: true,
    leaseTermMonths: 60,
    decliningBalanceElected: false,
  };
  const snapshot: ReportSnapshot = {
    id: 'rs1',
    year: 2026,
    type: 'pl',
    status: 'filed',
    filedAt: 3,
    payload: {
      type: 'pl',
      data: {
        rows: [{ accountCode: '4110', amount: '100' }],
        totalRevenue: '100',
        totalExpense: '0',
        netIncome: '100',
      },
    },
    generatedAt: 2,
    generatedFromEntriesUpTo: '2026-12-31',
  };
  const deduction: PersonalDeductionInput = {
    year: 2026,
    socialInsurancePaid: '1',
    smallBusinessMutualAidPaid: '2',
    lifeInsurance: {
      newGeneral: '1',
      oldGeneral: '2',
      newMedical: '3',
      newPension: '4',
      oldPension: '5',
    },
    earthquakeInsurancePaid: '3',
    oldLongTermInsurancePaid: '4',
    medicalExpensePaid: '5',
    medicalInsuranceReimbursement: '6',
    donationAmount: '7',
    casualtyLossDeduction: '8',
    isDisabled: false,
    isSpecialDisabled: false,
    isSingleParent: true,
    isWidow: false,
    isWorkingStudent: false,
    spouse: { totalIncome: '0', age: 40, disability: 'none' },
    dependents: [
      {
        id: 'd1',
        name: '子',
        age: 10,
        totalIncome: '0',
        livesWithLinealAscendant: false,
        disability: 'special',
      },
    ],
    dividendDeductionAmount: '0',
    mortgageDeductionAmount: '0',
    politicalDonationCreditAmount: '0',
    housingRenovationCreditAmount: '0',
    foreignTaxCreditAmount: '0',
    otherTaxCreditAmount: '0',
    disasterExemptionAmount: '0',
    salaryIncome: { paidAmount: '1', withholdingTax: '0', lastPaymentBeforeDecember: true },
    miscIncome: {
      publicPensionAmount: '0',
      publicPensionInputMode: 'revenue',
      publicPensionRevenue: '0',
      publicPensionAge65OrOver: true,
      otherIncome: '0',
      otherExpenses: '0',
    },
    otherWithholdingTax: '0',
    realEstateIncome: {
      businessScale: true,
      landLoanInterestAmount: '0',
      rentPaid: [
        {
          payeeAddress: 'a',
          payeeName: 'b',
          amount: '1',
          deductibleAmount: '1',
          property: 'c',
          keyMoney: '0',
          renewalFee: '0',
        },
      ],
      loanInterestPaid: [{ amount: '1', deductibleAmount: '1', yearEndBalance: '100' }],
      professionalFeesPaid: [{ amount: '1', deductibleAmount: '1', withholdingTax: '0' }],
    },
    familyEmployees: [
      {
        id: 'f1',
        name: '妻',
        relation: 'spouse',
        age: 40,
        monthsWorked: 12,
        incomeType: 'business',
      },
    ],
    priorPriorBusinessRevenue: '0',
    priorPriorRealEstateRevenue: '0',
    homeWorker: false,
    updatedAt: 4,
  };
  const budget: Budget = { year: 2026, month: 1, revenueBudget: '100000', expenseBudget: '50000' };
  const arAp: ArApEntry = {
    id: 'ar1',
    type: 'receivable',
    description: '売掛',
    dueDate: '2026-06-30',
    originalAmount: '10000',
    paidAmount: '0',
    createdAt: 1,
  };
  const invoice: Invoice = {
    ...validInvoice,
    status: 'issued',
    number: 'INV-0001',
    dueDate: '2026-05-31',
    lineItems: [{ id: 'li1', name: '作業', quantity: '1', unitPrice: '1000', taxRate: 0.08 }],
    memo: 'メモ',
    journalEntryId: 'e1',
    arApEntryId: 'ar1',
    convertedToInvoiceId: 'inv-2',
    issuedAt: 2,
    voidedAt: 3,
  };
  const rule: ParserRule = {
    id: 'pr1',
    matchType: 'regex',
    pattern: '電気',
    vendorId: 'v1',
    accountCode: '5130',
    priority: 1,
    hitCount: 2,
    lastHitAt: 3,
  };
  const batch: ImportBatch = {
    id: 'ib1',
    parserName: 'generic',
    fileName: 'a.csv',
    fileHash: 'h',
    importedAt: 1,
    rowCount: 1,
  };
  const SHA = 'd'.repeat(64);
  // ③④⑤⑥ のすべてのキー。ocrEngine は SettingsMap に無い旧キー。
  const restorableSettings: { [K in keyof SettingsMap]?: SettingsMap[K] } = {
    currentYear: 2026,
    userBusinessName: '青井商店',
    userInvoiceNumber: 'T1234567890123',
    invoiceNumberPrefix: 'INV-',
    quoteNumberPrefix: 'Q-',
    filingType: 'blue',
    aoiroDeductionKind: 'eTax',
    cashBasisElection: false,
    realEstateIncomeEnabled: true,
    businessStartDate: '2020-04-01',
    businessCloseDate: '',
    homeOfficeAccountRatios: { '5130': '0.30' },
    inventoryAutoValuationEnabled: true,
    taxRegistration: 'taxable',
    taxFilingMethod: 'two-wari',
    simplifiedTaxCategory: 5,
    consumptionTaxAttributionMethod: 'individual',
    invoiceRegistrationStartDate: '2023-10-01',
    taxableElectionPeriod: { fromYear: 2024, toYear: 2026 },
    inheritanceSpecialDate: '',
    adjustedFixedAssetDate: '',
    shortenedTaxPeriod: { from: '2026-01-01', to: '2026-03-31' },
    foreignWithoutDomesticPe: false,
    basePeriodTaxableSales: '1000',
    specifiedPeriodTaxableSales: '500',
    simplifiedElectionFiledDate: '2025-12-01',
    interimVoluntaryFiled: false,
    interimVoluntaryLapsed: false,
    interimPriorPeriodMonths: { 2026: 6 },
    wariBaseAdjustments: {
      2026: {
        salesReturnTax78: '1',
        salesReturnTax624: '2',
        specifiedSmallAssetTransfers: [{ date: '2026-01-01', rate: 0.1, netTax: '3' }],
      },
    },
    aiEngine: 'openai-compatible',
    geminiModel: 'gemini-x',
    openaiBaseUrl: 'http://localhost:11434/v1',
    openaiOcrModel: 'vision',
    openaiClassifyModel: 'text',
    receiptMethod: 'rule',
    receiptRuleEngine: 'tesseract',
    geminiApiKey: 'gkey',
    openaiApiKey: 'okey',
    userRiyoshaId: '1234567890123456',
    userFilerName: '青井 太郎',
    userFilerZip: '1000001',
    userFilerAddress: '東京都',
    userZeimushoCode: '01101',
    userZeimushoName: '麹町',
  };

  async function seedEveryTable(): Promise<void> {
    await db.journalEntries.add(entry);
    await db.journalLines.add(line);
    await db.accounts.add(account);
    await db.subAccounts.add(subAccount);
    await db.vendors.add(vendor);
    await db.inventoryItems.add(item);
    await db.fixedAssets.add(asset);
    await db.reportSnapshots.add(snapshot);
    await db.personalDeductions.add(deduction);
    await db.budgets.add(budget);
    await db.arApEntries.add(arAp);
    await db.invoices.add(invoice);
    await db.parserRules.add(rule);
    await db.importBatches.add(batch);
    await db.attachments.add({
      id: 'at1',
      entryId: 'e1',
      blob: nodeBlob(new Uint8Array([1, 2, 3])),
      mimeType: 'image/png',
      fileName: 'a.png',
      createdAt: 1,
      sha256: SHA,
    });
    const now = 5;
    await db.settings.bulkPut([
      ...Object.entries(restorableSettings).map(([key, value]) => ({ key, value, updatedAt: now })),
      { key: 'ocrEngine', value: 'gemini', updatedAt: now },
    ]);
  }

  async function bookSnapshot(): Promise<Record<string, unknown[]>> {
    const out: Record<string, unknown[]> = {};
    for (const name of BOOK_TABLES) {
      out[name] = await db.table(name).toArray();
    }
    out.attachments = (await db.attachments.toArray()).map(({ blob: _blob, ...meta }) => meta);
    out.settings = (await db.settings.toArray()).sort((a, b) => a.key.localeCompare(b.key));
    return out;
  }

  test('往復：全表の任意欄と ③④⑤⑥ の全設定が JSON を経ても同じに戻る', async () => {
    await seedEveryTable();
    const before = await bookSnapshot();
    expect(before.settings).toHaveLength(RESTORABLE_SETTING_KEYS.size);
    const payload = await buildPayload({ parts: new Set(BACKUP_PART_IDS) });
    const parsed = parseBackupJson(JSON.stringify(payload));
    await restoreFromPayload(parsed, new Map(), new Set(inspectBackupPayload(parsed).parts));
    expect(await bookSnapshot()).toEqual(before);
  });

  test('v1.0.2 の形のバックアップを復元すると今の型で保存される', async () => {
    await restoreFromJson({
      version: PAYLOAD_VERSION,
      exportedAt: '2026-05-10',
      tables: {
        journalEntries: [entry],
        journalLines: [{ ...line, quantity: 3 }],
        budgets: [{ year: 2026, month: 1, revenueBudget: 100000, expenseBudget: 0 }],
        arApEntries: [{ ...arAp, originalAmount: 10000, paidAmount: 2500 }],
        parserRules: [{ ...rule, priority: null }],
        personalDeductions: [
          {
            ...deduction,
            spouse: { totalIncome: '0', age: null },
            dependents: [{ id: 'd1', name: '子', age: null, totalIncome: '0' }],
          },
        ],
        settings: [
          { key: 'currentYear', value: null, updatedAt: 1 },
          { key: 'ocrEngine', value: 'tesseract', updatedAt: 1 },
          { key: 'tesseractLangPath', value: '/lang', updatedAt: 1 },
        ],
      },
    });
    expect((await db.journalLines.get('l1'))?.quantity).toBe('3');
    expect(await db.budgets.get([2026, 1])).toMatchObject({
      revenueBudget: '100000',
      expenseBudget: '0',
    });
    expect(await db.arApEntries.get('ar1')).toMatchObject({
      originalAmount: '10000',
      paidAmount: '2500',
    });
    expect((await db.parserRules.get('pr1'))?.priority).toBeNull();
    expect(await db.settings.get('currentYear')).toBeUndefined();
    expect((await db.settings.get('ocrEngine'))?.value).toBe('tesseract');
    expect(await db.settings.get('tesseractLangPath')).toBeUndefined();
  });

  test('バックアップに入れられた端末専用の記録は書き込まず、この端末の値を残す', async () => {
    await db.stamps.put({
      id: 's-local',
      shape: 'yarn',
      color: 'orange',
      at: '2026-08-18',
      createdAt: 1,
    });
    await db.settings.bulkPut([
      { key: 'supporterBadgeAt', value: '2026-08-18', updatedAt: 1 },
      { key: 'disclaimerAcceptedAt', value: 111, updatedAt: 1 },
      { key: 'skipExternalSendConfirm', value: false, updatedAt: 1 },
    ]);
    const forged = (key: string, value: unknown) => ({ key, value, updatedAt: 9 });
    await restoreFromJson({
      version: PAYLOAD_VERSION,
      exportedAt: '2026-05-10',
      tables: {
        stamps: [{ id: 's-forged', shape: 'bell', color: 'blue', at: '2026-01-01', createdAt: 2 }],
        settings: [
          forged('supporterBadgeAt', '2020-01-01'),
          forged('nativeBackupFolder', { token: 'x', name: 'y' }),
          forged('backupFolderHandle', { kind: 'directory' }),
          forged('disclaimerAcceptedAt', 999),
          forged('disclaimerAcceptedVersion', 999),
          forged('skipExternalSendConfirm', true),
          forged('skipAttachmentConfirm', true),
          forged('skipFiledYearWarning', true),
          forged('skipDownloadSavedConfirm', true),
          forged('lastBackupAt', 999),
          forged('backupParts', ['books', 'apiKeys']),
          forged('backupIncludeApiKeys', true),
          forged('backupIncludeFilerInfo', true),
          forged('userBusinessName', '復元される'),
        ],
      },
    });
    await migrateBackupPartsSetting();
    expect((await db.stamps.toArray()).map((s) => s.id)).toEqual(['s-local']);
    expect((await db.settings.get('supporterBadgeAt'))?.value).toBe('2026-08-18');
    expect((await db.settings.get('disclaimerAcceptedAt'))?.value).toBe(111);
    expect((await db.settings.get('skipExternalSendConfirm'))?.value).toBe(false);
    for (const key of [
      'nativeBackupFolder',
      'backupFolderHandle',
      'disclaimerAcceptedVersion',
      'skipAttachmentConfirm',
      'skipFiledYearWarning',
      'skipDownloadSavedConfirm',
      'lastBackupAt',
      'backupParts',
      'backupIncludeApiKeys',
      'backupIncludeFilerInfo',
    ]) {
      expect(await db.settings.get(key), key).toBeUndefined();
    }
    expect((await db.settings.get('userBusinessName'))?.value).toBe('復元される');
  });

  test('この端末の backupParts は、バックアップの backupParts や旧切替で変わらない', async () => {
    await db.settings.put({ key: 'backupParts', value: ['books', 'business'], updatedAt: 1 });
    const forged = (key: string, value: unknown) => ({ key, value, updatedAt: 9 });
    await restoreFromJson({
      version: PAYLOAD_VERSION,
      exportedAt: '2026-05-10',
      tables: {
        settings: [
          forged('backupParts', ['books', 'apiKeys', 'filer']),
          forged('backupIncludeApiKeys', true),
          forged('backupIncludeFilerInfo', true),
        ],
      },
    });
    await migrateBackupPartsSetting();
    expect((await db.settings.get('backupParts'))?.value).toEqual(['books', 'business']);
  });

  test('往復：帳簿データと業務の設定だけを書き出して既定の選択で戻すと、④ ⑤ ⑥ はこの端末の値のまま', async () => {
    await seedEveryTable();
    const before = await bookSnapshot();
    const payload = await buildPayload({ parts: new Set(['books', 'business']) });
    expect(payload.version).toBe(2);
    const local = {
      aiEngine: 'gemini',
      openaiBaseUrl: 'http://example.invalid/v1',
      geminiApiKey: 'changed-key',
      userFilerName: '変更後の氏名',
    };
    await db.settings.bulkPut(
      Object.entries({ ...local, userBusinessName: '変更後の屋号' }).map(([key, value]) => ({
        key,
        value,
        updatedAt: 7,
      })),
    );
    await db.vendors.add({ id: 'v-after', name: '書き出し後の取引先' });
    const parsed = parseBackupJson(JSON.stringify(payload));
    const selected = inspectBackupPayload(parsed).parts.filter((p) => IMPORT_DEFAULT_PARTS.has(p));
    expect(selected).toEqual(['books', 'business']);
    await restoreFromPayload(parsed, new Map(), new Set(selected));
    const after = await bookSnapshot();
    const business = new Set<string>(BUSINESS_SETTING_KEYS);
    const pick = (rows: unknown[], keys: ReadonlySet<string>) =>
      rows.filter((r) => keys.has((r as { key: string }).key));
    for (const name of [...BOOK_TABLES, 'attachments']) {
      expect(after[name], name).toEqual(before[name]);
    }
    expect(pick(after.settings!, business)).toEqual(pick(before.settings!, business));
    for (const [key, value] of Object.entries(local)) {
      expect((await db.settings.get(key))?.value, key).toBe(value);
    }
  });

  test('tables のプロトタイプに入れた表は弾き、既存データを残す（$state.snapshot 後の形）', async () => {
    await db.vendors.add({ id: 'keep-1', name: '残る業者' });
    const tables = Object.setPrototypeOf({}, { reportSnapshots: [snapshot] }) as Record<
      string,
      unknown[]
    >;
    await expect(
      restoreFromPayload(
        { version: PAYLOAD_VERSION, exportedAt: 'x', tables },
        new Map(),
        new Set(['books']),
      ),
    ).rejects.toThrow(BackupValidationError);
    expect(await db.vendors.toArray()).toEqual([{ id: 'keep-1', name: '残る業者' }]);
    expect(await db.reportSnapshots.count()).toBe(0);
  });

  test('許可していない mimeType の証憑は型無しで保存し、画像の型はそのまま', async () => {
    const meta = { entryId: 'e1', fileName: 'a', createdAt: 1 };
    const payload = {
      version: PAYLOAD_VERSION,
      exportedAt: 'x',
      tables: {
        attachments: [
          { ...meta, id: 'html', mimeType: 'text/html' },
          { ...meta, id: 'png', mimeType: 'image/png' },
        ],
      },
    };
    await restoreFromPayload(
      payload,
      new Map([
        ['html', nodeBlob(new Uint8Array([60, 98, 62]))],
        ['png', nodeBlob(new Uint8Array([1]))],
      ]),
      new Set(inspectBackupPayload(payload).parts),
    );
    const html = await db.attachments.get('html');
    expect(html?.mimeType).toBe('application/octet-stream');
    expect(html?.blob.type).toBe('application/octet-stream');
    const png = await db.attachments.get('png');
    expect(png?.mimeType).toBe('image/png');
    expect(png?.blob.type).toBe('image/png');
  });

  test('実体の無い証憑も mimeType を型無しへ書き換える', async () => {
    await restoreFromJson({
      version: PAYLOAD_VERSION,
      exportedAt: 'x',
      tables: {
        attachments: [
          { id: 'a', entryId: 'e', mimeType: 'text/html', fileName: 'a', createdAt: 1 },
        ],
      },
    });
    expect((await db.attachments.get('a'))?.mimeType).toBe('application/octet-stream');
  });

  describe('証憑の sha256', () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const meta = { entryId: 'e1', mimeType: 'image/png', fileName: 'a', createdAt: 1, sha256: SHA };
    const payload = () => ({
      version: PAYLOAD_VERSION,
      exportedAt: 'x',
      tables: {
        attachments: [
          { ...meta, id: 'has' },
          { ...meta, id: 'missing' },
        ],
      },
    });

    async function restoreWithOneBlob(): Promise<void> {
      const p = payload();
      await restoreFromPayload(
        p,
        new Map([['has', nodeBlob(bytes)]]),
        new Set(inspectBackupPayload(p).parts),
      );
    }

    test('実体があれば中身から計算し直す', async () => {
      const actual = await sha256Hex(bytes);
      await restoreWithOneBlob();
      expect(actual).not.toBe(SHA);
      expect((await db.attachments.get('has'))?.sha256).toBe(actual);
    });

    test('実体が無ければバックアップの値を残す', async () => {
      await restoreWithOneBlob();
      expect((await db.attachments.get('missing'))?.sha256).toBe(SHA);
    });
  });

  test('設定キー constructor と表名 toString は書き込まずに復元を終える', async () => {
    await restoreFromJson({
      version: PAYLOAD_VERSION,
      exportedAt: 'x',
      tables: {
        settings: [
          { key: 'constructor', value: 1, updatedAt: 1 },
          { key: 'userBusinessName', value: '屋号', updatedAt: 1 },
        ],
        toString: [{ id: 1 }],
        vendors: [{ id: 'v1', name: '業者' }],
      },
    });
    expect(await db.settings.get('constructor')).toBeUndefined();
    expect((await db.settings.get('userBusinessName'))?.value).toBe('屋号');
    expect(db.tables.map((t) => t.name)).not.toContain('toString');
    expect(await db.vendors.count()).toBe(1);
  });
});

describe('区分を選んだ復元', () => {
  const PNG = new Uint8Array([1, 2, 3]);
  const SHA_LOCAL = 'b'.repeat(64);

  function entryOf(id: string): JournalEntry {
    return {
      id,
      date: '2026-05-01',
      year: 2026,
      description: id,
      status: 'confirmed',
      source: 'manual',
      createdAt: 1,
      confirmedAt: 1,
    };
  }

  function setting(key: string, value: unknown) {
    return { key, value, updatedAt: 1 };
  }
  // parts で帳簿データを名乗るときは 14 表すべてが要る。
  function bookTables(overrides: Record<string, unknown[]> = {}): Record<string, unknown[]> {
    return { ...Object.fromEntries(BOOK_TABLES.map((name) => [name, []])), ...overrides };
  }

  function partial(parts: BackupPartId[], tables: Record<string, unknown[]>): BackupPayload {
    return { version: 2, exportedAt: '2026-11-01T00:00:00.000Z', parts, tables };
  }

  async function seedLocal(): Promise<void> {
    await db.journalEntries.bulkAdd([entryOf('keep'), entryOf('drop')]);
    await db.attachments.bulkAdd([
      {
        id: 'a-keep',
        entryId: 'keep',
        blob: nodeBlob(PNG),
        mimeType: 'image/png',
        fileName: 'keep.png',
        createdAt: 1,
        sha256: SHA_LOCAL,
      },
      {
        id: 'a-drop',
        entryId: 'drop',
        blob: nodeBlob(new Uint8Array([9])),
        mimeType: 'image/png',
        fileName: 'drop.png',
        createdAt: 1,
      },
    ]);
    await db.settings.bulkPut([
      setting('userBusinessName', '端末の屋号'),
      setting('invoiceNumberPrefix', 'LOCAL-'),
      setting('aiEngine', 'gemini'),
      setting('openaiBaseUrl', 'http://localhost:11434/v1'),
      setting('geminiApiKey', 'local-key'),
      setting('userRiyoshaId', '1111222233334444'),
      setting('lastBackupAt', 5),
      setting('disclaimerAcceptedAt', 7),
      setting('backupParts', ['books', 'filer']),
    ]);
  }

  async function settingsMap(): Promise<Record<string, unknown>> {
    return Object.fromEntries((await db.settings.toArray()).map((r) => [r.key, r.value]));
  }

  async function entryIds(): Promise<string[]> {
    return (await db.journalEntries.toArray()).map((e) => e.id).sort();
  }

  async function attachmentIds(): Promise<string[]> {
    return (await db.attachments.toArray()).map((a) => a.id).sort();
  }

  describe('inspectBackupPayload の区分の判定', () => {
    const v1 = (tables: Record<string, unknown[]>): BackupPayload => ({
      version: 1,
      exportedAt: 'x',
      tables,
    });

    test('parts の無い v1 は帳簿データ・業務・AI とみなす', () => {
      expect(inspectBackupPayload(v1({})).parts).toEqual(['books', 'business', 'ai']);
    });

    test('parts の無い v1 は attachments 表があれば証憑写真も含む', () => {
      expect(inspectBackupPayload(v1({ attachments: [] })).parts).toEqual([
        'books',
        'attachments',
        'business',
        'ai',
      ]);
    });

    test('parts の無い v1 は ⑤ のキーがあれば API キーを含む', () => {
      const parts = inspectBackupPayload(v1({ settings: [setting('openaiApiKey', 'k')] })).parts;
      expect(parts).toEqual(['books', 'business', 'ai', 'apiKeys']);
    });

    test('parts の無い v1 は ⑥ のキーがあれば申告者情報を含む', () => {
      const parts = inspectBackupPayload(
        v1({ settings: [setting('userZeimushoCode', '01101')] }),
      ).parts;
      expect(parts).toEqual(['books', 'business', 'ai', 'filer']);
    });

    test('parts は標準の順序で返す', () => {
      const parts = inspectBackupPayload(partial(['business', 'books'], bookTables())).parts;
      expect(parts).toEqual(['books', 'business']);
    });

    test.each<[string, BackupPayload]>([
      ['parts の無い v2', { version: 2, exportedAt: 'x', tables: {} }],
      ['parts が配列でない', { ...partial([], {}), parts: 'books' }],
      ['未知の ID', { ...partial([], {}), parts: ['business', 'x'] }],
      ['ID が constructor', { ...partial([], {}), parts: ['constructor'] }],
      ['ID が文字列でない', { ...partial([], {}), parts: [1] }],
      ['ID の重複', partial(['business', 'business'], {})],
      ['証憑写真だけで帳簿データなし', partial(['attachments'], { attachments: [] })],
      [
        'v1 なのに AI と外部送信の設定が無い',
        {
          ...partial(['books', 'attachments', 'business'], bookTables({ attachments: [] })),
          version: 1,
        },
      ],
      ['帳簿データを名乗るのに accounts 表が無い', partial(['books'], { journalEntries: [] })],
      [
        '証憑写真を名乗るのに attachments 表が無い',
        partial(['books', 'attachments'], bookTables()),
      ],
    ])('%s は弾く', (_label, payload) => {
      let caught: unknown;
      try {
        inspectBackupPayload(payload);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(BackupValidationError);
      expect((caught as Error).message).toBe(m.error_backup_parts_invalid());
    });

    test('version 3 は IncompatibleBackupError', () => {
      expect(() => inspectBackupPayload({ version: 3, exportedAt: 'x', tables: {} })).toThrow(
        IncompatibleBackupError,
      );
    });
  });

  test('業務と申告の設定だけを選ぶと、それ以外はこの端末のまま', async () => {
    await seedLocal();
    const before = await settingsMap();
    const payload = partial(['business'], {
      settings: [setting('userBusinessName', 'バックアップの屋号'), setting('currentYear', 2027)],
    });
    await restoreFromPayload(payload, new Map(), new Set(['business']));
    expect(await entryIds()).toEqual(['drop', 'keep']);
    expect(await attachmentIds()).toEqual(['a-drop', 'a-keep']);
    const after = await settingsMap();
    expect(after.userBusinessName).toBe('バックアップの屋号');
    expect(after.currentYear).toBe(2027);
    expect('invoiceNumberPrefix' in after).toBe(false);
    for (const key of [
      'aiEngine',
      'openaiBaseUrl',
      'geminiApiKey',
      'userRiyoshaId',
      'lastBackupAt',
      'disclaimerAcceptedAt',
      'backupParts',
    ]) {
      expect(after[key], key).toEqual(before[key]);
    }
  });

  test.each<[string, unknown[]]>([
    ['範囲外の年度', [setting('currentYear', 2019)]],
    ['null の年度', [setting('currentYear', null)]],
    ['年度の行が無い', []],
  ])('業務の設定を選んでも、バックアップが%sならこの端末の処理年度を残す', async (_, rows) => {
    await seedLocal();
    await db.settings.put(setting('currentYear', 2026));
    const payload = partial(['business'], {
      settings: [setting('userBusinessName', 'バックアップの屋号'), ...rows],
    });
    await restoreFromPayload(payload, new Map(), new Set(['business']));
    const after = await settingsMap();
    expect(after.currentYear).toBe(2026);
    expect(after.userBusinessName).toBe('バックアップの屋号');
    expect('invoiceNumberPrefix' in after).toBe(false);
  });

  test('バックアップに使える処理年度があれば、それで置き換える', async () => {
    await seedLocal();
    await db.settings.put(setting('currentYear', 2026));
    const payload = partial(['business'], {
      settings: [setting('userBusinessName', 'バックアップの屋号'), setting('currentYear', 2027)],
    });
    await restoreFromPayload(payload, new Map(), new Set(['business']));
    expect((await settingsMap()).currentYear).toBe(2027);
  });

  describe('帳簿データを選び、証憑写真を選ばない', () => {
    test('復元後の帳簿に仕訳がある証憑だけ、そのまま残す', async () => {
      await seedLocal();
      const payload = partial(
        ['books'],
        bookTables({
          journalEntries: [entryOf('keep'), entryOf('new')],
          attachments: [
            {
              id: 'from-backup',
              entryId: 'new',
              mimeType: 'image/png',
              fileName: 'b',
              createdAt: 1,
            },
          ],
        }),
      );
      await restoreFromPayload(payload, new Map(), new Set(['books']));
      expect(await entryIds()).toEqual(['keep', 'new']);
      expect(await attachmentIds()).toEqual(['a-keep']);
      const kept = await db.attachments.get('a-keep');
      expect(kept?.sha256).toBe(SHA_LOCAL);
      expect(kept?.mimeType).toBe('image/png');
      expect(new Uint8Array(await kept!.blob.arrayBuffer())).toEqual(PNG);
    });

    test('バックアップに仕訳が 1 件も無ければ、この端末の証憑はすべて消える', async () => {
      await seedLocal();
      await restoreFromPayload(partial(['books'], bookTables()), new Map(), new Set(['books']));
      expect(await entryIds()).toEqual([]);
      expect(await attachmentIds()).toEqual([]);
    });

    test('仕訳の id が重複していても完了し、残す証憑の判定は変わらない', async () => {
      await seedLocal();
      const payload = partial(
        ['books'],
        bookTables({ journalEntries: [entryOf('keep'), entryOf('keep')] }),
      );
      await restoreFromPayload(payload, new Map(), new Set(['books']));
      expect(await entryIds()).toEqual(['keep']);
      expect(await attachmentIds()).toEqual(['a-keep']);
    });

    test('残す仕訳が 5,000 件でも完了する', async () => {
      await seedLocal();
      const entries = Array.from({ length: 5000 }, (_, i) => entryOf(`e${i}`));
      await db.attachments.add({
        id: 'a-last',
        entryId: 'e4999',
        blob: nodeBlob(PNG),
        mimeType: 'image/png',
        fileName: 'last.png',
        createdAt: 1,
      });
      await restoreFromPayload(
        partial(['books'], bookTables({ journalEntries: entries })),
        new Map(),
        new Set(['books']),
      );
      expect(await db.journalEntries.count()).toBe(5000);
      expect(await attachmentIds()).toEqual(['a-last']);
    });
  });

  test('帳簿データと証憑写真を選ぶと、証憑はバックアップの内容に置き換わる', async () => {
    await seedLocal();
    const payload: BackupPayload = {
      version: 1,
      exportedAt: 'x',
      parts: ['books', 'attachments', 'business', 'ai'],
      tables: bookTables({
        journalEntries: [entryOf('keep')],
        attachments: [
          {
            id: 'from-backup',
            entryId: 'keep',
            mimeType: 'image/png',
            fileName: 'b',
            createdAt: 1,
          },
        ],
      }),
    };
    await restoreFromPayload(
      payload,
      new Map([['from-backup', nodeBlob(PNG)]]),
      new Set(['books', 'attachments']),
    );
    expect(await attachmentIds()).toEqual(['from-backup']);
  });

  test('AI と外部送信の設定だけを選ぶと API キーは書かず、API キーも選べば書く', async () => {
    await seedLocal();
    const payload = () =>
      partial(['ai', 'apiKeys'], {
        settings: [setting('aiEngine', 'openai-compatible'), setting('geminiApiKey', 'backup-key')],
      });
    await restoreFromPayload(payload(), new Map(), new Set(['ai']));
    expect((await db.settings.get('aiEngine'))?.value).toBe('openai-compatible');
    expect((await db.settings.get('geminiApiKey'))?.value).toBe('local-key');
    await restoreFromPayload(payload(), new Map(), new Set(['ai', 'apiKeys']));
    expect((await db.settings.get('geminiApiKey'))?.value).toBe('backup-key');
  });

  test('parts が業務だけなら、添えられた仕訳は既定の選択で書き込まない', async () => {
    await seedLocal();
    const payload = partial(['business'], {
      journalEntries: [entryOf('forged')],
      settings: [setting('userBusinessName', '屋号')],
    });
    const selected = inspectBackupPayload(payload).parts.filter((p) => IMPORT_DEFAULT_PARTS.has(p));
    await restoreFromPayload(payload, new Map(), new Set(selected));
    expect(await entryIds()).toEqual(['drop', 'keep']);
  });

  test.each<[string, BackupPartId[]]>([
    ['バックアップに無い区分', ['books', 'business']],
    ['空の選択', []],
    ['帳簿データ抜きの証憑写真', ['attachments']],
  ])('%s を選ぶと例外で、データベースは変わらない', async (_label, selected) => {
    await seedLocal();
    const before = { entries: await entryIds(), settings: await settingsMap() };
    const payload: BackupPayload =
      selected[0] === 'attachments'
        ? {
            version: 1,
            exportedAt: 'x',
            parts: ['books', 'attachments', 'business', 'ai'],
            tables: bookTables({ attachments: [] }),
          }
        : partial(['business'], { settings: [setting('userBusinessName', '屋号')] });
    await expect(restoreFromPayload(payload, new Map(), new Set(selected))).rejects.toThrow();
    expect(await entryIds()).toEqual(before.entries);
    expect(await settingsMap()).toEqual(before.settings);
    expect(await attachmentIds()).toEqual(['a-drop', 'a-keep']);
  });

  test('R2 より前の v1 が ⑥ の一部だけを持つとき、既定の選択ではこの端末の他の ⑥ は消える', async () => {
    await db.settings.bulkPut([
      setting('userRiyoshaId', '1111222233334444'),
      setting('userFilerName', '端末の氏名'),
    ]);
    const payload: BackupPayload = {
      version: 1,
      exportedAt: 'x',
      tables: { settings: [setting('userFilerName', 'バックアップの氏名')] },
    };
    const selected = inspectBackupPayload(payload).parts.filter((p) => IMPORT_DEFAULT_PARTS.has(p));
    expect(selected).toContain('filer');
    await restoreFromPayload(payload, new Map(), new Set(selected));
    expect((await db.settings.get('userFilerName'))?.value).toBe('バックアップの氏名');
    expect(await db.settings.get('userRiyoshaId')).toBeUndefined();
  });

  test('parts が業務だけの v2 は、すべて復元しても添えられた ④ ⑤ ⑥ のキーを書かない', async () => {
    await restoreFromJson(
      partial(['business'], {
        settings: [
          setting('userBusinessName', '屋号'),
          setting('geminiApiKey', 'k'),
          setting('openaiBaseUrl', 'http://example.invalid/v1'),
          setting('userRiyoshaId', '1111222233334444'),
        ],
      }),
    );
    expect((await db.settings.get('userBusinessName'))?.value).toBe('屋号');
    for (const key of ['geminiApiKey', 'openaiBaseUrl', 'userRiyoshaId']) {
      expect(await db.settings.get(key), key).toBeUndefined();
    }
  });

  test('R2 より前の v1 JSON の証憑は、実体が無いので空 Blob で入り件数に数える', async () => {
    vi.stubGlobal('Blob', NodeBlob);
    try {
      const result = await restoreFromJson({
        version: 1,
        exportedAt: 'x',
        tables: {
          journalEntries: [entryOf('e1')],
          attachments: [
            { id: 'a1', entryId: 'e1', mimeType: 'image/png', fileName: 'a', createdAt: 1 },
          ],
        },
      });
      expect(result.missingBlobCount).toBe(1);
      expect((await db.attachments.get('a1'))?.blob.size).toBe(0);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
