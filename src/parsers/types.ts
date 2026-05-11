// CSV パーサーの返り値の単位。1 トランザクション = 将来の 1 仕訳の片側。
// CSV ソースから既知の側（普通預金から出た / 入った）を `side` で表す。
// 反対側の科目はユーザーが確認時に決定する。
export interface ParsedTransaction {
  date: string;                  // 'YYYY-MM-DD'
  description: string;
  amount: string;                // Decimal 字串、必ず非負
  side: 'debit' | 'credit';      // 既知側の借方/貸方
  balance?: string;              // 残高（存在すれば）
  memo?: string;
  rawRow: Record<string, string>;
}

export type ParserEncoding = 'utf-8' | 'shift_jis';

export interface CsvParser {
  readonly name: string;          // 'sbi-hybrid' 等のキー
  readonly displayName: string;   // UI 表示名
  readonly accountCode: string;   // 既知側の勘定科目コード（例：'1130' 普通預金、'2120' 未払金）
  readonly encoding: ParserEncoding; // ファイル読み込み時の文字コード
  parse(csvText: string): ParsedTransaction[];
}