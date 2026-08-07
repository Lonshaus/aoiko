import { db } from '../db/db';
import type { SettingsMap } from './settings';
// 「次回から確認しない」で非表示にできる確認の一覧。設定画面の「非表示にした確認を
// 元に戻す」はここに載っているものをまとめて戻す。確認を増やしたらこの配列に足す。
const SUPPRESSIBLE_CONFIRM_KEYS = [
  'skipExternalSendConfirm',
  'skipAttachmentConfirm',
  'skipFiledYearWarning',
  'skipDownloadSavedConfirm',
] as const satisfies ReadonlyArray<keyof SettingsMap>;

export async function countSuppressedConfirms(): Promise<number> {
  const rows = await db.settings.bulkGet([...SUPPRESSIBLE_CONFIRM_KEYS]);
  return rows.filter((r) => r?.value === true).length;
}

export async function resetSuppressedConfirms(): Promise<void> {
  await db.settings.bulkDelete([...SUPPRESSIBLE_CONFIRM_KEYS]);
}
