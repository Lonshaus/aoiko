import { afterEach, describe, expect, test } from 'vitest';
import { db } from '../db/db';
import {
  discardInvalidCurrentYear,
  migrateBackupPartsSetting,
  migrateOcrEngineSetting,
  resetInvalidCurrentYear,
} from './settings-migration';
import { defaultRuleEngine, getSetting, setSetting } from './settings';
import { createLlmAdapter } from './llm-adapter';

afterEach(async () => {
  await db.settings.clear();
});

describe('migrateOcrEngineSetting', () => {
  test('gemini：aiEngine=gemini・receiptMethod=ai へ、ocrEngine 行は消える', async () => {
    await db.settings.put({ key: 'ocrEngine', value: 'gemini', updatedAt: 1 });
    await migrateOcrEngineSetting();
    expect(await getSetting('aiEngine')).toBe('gemini');
    expect(await getSetting('receiptMethod')).toBe('ai');
    expect(await getSetting('receiptRuleEngine')).toBeUndefined();
    expect(await db.settings.get('ocrEngine')).toBeUndefined();
  });

  test('openai-compatible：aiEngine=openai-compatible・receiptMethod=ai へ', async () => {
    await db.settings.put({ key: 'ocrEngine', value: 'openai-compatible', updatedAt: 1 });
    await migrateOcrEngineSetting();
    expect(await getSetting('aiEngine')).toBe('openai-compatible');
    expect(await getSetting('receiptMethod')).toBe('ai');
    expect(await db.settings.get('ocrEngine')).toBeUndefined();
  });

  test('apple-ai：aiEngine=apple-ai・receiptMethod=ai へ（不正な receiptRuleEngine を書かない）', async () => {
    await db.settings.put({ key: 'ocrEngine', value: 'apple-ai', updatedAt: 1 });
    await migrateOcrEngineSetting();
    expect(await getSetting('aiEngine')).toBe('apple-ai');
    expect(await getSetting('receiptMethod')).toBe('ai');
    expect(await getSetting('receiptRuleEngine')).toBeUndefined();
    expect(await db.settings.get('ocrEngine')).toBeUndefined();
  });

  test('tesseract：aiEngine=gemini・receiptMethod=rule・receiptRuleEngine=tesseract へ', async () => {
    await db.settings.put({ key: 'ocrEngine', value: 'tesseract', updatedAt: 1 });
    await migrateOcrEngineSetting();
    expect(await getSetting('aiEngine')).toBe('gemini');
    expect(await getSetting('receiptMethod')).toBe('rule');
    expect(await getSetting('receiptRuleEngine')).toBe('tesseract');
    expect(await db.settings.get('ocrEngine')).toBeUndefined();
  });

  test('native：aiEngine=gemini・receiptMethod=rule・receiptRuleEngine=native へ', async () => {
    await db.settings.put({ key: 'ocrEngine', value: 'native', updatedAt: 1 });
    await migrateOcrEngineSetting();
    expect(await getSetting('aiEngine')).toBe('gemini');
    expect(await getSetting('receiptMethod')).toBe('rule');
    expect(await getSetting('receiptRuleEngine')).toBe('native');
    expect(await db.settings.get('ocrEngine')).toBeUndefined();
  });

  test('ocrEngine 行が無ければ何も書かない', async () => {
    await migrateOcrEngineSetting();
    expect(await getSetting('aiEngine')).toBeUndefined();
    expect(await getSetting('receiptMethod')).toBeUndefined();
    expect(await getSetting('receiptRuleEngine')).toBeUndefined();
  });

  test('冪等：2 回目は何もしない', async () => {
    await db.settings.put({ key: 'ocrEngine', value: 'gemini', updatedAt: 1 });
    await migrateOcrEngineSetting();
    const after1 = await db.settings.get('aiEngine');
    await migrateOcrEngineSetting();
    const after2 = await db.settings.get('aiEngine');
    expect(after2).toEqual(after1);
    expect(await getSetting('receiptMethod')).toBe('ai');
  });

  test('移行後、tesseract/native は receiptMethod=rule・receiptRuleEngine=元の値へ移る', async () => {
    for (const retired of ['tesseract', 'native'] as const) {
      await db.settings.put({ key: 'ocrEngine', value: retired, updatedAt: 1 });
      await migrateOcrEngineSetting();
      expect(await getSetting('receiptMethod')).toBe('rule');
      expect(await getSetting('receiptRuleEngine')).toBe(retired);
    }
  });

  test('receiptMethod=rule は classify 用アダプタに影響しない', async () => {
    await db.settings.put({ key: 'ocrEngine', value: 'tesseract', updatedAt: 1 });
    await migrateOcrEngineSetting();
    await setSetting('geminiApiKey', 'sk-test');
    await setSetting('geminiModel', 'gemini-2.5-flash');
    const adapter = await createLlmAdapter('classify');
    expect(adapter.external).toBe(true);
    expect(adapter.destinationHost).toBe('generativelanguage.googleapis.com');
  });
});

