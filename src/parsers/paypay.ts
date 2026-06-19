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
// 出金金額（円）がある支払い行は credit（未払金 増）として取り込む。
// 入金行のうち「返金・返品・キャンセル」は debit（未払金 減）として取り込み、
// それ以外の入金（ポイント・残高の獲得など）は仕訳対象外として読み飛ばす。
// 残高チャージ運用が必要になった場合は別 parser で対応する。

const DISPLAY = 'PayPay（クレジット決済）';
const REQUIRED = ['取引日', '出金金額（円）', '取引先'] as const;
const REFUND_PATTERN = /返金|返品|キャンセル/;

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
    const idxIn = optionalColumn(header, '入金金額（円）');

    const result: ParsedTransaction[] = [];
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i]!;
      const dateRaw = clean(row[idx['取引日']!] ?? '');
      if (!dateRaw) {
        continue;
      }
      const content = idxContent >= 0 ? clean(row[idxContent] ?? '') : '';
      const outRaw = clean(row[idx['出金金額（円）']!] ?? '');
      const inRaw = idxIn >= 0 ? clean(row[idxIn] ?? '') : '';

      let amount: string;
      let side: 'debit' | 'credit';
      if (outRaw) {
        amount = stripComma(outRaw);
        side = 'credit';
      } else if (inRaw && REFUND_PATTERN.test(content)) {
        // 返金・返品・キャンセルの入金は未払金の減少（debit）として取り込む
        amount = stripComma(inRaw);
        side = 'debit';
      } else {
        // その他の入金（ポイント・残高の獲得など）は対象外
        continue;
      }
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
      if (content && content !== '支払い') {
        memoParts.push(content);
      }
      const memo = memoParts.length > 0 ? memoParts.join(' / ') : undefined;

      const transaction: ParsedTransaction = {
        date: normalizeDate(dateRaw),
        description,
        amount,
        side,
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