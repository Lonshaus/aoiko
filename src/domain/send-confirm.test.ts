import { afterEach, describe, expect, test } from 'vitest';
import { db } from '../db/db';
import { getSetting, setSetting } from '../lib/settings';
import { shouldConfirmExternalSend } from './send-confirm';

afterEach(async () => {
  await db.settings.clear();
});

describe('shouldConfirmExternalSend', () => {
  test('ローカルエンジンは常に確認不要', () => {
    expect(shouldConfirmExternalSend({ external: false, host: '' }, undefined)).toBe(false);
    expect(shouldConfirmExternalSend({ external: false, host: 'localhost:11434' }, false)).toBe(
      false,
    );
  });

  test('外部送信は既定で確認要', () => {
    expect(
      shouldConfirmExternalSend(
        { external: true, host: 'generativelanguage.googleapis.com' },
        undefined,
      ),
    ).toBe(true);
    expect(
      shouldConfirmExternalSend(
        { external: true, host: 'generativelanguage.googleapis.com' },
        false,
      ),
    ).toBe(true);
  });

  test('「次回から確認しない」を選ぶと外部送信でも skip', () => {
    expect(
      shouldConfirmExternalSend(
        { external: true, host: 'generativelanguage.googleapis.com' },
        true,
      ),
    ).toBe(false);
  });

  test('設定画面での skip 切り替えが Dexie 経由で往復反映される', async () => {
    const target = { external: true, host: 'generativelanguage.googleapis.com' };
    await setSetting('skipExternalSendConfirm', true);
    expect(shouldConfirmExternalSend(target, await getSetting('skipExternalSendConfirm'))).toBe(
      false,
    );
    await setSetting('skipExternalSendConfirm', false);
    expect(shouldConfirmExternalSend(target, await getSetting('skipExternalSendConfirm'))).toBe(
      true,
    );
  });
});
