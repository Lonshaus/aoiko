// 門は「domain 関数を通ったか」ではなく「書き込みそのもの」を見る。ここで確かめるのは、
// 入口を経由しない直接の書き込みが止まること（#418）と、確認を通った経路が通ること。
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import Dexie from 'dexie';
import { markYearFiled, unlockYear } from '../domain/snapshots';
import { db } from './db';
import {
  allowAllFiledYearWritesInThisTransaction,
  allowFiledYearWriteInThisTransaction,
  FiledYearError,
  filedYearsSettled,
  filedYearsSnapshot,
  refreshFiledYearsOnStorageMutated,
} from './filed-year-guard';
import type { JournalEntry, ReportSnapshot, ReportSnapshotData } from './types';

const FILED = 2026;
const monthlySales: ReportSnapshotData & { type: 'monthly-sales' } = {
  type: 'monthly-sales',
  data: { months: [] },
};
const pl: ReportSnapshotData & { type: 'pl' } = {
  type: 'pl',
  data: { rows: [], totalRevenue: '0', totalExpense: '0', netIncome: '0' },
};

function entry(overrides: Partial<JournalEntry> = {}): JournalEntry {
  return {
    id: `e-${Math.random().toString(36).slice(2)}`,
    date: `${FILED}-05-01`,
    year: FILED,
    description: 'テスト',
    status: 'confirmed',
    source: 'manual',
    createdAt: 0,
    ...overrides,
  } as JournalEntry;
}

beforeEach(async () => {
  await db.delete();
  await db.open();
});

afterEach(async () => {
  await db.delete();
});

describe('申告済み年度への直接の書き込み', () => {
  test('ドメイン関数を通らない add でも止まる（画面から直に書く経路）', async () => {
    await markYearFiled(FILED, { monthlySales, pl }, `${FILED}-12-31`);
    await expect(db.journalEntries.add(entry())).rejects.toThrow(FiledYearError);
    expect(await db.journalEntries.count()).toBe(0);
  });

  test('bulkAdd でも止まる。1 件でも申告済みなら全体が通らない', async () => {
    await markYearFiled(FILED, { monthlySales, pl }, `${FILED}-12-31`);
    await expect(
      db.journalEntries.bulkAdd([entry({ year: FILED - 1, date: `${FILED - 1}-05-01` }), entry()]),
    ).rejects.toThrow(FiledYearError);
    expect(await db.journalEntries.count()).toBe(0);
  });

  test('未申告の年度は素通りする', async () => {
    await markYearFiled(FILED, { monthlySales, pl }, `${FILED}-12-31`);
    await db.journalEntries.add(entry({ year: FILED - 1, date: `${FILED - 1}-05-01` }));
    expect(await db.journalEntries.count()).toBe(1);
  });
  // 訂正仕訳は originalEntryId を持ち countsTowardTotals から外れる。申告済み年度へ
  // 入っても数字は動かないので、止めると訂正そのものができなくなる。
  test('集計に入らない仕訳は申告済み年度でも書ける', async () => {
    await markYearFiled(FILED, { monthlySales, pl }, `${FILED}-12-31`);
    await db.journalEntries.add(entry({ originalEntryId: 'orig-1' }));
    await db.journalEntries.add(entry({ status: 'reversed' }));
    expect(await db.journalEntries.count()).toBe(2);
  });

  test('印を付けた取引は通る', async () => {
    await markYearFiled(FILED, { monthlySales, pl }, `${FILED}-12-31`);
    await db.transaction('rw', db.journalEntries, async () => {
      allowFiledYearWriteInThisTransaction([FILED]);
      await db.journalEntries.add(entry());
    });
    expect(await db.journalEntries.count()).toBe(1);
  });
  // 印は取引に付く。グローバルなフラグにすると、確認したのとは別の書き込みまで通ってしまう。
  test('印は次の取引へ持ち越されない', async () => {
    await markYearFiled(FILED, { monthlySales, pl }, `${FILED}-12-31`);
    await db.transaction('rw', db.journalEntries, async () => {
      allowFiledYearWriteInThisTransaction([FILED]);
      await db.journalEntries.add(entry());
    });
    await expect(db.journalEntries.add(entry())).rejects.toThrow(FiledYearError);
    expect(await db.journalEntries.count()).toBe(1);
  });
});

