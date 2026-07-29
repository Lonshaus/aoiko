import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { Blob as NodeBlob } from 'node:buffer';
import { db } from '../db/db';
import { buildBackupZipStream, buildPayload, PAYLOAD_VERSION } from '../backup';
import { newId } from '../lib/id';
import { toIndexable } from '../lib/decimal';
import {
  IncompatibleBackupError,
  parseBackupFile,
  parseBackupJson,
  restoreFromJson,
  restoreFromPayload,
} from './restore';

// happy-dom の Blob は Node 組込みの structuredClone（fake-indexeddb が内部で使う）に
// 認識されず保存時にプレーンオブジェクトへ潰れてしまうため、実体バイトを読み戻す
// テストだけ Node 組込みの Blob を使う。
function nodeBlob(bytes: Uint8Array<ArrayBuffer>): Blob {
  return new NodeBlob([bytes]) as unknown as Blob;
}

beforeEach(async () => {
  await db.delete();
  await db.open();
});

afterEach(async () => {
  await db.delete();
});

describe('parseBackupJson', () => {
  test('throws on invalid JSON', () => {
    expect(() => parseBackupJson('{ not json')).toThrow(/JSON として/);
  });

  test('throws when missing required fields', () => {
    expect(() => parseBackupJson('{"foo":"bar"}')).toThrow(/バックアップ形式ではありません/);
  });

  test('returns object when valid', () => {
    const json = JSON.stringify({ version: 1, tables: {}, exportedAt: 'x' });
    expect(parseBackupJson(json).version).toBe(1);
  });
});

describe('restoreFromJson', () => {
  test('throws on incompatible version', async () => {
    await expect(
      restoreFromJson({ version: 999, exportedAt: '2026-05-10', tables: {} }),
    ).rejects.toThrow(IncompatibleBackupError);
  });

  test('round-trips: export → restore yields identical state', async () => {
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

  test('不正な payload では既存データを消さずに throw（検証は削除前）', async () => {
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
    // validateGeneric は主キーの有無しか見ないため関数値を持つ行は検証を通過するが、
    // structured clone 不可で bulkPut が throw する。全消去後の書き込み失敗を再現する。
    await expect(
      restoreFromJson({
        version: PAYLOAD_VERSION,
        exportedAt: '2026-05-10',
        tables: {
          vendors: [{ id: 'v1', name: '業者' }],
          invoices: [{ id: 'inv-1', notCloneable: () => {} }],
        },
      }),
    ).rejects.toThrow();
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

    await expect(
      restoreFromJson({
        version: PAYLOAD_VERSION,
        exportedAt: '2026-05-10',
        tables: {
          vendors: [{ id: 'v1', name: '新業者' }],
          invoices: [{ id: 'inv-1', notCloneable: () => {} }],
        },
      }),
    ).rejects.toThrow();

    const entries = await db.journalEntries.toArray();
    const vendors = await db.vendors.toArray();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.description).toBe('復元前からある仕訳');
    expect(vendors).toHaveLength(1);
    expect(vendors[0]?.name).toBe('残るべき業者');
  });

  test('clears existing data before restore', async () => {
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

  test('申告者情報がバックアップに無ければ本機の値を保持する', async () => {
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

describe('証憑写真（C7）の zip 往復', () => {
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

    await restoreFromPayload(payload, attachmentBlobs);

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

    await restoreFromPayload(payload, attachmentBlobs);

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
      const result = await restoreFromPayload(payload, blobs);
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
});
