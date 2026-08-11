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
// 入力欄で確定している署。欄の文字列とは別に持つ。
export type ConfirmedZeimusho = { code: string; name: string };
// 入力欄に出す表記。署名が引けたときだけ添える。
export function displayZeimusho(code: string, name: string): string {
  if (code === '') {
    return '';
  }
  return name ? `${name}（${code}）` : code;
}
/**
 * 入力欄の文字列から次の確定値を決める。
 *
 * 確定済みの値を捨てるのは、利用者が欄を空にしたときだけ。打っている途中の中間状態で
 * 捨てると、設定済みの署が一文字触るたびに失われる。欄の既定表示は「麹町（01101）」の
 * 形で 5 桁ではないので、編集を始めた瞬間に必ず中間状態を通る。
 */
export function nextConfirmedZeimusho(
  value: string,
  confirmed: ConfirmedZeimusho,
): ConfirmedZeimusho {
  const code = value.trim();
  if (code === '') {
    return { code: '', name: '' };
  }
  if (/^\d{5}$/.test(code) && isValidZeimushoCode(code)) {
    return { code, name: zeimushoName(code) ?? '' };
  }
  return confirmed;
}
/**
 * 欄の文字列と確定値が食い違っている状態。保存を止める判定に使う。
 *
 * 確定値を保持するようにした以上、欄が「麹町税」まで消された状態でも確定値は残る。
 * そのまま保存すると画面と保存内容がずれるため、ここで止める。
 */
export function isZeimushoUnresolved(query: string, confirmed: ConfirmedZeimusho): boolean {
  const q = query.trim();
  if (q === '') {
    return false;
  }
  if (confirmed.code === '') {
    return true;
  }
  return q !== confirmed.code && q !== displayZeimusho(confirmed.code, confirmed.name);
}
