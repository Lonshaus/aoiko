import { afterEach, describe, expect, test, vi } from 'vitest';
import { NativeFolderBackupAdapter, decideNativeState, type NativeBackupFolder } from './native';

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubNative(
  overrides: Record<string, unknown> = {},
): Record<string, ReturnType<typeof vi.fn>> {
  const api = {
    backupChooseFolder: vi.fn(async () => ({ token: 'tok', name: 'aoiko-backup' })),
    backupIsReady: vi.fn(async () => true),
    backupWrite: vi.fn(async () => undefined),
    backupList: vi.fn(async () => ['aoiko-ledger-2026-07-28.zip']),
    backupRemove: vi.fn(async () => undefined),
    ...overrides,
  };
  vi.stubGlobal('window', { __aoikoNative: api });
  return api as Record<string, ReturnType<typeof vi.fn>>;
}
// 保存済みフォルダを差し替えられる最小の器。実装は settings（Dexie）を読むが、
// アダプタ自身は永続化方法を知らないので、テストではメモリ上で足りる。
function adapterWith(folder: NativeBackupFolder | null): {
  adapter: NativeFolderBackupAdapter;
  stored: () => NativeBackupFolder | null;
} {
  let current = folder;
  const adapter = new NativeFolderBackupAdapter(
    async () => current,
    async (f) => {
      current = f;
    },
  );
  return { adapter, stored: () => current };
}

const CONFIGURED: NativeBackupFolder = { token: 'tok', name: 'aoiko-backup' };

describe('NativeFolderBackupAdapter.isAvailable', () => {
  test('backupChooseFolder があれば利用可能', async () => {
    stubNative();
    expect(await adapterWith(null).adapter.isAvailable()).toBe(true);
  });

  test('__aoikoNative が無ければ利用不可（web 版）', async () => {
    vi.stubGlobal('window', {});
    expect(await adapterWith(null).adapter.isAvailable()).toBe(false);
  });
  // saveFile だけを持つ旧 wrapper。__aoikoNative の有無だけで判定すると、
  // フォルダ選択を呼んだ時点で初めて壊れる。関数単位で見る。
  test('__aoikoNative はあるが backupChooseFolder が無ければ利用不可', async () => {
    vi.stubGlobal('window', { __aoikoNative: { saveFile: vi.fn() } });
    expect(await adapterWith(null).adapter.isAvailable()).toBe(false);
  });
});

describe('NativeFolderBackupAdapter.isReady', () => {
  test('フォルダ未設定なら false（ネイティブは呼ばない）', async () => {
    const api = stubNative();
    expect(await adapterWith(null).adapter.isReady()).toBe(false);
    expect(api.backupIsReady).not.toHaveBeenCalled();
  });

  test('保存済み token をネイティブに渡して判定する', async () => {
    const api = stubNative();
    expect(await adapterWith(CONFIGURED).adapter.isReady()).toBe(true);
    expect(api.backupIsReady).toHaveBeenCalledWith('tok');
  });
  // iOS の bookmark が解決できなくなった / フォルダを削除された場合。
  test('token が解決できなくなったら false', async () => {
    stubNative({ backupIsReady: vi.fn(async () => false) });
    expect(await adapterWith(CONFIGURED).adapter.isReady()).toBe(false);
  });

  test('ensurePermission は isReady と同じ結果を返す', async () => {
    stubNative({ backupIsReady: vi.fn(async () => false) });
    const { adapter } = adapterWith(CONFIGURED);
    expect(await adapter.ensurePermission()).toBe(await adapter.isReady());
  });
});

describe('NativeFolderBackupAdapter.configure', () => {
  test('選択結果を token と表示名の両方で保存する', async () => {
    stubNative();
    const { adapter, stored } = adapterWith(null);
    await adapter.configure();
    expect(stored()).toEqual({ token: 'tok', name: 'aoiko-backup' });
  });
  // 呼出元は AbortError だけを「利用者が選択をやめた」として無視するため、
  // 取り消しが別のエラーになると設定画面にエラー表示が出てしまう。
  test('取り消しは AbortError として投げ、保存しない', async () => {
    stubNative({ backupChooseFolder: vi.fn(async () => null) });
    const { adapter, stored } = adapterWith(null);
    await expect(adapter.configure()).rejects.toMatchObject({ name: 'AbortError' });
    expect(stored()).toBeNull();
  });

  test('ネイティブが無い環境では AbortError ではなく通常のエラー', async () => {
    vi.stubGlobal('window', {});
    await expect(adapterWith(null).adapter.configure()).rejects.toThrow(
      'ネイティブのフォルダ選択が利用できません',
    );
  });
});

