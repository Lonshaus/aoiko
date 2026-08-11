import { describe, expect, test } from 'vitest';
import { ATTACHMENT_DIR, SNAPSHOT_DIR } from './content-store';
import { pruneSnapshots, writeLooseBackup, type AttachmentSource } from './snapshot-writer';
import type { BackupAdapter, BackupPayload } from './types';
// 実際の保存先の代わり。書かれた順序も見たいので、書き込みの履歴を残す。
function fakeAdapter(initial: Record<string, string[]> = {}) {
  const files = new Map<string, Uint8Array>();
  const writeOrder: string[] = [];
  const removed: string[] = [];
  for (const [dir, names] of Object.entries(initial)) {
    for (const name of names) {
      files.set(`${dir}/${name}`, new Uint8Array());
    }
  }
  const adapter: BackupAdapter = {
    name: 'fake',
    isAvailable: async () => true,
    isReady: async () => true,
    ensurePermission: async () => true,
    configure: async () => {},
    async backup(stream, path) {
      const parts: Uint8Array[] = [];
      for await (const chunk of stream as unknown as AsyncIterable<Uint8Array>) {
        parts.push(chunk);
      }
      const joined = new Uint8Array(parts.reduce((n, p) => n + p.byteLength, 0));
      let offset = 0;
      for (const part of parts) {
        joined.set(part, offset);
        offset += part.byteLength;
      }
      files.set(path, joined);
      writeOrder.push(path);
      return { fileName: path };
    },
    async list(subdir) {
      const prefix = subdir === undefined ? '' : `${subdir}/`;
      return [...files.keys()]
        .filter((p) => p.startsWith(prefix) && !p.slice(prefix.length).includes('/'))
        .map((p) => p.slice(prefix.length));
    },
    async read(path) {
      return files.get(path) ?? null;
    },
    async remove(path) {
      files.delete(path);
      removed.push(path);
    },
  };
  return { adapter, files, writeOrder, removed };
}

const payload: BackupPayload = {
  version: 1,
  exportedAt: '2026-08-09T12:00:00.000Z',
  tables: { journalEntries: [{ id: 'e1' }] },
};

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);

async function* sources(...items: AttachmentSource[]): AsyncGenerator<AttachmentSource> {
  for (const item of items) {
    yield item;
  }
}

function att(id: string, sha256: string, byte: number): AttachmentSource {
  return { id, sha256, bytes: 3, data: new Uint8Array([byte, byte, byte]) };
}

function readJson(files: Map<string, Uint8Array>, path: string): Record<string, unknown> {
  const bytes = files.get(path);
  if (bytes === undefined) {
    throw new Error(`not written: ${path}`);
  }
  return JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
}