describe('申告済み年度のメモリ上のキャッシュ', () => {
  test('申告した直後の書き込みが古いキャッシュで素通りしない', async () => {
    await db.journalEntries.add(entry());
    expect(filedYearsSnapshot()).toEqual([]);
    await markYearFiled(FILED, { monthlySales, pl }, `${FILED}-12-31`);
    expect(filedYearsSnapshot()).toEqual([FILED]);
    await expect(db.journalEntries.add(entry())).rejects.toThrow(FiledYearError);
  });

  test('ロックを解除したら書けるようになる', async () => {
    await markYearFiled(FILED, { monthlySales, pl }, `${FILED}-12-31`);
    await expect(db.journalEntries.add(entry())).rejects.toThrow(FiledYearError);
    await unlockYear(FILED);
    expect(filedYearsSnapshot()).toEqual([]);
    await db.journalEntries.add(entry());
    expect(await db.journalEntries.count()).toBe(1);
  });
  // Dexie の ready は既定で一度きり。sticky を外すと、開き直してもキャッシュが読み直されず
  // 前のデータベースの年度が残る。
  test('開き直すとキャッシュも張り直される', async () => {
    await markYearFiled(FILED, { monthlySales, pl }, `${FILED}-12-31`);
    expect(filedYearsSnapshot()).toEqual([FILED]);
    await db.delete();
    await db.open();
    expect(filedYearsSnapshot()).toEqual([]);
    await db.journalEntries.add(entry());
    expect(await db.journalEntries.count()).toBe(1);
  });
});
// 取引が巻き戻ったときのキャッシュ。巻き戻しの直後に待たずに書いて、隙間が無いことを確かめる。
describe('reportSnapshots の取引が巻き戻ったときのキャッシュ', () => {
  const YEAR = 2025;
  const ROLLBACK = new Error('巻き戻す');

  function plRow(id: string, status: ReportSnapshot['status'], year = YEAR): ReportSnapshot {
    return {
      id,
      year,
      type: 'pl',
      status,
      payload: pl,
      generatedAt: 0,
      generatedFromEntriesUpTo: `${year}-12-31`,
    };
  }

  function entryIn(year: number): JournalEntry {
    return entry({ year, date: `${year}-05-01` });
  }

  async function fileYear(year = YEAR): Promise<ReportSnapshot> {
    await markYearFiled(year, { monthlySales, pl }, `${year}-12-31`);
    const row = await db.reportSnapshots
      .where('year')
      .equals(year)
      .filter((r) => r.type === 'pl')
      .first();
    return row!;
  }

  test('申告済みの年度を superseded にして巻き戻ったら、待たずに書いても止まる', async () => {
    const filed = await fileYear();
    await expect(
      db.transaction('rw', db.reportSnapshots, async () => {
        await db.reportSnapshots.put({ ...filed, status: 'superseded' });
        throw ROLLBACK;
      }),
    ).rejects.toBe(ROLLBACK);
    await expect(db.journalEntries.add(entryIn(YEAR))).rejects.toThrow(FiledYearError);
  });

  test('update() で superseded にして巻き戻っても止まる', async () => {
    const filed = await fileYear();
    await expect(
      db.transaction('rw', db.reportSnapshots, async () => {
        await db.reportSnapshots.update(filed.id, { status: 'superseded' });
        throw ROLLBACK;
      }),
    ).rejects.toBe(ROLLBACK);
    await expect(db.journalEntries.add(entryIn(YEAR))).rejects.toThrow(FiledYearError);
  });

  test('abort() で明示的に巻き戻しても止まる', async () => {
    const filed = await fileYear();
    await expect(
      db.transaction('rw', db.reportSnapshots, async () => {
        await db.reportSnapshots.put({ ...filed, status: 'superseded' });
        Dexie.currentTransaction!.abort();
      }),
    ).rejects.toThrow();
    await expect(db.journalEntries.add(entryIn(YEAR))).rejects.toThrow(FiledYearError);
  });

  test('入れ子の取引で superseded にし、外側が巻き戻っても止まる', async () => {
    const filed = await fileYear();
    await expect(
      db.transaction('rw', db.reportSnapshots, async () => {
        await db.transaction('rw', db.reportSnapshots, async () => {
          await db.reportSnapshots.put({ ...filed, status: 'superseded' });
        });
        throw ROLLBACK;
      }),
    ).rejects.toBe(ROLLBACK);
    await expect(db.journalEntries.add(entryIn(YEAR))).rejects.toThrow(FiledYearError);
  });

  test('superseded にした取引が確定する前は、別の取引からの書き込みも止まる', async () => {
    const filed = await fileYear();
    let concurrent: Promise<unknown> | undefined;
    await db.transaction('rw', db.reportSnapshots, async () => {
      await db.reportSnapshots.put({ ...filed, status: 'superseded' });
      concurrent = Dexie.ignoreTransaction(() => db.journalEntries.add(entryIn(YEAR)));
    });
    await expect(concurrent).rejects.toThrow(FiledYearError);
    expect(filedYearsSnapshot()).toEqual([]);
  });

  test('未申告の年度を filed にして巻き戻ったら、待たずに書ける', async () => {
    const other = YEAR - 1;
    await expect(
      db.transaction('rw', db.reportSnapshots, async () => {
        await db.reportSnapshots.put(plRow('p1', 'filed', other));
        throw ROLLBACK;
      }),
    ).rejects.toBe(ROLLBACK);
    await db.journalEntries.add(entryIn(other));
    expect(await db.journalEntries.count()).toBe(1);
    expect(filedYearsSnapshot()).toEqual([]);
  });

  test('同じ取引の中で filed にした年度へは書けない', async () => {
    await expect(
      db.transaction('rw', db.reportSnapshots, db.journalEntries, async () => {
        await db.reportSnapshots.put(plRow('p1', 'filed'));
        await db.journalEntries.add(entryIn(YEAR));
      }),
    ).rejects.toThrow(FiledYearError);
    expect(await db.journalEntries.count()).toBe(0);
  });

  test('同じ取引で superseded と filed を両方書いて確定したら、順序によらず申告済みのまま', async () => {
    await db.transaction('rw', db.reportSnapshots, async () => {
      await db.reportSnapshots.put(plRow('old', 'superseded'));
      await db.reportSnapshots.put(plRow('new', 'filed'));
    });
    expect(filedYearsSnapshot()).toEqual([YEAR]);
    await expect(db.journalEntries.add(entryIn(YEAR))).rejects.toThrow(FiledYearError);
    await db.reportSnapshots.clear();
    await db.transaction('rw', db.reportSnapshots, async () => {
      await db.reportSnapshots.put(plRow('new', 'filed'));
      await db.reportSnapshots.put(plRow('old', 'superseded'));
    });
    expect(filedYearsSnapshot()).toEqual([YEAR]);
    await expect(db.journalEntries.add(entryIn(YEAR))).rejects.toThrow(FiledYearError);
  });

  test('superseded と filed を両方書いて巻き戻ったら、取引の前の状態に戻る', async () => {
    await expect(
      db.transaction('rw', db.reportSnapshots, async () => {
        await db.reportSnapshots.put(plRow('old', 'superseded'));
        await db.reportSnapshots.put(plRow('new', 'filed'));
        throw ROLLBACK;
      }),
    ).rejects.toBe(ROLLBACK);
    expect(filedYearsSnapshot()).toEqual([]);
    const filed = await fileYear();
    await expect(
      db.transaction('rw', db.reportSnapshots, async () => {
        await db.reportSnapshots.put(plRow('new', 'filed'));
        await db.reportSnapshots.put({ ...filed, status: 'superseded' });
        throw ROLLBACK;
      }),
    ).rejects.toBe(ROLLBACK);
    expect(filedYearsSnapshot()).toEqual([YEAR]);
    await expect(db.journalEntries.add(entryIn(YEAR))).rejects.toThrow(FiledYearError);
  });

  test.each([
    ['superseded が先', ['superseded', 'filed'] as const],
    ['filed が先', ['filed', 'superseded'] as const],
  ])('1 回の bulkPut に同じ年度の 2 行（%s）を入れて確定したら申告済み', async (_label, order) => {
    await db.reportSnapshots.bulkPut([plRow('a', order[0]), plRow('b', order[1])]);
    expect(filedYearsSnapshot()).toEqual([YEAR]);
    await expect(db.journalEntries.add(entryIn(YEAR))).rejects.toThrow(FiledYearError);
  });

  test('取引を書かずに put した superseded は、確定した直後から書ける', async () => {
    const filed = await fileYear();
    await expect(db.journalEntries.add(entryIn(YEAR))).rejects.toThrow(FiledYearError);
    await db.reportSnapshots.put({ ...filed, status: 'superseded' });
    await db.journalEntries.add(entryIn(YEAR));
    expect(await db.journalEntries.count()).toBe(1);
  });
  // 解除してよいかは、その年度に filed の pl がまだ残っているかで決める。
  describe('同じ年度に filed の pl が 2 行あるとき', () => {
    async function fileTwo(): Promise<void> {
      await db.reportSnapshots.bulkPut([plRow('f1', 'filed'), plRow('f2', 'filed')]);
    }

    async function filedYearsInDb(): Promise<number[]> {
      const rows = await db.reportSnapshots.toArray();
      const years = rows.filter((r) => r.type === 'pl' && r.status === 'filed').map((r) => r.year);
      return [...new Set(years)].sort((a, b) => a - b);
    }

    test('1 行だけ superseded にして確定しても止まったまま', async () => {
      await fileTwo();
      await db.transaction('rw', db.reportSnapshots, async () => {
        await db.reportSnapshots.put(plRow('f1', 'superseded'));
      });
      await expect(db.journalEntries.add(entryIn(YEAR))).rejects.toThrow(FiledYearError);
      await filedYearsSettled();
      await expect(db.journalEntries.add(entryIn(YEAR))).rejects.toThrow(FiledYearError);
    });

    test('同じ取引で 2 行とも順に update() で superseded にして確定したら、すぐ書ける', async () => {
      await fileTwo();
      await db.transaction('rw', db.reportSnapshots, async () => {
        await db.reportSnapshots.update('f1', { status: 'superseded' });
        await db.reportSnapshots.update('f2', { status: 'superseded' });
      });
      await db.journalEntries.add(entryIn(YEAR));
      expect(await db.journalEntries.count()).toBe(1);
    });

    test('入れ子の取引で 1 行ずつ superseded にし、外側が確定したら、すぐ書ける', async () => {
      await fileTwo();
      await db.transaction('rw', db.reportSnapshots, async () => {
        await db.transaction('rw', db.reportSnapshots, async () => {
          await db.reportSnapshots.update('f1', { status: 'superseded' });
        });
        await db.transaction('rw', db.reportSnapshots, async () => {
          await db.reportSnapshots.update('f2', { status: 'superseded' });
        });
      });
      await db.journalEntries.add(entryIn(YEAR));
      expect(await db.journalEntries.count()).toBe(1);
    });

    test('取引を書かずに 1 行ずつ put したら、2 行目の直後から書ける', async () => {
      await fileTwo();
      await db.reportSnapshots.put(plRow('f1', 'superseded'));
      await expect(db.journalEntries.add(entryIn(YEAR))).rejects.toThrow(FiledYearError);
      await db.reportSnapshots.put(plRow('f2', 'superseded'));
      await db.journalEntries.add(entryIn(YEAR));
      expect(await db.journalEntries.count()).toBe(1);
    });

    test('同じ取引で 1 行を消してから残りを superseded にしたら、すぐ書ける', async () => {
      await fileTwo();
      await db.transaction('rw', db.reportSnapshots, async () => {
        await db.reportSnapshots.delete('f1');
        await db.reportSnapshots.put(plRow('f2', 'superseded'));
      });
      await db.journalEntries.add(entryIn(YEAR));
      expect(await db.journalEntries.count()).toBe(1);
    });

    test('同じ取引で 1 行を superseded にしてから残りを消したら、読み直すまで止める', async () => {
      await fileTwo();
      await db.transaction('rw', db.reportSnapshots, async () => {
        await db.reportSnapshots.put(plRow('f1', 'superseded'));
        await db.reportSnapshots.delete('f2');
      });
      await expect(db.journalEntries.add(entryIn(YEAR))).rejects.toThrow(FiledYearError);
      await filedYearsSettled();
      await db.journalEntries.add(entryIn(YEAR));
      expect(await db.journalEntries.count()).toBe(1);
    });
    // 年度が NaN の行は範囲を作る時点で DataError になり、取引内の確認が読めない。
    test('取引内の確認が読めなくても書き込みは確定し、読み直しでキャッシュが DB とそろう', async () => {
      const unhandled: unknown[] = [];
      const onUnhandled = (reason: unknown) => {
        unhandled.push(reason);
      };
      process.on('unhandledRejection', onUnhandled);
      try {
        await fileTwo();
        await db.reportSnapshots.put({ ...plRow('nan', 'superseded'), year: Number.NaN });
        expect(await db.reportSnapshots.get('nan')).toBeDefined();
        await filedYearsSettled();
        expect(filedYearsSnapshot()).toEqual(await filedYearsInDb());
        await new Promise((r) => setTimeout(r, 0));
        expect(unhandled).toEqual([]);
      } finally {
        process.off('unhandledRejection', onUnhandled);
      }
    });
  });

  test('1 回の bulkPut で別の年度の filed と superseded を書いたら、同じ取引の中でも filed の年度へは書けない', async () => {
    const other = YEAR - 1;
    await expect(
      db.transaction('rw', db.reportSnapshots, db.journalEntries, async () => {
        await db.reportSnapshots.bulkPut([plRow('p1', 'filed', other), plRow('p2', 'superseded')]);
        await db.journalEntries.add(entryIn(other));
      }),
    ).rejects.toThrow(FiledYearError);
    expect(await db.journalEntries.count()).toBe(0);
  });
});
// 門を通らない書き込み（別のタブの代わり）。素の IndexedDB で書くので storagemutated も飛ばず、
// このタブのキャッシュは古いまま残る。
async function putUnguarded(row: ReportSnapshot): Promise<void> {
  const conn = await new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(db.name);
    req.onsuccess = () => {
      resolve(req.result);
    };
    req.onerror = () => {
      reject(req.error);
    };
  });
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = conn.transaction('reportSnapshots', 'readwrite');
      tx.objectStore('reportSnapshots').put(row);
      tx.oncomplete = () => {
        resolve();
      };
      tx.onabort = () => {
        reject(tx.error);
      };
    });
  } finally {
    conn.close();
  }
}

