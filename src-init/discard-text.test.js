import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDiscardText } from './discard-text.js';
// app が訳を渡してくる前に押されると既定が出る。既定が日本語で固定されていた頃の挙動と
// 同じなので、渡し損ねても誤った案内にはならない。ここが崩れると、文言の無いボタンや
// 英語 UI に日本語のダイアログが出る。
const KEYS = ['closeMessage', 'closeOk', 'reloadMessage', 'reloadOk', 'cancel'];

test('渡される前は日本語の既定が出る', () => {
  const text = createDiscardText().get();
  assert.deepEqual(Object.keys(text).sort(), [...KEYS].sort());
  assert.equal(text.closeOk, '破棄して終了');
  assert.equal(text.cancel, '編集を続ける');
});

test('渡された文言に差し替わる', () => {
  const discard = createDiscardText();
  discard.set({
    closeMessage: 'You have unsaved input. Discard it and quit?',
    closeOk: 'Discard and quit',
    reloadMessage: 'You have unsaved input. Discard it and reload?',
    reloadOk: 'Discard and reload',
    cancel: 'Keep editing',
  });
  assert.equal(discard.get().closeOk, 'Discard and quit');
  assert.equal(discard.get().cancel, 'Keep editing');
});

test('足りない分は既定のまま残る', () => {
  const discard = createDiscardText();
  discard.set({ closeOk: '捨棄並結束' });
  assert.equal(discard.get().closeOk, '捨棄並結束');
  assert.equal(discard.get().cancel, '編集を続ける');
});

// 空文字を採ると、文言の無いボタンが出る。
test('空文字・非文字列・未知のキーは採らない', () => {
  const discard = createDiscardText();
  discard.set({ closeOk: '', cancel: null, reloadOk: 42, unknownKey: 'x' });
  const text = discard.get();
  assert.equal(text.closeOk, '破棄して終了');
  assert.equal(text.cancel, '編集を続ける');
  assert.equal(text.reloadOk, '破棄して再読み込み');
  assert.equal(Object.keys(text).length, KEYS.length);
});

test('渡されなかったとき（undefined）でも落ちない', () => {
  const discard = createDiscardText();
  discard.set(undefined);
  assert.equal(discard.get().closeOk, '破棄して終了');
});

// get() が返したものを書き換えても、次の get() に影響しない。
test('返した文言を書き換えても内部状態は動かない', () => {
  const discard = createDiscardText();
  const first = discard.get();
  discard.set({ closeOk: 'Discard and quit' });
  assert.equal(first.closeOk, '破棄して終了');
  assert.equal(discard.get().closeOk, 'Discard and quit');
});
