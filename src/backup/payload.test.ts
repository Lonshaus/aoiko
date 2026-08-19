import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { Blob as NodeBlob } from 'node:buffer';
import { db } from '../db/db';
import { toIndexable } from '../lib/decimal';
import { buildPayload, iterateAttachmentBlobs, PAYLOAD_VERSION } from './payload';

// happy-dom の Blob は Node 組込みの structuredClone（fake-indexeddb が内部で使う）に
// 認識されず保存時にプレーンオブジェクトへ潰れてしまうため、実体バイトを読み戻す
// テストだけ Node 組込みの Blob を使う。
function nodeBlob(bytes: Uint8Array<ArrayBuffer>): Blob {
  return new NodeBlob([bytes]) as unknown as Blob;
}

interface SettingRow {
  key: string;
  value: unknown;
}

function settingKeys(tables: Record<string, unknown[]>): string[] {
  return (tables.settings as SettingRow[]).map((r) => r.key);
}

beforeEach(async () => {
  await db.delete();
  await db.open();
  const now = Date.now();
  await db.settings.bulkPut([
    { key: 'geminiApiKey', value: 'secret-gemini', updatedAt: now },
    { key: 'openaiApiKey', value: 'secret-openai', updatedAt: now },
    { key: 'userBusinessName', value: 'テスト商店', updatedAt: now },
    { key: 'userRiyoshaId', value: '1234567890123456', updatedAt: now },
    { key: 'userFilerName', value: '青井 太郎', updatedAt: now },
    { key: 'userFilerAddress', value: '東京都〇〇1-2-3', updatedAt: now },
    { key: 'userZeimushoCode', value: '01101', updatedAt: now },
    { key: 'backupFolderHandle', value: { not: 'serializable' }, updatedAt: now },
    {
      key: 'nativeBackupFolder',
      value: { token: '/Users/someone/Dropbox/aoiko', name: 'aoiko' },
      updatedAt: now,
    },
  ]);
});

afterEach(async () => {
  await db.delete();
});

