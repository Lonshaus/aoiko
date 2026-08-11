import { describe, expect, test } from 'vitest';
import {
  daysSince,
  isFolderBackupActive,
  needsOffsiteBackupWarning,
  shouldShowHomeScreenHint,
} from './schedule';

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
  // ネイティブ層でフォルダを選ぶ wrapper 版。利用者から見て fsa と同じ機能なので、
  // 同じ扱いにしないと 4 プラットフォームすべてで警告が出たままになる。
  test('ネイティブのフォルダ保存も警告しない', () => {
    expect(needsOffsiteBackupWarning('native', 'idle', null)).toBe(false);
    expect(needsOffsiteBackupWarning('native', 'writing', 999)).toBe(false);
  });

  test('ネイティブでも再選択待ち・エラーは警告する', () => {
    expect(needsOffsiteBackupWarning('native', 'unconfigured', null)).toBe(true);
    expect(needsOffsiteBackupWarning('native', 'reconfigure-required', null)).toBe(true);
    expect(needsOffsiteBackupWarning('native', 'error', null)).toBe(true);
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

describe('shouldShowHomeScreenHint', () => {
  test('OPFS・非対応はホーム画面案内を出す', () => {
    expect(shouldShowHomeScreenHint('opfs', false)).toBe(true);
    expect(shouldShowHomeScreenHint('none', false)).toBe(true);
  });

  test('フォルダ保存が動いていれば案内不要', () => {
    expect(shouldShowHomeScreenHint('fsa', false)).toBe(false);
    expect(shouldShowHomeScreenHint('native', false)).toBe(false);
  });

  test('すでにホーム画面起動済みなら案内不要', () => {
    expect(shouldShowHomeScreenHint('opfs', true)).toBe(false);
    expect(shouldShowHomeScreenHint('none', true)).toBe(false);
  });
});

describe('isFolderBackupActive', () => {
  test('フォルダ保存が現に動いていれば true', () => {
    expect(isFolderBackupActive('native', 'idle')).toBe(true);
    expect(isFolderBackupActive('fsa', 'writing')).toBe(true);
  });
  // 種類だけで判定すると、一件も書けていない状態を「動いている」と誤認して
  // 退避の注意書きまで黙らせてしまう。
  test('種類が fsa/native でも未設定・再選択待ち・エラーなら false', () => {
    expect(isFolderBackupActive('native', 'unconfigured')).toBe(false);
    expect(isFolderBackupActive('native', 'reconfigure-required')).toBe(false);
    expect(isFolderBackupActive('fsa', 'permission-required')).toBe(false);
    expect(isFolderBackupActive('fsa', 'error')).toBe(false);
  });

  test('OPFS と非対応は常に false', () => {
    expect(isFolderBackupActive('opfs', 'idle')).toBe(false);
    expect(isFolderBackupActive('none', 'unsupported')).toBe(false);
  });
});
