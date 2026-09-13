// Concurrency.swift / ClassifyLoop.swift のテスト。ios/Sources/AoikoNativePlugin/ には本番
// ソースしか置けない（iOS の SwiftPM がディレクトリ配下を丸ごと拾ってビルドしてしまう）ので、
// テスト本体は scripts/swift/ に置き、ここで本番ソースと合わせて使い捨てのバイナリへ
// コンパイルして走らせる。swiftc が無い環境（Darwin 以外）では何もしない。
//
// 2 つのテストファイルはどちらも @main を持つ実行ファイルなので、同じモジュールへは
// まとめられず、バイナリを 2 本に分けてそれぞれコンパイル・実行する。
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

if (process.platform !== 'darwin') {
  console.log('Darwin ではないので何もしない');
  process.exit(0);
}

const nativeDir = new URL(
  '../src-tauri/plugins/tauri-plugin-aoiko-native/ios/Sources/AoikoNativePlugin/',
  import.meta.url,
).pathname;
const swiftTestDir = new URL('./swift/', import.meta.url).pathname;

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
];

const outDir = mkdtempSync(join(tmpdir(), 'aoiko-swift-test-'));

try {
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
    execFileSync(binary, [], { stdio: 'inherit' });
  }
} finally {
  rmSync(outDir, { recursive: true, force: true });
}
