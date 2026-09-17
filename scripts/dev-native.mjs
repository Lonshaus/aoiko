// ネイティブ版の dev server。`tauri dev` の beforeDevCommand から呼ばれる。
//
// AOIKO_PLATFORM を立てるためだけに居る。npm script の `VAR=x cmd` は一部の
// cmd で動かず、beforeDevCommand も同じ制約を受けるため、ここで環境を作って渡す。
// build 側は scripts/build-frontend.mjs が同じことをしている。
// beforeDevCommand は 1 つしか書けないので、ios:dev 等は呼ぶ側が
// AOIKO_PLATFORM を渡す（scripts/run-with-platform.mjs）。無ければ host から決める。
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');

const HOST_PLATFORM = { darwin: 'macos', win32: 'windows' };
const PLATFORMS = ['browser', 'macos', 'ios', 'windows'];

function devPlatform() {
  const given = process.env.AOIKO_PLATFORM;
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

const child = spawn('npm', ['run', 'dev'], {
  cwd: root,
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: { ...process.env, AOIKO_PLATFORM: devPlatform() },
});

child.on('close', (code, signal) => {
  process.exit(signal !== null ? 1 : (code ?? 1));
});