describe('NativeFolderBackupAdapter.backup', () => {
  function streamOf(bytes: number[]): ReadableStream<Uint8Array> {
    return new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(bytes));
        controller.close();
      },
    });
  }

  test('token・ファイル名・ストリームをそのままネイティブへ渡す', async () => {
    const api = stubNative();
    const stream = streamOf([1, 2, 3]);
    const result = await adapterWith(CONFIGURED).adapter.backup(
      stream,
      'aoiko-ledger-2026-07-28.zip',
    );
    expect(api.backupWrite).toHaveBeenCalledWith('tok', 'aoiko-ledger-2026-07-28.zip', stream);
    expect(result).toEqual({ fileName: 'aoiko-ledger-2026-07-28.zip' });
  });

  test('フォルダ未設定なら書き込まずに失敗する', async () => {
    const api = stubNative();
    await expect(
      adapterWith(null).adapter.backup(streamOf([1]), 'aoiko-ledger-2026-07-28.zip'),
    ).rejects.toThrow('バックアップフォルダが未設定です');
    expect(api.backupWrite).not.toHaveBeenCalled();
  });
  // 内容定址の版面では書き出し先が全部サブフォルダ付きになる。ここで弾くと
  // wrapper 版のバックアップが 1 件も通らない（#430）。
  test('サブフォルダ付きのパスをそのまま wrapper へ渡す', async () => {
    const api = stubNative();
    const path = 'attachments/' + 'a'.repeat(64);
    expect(await adapterWith(CONFIGURED).adapter.backup(streamOf([1]), path)).toEqual({
      fileName: path,
    });
    expect(api.backupWrite).toHaveBeenCalledWith(CONFIGURED.token, path, expect.anything());
  });

  test('組み立てられないパスは wrapper へ渡さない', async () => {
    const api = stubNative();
    await expect(
      adapterWith(CONFIGURED).adapter.backup(streamOf([1]), 'snapshots/../escape.json'),
    ).rejects.toThrow(RangeError);
    expect(api.backupWrite).not.toHaveBeenCalled();
  });
});

describe('NativeFolderBackupAdapter.read', () => {
  test('backupRead があれば token とパスを渡してバイト列を返す', async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const api = stubNative({ backupRead: vi.fn(async () => bytes) });
    expect(await adapterWith(CONFIGURED).adapter.read('snapshots/2026-08-09T120000Z.json')).toBe(
      bytes,
    );
    expect(api.backupRead).toHaveBeenCalledWith('tok', 'snapshots/2026-08-09T120000Z.json');
  });

  test('未同期は wrapper が null を返す（そのまま素通しする）', async () => {
    stubNative({ backupRead: vi.fn(async () => null) });
    expect(await adapterWith(CONFIGURED).adapter.read('attachments/x')).toBeNull();
  });
  // 能力が無いことを null で返すと「まだ同期されていない」と区別できず、
  // 読めるはずのスナップショットを黙って捨ててしまう。
  test('backupRead が無い wrapper では null ではなく例外', async () => {
    stubNative();
    await expect(adapterWith(CONFIGURED).adapter.read('snapshots/a.json')).rejects.toThrow(
      'ネイティブ側の backupRead が未実装',
    );
  });

  test('保存先の外を指すパスは wrapper へ渡さない', async () => {
    const api = stubNative({ backupRead: vi.fn(async () => null) });
    await expect(adapterWith(CONFIGURED).adapter.read('../secrets')).rejects.toThrow(RangeError);
    expect(api.backupRead).not.toHaveBeenCalled();
  });
});

