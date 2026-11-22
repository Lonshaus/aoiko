import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { db } from '../db/db';
import { buildPayload, PAYLOAD_VERSION, type BackupPayload } from '../backup';
import { FILER_SETTING_KEYS } from '../backup/parts';
import { BackupValidationError } from './restore-validate';
import {
  inspectBackupPayload,
  parseBackupJson,
  restoreFromJson,
  restoreFromPayload,
} from './restore';

beforeEach(async () => {
  await db.delete();
  await db.open();
});

afterEach(async () => {
  await db.delete();
});

function setting(key: string, value: unknown) {
  return { key, value, updatedAt: 1 };
}

function filerPayload(rows: ReturnType<typeof setting>[]): BackupPayload {
  return {
    version: 2,
    exportedAt: '2026-11-01T00:00:00.000Z',
    parts: ['filer'],
    tables: { settings: rows },
  };
}

describe('納税地の設定の復元', () => {
  test('新しいキーの無い旧い申告者情報のバックアップも復元できる', async () => {
    await restoreFromJson({
      version: PAYLOAD_VERSION,
      exportedAt: '2026-05-10',
      tables: {
        settings: [
          setting('userFilerName', '青井 太郎'),
          setting('userFilerAddress', '東京都千代田区1-1'),
        ],
      },
    });
    expect((await db.settings.get('userFilerAddress'))?.value).toBe('東京都千代田区1-1');
    expect(await db.settings.get('userFilerTaxPlaceKind')).toBeUndefined();
  });

  test.each(['abode', 'businessPlace', 'domicile'])('区分 %s を復元する', async (kind) => {
    await restoreFromPayload(
      filerPayload([setting('userFilerTaxPlaceKind', kind)]),
      new Map(),
      new Set(['filer']),
    );
    expect((await db.settings.get('userFilerTaxPlaceKind'))?.value).toBe(kind);
  });

  test.each([['residence'], [''], [1], [null]])(
    '区分に %j が入ったバックアップは弾き、設定を書き換えない',
    async (bad) => {
      await db.settings.put(setting('userFilerTaxPlaceKind', 'abode'));
      await expect(
        restoreFromPayload(
          filerPayload([setting('userFilerTaxPlaceKind', bad)]),
          new Map(),
          new Set(['filer']),
        ),
      ).rejects.toThrow(BackupValidationError);
      expect((await db.settings.get('userFilerTaxPlaceKind'))?.value).toBe('abode');
    },
  );

  test.each(['userFilerDomicileAddress', 'userFilerBusinessPlaceAddress'])(
    '%s が文字列でないバックアップは弾く',
    async (key) => {
      await expect(
        restoreFromPayload(filerPayload([setting(key, 12)]), new Map(), new Set(['filer'])),
      ).rejects.toThrow(BackupValidationError);
    },
  );

  test('三つのキーは申告者情報と一緒に書き出し、復元する', async () => {
    const values: Record<string, unknown> = {
      userFilerAddress: '東京都',
      userFilerTaxPlaceKind: 'businessPlace',
      userFilerDomicileAddress: '大阪府',
      userFilerBusinessPlaceAddress: '京都府',
    };
    await db.settings.bulkPut(Object.entries(values).map(([k, v]) => setting(k, v)));
    const payload = await buildPayload({ parts: new Set(['filer']) });
    const keys = (payload.tables.settings as { key: string }[]).map((r) => r.key);
    for (const k of Object.keys(values)) {
      expect(FILER_SETTING_KEYS as readonly string[]).toContain(k);
      expect(keys).toContain(k);
    }
    await db.settings.clear();
    const parsed = parseBackupJson(JSON.stringify(payload));
    await restoreFromPayload(parsed, new Map(), new Set(inspectBackupPayload(parsed).parts));
    for (const [k, v] of Object.entries(values)) {
      expect((await db.settings.get(k))?.value, k).toBe(v);
    }
  });

  test('申告者情報を選ばない書き出しには三つのキーを含めない', async () => {
    await db.settings.bulkPut([
      setting('userFilerTaxPlaceKind', 'abode'),
      setting('userFilerDomicileAddress', '大阪府'),
      setting('userFilerBusinessPlaceAddress', '京都府'),
    ]);
    const payload = await buildPayload({ parts: new Set(['books', 'business']) });
    const keys = ((payload.tables.settings ?? []) as { key: string }[]).map((r) => r.key);
    expect(keys).not.toContain('userFilerTaxPlaceKind');
    expect(keys).not.toContain('userFilerDomicileAddress');
    expect(keys).not.toContain('userFilerBusinessPlaceAddress');
  });
});
