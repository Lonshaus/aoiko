import { describe, expect, test } from 'vitest';
import { describeStorageError, isQuotaExceededError } from './storage-error';

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