function plRowAt(id: string, status: ReportSnapshot['status'], year: number): ReportSnapshot {
  return {
    id,
    year,
    type: 'pl',
    status,
    payload: pl,
    generatedAt: 0,
    generatedFromEntriesUpTo: `${year}-12-31`,
  };
}

function entryAt(year: number, overrides: Partial<JournalEntry> = {}): JournalEntry {
  return entry({ year, date: `${year}-05-01`, ...overrides });
}

describe('キャッシュに無い申告（別のタブ）', () => {
  // 範囲に reportSnapshots を含む明示の取引で書く。allow は取引に付ける印。
  function writeInScope(entries: JournalEntry[], allow?: number[] | 'all'): Promise<void> {
    return db.transaction('rw', [db.journalEntries, db.reportSnapshots], async () => {
      if (allow === 'all') {
        allowAllFiledYearWritesInThisTransaction();
      } else if (allow !== undefined) {
        allowFiledYearWriteInThisTransaction(allow);
      }
      await db.journalEntries.bulkAdd(entries);
    });
  }

  describe('2030 年を別のタブが申告済み', () => {
    beforeEach(async () => {
      await putUnguarded(plRowAt('other-tab', 'filed', 2030));
    });

    test('取引の範囲に reportSnapshots があれば、キャッシュが古くても止まる', async () => {
      expect(filedYearsSnapshot()).toEqual([]);
      await expect(writeInScope([entryAt(2030)])).rejects.toThrow(FiledYearError);
      expect(await db.journalEntries.count()).toBe(0);
      expect(filedYearsSnapshot()).toEqual([2030]);
    });
    // 確認の時点で申告済みが無ければ、画面は空の印を付けて書く。その間に申告されたら止める。
    test('年度の無い印では止まる', async () => {
      await expect(writeInScope([entryAt(2030)], [])).rejects.toThrow(FiledYearError);
      expect(await db.journalEntries.count()).toBe(0);
    });

    test('印に入れた年度は通る', async () => {
      await writeInScope([entryAt(2030)], [2030]);
      expect(await db.journalEntries.count()).toBe(1);
    });

    test('印に無い年度は止まり、同じ書き込みの他の行も入らない', async () => {
      const err = await writeInScope([entryAt(2029), entryAt(2030)], [2029]).catch(
        (e: unknown) => e,
      );
      expect(err).toBeInstanceOf(FiledYearError);
      expect((err as FiledYearError).years).toEqual([2030]);
      expect(await db.journalEntries.count()).toBe(0);
    });
    // 暗黙の取引の範囲は journalEntries だけで、取引の中では申告記録を読めない。
    test('範囲に reportSnapshots が無い取引はキャッシュで判定する（古ければ通る）', async () => {
      await db.journalEntries.add(entryAt(2030));
      expect(await db.journalEntries.count()).toBe(1);
    });

    test('1 回の bulkAdd に申告済みの年度が混ざれば止まり、どの行も入らない', async () => {
      const err = await writeInScope([entryAt(2029), entryAt(2030)]).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(FiledYearError);
      expect((err as FiledYearError).years).toEqual([2030]);
      expect(await db.journalEntries.count()).toBe(0);
    });

    test('申告済みの年度を含まない bulkAdd は、明示の取引でも暗黙の取引でも入る', async () => {
      await writeInScope([entryAt(2029), entryAt(2028)]);
      expect(await db.journalEntries.count()).toBe(2);
      await db.journalEntries.bulkAdd([entryAt(2029), entryAt(2028)]);
      expect(await db.journalEntries.count()).toBe(4);
    });

    test('集計に入らない仕訳は通る', async () => {
      await writeInScope([
        entryAt(2030, { status: 'reversed' }),
        entryAt(2030, { originalEntryId: 'orig-1' }),
      ]);
      expect(await db.journalEntries.count()).toBe(2);
    });

    test('全部通す印（復元）なら通る', async () => {
      await writeInScope([entryAt(2030)], 'all');
      expect(await db.journalEntries.count()).toBe(1);
    });
  });

  test('別のタブが解除していれば、キャッシュに残っていても通り、キャッシュも読み直す', async () => {
    await markYearFiled(2025, { monthlySales, pl }, '2025-12-31');
    expect(filedYearsSnapshot()).toEqual([2025]);
    const filed = await db.reportSnapshots
      .where('year')
      .equals(2025)
      .filter((r) => r.type === 'pl')
      .first();
    await putUnguarded({ ...filed!, status: 'superseded' });
    await writeInScope([entryAt(2025)]);
    expect(await db.journalEntries.count()).toBe(1);
    await filedYearsSettled();
    expect(filedYearsSnapshot()).not.toContain(2025);
  });
});

