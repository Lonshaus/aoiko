import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { db } from './db';
import { STAMP_COLORS, STAMP_SHAPES } from '../domain/stamps';
// v11 のスタンプは銅・銀・金の 3 段だった。v12 で 7 種 7 色へ移す。索引は変わらないので
// 移せていなくても open は通り、画面で絵柄が出ないところまで気付けない。ここで押さえる。
const DB_NAME = 'aoiko';

async function seedAtV11(rows: { id: string; tier: string; at: string }[]): Promise<void> {
  const legacy = new Dexie(DB_NAME);
  legacy.version(11).stores({
    stamps: 'id, at',
  });
  await legacy.open();
  await legacy.table('stamps').bulkAdd(rows);
  legacy.close();
}

beforeEach(async () => {
  await db.delete();
});

afterEach(async () => {
  await db.delete();
});

describe('v12 upgrade：スタンプの 3 段を 7 種 7 色へ移す', () => {
  test('既存のスタンプすべてが絵柄と色を持つ', async () => {
    await seedAtV11([
      { id: 's1', tier: 'bronze', at: '2026-08-01' },
      { id: 's2', tier: 'silver', at: '2026-08-02' },
      { id: 's3', tier: 'gold', at: '2026-08-03' },
    ]);

    await db.open();
    const rows = await db.stamps.orderBy('id').toArray();

    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(STAMP_SHAPES).toContain(row.shape);
      expect(STAMP_COLORS).toContain(row.color);
    }
  });

  test('段ごとに決まった絵柄へ移る（再読み込みで見た目が変わらない）', async () => {
    await seedAtV11([
      { id: 's1', tier: 'bronze', at: '2026-08-01' },
      { id: 's2', tier: 'silver', at: '2026-08-02' },
      { id: 's3', tier: 'gold', at: '2026-08-03' },
    ]);

    await db.open();
    const rows = await db.stamps.orderBy('id').toArray();

    expect(rows[0]).toMatchObject({ shape: 'yarn', color: 'orange' });
    expect(rows[1]).toMatchObject({ shape: 'bell', color: 'blue' });
    expect(rows[2]).toMatchObject({ shape: 'butterfly', color: 'yellow' });
  });

  test('古い欄は残さない', async () => {
    await seedAtV11([{ id: 's1', tier: 'gold', at: '2026-08-01' }]);

    await db.open();
    const row = await db.stamps.get('s1');

    expect(row).not.toHaveProperty('tier');
  });

  test('押した日は変わらない', async () => {
    await seedAtV11([{ id: 's1', tier: 'silver', at: '2026-03-14' }]);

    await db.open();

    expect((await db.stamps.get('s1'))?.at).toBe('2026-03-14');
  });

  test('知らない段でも絵柄が付く（欄が壊れていても空欄にしない）', async () => {
    await seedAtV11([{ id: 's1', tier: 'platinum', at: '2026-08-01' }]);

    await db.open();
    const row = await db.stamps.get('s1');

    expect(STAMP_SHAPES).toContain(row?.shape);
    expect(STAMP_COLORS).toContain(row?.color);
  });

  test('createdAt が入り、日付の順を保つ', async () => {
    await seedAtV11([
      { id: 'sc', tier: 'gold', at: '2026-08-03' },
      { id: 'sa', tier: 'bronze', at: '2026-08-01' },
      { id: 'sb', tier: 'silver', at: '2026-08-02' },
    ]);

    await db.open();
    const rows = await db.stamps.orderBy('createdAt').toArray();

    expect(rows.map((r) => r.id)).toEqual(['sa', 'sb', 'sc']);
  });

  test('同じ日のスタンプにも別々の createdAt が付く', async () => {
    await seedAtV11([
      { id: 's1', tier: 'bronze', at: '2026-08-01' },
      { id: 's2', tier: 'silver', at: '2026-08-01' },
      { id: 's3', tier: 'gold', at: '2026-08-01' },
    ]);

    await db.open();
    const times = (await db.stamps.orderBy('createdAt').toArray()).map((r) => r.createdAt);

    expect(new Set(times).size).toBe(3);
  });

  test('1 件も無くても upgrade は完了する', async () => {
    await seedAtV11([]);
    await db.open();
    await expect(db.stamps.count()).resolves.toBe(0);
  });
});
