// gen/android は生成物で git に入っていない。tauri android init はランチャーアイコンを
// 既定のロゴで置き、こちらから差し替える口も無い（CLI は出力先を
// gen/android/app/src/main/res/ に固定していて、出所ディレクトリという概念が無い）。
// prepare-ios.mjs と同じ形で、icons/android を出所として毎回上書きし直す。
import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

const src = new URL('../src-tauri/icons/android/', import.meta.url).pathname;
const dest = new URL('../src-tauri/gen/android/app/src/main/res/', import.meta.url).pathname;

// まだ init していない作業コピーでは置き先が無い。ここで落とすと android:dev /
// android:build が本来の「先に init しろ」という案内へ進めなくなるので黙って通す。
if (!existsSync(dest)) {
  console.log('gen/android がまだ無いので何もしない');
  process.exit(0);
}

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)],
  );
}

const files = walk(src);
if (files.length === 0) {
  console.error(`${src} に何も無い`);
  process.exit(1);
}

// 前景 PNG は自適応アイコンの安全域（中央 72/108）へ収めてある。tauri icon はそれを
// 考えずに敷き詰めるので、あちらを回すとランチャーの遮罩で猫の下端が切れる。
for (const file of files) {
  const rel = relative(src, file);
  const to = join(dest, rel);
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(file, to);
}
console.log(`アイコン ${files.length} 件を同期した`);
