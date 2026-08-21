import { readFileSync } from 'node:fs';
import { decodeCsv } from '../../lib/encoding';
import type { ParserEncoding } from '../types';
// `?raw` は必ず UTF-8 として読むので、Shift_JIS の検体が壊れる。
export function readSample(path: string, encoding: ParserEncoding): string {
  return decodeCsv(readFileSync(path), encoding);
}
