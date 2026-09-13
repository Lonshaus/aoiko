// 旧 ocrEngine（単一設定）を aiEngine / receiptMethod / receiptRuleEngine の 3 設定へ移行する。
// SettingsMap から ocrEngine が消えたため getSetting/setSetting は使えず、db.settings を直接読む。

import { db } from '../db/db';
import type { AiEngine, ReceiptRuleEngine } from './settings';

export async function migrateOcrEngineSetting(): Promise<void> {
  await db.transaction('rw', db.settings, async () => {
    const row = await db.settings.get('ocrEngine');
    if (!row) {
      return;
    }
    const stored = row.value as AiEngine | ReceiptRuleEngine;
    const now = Date.now();
    if (stored === 'gemini' || stored === 'openai-compatible' || stored === 'apple-ai') {
      await db.settings.bulkPut([
        { key: 'aiEngine', value: stored, updatedAt: now },
        { key: 'receiptMethod', value: 'ai', updatedAt: now },
      ]);
    } else {
      await db.settings.bulkPut([
        { key: 'aiEngine', value: 'gemini', updatedAt: now },
        { key: 'receiptMethod', value: 'rule', updatedAt: now },
        { key: 'receiptRuleEngine', value: stored, updatedAt: now },
      ]);
    }
    await db.settings.delete('ocrEngine');
  });
}
