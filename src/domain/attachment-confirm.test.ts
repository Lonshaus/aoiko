import { describe, expect, test } from 'vitest';
import { shouldConfirmAttachment } from './attachment-confirm';

describe('shouldConfirmAttachment', () => {
  test('未設定なら確認する', () => {
    expect(shouldConfirmAttachment(undefined)).toBe(true);
  });
  test('false ならまだ確認する', () => {
    expect(shouldConfirmAttachment(false)).toBe(true);
  });
  test('true ならスキップする', () => {
    expect(shouldConfirmAttachment(true)).toBe(false);
  });
});
