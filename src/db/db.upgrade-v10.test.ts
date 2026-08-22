import { Blob as NodeBlob } from 'node:buffer';
import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { db } from './db';
import { sha256Hex } from '../lib/sha256';
// v10 の upgrade は Dexie の外の Promise（crypto.subtle・Blob.arrayBuffer）を待つ。
// Dexie.waitFor で繋ぎ止めないとトランザクションが先に閉じるので、そこを実際に確かめる。
const DB_NAME = 'aoiko';
// happy-dom の Blob は Node 組込みの structuredClone（fake-indexeddb が内部で使う）に
// 認識されずプレーンオブジェクトへ潰れる。実体バイトを読み戻すので Node 側の Blob を使う
// （payload.test.ts と同じ理由）。
function nodeBlob(bytes: Uint8Array<ArrayBuffer>): Blob {
  return new NodeBlob([bytes]) as unknown as Blob;
}

function bytes(seed: number, length: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i++) {
    out[i] = (seed + i) % 256;
  }
  return out;
}
// v9 相当のスキーマだけを宣言した Dexie を直接開き、sha256 の無い行を書き込む。
async function seedAtV9(rows: { id: string; blob: Blob }[]): Promise<void> {
  const legacy = new Dexie(DB_NAME);
  legacy.version(9).stores({
    attachments: 'id, entryId',
  });
  await legacy.open();
  await legacy.table('attachments').bulkAdd(
    rows.map((r) => ({
      id: r.id,
      entryId: `entry-${r.id}`,
      blob: r.blob,
      mimeType: 'image/jpeg',
      fileName: `${r.id}.jpg`,
      createdAt: 1,
    })),
  );
  legacy.close();
}

beforeEach(async () => {
  await db.delete();
});

afterEach(async () => {
  await db.delete();
});

describe('v10 upgrade：証憑写真の sha256 を埋める', () => {
  test('既存行すべてに正しい sha256 が入る', async () => {
    const a = bytes(1, 4096);
    const b = bytes(200, 65536);
    await seedAtV9([
      { id: 'att-a', blob: nodeBlob(a) },
      { id: 'att-b', blob: nodeBlob(b) },
    ]);

    await db.open();
    const rows = await db.attachments.orderBy('id').toArray();

    expect(rows).toHaveLength(2);
    expect(rows[0]?.sha256).toBe(await sha256Hex(a));
    expect(rows[1]?.sha256).toBe(await sha256Hex(b));
  });

  test('中身が同じなら同じ hash になる（内容定址の前提）', async () => {
    const same = bytes(7, 1024);
    await seedAtV9([
      { id: 'att-1', blob: nodeBlob(same) },
      { id: 'att-2', blob: nodeBlob(same) },
    ]);

    await db.open();
    const rows = await db.attachments.orderBy('id').toArray();

    expect(rows[0]?.sha256).toBe(rows[1]?.sha256);
  });

  test('sha256 で索引が引ける', async () => {
    const payload = bytes(42, 2048);
    await seedAtV9([{ id: 'att-x', blob: nodeBlob(payload) }]);

    await db.open();
    const hash = await sha256Hex(payload);
    const found = await db.attachments.where('sha256').equals(hash).toArray();

    expect(found.map((r) => r.id)).toEqual(['att-x']);
  });

  test('行が 1 件も無くても upgrade は完了する', async () => {
    await seedAtV9([]);
    await db.open();
    await expect(db.attachments.count()).resolves.toBe(0);
  });

  test('件数が多くてもトランザクションが先に閉じない', async () => {
    // 1 件ごとに Dexie 外の Promise を 2 つ待つ。数が増えるほど、繋ぎ止めに失敗していれば
    // 途中で PrematureCommitError になる。
    const rows = Array.from({ length: 60 }, (_, i) => ({
      id: `att-${String(i).padStart(3, '0')}`,
      blob: nodeBlob(bytes(i, 3000)),
    }));
    await seedAtV9(rows);

    await db.open();
    const all = await db.attachments.toArray();

    expect(all).toHaveLength(60);
    expect(all.every((r) => typeof r.sha256 === 'string' && r.sha256.length === 64)).toBe(true);
  });
});
