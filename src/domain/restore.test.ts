import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { Blob as NodeBlob } from 'node:buffer';
import { isDeepStrictEqual } from 'node:util';
import { db } from '../db/db';
import { buildBackupZipStream, buildPayload, PAYLOAD_VERSION } from '../backup';
import { newId } from '../lib/id';
import { toIndexable } from '../lib/decimal';
import {
  BackupTooLargeError,
  IncompatibleBackupError,
  isBackupTooLarge,
  parseBackupFile,
  parseBackupJson,
  restoreFromJson,
  restoreFromPayload,
} from './restore';
import { MAX_BACKUP_BYTES } from '../lib/file-limit';
import { setSetting, type SettingsMap } from '../lib/settings';
import { decideNativeState } from '../backup/native';
import { SKIP_SETTING_KEYS } from '../backup/skip-lists';
import type { BackupPayload } from '../backup';
import type { Setting } from '../db/types';
import type { Stamp } from './stamps';
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
  test('不正な JSON は例外を投げる', () => {
    expect(() => parseBackupJson('{ not json')).toThrow(/JSON として/);
  });

  test('必須項目が無ければ例外を投げる', () => {
    expect(() => parseBackupJson('{"foo":"bar"}')).toThrow(/バックアップ形式ではありません/);
  });

  test('正しければオブジェクトを返す', () => {
    const json = JSON.stringify({ version: 1, tables: {}, exportedAt: 'x' });
    expect(parseBackupJson(json).version).toBe(1);
  });
});

