// Concurrency.swift のテスト。ios/Sources/AoikoNativePlugin/ には本番ソースしか置けない
// （iOS の SwiftPM がディレクトリ配下を丸ごと拾ってビルドしてしまう）ので、テスト本体は
// scripts/swift/ConcurrencyTests.swift に置き、ここで両方をまとめて使い捨てのバイナリへ
// コンパイルして走らせる。swiftc が無い環境（Darwin 以外）では何もしない。
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

if (process.platform !== 'darwin') {
  console.log('Darwin ではないので何もしない');
  process.exit(0);
}

const concurrencySwift = new URL(
  '../src-tauri/plugins/tauri-plugin-aoiko-native/ios/Sources/AoikoNativePlugin/Concurrency.swift',
  import.meta.url,
).pathname;
const testsSwift = new URL('./swift/ConcurrencyTests.swift', import.meta.url).pathname;

const outDir = mkdtempSync(join(tmpdir(), 'aoiko-swift-test-'));
const binary = join(outDir, 'concurrency_tests');

try {
  execFileSync(
    'xcrun',
    [
      'swiftc',
      '-swift-version',
      '6',
      '-strict-concurrency=complete',
      '-o',
      binary,
      concurrencySwift,
      testsSwift,
    ],
    { stdio: 'inherit' },
  );
  execFileSync(binary, [], { stdio: 'inherit' });
} finally {
  rmSync(outDir, { recursive: true, force: true });
}
