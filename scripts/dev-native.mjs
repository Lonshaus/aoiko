// ネイティブ版の dev server。`tauri dev` の beforeDevCommand から呼ばれる。
//
// AOIKO_NATIVE を立てるためだけに居る。npm script の `VAR=x cmd` は一部の
// cmd で動かず、beforeDevCommand も同じ制約を受けるため、ここで環境を作って渡す。
// build 側は scripts/build-frontend.mjs が同じことをしている。
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');

const child = spawn('npm', ['run', 'dev'], {
  cwd: root,
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: { ...process.env, AOIKO_NATIVE: '1' },
});

child.on('close', (code, signal) => {
  process.exit(signal !== null ? 1 : (code ?? 1));
});
