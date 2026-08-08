import { db } from '../db/db';
import type { SimplifiedTaxCategory } from '../tax-schema/2026/simplified-tax';
import type { AoiroDeductionKind } from '../tax-schema/2026/aoiro-deduction';
import type { FilingType } from '../tax-schema/2026/xtx';
import type { TaxFilingMethod, TaxRegistration } from '../db/types';
import type { BackupIntervalHours, BackupRetentionCount } from '../backup/schedule';
import type { NativeBackupFolder } from '../backup/native';

export type SettingsMap = {
  currentYear: number;
  backupFolderHandle: FileSystemDirectoryHandle | null;
  // token は端末固有なのでバックアップに含めない（payload.ts の SKIP_SETTING_KEYS）。
  nativeBackupFolder: NativeBackupFolder | null;
  lastBackupAt: number | null;
  lastDownloadAt: number | null;
  // 0 = 変更のたび（既定）。
  backupIntervalHours: BackupIntervalHours;
  // 0 = 削除しない（既定）。
  backupRetentionCount: BackupRetentionCount;
  // accountCode → '0.30' 等、0〜1 の Decimal 文字列。
  homeOfficeAccountRatios: Record<string, string>;
  userBusinessName: string;
  userInvoiceNumber: string;
  geminiApiKey: string;
  // 既定 gemini。tesseract は WASM の純ローカル OCR で、精度が低く人手確認が前提。
  ocrEngine: 'gemini' | 'openai-compatible' | 'tesseract';
  // OpenAI 互換エンドポイント（例：http://localhost:11434/v1）
  openaiBaseUrl: string;
  // OCR 側は vision 必須。分類側はテキストのみで可。
  openaiOcrModel: string;
  openaiClassifyModel: string;
  // ローカル Ollama 等では通常不要。
  openaiApiKey: string;
  // 空＝同梱のものを使う。指定する場合は jpn/eng.traineddata を置いた URL（末尾スラッシュ無し）。
  tesseractLangPath: string;
  // 外部送信前の確認をスキップ。
  skipExternalSendConfirm: boolean;
  // 既定 false。同期フォルダへ平文の API キーが出るため、明示的に有効化した場合だけ含める。
  backupIncludeApiKeys: boolean;
  disclaimerAcceptedAt: number | null;
  disclaimerAcceptedVersion: number | null;
  taxRegistration: TaxRegistration;
  taxFilingMethod: TaxFilingMethod;
  simplifiedTaxCategory: SimplifiedTaxCategory;
  // 本則課税で課税売上高5億円超または課税売上割合95%未満の場合の控除計算方式
  consumptionTaxAttributionMethod: 'individual' | 'proportional';
  // .xtx の IT部（定義側）必須項目。個人情報なのでバックアップ既定は含めない。
  userRiyoshaId: string; // 利用者識別番号（16桁）
  userFilerName: string; // 氏名・名称（NOZEISHA_NM）
  userFilerZip: string; // 郵便番号（7桁・ハイフン無し、NOZEISHA_ZIP）
  userFilerAddress: string; // 住所（NOZEISHA_ADR）
  userZeimushoCode: string; // 提出先税務署コード（5桁、gen:zeimusho_CD）
  userZeimushoName: string; // 提出先税務署名（任意、gen:zeimusho_NM）
  filingType: FilingType;
  aoiroDeductionKind: AoiroDeductionKind;
  // 既定 false。
  backupIncludeFilerInfo: boolean;
  // 既定 false のオプトイン。切っている間は関連する画面要素が出ない。
  realEstateIncomeEnabled: boolean;
  // 期末棚卸高の自動計算（最終仕入原価法）。未設定は true 扱い——届出が無ければ
  // 法定デフォルトがこの方法のため。他の評価方法を届け出ている利用者は false にする。
  inventoryAutoValuationEnabled: boolean;
  // 証憑原本の添付前確認をスキップ。
  skipAttachmentConfirm: boolean;
  // <a download> 経路（Firefox / Safari）の保存確認をスキップ。
  skipDownloadSavedConfirm: boolean;
  // 申告済み年度への書き込み警告をスキップ（suppressed-confirms.ts で戻せる）。
  skipFiledYearWarning: boolean;
  // 未設定時は invoice.ts の DEFAULT_INVOICE_PREFIX / DEFAULT_QUOTE_PREFIX。
  invoiceNumberPrefix: string;
  quoteNumberPrefix: string;
};
// DISCLAIMER.md の内容が本質的に変わったらインクリメントする。
// バージョン mismatch で再同意を要求する。
// v2: .xtx を「仮実装・実申告利用禁止」→「事業部分まで対映・DL版で組み込み可」に改訂。
// v3: 白色申告対応（KOA110・専従者控除は利用者が e-Tax 上で補完）を追記。
// v4: 所得控除・税額の条件付き出力（所得控除画面入力時）と消費税申告書 .xtx 対応を反映。
// v5: ブラウザ自身による自動データ削除（容量逼迫時の退避・Safari の非訪問 7 日消去）を追記。
export const DISCLAIMER_VERSION = 5;

export async function getSetting<K extends keyof SettingsMap>(
  key: K,
): Promise<SettingsMap[K] | undefined> {
  const row = await db.settings.get(key);
  return row?.value as SettingsMap[K] | undefined;
}

export async function setSetting<K extends keyof SettingsMap>(
  key: K,
  value: SettingsMap[K],
): Promise<void> {
  await db.settings.put({ key, value, updatedAt: Date.now() });
}

export async function deleteSetting<K extends keyof SettingsMap>(key: K): Promise<void> {
  await db.settings.delete(key);
}
