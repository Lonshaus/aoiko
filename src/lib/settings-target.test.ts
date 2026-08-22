import { beforeEach, describe, expect, test } from 'vitest';
import { stashSettingsTarget, takeSettingsTarget } from './settings-target';

beforeEach(() => {
  sessionStorage.clear();
});

describe('settings-target', () => {
  test('預けた行き先を取り出せる', () => {
    stashSettingsTarget('backup');
    expect(takeSettingsTarget()).toBe('backup');
  });

  test('取り出したら消える', () => {
    stashSettingsTarget('backup');
    takeSettingsTarget();
    expect(takeSettingsTarget()).toBeNull();
  });

  test('預けていなければ null', () => {
    expect(takeSettingsTarget()).toBeNull();
  });

  // 古いタブが残した値や手で書き換えた値を、そのまま行き先として扱わない。
  test('知らない値は null', () => {
    sessionStorage.setItem('aoiko:settings-target', 'nowhere');
    expect(takeSettingsTarget()).toBeNull();
  });
});
