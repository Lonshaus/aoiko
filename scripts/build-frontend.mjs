// ネイティブ版向けにフロントエンドを建て、出力へネイティブ側の
// ライセンス一覧を足す。`tauri build` の前に通す。
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
// 設定画面に出るバージョンを package.json ではなくネイティブ版のものにする。
// 商店は提出のたびに繰り上げを要求するため、両者は連動しない。vite.config.ts は
// AOIKO_VERSION があればそちらを使う。
const tauriConf = JSON.parse(readFileSync(resolve(root, 'src-tauri', 'tauri.conf.json'), 'utf8'));

for (const script of ['check', 'build']) {
  const result = spawnSync('npm', ['run', script], {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    // AOIKO_NATIVE は購入画面などネイティブ版にしか無い部分を出力へ入れる合図。
    // web のビルドはこれを通らないので、そちら側では畳まれて消える。
    env: { ...process.env, AOIKO_VERSION: tauriConf.version, AOIKO_NATIVE: '1' },
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
