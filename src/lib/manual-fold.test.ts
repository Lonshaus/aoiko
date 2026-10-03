// マニュアルの only:native は android にも当たるので、旧 native ＝ desktop/iPad/iPhone
// 前提の文が android にそのまま出て嘘になっていないかを、実物を剥がして確認する。
// 否定だけだと android 向けに足した文が消えても気付けないため、肯定側も置く。
import { describe, expect, test } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  findOnlyBlocks,
  PLATFORM_KINDS,
  PLATFORMS,
  stripBuildOnly,
  type Platform,
} from './build-only';
import ja from '../../messages/ja.json';
import en from '../../messages/en.json';
import zhTW from '../../messages/zh-TW.json';

const APPLE: Platform[] = ['macos', 'ios'];
const APPLE_WINDOWS: Platform[] = ['macos', 'ios', 'windows'];
const WINDOWS_ANDROID: Platform[] = ['windows', 'android'];

type Rule = { name: string; pattern: RegExp; only: Platform[] };

const RULES: Record<string, Rule[]> = {
  'docs/manual/04-receipt-ocr.md': [
    {
      name: '表：apple は無し（常に使える）',
      pattern: /無し（aoiko が対応する OS では常に使える）/,
      only: APPLE,
    },
    {
      name: '表：対応端末のみ は windows',
      pattern: /対応端末のみ。領収書 OCR 画面を開くたびに自動判定/,
      only: ['windows'],
    },
    {
      name: '本文：apple は OS バージョンにすでに含まれる',
      pattern: /OS 内蔵の文字認識に日本語が含まれるかは OS のバージョンで決まり/,
      only: APPLE,
    },
    {
      name: '本文：windows は OS 側に日本語の文字認識を追加すれば選べる',
      pattern: /端末側へ確認するので、OS 側に日本語の文字認識を追加/,
      only: ['windows'],
    },
    {
      name: '表：android は常に使える',
      pattern: /常にこの端末で使える。文字認識はアプリに同梱されている/,
      only: ['android'],
    },
    {
      name: '本文：android は常に選択肢に入る',
      pattern: /端末内の文字認識は常に選択肢に入る/,
      only: ['android'],
    },
    {
      name: '本文：OS 内蔵の文字認識は完全に端末内処理',
      pattern: /追加データの取得自体が発生せず、OS が備える文字認識で完全に端末内処理されます/,
      only: APPLE_WINDOWS,
    },
    {
      name: '本文：android は ML Kit 利用状況を Google に送る',
      pattern:
        /文字認識を担う ML Kit が利用状況（機種名・アプリのバージョン・インストールごとの識別子・処理時間・エラーコード）を Google に送ります/,
      only: ['android'],
    },
    {
      name: '本文：android でも画像・テキストは送信されない',
      pattern: /レシート画像や読み取ったテキストの内容は送信されません/,
      only: ['android'],
    },
    {
      name: '本文：使えない端末もある は windows のみ',
      pattern: /\*\*使えない端末もある\*\*。OS 側に日本語の文字認識が入っていないと選択肢に出ない/,
      only: ['windows'],
    },
    {
      name: '本文：この文字認識に日本語が含まれるかは OS のバージョンで決まる（apple）',
      pattern: /この文字認識に日本語が含まれるかは OS のバージョンで決まり/,
      only: APPLE,
    },
    {
      name: '本文：1 つしか無いときはセレクトが出ない は windows のみ',
      pattern: /使えるサブエンジンが 1 つしか無いとき（多くの端末）はセレクト自体が出ず/,
      only: ['windows'],
    },
    {
      name: '本文：apple は 2 つ常に使えるのでセレクトが常に出る',
      pattern: /Tesseract と OS 内蔵の文字認識の 2 つが常に使えるため、セレクトは常に出る/,
      only: APPLE,
    },
    {
      name: '本文：browser は常に Tesseract 1 つだけ',
      pattern: /使えるサブエンジンは常に Tesseract の 1 つだけなので、セレクト自体は出ず/,
      only: ['browser'],
    },
    {
      name: '本文：登録番号の複数候補を順に探す は apple のみ',
      pattern: /文字認識は 1 単語につき複数の候補を返すので、`T` ＋ 13 桁の形に合う候補を順に探す/,
      only: APPLE,
    },
    {
      name: '本文：windows/android は候補が 1 件のみで選び直せない',
      pattern: /文字認識の結果は 1 単語につき 1 件のみで、複数候補から選び直す仕組みは無い/,
      only: WINDOWS_ANDROID,
    },
  ],
  'docs/manual/04-receipt-ocr_zh-TW.md': [
    {
      name: '表：apple 不需要（一律能用）',
      pattern: /不需要（aoiko 支援的作業系統一律能用）/,
      only: APPLE,
    },
    {
      name: '表：僅限支援的裝置 只限 windows',
      pattern: /僅限支援的裝置。每次開啟收據 OCR 畫面都會自動判定/,
      only: ['windows'],
    },
    {
      name: '本文：apple 已經內建 OS 版本',
      pattern: /作業系統內建的文字辨識有沒有日文，取決於 OS 版本/,
      only: APPLE,
    },
    {
      name: '本文：windows 在作業系統加裝日文文字辨識後就能選到',
      pattern: /在作業系統那邊加裝日文的文字辨識後重新開啟就能選到/,
      only: ['windows'],
    },
    {
      name: '表：android 隨時能用',
      pattern: /這台裝置隨時能用。文字辨識隨 App 一起附帶/,
      only: ['android'],
    },
    {
      name: '本文：android 一定在選項裡',
      pattern: /裝置內的文字辨識一定會在選項裡/,
      only: ['android'],
    },
    {
      name: '本文：OS 內建文字辨識全程在本機完成',
      pattern: /連額外資料都不用下載，全程由 OS 自帶的文字辨識在本機完成/,
      only: APPLE_WINDOWS,
    },
    {
      name: '本文：android 會把 ML Kit 使用狀況送給 Google',
      pattern:
        /負責辨識的 ML Kit 會把使用狀況（機型、App 版本、每次安裝的識別碼、處理耗時、錯誤代碼）送給 Google/,
      only: ['android'],
    },
    {
      name: '本文：android 也不會送出圖片與文字內容',
      pattern: /收據圖片與辨識出的文字內容不會被送出/,
      only: ['android'],
    },
    {
      name: '本文：不是每台裝置都能用 只限 windows',
      pattern: /\*\*不是每台裝置都能用\*\*。作業系統那邊沒裝日文的文字辨識就不會進選項/,
      only: ['windows'],
    },
    {
      name: '本文：這個文字辨識有沒有日文取決於 OS 版本（apple）',
      pattern: /這個文字辨識有沒有日文，取決於 OS 版本/,
      only: APPLE,
    },
    {
      name: '本文：只有 1 個能用時不出下拉 只限 windows',
      pattern: /只有 1 個能用時（大多數裝置）不會出現下拉/,
      only: ['windows'],
    },
    {
      name: '本文：apple 2 個一直都能用，下拉一定會出現',
      pattern: /Tesseract 與作業系統內建的文字辨識這 2 個一直都能用，下拉一定會出現/,
      only: APPLE,
    },
    {
      name: '本文：browser 永遠只有 Tesseract 這一個',
      pattern: /這裡能用的子引擎永遠只有 Tesseract 這一個，不會出現下拉/,
      only: ['browser'],
    },
    {
      name: '本文：登錄號碼多候選依序尋找 只限 apple',
      pattern: /文字辨識每個字詞會回傳多個候選，所以會依序尋找符合 `T` 加上剛好 13 位數字的候選/,
      only: APPLE,
    },
    {
      name: '本文：windows/android 每個字詞只有 1 筆結果',
      pattern: /文字辨識每個字詞只會回傳 1 筆結果，沒有第二候選可以改選/,
      only: WINDOWS_ANDROID,
    },
  ],
  'docs/manual/04-receipt-ocr_en.md': [
    {
      name: 'table: apple none — always available',
      pattern: /None — always available on every OS aoiko supports/,
      only: APPLE,
    },
    {
      name: 'table: supported devices only is windows only',
      pattern: /Supported devices only; re-checked automatically/,
      only: ['windows'],
    },
    {
      name: 'prose: apple already includes it with the OS version',
      pattern: /the OS's built-in text recognition includes Japanese depends on the OS version/,
      only: APPLE,
    },
    {
      name: 'prose: windows adding optical character recognition makes it selectable',
      pattern:
        /It is re-checked with the device every time the Receipt OCR screen opens, so adding Japanese text recognition on the OS side/,
      only: ['windows'],
    },
    {
      name: 'table: android always available',
      pattern: /Always available on this device; the text recognition ships with the app/,
      only: ['android'],
    },
    {
      name: 'prose: android always in the option set',
      pattern: /text recognition is always in the option set/,
      only: ['android'],
    },
    {
      name: 'prose: OS text recognition runs entirely on-device',
      pattern: /fetches nothing extra at all — recognition runs entirely on-device/,
      only: APPLE_WINDOWS,
    },
    {
      name: 'prose: android reports ML Kit usage to Google',
      pattern:
        /ML Kit, which powers the recognition, reports usage information \(device model, app version, a per-install identifier, timing, and error codes\) to Google/,
      only: ['android'],
    },
    {
      name: 'prose: android still never sends the image or text',
      pattern: /The receipt image and the recognized text are never sent/,
      only: ['android'],
    },
    {
      name: 'prose: not every device can use it is windows only',
      pattern: /\*\*Not every device can use it\.\*\* It only enters the option set/,
      only: ['windows'],
    },
    {
      name: 'prose: whether this text recognition includes Japanese depends on the OS version (apple)',
      pattern: /Whether this text recognition includes Japanese depends on the OS version/,
      only: APPLE,
    },
    {
      name: 'prose: no dropdown when only one is usable is windows only',
      pattern: /When only one is usable \(most devices\), no dropdown appears/,
      only: ['windows'],
    },
    {
      name: 'prose: apple both sub-engines always usable, dropdown always appears',
      pattern:
        /Tesseract and the OS's built-in text recognition are both always usable, so the dropdown always appears/,
      only: APPLE,
    },
    {
      name: 'prose: browser always has exactly one sub-engine',
      pattern: /Only one sub-engine \(Tesseract\) is ever usable here, so no dropdown appears/,
      only: ['browser'],
    },
    {
      name: 'prose: several candidates for invoice number is apple only',
      pattern: /Text recognition returns several candidates per word/,
      only: APPLE,
    },
    {
      name: 'prose: windows/android returns only one result per word',
      pattern: /Text recognition returns only one result per word, with no second candidate/,
      only: WINDOWS_ANDROID,
    },
  ],
  'docs/manual/01-setup.md': [
    {
      name: '本文：OS 内蔵の文字認識は対応端末のみ は windows',
      pattern: /Tesseract、対応端末では OS 内蔵の文字認識も選択可/,
      only: ['windows'],
    },
    {
      name: '本文：apple は対応端末の条件無しで選べる',
      pattern: /Tesseract、OS 内蔵の文字認識も選択可/,
      only: APPLE,
    },
    {
      name: '本文：android は対応端末の条件無しで選べる',
      pattern: /Tesseract、端末内の文字認識も選択可/,
      only: ['android'],
    },
    {
      name: '7-C：Apple Intelligence は apple のみ',
      pattern: /### 7-C\. Apple Intelligence（対応機種のみ）/,
      only: APPLE,
    },
  ],
  'docs/manual/01-setup_zh-TW.md': [
    {
      name: '本文：OS 內建文字辨識限支援的裝置 只限 windows',
      pattern: /Tesseract，支援的裝置還能選作業系統內建的文字辨識/,
      only: ['windows'],
    },
    {
      name: '本文：apple 沒有支援的裝置限制',
      pattern: /Tesseract，還能選作業系統內建的文字辨識/,
      only: APPLE,
    },
    {
      name: '本文：android 沒有支援的裝置限制',
      pattern: /Tesseract，還能選裝置內的文字辨識/,
      only: ['android'],
    },
    {
      name: '7-C：Apple Intelligence 只限 apple',
      pattern: /### 7-C\. Apple Intelligence（限支援機型）/,
      only: APPLE,
    },
  ],
  'docs/manual/01-setup_en.md': [
    {
      name: 'prose: OS text recognition on supported devices only is windows',
      pattern: /Tesseract, or on supported devices the OS's built-in text recognition/,
      only: ['windows'],
    },
    {
      name: 'prose: apple has no supported-devices condition',
      pattern: /Tesseract, or the OS's built-in text recognition\) is always available/,
      only: APPLE,
    },
    {
      name: 'prose: android has no supported-devices condition',
      pattern: /Tesseract, or on-device text recognition\) is always available/,
      only: ['android'],
    },
    {
      name: '7-C: Apple Intelligence is apple only',
      pattern: /### 7-C\. Apple Intelligence \(supported devices only\)/,
      only: APPLE,
    },
  ],
  'docs/manual/11-backup.md': [
    {
      name: 'macos / windows は保存先を選ぶダイアログ',
      pattern: /保存先を選ぶダイアログが開きます/,
      only: ['macos', 'windows'],
    },
    {
      name: 'ios はアプリの保存領域',
      pattern: /アプリ内の保存領域に保存され、「ファイル」アプリなどから取り出せます/,
      only: ['ios'],
    },
    {
      name: 'android のシステム保存ダイアログ',
      pattern: /システムの保存先選択ダイアログ/,
      only: ['android'],
    },
    { name: 'iCloud の例は apple だけ', pattern: /iCloud Drive\/aoiko-backup\//, only: APPLE },
    {
      name: 'OneDrive の例は windows だけ',
      pattern: /OneDrive\/aoiko-backup\//,
      only: ['windows'],
    },
  ],
  'docs/manual/11-backup_zh-TW.md': [
    {
      name: 'macos / windows 會開啟選擇儲存位置的對話框',
      pattern: /會開啟選擇儲存位置的對話框/,
      only: ['macos', 'windows'],
    },
    {
      name: 'ios 存在 App 自己的儲存區',
      pattern: /存在 App 自己的儲存區，可以從「檔案」App 等取出/,
      only: ['ios'],
    },
    {
      name: 'android 的系統儲存對話框',
      pattern: /系統的儲存位置選擇對話框會開啟，讓你選擇存放位置/,
      only: ['android'],
    },
    { name: 'iCloud 的例子只給 apple', pattern: /iCloud Drive\/aoiko-backup\//, only: APPLE },
    { name: 'OneDrive 的例子只給 windows', pattern: /OneDrive\/aoiko-backup\//, only: ['windows'] },
  ],
  'docs/manual/11-backup_en.md': [
    {
      name: 'macos / windows save dialog lets you choose the destination',
      pattern: /save dialog lets you choose the destination/,
      only: ['macos', 'windows'],
    },
    {
      name: "ios saved inside the app's own storage area",
      pattern: /Saved inside the app's own storage area, retrievable from the Files app etc\./,
      only: ['ios'],
    },
    {
      name: "android's system save dialog",
      pattern: /The system's save-location dialog opens, letting you choose the destination/,
      only: ['android'],
    },
    {
      name: 'iCloud example is apple only',
      pattern: /iCloud Drive\/aoiko-backup\//,
      only: APPLE,
    },
    {
      name: 'OneDrive example is windows only',
      pattern: /OneDrive\/aoiko-backup\//,
      only: ['windows'],
    },
  ],
  'docs/manual/10-xtx-export.md': [
    {
      name: 'macos / windows は保存先を選ぶダイアログ',
      pattern: /保存先を選ぶダイアログが開きます/,
      only: ['macos', 'windows'],
    },
    {
      name: 'ios はアプリの保存領域',
      pattern: /アプリ内の保存領域に保存され、「ファイル」アプリなどから取り出せます/,
      only: ['ios'],
    },
    {
      name: 'android のシステム保存ダイアログ',
      pattern: /システムの保存先選択ダイアログが開き、保存先を選べます/,
      only: ['android'],
    },
  ],
  'docs/manual/10-xtx-export_zh-TW.md': [
    {
      name: 'macos / windows 會開啟選擇儲存位置的對話框',
      pattern: /會開啟選擇儲存位置的對話框/,
      only: ['macos', 'windows'],
    },
    {
      name: 'ios 存在 App 自己的儲存區',
      pattern: /存在 App 自己的儲存區，可以從「檔案」App 等取出/,
      only: ['ios'],
    },
    {
      name: 'android 的系統儲存對話框',
      pattern: /系統的儲存位置選擇對話框會開啟，讓你選擇保存位置/,
      only: ['android'],
    },
  ],
  'docs/manual/10-xtx-export_en.md': [
    {
      name: 'macos / windows save dialog to choose the destination',
      pattern: /It opens a save dialog to choose the destination/,
      only: ['macos', 'windows'],
    },
    {
      name: "ios saved inside the app's own storage area",
      pattern: /It's saved inside the app's own storage area, retrievable from the Files app etc\./,
      only: ['ios'],
    },
    {
      name: "android's system save dialog",
      pattern: /The system's save-location dialog opens, letting you choose the destination/,
      only: ['android'],
    },
  ],
  'docs/manual/15-invoices.md': [
    {
      name: 'macos / windows は印刷パネルから PDF',
      pattern: /^印刷パネルから PDF として保存できる/m,
      only: ['macos', 'windows'],
    },
    {
      name: 'ios は共有シートから保存',
      pattern: /iPad・iPhone では共有シートから保存する/,
      only: ['ios'],
    },
    {
      name: 'android のシステム印刷ダイアログから PDF',
      pattern: /システムの印刷ダイアログから PDF として保存できる/,
      only: ['android'],
    },
  ],
  'docs/manual/15-invoices_zh-TW.md': [
    {
      name: 'macos / windows 列印面板存成 PDF',
      pattern: /^可以在列印面板存成 PDF/m,
      only: ['macos', 'windows'],
    },
    {
      name: 'ios 從分享選單儲存',
      pattern: /iPad・iPhone 則從分享選單儲存/,
      only: ['ios'],
    },
    {
      name: 'android 從系統列印對話框存 PDF',
      pattern: /可以從系統的列印對話框存成 PDF/,
      only: ['android'],
    },
  ],
  'docs/manual/15-invoices_en.md': [
    {
      name: 'macos / windows save as PDF from the print panel',
      pattern: /^Save as PDF from the print panel/m,
      only: ['macos', 'windows'],
    },
    {
      name: 'ios saves via the share sheet',
      pattern: /On iPad\/iPhone, save via the share sheet/,
      only: ['ios'],
    },
    {
      name: 'android saves PDF from the system print dialog',
      pattern: /Save as PDF from the system print dialog/,
      only: ['android'],
    },
  ],
};
// RULES の 1 件が「その family の唯一の宣言」になるよう、真偽値の一致ではなく出現回数で見る。
// 例えば only:windows の変種が only:native に化けると、apple/windows 両方の文が macos の産物にも並んで出る
// ため、対象文が「ある/ない」の 2 値では素通りする。1 つの platform には家族内で高々 1 個という
// 前提を数で確かめれば、変種が丸ごと消えるケースも、印が化けて隣の platform に漏れるケースも同じ
// チェックで拾える。ここでは 2 つ目の hand-kept list を別に持たず、RULES だけを唯一の宣言源にする。
function countMatches(folded: string, pattern: RegExp): number {
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
  return [...folded.matchAll(new RegExp(pattern.source, flags))].length;
}

describe('配布形態ごとに、その形態で成り立つ文だけが、ちょうど 1 回だけ残る', () => {
  for (const [doc, rules] of Object.entries(RULES)) {
    const src = readFileSync(resolve(doc), 'utf-8');
    for (const platform of PLATFORMS) {
      const folded = stripBuildOnly(src, platform, doc);
      for (const rule of rules) {
        const allowed = rule.only.includes(platform);
        test(`${doc} / ${platform} / ${rule.name} は ${allowed ? 'ちょうど 1 回ある' : '無い'}`, () => {
          expect(countMatches(folded, rule.pattern)).toBe(allowed ? 1 : 0);
        });
      }
    }
  }
});
// RULES は言語ごとに手書きの配列を並べているだけなので、1 件消えてもそのテストが
// ただ消えるだけで green のまま通ってしまう（FAMILY_EXCEPTIONS の劣化防止と違い、
// RULES 自体にはこの手の歯止めが無かった）。ja/en/zh-TW の 3 版は同じ話題を出し分けている
// はずなので、件数と only の並びが揃うことを確かめ、どれか 1 版だけの削除を拾う。
function baseAndLangOf(doc: string): { base: string; lang: 'ja' | 'en' | 'zh-TW' } {
  if (doc.endsWith('_en.md')) {
    return { base: doc.slice(0, -'_en.md'.length), lang: 'en' };
  }
  if (doc.endsWith('_zh-TW.md')) {
    return { base: doc.slice(0, -'_zh-TW.md'.length), lang: 'zh-TW' };
  }
  return { base: doc.slice(0, -'.md'.length), lang: 'ja' };
}

describe('RULES は ja/en/zh-TW の 3 版で件数と only の並びが揃う（削除の検出漏れを防ぐ）', () => {
  const byBase = new Map<string, Partial<Record<'ja' | 'en' | 'zh-TW', Rule[]>>>();
  for (const [doc, rules] of Object.entries(RULES)) {
    const { base, lang } = baseAndLangOf(doc);
    const entry = byBase.get(base) ?? {};
    entry[lang] = rules;
    byBase.set(base, entry);
  }
  for (const [base, byLang] of byBase) {
    const langs = Object.keys(byLang) as Array<'ja' | 'en' | 'zh-TW'>;
    test(`${base} は ja/en/zh-TW の RULES 件数が揃う`, () => {
      const counts = langs.map((lang) => byLang[lang]!.length);
      expect(new Set(counts).size).toBe(1);
    });
    const [first, ...rest] = langs;
    if (first === undefined) {
      continue;
    }
    const onlyKey = (rules: Rule[]) => rules.map((r) => [...r.only].sort().join(',')).join('|');
    for (const lang of rest) {
      test(`${base} は ${first} と ${lang} で only の並びが揃う`, () => {
        expect(onlyKey(byLang[lang]!)).toBe(onlyKey(byLang[first]!));
      });
    }
  }
});
// ここから下は RULES のような手書きの家族一覧を持たず、only: の印そのものから
// family（同じ話題の出し分け）を機械的に割り出して、全形態に届いているかを見る。
// RULES はあくまで「特定の文が特定の形態に出る／出ない」という個別の主張であって、
// family 単位の網羅性は別の事実なので、二重の手書きリストにはしない。
type OnlyKind = string;
type FamilyBlock = { kind: OnlyKind; start: number; end: number };
type Family = { blocks: FamilyBlock[]; line: number };
// only:kind → その kind を読む形態の一覧。build-only.ts の PLATFORM_KINDS を逆引きするだけで、
// ここ独自の対応表は持たない。
const KIND_PLATFORMS = new Map<OnlyKind, Platform[]>();
for (const platform of PLATFORMS) {
  for (const kind of PLATFORM_KINDS[platform]) {
    const list = KIND_PLATFORMS.get(kind) ?? [];
    list.push(platform);
    KIND_PLATFORMS.set(kind, list);
  }
}

function lineOf(markdown: string, index: number): number {
  return markdown.slice(0, index).split('\n').length;
}
// narrower kind（native の兄弟区画として絞り込む側。macos / ios は apple の兄弟区画として
// さらに絞る側だが、native から見れば同じく「共通の話題」の外にある）。native からこれらへ
// 移ったところは「共通の話題」から「機種限定の話題」への切り替わりなので、family を割る境目にする。
const NARROWER_THAN_NATIVE = new Set<OnlyKind>(['apple', 'windows', 'android', 'macos', 'ios']);
// 「隣接する区画は、間が空行だけなら同じ family」。ただし次のどれかに当たったら family を割る：
// (1) 同じ kind が家族内で繰り返し出た（別の話題の出し分けが隙間無く並んでいるだけ。実例：
//     04-receipt-ocr.md の「セレクトが出ない条件」→「OS 内蔵が選択肢に入る条件」の 2 つの話題が
//     browser/apple/windows/apple/windows/android と直に連なっている）。
// (2) 直前が native で今回が apple/windows/android（native は「共通の話題」を書く区画なので、
//     その直後に機種限定の話題が始まっても地続きに見えてしまう。実例：04-receipt-ocr.md:119 の
//     「言語データのキャッシュ先（browser/native）」→「OS 内蔵文字認識の説明（apple/windows/
//     android）」、11-backup.md:69 の「フォルダの選び方（browser/native）」→「クラウド同期の
//     Tip（apple/windows）」。native 側の reach（apple・windows・android を含む）をそのまま
//     持ち込むと、機種限定の話題が実際には届いていない機種にも届いたことになってしまう）。
// (3) 直前が apple/windows/android で今回が browser（(2) の逆向き。機種限定の話題の直後に
//     browser 専用の別節が地続きで始まる場合も、話題が変わっている。実例：11-backup.md の
//     「クラウド同期の Tip（apple/windows）」→「### 3-2. Firefox / Safari（OPFS のみ）」。
//     見出し自体は browser 専用の別節であって、直前の Tip の続きではない）。
function deriveFamilies(markdown: string): Family[] {
  const blocks = findOnlyBlocks(markdown);
  const families: Family[] = [];
  let current: FamilyBlock[] = [];
  let seenKinds = new Set<OnlyKind>();
  for (const block of blocks) {
    const prev = current[current.length - 1];
    const nativeToNarrower = prev?.kind === 'native' && NARROWER_THAN_NATIVE.has(block.kind);
    const narrowerToBrowser =
      prev !== undefined && NARROWER_THAN_NATIVE.has(prev.kind) && block.kind === 'browser';
    const sameFamily =
      prev !== undefined &&
      markdown.slice(prev.end, block.start).trim() === '' &&
      !seenKinds.has(block.kind) &&
      !nativeToNarrower &&
      !narrowerToBrowser;
    if (sameFamily) {
      current.push(block);
      seenKinds.add(block.kind);
      continue;
    }
    if (current.length > 0) {
      families.push({ blocks: current, line: lineOf(markdown, current[0]!.start) });
    }
    current = [block];
    seenKinds = new Set([block.kind]);
  }
  if (current.length > 0) {
    families.push({ blocks: current, line: lineOf(markdown, current[0]!.start) });
  }
  return families;
}
// FAMILY_EXCEPTIONS の照合キーに使う見出し slug。GitHub 互換の厳密さは不要（内部の
// 照合用キーであってリンクの anchor には使わない）ので、manual.ts の slugifyHeading とは
// 独立した簡易版を持つ。
function slugifyHeading(text: string): string {
  return text
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N} -]/gu, '')
    .replace(/ /g, '-');
}
// family の直近の見出し。見出しが区画自身の中にある場合（only:apple が見出しごと囲む等）は
// それを優先し、無ければ区画より前を遡って探す。
function headingSlugOf(markdown: string, family: Family): string {
  const firstBlock = family.blocks[0]!;
  const lastBlock = family.blocks[family.blocks.length - 1]!;
  const span = markdown.slice(firstBlock.start, lastBlock.end);
  const inside = /^#{1,6}\s+(.+)$/m.exec(span);
  if (inside?.[1]) {
    return slugifyHeading(inside[1]);
  }
  const before = markdown.slice(0, firstBlock.start).split('\n');
  for (let i = before.length - 1; i >= 0; i--) {
    const m = /^#{1,6}\s+(.+)$/.exec(before[i]!);
    if (m?.[1]) {
      return slugifyHeading(m[1]);
    }
  }
  return '';
}

