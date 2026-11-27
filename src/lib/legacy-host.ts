// 旧URLから新URLへの移行案内。移行が終わったら、このファイル・コンポーネント・状態・文言キー・テストをまとめて削除する。
export const LEGACY_HOSTNAME = 'aoiko.pages.dev';
export const NEW_ORIGIN = 'https://aoiko.lonshaus.net';
// 使えなくなる予定の年月（YYYY-MM）。決まっていなければ null。
export const LEGACY_HOST_END_DATE: string | null = '2027-01';

export function isLegacyHost(hostname: string): boolean {
  return hostname.toLowerCase() === LEGACY_HOSTNAME;
}
