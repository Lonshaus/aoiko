// tesseract.js の worker とコア WASM を public/tesseract/ へ複製する。
// 既定では jsDelivr CDN から importScripts で取得されるが、aoiko の CSP は
// script-src に外部オリジンを許可していないため blob worker 内で必ずブロックされる。
// 同一オリジンから配ることで CSP を緩めずに動かす。
import { copyFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'public', 'tesseract');
const coreOutDir = join(outDir, 'core');
// aoiko は既定 OEM で recognize() を呼ぶため tesseract.js 側で lstmOnly が真になり、
// 参照されるのは LSTM 版の 3 変種だけ（実行時に SIMD 対応状況で 1 つが選ばれる）。
// 非 LSTM 版まで複製すると 40MB 超が無駄に配布物へ乗る。
const CORE_VARIANTS = [
  'tesseract-core-relaxedsimd-lstm',
  'tesseract-core-simd-lstm',
  'tesseract-core-lstm',
];

function copy(from, to) {
  if (!existsSync(from)) {
    throw new Error(`tesseract asset not found: ${from}`);
  }
  copyFileSync(from, to);
}

mkdirSync(coreOutDir, { recursive: true });

copy(
  join(root, 'node_modules', 'tesseract.js', 'dist', 'worker.min.js'),
  join(outDir, 'worker.min.js'),
);

const coreSrcDir = join(root, 'node_modules', 'tesseract.js-core');
for (const variant of CORE_VARIANTS) {
  // tesseract.js が読むのは wasm を内蔵した単一ファイル版の .wasm.js。
  // 分離版の .wasm（と、それを取りに行く 87KB の .js）は参照されない。
  // worker 側がディレクトリにファイル名を連結するため、ハッシュの付かない
  // public/ に原名のまま置く。
  copy(join(coreSrcDir, `${variant}.wasm.js`), join(coreOutDir, `${variant}.wasm.js`));
}
