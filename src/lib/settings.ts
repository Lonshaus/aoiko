import { db } from '../db/db';
import type { SimplifiedTaxCategory } from '../tax-schema/2026/simplified-tax';
import type { AoiroDeductionKind } from '../tax-schema/2026/aoiro-deduction';
import type { FilingType } from '../tax-schema/2026/xtx';
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
  // OCR/LLM エンジン選択（既定 gemini）。
  // - openai-compatible：Ollama 等のローカル / OpenAI 互換 vision LLM
  // - tesseract：WASM の純ローカル OCR（LLM 不要。精度は限定的、人手確認前提）
  ocrEngine: 'gemini' | 'openai-compatible' | 'tesseract';
  // OpenAI 互換エンドポイント（例：http://localhost:11434/v1）
  openaiBaseUrl: string;
  // OCR 用モデル（vision 必須）／LLM 分類用モデル（テキストのみで可）
  openaiOcrModel: string;
  openaiClassifyModel: string;
  // OpenAI 互換 API キー（ローカル Ollama 等では通常不要）
  openaiApiKey: string;
  // Tesseract traineddata の取得元。空＝tesseract.js 既定の CDN を使用。
  // 完全オフラインで運用したい場合は jpn.traineddata / eng.traineddata を
  // 自己ホストした URL（末尾スラッシュ無し）を指定する。
  tesseractLangPath: string;
  // OCR/LLM の外部送信前確認をスキップ（利用者が「次回から確認しない」を選択）
  skipExternalSendConfirm: boolean;
  // バックアップ・エクスポートに API キーを含めるか（既定 false）。
  // クラウド同期フォルダへ平文の API キーが書き出されるのを防ぐため、明示的に有効化した場合のみ含める。
  backupIncludeApiKeys: boolean;
  disclaimerAcceptedAt: number | null;
  disclaimerAcceptedVersion: number | null;
  // 消費税関連設定
  taxRegistration: TaxRegistration;
  taxFilingMethod: TaxFilingMethod;
  simplifiedTaxCategory: SimplifiedTaxCategory;
  // 本則課税で課税売上高5億円超または課税売上割合95%未満の場合の控除計算方式
  consumptionTaxAttributionMethod: 'individual' | 'proportional';
  // 申告者情報（e-Tax 提出用）。.xtx の IT部（定義側）必須項目に対映する。
  // 個人情報のため、バックアップには既定で含めない（backupIncludeFilerInfo）。
  userRiyoshaId: string;        // 利用者識別番号（16桁）
  userFilerName: string;        // 氏名・名称（NOZEISHA_NM）
  userFilerZip: string;         // 郵便番号（7桁・ハイフン無し、NOZEISHA_ZIP）
  userFilerAddress: string;     // 住所（NOZEISHA_ADR）
  userZeimushoCode: string;     // 提出先税務署コード（5桁、gen:zeimusho_CD）
  userZeimushoName: string;     // 提出先税務署名（任意、gen:zeimusho_NM）
  // 確定申告方式（.xtx 出力の様式・青色申告特別控除の適用可否に影響）
  filingType: FilingType;
  // 青色申告特別控除の区分（事業所得・控除額の算定に使用。青色申告のみ）
  aoiroDeductionKind: AoiroDeductionKind;
  // 申告者情報をバックアップ・エクスポートに含めるか（既定 false）。
  backupIncludeFilerInfo: boolean;
};
// DISCLAIMER.md の内容が本質的に変わったらインクリメントする。
// バージョン mismatch で再同意を要求する。
// v2: .xtx を「仮実装・実申告利用禁止」→「事業部分まで対映・DL版で組み込み可」に改訂。
// v3: 白色申告対応（KOA110・専従者控除は利用者が e-Tax 上で補完）を追記。
export const DISCLAIMER_VERSION = 3;

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