describe('buildPayload', () => {
  test('version と exportedAt を含む', async () => {
    const p = await buildPayload();
    expect(p.version).toBe(PAYLOAD_VERSION);
    expect(p.exportedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test('backupFolderHandle は常に除外（シリアライズ不可）', async () => {
    const p = await buildPayload({ includeApiKeys: true });
    expect(settingKeys(p.tables)).not.toContain('backupFolderHandle');
  });
  // シリアライズはできてしまうため、除外を外すと端末固有のパスや bookmark が
  // バックアップに混ざり、別端末で復元したときに存在しない場所や他人のフォルダを指す。
  test('nativeBackupFolder は常に除外（端末固有）', async () => {
    const p = await buildPayload({ includeApiKeys: true });
    expect(settingKeys(p.tables)).not.toContain('nativeBackupFolder');
  });

  test('既定では API キーを除外する', async () => {
    const p = await buildPayload();
    const keys = settingKeys(p.tables);
    expect(keys).not.toContain('geminiApiKey');
    expect(keys).not.toContain('openaiApiKey');
    // 機微でない設定は残る
    expect(keys).toContain('userBusinessName');
  });

  test('includeApiKeys=false でも API キーを除外', async () => {
    const p = await buildPayload({ includeApiKeys: false });
    const keys = settingKeys(p.tables);
    expect(keys).not.toContain('geminiApiKey');
    expect(keys).not.toContain('openaiApiKey');
  });

  test('includeApiKeys=true のときだけ API キーを含める', async () => {
    const p = await buildPayload({ includeApiKeys: true });
    const rows = p.tables.settings as SettingRow[];
    const gemini = rows.find((r) => r.key === 'geminiApiKey');
    expect(gemini?.value).toBe('secret-gemini');
    expect(rows.find((r) => r.key === 'openaiApiKey')?.value).toBe('secret-openai');
  });

  test('既定では申告者情報（個人情報）を除外する', async () => {
    const keys = settingKeys((await buildPayload()).tables);
    expect(keys).not.toContain('userRiyoshaId');
    expect(keys).not.toContain('userFilerName');
    expect(keys).not.toContain('userFilerAddress');
    expect(keys).not.toContain('userZeimushoCode');
    // 屋号（事業情報）は除外対象ではない
    expect(keys).toContain('userBusinessName');
  });

  test('includeFilerInfo=true のときだけ申告者情報を含める', async () => {
    const rows = (await buildPayload({ includeFilerInfo: true })).tables.settings as SettingRow[];
    expect(rows.find((r) => r.key === 'userRiyoshaId')?.value).toBe('1234567890123456');
    expect(rows.find((r) => r.key === 'userFilerName')?.value).toBe('青井 太郎');
  });

  test('attachments のメタデータには blob（JSON 化不可）を含めない', async () => {
    await db.attachments.add({
      id: 'a1',
      entryId: 'e1',
      blob: new Blob([new Uint8Array([1])], { type: 'image/jpeg' }),
      mimeType: 'image/jpeg',
      fileName: 'x.jpg',
      createdAt: Date.now(),
    });
    const p = await buildPayload();
    const rows = p.tables.attachments as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(rows[0]).not.toHaveProperty('blob');
    expect(rows[0]!['fileName']).toBe('x.jpg');
    // JSON 化できることを確認（Blob が残っていれば JSON.stringify は落ちないが値が壊れる）
    expect(() => JSON.stringify(p)).not.toThrow();
  });
});

// スタンプ帳はこの端末だけの記録だと画面で言っている。バックアップに入れると
// 別端末での復元で引き継がれてしまい、その説明が嘘になる。
describe('支援の記録は持ち出さない', () => {
  test('stamps テーブルは payload に入らない', async () => {
    await db.stamps.put({ id: 's1', shape: 'bell', color: 'blue', at: '2026-08-18', createdAt: 1 });
    const p = await buildPayload({ includeApiKeys: true });
    expect(p.tables.stamps).toBeUndefined();
  });

  test('supporterBadgeAt は常に除外（商店から復元するもの）', async () => {
    await db.settings.put({ key: 'supporterBadgeAt', value: '2026-08-18', updatedAt: Date.now() });
    const p = await buildPayload({ includeApiKeys: true });
    expect(settingKeys(p.tables)).not.toContain('supporterBadgeAt');
  });
});

describe('iterateAttachmentBlobs', () => {
  test('添付が無ければ何も yield しない', async () => {
    const results: Array<readonly [string, Uint8Array]> = [];
    for await (const entry of iterateAttachmentBlobs()) {
      results.push(entry);
    }
    expect(results).toHaveLength(0);
  });

  test('全ての添付を id とバイト列付きで yield する', async () => {
    await db.attachments.bulkAdd([
      {
        id: 'a1',
        entryId: 'e1',
        blob: nodeBlob(new Uint8Array([1, 2, 3])),
        mimeType: 'image/jpeg',
        fileName: 'a.jpg',
        createdAt: Date.now(),
      },
      {
        id: 'a2',
        entryId: 'e2',
        blob: nodeBlob(new Uint8Array([4, 5])),
        mimeType: 'image/jpeg',
        fileName: 'b.jpg',
        createdAt: Date.now(),
      },
    ]);
    const results = new Map<string, Uint8Array>();
    for await (const [id, bytes] of iterateAttachmentBlobs()) {
      results.set(id, bytes);
    }
    expect(results.size).toBe(2);
    expect(results.get('a1')).toEqual(new Uint8Array([1, 2, 3]));
    expect(results.get('a2')).toEqual(new Uint8Array([4, 5]));
  });
});

describe('buildPayload（スナップショットの原子性 #316）', () => {
  test('読み取り中に書き込みが割り込んでも、親仕訳の無い明細を含まない', async () => {
    const now = Date.now();
    await db.journalEntries.add({
      id: 'e1',
      date: '2026-03-01',
      year: 2026,
      description: '既存',
      status: 'confirmed',
      source: 'manual',
      createdAt: now,
      confirmedAt: now,
    });
    await db.journalLines.add({
      id: 'l1',
      entryId: 'e1',
      side: 'debit',
      accountCode: '5130',
      amount: '1000',
      amountIndexed: toIndexable('1000'),
      taxRate: 0,
      taxIncluded: true,
      invoiceCompliant: false,
    });
    // buildPayload の完了を待たずに別の仕訳を書き込む
    const writing = db.transaction('rw', [db.journalEntries, db.journalLines], async () => {
      await db.journalEntries.add({
        id: 'e2',
        date: '2026-03-02',
        year: 2026,
        description: '割り込み',
        status: 'confirmed',
        source: 'manual',
        createdAt: now,
        confirmedAt: now,
      });
      await db.journalLines.add({
        id: 'l2',
        entryId: 'e2',
        side: 'debit',
        accountCode: '5130',
        amount: '2000',
        amountIndexed: toIndexable('2000'),
        taxRate: 0,
        taxIncluded: true,
        invoiceCompliant: false,
      });
    });
    const payload = await buildPayload();
    await writing;

    const entryIds = new Set(
      (payload.tables.journalEntries as Array<{ id: string }>).map((e) => e.id),
    );
    const lines = payload.tables.journalLines as Array<{ entryId: string }>;
    for (const line of lines) {
      expect(entryIds.has(line.entryId)).toBe(true);
    }
  });
});
