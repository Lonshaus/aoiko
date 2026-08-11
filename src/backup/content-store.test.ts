import { describe, expect, test } from 'vitest';
import {
  ATTACHMENT_DIR,
  attachmentPath,
  blobsToDelete,
  buildSnapshot,
  expiredSnapshots,
  missingBlobs,
  parseSnapshot,
  SNAPSHOT_FORMAT,
  snapshotFileName,
  sortSnapshotsNewestFirst,
  splitBackupPath,
  unreferencedBlobs,
} from './content-store';
import type { Snapshot } from './content-store';
import type { BackupPayload } from './types';

describe('buildSnapshot', () => {
  test('payload と attachments からそのまま組み立てる', () => {
    const payload: BackupPayload = {
      version: 1,
      exportedAt: '2026-08-09T12:00:00.000Z',
      tables: { entries: [{ id: '1' }] },
    };
    const attachments = [{ id: 'a', sha256: 'f'.repeat(64), bytes: 10 }];
    const snapshot = buildSnapshot(payload, attachments);
    expect(snapshot.format).toBe(SNAPSHOT_FORMAT);
    // 入れ物の版（format）と中身の版（payloadVersion）は別々に動く。
    expect(snapshot.payloadVersion).toBe(payload.version);
    expect(snapshot.exportedAt).toBe(payload.exportedAt);
    expect(snapshot.tables).toBe(payload.tables);
    expect(snapshot.attachments).toEqual(attachments);
  });

  test('attachments 引数は複製され、呼出元配列を変更しても影響しない', () => {
    const payload: BackupPayload = {
      version: 1,
      exportedAt: '2026-08-09T12:00:00.000Z',
      tables: {},
    };
    const attachments = [{ id: 'a', sha256: 'f'.repeat(64), bytes: 10 }];
    const snapshot = buildSnapshot(payload, attachments);
    attachments.pop();
    expect(snapshot.attachments).toHaveLength(1);
  });
});

describe('snapshotFileName', () => {
  test('コロンとミリ秒を落として固定長にする', () => {
    expect(snapshotFileName('2026-08-09T12:00:00.000Z')).toBe('2026-08-09T120000Z.json');
  });

  test('ミリ秒を含まない ISO 文字列も扱える', () => {
    expect(snapshotFileName(new Date('2026-01-01T00:00:00Z').toISOString())).toBe(
      '2026-01-01T000000Z.json',
    );
  });

  test('不正な ISO 文字列は RangeError', () => {
    expect(() => snapshotFileName('not-a-date')).toThrow(RangeError);
  });
});

describe('sortSnapshotsNewestFirst', () => {
  test('新しい順に並び替える', () => {
    const names = ['2026-01-01T000000Z.json', '2026-03-01T000000Z.json', '2026-02-01T000000Z.json'];
    expect(sortSnapshotsNewestFirst(names)).toEqual([
      '2026-03-01T000000Z.json',
      '2026-02-01T000000Z.json',
      '2026-01-01T000000Z.json',
    ]);
  });

  test('形式が合わないファイル名は除外する', () => {
    const names = ['2026-01-01T000000Z.json', 'readme.txt', '不正.json', '2026-03-01T000000Z.json'];
    expect(sortSnapshotsNewestFirst(names)).toEqual([
      '2026-03-01T000000Z.json',
      '2026-01-01T000000Z.json',
    ]);
  });

  test('空配列は空配列', () => {
    expect(sortSnapshotsNewestFirst([])).toEqual([]);
  });
});

function validSnapshotJson(): string {
  return JSON.stringify({
    format: SNAPSHOT_FORMAT,
    payloadVersion: 1,
    exportedAt: '2026-08-09T12:00:00.000Z',
    tables: { entries: [] },
    attachments: [{ id: 'a', sha256: 'a'.repeat(64), bytes: 10 }],
  });
}