describe('migrateBackupPartsSetting', () => {
  const put = (key: string, value: unknown) => db.settings.put({ key, value, updatedAt: 1 });
  const oldRowsGone = async () =>
    (await db.settings.get('backupIncludeApiKeys')) === undefined &&
    (await db.settings.get('backupIncludeFilerInfo')) === undefined;

  test('旧切替が 2 つとも無ければ backupParts を書かない', async () => {
    await migrateBackupPartsSetting();
    expect(await getSetting('backupParts')).toBeUndefined();
  });

  test('backupIncludeApiKeys が true なら API キーを足し、旧切替の行を消す', async () => {
    await put('backupIncludeApiKeys', true);
    await put('backupIncludeFilerInfo', false);
    await migrateBackupPartsSetting();
    expect(await getSetting('backupParts')).toEqual([
      'books',
      'attachments',
      'business',
      'ai',
      'apiKeys',
    ]);
    expect(await oldRowsGone()).toBe(true);
  });

  test('backupIncludeFilerInfo が true なら申告者情報を足す', async () => {
    await put('backupIncludeFilerInfo', true);
    await migrateBackupPartsSetting();
    expect(await getSetting('backupParts')).toEqual([
      'books',
      'attachments',
      'business',
      'ai',
      'filer',
    ]);
    expect(await oldRowsGone()).toBe(true);
  });

  test.each([false, 'true', 1])('値が %s なら足さない', async (value) => {
    await put('backupIncludeApiKeys', value);
    await put('backupIncludeFilerInfo', value);
    await migrateBackupPartsSetting();
    expect(await getSetting('backupParts')).toEqual(['books', 'attachments', 'business', 'ai']);
    expect(await oldRowsGone()).toBe(true);
  });

  test('backupParts が既にあれば上書きせず、旧切替の行だけ消す', async () => {
    await put('backupParts', ['books', 'business']);
    await put('backupIncludeApiKeys', true);
    await put('backupIncludeFilerInfo', true);
    await migrateBackupPartsSetting();
    expect(await getSetting('backupParts')).toEqual(['books', 'business']);
    expect(await oldRowsGone()).toBe(true);
  });
});

describe('discardInvalidCurrentYear', () => {
  const invalid = [null, '2026', 2026.5, Infinity, NaN, true, {}, 0, -1, 1e300, 2019, 2100];

  test.each(invalid)('値が %s なら行を消す', async (value) => {
    await db.settings.put({ key: 'currentYear', value, updatedAt: 1 });
    await discardInvalidCurrentYear();
    expect(await db.settings.get('currentYear')).toBeUndefined();
  });

  test('value の無い行も消す', async () => {
    await db.settings.put({ key: 'currentYear', updatedAt: 1 } as never);
    await discardInvalidCurrentYear();
    expect(await db.settings.get('currentYear')).toBeUndefined();
  });

  test.each([2020, 2026, 2099])('値が %s なら変えない', async (value) => {
    await db.settings.put({ key: 'currentYear', value, updatedAt: 1 });
    await discardInvalidCurrentYear();
    expect(await db.settings.get('currentYear')).toEqual({
      key: 'currentYear',
      value,
      updatedAt: 1,
    });
  });

  test('行が無ければ何もしない', async () => {
    await db.settings.put({ key: 'userBusinessName', value: '青井商店', updatedAt: 1 });
    await discardInvalidCurrentYear();
    expect(await db.settings.toArray()).toEqual([
      { key: 'userBusinessName', value: '青井商店', updatedAt: 1 },
    ]);
  });
});

describe('resetInvalidCurrentYear', () => {
  const now = new Date(2026, 5, 1);

  test.each(['2026', 0, null, 2026.5])('値が %s なら起動時点の年へ置き換える', async (value) => {
    await db.settings.put({ key: 'currentYear', value, updatedAt: 1 });
    expect(await resetInvalidCurrentYear(now)).toBe(2026);
    expect((await db.settings.get('currentYear'))?.value).toBe(2026);
    expect((await db.settings.get('processingYearResetTo'))?.value).toBe(2026);
  });

  test('行が無ければ（初回起動）何も書かない', async () => {
    expect(await resetInvalidCurrentYear(now)).toBeNull();
    expect(await db.settings.get('currentYear')).toBeUndefined();
    expect(await db.settings.get('processingYearResetTo')).toBeUndefined();
  });

  test('範囲内の年度なら変えない', async () => {
    await db.settings.put({ key: 'currentYear', value: 2027, updatedAt: 1 });
    expect(await resetInvalidCurrentYear(now)).toBeNull();
    expect(await db.settings.toArray()).toEqual([
      { key: 'currentYear', value: 2027, updatedAt: 1 },
    ]);
  });
});

describe('defaultRuleEngine', () => {
  test('native ビルドでは native', () => {
    expect(defaultRuleEngine(true)).toBe('native');
  });

  test('native でないビルドでは tesseract', () => {
    expect(defaultRuleEngine(false)).toBe('tesseract');
  });
});
