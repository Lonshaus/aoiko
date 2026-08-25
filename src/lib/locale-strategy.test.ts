import { describe, expect, it } from 'vitest';
import { strategy } from '../paraglide/runtime';
// paraglide の strategy は project.inlang/settings.json に書けず、CLI（package.json の
// paraglide:compile）と vite plugin（vite.config.ts）がそれぞれ受け取る。両者は同じ
// src/paraglide/ を上書きし合うので、片方だけずれると「最後に走ったほう」で中身が変わる。
//
// 実害が出る形：CLI 側の指定が抜けると runtime.js の
// TREE_SHAKE_LOCAL_STORAGE_STRATEGY_USED が false で生成され、getLocale() が
// localStorage を読まなくなって常に baseLocale（ja）を返す。ビルドは通るので気付けない。
//
// 設定同士を突き合わせても「最後に走ったほう」は分からない。生成物そのものを見る。
describe('paraglide の生成物', () => {
  it('CLI と vite plugin のどちらが生成しても同じ strategy になっている', () => {
    expect(strategy).toEqual(['localStorage', 'preferredLanguage', 'baseLocale']);
  });
});
