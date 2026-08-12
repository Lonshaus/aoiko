import { describe, expect, test, vi } from 'vitest';
import { DeadlineExceededError, withDeadline } from './deadline';

describe('withDeadline', () => {
  test('時限内に終われば結果をそのまま返す', async () => {
    await expect(withDeadline(Promise.resolve(42), 50)).resolves.toBe(42);
  });

  test('元の拒否はそのまま伝える', async () => {
    const boom = new Error('boom');
    await expect(withDeadline(Promise.reject(boom), 50)).rejects.toBe(boom);
  });
  // 実測した挙動そのもの。クラウドから追い出されたファイルをオフラインで読むと、
  // 例外も errno も来ないまま返ってこない。
  test('返ってこない処理は時限で打ち切る', async () => {
    const never = new Promise<never>(() => {});
    await expect(withDeadline(never, 20)).rejects.toBeInstanceOf(DeadlineExceededError);
  });

  test('時限で打ち切っても元の処理は止まらない（止める手段が無い）', async () => {
    let settled = false;
    let release: (() => void) | undefined;
    const slow = new Promise<void>((resolve) => {
      release = () => {
        settled = true;
        resolve();
      };
    });

    await expect(withDeadline(slow, 20)).rejects.toBeInstanceOf(DeadlineExceededError);
    expect(settled).toBe(false);
    release?.();
    await slow;
    expect(settled).toBe(true);
  });
  // 時限に達しなかった場合にタイマーが残ると、テストもアプリも終われなくなる。
  test('先に決着したらタイマーを片付ける', async () => {
    const clear = vi.spyOn(globalThis, 'clearTimeout');
    await withDeadline(Promise.resolve('ok'), 10_000);
    expect(clear).toHaveBeenCalled();
    clear.mockRestore();
  });
});
