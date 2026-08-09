import { splitBackupPath } from './content-store';
// FSA（同期フォルダ）と OPFS は同じ FileSystem ハンドル API を使うため、
// パスの下降だけを共有する。検証は splitBackupPath に一本化する。
export async function descendDir(
  root: FileSystemDirectoryHandle,
  segments: readonly string[],
  create: boolean,
): Promise<FileSystemDirectoryHandle> {
  let dir = root;
  for (const segment of segments) {
    dir = await dir.getDirectoryHandle(segment, { create });
  }
  return dir;
}

export async function resolveParent(
  root: FileSystemDirectoryHandle,
  path: string,
  create: boolean,
): Promise<{ dir: FileSystemDirectoryHandle; name: string }> {
  const segments = splitBackupPath(path);
  const name = segments.pop();
  if (name === undefined) {
    throw new RangeError(`invalid backup path: ${JSON.stringify(path)}`);
  }
  return { dir: await descendDir(root, segments, create), name };
}
// 「まだ同期されていない」として通常分岐に落としてよいのは NotFoundError だけ。
// 権限拒否や IO 失敗まで飲み込むと、実際の失敗が空表示として素通りする。
export function isNotFoundError(e: unknown): boolean {
  return e instanceof Error && e.name === 'NotFoundError';
}
