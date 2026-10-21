import { describe, expect, it } from 'vitest';
import { abortError, raceAbort } from './abort';

describe('raceAbort', () => {
  it('signal が無ければ元の Promise をそのまま返す', async () => {
    await expect(raceAbort(undefined, Promise.resolve(1))).resolves.toBe(1);
  });

  it('終わらない処理でも中止で AbortError になる', async () => {
    const controller = new AbortController();
    const pending = raceAbort(controller.signal, new Promise<never>(() => {}));
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('中止済みなら即座に拒否し、元の処理の失敗は握りつぶす', async () => {
    const controller = new AbortController();
    controller.abort();
    const work = Promise.reject(new Error('late'));
    await expect(raceAbort(controller.signal, work)).rejects.toMatchObject({
      name: 'AbortError',
    });
  });

  it('中止前に終われば結果を返す', async () => {
    const controller = new AbortController();
    await expect(raceAbort(controller.signal, Promise.resolve('ok'))).resolves.toBe('ok');
  });

  it('中止後に元の処理が失敗しても未処理の拒否にならない', async () => {
    const controller = new AbortController();
    let fail!: (e: Error) => void;
    const work = new Promise<never>((_, reject) => {
      fail = reject;
    });
    const pending = raceAbort(controller.signal, work);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    fail(new Error('after'));
    await Promise.resolve();
  });

  it('abortError は AbortError 名を持つ', () => {
    expect(abortError().name).toBe('AbortError');
  });
});
