import { afterEach, describe, expect, test } from 'vitest';
import { clearUnsavedGuard, hasUnsavedChanges, setUnsavedGuard, router } from './router.svelte';

const owners: object[] = [];

function guard(dirty: boolean): object {
  const owner = {};
  owners.push(owner);
  setUnsavedGuard(owner, dirty);
  return owner;
}

afterEach(() => {
  while (owners.length > 0) {
    clearUnsavedGuard(owners.pop()!);
  }
  router.stay();
  router.goto('/');
});

describe('setUnsavedGuard / hasUnsavedChanges', () => {
  test('登録が無ければ未保存なし', () => {
    expect(hasUnsavedChanges()).toBe(false);
  });

  test('登録した画面のどれか 1 つでも dirty なら未保存あり', () => {
    guard(false);
    expect(hasUnsavedChanges()).toBe(false);
    guard(true);
    expect(hasUnsavedChanges()).toBe(true);
  });

  test('同じ owner で false を渡すと解除される', () => {
    const owner = guard(true);
    expect(hasUnsavedChanges()).toBe(true);
    setUnsavedGuard(owner, false);
    expect(hasUnsavedChanges()).toBe(false);
  });

  test('clearUnsavedGuard でも解除される（画面の破棄時）', () => {
    const owner = guard(true);
    clearUnsavedGuard(owner);
    expect(hasUnsavedChanges()).toBe(false);
  });
});

describe('router.goto の未保存ガード', () => {
  test('未保存が無ければそのまま遷移する', () => {
    router.goto('/journal');
    expect(router.path).toBe('/journal');
    expect(router.pendingPath).toBeNull();
  });
  // ここが本題：ガードが無いと入力途中の画面から無言で離脱してしまう。
  test('未保存があると遷移せず確認待ちになる', () => {
    router.goto('/journal');
    guard(true);
    router.goto('/settings');
    expect(router.path).toBe('/journal');
    expect(router.pendingPath).toBe('/settings');
  });

  test('留まるを選ぶと遷移しない', () => {
    router.goto('/journal');
    guard(true);
    router.goto('/settings');
    router.stay();
    expect(router.path).toBe('/journal');
    expect(router.pendingPath).toBeNull();
  });

  test('破棄して移動を選ぶと遷移する', () => {
    router.goto('/journal');
    guard(true);
    router.goto('/settings');
    router.discardAndGo();
    expect(router.path).toBe('/settings');
    expect(router.pendingPath).toBeNull();
  });

  test('同じパスへの遷移は確認を出さない', () => {
    router.goto('/journal');
    guard(true);
    router.goto('/journal');
    expect(router.pendingPath).toBeNull();
  });
});
