import { parseCsv } from '../lib/csv';
import { buildRawRow, isDateLike, normalizeDate, stripComma } from './_helpers';
import type { CsvParser, ParsedTransaction } from './types';
// 三井住友カード（NL / Olive 含む）Vpass の利用明細 CSV（実データ確認済）。
// この CSV には表頭行が無く、1 行目はカード会員情報（氏名 / 番号 / 種別）。
// 2 行目以降がデータで、列は位置で解釈する（1 サンプルからの推定。
// 列構成が異なる個体が出たら要再確認）：
//   [0]利用日 [1]ご利用店名・内容 [2]ご利用金額 [3]支払区分
//   [4]何回目 [5]今回お支払額（確定額。キャッシュバックは負値）[6]備考
// 末尾に日付の無い請求合計行が付くため、利用日が日付らしくない行は読み飛ばす。
// クレジットのため通常は credit（未払金 増）。キャッシュバック等の負値は
// debit（未払金 減）として扱う。

const DISPLAY = '三井住友カード';
const COL = {
  date: 0,
  desc: 1,
  amount: 2,
  plan: 3,
  count: 4,
  settled: 5,
} as const;
const HEADER = [
  '利用日',
  'ご利用店名・内容',
  'ご利用金額',
  '支払区分',
  '何回目',
  '今回お支払額',
  '備考',
];

const smbcCardParser: CsvParser = {
  name: 'smbc-card',
  displayName: DISPLAY,
  accountCode: '2120',
  encoding: 'shift_jis',
  parse(text: string): ParsedTransaction[] {
    const rows = parseCsv(text);
    // 表頭が無い形式のため、位置解釈の前に最低限の指紋を確認する（パーサー誤選択の検出）。
    // 1 行目はカード会員情報（日付ではない）。先頭が日付なら別形式とみなす。
    const firstNonEmpty = rows.find((r) => r.some((c) => c.trim() !== ''));
    if (firstNonEmpty && isDateLike((firstNonEmpty[COL.date] ?? '').trim())) {
      throw new Error(`${DISPLAY} の CSV 形式と一致しません（カード会員情報の行が見つかりません）`);
    }

    const result: ParsedTransaction[] = [];
    for (const row of rows) {
      const dateRaw = (row[COL.date] ?? '').trim();
      if (!isDateLike(dateRaw)) {
        continue;
      }
      // 位置で列を解釈するため、データ行には最低 6 列（利用日〜今回お支払額）が必要。
      if (row.length < 6) {
        throw new Error(`${DISPLAY} の CSV 形式と一致しません（列数が不足しています）`);
      }
      const description = (row[COL.desc] ?? '').trim();
      const useRaw = (row[COL.amount] ?? '').trim();
      const settledRaw = (row[COL.settled] ?? '').trim();

      let amount: string;
      let side: 'debit' | 'credit';
      if (useRaw) {
        amount = stripComma(useRaw);
        side = 'credit';
      } else if (settledRaw) {
        const cleaned = stripComma(settledRaw);
        const negative = cleaned.startsWith('-');
        amount = cleaned.replace(/^[-+]/, '');
        side = negative ? 'debit' : 'credit';
      } else {
        continue;
      }
      if (!amount) {
        continue;
      }

      const memoParts: string[] = [];
      const plan = (row[COL.plan] ?? '').trim();
      if (plan && plan !== '１' && plan !== '1') {
        memoParts.push(plan);
      }
      const count = (row[COL.count] ?? '').trim();
      if (count && count !== '１' && count !== '1') {
        memoParts.push(`${count}回目`);
      }
      const memo = memoParts.length > 0 ? memoParts.join(' / ') : undefined;

      const transaction: ParsedTransaction = {
        date: normalizeDate(dateRaw),
        description,
        amount,
        side,
        rawRow: buildRawRow(HEADER, row),
      };
      if (memo) {
        transaction.memo = memo;
      }
      result.push(transaction);
    }
    return result;
  },
};

export default smbcCardParser;
export { smbcCardParser };
