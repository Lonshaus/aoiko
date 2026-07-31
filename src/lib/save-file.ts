// ファイルを保存する。バックアップ zip・.xtx・XML・弥生 CSV の 4 箇所に同じ実装が
// 複製されていたため 1 箇所へ集約する。呼出側はファイルの中身と名前だけを渡す。
//
// 戻り値は「利用者が保存を完了したことを観測できたか」。既定は <a> のダウンロードで、
// 完了も取消も観測できないため常に true を返す（従来どおりの近似）。
//
// confirmCompletion を指定した場合だけ、File System Access が使える環境で保存先の確定まで
// 待ち、取消を取消として区別する。保存済みを主張する記録（バックアップの最終ダウンロード
// 時刻）を残す呼出側のためのオプションで、既定にはしない：picker を挟むと保存ダイアログの
// 挙動が変わり、.xtx や CSV の書き出しまで UX が変わってしまうため。
export async function saveFile(
  data: Uint8Array<ArrayBuffer> | ReadableStream<Uint8Array>,
  filename: string,
  mimeType: string,
  options?: { confirmCompletion?: boolean },
): Promise<boolean> {
  let blob: Blob;
  if (data instanceof ReadableStream) {
    const rawBlob = await new Response(data).blob();
    // Response(stream).blob() は type が空になるため貼り直す。slice はコピーせず
    // 同一バイト列への view を返すのでストリーミングで抑えたメモリ増を保つ。
    blob = rawBlob.slice(0, rawBlob.size, mimeType);
  } else {
    blob = new Blob([data], { type: mimeType });
  }
  const picker = (
    window as unknown as {
      showSaveFilePicker?: (opts: {
        suggestedName: string;
        types: Array<{ accept: Record<string, string[]> }>;
      }) => Promise<FileSystemFileHandle>;
    }
  ).showSaveFilePicker;
  if (options?.confirmCompletion && typeof picker === 'function') {
    const ext = filename.slice(filename.lastIndexOf('.'));
    try {
      const handle = await picker({
        suggestedName: filename,
        types: [{ accept: { [mimeType]: [ext] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return true;
    } catch (e: unknown) {
      // 利用者が保存先の選択を取り消した場合。エラーではないので静かに戻す。
      if (e instanceof DOMException && e.name === 'AbortError') {
        return false;
      }
      throw e;
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  return true;
}
// テキストを UTF-8 で書き出す（.xtx・XML 用）。
export async function saveTextFile(
  text: string,
  filename: string,
  mimeType: string,
): Promise<boolean> {
  return saveFile(new TextEncoder().encode(text), filename, mimeType);
}
