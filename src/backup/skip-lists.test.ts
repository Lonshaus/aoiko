import { describe, expect, test } from 'vitest';
import { FILER_INFO_SETTING_KEYS } from './payload';
import { hasSettingKey, RESET_ON_RESTORE_KEYS, SKIP_SETTING_KEYS, SKIP_TABLES } from './skip-lists';
import { db } from '../db/db';

describe('復元・書き出しで端末に残す一覧', () => {
  test('端末固有の settings キーの一覧', () => {
    expect([...SKIP_SETTING_KEYS].sort()).toEqual(
      [
        'analysisNotifyEnabled',
        'backupFolderHandle',
        'backupRetentionCount',
        'blobRetentionDays',
        'lastBackupAt',
        'lastBlobSweepAt',
        'lastDownloadAt',
        'nativeBackupFolder',
        'supporterBadgeAt',
      ].sort(),
    );
    expect([...RESET_ON_RESTORE_KEYS]).toEqual(['skipExternalSendConfirm']);
    expect([...SKIP_TABLES]).toEqual(['stamps']);
  });
  // 同じキーが 2 つの一覧に入ると、復元でどちらの扱いになるかが書き戻しの順序で決まってしまう。
  test('SKIP_SETTING_KEYS・RESET_ON_RESTORE_KEYS・FILER_INFO_SETTING_KEYS は互いに重ならない', () => {
    const sets: [string, ReadonlySet<string>][] = [
      ['SKIP_SETTING_KEYS', SKIP_SETTING_KEYS],
      ['RESET_ON_RESTORE_KEYS', RESET_ON_RESTORE_KEYS],
      ['FILER_INFO_SETTING_KEYS', FILER_INFO_SETTING_KEYS],
    ];
    for (const [nameA, a] of sets) {
      for (const [nameB, b] of sets) {
        if (nameA === nameB) {
          continue;
        }
        expect(
          [...a].filter((k) => b.has(k)),
          `${nameA} と ${nameB}`,
        ).toEqual([]);
      }
    }
  });

  test('SKIP_TABLES は実在するテーブルだけを指す', () => {
    const names = new Set(db.tables.map((t) => t.name));
    for (const name of SKIP_TABLES) {
      expect(names.has(name)).toBe(true);
    }
  });
});

describe('hasSettingKey', () => {
  test('文字列のキーだけを一覧と照らす', () => {
    expect(hasSettingKey(SKIP_SETTING_KEYS, 'supporterBadgeAt')).toBe(true);
    expect(hasSettingKey(SKIP_SETTING_KEYS, 'userBusinessName')).toBe(false);
    expect(hasSettingKey(SKIP_SETTING_KEYS, 1)).toBe(false);
    expect(hasSettingKey(SKIP_SETTING_KEYS, undefined)).toBe(false);
    expect(hasSettingKey(SKIP_SETTING_KEYS, ['supporterBadgeAt'])).toBe(false);
    expect(hasSettingKey(SKIP_SETTING_KEYS, { toString: () => 'supporterBadgeAt' })).toBe(false);
  });
});
