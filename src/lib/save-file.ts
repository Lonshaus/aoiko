// ブラウザのダウンロード機能でファイルを保存する。
// バックアップ zip・.xtx・XML・弥生 CSV の 4 箇所に同じ実装が複製されていたため
// 1 箇所へ集約する。呼出側はファイルの中身と名前だけを渡す。
export function saveFile(bytes: Uint8Array, filename: string, mimeType: string): void {
  // slice() でコピーを渡すのは、fflate 等が返す Uint8Array<ArrayBufferLike> と
  // BlobPart が要求する ArrayBuffer 限定の型が一致しないため。
  const blob = new Blob([bytes.slice()], { type: mimeType });
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
export function saveTextFile(text: string, filename: string, mimeType: string): void {
  saveFile(new TextEncoder().encode(text), filename, mimeType);
}
