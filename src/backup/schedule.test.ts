import { describe, expect, test } from 'vitest';
import {
  daysSince,
  needsOffsiteBackupWarning,
  selectExpiredBackups,
  shouldBackupNow,
} from './schedule';

const HOUR_MS = 60 * 60 * 1000;

describe('shouldBackupNow', () => {
  test('intervalHours = 0 は lastBackupAt に関わらず常に true', () => {
    expect(shouldBackupNow(0, 0, 0)).toBe(true);
    expect(shouldBackupNow(1_000_000, 1_000_001, 0)).toBe(true);
  });

  test('lastBackupAt = null は常に true', () => {
    expect(shouldBackupNow(null, 0, 1)).toBe(true);
    expect(shouldBackupNow(null, 1_000_000, 24)).toBe(true);
  });

  test('経過時間が間隔ちょうどで true', () => {
    expect(shouldBackupNow(0, 1 * HOUR_MS, 1)).toBe(true);
  });

  test('経過時間が間隔未満で false', () => {
    expect(shouldBackupNow(0, 1 * HOUR_MS - 1, 1)).toBe(false);
  });

  test('経過時間が間隔超過で true', () => {
    expect(shouldBackupNow(0, 1 * HOUR_MS + 1, 1)).toBe(true);
  });

  test('now が lastBackupAt より前（時計の巻き戻り）は true', () => {
    expect(shouldBackupNow(1_000_000, 999_999, 24)).toBe(true);
  });

  test('12時間間隔で境界と未満と超過を確認', () => {
    const last = 0;
    expect(shouldBackupNow(last, 12 * HOUR_MS, 12)).toBe(true);
    expect(shouldBackupNow(last, 12 * HOUR_MS - 1, 12)).toBe(false);
    expect(shouldBackupNow(last, 12 * HOUR_MS + 1, 12)).toBe(true);
  });

  test('24時間間隔で境界と未満と超過を確認', () => {
    const last = 0;
    expect(shouldBackupNow(last, 24 * HOUR_MS, 24)).toBe(true);
    expect(shouldBackupNow(last, 24 * HOUR_MS - 1, 24)).toBe(false);
    expect(shouldBackupNow(last, 24 * HOUR_MS + 1, 24)).toBe(true);
  });
});

describe('selectExpiredBackups', () => {
  test('keepCount = 0 は常に空配列', () => {
    const names = [
      'aoiko-ledger-2026-01-01.zip',
      'aoiko-ledger-2026-02-01.zip',
      'aoiko-ledger-2026-03-01.zip',
    ];
    expect(selectExpiredBackups(names, 0)).toEqual([]);
  });

  test('対象が keepCount 以下なら空配列', () => {
    const names = ['aoiko-ledger-2026-01-01.zip'];
    expect(selectExpiredBackups(names, 7)).toEqual([]);
  });

  test('対象が keepCount ちょうどなら空配列（境界値）', () => {
    const names = [
      'aoiko-ledger-2026-01-01.zip',
      'aoiko-ledger-2026-02-01.zip',
      'aoiko-ledger-2026-03-01.zip',
    ];
    expect(selectExpiredBackups(names, 3)).toEqual([]);
  });

  test('対象が keepCount より多いとき、古い順に超過分だけ返す', () => {
    const names = [
      'aoiko-ledger-2026-01-01.zip',
      'aoiko-ledger-2026-02-01.zip',
      'aoiko-ledger-2026-03-01.zip',
      'aoiko-ledger-2026-04-01.zip',
    ];
    expect(selectExpiredBackups(names, 3)).toEqual(['aoiko-ledger-2026-01-01.zip']);
  });

  test('aoiko-ledger-latest.zip は削除対象に含まれない', () => {
    const names = [
      'aoiko-ledger-latest.zip',
      'aoiko-ledger-2026-01-01.zip',
      'aoiko-ledger-2026-02-01.zip',
    ];
    expect(selectExpiredBackups(names, 1)).toEqual(['aoiko-ledger-2026-01-01.zip']);
  });

  test('関係ないファイル名は対象外', () => {
    const names = ['memo.txt', 'aoiko-ledger.zip', 'aoiko-ledger-2026-07.zip'];
    expect(selectExpiredBackups(names, 90)).toEqual([]);
  });

  test('入力順がバラバラでも日付順で正しく古いものが選ばれる', () => {
    const names = [
      'aoiko-ledger-2026-05-01.zip',
      'aoiko-ledger-2026-01-01.zip',
      'aoiko-ledger-2026-03-01.zip',
      'aoiko-ledger-2026-02-01.zip',
      'aoiko-ledger-2026-04-01.zip',
    ];
    expect(selectExpiredBackups(names, 3)).toEqual([
      'aoiko-ledger-2026-01-01.zip',
      'aoiko-ledger-2026-02-01.zip',
    ]);
  });
});

describe('daysSince', () => {
  test('null / 0 は null を返す', () => {
    expect(daysSince(null)).toBeNull();
    expect(daysSince(0)).toBeNull();
  });

  test('経過日数を切り捨てで返す', () => {
    const oneDayMs = 24 * 60 * 60 * 1000;
    expect(daysSince(Date.now() - oneDayMs * 3)).toBe(3);
    expect(daysSince(Date.now() - oneDayMs * 3 - 1000)).toBe(3);
  });
});

describe('needsOffsiteBackupWarning', () => {
  test('フォルダ保存が動いていれば警告しない', () => {
    expect(needsOffsiteBackupWarning('fsa', 'idle', null)).toBe(false);
    expect(needsOffsiteBackupWarning('fsa', 'writing', 999)).toBe(false);
  });

  test('フォルダ未設定・許可切れ・エラーはダウンロードが無ければ警告する', () => {
    expect(needsOffsiteBackupWarning('fsa', 'unconfigured', null)).toBe(true);
    expect(needsOffsiteBackupWarning('fsa', 'permission-required', null)).toBe(true);
    expect(needsOffsiteBackupWarning('fsa', 'error', null)).toBe(true);
  });

  test('OPFS とブラウザ非対応は従来どおり警告対象', () => {
    expect(needsOffsiteBackupWarning('opfs', 'idle', null)).toBe(true);
    expect(needsOffsiteBackupWarning('none', 'unsupported', null)).toBe(true);
  });

  test('直近にダウンロードしていれば警告しない', () => {
    expect(needsOffsiteBackupWarning('opfs', 'idle', 0)).toBe(false);
    expect(needsOffsiteBackupWarning('opfs', 'idle', 6)).toBe(false);
    expect(needsOffsiteBackupWarning('opfs', 'idle', 7)).toBe(true);
  });

  test('初期化中は判定を保留する', () => {
    expect(needsOffsiteBackupWarning('none', 'initializing', null)).toBe(false);
  });
});
