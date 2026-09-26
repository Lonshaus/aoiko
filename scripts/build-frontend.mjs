// ネイティブ版向けにフロントエンドを建て、出力へネイティブ側の
// ライセンス一覧を足す。`tauri build` の前に通す。
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
// 設定画面に出るバージョンを package.json ではなくネイティブ版のものにする。
// ストアは提出のたびに繰り上げを要求するため、両者は連動しない。vite.config.ts は
// AOIKO_VERSION があればそちらを使う。
// 平台ごとに版番号が違うため、打包側が AOIKO_VERSION を渡してきたらそちらを優先する。
const tauriConf = JSON.parse(readFileSync(resolve(root, 'src-tauri', 'tauri.conf.json'), 'utf8'));

// 出し分けの対象となる配布形態。引数か環境変数が明示されていればそれを使い、
// 無いときだけ build ホストから決める（tauri build は macOS と Windows で同じ入口）。
const HOST_PLATFORM = { darwin: 'macos', win32: 'windows' };
const PLATFORMS = ['browser', 'macos', 'ios', 'windows'];

function targetPlatform() {
  const given = process.argv[2] ?? process.env.AOIKO_PLATFORM;
  if (given !== undefined) {
    if (!PLATFORMS.includes(given)) {
      throw new Error(`配布形態が不正です：${given}（${PLATFORMS.join(' / ')} のみ）`);
    }
    return given;
  }
  const derived = HOST_PLATFORM[process.platform];
  if (derived === undefined) {
    throw new Error(`この host では配布形態を決められません：${process.platform}`);
  }
  return derived;
}

const platform = targetPlatform();

for (const script of ['check', 'build']) {
  const result = spawnSync('npm', ['run', script], {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    // AOIKO_PLATFORM は購入画面などネイティブ版にしか無い部分と、手引きの出し分けの
    // 両方を決める唯一の入口。web のビルドはこれを通らないので browser に落ちる。
    env: {
      ...process.env,
      AOIKO_VERSION: process.env.AOIKO_VERSION ?? tauriConf.version,
      AOIKO_PLATFORM: platform,
    },
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

// build の直前に再生成する。古いままの THIRD_PARTY_LICENSES_NATIVE.txt が
// そのまま同梱されるのを防ぐ。
const genResult = spawnSync('node', ['scripts/gen-native-licenses.mjs'], {
  cwd: root,
  stdio: 'inherit',
});
if (genResult.status !== 0) {
  process.exit(genResult.status ?? 1);
}

// public/ から読む。dist/ は前回ビルドの出力そのものなので、そこを読むと
// 毎回ネイティブ側の章が積み増しされてしまう。public/ は vite が素通しする
// pristine な入力なので、何度ビルドしても結果は同じになる（冪等）。
const jsPart = readFileSync(resolve(root, 'public', 'THIRD_PARTY_LICENSES.txt'), 'utf8');
const nativePart = readFileSync(
  resolve(root, 'src-tauri', 'THIRD_PARTY_LICENSES_NATIVE.txt'),
  'utf8',
).replace(/^﻿/, '');
const heading = [
  '',
  '='.repeat(78),
  '',
  '以下はネイティブ版（Rust ネイティブ側）に同梱する第三者ソフトウェアの一覧です。',
  '',
].join('\n');
writeFileSync(
  resolve(root, 'dist', 'THIRD_PARTY_LICENSES.txt'),
  jsPart.trimEnd() + '\n' + heading + '\n' + nativePart,
);
