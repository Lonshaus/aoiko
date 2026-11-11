import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

type StorageStub = { persisted?: () => Promise<boolean>; persist?: () => Promise<boolean> };

const originalStorage = Object.getOwnPropertyDescriptor(navigator, 'storage');

function stubStorage(stub: StorageStub): void {
  Object.defineProperty(navigator, 'storage', { value: stub, configurable: true });
}

async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('waitFor タイムアウト');
    }
    await new Promise((r) => setTimeout(r, 5));
  }
}
// 初期化はシングルトンの生成時に始まるため、テストごとにモジュールを読み直す。
async function freshManager() {
  vi.resetModules();
  const { backup } = await import('./backup.svelte');
  return backup;
}

beforeEach(() => {
  vi.stubGlobal('showDirectoryPicker', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
  if (originalStorage) {
    Object.defineProperty(navigator, 'storage', originalStorage);
  } else {
    Reflect.deleteProperty(navigator, 'storage');
  }
});

describe('backupManager の永続化ストレージの要求', () => {
  test('persist() が返らなくても初期化は終わり、storagePersisted は null のまま', async () => {
    const persist = vi.fn(() => new Promise<boolean>(() => {}));
    stubStorage({ persisted: async () => false, persist });
    const manager = await freshManager();

    await waitFor(() => manager.status !== 'initializing');

    expect(manager.status).toBe('unconfigured');
    expect(manager.adapterKind).toBe('fsa');
    expect(manager.storagePersisted).toBeNull();
    expect(persist).toHaveBeenCalledTimes(1);
  });

  test.each([true, false])(
    'persist() が %s を返したら storagePersisted が更新される',
    async (granted) => {
      let answer: (v: boolean) => void = () => {};
      const persist = vi.fn(() => new Promise<boolean>((r) => (answer = r)));
      stubStorage({ persisted: async () => false, persist });
      const manager = await freshManager();

      await waitFor(() => manager.status !== 'initializing');
      expect(manager.storagePersisted).toBeNull();
      answer(granted);
      await waitFor(() => manager.storagePersisted !== null);

      expect(manager.storagePersisted).toBe(granted);
    },
  );

  test('persisted() が true なら persist() は呼ばない', async () => {
    const persist = vi.fn(async () => false);
    stubStorage({ persisted: async () => true, persist });
    const manager = await freshManager();

    await waitFor(() => manager.storagePersisted !== null);

    expect(manager.storagePersisted).toBe(true);
    expect(persist).not.toHaveBeenCalled();
  });

  test('続けて初期化しても persist() の要求は 1 回だけ', async () => {
    const persist = vi.fn(() => new Promise<boolean>(() => {}));
    stubStorage({ persisted: async () => false, persist });
    const manager = await freshManager();
    const init = (manager as unknown as { initAdapter(): Promise<void> }).initAdapter.bind(manager);

    await waitFor(() => manager.status !== 'initializing');
    await init();
    await init();

    expect(persist).toHaveBeenCalledTimes(1);
  });

  test('persist() が例外を投げても初期化は終わり、storagePersisted は null のまま', async () => {
    stubStorage({
      persisted: async () => false,
      persist: async () => {
        throw new Error('テスト用の失敗');
      },
    });
    const manager = await freshManager();

    await waitFor(() => manager.status !== 'initializing');

    expect(manager.status).toBe('unconfigured');
    expect(manager.storagePersisted).toBeNull();
  });
});