describe('NativeFolderBackupAdapter.list / remove', () => {
  test('list は保存済みフォルダの一覧を返す', async () => {
    const api = stubNative();
    expect(await adapterWith(CONFIGURED).adapter.list()).toEqual(['aoiko-ledger-2026-07-28.zip']);
    expect(api.backupList).toHaveBeenCalledWith('tok');
  });
  // 汰換処理（pruneOldBackups）から呼ばれる。未設定を例外にすると、
  // 成功したバックアップが失敗として表示されてしまう。
  test('フォルダ未設定でも list は空配列で返す', async () => {
    stubNative();
    expect(await adapterWith(null).adapter.list()).toEqual([]);
  });

  test('remove は token とファイル名を渡す', async () => {
    const api = stubNative();
    await adapterWith(CONFIGURED).adapter.remove('aoiko-ledger-2026-07-01.zip');
    expect(api.backupRemove).toHaveBeenCalledWith('tok', 'aoiko-ledger-2026-07-01.zip');
  });

  test('フォルダ未設定なら remove は何もしない', async () => {
    const api = stubNative();
    await adapterWith(null).adapter.remove('aoiko-ledger-2026-07-01.zip');
    expect(api.backupRemove).not.toHaveBeenCalled();
  });

  test('remove もサブフォルダ付きのパスをそのまま渡す', async () => {
    const api = stubNative();
    const path = 'attachments/' + 'a'.repeat(64);
    await adapterWith(CONFIGURED).adapter.remove(path);
    expect(api.backupRemove).toHaveBeenCalledWith(CONFIGURED.token, path);
  });

  test('remove も組み立てられないパスは wrapper へ渡さない', async () => {
    const api = stubNative();
    await expect(adapterWith(CONFIGURED).adapter.remove('../escape')).rejects.toThrow(RangeError);
    expect(api.backupRemove).not.toHaveBeenCalled();
  });

  test('backupListDir があれば subdir を渡して一覧する', async () => {
    const api = stubNative({ backupListDir: vi.fn(async () => ['2026-08-09T120000Z.json']) });
    expect(await adapterWith(CONFIGURED).adapter.list('snapshots')).toEqual([
      '2026-08-09T120000Z.json',
    ]);
    expect(api.backupListDir).toHaveBeenCalledWith('tok', 'snapshots');
    expect(api.backupList).not.toHaveBeenCalled();
  });
  // 空配列で返すと「フォルダが空」と区別できず、汰換や GC が誤動作する。
  test('backupListDir が無い wrapper では空配列ではなく例外', async () => {
    stubNative();
    await expect(adapterWith(CONFIGURED).adapter.list('snapshots')).rejects.toThrow(
      'ネイティブ側の backupListDir が未実装',
    );
  });

  test('subdir 無しの list は従来どおり backupList を使う', async () => {
    const api = stubNative({ backupListDir: vi.fn(async () => []) });
    expect(await adapterWith(CONFIGURED).adapter.list()).toEqual(['aoiko-ledger-2026-07-28.zip']);
    expect(api.backupListDir).not.toHaveBeenCalled();
  });

  test('保存先の外を指す subdir は wrapper へ渡さない', async () => {
    const api = stubNative({ backupListDir: vi.fn(async () => []) });
    await expect(adapterWith(CONFIGURED).adapter.list('../..')).rejects.toThrow(RangeError);
    expect(api.backupListDir).not.toHaveBeenCalled();
  });
});
describe('decideNativeState', () => {
  test('保存済みフォルダが解決できれば idle', () => {
    expect(decideNativeState({ hasFolder: true, hasLegacyHandle: false, ready: true })).toBe(
      'idle',
    );
  });
  // wrapper 版へ移ってきた FSA 既存利用者。ここを unconfigured にすると
  // scheduleBackup が即 return し、設定済みのつもりのまま自動バックアップが止まる。
  test('FSA の handle しか無ければ reconfigure-required（未設定と区別する）', () => {
    expect(decideNativeState({ hasFolder: false, hasLegacyHandle: true, ready: false })).toBe(
      'reconfigure-required',
    );
  });

  test('どちらも無ければ unconfigured', () => {
    expect(decideNativeState({ hasFolder: false, hasLegacyHandle: false, ready: false })).toBe(
      'unconfigured',
    );
  });
  // iOS の security-scoped bookmark 失効、フォルダの削除・移動。
  test('フォルダはあるが解決できなければ reconfigure-required', () => {
    expect(decideNativeState({ hasFolder: true, hasLegacyHandle: false, ready: false })).toBe(
      'reconfigure-required',
    );
  });
  // 新しい保存先が決まった後に古い handle が残っていても、そちらを優先しない。
  test('新旧が両方あればネイティブ側を優先する', () => {
    expect(decideNativeState({ hasFolder: true, hasLegacyHandle: true, ready: true })).toBe('idle');
  });
});
