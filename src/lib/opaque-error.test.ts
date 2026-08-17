import { describe, expect, it } from 'vitest';
import { isOpaqueError } from './opaque-error';

describe('isOpaqueError', () => {
  it('伏せられたクロスオリジン例外だけを外す', () => {
    // ある環境 あるブラウザ が共有シートで投げる形（#459）。
    expect(isOpaqueError(new ErrorEvent('error', { message: 'Script error.', filename: '' }))).toBe(
      true,
    );
    expect(isOpaqueError(new ErrorEvent('error', { message: '', filename: '' }))).toBe(true);
  });

  it('素の例外は残す', () => {
    expect(
      isOpaqueError(
        new ErrorEvent('error', {
          message: 'x is not a function',
          filename: 'https://example.test/app.js',
          lineno: 12,
        }),
      ),
    ).toBe(false);
    // filename があれば内容が伏せられていない。message が同じ文面でも拾う。
    expect(
      isOpaqueError(
        new ErrorEvent('error', {
          message: 'Script error.',
          filename: 'https://example.test/a.js',
        }),
      ),
    ).toBe(false);
  });

  it('unhandledrejection は ErrorEvent ではないので常に拾う', () => {
    expect(isOpaqueError(new Event('unhandledrejection'))).toBe(false);
  });
});
