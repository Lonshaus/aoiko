const ENTITIES: ReadonlyMap<string, string> = new Map([
  ['&', '&amp;'],
  ['<', '&lt;'],
  ['>', '&gt;'],
  ['"', '&quot;'],
  ["'", '&#39;'],
]);
// {@html} へ渡す訳文に、利用者や保存値由来の文字列を埋め込むときに通す。
export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ENTITIES.get(c) ?? c);
}
