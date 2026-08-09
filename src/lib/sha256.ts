// 証憑写真の内容定址に使う。同じ写真は何度貼っても同じ名前になるので、フォルダ
// バックアップ側では 1 つしか置かず、変わっていないものを書き直さずに済む（#397）。
export async function sha256Hex(
  data: Blob | ArrayBuffer | Uint8Array<ArrayBuffer>,
): Promise<string> {
  // Blob かどうかは instanceof で見ない。別の realm の Blob（テストで使う Node 組込みのもの）は
  // false になり、そのまま digest へ渡って型エラーになる。arrayBuffer() を持つかで判定する。
  // 読み出した中身は Uint8Array へ包み直す。digest は引数の型を厳しく見るため。
  const asBlob = data as Blob;
  const source: BufferSource =
    typeof asBlob.arrayBuffer === 'function'
      ? new Uint8Array(await asBlob.arrayBuffer())
      : (data as BufferSource);
  const digest = await crypto.subtle.digest('SHA-256', source);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
