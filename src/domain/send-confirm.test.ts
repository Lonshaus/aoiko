import { describe, expect, test } from 'vitest';
import { shouldConfirmExternalSend } from './send-confirm';

describe('shouldConfirmExternalSend', () => {
  test('ローカルエンジンは常に確認不要', () => {
    expect(
      shouldConfirmExternalSend({ external: false, host: '' }, undefined)
    ).toBe(false);
    expect(
      shouldConfirmExternalSend(
        { external: false, host: 'localhost:11434' },
        false
      )
    ).toBe(false);
  });

  test('外部送信は既定で確認要', () => {
    expect(
      shouldConfirmExternalSend(
        { external: true, host: 'generativelanguage.googleapis.com' },
        undefined
      )
    ).toBe(true);
    expect(
      shouldConfirmExternalSend(
        { external: true, host: 'generativelanguage.googleapis.com' },
        false
      )
    ).toBe(true);
  });

  test('「次回から確認しない」を選ぶと外部送信でも skip', () => {
    expect(
      shouldConfirmExternalSend(
        { external: true, host: 'generativelanguage.googleapis.com' },
        true
      )
    ).toBe(false);
  });
});