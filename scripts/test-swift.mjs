// Concurrency.swift / ClassifyLoop.swift / AnalysisNotify.swift / AnalysisRunner.swift / BackgroundTime.swift /
// TextRecognition.swift / RunnerHold.swift のテスト。ios/Sources/AoikoNativePlugin/ には本番
// ソースしか置けない（iOS の SwiftPM がディレクトリ配下を丸ごと拾ってビルドしてしまう）ので、
// テスト本体は scripts/swift/ に置き、ここで本番ソースと合わせて使い捨てのバイナリへ
// コンパイルして走らせる。swiftc が無い環境（Darwin 以外）では何もしない。
//
// テストファイルはどれも @main を持つ実行ファイルなので、同じモジュールへは
// まとめられず、バイナリを分けてそれぞれコンパイル・実行する。
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { buildNativeRunner } from './build-native-runner.mjs';

if (process.platform !== 'darwin') {
  console.log('Darwin ではないので何もしない');
  process.exit(0);
}

const nativeDir = new URL(
  '../src-tauri/plugins/tauri-plugin-aoiko-native/ios/Sources/AoikoNativePlugin/',
  import.meta.url,
).pathname;
const swiftTestDir = new URL('./swift/', import.meta.url).pathname;
const fixturesDir = new URL('../src/native-runner/fixtures/', import.meta.url).pathname;
const tesseractDir = new URL('../node_modules/tesseract-wasm/dist/', import.meta.url).pathname;
const modelGz = new URL(
  '../node_modules/@tesseract.js-data/jpn/4.0.0_best_int/jpn.traineddata.gz',
  import.meta.url,
).pathname;

const suites = [
  {
    name: 'Concurrency',
    sources: [join(nativeDir, 'Concurrency.swift'), join(swiftTestDir, 'ConcurrencyTests.swift')],
    binary: 'concurrency_tests',
  },
  {
    name: 'ClassifyLoop',
    sources: [join(nativeDir, 'ClassifyLoop.swift'), join(swiftTestDir, 'ClassifyLoopTests.swift')],
    binary: 'classify_loop_tests',
  },
  {
    name: 'AnalysisNotify',
    sources: [
      join(nativeDir, 'AnalysisNotify.swift'),
      join(swiftTestDir, 'AnalysisNotifyTests.swift'),
    ],
    binary: 'analysis_notify_tests',
  },
  // runner.js は束ねたものをそのまま評価させる。パスは実行時の引数で渡す。
  {
    name: 'AnalysisRunner',
    sources: [
      join(nativeDir, 'AnalysisRunner.swift'),
      join(nativeDir, 'BackgroundTime.swift'),
      join(nativeDir, 'TextRecognition.swift'),
      join(swiftTestDir, 'AnalysisRunnerTests.swift'),
    ],
    binary: 'analysis_runner_tests',
    args: (runner) => [runner],
  },
  {
    name: 'BackgroundTime',
    sources: [
      join(nativeDir, 'AnalysisRunner.swift'),
      join(nativeDir, 'BackgroundTime.swift'),
      join(nativeDir, 'AppState.swift'),
      join(nativeDir, 'TextRecognition.swift'),
      join(swiftTestDir, 'BackgroundTimeTests.swift'),
    ],
    binary: 'background_time_tests',
    args: (runner) => [runner],
  },
  // 端末内のエンジン。期待値は fixtures の参照の JSON（web view の経路で取ったもの）。
  {
    name: 'LocalEngine',
    sources: [
      join(nativeDir, 'AnalysisRunner.swift'),
      join(nativeDir, 'BackgroundTime.swift'),
      join(nativeDir, 'TextRecognition.swift'),
      join(swiftTestDir, 'LocalEngineTests.swift'),
    ],
    binary: 'local_engine_tests',
    args: (runner, model) => [
      runner,
      fixturesDir,
      join(tesseractDir, 'tesseract-core.wasm'),
      join(tesseractDir, 'tesseract-core-fallback.wasm'),
      model,
    ],
  },
  {
    name: 'RunnerHold',
    sources: [join(nativeDir, 'RunnerHold.swift'), join(swiftTestDir, 'RunnerHoldTests.swift')],
    binary: 'runner_hold_tests',
    args: () => [join(nativeDir, 'AnalysisRunner.swift')],
  },
];

const outDir = mkdtempSync(join(tmpdir(), 'aoiko-swift-test-'));

try {
  // runner.js はメッセージカタログを取り込むので、先に生成しておく。
  execFileSync('npm', ['run', 'paraglide:compile'], { stdio: 'inherit' });
  const runnerPath = join(outDir, 'runner.js');
  await buildNativeRunner(runnerPath);
  // tesseract-wasm の loadModel は展開済みの traineddata を読む（copy-tesseract-assets.js と同じ展開）。
  const modelPath = join(outDir, 'jpn.traineddata');
  writeFileSync(modelPath, gunzipSync(readFileSync(modelGz)));
  for (const suite of suites) {
    console.log(`--- ${suite.name} ---`);
    const binary = join(outDir, suite.binary);
    execFileSync(
      'xcrun',
      [
        'swiftc',
        '-swift-version',
        '6',
        '-strict-concurrency=complete',
        '-o',
        binary,
        ...suite.sources,
      ],
      { stdio: 'inherit' },
    );
    execFileSync(binary, suite.args?.(runnerPath, modelPath) ?? [], { stdio: 'inherit' });
  }
} finally {
  rmSync(outDir, { recursive: true, force: true });
}
