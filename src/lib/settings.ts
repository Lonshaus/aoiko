import { db } from '../db/db';
import type { SimplifiedTaxCategory } from '../tax-schema/2026/simplified-tax';
import type { TaxFilingMethod, TaxRegistration } from '../db/types';

export type SettingsMap = {
  currentYear: number;
  backupFolderHandle: FileSystemDirectoryHandle | null;
  lastBackupAt: number | null;
  lastDownloadAt: number | null;
  homeOfficeDefaultRatio: string;
  userBusinessName: string;
  userInvoiceNumber: string;
  geminiApiKey: string;
  disclaimerAcceptedAt: number | null;
  disclaimerAcceptedVersion: number | null;
  // 消費税関連設定
  taxRegistration: TaxRegistration;
  taxFilingMethod: TaxFilingMethod;
  simplifiedTaxCategory: SimplifiedTaxCategory;
};
// DISCLAIMER.md の内容が本質的に変わったらインクリメントする。
// バージョン mismatch で再同意を要求する。
export const DISCLAIMER_VERSION = 1;

export async function getSetting<K extends keyof SettingsMap>(
  key: K
): Promise<SettingsMap[K] | undefined> {
  const row = await db.settings.get(key);
  return row?.value as SettingsMap[K] | undefined;
}

export async function setSetting<K extends keyof SettingsMap>(
  key: K,
  value: SettingsMap[K]
): Promise<void> {
  await db.settings.put({ key, value, updatedAt: Date.now() });
}

export async function deleteSetting<K extends keyof SettingsMap>(key: K): Promise<void> {
  await db.settings.delete(key);
}