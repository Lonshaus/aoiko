import { afterEach, describe, expect, test, vi } from 'vitest';
import { OpfsBackupAdapter } from './opfs';

afterEach(() => {
  vi.unstubAllGlobals();
});

// createWritable を持つ最小のダミー。実体は使わず prototype の有無だけを見る。
class WritableCapableHandle {
  createWritable() {}
}

class ReadOnlyHandle {}

describe('OpfsBackupAdapter.isAvailable', () => {
  test('getDirectory と createWritable が揃っていれば利用可能', async () => {
    vi.stubGlobal('navigator', { storage: { getDirectory: () => {} } });
    vi.stubGlobal('FileSystemFileHandle', WritableCapableHandle);
    expect(await new OpfsBackupAdapter().isAvailable()).toBe(true);
  });
  // Safari 15.2〜18 相当。getDirectory はあるが書き込み API が無い環境で、
  // 利用可能と誤判定すると書き込み時まで失敗が表面化しない。
  test('createWritable が無ければ利用不可', async () => {
    vi.stubGlobal('navigator', { storage: { getDirectory: () => {} } });
    vi.stubGlobal('FileSystemFileHandle', ReadOnlyHandle);
    expect(await new OpfsBackupAdapter().isAvailable()).toBe(false);
  });

  test('FileSystemFileHandle 自体が無ければ利用不可', async () => {
    vi.stubGlobal('navigator', { storage: { getDirectory: () => {} } });
    vi.stubGlobal('FileSystemFileHandle', undefined);
    expect(await new OpfsBackupAdapter().isAvailable()).toBe(false);
  });

  test('getDirectory が無ければ利用不可', async () => {
    vi.stubGlobal('navigator', { storage: {} });
    vi.stubGlobal('FileSystemFileHandle', WritableCapableHandle);
    expect(await new OpfsBackupAdapter().isAvailable()).toBe(false);
  });

  test('storage 自体が無ければ利用不可', async () => {
    vi.stubGlobal('navigator', {});
    vi.stubGlobal('FileSystemFileHandle', WritableCapableHandle);
    expect(await new OpfsBackupAdapter().isAvailable()).toBe(false);
  });
});