function reachOf(family: Family): Set<Platform> {
  const reach = new Set<Platform>();
  for (const block of family.blocks) {
    for (const platform of KIND_PLATFORMS.get(block.kind) ?? []) {
      reach.add(platform);
    }
  }
  return reach;
}
// reach（family 全体の集合）だけを見ると、家族内の 1 区画がその time点で既に他の兄弟に
// 覆われている platform しか足していなくても検出できない（余分な区画が紛れ込んでも
// 集合としては変わらないため）。ここでは block を先頭から見て、各区画が「まだ誰も
// 覆っていない platform」を 1 つ以上足しているかを確かめる。足していない区画があれば
// その index を返す。これは reach が偶然 5 形態ぴったりに揃う「本物の merge」と
// 「余計な区画が紛れ込んだ merge」を区別する唯一の手がかりだが、後者のうち
// 元から欠けていた区画分がちょうど埋め合わされて reach が 5 になるケース
// （例：browser と native の 2 区画がたまたま隣接し、本来は無関係な別々の話題なのに
// 合わせて 5 形態に届いてしまう）は、どの区画も新しい platform を足しているので
// ここでは拾えない。個別文の重複は上の RULES 節（出現回数）が拾う。
function redundantBlockIndex(family: Family): number | undefined {
  const covered = new Set<Platform>();
  for (const [index, block] of family.blocks.entries()) {
    const platforms = KIND_PLATFORMS.get(block.kind) ?? [];
    const addsNew = platforms.some((platform) => !covered.has(platform));
    if (!addsNew) {
      return index;
    }
    for (const platform of platforms) {
      covered.add(platform);
    }
  }
  return undefined;
}

