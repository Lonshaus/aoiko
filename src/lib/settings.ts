import { db } from '../db/db';

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
};

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