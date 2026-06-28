// 税務署コード（5桁）と署名。.xtx の IT部 ZEIMUSHO/gen:zeimusho_CD は zeimusho.xsd の
// enumeration（有効コード 557 件）に限定される。コードは権威（xsd 由来）、署名は
// 表示・検索用の補助（zeimusho_NM は任意で妥当性に影響しない）。
import { ZEIMUSHO_MASTER, type ZeimushoEntry } from './zeimusho-master.generated';

const BY_CODE = new Map(ZEIMUSHO_MASTER.map((e) => [e.code, e]));
// 5桁の有効な税務署コードか（xsd enumeration に存在するか）。
export function isValidZeimushoCode(code: string): boolean {
  return BY_CODE.has(code.trim());
}
// コードから署名を引く（未登録は undefined）。
export function zeimushoName(code: string): string | undefined {
  return BY_CODE.get(code.trim())?.name || undefined;
}
// 署名・コードの部分一致で検索（前方優先）。UI のサジェスト用。
export function searchZeimusho(query: string, limit = 30): ZeimushoEntry[] {
  const q = query.trim();
  if (q === '') {
    return [];
  }
  const starts: ZeimushoEntry[] = [];
  const includes: ZeimushoEntry[] = [];
  for (const e of ZEIMUSHO_MASTER) {
    if (e.code.startsWith(q) || e.name.startsWith(q)) {
      starts.push(e);
    } else if (e.code.includes(q) || e.name.includes(q)) {
      includes.push(e);
    }
    if (starts.length >= limit) {
      break;
    }
  }
  return [...starts, ...includes].slice(0, limit);
}

export const ZEIMUSHO_CODES: readonly string[] = ZEIMUSHO_MASTER.map((e) => e.code);
export { ZEIMUSHO_MASTER, type ZeimushoEntry };