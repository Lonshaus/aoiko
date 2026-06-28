// 税務署コード（5桁）。.xtx の IT部 ZEIMUSHO/gen:zeimusho_CD は zeimusho.xsd の
// enumeration（有効コード 557 件）に限定される。提出前に妥当性を確認するための
// 検証ヘルパ。署名（zeimusho_NM）は xsd に含まれないため任意入力で補う。
import { ZEIMUSHO_CODES } from './zeimusho-codes.generated';

const CODE_SET: ReadonlySet<string> = new Set(ZEIMUSHO_CODES);
// 5桁の有効な税務署コードか（xsd enumeration に存在するか）。
export function isValidZeimushoCode(code: string): boolean {
  return CODE_SET.has(code.trim());
}

export { ZEIMUSHO_CODES };