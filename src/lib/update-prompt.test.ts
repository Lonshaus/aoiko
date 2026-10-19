import { describe, expect, it } from 'vitest';
import { classifyNeedRefresh, refreshAction } from './update-prompt';

describe('classifyNeedRefresh', () => {
  it('controller が無いページは更新ではなくオフライン準備完了として扱う', () => {
    expect(classifyNeedRefresh(false)).toBe('offline-ready');
  });

  it('controller があれば更新として扱う', () => {
    expect(classifyNeedRefresh(true)).toBe('update');
  });
});

describe('refreshAction', () => {
  it('waiting が無ければ登録時の controller に関係なく再読み込みする', () => {
    expect(refreshAction(false, true)).toBe('reload');
    expect(refreshAction(false, false)).toBe('reload');
  });

  it('登録時に controller があれば skipWaiting のみ', () => {
    expect(refreshAction(true, true)).toBe('skip-waiting');
  });

  it('登録時に controller が無ければ skipWaiting の後に自前で再読み込みする', () => {
    expect(refreshAction(true, false)).toBe('skip-waiting-then-reload');
  });
});
