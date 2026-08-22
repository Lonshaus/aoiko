import { describe, expect, test } from 'vitest';
import {
  ATTACHMENT_DIR,
  attachmentPath,
  snapshotTimeMs,
  snapshotsToScanForSweep,
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
  const A = 'a'.repeat(64);
  const B = 'b'.repeat(64);
  const C = 'c'.repeat(64);

  test('present にあり referenced に無いものを返す', () => {
    expect(unreferencedBlobs(new Set([A, B, C]), new Set([B]))).toEqual([A, C]);
  });

  test('全て参照されていれば空配列', () => {
    const present = new Set([A, B]);
    expect(unreferencedBlobs(present, present)).toEqual([]);
  });

  test('present が空なら空配列', () => {
    expect(unreferencedBlobs(new Set(), new Set([A]))).toEqual([]);
  });
  // 利用者が同じフォルダへ置いた無関係なファイルを掃除で巻き込まないため。
  test('SHA-256 の名前でないものは対象にしない', () => {
    expect(unreferencedBlobs(new Set([A, 'memo.txt', 'ZZZZ']), new Set())).toEqual([A]);
  });
});

describe('snapshotTimeMs', () => {
  test('ファイル名から時刻を取る（中身を読まない）', () => {
    expect(snapshotTimeMs('2026-08-09T120000Z.json')).toBe(Date.parse('2026-08-09T12:00:00Z'));
  });

  test('スナップショットの名前でなければ null', () => {
    expect(snapshotTimeMs('aoiko-ledger-2026-08-09.zip')).toBeNull();
    expect(snapshotTimeMs('2026-08-09T120000Z.txt')).toBeNull();
  });
});

describe('snapshotsToScanForSweep', () => {
  const now = Date.parse('2026-08-09T12:00:00Z');
  const DAY = 24 * 60 * 60 * 1000;
  const recent = '2026-08-08T120000Z.json';
  const old = '2026-05-01T120000Z.json';

  test('0 日（削除しない）は空配列', () => {
    expect(snapshotsToScanForSweep([recent, old], now, 0)).toEqual([]);
  });

  test('スナップショットが無ければ空配列', () => {
    expect(snapshotsToScanForSweep([], now, 30)).toEqual([]);
  });

  test('日数の窓に入る版だけ読む', () => {
    expect(snapshotsToScanForSweep([recent, old], now, 30)).toEqual([recent]);
  });
  // 最新版の参照先を消すと、直近のバックアップが写真の欠けたものになる。
  test('最新版は窓の外でも必ず含める', () => {
    expect(snapshotsToScanForSweep([old], now, 30)).toEqual([old]);
  });

  test('境界ちょうどは窓の中', () => {
    const edge =
      new Date(now - 30 * DAY)
        .toISOString()
        .replace(/(\d{2}):(\d{2}):(\d{2})\.\d{3}Z$/, '$1$2$3Z') + '.json';
    expect(snapshotsToScanForSweep([recent, edge], now, 30)).toContain(edge);
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