describe('writeLooseBackup', () => {
  test('blob を SHA-256 の名前で置き、スナップショットを最後に書く', async () => {
    const { adapter, files, writeOrder } = fakeAdapter();
    const r = await writeLooseBackup(adapter, payload, sources(att('att1', A, 1)));

    expect(r.snapshotPath).toBe(`${SNAPSHOT_DIR}/2026-08-09T120000Z.json`);
    expect(files.has(`${ATTACHMENT_DIR}/${A}`)).toBe(true);
    // 順序に意味がある。スナップショットが先に同期されると参照先が無い状態になる。
    expect(writeOrder).toEqual([`${ATTACHMENT_DIR}/${A}`, r.snapshotPath]);
  });

  test('スナップショットは参照した blob を全部並べる', async () => {
    const { adapter, files } = fakeAdapter();
    const r = await writeLooseBackup(
      adapter,
      payload,
      sources(att('att1', A, 1), att('att2', B, 2)),
    );
    const snapshot = readJson(files, r.snapshotPath);

    expect(snapshot.format).toBe(1);
    expect(snapshot.payloadVersion).toBe(payload.version);
    expect(snapshot.exportedAt).toBe(payload.exportedAt);
    expect(snapshot.tables).toEqual(payload.tables);
    expect(snapshot.attachments).toEqual([
      { id: 'att1', sha256: A, bytes: 3 },
      { id: 'att2', sha256: B, bytes: 3 },
    ]);
  });
  // 変わった分だけ書くのが zip をやめる理由そのもの。
  test('保存先に既にある blob は書き直さない', async () => {
    const { adapter, writeOrder } = fakeAdapter({ [ATTACHMENT_DIR]: [A] });
    const r = await writeLooseBackup(
      adapter,
      payload,
      sources(att('att1', A, 1), att('att2', B, 2)),
    );

    expect(r.blobsWritten).toBe(1);
    expect(r.blobsSkipped).toBe(1);
    expect(writeOrder).toEqual([`${ATTACHMENT_DIR}/${B}`, r.snapshotPath]);
  });

  test('同じ写真を複数の仕訳へ貼っても実体は 1 つ、参照は人数分', async () => {
    const { adapter, writeOrder, files } = fakeAdapter();
    const r = await writeLooseBackup(
      adapter,
      payload,
      sources(att('att1', A, 1), att('att2', A, 1)),
    );

    expect(r.blobsWritten).toBe(1);
    expect(r.blobsSkipped).toBe(1);
    expect(writeOrder.filter((p) => p.startsWith(ATTACHMENT_DIR))).toEqual([
      `${ATTACHMENT_DIR}/${A}`,
    ]);
    expect(readJson(files, r.snapshotPath).attachments).toEqual([
      { id: 'att1', sha256: A, bytes: 3 },
      { id: 'att2', sha256: A, bytes: 3 },
    ]);
  });

  test('証憑が 1 枚も無くてもスナップショットは書かれる', async () => {
    const { adapter, files, writeOrder } = fakeAdapter();
    const r = await writeLooseBackup(adapter, payload, sources());

    expect(writeOrder).toEqual([r.snapshotPath]);
    expect(readJson(files, r.snapshotPath).attachments).toEqual([]);
  });
  // 保存先がまだ空（同期が始まっていない・初回）でも list が例外にならないこと。
  test('attachments フォルダがまだ無くても書ける', async () => {
    const { adapter, files } = fakeAdapter();
    await writeLooseBackup(adapter, payload, sources(att('att1', A, 1)));
    expect(files.has(`${ATTACHMENT_DIR}/${A}`)).toBe(true);
  });

  test('壊れた SHA-256 は保存先の外を指す前に弾く', async () => {
    const { adapter, files } = fakeAdapter();
    await expect(
      writeLooseBackup(adapter, payload, sources(att('att1', '../../etc/passwd', 1))),
    ).rejects.toThrow(RangeError);
    // 弾いたならスナップショットも書かれていない（参照先の無い版を残さない）。
    expect([...files.keys()]).toEqual([]);
  });
});

describe('pruneSnapshots', () => {
  test('新しい方から数えて残す数を超えた分だけ消す', async () => {
    const { adapter, removed } = fakeAdapter({
      [SNAPSHOT_DIR]: [
        '2026-08-07T120000Z.json',
        '2026-08-09T120000Z.json',
        '2026-08-08T120000Z.json',
      ],
    });
    const expired = await pruneSnapshots(adapter, 2);

    expect(expired).toEqual(['2026-08-07T120000Z.json']);
    expect(removed).toEqual([`${SNAPSHOT_DIR}/2026-08-07T120000Z.json`]);
  });

  test('0 なら何も消さない（無制限）', async () => {
    const { adapter, removed } = fakeAdapter({
      [SNAPSHOT_DIR]: ['2026-08-07T120000Z.json', '2026-08-09T120000Z.json'],
    });
    expect(await pruneSnapshots(adapter, 0)).toEqual([]);
    expect(removed).toEqual([]);
  });
  // blob は内容定址で、消したスナップショット以外も参照しうる。ここでは触らない。
  test('blob には触らない', async () => {
    const { adapter, removed } = fakeAdapter({
      [SNAPSHOT_DIR]: ['2026-08-07T120000Z.json', '2026-08-09T120000Z.json'],
      [ATTACHMENT_DIR]: [A],
    });
    await pruneSnapshots(adapter, 1);
    expect(removed.every((p) => p.startsWith(SNAPSHOT_DIR))).toBe(true);
  });
});
