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
  // OCR/LLM エンジン選択（既定 gemini）。openai-compatible は Ollama 等ローカル AI
  ocrEngine: 'gemini' | 'openai-compatible';
  // OpenAI 互換エンドポイント（例：http://localhost:11434/v1）
  openaiBaseUrl: string;
  // OCR 用モデル（vision 必須）／LLM 分類用モデル（テキストのみで可）
  openaiOcrModel: string;
  openaiClassifyModel: string;
  // OpenAI 互換 API キー（ローカル Ollama 等では通常不要）
  openaiApiKey: string;
  // OCR/LLM の外部送信前確認をスキップ（利用者が「次回から確認しない」を選択）
  skipExternalSendConfirm: boolean;
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