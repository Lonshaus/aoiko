import { describe, expect, test } from 'vitest';
import { DataCheckStore } from './data-check.svelte';
import type { DataCheckResult } from '../domain/data-check';

const empty: DataCheckResult = { total: 0, tables: [], fingerprint: '' };

function counting(result: DataCheckResult = empty) {
  const calls = { count: 0 };
  const check = async () => {
    calls.count += 1;
    return result;
  };
  return { calls, check };
}

describe('DataCheckStore', () => {
  test('ensureStarted は 2 回呼んでも 1 回しか点検しない', async () => {
    const { calls, check } = counting();
    const store = new DataCheckStore(check);
    expect(store.status).toBe('idle');
    await Promise.all([store.ensureStarted(), store.ensureStarted()]);
    await store.ensureStarted();
    expect(calls.count).toBe(1);
    expect(store.status).toBe('done');
    expect(store.result).toEqual(empty);
  });

  test('rerun はもう一度点検する', async () => {
    const { calls, check } = counting();
    const store = new DataCheckStore(check);
    await store.ensureStarted();
    await store.rerun();
    expect(calls.count).toBe(2);
    expect(store.status).toBe('done');
  });

  test('点検中は running', async () => {
    let release: (r: DataCheckResult) => void = () => {};
    const store = new DataCheckStore(
      () =>
        new Promise<DataCheckResult>((resolve) => {
          release = resolve;
        }),
    );
    const running = store.ensureStarted();
    expect(store.status).toBe('running');
    release(empty);
    await running;
    expect(store.status).toBe('done');
  });

  test('点検が例外を投げたら error になり、rejection を外へ出さない', async () => {
    const store = new DataCheckStore(async () => {
      throw new Error('DatabaseClosedError');
    });
    await expect(store.ensureStarted()).resolves.toBeUndefined();
    expect(store.status).toBe('error');
    expect(store.error).toBe('DatabaseClosedError');
    expect(store.result).toBeNull();
  });

  test('後から始めた点検の結果だけを残す', async () => {
    const releases: ((r: DataCheckResult) => void)[] = [];
    const store = new DataCheckStore(
      () =>
        new Promise<DataCheckResult>((resolve) => {
          releases.push(resolve);
        }),
    );
    const first = store.ensureStarted();
    const second = store.rerun();
    const newer: DataCheckResult = { total: 1, tables: [], fingerprint: 'b' };
    releases[1]?.(newer);
    await second;
    releases[0]?.({ total: 2, tables: [], fingerprint: 'a' });
    await first;
    expect(store.result).toEqual(newer);
    expect(store.status).toBe('done');
  });
});
