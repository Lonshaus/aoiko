// {@html} へ差し込む文字列用。& を最初に置き換えないと、後で作った実体参照の & まで置き換わり二重にエスケープされる。
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
