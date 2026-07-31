import type { ParserEncoding } from '../parsers/types';
// CSV バイト列を指定エンコーディングで文字列化する。
// shift_jis は WHATWG 仕様上 windows-31j（CP932）として解釈され、
// ①㈱∑ 等の機種依存文字や全角チルダ（～ U+FF5E）も含めて復号できる。
// TextDecoder は既定で UTF-8 の BOM を除去する。
export class CsvEncodingError extends Error {
  constructor(public readonly encoding: ParserEncoding) {
    super(`${encoding} として読み込めないバイト列が含まれています`);
    this.name = 'CsvEncodingError';
  }
}
// fatal: true にしないと、エンコーディングを取り違えても例外にならず全行が文字化けした
// まま取り込まれる。区切りの , と日付・金額はどちらのエンコーディングでも ASCII なので
// parseCsv も parser も成功してしまい、摘要だけが壊れて取込ルールが何も一致しなくなる。
export function decodeCsv(buffer: ArrayBuffer | Uint8Array, encoding: ParserEncoding): string {
  try {
    return new TextDecoder(encoding, { fatal: true }).decode(buffer);
  } catch {
    throw new CsvEncodingError(encoding);
  }
}
