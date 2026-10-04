// 同意画面から開く 3 文書は、読んでいる配布形態にとって真でなければならない。
// 文面を直しても印を付け忘れれば、その形態に偽の記述が出たままになる。ここは
// 実物を形態ごとに剥がして、その形態で成り立たない語が残っていないかを見る。
import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PLATFORMS, stripBuildOnly, type Platform } from './build-only';

const PACKAGED: Platform[] = ['macos', 'ios', 'windows'];
const APPLE: Platform[] = ['macos', 'ios'];

type Rule = { name: string; pattern: RegExp; only: Platform[] };
// only: その語が出てよい形態。ここに無い形態のビルド成果物に出ていたら失敗させる。
const RULES: Record<string, Rule[]> = {
  'DISCLAIMER.md': [
    {
      name: 'Tesseract を初回に取得',
      pattern: /初めて使うときに aoiko の配信元から取得/,
      only: ['browser'],
    },
    {
      name: '言語データはアプリに内蔵',
      pattern: /`jpn\.traineddata` はアプリに内蔵/,
      only: PACKAGED,
    },
    {
      name: 'アンインストールで消える',
      pattern: /アンインストールした場合も、データは同時に消えます/,
      only: ['windows'],
    },
    {
      name: 'Mac は保存領域が残る',
      pattern: /Mac ではアプリを削除しても保存領域が残ります/,
      only: APPLE,
    },
    { name: 'ブラウザ IndexedDB', pattern: /ブラウザ IndexedDB/, only: ['browser'] },
    { name: 'サイトデータ削除', pattern: /サイトデータ削除/, only: ['browser'] },
    { name: 'OPFS', pattern: /OPFS/, only: ['browser'] },
    { name: 'File System Access API', pattern: /File System Access API/, only: [] },
    { name: 'OLLAMA_ORIGINS', pattern: /OLLAMA_ORIGINS/, only: ['browser'] },
    { name: 'ITP', pattern: /追跡防止機能/, only: ['browser', ...APPLE] },
    { name: 'Apple Intelligence', pattern: /Apple Intelligence/, only: APPLE },
    // 仕様はクラウドを使う実装を認めているので、ブラウザ内蔵 AI に端末内を約束させない。
    {
      name: 'ブラウザ内蔵の AI に端末内を約束しない',
      pattern: /ブラウザ内蔵の AI（完全ローカル推論）/,
      only: [],
    },
  ],
  'DISCLAIMER_en.md': [
    {
      name: 'Tesseract fetched on first use',
      pattern: /fetched from aoiko's own server the first time you use it/,
      only: ['browser'],
    },
    {
      name: 'language data built into the app',
      pattern: /`jpn\.traineddata` is built into the app/,
      only: PACKAGED,
    },
    {
      name: 'uninstall deletes the data',
      pattern: /Uninstalling the app deletes the data too/,
      only: ['windows'],
    },
    {
      name: 'Mac keeps the storage area',
      pattern: /On a Mac, the storage area remains after you delete the app/,
      only: APPLE,
    },
    { name: "browser's IndexedDB", pattern: /browser's IndexedDB/, only: ['browser'] },
    { name: 'clear browser cache', pattern: /clear browser cache or site data/, only: ['browser'] },
    { name: 'OPFS', pattern: /OPFS/, only: ['browser'] },
    { name: 'File System Access API', pattern: /File System Access API/, only: [] },
    { name: 'OLLAMA_ORIGINS', pattern: /OLLAMA_ORIGINS/, only: ['browser'] },
    { name: 'ITP', pattern: /tracking prevention/, only: ['browser', ...APPLE] },
    { name: 'Apple Intelligence', pattern: /Apple Intelligence/, only: APPLE },
    {
      name: "no on-device promise for the browser's AI",
      pattern: /browser's built-in AI \(purely-local inference\)/,
      only: [],
    },
  ],
  'DISCLAIMER_zh-TW.md': [
    {
      name: 'Tesseract 第一次使用時取得',
      pattern: /會在第一次使用時從 aoiko 的發布來源取得並存在瀏覽器中/,
      only: ['browser'],
    },
    { name: '語言資料內建在 App 中', pattern: /`jpn\.traineddata` 內建在 App 中/, only: PACKAGED },
    { name: '解除安裝時資料消失', pattern: /解除安裝 App 時資料也會一起消失/, only: ['windows'] },
    { name: 'Mac 保留儲存區域', pattern: /在 Mac 上刪除 App 後，儲存區域仍會保留/, only: APPLE },
    { name: '瀏覽器的 IndexedDB', pattern: /瀏覽器的 IndexedDB/, only: ['browser'] },
    { name: '清除快取', pattern: /清除瀏覽器快取/, only: ['browser'] },
    { name: 'OPFS', pattern: /OPFS/, only: ['browser'] },
    { name: 'File System Access API', pattern: /File System Access API/, only: [] },
    { name: 'OLLAMA_ORIGINS', pattern: /OLLAMA_ORIGINS/, only: ['browser'] },
    { name: 'ITP', pattern: /追蹤防護機制/, only: ['browser', ...APPLE] },
    { name: 'Apple Intelligence', pattern: /Apple Intelligence/, only: APPLE },
    { name: '不對瀏覽器內建 AI 承諾本機', pattern: /瀏覽器內建的 AI（純本機推論）/, only: [] },
  ],
  'PRIVACY.md': [
    { name: 'Cache Storage', pattern: /Cache Storage/, only: ['browser'] },
    { name: 'アプリに内蔵', pattern: /アプリに内蔵/, only: PACKAGED },
    { name: '支援者バッジ', pattern: /支援者バッジ/, only: PACKAGED },
    {
      name: 'アンインストールで消える',
      pattern: /アンインストールした場合も、データは同時に消えます/,
      only: ['windows'],
    },
    {
      name: 'Mac は保存領域が残る',
      pattern: /Mac ではアプリを削除しても保存領域が残ります/,
      only: APPLE,
    },
    { name: '書類フォルダ', pattern: /このアプリの書類フォルダ/, only: APPLE },
    { name: 'HTTP アクセスログ', pattern: /HTTP アクセスログ/, only: ['browser'] },
    { name: 'ブラウザの IndexedDB', pattern: /ブラウザの \*\*IndexedDB\*\*/, only: ['browser'] },
    { name: 'サイトデータ削除', pattern: /サイトデータ削除/, only: ['browser'] },
    { name: 'ブラウザから直接', pattern: /利用者のブラウザから\*\*直接\*\*/, only: ['browser'] },
    { name: 'OPFS', pattern: /OPFS/, only: ['browser'] },
    { name: 'File System Access API', pattern: /File System Access API/, only: ['browser'] },
    { name: 'リファラ', pattern: /リファラ（参照元 URL）は送られません/, only: ['browser'] },
    { name: 'Google Drive 同期', pattern: /Google Drive 同期/, only: [] },
    { name: 'Apple Intelligence', pattern: /Apple Intelligence/, only: APPLE },
    // ブラウザ内蔵 AI の推論先は約束できない。Apple の行（画像・テキストは端末外に出ない）とは別の文。
    { name: '推論内容は端末外に出ない', pattern: /推論内容は端末外に出ない/, only: [] },
  ],
  'PRIVACY_en.md': [
    { name: 'Cache Storage', pattern: /Cache Storage/, only: ['browser'] },
    { name: 'built into the app', pattern: /built into the app/, only: PACKAGED },
    { name: 'supporter badge', pattern: /supporter-badge/, only: PACKAGED },
    {
      name: 'uninstall deletes the data',
      pattern: /Uninstalling the app deletes the data too/,
      only: ['windows'],
    },
    {
      name: 'Mac keeps the storage area',
      pattern: /On a Mac, the storage area remains after you delete the app/,
      only: APPLE,
    },
    { name: 'Documents folder', pattern: /Documents folder/, only: APPLE },
    { name: 'HTTP access logs', pattern: /HTTP access logs/, only: ['browser'] },
    { name: "browser's IndexedDB", pattern: /your browser's \*\*IndexedDB\*\*/, only: ['browser'] },
    {
      name: 'Clearing browser site data',
      pattern: /Clearing browser site data/,
      only: ['browser'],
    },
    { name: 'from your browser', pattern: /\*\*directly\*\* from your browser/, only: ['browser'] },
    { name: 'OPFS', pattern: /OPFS/, only: ['browser'] },
    { name: 'File System Access API', pattern: /File System Access API/, only: ['browser'] },
    { name: 'Referer', pattern: /carry no Referer header/, only: ['browser'] },
    { name: 'Google Drive sync', pattern: /Google Drive sync/, only: [] },
    { name: 'Apple Intelligence', pattern: /Apple Intelligence/, only: APPLE },
    {
      name: 'Inference content never leaves the device',
      pattern: /Inference content never leaves the device/,
      only: [],
    },
  ],
  'PRIVACY_zh-TW.md': [
    { name: 'Cache Storage', pattern: /Cache Storage/, only: ['browser'] },
    { name: '內建在 App 中', pattern: /內建在 App 中/, only: PACKAGED },
    { name: '支援者徽章', pattern: /支援者徽章/, only: PACKAGED },
    { name: '解除安裝時資料消失', pattern: /解除安裝 App 時資料也會一起消失/, only: ['windows'] },
    { name: 'Mac 保留儲存區域', pattern: /在 Mac 上刪除 App 後，儲存區域仍會保留/, only: APPLE },
    { name: '文件資料夾', pattern: /這個 App 的文件資料夾/, only: APPLE },
    { name: 'HTTP 存取紀錄', pattern: /HTTP 存取紀錄/, only: ['browser'] },
    { name: '瀏覽器的 IndexedDB', pattern: /瀏覽器的 \*\*IndexedDB\*\*/, only: ['browser'] },
    { name: '網站資料清除', pattern: /清除瀏覽器的網站資料/, only: ['browser'] },
    { name: '瀏覽器直接', pattern: /使用者的瀏覽器\*\*直接\*\*/, only: ['browser'] },
    { name: 'OPFS', pattern: /OPFS/, only: ['browser'] },
    { name: 'File System Access API', pattern: /File System Access API/, only: ['browser'] },
    { name: 'referer', pattern: /不會附帶 referer/, only: ['browser'] },
    { name: 'Google Drive 同步', pattern: /Google Drive 同步/, only: [] },
    { name: 'Apple Intelligence', pattern: /Apple Intelligence/, only: APPLE },
    { name: '推論內容不離開本機', pattern: /推論內容不離開本機/, only: [] },
  ],
  'SECURITY.md': [
    {
      name: 'Tesseract を初回に取得',
      pattern: /初回使用時に aoiko の配信元から取得/,
      only: ['browser'],
    },
    { name: '言語データもアプリに内蔵', pattern: /言語データもアプリに内蔵/, only: PACKAGED },
    { name: 'ブラウザ内に閉じます', pattern: /ブラウザ内に閉じます/, only: [] },
    { name: 'master 最新コミットのみ', pattern: /最新コミットのみサポート/, only: [] },
    { name: 'リリースタグは未運用', pattern: /リリースタグは未運用/, only: [] },
    { name: 'ブラウザ IndexedDB に保管', pattern: /ブラウザ IndexedDB に保管/, only: ['browser'] },
    { name: 'ブラウザから直接', pattern: /利用者のブラウザから直接/, only: ['browser'] },
    { name: 'OPFS', pattern: /OPFS/, only: ['browser'] },
    { name: 'File System Access API', pattern: /File System Access API/, only: ['browser'] },
    { name: 'ブラウザ拡張機能', pattern: /ブラウザ拡張機能/, only: ['browser'] },
    { name: 'プロファイル分離', pattern: /プロファイル分離/, only: ['browser'] },
    { name: 'Service Worker', pattern: /Service Worker/, only: ['browser'] },
    { name: 'traineddata 初回 DL', pattern: /traineddata 初回 DL/, only: [] },
    { name: 'Apple Intelligence', pattern: /Apple Intelligence/, only: APPLE },
    { name: 'App Store', pattern: /App Store/, only: APPLE },
    { name: 'Microsoft Store', pattern: /Microsoft Store/, only: ['windows'] },
    { name: 'ブラウザ内蔵 AI は送信なしと書かない', pattern: /AI\*\* → 送信なし（推論/, only: [] },
  ],
  'SECURITY_en.md': [
    {
      name: 'Tesseract fetched on first use',
      pattern: /fetched from aoiko's own server on first use/,
      only: ['browser'],
    },
    {
      name: 'language data built into the app',
      pattern: /the language data is built into the app/,
      only: PACKAGED,
    },
    { name: 'stays inside the browser', pattern: /stays inside the browser/, only: [] },
    { name: 'latest commit', pattern: /Only the latest commit/, only: [] },
    { name: 'Release tags', pattern: /Release tags are not yet in use/, only: [] },
    { name: 'browser IndexedDB', pattern: /user's browser IndexedDB/, only: ['browser'] },
    { name: 'from the browser', pattern: /directly from the user's browser/, only: ['browser'] },
    { name: 'OPFS', pattern: /OPFS/, only: ['browser'] },
    { name: 'File System Access API', pattern: /File System Access API/, only: ['browser'] },
    { name: 'browser extensions', pattern: /browser extensions/, only: ['browser'] },
    { name: 'browser profiles', pattern: /browser profiles/, only: ['browser'] },
    { name: 'Service Worker', pattern: /Service Worker/, only: ['browser'] },
    { name: 'traineddata fetched once', pattern: /traineddata fetched once/, only: [] },
    { name: 'Apple Intelligence', pattern: /Apple Intelligence/, only: APPLE },
    { name: 'App Store', pattern: /App Store/, only: APPLE },
    { name: 'Microsoft Store', pattern: /Microsoft Store/, only: ['windows'] },
    {
      name: "no no-transmission claim for the browser's AI",
      pattern: /built-in AI\*\* → no transmission \(inference/,
      only: [],
    },
  ],
  'SECURITY_zh-TW.md': [
    {
      name: 'Tesseract 第一次使用時取得',
      pattern: /在第一次使用時從 aoiko 的發布來源取得/,
      only: ['browser'],
    },
    { name: '語言資料內建在 App 中', pattern: /語言資料內建在 App 中/, only: PACKAGED },
    { name: '閉合在瀏覽器內', pattern: /閉合在瀏覽器內/, only: [] },
    { name: '最新 commit', pattern: /只支援 `master` branch 最新 commit/, only: [] },
    { name: 'release tag 還沒運用', pattern: /release tag 還沒運用/, only: [] },
    { name: '瀏覽器 IndexedDB', pattern: /自己的瀏覽器 IndexedDB/, only: ['browser'] },
    { name: '瀏覽器直接', pattern: /從使用者瀏覽器直接/, only: ['browser'] },
    { name: 'OPFS', pattern: /OPFS/, only: ['browser'] },
    { name: 'File System Access API', pattern: /File System Access API/, only: ['browser'] },
    { name: '瀏覽器擴充功能', pattern: /瀏覽器擴充功能/, only: ['browser'] },
    { name: '瀏覽器設定檔', pattern: /瀏覽器設定檔/, only: ['browser'] },
    { name: 'Service Worker', pattern: /Service Worker/, only: ['browser'] },
    { name: '首次 DL traineddata', pattern: /首次 DL traineddata/, only: [] },
    { name: 'Apple Intelligence', pattern: /Apple Intelligence/, only: APPLE },
    { name: 'App Store', pattern: /App Store/, only: APPLE },
    { name: 'Microsoft Store', pattern: /Microsoft Store/, only: ['windows'] },
    { name: '不對瀏覽器內建 AI 寫成不送', pattern: /AI\*\* → 不送（推論/, only: [] },
  ],
};

describe('同意画面の 3 文書は形態ごとに真である', () => {
  for (const [doc, rules] of Object.entries(RULES)) {
    const src = readFileSync(resolve(doc), 'utf-8');
    for (const platform of PLATFORMS) {
      const folded = stripBuildOnly(src, platform, doc);
      for (const rule of rules) {
        const allowed = rule.only.includes(platform);
        test(`${doc} / ${platform} / ${rule.name} は ${allowed ? 'ある' : 'ない'}`, () => {
          expect(rule.pattern.test(folded)).toBe(allowed);
        });
      }
    }
  }
});
// ネイティブ版で消えてはいけない記述。出し分けを足したときに、native 側を書き忘れると
// 「その形態には何も書いていない」という別の嘘になる。
describe('ネイティブ版にも保存とバックアップの記述が残る', () => {
  for (const doc of ['DISCLAIMER.md', 'PRIVACY.md', 'SECURITY.md']) {
    const src = readFileSync(resolve(doc), 'utf-8');
    for (const platform of PACKAGED) {
      test(`${doc} / ${platform} にアプリの管理領域の記述がある`, () => {
        expect(stripBuildOnly(src, platform, doc)).toMatch(/アプリの管理領域|同期フォルダ/);
      });
    }
  }
});