describe('parseSnapshot', () => {
  test('正しい JSON をパースできる', () => {
    const snapshot = parseSnapshot(validSnapshotJson());
    expect(snapshot).not.toBeNull();
    expect(snapshot?.attachments).toHaveLength(1);
  });

  test('payloadVersion が無い・整数でないものは null', () => {
    const base = JSON.parse(validSnapshotJson()) as Record<string, unknown>;
    const { payloadVersion: _omitted, ...without } = base;
    expect(parseSnapshot(JSON.stringify(without))).toBeNull();
    expect(parseSnapshot(JSON.stringify({ ...base, payloadVersion: '1' }))).toBeNull();
    expect(parseSnapshot(JSON.stringify({ ...base, payloadVersion: 1.5 }))).toBeNull();
  });

  test('壊れた（truncated）JSON は null', () => {
    expect(parseSnapshot('{"format":1,"exportedAt":')).toBeNull();
  });

  test('JSON だが object でない場合は null', () => {
    expect(parseSnapshot('[1,2,3]')).toBeNull();
    expect(parseSnapshot('"string"')).toBeNull();
  });

  test('format が一致しない場合は null（将来バージョンとの混線防止）', () => {
    const json = JSON.stringify({
      format: 2,
      exportedAt: '2026-08-09T12:00:00.000Z',
      tables: {},
      attachments: [],
    });
    expect(parseSnapshot(json)).toBeNull();
  });

  test('exportedAt / tables / attachments が欠けている場合は null', () => {
    expect(parseSnapshot(JSON.stringify({ format: SNAPSHOT_FORMAT }))).toBeNull();
    expect(parseSnapshot(JSON.stringify({ format: SNAPSHOT_FORMAT, exportedAt: 'x' }))).toBeNull();
    expect(
      parseSnapshot(JSON.stringify({ format: SNAPSHOT_FORMAT, exportedAt: 'x', tables: {} })),
    ).toBeNull();
  });

  test('sha256 が 64 桁の小文字16進数でない場合は null', () => {
    const json = JSON.stringify({
      format: SNAPSHOT_FORMAT,
      exportedAt: '2026-08-09T12:00:00.000Z',
      tables: {},
      attachments: [{ id: 'a', sha256: 'ZZZZ', bytes: 10 }],
    });
    expect(parseSnapshot(json)).toBeNull();
  });

  test('attachments のフィールド型が不正な場合は null', () => {
    const json = JSON.stringify({
      format: SNAPSHOT_FORMAT,
      exportedAt: '2026-08-09T12:00:00.000Z',
      tables: {},
      attachments: [{ id: 1, sha256: 'a'.repeat(64), bytes: '10' }],
    });
    expect(parseSnapshot(json)).toBeNull();
  });
});

describe('missingBlobs', () => {
  const snapshot: Snapshot = {
    format: SNAPSHOT_FORMAT,
    payloadVersion: 1,
    exportedAt: '2026-08-09T12:00:00.000Z',
    tables: {},
    attachments: [
      { id: 'a', sha256: 'a'.repeat(64), bytes: 1 },
      { id: 'b', sha256: 'b'.repeat(64), bytes: 1 },
      { id: 'a2', sha256: 'a'.repeat(64), bytes: 1 },
    ],
  };

  test('present に無いものだけを、重複排除して最初の出現順で返す', () => {
    expect(missingBlobs(snapshot, new Set())).toEqual(['a'.repeat(64), 'b'.repeat(64)]);
  });

  test('全て present なら空配列（復元可能）', () => {
    expect(missingBlobs(snapshot, new Set(['a'.repeat(64), 'b'.repeat(64)]))).toEqual([]);
  });

  test('attachments が空なら空配列', () => {
    const empty: Snapshot = { ...snapshot, attachments: [] };
    expect(missingBlobs(empty, new Set())).toEqual([]);
  });
});

describe('attachmentPath', () => {
  test('正しい sha256 から attachments/<hex> を組み立てる', () => {
    const sha256 = 'a'.repeat(64);
    expect(attachmentPath(sha256)).toBe(`${ATTACHMENT_DIR}/${sha256}`);
  });

  test('パストラバーサルを試みる文字列は RangeError', () => {
    expect(() => attachmentPath('../../etc/passwd')).toThrow(RangeError);
  });

  test('長さや大文字が不正な場合も RangeError', () => {
    expect(() => attachmentPath('a'.repeat(63))).toThrow(RangeError);
    expect(() => attachmentPath('A'.repeat(64))).toThrow(RangeError);
  });
});

describe('expiredSnapshots', () => {
  const names = [
    '2026-01-01T000000Z.json',
    '2026-02-01T000000Z.json',
    '2026-03-01T000000Z.json',
    '2026-04-01T000000Z.json',
  ];

  test('retentionCount を超えた古いものを返す', () => {
    expect(expiredSnapshots(names, 2)).toEqual([
      '2026-02-01T000000Z.json',
      '2026-01-01T000000Z.json',
    ]);
  });

  test('retentionCount <= 0 は「全て保持」で空配列', () => {
    expect(expiredSnapshots(names, 0)).toEqual([]);
    expect(expiredSnapshots(names, -1)).toEqual([]);
  });

  test('件数が retentionCount 以下なら空配列', () => {
    expect(expiredSnapshots(names, 10)).toEqual([]);
  });

  test('空配列は空配列', () => {
    expect(expiredSnapshots([], 3)).toEqual([]);
  });
});

