// 同意画面から開く 3 文書は、読んでいる配布形態にとって真でなければならない。
// 文面を直しても印を付け忘れれば、その形態に偽の記述が出たままになる。ここは
// 実物を形態ごとに剥がして、その形態で成り立たない語が残っていないかを見る。
import { describe, expect, test } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { PLATFORMS, stripBuildOnly, type Platform } from './build-only';

const PACKAGED: Platform[] = ['macos', 'ios', 'windows', 'android'];
const APPLE: Platform[] = ['macos', 'ios'];

type Rule = { name: string; pattern: RegExp; only: Platform[] };

// only: その語が出てよい形態。ここに無い形態のビルド成果物に出ていたら失敗させる。
const RULES: Record<string, Rule[]> = {
  'DISCLAIMER.md': [
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
    { name: 'ML Kit の利用状況開示', pattern: /ML Kit/, only: ['android'] },
    {
      name: 'OS 内蔵の文字認識は android で外部通信なしと書かない',
      pattern: /追加の読み込みも外部への通信もありません/,
      only: [...APPLE, 'windows'],
    },
    { name: 'Gemini Nano', pattern: /Gemini Nano/, only: ['android'] },
  ],
  'DISCLAIMER_en.md': [
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
    { name: 'ML Kit usage disclosure', pattern: /ML Kit/, only: ['android'] },
    {
      name: 'no no-external-request claim on android for OS recognition',
      pattern: /Nothing extra is downloaded and no external request is made/,
      only: [...APPLE, 'windows'],
    },
    { name: 'Gemini Nano', pattern: /Gemini Nano/, only: ['android'] },
  ],
  'DISCLAIMER_zh-TW.md': [
    { name: '瀏覽器的 IndexedDB', pattern: /瀏覽器的 IndexedDB/, only: ['browser'] },
    { name: '清除快取', pattern: /清除瀏覽器快取/, only: ['browser'] },
    { name: 'OPFS', pattern: /OPFS/, only: ['browser'] },
    { name: 'File System Access API', pattern: /File System Access API/, only: [] },
    { name: 'OLLAMA_ORIGINS', pattern: /OLLAMA_ORIGINS/, only: ['browser'] },
    { name: 'ITP', pattern: /追蹤防護機制/, only: ['browser', ...APPLE] },
    { name: 'Apple Intelligence', pattern: /Apple Intelligence/, only: APPLE },
    { name: '不對瀏覽器內建 AI 承諾本機', pattern: /瀏覽器內建的 AI（純本機推論）/, only: [] },
    { name: 'ML Kit 使用狀況揭露', pattern: /ML Kit/, only: ['android'] },
    {
      name: '不對 android 寫成不會有對外連線',
      pattern: /不需額外下載，也不會有對外連線/,
      only: [...APPLE, 'windows'],
    },
    { name: 'Gemini Nano', pattern: /Gemini Nano/, only: ['android'] },
  ],
  'PRIVACY.md': [
    { name: 'HTTP アクセスログ', pattern: /HTTP アクセスログ/, only: ['browser'] },
    { name: 'ブラウザの IndexedDB', pattern: /ブラウザの \*\*IndexedDB\*\*/, only: ['browser'] },
    { name: 'サイトデータ削除', pattern: /サイトデータ削除/, only: ['browser'] },
    { name: 'ブラウザから直接', pattern: /利用者のブラウザから \*\*直接\*\*/, only: ['browser'] },
    { name: 'OPFS', pattern: /OPFS/, only: ['browser'] },
    { name: 'File System Access API', pattern: /File System Access API/, only: ['browser'] },
    { name: 'リファラ', pattern: /リファラ送信/, only: ['browser'] },
    { name: 'Google Drive 同期', pattern: /Google Drive 同期/, only: [] },
    { name: 'Apple Intelligence', pattern: /Apple Intelligence/, only: APPLE },
    // ブラウザ内蔵 AI の推論先は約束できない。Apple の行（画像・テキストは端末外に出ない）とは別の文。
    { name: '推論内容は端末外に出ない', pattern: /推論内容は端末外に出ない/, only: [] },
    { name: 'ML Kit の利用状況開示', pattern: /ML Kit/, only: ['android'] },
    {
      name: 'OS 内蔵の文字認識の表: android で外部通信なしと書かない',
      pattern: /OS 内蔵の文字認識 \| 画像は端末外に出ない \|/,
      only: [...APPLE, 'windows'],
    },
    {
      name: '追加データの取得も発生しない、を android では単独で終わらせない',
      pattern: /追加データの取得も発生しない(?!が)/,
      only: [...APPLE, 'windows'],
    },
    {
      name: '新名称の表: ML Kit の利用状況開示がある行',
      pattern:
        /端末内の文字認識 \| 画像・テキストは端末外に出ない \| \*\*画像・テキストは無し\*\*（ML Kit の利用状況のみ Google へ送信）/,
      only: ['android'],
    },
    {
      name: '新名称の表で「外部への通信が発生しない」と書かない',
      pattern: /端末内の文字認識[^\n]*外部への通信が発生しない/,
      only: [],
    },
    {
      name: 'android は Tesseract と端末内の文字認識それぞれの送信有無を書く',
      pattern:
        /Tesseract は送信が発生しません。端末内の文字認識は画像・テキストの送信は発生しませんが、利用状況は Google に送信されます/,
      only: ['android'],
    },
    {
      name: '端末内で完結するエンジンも同様に送信が発生しません、は android では書けない',
      pattern: /端末内で完結するエンジンも同様に送信が発生しません/,
      only: ['browser', ...APPLE, 'windows'],
    },
    { name: 'Gemini Nano', pattern: /Gemini Nano/, only: ['android'] },
  ],
  'PRIVACY_en.md': [
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
    { name: 'Referer', pattern: /Referer header behavior/, only: ['browser'] },
    { name: 'Google Drive sync', pattern: /Google Drive sync/, only: [] },
    { name: 'Apple Intelligence', pattern: /Apple Intelligence/, only: APPLE },
    {
      name: 'Inference content never leaves the device',
      pattern: /Inference content never leaves the device/,
      only: [],
    },
    { name: 'ML Kit usage disclosure', pattern: /ML Kit/, only: ['android'] },
    {
      name: 'OS recognition table row: no no-external-request claim on android',
      pattern: /The OS's built-in text recognition \| Image never leaves device \|/,
      only: [...APPLE, 'windows'],
    },
    {
      name: "'Nothing extra is downloaded either' not left dangling on android",
      pattern: /Nothing extra is downloaded either(?! However| ML Kit)/,
      only: [...APPLE, 'windows'],
    },
    {
      name: 'new-name table row has the ML Kit usage disclosure',
      pattern:
        /On-device text recognition \| Image and text never leave device \| \*\*Image and text: none\*\* \(ML Kit's usage information alone is sent to Google\)/,
      only: ['android'],
    },
    {
      name: "no 'no external request is made' claim for the new name",
      pattern: /On-device text recognition[^\n]*no external request is made/,
      only: [],
    },
    {
      name: 'android states Tesseract and on-device recognition separately',
      pattern:
        /Tesseract sends nothing\. On-device text recognition doesn't send images or text, but usage information is sent to Google/,
      only: ['android'],
    },
    {
      name: "'the engines that run entirely on the device send nothing either' cannot appear on android",
      pattern: /The engines that run entirely on the device send nothing either/,
      only: ['browser', ...APPLE, 'windows'],
    },
    { name: 'Gemini Nano', pattern: /Gemini Nano/, only: ['android'] },
  ],
  'PRIVACY_zh-TW.md': [
    { name: 'HTTP 存取紀錄', pattern: /HTTP 存取紀錄/, only: ['browser'] },
    { name: '瀏覽器的 IndexedDB', pattern: /瀏覽器的 \*\*IndexedDB\*\*/, only: ['browser'] },
    { name: '網站資料清除', pattern: /清除瀏覽器的網站資料/, only: ['browser'] },
    { name: '瀏覽器直接', pattern: /使用者的瀏覽器\*\*直接\*\*/, only: ['browser'] },
    { name: 'OPFS', pattern: /OPFS/, only: ['browser'] },
    { name: 'File System Access API', pattern: /File System Access API/, only: ['browser'] },
    { name: 'referer', pattern: /referer 的送出/, only: ['browser'] },
    { name: 'Google Drive 同步', pattern: /Google Drive 同步/, only: [] },
    { name: 'Apple Intelligence', pattern: /Apple Intelligence/, only: APPLE },
    { name: '推論內容不離開本機', pattern: /推論內容不離開本機/, only: [] },
    { name: 'ML Kit 使用狀況揭露', pattern: /ML Kit/, only: ['android'] },
    {
      name: '作業系統內建的文字辨識表格列：android 不寫成不會有對外連線',
      pattern: /作業系統內建的文字辨識 \| 照片不離開本機 \|/,
      only: [...APPLE, 'windows'],
    },
    {
      name: '也不需額外下載任何資料，android 不獨立成句',
      pattern: /也不需額外下載任何資料(?!，但)/,
      only: [...APPLE, 'windows'],
    },
    {
      name: '新名稱的表格列有 ML Kit 使用狀況揭露',
      pattern:
        /裝置內的文字辨識 \| 圖片與文字都不離開本機 \| \*\*圖片與文字都無\*\*（僅 ML Kit 的使用狀況會送給 Google）/,
      only: ['android'],
    },
    {
      name: '不對新名稱寫成不會有對外連線',
      pattern: /裝置內的文字辨識[^\n]*不會有對外連線/,
      only: [],
    },
    {
      name: 'android 分開寫 Tesseract 和裝置內的文字辨識各自是否送出',
      pattern:
        /Tesseract 不會送出任何東西。裝置內的文字辨識不會送出圖片和文字，但使用狀況會送給 Google/,
      only: ['android'],
    },
    {
      name: '在裝置內完成的引擎同樣不會送出資料，android 不能有',
      pattern: /在裝置內完成的引擎同樣不會送出資料/,
      only: ['browser', ...APPLE, 'windows'],
    },
    { name: 'Gemini Nano', pattern: /Gemini Nano/, only: ['android'] },
  ],
  'SECURITY.md': [
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
    { name: 'Google Play', pattern: /Google Play/, only: ['android'] },
    { name: 'ブラウザ内蔵 AI は送信なしと書かない', pattern: /AI\*\* → 送信なし（推論/, only: [] },
    { name: 'ML Kit の利用状況開示', pattern: /ML Kit/, only: ['android'] },
    {
      name: 'OS 内蔵の文字認識は android で送信なしと書かない',
      pattern: /OS 内蔵の文字認識\*\* → 送信なし（端末内処理のみで完結）/,
      only: [...APPLE, 'windows'],
    },
    {
      name: '新名称の行に ML Kit 利用状況開示がある',
      pattern:
        /端末内の文字認識\*\* → 画像・テキストの送信なし（端末内処理。ただし文字認識を担う ML Kit の利用状況は Google へ送信）/,
      only: ['android'],
    },
    {
      name: '新名称で送信なし（端末内処理のみで完結）と書かない',
      pattern: /端末内の文字認識\*\* → 送信なし（端末内処理のみで完結）/,
      only: [],
    },
    {
      name: '冒頭段落の android は Tesseract と端末内の文字認識・端末内 Gemini Nano を分けて書く',
      pattern:
        /Tesseract を選んだ場合は送信は発生しません。端末内の文字認識・端末内 Gemini Nano を選んだ場合は画像・テキストの送信は発生しませんが、利用状況は Google に送信されます/,
      only: ['android'],
    },
    { name: 'Gemini Nano', pattern: /Gemini Nano/, only: ['android'] },
    {
      name: '冒頭段落の端末内で完結するエンジンを選んだ場合は送信も発生しません、は android では書けない',
      pattern: /端末内で完結するエンジンを選んだ場合は送信も発生しません/,
      only: ['browser', ...APPLE, 'windows'],
    },
  ],
  'SECURITY_en.md': [
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
    { name: 'Google Play', pattern: /Google Play/, only: ['android'] },
    {
      name: "no no-transmission claim for the browser's AI",
      pattern: /built-in AI\*\* → no transmission \(inference/,
      only: [],
    },
    { name: 'ML Kit usage disclosure', pattern: /ML Kit/, only: ['android'] },
    {
      name: 'no no-transmission claim for OS recognition on android',
      pattern: /text recognition\*\* → no transmission \(processed entirely on-device\)/,
      only: [...APPLE, 'windows'],
    },
    {
      name: 'new-name bullet has the ML Kit usage disclosure',
      pattern:
        /On-device text recognition\*\* → no image or text transmission \(processed on-device; ML Kit, which performs the recognition, sends usage information to Google\)/,
      only: ['android'],
    },
    {
      name: "no 'no transmission (processed entirely on-device)' claim for the new name",
      pattern: /On-device text recognition\*\* → no transmission \(processed entirely on-device\)/,
      only: [],
    },
    {
      name: 'opening paragraph on android states Tesseract and on-device recognition/Nano separately',
      pattern:
        /not at all if you chose Tesseract; if you chose on-device text recognition or on-device Gemini Nano, images and text are not sent, but usage information is sent to Google/,
      only: ['android'],
    },
    {
      name: "opening paragraph's 'not at all if you chose an engine that runs entirely on the device' cannot appear on android",
      pattern: /not at all if you chose an engine that runs entirely on the device/,
      only: ['browser', ...APPLE, 'windows'],
    },
    { name: 'Gemini Nano', pattern: /Gemini Nano/, only: ['android'] },
  ],
  'SECURITY_zh-TW.md': [
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
    { name: 'Google Play', pattern: /Google Play/, only: ['android'] },
    { name: '不對瀏覽器內建 AI 寫成不送', pattern: /AI\*\* → 不送（推論/, only: [] },
    { name: 'ML Kit 使用狀況揭露', pattern: /ML Kit/, only: ['android'] },
    {
      name: '不對 android 的作業系統內建文字辨識寫成不送',
      pattern: /作業系統內建的文字辨識\*\* → 不送（全程在本機處理）/,
      only: [...APPLE, 'windows'],
    },
    {
      name: '新名稱的條目有 ML Kit 使用狀況揭露',
      pattern:
        /裝置內的文字辨識\*\* → 圖片與文字都不送（在本機處理；負責辨識的 ML Kit 會把使用狀況送給 Google）/,
      only: ['android'],
    },
    {
      name: '不對新名稱寫成不送（全程在本機處理）',
      pattern: /裝置內的文字辨識\*\* → 不送（全程在本機處理）/,
      only: [],
    },
    {
      name: '開頭段落的 android 分開寫 Tesseract 和裝置內的文字辨識・裝置內 Gemini Nano',
      pattern:
        /選擇 Tesseract 時不會送出。選擇裝置內的文字辨識或裝置內 Gemini Nano 時不會送出圖片和文字，但使用狀況會送給 Google/,
      only: ['android'],
    },
    {
      name: '開頭段落的選擇在裝置內完成的引擎時連送出都不會發生，android 不能有',
      pattern: /選擇在裝置內完成的引擎時連送出都不會發生/,
      only: ['browser', ...APPLE, 'windows'],
    },
    { name: 'Gemini Nano', pattern: /Gemini Nano/, only: ['android'] },
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
// android で読める全文書（同意 3 文書＋マニュアル）に、他プラットフォーム専用の語が
// 残っていないかを機械的に見る。ここに載る語は android 環境の実装（HttpSend.kt / Saf.kt /
// TextRecognition.kt）には現れない。
describe('android で剥がした結果に他プラットフォーム専用の語が無い', () => {
  const FORBIDDEN = [
    'Security.framework',
    'Schannel',
    'WKWebView',
    'WebView2',
    'Finder',
    'エクスプローラー',
    'App Store',
    'Microsoft Store',
    'StoreKit',
    'iCloud',
  ];
  const policyDocs = ['DISCLAIMER', 'PRIVACY', 'SECURITY'].flatMap((b) => [
    `${b}.md`,
    `${b}_en.md`,
    `${b}_zh-TW.md`,
  ]);
  const manualDocs = readdirSync(resolve('docs/manual'))
    .filter((f) => f.endsWith('.md'))
    .map((f) => `docs/manual/${f}`);
  for (const doc of [...policyDocs, ...manualDocs]) {
    const src = readFileSync(resolve(doc), 'utf-8');
    const folded = stripBuildOnly(src, 'android', doc);
    for (const term of FORBIDDEN) {
      test(`${doc} / android に「${term}」が無い`, () => {
        expect(folded).not.toContain(term);
      });
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
