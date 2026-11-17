import Dexie from 'dexie';
import { describe, expect, test } from 'vitest';
import { m } from '../paraglide/messages';
import { describeStorageError, isDecimalError, isQuotaExceededError } from './storage-error';

describe('isQuotaExceededError', () => {
  test('標準の QuotaExceededError を検知する', () => {
    expect(isQuotaExceededError(new DOMException('full', 'QuotaExceededError'))).toBe(true);
  });

  test('Firefox の NS_ERROR_DOM_QUOTA_REACHED も検知する', () => {
    expect(isQuotaExceededError(new DOMException('full', 'NS_ERROR_DOM_QUOTA_REACHED'))).toBe(true);
  });

  test('無関係な DOMException や Error は false', () => {
    expect(isQuotaExceededError(new DOMException('aborted', 'AbortError'))).toBe(false);
    expect(isQuotaExceededError(new Error('boom'))).toBe(false);
    expect(isQuotaExceededError('boom')).toBe(false);
  });
});

describe('describeStorageError', () => {
  test('容量不足は利用者向けメッセージに変換する', () => {
    const message = describeStorageError(new DOMException('full', 'QuotaExceededError'));
    expect(message).not.toMatch(/QuotaExceededError/);
    expect(message.length).toBeGreaterThan(0);
  });

  test('それ以外の Error は message をそのまま返す', () => {
    expect(describeStorageError(new Error('network down'))).toBe('network down');
  });

  test('Error でない値は文字列化して返す', () => {
    expect(describeStorageError('plain string')).toBe('plain string');
  });
});

describe('describeStorageError の書き込み失敗と読めない金額', () => {
  test('[DecimalError] で始まる例外は原文を出さず、読めない金額の案内にする', () => {
    const message = describeStorageError(new Error('[DecimalError] Invalid argument: abc'));
    expect(message).toBe(m.common_stored_amount_error());
    expect(message).not.toMatch(/DecimalError|abc/);
  });

  test('null と undefined は null と表示せず、書き込み失敗の案内にする', () => {
    for (const e of [null, undefined]) {
      const message = describeStorageError(e);
      expect(message).toBe(m.common_storage_write_failed());
      expect(message).not.toBe('null');
    }
  });

  test.each([
    'ConstraintError',
    'AbortError',
    'BulkError',
    'TransactionInactiveError',
    'InvalidStateError',
    'UnknownError',
  ])('名前が %s の DOMException は原文を出さず、書き込み失敗の案内にする', (name) => {
    const message = describeStorageError(new DOMException('原文 bulkAdd', name));
    expect(message).toBe(m.common_storage_write_failed());
    expect(message).not.toContain(name);
    expect(message).not.toContain('bulkAdd');
  });

  test('Dexie の BulkError と AbortError も書き込み失敗の案内にする', () => {
    const bulk = new Dexie.BulkError('journalLines.bulkAdd(): 1 of 2 operations failed', []);
    expect(describeStorageError(bulk)).toBe(m.common_storage_write_failed());
    expect(describeStorageError(new Dexie.AbortError('Transaction aborted'))).toBe(
      m.common_storage_write_failed(),
    );
  });

  test('容量不足とその他のエラーはこれまでどおり', () => {
    expect(describeStorageError(new DOMException('full', 'QuotaExceededError'))).toBe(
      m.common_storage_full(),
    );
    expect(describeStorageError(new DOMException('参照できません', 'NotFoundError'))).toBe(
      '参照できません',
    );
    expect(describeStorageError(new TypeError('x is not a function'))).toBe('x is not a function');
    expect(describeStorageError('plain')).toBe('plain');
  });

  test('isDecimalError は [DecimalError] で始まる Error だけを真とする', () => {
    expect(isDecimalError(new Error('[DecimalError] Invalid argument: x'))).toBe(true);
    expect(isDecimalError(new Error('他のエラー [DecimalError]'))).toBe(false);
    expect(isDecimalError('[DecimalError] x')).toBe(false);
  });
});
