// ファイルを保存する。バックアップ zip・.xtx・XML・弥生 CSV の 4 箇所に同じ実装が
// 複製されていたため 1 箇所へ集約する。呼出側はファイルの中身と名前だけを渡す。
//
// 戻り値は「利用者が保存を完了したことを観測できたか」。既定は <a> のダウンロードで、
// 完了も取消も観測できないため常に 'unknown' を返す（あるブラウザ / あるブラウザ）。
//
// confirmCompletion を指定した場合だけ、File System Access が使える環境で保存先の確定まで
// 待ち、'saved'／'cancelled' を区別する。保存済みを主張する記録（バックアップの最終ダウンロード
// 時刻）を残す呼出側のためのオプションで、既定にはしない：picker を挟むと保存ダイアログの
// 挙動が変わり、.xtx や CSV の書き出しまで UX が変わってしまうため。
//
// ⚠ showSaveFilePicker は一時的なユーザー操作（transient activation、あるブラウザ ではおよそ
// 5秒）の間しか開けない。中身を先に用意すると大きな帳簿・証憑写真で活性化が切れ、
// SecurityError で保存できなくなる（chromium issue 40175286）。そのため picker を最初に
// 呼び、保存先が確定してから中身を作る。データを遅延生成する関数も受け取れるのはこのため。
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
  // Response(stream).blob() は type が空になるため貼り直す。slice はコピーせず
  // 同一バイト列への view を返すのでストリーミングで抑えたメモリ増を保つ。
  return rawBlob.slice(0, rawBlob.size, mimeType);
}
// テキストを UTF-8 で書き出す（.xtx・XML 用）。
export async function saveTextFile(
  text: string,
  filename: string,
  mimeType: string,
): Promise<SaveFileResult> {
  return saveFile(new TextEncoder().encode(text), filename, mimeType);
}
