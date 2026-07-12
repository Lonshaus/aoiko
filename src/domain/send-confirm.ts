// 外部送信（クラウド AI）前の確認要否を判定する純ロジック。
// ローカルエンジン（将来の tesseract / localhost の openai-compatible）は
// 外部送信が無いため確認不要。利用者が「次回から確認しない」を選んだ場合も skip。

export interface ExternalSendTarget {
  /** 端末外へデータを送るか（クラウド AI = true、ローカル = false） */
  external: boolean;
  /** 送信先ホスト（例：generativelanguage.googleapis.com） */
  host: string;
}

export function shouldConfirmExternalSend(
  target: ExternalSendTarget,
  skipConfirmSetting: boolean | undefined,
): boolean {
  if (!target.external) {
    return false;
  }
  return skipConfirmSetting !== true;
}
