// crypto.randomUUID() はセキュアコンテキスト（HTTPS / localhost）でしか使えない。
// 自宅サーバーの http://192.168.x.x 等での自己ホスト運用も想定するため、
// getRandomValues（非セキュアコンテキストでも利用可）から UUID v4 を組み立ててフォールバックする。
function randomUuidV4Fallback(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8]! & 0x3f) | 0x80; // variant 10xx
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function newId(): string {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return randomUuidV4Fallback();
}
