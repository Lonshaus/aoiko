// zip の CRC32（IEEE 802.3・反転多項式 0xEDB88320）。fflate は crc を公開していないため自前で持つ。
const CRC32_POLYNOMIAL = 0xedb88320;
let table: Uint32Array | undefined;

function crcTable(): Uint32Array {
  if (table) {
    return table;
  }
  const built = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let bit = 0; bit < 8; bit++) {
      c = (c & 1) === 1 ? CRC32_POLYNOMIAL ^ (c >>> 1) : c >>> 1;
    }
    built[i] = c;
  }
  table = built;
  return built;
}
// 添付は分割して読むため、一度に全体を渡さずに済む逐次計算の形にする。
export function createCrc32(): { update(bytes: Uint8Array): void; digest(): number } {
  const lookup = crcTable();
  let crc = 0xffffffff;
  return {
    update(bytes: Uint8Array): void {
      for (let i = 0; i < bytes.length; i++) {
        crc = lookup[(crc ^ bytes[i]!) & 0xff]! ^ (crc >>> 8);
      }
    },
    digest(): number {
      return (crc ^ 0xffffffff) >>> 0;
    },
  };
}

export function crc32(bytes: Uint8Array): number {
  const hash = createCrc32();
  hash.update(bytes);
  return hash.digest();
}
