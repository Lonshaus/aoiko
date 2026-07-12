import { parseCsv } from '../lib/csv';
import {
  applySign,
  buildRawRow,
  normalizeDate,
  optionalColumn,
  requireColumns,
  stripComma,
} from './_helpers';
import type { CsvParser, ParsedTransaction, ParserEncoding } from './types';
// JSON で宣言的に CSV パーサーを定義する。
// 「ヘッダー名でカラムを指し、値を Decimal 字串に正規化する」というほぼ全銀行・カードに共通する
// パターンを設定だけで表現できる。複雑な分岐（PayPay 符号判定、複数行マージ等）は TypeScript で書く。

export interface JsonParserConfig {
  /** 一意なキー：URL-safe な英数字 + ハイフン */
  name: string;
  /** UI 表示名 */
  displayName: string;
  /** 既知側勘定科目（1130 普通預金 / 2120 未払金 等） */
  accountCode: string;
  /** ファイル文字コード */
  encoding: ParserEncoding;
  /** カラム定義 */
  columns: ColumnsConfig;
}

export type ColumnsConfig = (BankColumns | CardColumns | SignedAmountColumns) & {
  balance?: { header: string };
  memo?: { header: string };
};
// 銀行型：出金/入金で側を判定（例：三菱UFJ、SBI）
export interface BankColumns {
  date: { header: string };
  description: { header: string; fallbackHeader?: string };
  withdrawal: { header: string };
  deposit: { header: string };
}
// カード型：固定側（例：楽天カード、JCB は常に credit）
export interface CardColumns {
  date: { header: string };
  description: { header: string; fallbackHeader?: string };
  amount: { header: string; side: 'debit' | 'credit' };
}
// 符号付き型：単一金額欄の符号で判定（例：PayPay）
export interface SignedAmountColumns {
  date: { header: string };
  description: { header: string; fallbackHeader?: string };
  signedAmount: { header: string };
}

function isBank(
  c: ColumnsConfig,
): c is BankColumns & { balance?: { header: string }; memo?: { header: string } } {
  return 'withdrawal' in c && 'deposit' in c;
}
function isCard(
  c: ColumnsConfig,
): c is CardColumns & { balance?: { header: string }; memo?: { header: string } } {
  return 'amount' in c;
}
function isSigned(
  c: ColumnsConfig,
): c is SignedAmountColumns & { balance?: { header: string }; memo?: { header: string } } {
  return 'signedAmount' in c;
}
// JsonParserConfig を CsvParser インスタンスに変換する。
export function defineParser(config: JsonParserConfig): CsvParser {
  return {
    name: config.name,
    displayName: config.displayName,
    accountCode: config.accountCode,
    encoding: config.encoding,
    parse(text: string): ParsedTransaction[] {
      const rows = parseCsv(text);
      if (rows.length < 2) {
        return [];
      }
      const header = rows[0]!;
      const cols = config.columns;
      const required = collectRequiredHeaders(cols);
      const idxMap = requireColumns(header, required, config.displayName);
      const idxBalance = cols.balance ? optionalColumn(header, cols.balance.header) : -1;
      const idxMemo = cols.memo ? optionalColumn(header, cols.memo.header) : -1;
      const idxDescFallback =
        cols.description.fallbackHeader !== undefined
          ? optionalColumn(header, cols.description.fallbackHeader)
          : -1;

      const result: ParsedTransaction[] = [];
      for (let i = 1; i < rows.length; i++) {
        const row = rows[i]!;
        const dateRaw = (row[idxMap[cols.date.header]!] ?? '').trim();
        if (!dateRaw) {
          continue;
        }
        let description = (row[idxMap[cols.description.header]!] ?? '').trim();
        if (!description && idxDescFallback >= 0) {
          description = (row[idxDescFallback] ?? '').trim();
        }

        let amount: string;
        let side: 'debit' | 'credit';
        if (isBank(cols)) {
          const outRaw = (row[idxMap[cols.withdrawal.header]!] ?? '').trim();
          const inRaw = (row[idxMap[cols.deposit.header]!] ?? '').trim();
          if (outRaw && !inRaw) {
            amount = stripComma(outRaw);
            side = 'credit';
          } else if (inRaw && !outRaw) {
            amount = stripComma(inRaw);
            side = 'debit';
          } else {
            continue;
          }
        } else if (isCard(cols)) {
          const raw = (row[idxMap[cols.amount.header]!] ?? '').trim();
          if (!raw) {
            continue;
          }
          // 返金・キャンセル行は負数 → 絶対値 + 反対側
          ({ amount, side } = applySign(stripComma(raw), cols.amount.side));
        } else if (isSigned(cols)) {
          const raw = (row[idxMap[cols.signedAmount.header]!] ?? '').trim();
          if (!raw) {
            continue;
          }
          const cleaned = raw.replace(/[¥￥,\s]/g, '');
          const isNeg = cleaned.startsWith('-');
          amount = cleaned.replace(/^[-+]/, '');
          if (!amount) {
            continue;
          }
          side = isNeg ? 'credit' : 'debit';
        } else {
          continue;
        }

        const transaction: ParsedTransaction = {
          date: normalizeDate(dateRaw),
          description,
          amount,
          side,
          rawRow: buildRawRow(header, row),
        };
        if (idxBalance >= 0) {
          const b = (row[idxBalance] ?? '').trim();
          if (b) {
            transaction.balance = stripComma(b);
          }
        }
        if (idxMemo >= 0) {
          const m = (row[idxMemo] ?? '').trim();
          if (m) {
            transaction.memo = m;
          }
        }
        result.push(transaction);
      }
      return result;
    },
  };
}

function collectRequiredHeaders(cols: ColumnsConfig): string[] {
  const headers: string[] = [cols.date.header, cols.description.header];
  if (isBank(cols)) {
    headers.push(cols.withdrawal.header, cols.deposit.header);
  } else if (isCard(cols)) {
    headers.push(cols.amount.header);
  } else if (isSigned(cols)) {
    headers.push(cols.signedAmount.header);
  }
  return headers;
}
