import { afterEach, describe, expect, test } from 'vitest';
import { db } from '../db/db';
import { migrateOcrEngineSetting } from './settings-migration';
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

describe('defaultRuleEngine', () => {
  test('native ビルドでは native', () => {
    expect(defaultRuleEngine(true)).toBe('native');
  });

  test('native でないビルドでは tesseract', () => {
    expect(defaultRuleEngine(false)).toBe('tesseract');
  });
});
