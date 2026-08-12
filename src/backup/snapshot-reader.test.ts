import { beforeAll, describe, expect, test } from 'vitest';
import { sha256Hex } from '../lib/sha256';
import { ATTACHMENT_DIR, SNAPSHOT_DIR, buildSnapshot } from './content-store';
import { readLatestSnapshot } from './snapshot-reader';
import { writeLooseBackup, type AttachmentSource } from './snapshot-writer';
import type { BackupAdapter, BackupPayload } from './types';
// 実際の保存先の代わり。read の回数も見たいので数える。
// hangPaths に載せたパスは iCloud の dataless ファイルを模して永久に解決しない Promise を返す。
function fakeAdapter() {
  const files = new Map<string, Uint8Array<ArrayBuffer>>();
  const reads: string[] = [];
  const hangPaths = new Set<string>();
  const adapter: BackupAdapter = {
    name: 'fake',
    isAvailable: async () => true,
    isReady: async () => true,
    ensurePermission: async () => true,
    configure: async () => {},
    async backup(stream, path) {
      const parts: Uint8Array<ArrayBuffer>[] = [];
      for await (const chunk of stream as unknown as AsyncIterable<Uint8Array<ArrayBuffer>>) {
        parts.push(chunk);
      }
      const joined = new Uint8Array(parts.reduce((n, p) => n + p.byteLength, 0));
      let offset = 0;
      for (const part of parts) {
        joined.set(part, offset);
        offset += part.byteLength;
      }
      files.set(path, joined);
      return { fileName: path };
    },
    async list(subdir) {
      const prefix = subdir === undefined ? '' : `${subdir}/`;
      return [...files.keys()]
        .filter((p) => p.startsWith(prefix) && !p.slice(prefix.length).includes('/'))
        .map((p) => p.slice(prefix.length));
    },
    read(path) {
      reads.push(path);
      if (hangPaths.has(path)) {
        return new Promise(() => {});
      }
      return Promise.resolve(files.get(path) ?? null);
    },
    async remove(path) {
      files.delete(path);
    },
  };
  return { adapter, files, reads, hangPaths };
}

function putText(files: Map<string, Uint8Array<ArrayBuffer>>, path: string, text: string): void {
  files.set(path, new TextEncoder().encode(text));
}

function putSnapshot(
  files: Map<string, Uint8Array<ArrayBuffer>>,
  exportedAt: string,
  attachments: { id: string; sha256: string; bytes: number }[],
): string {
  const name = `${exportedAt.slice(0, 10)}T${exportedAt.slice(11, 19).replace(/:/g, '')}Z.json`;
  const payload: BackupPayload = {
    version: 1,
    exportedAt,
    tables: { journalEntries: [{ id: 'e1' }] },
  };
  putText(files, `${SNAPSHOT_DIR}/${name}`, JSON.stringify(buildSnapshot(payload, attachments)));
  return name;
}

const RED = new Uint8Array([1, 2, 3]);
const BLUE = new Uint8Array([4, 5, 6, 7]);
let redSha = '';
let blueSha = '';

beforeAll(async () => {
  redSha = await sha256Hex(RED);
  blueSha = await sha256Hex(BLUE);
});