describe('unreferencedBlobs', () => {
  test('present にあり referenced に無いものを返す', () => {
    const present = new Set(['a', 'b', 'c']);
    const referenced = new Set(['b']);
    expect(unreferencedBlobs(present, referenced)).toEqual(['a', 'c']);
  });

  test('全て参照されていれば空配列', () => {
    const present = new Set(['a', 'b']);
    expect(unreferencedBlobs(present, present)).toEqual([]);
  });

  test('present が空なら空配列', () => {
    expect(unreferencedBlobs(new Set(), new Set(['a']))).toEqual([]);
  });
});

describe('blobsToDelete', () => {
  const DAY_MS = 24 * 60 * 60 * 1000;
  const now = 1_000_000 * DAY_MS;

  test('retentionDays が null なら常に空配列', () => {
    const candidates = [{ sha256: 'a'.repeat(64), unreferencedSinceMs: 0 }];
    expect(blobsToDelete(candidates, now, null)).toEqual([]);
  });

  test('境界ちょうど（retentionDays 日経過）は削除対象に含む', () => {
    const candidates = [{ sha256: 'a'.repeat(64), unreferencedSinceMs: now - 7 * DAY_MS }];
    expect(blobsToDelete(candidates, now, 7)).toEqual(['a'.repeat(64)]);
  });

  test('境界未満は削除対象に含まない', () => {
    const candidates = [{ sha256: 'a'.repeat(64), unreferencedSinceMs: now - 7 * DAY_MS + 1 }];
    expect(blobsToDelete(candidates, now, 7)).toEqual([]);
  });

  test('負の retentionDays は null と同様に扱う', () => {
    const candidates = [{ sha256: 'a'.repeat(64), unreferencedSinceMs: 0 }];
    expect(blobsToDelete(candidates, now, -1)).toEqual([]);
  });

  test('非有限の retentionDays は null と同様に扱う', () => {
    const candidates = [{ sha256: 'a'.repeat(64), unreferencedSinceMs: 0 }];
    expect(blobsToDelete(candidates, now, Number.POSITIVE_INFINITY)).toEqual([]);
    expect(blobsToDelete(candidates, now, Number.NaN)).toEqual([]);
  });

  test('候補が空なら空配列', () => {
    expect(blobsToDelete([], now, 7)).toEqual([]);
  });
});

describe('splitBackupPath', () => {
  test('単一セグメントはそのまま1要素', () => {
    expect(splitBackupPath('2026-08-09T120000Z.json')).toEqual(['2026-08-09T120000Z.json']);
  });

  test('スラッシュ区切りを順序通り分解する', () => {
    expect(splitBackupPath(`${ATTACHMENT_DIR}/${'a'.repeat(64)}`)).toEqual([
      ATTACHMENT_DIR,
      'a'.repeat(64),
    ]);
    expect(splitBackupPath('a/b/c')).toEqual(['a', 'b', 'c']);
  });
  // 以下は「壊れた/細工されたファイル名で保存先の外を指せない」ことの確認。
  // 正規化して通してはならないので、いずれも例外であることまで見る。
  test.each([
    ['空文字', ''],
    ['先頭スラッシュ（絶対パス）', '/attachments/a'],
    ['末尾スラッシュ', 'attachments/'],
    ['空セグメント', 'a//b'],
    ['カレント参照', 'a/./b'],
    ['親参照', 'a/../b'],
    ['親参照のみ', '..'],
    ['先頭の親参照', '../secrets'],
    ['カレント参照のみ', '.'],
    ['バックスラッシュ', 'a\\b'],
    ['Windows の絶対パス', 'C:\\Windows\\system32'],
    ['ドライブ修飾', 'C:'],
    ['ドライブ相対', 'c:secrets'],
    ['NUL', 'a\u0000b'],
    ['制御文字', 'a\u001fb'],
    ['改行', 'snapshots/a\nb.json'],
  ])('%s は RangeError で拒否する', (_label, path) => {
    expect(() => splitBackupPath(path)).toThrow(RangeError);
  });

  test('拒否時は部分的な結果を返さない', () => {
    let result: string[] | undefined;
    try {
      result = splitBackupPath('attachments/../../etc/passwd');
    } catch {
      result = undefined;
    }
    expect(result).toBeUndefined();
  });
});
