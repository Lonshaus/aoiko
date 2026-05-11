// CSV パーサー間で共有される小さなユーティリティ。

export function normalizeDate(s: string): string {
  const parts = s.split(/[/\-.]/).map((p) => p.trim());
  if (parts.length !== 3) {
    throw new Error(`日付形式が認識できません: ${s}`);
  }
  const [y, m, d] = parts;
  if (!y || !m || !d) {
    throw new Error(`日付形式が認識できません: ${s}`);
  }
  return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

export function stripComma(s: string): string {
  return s.replace(/,/g, '');
}

export function buildRawRow(
  header: string[],
  row: string[]
): Record<string, string> {
  const result: Record<string, string> = {};
  for (let i = 0; i < header.length; i++) {
    result[header[i] ?? ''] = row[i] ?? '';
  }
  return result;
}

// 必須列のインデックスを取得。1 つでも欠けたら早期に投げる。
export function requireColumns(
  header: string[],
  names: readonly string[],
  parserDisplayName: string
): Record<string, number> {
  const indices: Record<string, number> = {};
  const missing: string[] = [];
  for (const name of names) {
    const idx = header.indexOf(name);
    if (idx < 0) {
      missing.push(name);
    } else {
      indices[name] = idx;
    }
  }
  if (missing.length > 0) {
    throw new Error(
      `${parserDisplayName} の CSV ヘッダー形式と一致しません（不足列：${missing.join(', ')}）`
    );
  }
  return indices;
}

// オプショナル列のインデックス。無ければ -1。
export function optionalColumn(header: string[], name: string): number {
  return header.indexOf(name);
}