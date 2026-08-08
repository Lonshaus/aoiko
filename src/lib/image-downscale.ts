// vision LLM は内部でタイルに分割して縮小するので、4000px 級のスマホ写真をそのまま送っても
// 精度は上がらず通信量と待ち時間だけ増える。領収書の小さい印字が潰れない 2048px を上限にする。
export const MAX_UPLOAD_EDGE = 2048;
// 再エンコードの品質。領収書は文字が読めれば良いが、下げすぎると小さい数字が滲む。
const JPEG_QUALITY = 0.85;

export function scaledSize(
  width: number,
  height: number,
  maxEdge: number,
): { width: number; height: number } | null {
  const longEdge = Math.max(width, height);
  if (longEdge <= maxEdge) {
    return null;
  }
  const ratio = maxEdge / longEdge;
  return {
    width: Math.max(1, Math.round(width * ratio)),
    height: Math.max(1, Math.round(height * ratio)),
  };
}
// 縮小できなくても throw しない。OCR に送れないより大きいまま送る方がまし。
export async function downscaleForUpload(file: Blob, maxEdge = MAX_UPLOAD_EDGE): Promise<Blob> {
  if (typeof createImageBitmap !== 'function' || typeof OffscreenCanvas !== 'function') {
    return file;
  }
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return file;
  }
  try {
    const size = scaledSize(bitmap.width, bitmap.height, maxEdge);
    if (!size) {
      return file;
    }
    const canvas = new OffscreenCanvas(size.width, size.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return file;
    }
    ctx.drawImage(bitmap, 0, 0, size.width, size.height);
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: JPEG_QUALITY });
    // 縮小したのに大きくなる場合（元が高圧縮の JPEG 等）は元を使う
    return blob.size < file.size ? blob : file;
  } catch {
    return file;
  } finally {
    bitmap.close();
  }
}
