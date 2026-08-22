import { afterEach, describe, expect, test, vi } from 'vitest';
import { isOffline } from './network-status';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('isOffline', () => {
  test('navigator.onLine が false ならオフライン', () => {
    vi.stubGlobal('navigator', { onLine: false });
    expect(isOffline()).toBe(true);
  });

  test('navigator.onLine が true ならオンライン', () => {
    vi.stubGlobal('navigator', { onLine: true });
    expect(isOffline()).toBe(false);
  });
});
