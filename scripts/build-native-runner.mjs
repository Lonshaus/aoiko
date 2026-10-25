// iOS の解析の本体（runner.js）を 1 本の IIFE に束ねる。src/native-runner/entry.ts が入口。
// ネイティブ側はこのファイルを固定の名前で読み、先頭の目印で本物かを確かめる。
import { build } from 'esbuild';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const RUNNER_BANNER = '/* aoiko-native-runner */';
export const RUNNER_ENTRY = resolve(root, 'src', 'native-runner', 'entry.ts');
export const RUNNER_OUTFILE = resolve(root, 'dist', 'native-runner', 'runner.js');
export const RUNNER_MANIFEST = resolve(root, 'dist', 'native-runner', 'assets.json');
export const TRAINEDDATA = resolve(root, 'dist', 'tesseract', 'jpn.traineddata');
// tesseract-wasm の lib.js は ES モジュール前提で、Wasm の名前を import.meta.url から組み立てる。
// IIFE では import.meta が空になり、その式が例外になる。Wasm は wasmBinary で直接渡すので名前は使われない。
// 置き換えは 1 か所だけで、見つからなければ束ねるのをやめる（上流が変わったら気付けるように）。
const TESSERACT_LIB = /[\\/]tesseract-wasm[\\/]dist[\\/]lib\.js$/;
const WASM_URL_EXPRESSION = 'new URL("tesseract-core.wasm",import.meta.url).href';

/** @type {import('esbuild').Plugin} */
const tesseractWasmName = {
  name: 'tesseract-wasm-name',
  setup(builder) {
    builder.onLoad({ filter: TESSERACT_LIB }, (args) => {
      const source = readFileSync(args.path, 'utf8');
      if (source.split(WASM_URL_EXPRESSION).length !== 2) {
        throw new Error('tesseract-wasm の lib.js で、置き換える式がちょうど 1 か所見つからない');
      }
      return {
        contents: source.replace(WASM_URL_EXPRESSION, '"tesseract-core.wasm"'),
        loader: 'js',
      };
    });
  },
};
// テストも同じ設定で束ねる。設定を変えるときはここだけを直す。
/** @type {import('esbuild').BuildOptions} */
export const RUNNER_BUILD_OPTIONS = {
  entryPoints: [RUNNER_ENTRY],
  bundle: true,
  format: 'iife',
  target: 'safari16',
  platform: 'neutral',
  mainFields: ['module', 'main'],
  banner: { js: RUNNER_BANNER },
  define: { __NATIVE__: 'true' },
  legalComments: 'none',
  minify: true,
  logLevel: 'silent',
  plugins: [tesseractWasmName],
};
/**
 * @param {string} outfile
 */
export async function buildNativeRunner(outfile) {
  await build({ ...RUNNER_BUILD_OPTIONS, outfile });
}
// ネイティブ側は jpn.traineddata の長さをこのマニフェストと突き合わせる（無いアセットの代わりに返る
// index.html を取り違えないため）。
/**
 * @param {string} traineddata
 * @param {string} manifest
 */
export function writeAssetManifest(traineddata, manifest) {
  mkdirSync(dirname(manifest), { recursive: true });
  writeFileSync(manifest, JSON.stringify({ jpnTraineddata: statSync(traineddata).size }));
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await buildNativeRunner(RUNNER_OUTFILE);
  writeAssetManifest(TRAINEDDATA, RUNNER_MANIFEST);
}
