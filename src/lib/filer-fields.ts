import { isValidZeimushoCode } from '../tax-schema/2026/zeimusho';

export type FilerFieldKind = 'code' | 'zip' | 'text';
// 復元された設定は値の型を検査していない。未設定は空欄、文字列にできない値は undefined にする。
// 識別番号・署番号の数値は、安全な整数を超えると桁が化け、先頭の 0 も消えているため読まない
export function readFilerField(v: unknown, kind: FilerFieldKind): string | undefined {
  if (v === undefined || v === null) {
    return '';
  }
  if (typeof v === 'string') {
    return v;
  }
  if (kind !== 'code' && typeof v === 'number' && Number.isFinite(v)) {
    return String(v);
  }
  return undefined;
}

export function normalizeRiyoshaId(raw: unknown): string {
  return (readFilerField(raw, 'code') ?? '').normalize('NFKC').trim();
}
// 全角の数字や〒・ハイフンの混じりを許すため、揃えてから数字以外を除く
export function normalizeFilerZip(raw: unknown): string {
  return (readFilerField(raw, 'zip') ?? '').normalize('NFKC').replace(/[^0-9]/g, '');
}

export function isRiyoshaIdInvalid(raw: unknown): boolean {
  if (readFilerField(raw, 'code') === undefined) {
    return true;
  }
  const id = normalizeRiyoshaId(raw);
  return id !== '' && !/^\d{16}$/.test(id);
}

export function isFilerZipInvalid(raw: unknown): boolean {
  if (readFilerField(raw, 'zip') === undefined) {
    return true;
  }
  const zip = normalizeFilerZip(raw);
  return zip !== '' && !/^\d{7}$/.test(zip);
}

export function isZeimushoCodeInvalid(raw: unknown): boolean {
  const code = readFilerField(raw, 'code');
  return code === undefined || (code.trim() !== '' && !isValidZeimushoCode(code));
}

export interface StoredFilerSettings {
  userRiyoshaId: unknown;
  userFilerName: unknown;
  userFilerZip: unknown;
  userFilerAddress: unknown;
  userZeimushoCode: unknown;
  userZeimushoName: unknown;
  userBusinessName: unknown;
  userInvoiceNumber: unknown;
}
// .xtx に載せる申告者情報。invalid は読めない値・形の誤った値があること、missing は必須欄の未記入
export function readStoredFiler(stored: StoredFilerSettings): {
  filer: {
    riyoshaId: string;
    name: string;
    zip: string;
    address: string;
    zeimushoCode: string;
    zeimushoName: string;
  };
  businessName: string;
  invoiceNumber: string;
  missing: boolean;
  invalid: boolean;
} {
  const name = readFilerField(stored.userFilerName, 'text');
  const zip = readFilerField(stored.userFilerZip, 'zip');
  const address = readFilerField(stored.userFilerAddress, 'text');
  const zeimushoCode = readFilerField(stored.userZeimushoCode, 'code');
  const zeimushoName = readFilerField(stored.userZeimushoName, 'text');
  const businessName = readFilerField(stored.userBusinessName, 'text');
  const invoiceNumber = readFilerField(stored.userInvoiceNumber, 'text');
  const filer = {
    riyoshaId: normalizeRiyoshaId(stored.userRiyoshaId),
    name: name ?? '',
    zip: zip ?? '',
    address: address ?? '',
    zeimushoCode: zeimushoCode ?? '',
    zeimushoName: zeimushoName ?? '',
  };
  const invalid =
    isRiyoshaIdInvalid(stored.userRiyoshaId) ||
    isFilerZipInvalid(stored.userFilerZip) ||
    isZeimushoCodeInvalid(stored.userZeimushoCode) ||
    [name, address, zeimushoName, businessName, invoiceNumber].some((v) => v === undefined);
  const missing = !filer.zeimushoCode || !filer.riyoshaId || !filer.name || !filer.address;
  return {
    filer,
    businessName: businessName ?? '',
    invoiceNumber: invoiceNumber ?? '',
    missing,
    invalid,
  };
}
