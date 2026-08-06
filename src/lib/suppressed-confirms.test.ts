import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { db } from '../db/db';
import { getSetting, setSetting } from './settings';
import { countSuppressedConfirms, resetSuppressedConfirms } from './suppressed-confirms';

beforeEach(async () => {
  await db.delete();
  await db.open();
});

afterEach(async () => {
  await db.delete();
});

describe('suppressed-confirms', () => {
  test('何も抑制していなければ 0 件', async () => {
    expect(await countSuppressedConfirms()).toBe(0);
  });

  test('true の設定だけを数える（false は非表示ではない）', async () => {
    await setSetting('skipAttachmentConfirm', true);
    await setSetting('skipExternalSendConfirm', false);
    await setSetting('skipFiledYearWarning', true);
    await setSetting('skipDownloadSavedConfirm', true);
    expect(await countSuppressedConfirms()).toBe(3);
  });

  test('リセットで全て消え、他の設定は残る', async () => {
    await setSetting('skipAttachmentConfirm', true);
    await setSetting('skipExternalSendConfirm', true);
    await setSetting('skipFiledYearWarning', true);
    await setSetting('skipDownloadSavedConfirm', true);
    await setSetting('userBusinessName', '青井ウェブ事務所');

    await resetSuppressedConfirms();

    expect(await countSuppressedConfirms()).toBe(0);
    expect(await getSetting('skipAttachmentConfirm')).toBeUndefined();
    expect(await getSetting('skipExternalSendConfirm')).toBeUndefined();
    expect(await getSetting('skipFiledYearWarning')).toBeUndefined();
    expect(await getSetting('skipDownloadSavedConfirm')).toBeUndefined();
    expect(await getSetting('userBusinessName')).toBe('青井ウェブ事務所');
  });
});
