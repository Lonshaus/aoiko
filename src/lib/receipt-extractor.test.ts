import { afterEach, describe, expect, test } from 'vitest';
import { db } from '../db/db';
import { createReceiptExtractor } from './receipt-extractor';
import { setSetting } from './settings';

afterEach(async () => {
  await db.settings.clear();
});

describe('createReceiptExtractor', () => {
  test('ai・gemini：キー無しならエラー', async () => {
    await expect(createReceiptExtractor('ai', 'tesseract')).rejects.toThrow(/Gemini API キー/);
  });

  test('ai・gemini：API キー設定済みなら external=true / 該当ホスト', async () => {
    await setSetting('geminiApiKey', 'sk-test');
    await setSetting('geminiModel', 'gemini-2.5-flash');
    const ex = await createReceiptExtractor('ai', 'tesseract');
    expect(ex.engine).toBe('gemini');
    expect(ex.external).toBe(true);
    expect(ex.destinationHost).toBe('generativelanguage.googleapis.com');
  });

  test('ai・openai-compatible：ホスト・モデル設定で external 判定はホスト依存', async () => {
    await setSetting('aiEngine', 'openai-compatible');
    await setSetting('openaiBaseUrl', 'http://localhost:11434/v1');
    await setSetting('openaiOcrModel', 'llama3.2-vision');
    const ex = await createReceiptExtractor('ai', 'tesseract');
    expect(ex.engine).toBe('openai-compatible');
    expect(ex.external).toBe(false);
  });

  // __NATIVE__ はテスト全体で true（vitest.config.ts）。apple-ai を試験できるのはこちら側だけ。
  test('ai・apple-ai：常に external=false、native 側の抽出器を返す', async () => {
    await setSetting('aiEngine', 'apple-ai');
    const ex = await createReceiptExtractor('ai', 'tesseract');
    expect(ex.engine).toBe('apple-ai');
    expect(ex.external).toBe(false);
    expect(ex.destinationHost).toBe('');
  });

  // chrome-ai は web 側のみの経路。__NATIVE__（テスト全体で true）ではここへ来る前に
  // build 時の分岐で畳まれるため、Gemini キー設定済みでも黙って gemini に落ちない。
  test('ai・chrome-ai：__NATIVE__ では拒否する（Gemini キー設定済みでも gemini に落ちない）', async () => {
    await setSetting('aiEngine', 'chrome-ai');
    await setSetting('geminiApiKey', 'sk-test');
    await setSetting('geminiModel', 'gemini-2.5-flash');
    await expect(createReceiptExtractor('ai', 'tesseract')).rejects.toThrow(/chrome-ai/);
  });

  // 設定はバックアップに乗って別の環境へ渡る。未知の値を黙って gemini に落とすと、
  // 端末内で読むつもりの利用者の画像が外へ出る。
  test('ai・不明な aiEngine：例外を投げる（gemini に落ちない）', async () => {
    await setSetting('geminiApiKey', 'sk-test');
    await setSetting('geminiModel', 'gemini-2.5-flash');
    for (const retired of ['tesseract', 'native'] as const) {
      await setSetting('aiEngine', retired as never);
      await expect(createReceiptExtractor('ai', 'tesseract')).rejects.toThrow();
    }
  });

  test('rule・tesseract：external=false・engine=tesseract', async () => {
    const ex = await createReceiptExtractor('rule', 'tesseract');
    expect(ex.engine).toBe('tesseract');
    expect(ex.external).toBe(false);
    expect(ex.destinationHost).toBe('');
  });

  test('rule・不明な ruleEngine：例外を投げず既定へ落ちる', async () => {
    const ex = await createReceiptExtractor('rule', 'unknown-legacy' as never);
    expect(['tesseract', 'native']).toContain(ex.engine);
  });
});