type FamilyException = {
  base: string;
  headingSlug: string;
  headingSlugEn: string;
  headingSlugZhTw: string;
  kinds: OnlyKind[];
  occurrence: number;
  reason: string;
  reach: Platform[];
};
// 全 5 形態に届かないことが意図通りの family。旧版は日本語版の行番号で照合していたが、
// 対象より前の block 数が変わるだけで無関係な例外まで巻き添えで失敗し、失敗の指す先が
// 編集箇所からずれていた。ここでは行番号の代わりに、family 自身が持つ内容だけで決まる
// キー（見出し slug ＋ block の kind 列 ＋ 同じ kind 列がその見出し内で何番目に出たか）で
// 照合する。kind の並びは only:xxx マーカーそのものなので言語間で翻訳されない。照合キー自体は
// kind 列 ＋ occurrence（ファイル内での通し番号）で言語共通にしつつ、見出し slug は ja/en/zh-TW
// それぞれの言語で機械的に算出した値を別々に記録し、3 言語すべてで実際の見出しと突き合わせる
// （headingSlug 系のフィールド）。occurrence は「kind 列が一致する家族が家族の中身と無関係に
// マッチしてしまう」弱い照合キーだが、見出し slug を言語ごとに厳密照合することで、family が
// 別の見出しへ丸ごと移動した場合はいずれか 1 言語でも見出しの不一致として検出できる
// （言語ごとの翻訳語彙が違うため、slug も言語ごとに違う値を別々に記録する必要がある）。
// 検出できないのは、見出し・kind 列・occurrence（＝ family の位置そのもの）はそのままに、
// 同じ kind 列を持つ 2 つの family どうしで各ブロックの本文だけを入れ替えるケース。
// headingSlug も occurrence も本文の中身を見ずに算出するため、この種の swap には無反応
//（docs/manual/04-receipt-ocr_zh-TW.md の `## 1` 表の行と `### 2-2` の箇条書きで実測済み）。
// reach は「その family が実際に届くべき形態」の厳密な一覧。<5 かどうかの緩い判定にすると、
// deriveFamilies が地続きの別 family を誤って 1 つに merge したとき（例：browser 単独の
// 話題の直後に、本来は別話題である apple/windows のみ・android 抜け、のような不完全な話題が
// 空行だけ挟んで続く場合）、混入後の reach もたまたま 5 未満のままなら、この例外の記録に
// 一致するというだけで通ってしまい、android 抜けという本物の欠落を見逃す。reach を厳密一致に
// すれば、意図した family と食い違うものは exception 経由でも通らない。
const FAMILY_EXCEPTIONS: FamilyException[] = [
  {
    base: '01-setup',
    headingSlug: '7-c-apple-intelligence対応機種のみ',
    headingSlugEn: '7-c-apple-intelligence-supported-devices-only',
    headingSlugZhTw: '7-c-apple-intelligence限支援機型',
    kinds: ['apple'],
    occurrence: 0,
    reason:
      '7-C節「Apple Intelligence」。他の platform に Apple Intelligence という選択肢自体が無い',
    reach: ['ios', 'macos'],
  },
  {
    base: '01-setup',
    headingSlug: '7-c-ブラウザ内蔵-ai対応ブラウザのみ',
    headingSlugEn: '7-c-your-browsers-built-in-ai-supported-browsers-only',
    headingSlugZhTw: '7-c-瀏覽器內建-ai僅限支援的瀏覽器',
    kinds: ['browser'],
    occurrence: 0,
    reason: '7-C節「ブラウザ内蔵 AI」。native にはブラウザ内蔵 AI という選択肢自体が無い',
    reach: ['browser'],
  },
  {
    base: '04-receipt-ocr',
    headingSlug: '1-読み取り方法の選び分け要約',
    headingSlugEn: '1-picking-a-reading-method-summary',
    headingSlugZhTw: '1-引擎挑選速查',
    kinds: ['browser'],
    occurrence: 0,
    reason: '表の「AI エンジン（ブラウザ内蔵 AI）」行。native 側にこの選択肢は無い',
    reach: ['browser'],
  },
  {
    base: '04-receipt-ocr',
    headingSlug: '1-読み取り方法の選び分け要約',
    headingSlugEn: '1-picking-a-reading-method-summary',
    headingSlugZhTw: '1-引擎挑選速查',
    kinds: ['apple'],
    occurrence: 0,
    reason:
      '表の「AI エンジン（Apple Intelligence）」行。他の platform に Apple Intelligence という選択肢自体が無い',
    reach: ['ios', 'macos'],
  },
  {
    base: '04-receipt-ocr',
    headingSlug: '1-読み取り方法の選び分け要約',
    headingSlugEn: '1-picking-a-reading-method-summary',
    headingSlugZhTw: '1-引擎挑選速查',
    kinds: ['apple', 'windows', 'android'],
    occurrence: 0,
    reason: '表の「内蔵の規則エンジン（OS 内蔵の文字認識）」行。browser に OS 内蔵の文字認識は無い',
    reach: ['android', 'ios', 'macos', 'windows'],
  },
  {
    base: '04-receipt-ocr',
    headingSlug: '2-2-解析する',
    headingSlugEn: '2-2-analyze',
    headingSlugZhTw: '2-2-解析',
    kinds: ['browser', 'apple', 'windows'],
    occurrence: 0,
    reason:
      '「サブエンジンが 1 つしか無いときセレクトが出ない」の説明。android は常に Tesseract と OS 内蔵の 2 つが使えるため該当せず、android 向けの記述は別 family（同見出し内の 2 件目）にある',
    reach: ['browser', 'ios', 'macos', 'windows'],
  },
  {
    base: '04-receipt-ocr',
    headingSlug: '2-2-解析する',
    headingSlugEn: '2-2-analyze',
    headingSlugZhTw: '2-2-解析',
    kinds: ['apple', 'windows', 'android'],
    occurrence: 1,
    reason: '「OS 内蔵の文字認識が選択肢に入る条件」の説明。browser に OS 内蔵の文字認識は無い',
    reach: ['android', 'ios', 'macos', 'windows'],
  },
  {
    base: '04-receipt-ocr',
    headingSlug: 'ai-エンジンブラウザ内蔵-aiの場合送信ダイアログ無し',
    headingSlugEn: 'ai-engine-your-browsers-built-in-ai-no-dialog',
    headingSlugZhTw: 'ai-引擎瀏覽器內建-ai不會跳出對話框',
    kinds: ['browser'],
    occurrence: 1,
    reason: '見出し「AI エンジン（ブラウザ内蔵 AI）の場合」。native 側に対応する経路が無い',
    reach: ['browser'],
  },
  {
    base: '04-receipt-ocr',
    headingSlug: '内蔵の規則エンジンtesseract端末内の文字認識の場合送信ダイアログ無し',
    headingSlugEn: 'built-in-rule-engine-tesseract-on-device-text-recognition-no-dialog',
    headingSlugZhTw: '內建規則引擎tesseract裝置內的文字辨識不會跳出對話框',
    kinds: ['apple', 'windows', 'android'],
    occurrence: 2,
    reason:
      '「OS 内蔵の文字認識も同様に確認ダイアログは出ません」の説明。browser に OS 内蔵の文字認識は無い',
    reach: ['android', 'ios', 'macos', 'windows'],
  },
  {
    base: '04-receipt-ocr',
    headingSlug: '内蔵のルールベースエンジンのときの警告バナー',
    headingSlugEn: 'built-in-rule-engine-warning-banner',
    headingSlugZhTw: '內建規則引擎時的警告橫幅',
    kinds: ['apple', 'windows', 'android'],
    occurrence: 3,
    reason:
      '内蔵の規則エンジンの警告バナーのうち、OS 内蔵の文字認識向けに足した追加文。browser に OS 内蔵の文字認識は無い',
    reach: ['android', 'ios', 'macos', 'windows'],
  },
  {
    base: '04-receipt-ocr',
    headingSlug: 'ai-エンジンapple-intelligence',
    headingSlugEn: 'ai-engine-apple-intelligence',
    headingSlugZhTw: 'ai-引擎apple-intelligence',
    kinds: ['apple'],
    occurrence: 1,
    reason:
      '見出し「AI エンジン（Apple Intelligence）」の tips 節。他の platform に Apple Intelligence という選択肢自体が無い',
    reach: ['ios', 'macos'],
  },
  {
    base: '04-receipt-ocr',
    headingSlug: 'ai-エンジンブラウザ内蔵-ai',
    headingSlugEn: 'ai-engine-your-browsers-built-in-ai',
    headingSlugZhTw: 'ai-引擎瀏覽器內建-ai',
    kinds: ['browser'],
    occurrence: 2,
    reason: '見出し「AI エンジン（ブラウザ内蔵 AI）」の tips 節。native 側に対応する経路が無い',
    reach: ['browser'],
  },
  {
    base: '04-receipt-ocr',
    headingSlug: '内蔵のルールベースエンジンos-内蔵の文字認識',
    headingSlugEn: 'built-in-rule-engine-the-oss-built-in-text-recognition',
    headingSlugZhTw: '內建規則引擎作業系統內建的文字辨識',
    kinds: ['apple', 'windows', 'android'],
    occurrence: 4,
    reason:
      '見出し「内蔵の規則エンジン（OS 内蔵の文字認識）」の tips 節。browser に該当エンジンは無い',
    reach: ['android', 'ios', 'macos', 'windows'],
  },
  {
    base: '04-receipt-ocr',
    headingSlug: '内蔵の規則エンジン端末内の文字認識',
    headingSlugEn: 'built-in-rule-engine-on-device-text-recognition',
    headingSlugZhTw: '內建規則引擎裝置內的文字辨識',
    kinds: ['apple', 'windows', 'android'],
    occurrence: 5,
    reason:
      '登録番号の候補の拾い方・OS 内蔵の文字認識が使えない端末がある旨の説明。browser に OS 内蔵の文字認識は無い',
    reach: ['android', 'ios', 'macos', 'windows'],
  },
  {
    base: '11-backup',
    headingSlug: '3-1-フォルダを選ぶ',
    headingSlugEn: '3-1-choose-a-folder',
    headingSlugZhTw: '3-1-選一個資料夾',
    kinds: ['apple', 'windows'],
    occurrence: 0,
    reason:
      '「クラウド同期の Tip」。browser には同じ内容が「3-1. Chromium 系」の説明に既に含まれている。android はフォルダ選択でクラウドの保存先を選べるか確かめていないので置かない',
    reach: ['ios', 'macos', 'windows'],
  },
  {
    base: '11-backup',
    headingSlug: '3-2-firefox--safari-26-以降opfs-のみ',
    headingSlugEn: '3-2-firefox--safari-26-and-later-opfs-only',
    headingSlugZhTw: '3-2-firefox--safari-26-以後只能-opfs',
    kinds: ['browser'],
    occurrence: 0,
    reason:
      'Firefox/Safari の OPFS フォールバックと iOS 手動運用の節。OPFS はブラウザ専用ストレージで native には無い',
    reach: ['browser'],
  },
];

