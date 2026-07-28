// ファイルを保存する。バックアップ zip・.xtx・XML・弥生 CSV の 4 箇所に同じ実装が
// 複製されていたため 1 箇所へ集約する。呼出側はファイルの中身と名前だけを渡す。
//
// 保存完了を待てるよう Promise を返す。「最終ダウンロード時刻」のように保存後の状態を
// 記録する呼出側が、保存の実装方式に関係なく正しい順序で書けるようにするため。
export async function saveFile(
  bytes: Uint8Array<ArrayBuffer>,
  filename: string,
  mimeType: string,
): Promise<void> {
  const blob = new Blob([bytes], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
// テキストを UTF-8 で書き出す（.xtx・XML 用）。
export async function saveTextFile(
  text: string,
  filename: string,
  mimeType: string,
): Promise<void> {
  await saveFile(new TextEncoder().encode(text), filename, mimeType);
}
