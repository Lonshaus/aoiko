import { parseCsv } from '../lib/csv';
import {
  buildRawRow,
  normalizeDate,
  optionalColumn,
  requireColumns,
  stripComma,
} from './_helpers';
import type { CsvParser, ParsedTransaction } from './types';
// PayPay 取引履歴 CSV（実データ確認済）。
// エンコーディング：UTF-8（BOM 付き。parseCsv が BOM を除去する）
// ヘッダー：取引日, 出金金額（円）, 入金金額（円）, 海外出金金額, 通貨,
//           変換レート（円）, 利用国, 取引内容, 取引先, 取引方法,
//           支払い区分, 利用者, 取引番号
// 取引日は時刻付き（'YYYY/MM/DD HH:MM:SS'）。空値は '-'。
//
// このアカウントは PayPay 残高ではなくクレジット（PayPayカード／クレジット VISA）
// 決済で運用されている前提のため accountCode は 2120（未払金）。
// 出金金額（円）がある支払い行のみを credit（未払金 増）として取り込む。
// 入金行（ポイント・残高の獲得など）は仕訳対象外として読み飛ばす。
// 残高チャージ運用が必要になった場合は別 parser で対応する。

const DISPLAY = 'PayPay（クレジット決済）';
const REQUIRED = ['取引日', '出金金額（円）', '取引先'] as const;

function clean(v: string): string {
  const t = v.trim();
  return t === '-' ? '' : t;
}

const paypayParser: CsvParser = {
  name: 'paypay',
  displayName: DISPLAY,
  accountCode: '2120',
  encoding: 'utf-8',
  parse(text: string): ParsedTransaction[] {
    const rows = parseCsv(text);
    if (rows.length < 2) {
      return [];
    }
    const header = rows[0]!;
    const idx = requireColumns(header, REQUIRED, DISPLAY);
    const idxContent = optionalColumn(header, '取引内容');
    const idxMethod = optionalColumn(header, '取引方法');

    const result: ParsedTransaction[] = [];
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i]!;
      const dateRaw = clean(row[idx['取引日']!] ?? '');
      if (!dateRaw) {
        continue;
      }
      const outRaw = clean(row[idx['出金金額（円）']!] ?? '');
      if (!outRaw) {
        continue;
      }
      const amount = stripComma(outRaw);
      if (!amount) {
        continue;
      }
      const description = clean(row[idx['取引先']!] ?? '');

      const memoParts: string[] = [];
      if (idxMethod >= 0) {
        const m = clean(row[idxMethod] ?? '');
        if (m) {
          memoParts.push(m);
        }
      }
      if (idxContent >= 0) {
        const c = clean(row[idxContent] ?? '');
        if (c && c !== '支払い') {
          memoParts.push(c);
        }
      }
      const memo = memoParts.length > 0 ? memoParts.join(' / ') : undefined;

      const transaction: ParsedTransaction = {
        date: normalizeDate(dateRaw),
        description,
        amount,
        side: 'credit',
        rawRow: buildRawRow(header, row),
      };
      if (memo) {
        transaction.memo = memo;
      }
      result.push(transaction);
    }
    return result;
  },
};

export default paypayParser;
export { paypayParser };