describe('restoreFromJson', () => {
  test('互換性のないバージョンは例外を投げる', async () => {
    await expect(
      restoreFromJson({ version: 999, exportedAt: '2026-05-10', tables: {} }),
    ).rejects.toThrow(IncompatibleBackupError);
  });

  test('往復：書き出し → 復元で同じ状態になる', async () => {
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

  test('不正な payload では既存データを消さずに例外を投げる（検証は削除前）', async () => {
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
    // structured clone 不可で bulkPut が例外を投げる。全消去後の書き込み失敗を再現する。
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

  test('復元の前に既存データを消す', async () => {
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

  test('申告者情報がバックアップに無ければこの端末の値を保持する', async () => {
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
  // 退避する申告者情報も書き込みと同じトランザクションの中で読む。外で先に読むと、
  // 復元の間に書き直した値が、読んでおいた古い値で上書きされる。
  test('申告者情報を含まないバックアップの復元中に書き直した値は失われない', async () => {
    const lost: number[] = [];
    for (let ticks = 0; ticks < 60; ticks++) {
      await db.settings.clear();
      await setSetting('userFilerName', '青井 太郎');
      const edited = `青井 花子 ${ticks}`;
      const restoring = restoreFromJson({
        version: PAYLOAD_VERSION,
        exportedAt: '2026-05-10',
        tables: { vendors: [{ id: 'v1', name: '業者' }] },
      });
      for (let i = 0; i < ticks; i++) {
        await new Promise((r) => setImmediate(r));
      }
      await Promise.all([restoring, setSetting('userFilerName', edited)]);
      if ((await db.settings.get('userFilerName'))?.value !== edited) {
        lost.push(ticks);
      }
    }
    expect(lost).toEqual([]);
  });
});
// 復元は全テーブルを clear してから書き戻す。スタンプ帳とバッジはバックアップに
// 入っていないので、素通りさせると「復元しただけで消える」ことになる。
describe('支援の記録は復元で消えない', () => {
  test('スタンプ帳は復元後も残る', async () => {
    await db.stamps.put({
      id: 's1',
      shape: 'yarn',
      color: 'orange',
      at: '2026-08-18',
      createdAt: 1,
    });
    await restoreFromJson({ version: PAYLOAD_VERSION, exportedAt: '2026-08-18', tables: {} });
    expect(await db.stamps.count()).toBe(1);
  });

  test('支援者バッジは復元後も残る', async () => {
    await db.settings.put({ key: 'supporterBadgeAt', value: '2026-08-18', updatedAt: Date.now() });
    await restoreFromJson({ version: PAYLOAD_VERSION, exportedAt: '2026-08-18', tables: {} });
    expect((await db.settings.get('supporterBadgeAt'))?.value).toBe('2026-08-18');
  });
});
// 通知の許可は端末ごと。バックアップで運ぶと、許可していない端末でオンの表示になる。
describe('解析完了の通知設定は復元で持ち込まれず、消えもしない', () => {
  const put = (value: boolean) =>
    db.settings.put({ key: 'analysisNotifyEnabled', value, updatedAt: Date.now() });
  const backupWith = (value: boolean) => ({
    version: PAYLOAD_VERSION,
    exportedAt: '2026-10-22',
    tables: { settings: [{ key: 'analysisNotifyEnabled', value, updatedAt: 1 }] },
  });

  test('バックアップが true でも、この端末が false ならオンにならない', async () => {
    await put(false);
    await restoreFromJson(backupWith(true));
    expect((await db.settings.get('analysisNotifyEnabled'))?.value).toBe(false);
  });

  test('バックアップが true でも、この端末に値が無ければ行を作らない', async () => {
    await restoreFromJson(backupWith(true));
    expect(await db.settings.get('analysisNotifyEnabled')).toBeUndefined();
  });

  test('この端末が true なら、キーを含まないバックアップを復元しても残る', async () => {
    await put(true);
    await restoreFromJson({ version: PAYLOAD_VERSION, exportedAt: '2026-10-22', tables: {} });
    expect((await db.settings.get('analysisNotifyEnabled'))?.value).toBe(true);
  });

  test('この端末が true なら、バックアップが false でも true のまま', async () => {
    await put(true);
    await restoreFromJson(backupWith(false));
    expect((await db.settings.get('analysisNotifyEnabled'))?.value).toBe(true);
  });

  test('同じ settings の他のキーは通常どおり復元される', async () => {
    await restoreFromJson({
      version: PAYLOAD_VERSION,
      exportedAt: '2026-10-22',
      tables: {
        settings: [
          { key: 'analysisNotifyEnabled', value: true, updatedAt: 1 },
          { key: 'userBusinessName', value: '青井商店', updatedAt: 1 },
        ],
      },
    });
    expect((await db.settings.get('userBusinessName'))?.value).toBe('青井商店');
  });
});

function backupOf(tables: Record<string, unknown[]>): BackupPayload {
  return { version: PAYLOAD_VERSION, exportedAt: '2026-10-23T00:00:00.000Z', tables };
}

function settingRow(key: string, value: unknown, updatedAt = 1): Setting {
  return { key, value, updatedAt };
}
// 端末の値とバックアップの値。両者が違うことで「端末の値が残った」と区別できるようにする。
const SKIP_VALUES = {
  backupFolderHandle: [
    { name: 'device-folder', kind: 'directory' },
    { name: 'forged', kind: 'directory' },
  ],
  nativeBackupFolder: [
    { token: 'device-token', name: 'aoiko' },
    { token: '/Users/someone-else/Dropbox', name: 'forged' },
  ],
  supporterBadgeAt: ['2026-08-18', '2026-10-01'],
  analysisNotifyEnabled: [false, true],
  lastBackupAt: [1_000, Date.now()],
  lastDownloadAt: [2_000, Date.now()],
  lastBlobSweepAt: [3_000, Date.now()],
  backupRetentionCount: [0, 7],
  blobRetentionDays: [0, 30],
} satisfies Partial<Record<keyof SettingsMap, [unknown, unknown]>>;
const SKIP_CASES = Object.entries(SKIP_VALUES) as [string, [unknown, unknown]][];

describe('SKIP_SETTING_KEYS は復元で端末の値のまま（追加・変更・削除されない）', () => {
  test('試験用の値は SKIP_SETTING_KEYS の全キーを覆う', () => {
    expect(SKIP_CASES.map(([k]) => k).sort()).toEqual([...SKIP_SETTING_KEYS].sort());
  });

  test.each(SKIP_CASES)('%s：(a) 端末とバックアップで値が違えば端末の値', async (key, values) => {
    const device = settingRow(key, values[0], 111);
    await db.settings.put(device);
    await restoreFromJson(backupOf({ settings: [settingRow(key, values[1], 222)] }));
    expect(await db.settings.get(key)).toEqual(device);
  });

  test.each(SKIP_CASES)(
    '%s：(b) 端末に無ければバックアップにあっても無いまま',
    async (key, values) => {
      await restoreFromJson(backupOf({ settings: [settingRow(key, values[1], 222)] }));
      expect(await db.settings.get(key)).toBeUndefined();
    },
  );

  test.each(SKIP_CASES)('%s：(c) バックアップに無くても端末の値は残る', async (key, values) => {
    const device = settingRow(key, values[0], 111);
    await db.settings.put(device);
    await restoreFromJson(backupOf({ settings: [settingRow('userBusinessName', '青井商店')] }));
    expect(await db.settings.get(key)).toEqual(device);
    expect((await db.settings.get('userBusinessName'))?.value).toBe('青井商店');
  });

  test.each(SKIP_CASES)(
    '%s：同じキーが 2 行あっても端末の状態は変わらない',
    async (key, values) => {
      const device = settingRow(key, values[0], 111);
      await db.settings.put(device);
      const dup = backupOf({
        settings: [settingRow(key, values[1], 222), settingRow(key, 'second', 333)],
      });
      await restoreFromJson(dup);
      expect(await db.settings.get(key)).toEqual(device);

      await db.settings.delete(key);
      await restoreFromJson(dup);
      expect(await db.settings.get(key)).toBeUndefined();
    },
  );
  // 一度もダウンロードしていない端末で「端末外バックアップがありません」の警告が消えないこと。
  test('ダウンロードしたことの無い端末は、最近の lastDownloadAt を持つバックアップを復元しても未記録のまま', async () => {
    await restoreFromJson(
      backupOf({ settings: [settingRow('lastDownloadAt', Date.now(), Date.now())] }),
    );
    expect(await db.settings.get('lastDownloadAt')).toBeUndefined();
  });
});
// 復元のあとは、外部送信の前に必ずもう一度確認する。バックアップで確認の省略を持ち込ませない。
describe('skipExternalSendConfirm は復元のたびに消える', () => {
  const KEY = 'skipExternalSendConfirm';
  const cases: [string, unknown, unknown[]][] = [
    ['端末 true・バックアップ true', true, [true]],
    ['端末 false・バックアップ true', false, [true]],
    ['端末に無し・バックアップ true', undefined, [true]],
    ['端末 true・バックアップ false', true, [false]],
    ['端末 true・バックアップに無し', true, []],
    ['端末に無し・バックアップに無し', undefined, []],
    ['端末 true・バックアップに重複（false・true）', true, [false, true]],
    ['端末に無し・バックアップに重複（true・true）', undefined, [true, true]],
  ];

  test.each(cases)('%s → 無し', async (_label, device, backupValues) => {
    if (device !== undefined) {
      await db.settings.put(settingRow(KEY, device));
    }
    await restoreFromJson(
      backupOf({
        settings: [
          ...backupValues.map((v, i) => settingRow(KEY, v, i + 1)),
          settingRow('userBusinessName', '青井商店'),
        ],
      }),
    );
    expect(await db.settings.get(KEY)).toBeUndefined();
    expect((await db.settings.get('userBusinessName'))?.value).toBe('青井商店');
  });
});

describe('stamps は復元で端末の記録のまま', () => {
  const deviceStamps: Stamp[] = [
    { id: 'd1', shape: 'yarn', color: 'orange', at: '2026-08-18', createdAt: 1 },
    { id: 'd2', shape: 'bell', color: 'blue', at: '2026-08-19', createdAt: 2 },
  ];
  const backupStamps = [
    { id: 'b1', shape: 'bell', color: 'blue', at: '2026-09-01', createdAt: 3 },
    { id: 'd1', shape: 'bell', color: 'blue', at: '2026-09-02', createdAt: 4 },
  ];

  test('端末に 0 件なら、バックアップにあっても 0 件', async () => {
    await restoreFromJson(backupOf({ stamps: backupStamps }));
    expect(await db.stamps.count()).toBe(0);
  });

  test('端末にあれば、バックアップの別のスタンプが混ざらず端末の分だけ', async () => {
    await db.stamps.bulkPut(deviceStamps);
    await restoreFromJson(backupOf({ stamps: backupStamps }));
    expect(await db.stamps.orderBy('id').toArray()).toEqual(deviceStamps);
  });

  test('id の無い行があっても復元はエラーにならず、端末の分が残る', async () => {
    await db.stamps.bulkPut(deviceStamps);
    await expect(
      restoreFromJson(
        backupOf({ stamps: [{ shape: 'bell' }], vendors: [{ id: 'v1', name: '業者' }] }),
      ),
    ).resolves.toBeDefined();
    expect(await db.stamps.orderBy('id').toArray()).toEqual(deviceStamps);
    expect(await db.vendors.count()).toBe(1);
  });
});
// 復元のあともバックアップ先は設定されたまま。偽の行で別のフォルダへ向けられないこと。
describe('バックアップ先の設定は復元の前後で同じ', () => {
  const nativeFolder = { token: 'device-token', name: 'aoiko' };
  const legacyHandle = { name: 'legacy', kind: 'directory' };
  const forged = backupOf({
    settings: [
      settingRow('nativeBackupFolder', { token: '/Users/someone-else', name: 'forged' }, 9),
      settingRow('nativeBackupFolder', null, 10),
      settingRow('backupFolderHandle', { name: 'forged', kind: 'directory' }, 11),
    ],
  });
  const devices: [string, Setting[]][] = [
    [
      '両方あり',
      [
        settingRow('nativeBackupFolder', nativeFolder),
        settingRow('backupFolderHandle', legacyHandle),
      ],
    ],
    ['ネイティブの保存先だけ', [settingRow('nativeBackupFolder', nativeFolder)]],
    ['FSA 時代の handle だけ', [settingRow('backupFolderHandle', legacyHandle)]],
    ['どちらも無し', []],
  ];
  // backup.svelte.ts の initNative と同じ読み方で状態を決める。
  async function nativeState(): Promise<string> {
    const folder = (await db.settings.get('nativeBackupFolder'))?.value;
    const legacy = folder ? null : ((await db.settings.get('backupFolderHandle'))?.value ?? null);
    return decideNativeState({
      hasFolder: folder !== null && folder !== undefined,
      hasLegacyHandle: legacy !== null,
      ready: true,
    });
  }

  async function folderRows(): Promise<(Setting | undefined)[]> {
    return db.settings.bulkGet(['nativeBackupFolder', 'backupFolderHandle']);
  }

  test.each(devices)('%s', async (_label, rows) => {
    await db.settings.bulkPut(rows);
    const before = await folderRows();
    const stateBefore = await nativeState();

    await restoreFromJson(forged);
    expect(await folderRows()).toEqual(before);
    expect(await nativeState()).toBe(stateBefore);

    await restoreFromJson(backupOf({}));
    expect(await folderRows()).toEqual(before);
    expect(await nativeState()).toBe(stateBefore);
  });
  // 端末の行は書き込みと同じトランザクションの中で読む。外で先に読むと、復元の開始と
  // 同じ瞬間に選び直した保存先が、古い値で上書きされる。
  test('復元の開始と同じ tick に書いた保存先は失われない', async () => {
    await setSetting('nativeBackupFolder', nativeFolder);
    const chosen = { token: 'chosen-now', name: 'new-folder' };
    const restoring = restoreFromJson(forged);
    const choosing = setSetting('nativeBackupFolder', chosen);
    await Promise.all([restoring, choosing]);
    expect((await db.settings.get('nativeBackupFolder'))?.value).toEqual(chosen);
  });
  // 書き込みが復元のどの段階に重なっても、最後に書いた保存先が残る。
  test('復元の途中のどの時点で書いた保存先も失われない', async () => {
    const lost: number[] = [];
    for (let ticks = 0; ticks < 60; ticks++) {
      await db.settings.clear();
      await setSetting('nativeBackupFolder', nativeFolder);
      const chosen = { token: `chosen-${ticks}`, name: 'new-folder' };
      const restoring = restoreFromJson(forged);
      for (let i = 0; i < ticks; i++) {
        await new Promise((r) => setImmediate(r));
      }
      await Promise.all([restoring, setSetting('nativeBackupFolder', chosen)]);
      if (!isDeepStrictEqual((await db.settings.get('nativeBackupFolder'))?.value, chosen)) {
        lost.push(ticks);
      }
    }
    expect(lost).toEqual([]);
  });
});

describe('restoreFromPayload は渡された payload を書き換えない', () => {
  test('settings・stamps・attachments を含む payload が復元の前後で同じ', async () => {
    const payload = backupOf({
      settings: [
        settingRow('userBusinessName', '青井商店'),
        settingRow('skipExternalSendConfirm', true),
        settingRow('skipExternalSendConfirm', false, 2),
        settingRow('lastBlobSweepAt', Date.now()),
        settingRow('lastBlobSweepAt', 5, 2),
        settingRow('supporterBadgeAt', '2026-10-01'),
        settingRow('backupRetentionCount', 7),
      ],
      stamps: [{ id: 'b1', shape: 'bell', color: 'blue', at: '2026-09-01', createdAt: 3 }],
      attachments: [
        { id: 'a1', entryId: 'e', mimeType: 'image/jpeg', fileName: 'a.jpg', createdAt: 1 },
      ],
      vendors: [{ id: 'v1', name: '業者' }],
    });
    const snapshot = structuredClone(payload);
    const settingsRef = payload.tables.settings;
    vi.stubGlobal('Blob', NodeBlob);
    try {
      await restoreFromPayload(payload, new Map());
    } finally {
      vi.unstubAllGlobals();
    }
    expect(payload).toEqual(snapshot);
    expect(payload.tables.settings).toBe(settingsRef);
    expect((await db.settings.get('userBusinessName'))?.value).toBe('青井商店');
    expect(await db.settings.get('skipExternalSendConfirm')).toBeUndefined();
    expect(await db.settings.get('lastBlobSweepAt')).toBeUndefined();
  });
});

describe('証憑写真の zip 往復', () => {
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

  test('旧 JSON 形式で上限超過なら BackupTooLargeError（内容は読まずに弾く）', async () => {
    const jsonFile = new File(['{"version":1,"tables":{}}'], 'backup.json', {
      type: 'application/json',
    });
    // 実際に 100MB のファイルは作らず、size だけ上限超過を装う。
    Object.defineProperty(jsonFile, 'size', { value: MAX_BACKUP_BYTES + 1 });
    await expect(parseBackupFile(jsonFile)).rejects.toThrow(BackupTooLargeError);
  });
});

describe('isBackupTooLarge', () => {
  test('zip は上限を超えても許容する', () => {
    expect(isBackupTooLarge(true, MAX_BACKUP_BYTES + 1)).toBe(false);
  });

  test('旧 JSON は上限超過で弾く', () => {
    expect(isBackupTooLarge(false, MAX_BACKUP_BYTES + 1)).toBe(true);
  });

  test('境界値（ちょうど上限）は許容する', () => {
    expect(isBackupTooLarge(false, MAX_BACKUP_BYTES)).toBe(false);
    expect(isBackupTooLarge(true, MAX_BACKUP_BYTES)).toBe(false);
  });

  test('上限未満はどちらも許容する', () => {
    expect(isBackupTooLarge(false, 100)).toBe(false);
    expect(isBackupTooLarge(true, 100)).toBe(false);
  });
});
