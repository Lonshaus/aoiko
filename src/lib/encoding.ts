import type { ParserEncoding } from '../parsers/types';
// CSV バイト列を指定エンコーディングで文字列化する。
// shift_jis は WHATWG 仕様上 windows-31j（CP932）として解釈され、
// ①㈱∑ 等の機種依存文字や全角チルダ（～ U+FF5E）も含めて復号できる。
// TextDecoder は既定で UTF-8 の BOM を除去する。
export function decodeCsv(
  buffer: ArrayBuffer | Uint8Array,
  encoding: ParserEncoding
): string {
  return new TextDecoder(encoding).decode(buffer);
}