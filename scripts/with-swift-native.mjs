import { spawn } from 'node:child_process';
import { delimiter, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const [command, ...args] = process.argv.slice(2);

if (command === undefined) {
  throw new Error('実行するコマンドがありません');
}

const wrapperDir = resolve(fileURLToPath(new URL('.', import.meta.url)), 'swift-native');
const env =
  process.platform === 'darwin'
    ? { ...process.env, PATH: `${wrapperDir}${delimiter}${process.env.PATH ?? ''}` }
    : process.env;

const child = spawn(command, args, {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env,
});

child.on('close', (code, signal) => {
  process.exit(signal !== null ? 1 : (code ?? 1));
});
