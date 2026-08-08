// 戻り値は「保存の完了を観測できたか」。既定の <a> ダウンロードは完了も取消も観測できないので
// 常に 'unknown'。confirmCompletion のときだけ File System Access で保存先の確定を待つ——
// 既定にしないのは picker を挟むと .xtx や CSV の書き出しまで挙動が変わるため。
//
// ⚠ showSaveFilePicker は transient activation（Chromium で約 5 秒）の間しか開けない。中身を
// 先に用意すると大きな帳簿で活性化が切れ SecurityError になる（chromium issue 40175286）。
// picker を先に呼び、保存先が決まってから中身を作る。遅延生成の関数を受け取れるのはこのため。
export type SaveFileData = Uint8Array<ArrayBuffer> | ReadableStream<Uint8Array>;
export type SaveFileResult = 'saved' | 'cancelled' | 'unknown';

export async function saveFile(
  data: SaveFileData | (() => Promise<SaveFileData>),
  filename: string,
  mimeType: string,
  options?: { confirmCompletion?: boolean },
): Promise<SaveFileResult> {
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
    let handle: FileSystemFileHandle;
    try {
      handle = await picker({
        suggestedName: filename,
        types: [{ accept: { [mimeType]: [ext] } }],
      });
    } catch (e: unknown) {
      // 利用者が保存先の選択を取り消した場合。エラーではないので静かに戻す。
      if (e instanceof DOMException && e.name === 'AbortError') {
        return 'cancelled';
      }
      throw e;
    }
    // 保存先が確定した後の失敗は取消ではないため、例外はそのまま呼出側へ投げる。
    const resolved = await resolveData(data);
    const writable = await handle.createWritable();
    if (resolved instanceof ReadableStream) {
      // pipeTo は成功時に writable を閉じる。zip 全体をメモリへ展開せずに書き出せる。
      await resolved.pipeTo(writable);
    } else {
      await writable.write(resolved);
      await writable.close();
    }
    return 'saved';
  }
  const blob = await toBlob(await resolveData(data), mimeType);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  return 'unknown';
}

async function resolveData(
  data: SaveFileData | (() => Promise<SaveFileData>),
): Promise<SaveFileData> {
  return typeof data === 'function' ? await data() : data;
}

async function toBlob(data: SaveFileData, mimeType: string): Promise<Blob> {
  if (!(data instanceof ReadableStream)) {
    return new Blob([data], { type: mimeType });
  }
  const rawBlob = await new Response(data).blob();
  // Response(stream).blob() は type が空になるので貼り直す。slice はコピーせず view を返すため、
  // ストリーミングで抑えたメモリは保たれる。
  return rawBlob.slice(0, rawBlob.size, mimeType);
}
export async function saveTextFile(
  text: string,
  filename: string,
  mimeType: string,
): Promise<SaveFileResult> {
  return saveFile(new TextEncoder().encode(text), filename, mimeType);
}
