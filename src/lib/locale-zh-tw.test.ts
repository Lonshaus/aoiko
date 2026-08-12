import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { ACCOUNTS_2026 } from '../tax-schema/2026/accounts';
/**
 * zh-TW の訳文に日本語の新字体が紛れ込んでいないことを見る。
 *
 * 方針は zh-TW.json の `$translator_note` にある通り「帳簿・科目名稱・.xtx 輸出は日文の
 * まま、それ以外は中文」。守るべきは一貫性で、訳すなら訳す・残すなら丸ごと残す。混ぜた
 * ものは、どちらの読み方をしても間違いになる（実際に「稅理士・税務署」のように 1 文の中で
 * 両方使っている箇所があった）。
 *
 * 判定は機械的にできる部分だけに絞る。正體中文に存在しない新字体の字だけを見て、
 * 原文のまま残すと決めた語（科目名・様式名など）を先に取り除いてから探す。
 */
const SHINJITAI: Record<string, string> = {
  税: '稅',
  国: '國',
  実: '實',
  検: '檢',
  発: '發',
  経: '經',
  売: '賣',
  払: '拂',
  円: '圓',
  対: '對',
  応: '應',
  産: '產',
  帰: '歸',
  届: '屆',
  継: '繼',
  営: '營',
  価: '價',
  険: '險',
  当: '當',
  会: '會',
  広: '廣',
  戸: '戶',
  関: '關',
  証: '證',
  単: '單',
  団: '團',
  図: '圖',
  数: '數',
  転: '轉',
  様: '樣',
  権: '權',
  済: '濟',
  状: '狀',
  歴: '歷',
  覧: '覽',
  訳: '譯',
  験: '驗',
  総: '總',
  齢: '齡',
  蔵: '藏',
  読: '讀',
};
/**
 * 日文のまま残す語。ここに足してよいのは次の 3 つだけで、
 * 「置換すると面倒だから」で足してはいけない。
 *
 * 1. 勘定科目名（accounts.ts から自動で入るので手で書かない）
 * 2. 国税庁の様式・書類の正式名称
 * 3. かなを含む日本語の語句（かなが混じっている時点で中文の文ではない）
 */
const KEEP_AS_JAPANESE = [
  // 様式・書類の正式名称
  '優良な電子帳簿の保存等に係る届出書',
  '個別評価による貸倒引当金に関する明細書',
  '消費税及び地方消費税の申告書(簡易課税用)',
  '消費税及び地方消費税の申告書(一般用)',
  '消費税及び地方消費税の申告書',
  '収支内訳書',
  // かなを含む日本語の語句
  '少額減価償却資産特例（措法28の2、即時全額損金）',
  '少額減価償却資産特例（措法28の2、即時償却）',
  '実機組み込み',
  '弥生会計',
];

function stripKept(text: string, kept: readonly string[]): string {
  let out = text;
  for (const term of kept) {
    out = out.split(term).join('');
  }
  return out;
}

const messages = JSON.parse(readFileSync('messages/zh-TW.json', 'utf8')) as Record<string, unknown>;
// 科目名は帳簿そのものなので日文のまま。長いものから消さないと部分一致で取りこぼす。
const kept = [...ACCOUNTS_2026.map((a) => a.name), ...KEEP_AS_JAPANESE].sort(
  (a, b) => b.length - a.length,
);

describe('zh-TW の訳文', () => {
  test('日本語の新字体が中文の文に紛れていない', () => {
    const offenders: string[] = [];
    for (const [key, value] of Object.entries(messages)) {
      if (typeof value !== 'string') {
        continue;
      }
      const rest = stripKept(value, kept);
      const found = [...new Set([...rest].filter((c) => c in SHINJITAI))];
      if (found.length > 0) {
        const fix = found.map((c) => `${c}→${SHINJITAI[c]}`).join(' ');
        offenders.push(`${key}: ${fix}`);
      }
    }
    expect(offenders).toEqual([]);
  });
  // 1 文の中で両方使っているものは、どちらの方針で読んでも誤り。
  //
  // ここでも先に原文のまま残す語を取り除く。「消費税及び地方消費税の申告書」（様式名なので
  // 日文のまま）と「課稅標準額」（中文）が同居するのは正しい姿で、これを誤りにすると
  // 税法の用語を言い換えて逃げることになる。
  test('同じ字の新字体と正體が同居していない', () => {
    const offenders: string[] = [];
    for (const [key, value] of Object.entries(messages)) {
      if (typeof value !== 'string') {
        continue;
      }
      const stripped = stripKept(value, kept);
      const both = [...new Set([...stripped].filter((c) => c in SHINJITAI))].filter((c) => {
        const traditional = SHINJITAI[c];
        return traditional !== undefined && stripped.includes(traditional);
      });
      if (both.length > 0) {
        offenders.push(`${key}: ${both.join(' ')}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