const MANUAL_DIR = resolve('docs/manual');
const manualFiles = readdirSync(MANUAL_DIR)
  .filter((file) => file.endsWith('.md'))
  .sort();
const usedExceptions = new Set<number>();
// 「形態ごとに変種は高々 1 つ」は独立の test にしない：deriveFamilies 自身が同じ kind の
// 重複を family 内で弾き（seenKinds）、native → apple/windows/android の遷移でも family を
// 割る（上の nativeToNarrower）ため、1 つの platform を読む kind が family 内で 2 つ以上
// 揃うことは derivation の作りそのものが防いでいる。ここで同じ判定をもう一度 family ごとに
// 回しても、生成規則を生成規則でなぞるだけで別証拠にならない（実際、常に true にしかならない）。
// 変種が実際に「ちょうど 1 回」出ているかは、本文の出現回数を数える上の RULES 節が文単位で
// 見ている。deriveFamilies 自体の性質は下の直接テストで別に確かめる。
describe('family は例外を除き全形態に届く', () => {
  for (const file of manualFiles) {
    const src = readFileSync(resolve(MANUAL_DIR, file), 'utf-8');
    const { base, lang } = baseAndLangOf(file);
    // kind 列の出現順は only:xxx マーカーそのもの（翻訳されない）なので、ja/en/zh-TW の
    // どの版で数えても揃う。この出現回数を照合キーの一部にする：headingSlug だけでは
    // 同じ見出しの下に同じ kind 列を持つ family が複数あるケースを区別できない
    // （現状は無いが、将来増えても静かに誤爆しないようにする）。
    const occurrenceByKinds = new Map<string, number>();
    for (const family of deriveFamilies(src)) {
      const kindsList = family.blocks.map((block) => block.kind);
      const kindsKey = kindsList.join('>');
      const occurrence = occurrenceByKinds.get(kindsKey) ?? 0;
      occurrenceByKinds.set(kindsKey, occurrence + 1);
      const headingSlug = headingSlugOf(src, family);
      const label = `docs/manual/${file}:${family.line} [${kindsList.join(',')}]`;
      const exceptionIndex = FAMILY_EXCEPTIONS.findIndex(
        (exception) =>
          exception.base === base &&
          exception.kinds.join('>') === kindsKey &&
          exception.occurrence === occurrence,
      );
      const exception = exceptionIndex === -1 ? undefined : FAMILY_EXCEPTIONS[exceptionIndex]!;
      if (exception) {
        usedExceptions.add(exceptionIndex);
        // kind 列・occurrence だけでは、family が別の見出しへ丸ごと移動しても検出できない
        // （家族の中身に関係なく機械的に番号で拾うだけのため）。見出し slug を言語ごとに
        // 記録し、3 言語すべてで実際の見出しと突き合わせることで、その移動をいずれかの
        // 言語で必ず検出する。ただし見出し・kind 列・occurrence が変わらないまま、同じ
        // kind 列を持つ 2 つの family の間で本文だけを入れ替える swap は検出できない
        // （上の説明コメント参照）。
        const expectedSlug =
          lang === 'ja'
            ? exception.headingSlug
            : lang === 'en'
              ? exception.headingSlugEn
              : exception.headingSlugZhTw;
        test(`${label} の見出し slug が記録（${expectedSlug}）と一致する`, () => {
          expect(headingSlug).toBe(expectedSlug);
        });
      }
      test(`${label} は全形態に届く（例外なら reach が記録と一致）`, () => {
        const reach = [...reachOf(family)].sort();
        const expected = exception ? [...exception.reach].sort() : [...PLATFORMS].sort();
        expect(reach).toEqual(expected);
      });
      test(`${label} に、既に兄弟区画が覆った platform しか足さない冗長な区画は無い`, () => {
        expect(redundantBlockIndex(family)).toBeUndefined();
      });
    }
  }
  test('FAMILY_EXCEPTIONS はすべて実在する family に対応する（記録の劣化を防ぐ）', () => {
    expect(usedExceptions.size).toBe(FAMILY_EXCEPTIONS.length);
  });
});
// 「1 つの platform を読む kind が family 内で 2 つ以上揃わない」を deriveFamilies 自身に
// 対して直接確かめる。壊れた構造を人工的に作り、それが実際に「1 family に収まってしまう」
// と失敗するようにする（同じ kind の連続を弾く分岐・native → 絞り込みで割る分岐、
// それぞれを外すと失敗する形）。
describe('deriveFamilies は同じ platform を読む kind を 1 family に 2 つ以上入れない', () => {
  test('同じ kind が空行だけ挟んで繰り返すと family が割れる（apple, apple）', () => {
    const md = '<!-- only:apple -->\nA\n<!-- /only -->\n\n<!-- only:apple -->\nB\n<!-- /only -->\n';
    const families = deriveFamilies(md);
    expect(families).toHaveLength(2);
  });
  test('native の直後に apple/windows/android が来ると family が割れる（native, apple）', () => {
    const md = '<!-- only:native -->\nA\n<!-- /only -->\n<!-- only:apple -->\nB\n<!-- /only -->\n';
    const families = deriveFamilies(md);
    expect(families).toHaveLength(2);
  });
  test('apple/windows/android の直後に browser が来ると family が割れる（windows, browser）', () => {
    const md =
      '<!-- only:windows -->\nA\n<!-- /only -->\n<!-- only:browser -->\nB\n<!-- /only -->\n';
    const families = deriveFamilies(md);
    expect(families).toHaveLength(2);
  });
});
// native → narrower（apple/windows/android）と narrower → browser は family を割るが、逆向きの
// browser → native / browser → narrower は割らない。これは非対称の見落としではなく意図：
// browser + native は「1 話題を出し分けているだけ」の実例が本文に多数あり（01-setup.md・
// 04-receipt-ocr.md・11-backup.md 等）、ここを割ると正当な family まで壊れて exception の
// 山になる。ここで実際に検出できるのは次の 2 つまで：
// (1) 混ざった話題の reach が全形態（5）に届かない場合。FAMILY_EXCEPTIONS の reach を厳密
//     一致にすることで検出する（上の『family は例外を除き全形態に届く』参照）。
// (2) 混ざった区画のどれかが、兄弟区画が既に覆った platform しか足していない場合
//     （例：apple と macos/ios が同じ family に紛れ込む）。上の redundantBlockIndex で検出する。
// 検出できないのは、混入した話題が「まだ誰も覆っていない platform」を実際に足しながら、
// たまたま家族全体の reach が 5 形態ちょうどに揃ってしまうケース（例：本来無関係な
// only:browser の 1 文と only:native の 1 文が地続きで並び、両方とも新しい platform を
// 足すので (1)(2) どちらの検査もすり抜ける）。これは prose の意味を読まない限り原理的に
// 区別できないため、閉じたとは主張しない——個別文の内容は RULES 節（出現回数）が別途見る。
describe('browser → native/narrower は意図して割らない。混入は reach の厳密一致で検出する', () => {
  test('browser の直後に native が来ても family は割れない（1 話題の browser/native 出し分け）', () => {
    const md =
      '<!-- only:browser -->\nA\n<!-- /only -->\n<!-- only:native -->\nB\n<!-- /only -->\n';
    const families = deriveFamilies(md);
    expect(families).toHaveLength(1);
  });
  test('browser 単独のつもりの話題の直後に、android 抜けの別話題が地続きで混ざると reach が記録と食い違う', () => {
    // 「browser だけの話題」の exception（reach: ['browser']）の直後に、別話題として
    // apple/windows だけ書いて android を書き忘れた、という壊れた入力を再現する。
    const md =
      '<!-- only:browser -->\nA\n<!-- /only -->\n<!-- only:apple -->\nB\n<!-- /only -->\n<!-- only:windows -->\nC\n<!-- /only -->\n';
    const [family] = deriveFamilies(md);
    // deriveFamilies は browser → apple を割らないため、3 区画とも 1 family に混ざる
    expect(family!.blocks).toHaveLength(3);
    const reach = [...reachOf(family!)].sort();
    const declaredReach: Platform[] = ['browser'];
    // <5 かどうかの緩い判定なら reach（4 要素）も通ってしまうが、厳密一致なら
    // exception の記録（['browser']）と食い違い、android 抜けを見逃さない
    expect(reach).not.toEqual([...declaredReach].sort());
  });
  test('reach が既に 5 形態揃った family に、その形態を既に覆っている kind が紛れ込むと redundantBlockIndex が検出する', () => {
    // 15-invoices.md:56 相当（browser/macos/ios/windows/android の 5 区画で reach=5）の
    // 直後に apple を挿入する（H2 の再現：apple の reach は macos・ios で、この時点では
    // まだどちらも出ていないので apple 自体は新規性を足す。その次に続く本来の macos 区画が、
    // 今度は apple に既に覆われて重複になる）。
    const md =
      '<!-- only:browser -->\nA\n<!-- /only -->\n<!-- only:apple -->\nX\n<!-- /only -->\n<!-- only:macos -->\nB\n<!-- /only -->\n<!-- only:ios -->\nC\n<!-- /only -->\n<!-- only:windows -->\nD\n<!-- /only -->\n<!-- only:android -->\nE\n<!-- /only -->\n';
    const [family] = deriveFamilies(md);
    expect([...reachOf(family!)].sort()).toEqual([...PLATFORMS].sort());
    // reach だけを見る検査ならここで見逃す（5 形態のまま変わらない）が、
    // redundantBlockIndex は 3 番目の区画（macos。apple が既に覆っているため）が
    // 新しい platform を足していないと拾う
    expect(redundantBlockIndex(family!)).toBe(2);
  });
  test('reach が既に 5 形態揃う 2 話題が地続きで並ぶ場合、redundantBlockIndex は意図通り検出しない（原理的な限界）', () => {
    // only:browser の 1 文 + only:native の 1 文が、本来は無関係な 2 つの話題として
    // たまたま地続きに並んだ場合。どちらも新しい platform を足すので、reach（5 形態）も
    // redundantBlockIndex（新規性チェック）もすり抜ける。ここは検出できないことを直接確かめる。
    const md =
      '<!-- only:browser -->\nA\n<!-- /only -->\n<!-- only:native -->\nB\n<!-- /only -->\n';
    const [family] = deriveFamilies(md);
    expect([...reachOf(family!)].sort()).toEqual([...PLATFORMS].sort());
    expect(redundantBlockIndex(family!)).toBeUndefined();
  });
});
// android は名称を「端末内の文字認識」（en: on-device text recognition、zh-TW: 裝置內的文字辨識）に
// 改めたので、旧名称のどの表記も android の剥がした結果に残っていないかを確かめる。DISCLAIMER の
// 改訂履歴表は過去のバージョンの記述をそのまま残す約束なので、そこだけ例外にする。
const OLD_NATIVE_ENGINE_NAME_PATTERNS = [
  /OS 内蔵の文字認識/,
  /OS's built-in text recognition/,
  /OS built-in text recognition/,
  /OS's built-in recognition/,
  /作業系統內建的文字辨識/,
  /作業系統內建文字辨識/,
];
const POLICY_DOC_FILES = ['DISCLAIMER', 'PRIVACY', 'SECURITY'].flatMap((base) => [
  `${base}.md`,
  `${base}_en.md`,
  `${base}_zh-TW.md`,
]);
function isDisclaimerRevisionRow(file: string, line: string): boolean {
  return file.startsWith('DISCLAIMER') && /^\s*\|\s*\d+\s*\|\s*\d{4}-\d{2}-\d{2}\s*\|/.test(line);
}
describe('android の剥がした結果に旧エンジン名の表記が残っていない（DISCLAIMER 改訂履歴を除く）', () => {
  const targets = [
    ...POLICY_DOC_FILES.map((file) => ({ file, path: resolve(file) })),
    ...manualFiles.map((file) => ({ file, path: resolve(MANUAL_DIR, file) })),
  ];
  for (const { file, path } of targets) {
    test(`${file} の android 剥がした結果に旧名称が無い`, () => {
      const folded = stripBuildOnly(readFileSync(path, 'utf-8'), 'android', file);
      const lines = folded.split('\n');
      const hits = lines.filter(
        (line) =>
          OLD_NATIVE_ENGINE_NAME_PATTERNS.some((pattern) => pattern.test(line)) &&
          !isDisclaimerRevisionRow(file, line),
      );
      expect(hits).toEqual([]);
    });
  }
});
// 04-receipt-ocr の「内蔵の規則エンジンのときの警告バナー」節にある引用文は、実際に画面へ
// 出す receipt_native_engine_notice（_android）と文字ズレしていると使用者に嘘の画面を
// 見せたまま説明することになる。マニュアルと messages を両方読んで一致を機械的に確かめる。
const RECEIPT_OCR_DOC = {
  ja: { file: 'docs/manual/04-receipt-ocr.md', quoteRe: /^> (.*文字認識.*の結果です。.*)$/m },
  en: {
    file: 'docs/manual/04-receipt-ocr_en.md',
    quoteRe: /^> (.*recognition.*Be sure to check and correct.*)$/m,
  },
  'zh-TW': {
    file: 'docs/manual/04-receipt-ocr_zh-TW.md',
    quoteRe: /^> (.*文字辨識.*的結果.*)$/m,
  },
} as const;
const MESSAGES_BY_LANG = { ja, en, 'zh-TW': zhTW } as const;
describe('04-receipt-ocr の警告バナー引用文は receipt_native_engine_notice(_android) と一致する', () => {
  for (const [lang, { file, quoteRe }] of Object.entries(RECEIPT_OCR_DOC)) {
    const src = readFileSync(resolve(file), 'utf-8');
    const messages = MESSAGES_BY_LANG[lang as keyof typeof MESSAGES_BY_LANG];
    for (const [platform, key] of [
      ['macos', 'receipt_native_engine_notice'],
      ['windows', 'receipt_native_engine_notice'],
      ['android', 'receipt_native_engine_notice_android'],
    ] as const) {
      test(`${file} / ${platform} の引用文が messages.${lang}.${key} と一致する`, () => {
        const folded = stripBuildOnly(src, platform, file);
        const quote = quoteRe.exec(folded)?.[1];
        expect(quote).toBe(messages[key as keyof typeof messages]);
      });
    }
  }
});
