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
// scripts/gen-third-party-licenses.js がこの配列を import して手動ライセンス一覧との
// 突き合わせに使うため、ここを直接編集すれば向こうの検査に反映される。
export const ASSETS = [
  'tesseract-worker.js',
  'tesseract-core.wasm',
  'tesseract-core-fallback.wasm',
];
export const MODEL_FILE = 'jpn.traineddata';
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

function main() {
  mkdirSync(outDir, { recursive: true });
  for (const asset of ASSETS) {
    copy(join(srcDir, asset), join(outDir, asset));
  }
  if (!existsSync(MODEL_GZ)) {
    throw new Error(`OCR model not found: ${MODEL_GZ}`);
  }
  // tesseract-wasm の loadModel は生の traineddata を読むため建置時に展開しておく。
  writeFileSync(join(outDir, MODEL_FILE), gunzipSync(readFileSync(MODEL_GZ)));
}

// gen-third-party-licenses.js は ASSETS/MODEL_FILE だけを import で使いたいので、
// 複製処理（node_modules 前提・書き込みを伴う）は直接起動されたときだけ走らせる。
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
