// check:ios はプラグインの iOS 向け Swift を SwiftPM で Swift 5 の言語モードでビルドする。
// build.rs が Swift 6 の厳密な並行性検査を通すのは macOS の SDK に対してだけなので、
// ここでは最低対応バージョンの iOS SDK を相手に、Swift 6 の厳密な並行性検査つきで型検査だけを通す。
// AoikoNativePlugin.swift は Tauri の SwiftPM パッケージを import していて単体では型検査できないので除く。
// 最低対応バージョンは tauri.conf.json から読む（ビルド設定との食い違いを防ぐため）。
// Darwin 以外では何もしない。
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

if (process.platform !== 'darwin') {
  console.log('Darwin ではないので何もしない');
  process.exit(0);
}

const sourceDir = new URL(
  '../src-tauri/plugins/tauri-plugin-aoiko-native/ios/Sources/AoikoNativePlugin/',
  import.meta.url,
).pathname;
const confPath = new URL('../src-tauri/tauri.conf.json', import.meta.url).pathname;

const minimum = JSON.parse(readFileSync(confPath, 'utf8')).bundle?.iOS?.minimumSystemVersion;
if (typeof minimum !== 'string') {
  console.error('tauri.conf.json に bundle.iOS.minimumSystemVersion が無い');
  process.exit(1);
}

const sources = readdirSync(sourceDir)
  .filter((name) => name.endsWith('.swift') && name !== 'AoikoNativePlugin.swift')
  .sort()
  .map((name) => join(sourceDir, name));
if (sources.length === 0) {
  console.error('型検査する Swift ファイルが見つからない');
  process.exit(1);
}

const sdk = execFileSync('xcrun', ['--sdk', 'iphoneos', '--show-sdk-path'], {
  encoding: 'utf8',
}).trim();

const args = [
  'swiftc',
  '-typecheck',
  '-target',
  `arm64-apple-ios${minimum}`,
  '-sdk',
  sdk,
  '-swift-version',
  '6',
  '-strict-concurrency=complete',
  ...sources,
];
console.log(['xcrun', ...args].join(' '));
execFileSync('xcrun', args, { stdio: 'inherit' });
