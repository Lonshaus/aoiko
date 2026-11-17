// 旧 ocrEngine（単一設定）を aiEngine / receiptMethod / receiptRuleEngine の 3 設定へ移行する。
// SettingsMap から ocrEngine が消えたため getSetting/setSetting は使えず、db.settings を直接読む。

import { db } from '../db/db';
import type { AiEngine, ReceiptRuleEngine } from './settings';
import { EXPORT_DEFAULT_PARTS, type BackupPartId } from '../backup/parts';
import { initialProcessingYear, isProcessingYear } from './initial-processing-year';

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
// 旧 backupIncludeApiKeys / backupIncludeFilerInfo の 2 つの切替を backupParts へ移す。
// どちらのキーも SettingsMap から消えたため db.settings を直接読む。
export async function migrateBackupPartsSetting(): Promise<void> {
  await db.transaction('rw', db.settings, async () => {
    const apiKeys = await db.settings.get('backupIncludeApiKeys');
    const filer = await db.settings.get('backupIncludeFilerInfo');
    if (!apiKeys && !filer) {
      return;
    }
    if (!(await db.settings.get('backupParts'))) {
      const parts: BackupPartId[] = [...EXPORT_DEFAULT_PARTS];
      if (apiKeys?.value === true) {
        parts.push('apiKeys');
      }
      if (filer?.value === true) {
        parts.push('filer');
      }
      await db.settings.put({ key: 'backupParts', value: parts, updatedAt: Date.now() });
    }
    await db.settings.bulkDelete(['backupIncludeApiKeys', 'backupIncludeFilerInfo']);
  });
}
// 処理年度が範囲内の整数でなければ未設定として消す。起動処理が起動時点の西暦年を入れ直す。
// 値の型が合わないまま読むと、その年度で科目を作ってしまうため。
export async function discardInvalidCurrentYear(): Promise<void> {
  await db.transaction('rw', db.settings, async () => {
    const row = await db.settings.get('currentYear');
    if (row !== undefined && !isProcessingYear(row.value)) {
      await db.settings.delete('currentYear');
    }
  });
}
// 読めない処理年度を起動時点の西暦年へ置き換え、ホームで知らせるためにその年を記録する。
// 行が無いのは初回起動で、知らせる必要がないので触らない。
export async function resetInvalidCurrentYear(now: Date): Promise<number | null> {
  return db.transaction('rw', db.settings, async () => {
    const row = await db.settings.get('currentYear');
    if (row === undefined || isProcessingYear(row.value)) {
      return null;
    }
    const year = initialProcessingYear(now);
    const updatedAt = Date.now();
    await db.settings.bulkPut([
      { key: 'currentYear', value: year, updatedAt },
      { key: 'processingYearResetTo', value: year, updatedAt },
    ]);
    return year;
  });
}
