// 配布形態を環境変数で渡してから任意のコマンドを実行する。
//
// tauri.conf.json の beforeDevCommand は 1 つしか書けず、ios:dev も tauri:dev も
// 同じ dev:native を通る。npm script の `VAR=x cmd` は一部の cmd で動かないため、
// 形態が host から決まらない ios はここを経由して AOIKO_PLATFORM を立てる。
import { spawn } from 'node:child_process';

const PLATFORMS = ['browser', 'macos', 'ios', 'windows'];
const [platform, command, ...args] = process.argv.slice(2);

if (platform === undefined || !PLATFORMS.includes(platform)) {
  throw new Error(`配布形態が不正です：${platform}（${PLATFORMS.join(' / ')} のみ）`);
}
if (command === undefined) {
  throw new Error('実行するコマンドがありません');
}

const child = spawn(command, args, {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: { ...process.env, AOIKO_PLATFORM: platform },
});

child.on('close', (code, signal) => {
  process.exit(signal !== null ? 1 : (code ?? 1));
});