describe('別の接続の確定を受けてキャッシュを読み直す（storagemutated）', () => {
  test('別の接続が申告したら、範囲に reportSnapshots の無い書き込みも止まる', async () => {
    const other = new Dexie(db.name);
    try {
      await other.open();
      await other.table('reportSnapshots').put(plRowAt('other-conn', 'filed', 2031));
      await filedYearsSettled();
      await expect(db.journalEntries.add(entryAt(2031))).rejects.toThrow(FiledYearError);
    } finally {
      other.close();
    }
  });

  test('別の接続が解除したら、また書ける', async () => {
    const other = new Dexie(db.name);
    try {
      await other.open();
      await other.table('reportSnapshots').put(plRowAt('other-conn', 'filed', 2031));
      await filedYearsSettled();
      await expect(db.journalEntries.add(entryAt(2031))).rejects.toThrow(FiledYearError);
      await other.table('reportSnapshots').put(plRowAt('other-conn', 'superseded', 2031));
      await filedYearsSettled();
      await db.journalEntries.add(entryAt(2031));
      expect(await db.journalEntries.count()).toBe(1);
    } finally {
      other.close();
    }
  });
});
// storagemutated からの読み直しを止めて、取引内の確認が読めなかったときの読み直しだけを見る。
test('取引内の確認が読めなかった取引は、確定後に DB から読み直す', async () => {
  Dexie.on('storagemutated').unsubscribe(refreshFiledYearsOnStorageMutated);
  try {
    await putUnguarded(plRowAt('other-tab', 'filed', 2030));
    await db.transaction('rw', db.reportSnapshots, async () => {
      await db.reportSnapshots.put(plRowAt('nan', 'superseded', Number.NaN));
    });
    await filedYearsSettled();
    await expect(db.journalEntries.add(entryAt(2030))).rejects.toThrow(FiledYearError);
  } finally {
    Dexie.on('storagemutated', refreshFiledYearsOnStorageMutated);
  }
});
