// 証憑写真の添付前確認ダイアログの要否を判定する純ロジック（C7-3）。
// 確定後は不可竄改のため、鎖める前の最後のチェックポイントとして毎回確認するのが既定。
// 利用者が「次回から確認しない」を選んだ場合のみスキップする。
export function shouldConfirmAttachment(skipConfirmSetting: boolean | undefined): boolean {
  return skipConfirmSetting !== true;
}