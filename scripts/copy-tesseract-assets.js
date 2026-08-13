// tesseract-wasm の worker・コア WASM・日本語モデルを public/tesseract/ へ複製する。
// worker は自分自身の URL を基準に .wasm を取りに行くため、3 つを同じ階層へ置く。
//
// モデルを同梱するのは CSP の都合。web 版の connect-src は https: を許すが、
// wrapper 版は 'self' しか許さないので、外部 CDN から取る作りだと wrapper 版で
// 必ず失敗する。同一オリジンに置けば両方で動き、初回もオフラインで完結する。
import { copyFileSync, mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = join(root, 'node_modules', 'tesseract-wasm', 'dist');
const outDir = join(root, 'public', 'tesseract');
// fallback は WASM SIMD 非対応の実行環境向け。worker が supportsFastBuild() で
// 選ぶため、どちらが要るかは建置時には決まらない。
const ASSETS = ['tesseract-worker.js', 'tesseract-core.wasm', 'tesseract-core-fallback.wasm'];
// 4.0.0_best_int は best を整数量子化したもの。非量子化版は展開後 40MB 超あり、
// 収據の認識精度差に見合わない。
const MODEL_GZ = join(
  root,
  'node_modules',
  '@tesseract.js-data',
  'jpn',
  '4.0.0_best_int',
  'jpn.traineddata.gz',
);

function copy(from, to) {
  if (!existsSync(from)) {
    throw new Error(`OCR asset not found: ${from}`);
  }
  copyFileSync(from, to);
}

mkdirSync(outDir, { recursive: true });

for (const asset of ASSETS) {
  copy(join(srcDir, asset), join(outDir, asset));
}

if (!existsSync(MODEL_GZ)) {
  throw new Error(`OCR model not found: ${MODEL_GZ}`);
}
// tesseract-wasm の loadModel は生の traineddata を読むため建置時に展開しておく。
writeFileSync(join(outDir, 'jpn.traineddata'), gunzipSync(readFileSync(MODEL_GZ)));
