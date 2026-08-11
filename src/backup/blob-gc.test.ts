import { describe, expect, test } from 'vitest';
import { sweepUnreferencedBlobs } from './blob-gc';
import { ATTACHMENT_DIR, SNAPSHOT_DIR, buildSnapshot } from './content-store';
import type { BackupAdapter, BackupPayload } from './types';

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const C = 'c'.repeat(64);

const NOW = Date.parse('2026-08-09T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

function fakeAdapter(files: Record<string, string>) {
  const store = new Map<string, Uint8Array<ArrayBuffer>>();
  for (const [path, text] of Object.entries(files)) {
    store.set(path, new TextEncoder().encode(text));
  }
  const removed: string[] = [];
  const adapter: BackupAdapter = {
    name: 'fake',
    isAvailable: async () => true,
    isReady: async () => true,
    ensurePermission: async () => true,
    configure: async () => {},
    async backup(_stream, path) {
      return { fileName: path };
    },
    async list(subdir) {
      const prefix = subdir === undefined ? '' : `${subdir}/`;
      return [...store.keys()]
        .filter((p) => p.startsWith(prefix) && !p.slice(prefix.length).includes('/'))
        .map((p) => p.slice(prefix.length));
    },
    async read(path) {
      return store.get(path) ?? null;
    },
    async remove(path) {
      store.delete(path);
      removed.push(path);
    },
  };
  return { adapter, removed };
}
// 引数の sha256 を参照するスナップショットを、その時刻の名前で置く。
function snapshotAt(exportedAt: string, sha256s: string[]): [string, string] {
  const payload: BackupPayload = { version: 1, exportedAt, tables: {} };
  const refs = sha256s.map((sha256, i) => ({ id: `att${i}`, sha256, bytes: 1 }));
  const name = `${exportedAt.slice(0, 10)}T${exportedAt.slice(11, 19).replace(/:/g, '')}Z.json`;
  return [`${SNAPSHOT_DIR}/${name}`, JSON.stringify(buildSnapshot(payload, refs))];
}

function blobs(...sha256s: string[]): Record<string, string> {
  return Object.fromEntries(sha256s.map((s) => [`${ATTACHMENT_DIR}/${s}`, 'x']));
}

describe('sweepUnreferencedBlobs', () => {
  test('参照されていない実体だけ消す', async () => {
    const { adapter, removed } = fakeAdapter({
      ...Object.fromEntries([snapshotAt('2026-08-09T12:00:00.000Z', [A])]),
      ...blobs(A, B),
    });

    expect(await sweepUnreferencedBlobs(adapter, 30, NOW)).toEqual([B]);
    expect(removed).toEqual([`${ATTACHMENT_DIR}/${B}`]);
  });
  // 既定は「消さない」。設定を触っていない利用者の写真が消えることは絶対に無い。
  test('0 日なら何も読まず何も消さない', async () => {
    const { adapter, removed } = fakeAdapter({
      ...Object.fromEntries([snapshotAt('2026-08-09T12:00:00.000Z', [])]),
      ...blobs(A),
    });

    expect(await sweepUnreferencedBlobs(adapter, 0, NOW)).toEqual([]);
    expect(removed).toEqual([]);
  });

  test('スナップショットが 1 つも無ければ何も消さない', async () => {
    const { adapter, removed } = fakeAdapter(blobs(A, B));

    expect(await sweepUnreferencedBlobs(adapter, 30, NOW)).toEqual([]);
    expect(removed).toEqual([]);
  });
  // 窓の外の版が参照していても、その版はもう復元には使われない。
  test('日数の窓より古い版だけが参照している実体は消す', async () => {
    const { adapter, removed } = fakeAdapter({
      ...Object.fromEntries([snapshotAt('2026-08-09T12:00:00.000Z', [A])]),
      ...Object.fromEntries([snapshotAt('2026-05-01T12:00:00.000Z', [A, B])]),
      ...blobs(A, B),
    });

    expect(await sweepUnreferencedBlobs(adapter, 30, NOW)).toEqual([B]);
    expect(removed).toEqual([`${ATTACHMENT_DIR}/${B}`]);
  });
  // 最新版の参照先を消すと、直近のバックアップが写真の欠けたものになる。
  test('最新版が窓の外でも、その参照先は消さない', async () => {
    const { adapter, removed } = fakeAdapter({
      ...Object.fromEntries([snapshotAt('2026-05-01T12:00:00.000Z', [A])]),
      ...blobs(A, B),
    });

    expect(await sweepUnreferencedBlobs(adapter, 30, NOW)).toEqual([B]);
    expect(removed).toEqual([`${ATTACHMENT_DIR}/${B}`]);
  });
  // 同期が途中・他端末の版がまだ届いていない、はどちらも普通に起きる。
  test('読めない版が 1 つでもあれば何も消さない', async () => {
    const { adapter, removed } = fakeAdapter({
      ...Object.fromEntries([snapshotAt('2026-08-09T12:00:00.000Z', [A])]),
      [`${SNAPSHOT_DIR}/2026-08-08T120000Z.json`]: '{ broken',
      ...blobs(A, B),
    });

    expect(await sweepUnreferencedBlobs(adapter, 30, NOW)).toEqual([]);
    expect(removed).toEqual([]);
  });

  test('窓の中の全ての版の参照を足し合わせる', async () => {
    const { adapter, removed } = fakeAdapter({
      ...Object.fromEntries([snapshotAt('2026-08-09T12:00:00.000Z', [A])]),
      ...Object.fromEntries([snapshotAt('2026-08-08T12:00:00.000Z', [B])]),
      ...blobs(A, B, C),
    });

    expect(await sweepUnreferencedBlobs(adapter, 30, NOW)).toEqual([C]);
    expect(removed).toEqual([`${ATTACHMENT_DIR}/${C}`]);
  });
  // 利用者が同じフォルダへ置いたものを掃除で巻き込まない。
  test('SHA-256 の名前でないファイルには手を出さない', async () => {
    const { adapter, removed } = fakeAdapter({
      ...Object.fromEntries([snapshotAt('2026-08-09T12:00:00.000Z', [])]),
      [`${ATTACHMENT_DIR}/memo.txt`]: 'x',
    });

    expect(await sweepUnreferencedBlobs(adapter, 30, NOW)).toEqual([]);
    expect(removed).toEqual([]);
  });

  test('境界ちょうどの版はまだ窓の中', async () => {
    const edge = new Date(NOW - 30 * DAY).toISOString();
    const { adapter, removed } = fakeAdapter({
      ...Object.fromEntries([snapshotAt('2026-08-09T12:00:00.000Z', [])]),
      ...Object.fromEntries([snapshotAt(edge, [A])]),
      ...blobs(A),
    });

    expect(await sweepUnreferencedBlobs(adapter, 30, NOW)).toEqual([]);
    expect(removed).toEqual([]);
  });
});
