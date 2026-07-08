// 標準 CSV パーサー。BOM 除去・"" でクォートされたフィールド・引用内のカンマや
// エスケープされた "" に対応する。Shift_JIS 等のエンコーディング処理は呼び元責任。
export function parseCsv(text: string): string[][] {
  const stripped = text.replace(/^﻿/, '');
  if (!stripped) {
    return [];
  }
  const rows: string[][] = [];
  let current = '';
  let row: string[] = [];
  let inQuotes = false;

  for (let i = 0; i < stripped.length; i++) {
    const c = stripped[i];

    if (inQuotes) {
      if (c === '"') {
        if (stripped[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += c;
      }
      continue;
    }

    if (c === '"' && current.length === 0) {
      inQuotes = true;
    } else if (c === ',') {
      row.push(current);
      current = '';
    } else if (c === '\r') {
      // CR は次の LF と組で扱う。単独 CR は行終端
      row.push(current);
      current = '';
      rows.push(row);
      row = [];
      if (stripped[i + 1] === '\n') {
        i++;
      }
    } else if (c === '\n') {
      row.push(current);
      current = '';
      rows.push(row);
      row = [];
    } else {
      current += c;
    }
  }
  // 末尾に終端改行が無い場合のフラッシュ
  if (current.length > 0 || row.length > 0) {
    row.push(current);
    rows.push(row);
  }
  // 完全に空の行は除外
  return rows.filter((r) => !(r.length === 1 && r[0] === ''));
}
// CSV 出力用のフィールドエスケープ（RFC 4180）。カンマ・ダブルクォート・改行を
// 含む場合のみ "" でクォートし、内部の " は "" にエスケープする。
export function csvField(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
// 複数行の CSV テキストを組み立てる。lineEnding は既定で CRLF（弥生形式が要求する改行）。
export function buildCsv(rows: string[][], lineEnding: '\r\n' | '\n' = '\r\n'): string {
  return rows.map((row) => row.map(csvField).join(',')).join(lineEnding) + lineEnding;
}