describe('readLatestSnapshot', () => {
  test('スナップショットが無ければ null', async () => {
    const { adapter } = fakeAdapter();
    expect(await readLatestSnapshot(adapter)).toBeNull();
  });

  test('一番新しい版を読み、証憑は id → 実体で返す', async () => {
    const { adapter, files } = fakeAdapter();
    files.set(`${ATTACHMENT_DIR}/${redSha}`, RED);
    putSnapshot(files, '2026-08-08T12:00:00.000Z', []);
    const newest = putSnapshot(files, '2026-08-09T12:00:00.000Z', [
      { id: 'att1', sha256: redSha, bytes: 3 },
    ]);

    const found = await readLatestSnapshot(adapter);

    expect(found?.snapshotName).toBe(newest);
    expect(found?.payload.version).toBe(1);
    expect(found?.payload.exportedAt).toBe('2026-08-09T12:00:00.000Z');
    expect(found?.payload.tables).toEqual({ journalEntries: [{ id: 'e1' }] });
    expect([...(found?.attachmentBlobs.keys() ?? [])]).toEqual(['att1']);
    expect(new Uint8Array(await found!.attachmentBlobs.get('att1')!.arrayBuffer())).toEqual(RED);
  });

  test('同じ写真を指す参照が複数あっても、実体を読むのは 1 回', async () => {
    const { adapter, files, reads } = fakeAdapter();
    files.set(`${ATTACHMENT_DIR}/${redSha}`, RED);
    putSnapshot(files, '2026-08-09T12:00:00.000Z', [
      { id: 'att1', sha256: redSha, bytes: 3 },
      { id: 'att2', sha256: redSha, bytes: 3 },
    ]);

    const found = await readLatestSnapshot(adapter);

    expect([...(found?.attachmentBlobs.keys() ?? [])]).toEqual(['att1', 'att2']);
    expect(reads.filter((p) => p === `${ATTACHMENT_DIR}/${redSha}`)).toHaveLength(1);
  });
  // 同期ツールがスナップショットを blob より先に運んでくると起きる。
  test('参照先が欠けている版は飛ばして、1 つ前の揃っている版を使う', async () => {
    const { adapter, files } = fakeAdapter();
    files.set(`${ATTACHMENT_DIR}/${redSha}`, RED);
    const older = putSnapshot(files, '2026-08-08T12:00:00.000Z', [
      { id: 'att1', sha256: redSha, bytes: 3 },
    ]);
    putSnapshot(files, '2026-08-09T12:00:00.000Z', [
      { id: 'att1', sha256: redSha, bytes: 3 },
      { id: 'att2', sha256: blueSha, bytes: 4 },
    ]);

    const found = await readLatestSnapshot(adapter);

    expect(found?.snapshotName).toBe(older);
    expect(found?.skippedSnapshots).toBe(1);
  });

  test('壊れた JSON の版も飛ばす', async () => {
    const { adapter, files } = fakeAdapter();
    const older = putSnapshot(files, '2026-08-08T12:00:00.000Z', []);
    putText(files, `${SNAPSHOT_DIR}/2026-08-09T120000Z.json`, '{ broken');

    const found = await readLatestSnapshot(adapter);

    expect(found?.snapshotName).toBe(older);
    expect(found?.skippedSnapshots).toBe(1);
  });

  test('使える版が 1 つも無ければ null', async () => {
    const { adapter, files } = fakeAdapter();
    putSnapshot(files, '2026-08-09T12:00:00.000Z', [{ id: 'att1', sha256: redSha, bytes: 3 }]);
    expect(await readLatestSnapshot(adapter)).toBeNull();
  });
  // 中身が名前の SHA-256 と合わない＝同期が途中で切れた半端なファイル。内容定址の効き目。
  test('名前と中身が合わない写真は捨て、帳簿は復元できる形で返す', async () => {
    const { adapter, files } = fakeAdapter();
    files.set(`${ATTACHMENT_DIR}/${redSha}`, BLUE);
    putSnapshot(files, '2026-08-09T12:00:00.000Z', [{ id: 'att1', sha256: redSha, bytes: 3 }]);

    const found = await readLatestSnapshot(adapter);

    expect(found?.corruptAttachmentCount).toBe(1);
    expect(found?.attachmentBlobs.size).toBe(0);
    expect(found?.payload.tables).toEqual({ journalEntries: [{ id: 'e1' }] });
  });
  // iCloud Drive の dataless ファイルはオフラインで読むと例外も errno も返らず止まる（実測）。
  test('実体の読みが時限切れなら notDownloadedCount に数え、corruptAttachmentCount には数えない', async () => {
    const { adapter, files, hangPaths } = fakeAdapter();
    files.set(`${ATTACHMENT_DIR}/${redSha}`, RED);
    hangPaths.add(`${ATTACHMENT_DIR}/${redSha}`);
    putSnapshot(files, '2026-08-09T12:00:00.000Z', [{ id: 'att1', sha256: redSha, bytes: 3 }]);

    const found = await readLatestSnapshot(adapter, { readDeadlineMs: 20 });

    expect(found?.notDownloadedCount).toBe(1);
    expect(found?.corruptAttachmentCount).toBe(0);
    expect(found?.attachmentBlobs.size).toBe(0);
    expect(found?.payload.tables).toEqual({ journalEntries: [{ id: 'e1' }] });
  });

  test('スナップショット本体の読みが時限切れなら飛ばして、1 つ前の版を使う', async () => {
    const { adapter, files, hangPaths } = fakeAdapter();
    const older = putSnapshot(files, '2026-08-08T12:00:00.000Z', []);
    const newest = putSnapshot(files, '2026-08-09T12:00:00.000Z', []);
    hangPaths.add(`${SNAPSHOT_DIR}/${newest}`);

    const found = await readLatestSnapshot(adapter, { readDeadlineMs: 20 });

    expect(found?.snapshotName).toBe(older);
    expect(found?.skippedSnapshots).toBe(1);
  });

  test('onProgress は単調に進み、最後は (total, total)', async () => {
    const { adapter, files } = fakeAdapter();
    files.set(`${ATTACHMENT_DIR}/${redSha}`, RED);
    files.set(`${ATTACHMENT_DIR}/${blueSha}`, BLUE);
    putSnapshot(files, '2026-08-09T12:00:00.000Z', [
      { id: 'att1', sha256: redSha, bytes: 3 },
      { id: 'att2', sha256: blueSha, bytes: 4 },
    ]);
    const calls: [number, number][] = [];

    await readLatestSnapshot(adapter, { onProgress: (done, total) => calls.push([done, total]) });

    expect(calls.length).toBeGreaterThanOrEqual(1);
    expect(calls.every(([, total]) => total === 2)).toBe(true);
    expect(calls.map(([done]) => done)).toEqual(
      [...calls.map(([done]) => done)].sort((a, b) => a - b),
    );
    expect(calls.at(-1)).toEqual([2, 2]);
  });

  test('時限切れの sha256 を 2 つの証憑 id が参照していても、実体読みは 1 回だけ', async () => {
    const { adapter, files, hangPaths, reads } = fakeAdapter();
    files.set(`${ATTACHMENT_DIR}/${redSha}`, RED);
    hangPaths.add(`${ATTACHMENT_DIR}/${redSha}`);
    putSnapshot(files, '2026-08-09T12:00:00.000Z', [
      { id: 'att1', sha256: redSha, bytes: 3 },
      { id: 'att2', sha256: redSha, bytes: 3 },
    ]);

    const found = await readLatestSnapshot(adapter, { readDeadlineMs: 20 });

    expect(found?.notDownloadedCount).toBe(2);
    expect(reads.filter((p) => p === `${ATTACHMENT_DIR}/${redSha}`)).toHaveLength(1);
  });
});
// S6 の要。書いたものが読み戻せなければ、バックアップは無いのと同じ。
describe('writeLooseBackup → readLatestSnapshot', () => {
  test('書き出した帳簿と写真がそのまま戻る', async () => {
    const { adapter } = fakeAdapter();
    const payload: BackupPayload = {
      version: 1,
      exportedAt: '2026-08-09T12:00:00.000Z',
      tables: { journalEntries: [{ id: 'e1', date: '2026-08-09' }], vendors: [] },
    };
    async function* sources(): AsyncGenerator<AttachmentSource> {
      yield { id: 'att1', sha256: redSha, bytes: RED.byteLength, data: RED };
      yield { id: 'att2', sha256: blueSha, bytes: BLUE.byteLength, data: BLUE };
      yield { id: 'att3', sha256: redSha, bytes: RED.byteLength, data: RED };
    }
    await writeLooseBackup(adapter, payload, sources());

    const found = await readLatestSnapshot(adapter);

    expect(found?.payload).toEqual(payload);
    expect(found?.corruptAttachmentCount).toBe(0);
    expect(new Uint8Array(await found!.attachmentBlobs.get('att1')!.arrayBuffer())).toEqual(RED);
    expect(new Uint8Array(await found!.attachmentBlobs.get('att2')!.arrayBuffer())).toEqual(BLUE);
    expect(new Uint8Array(await found!.attachmentBlobs.get('att3')!.arrayBuffer())).toEqual(RED);
  });
});
