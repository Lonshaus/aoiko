// gen/apple は生成物で git に入っていない。設定を直しても、既に gen/apple がある作業
// コピーには反映されない。ここで「設定と生成物が食い違っていないか」を毎回見る。
import { copyFileSync, readdirSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const genRoot = new URL('../src-tauri/gen/apple/', import.meta.url).pathname;
const src = new URL('../src-tauri/icons/ios/', import.meta.url).pathname;
const dest = join(genRoot, 'Assets.xcassets/AppIcon.appiconset/');

// まだ init していない作業コピーでは見る先が無い。ここで落とすと ios:dev / ios:build が
// 本来の「先に init しろ」という案内へ進めなくなるので、黙って通す（何もしないのが正しい）。
if (!existsSync(dest)) {
  console.log('gen/apple がまだ無いので何もしない');
  process.exit(0);
}

// 1. 最低 ある環境 バージョン。tauri ios init は既存の project.yml を上書きしないため、
// tauri.conf.json だけ直しても古い値のまま建ってしまう。黙って通すと、宣言より低い
// 端末へ入るビルドが出来上がる。
const conf = JSON.parse(
  readFileSync(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8'),
);
const want = conf.bundle?.iOS?.minimumSystemVersion;
if (want) {
  const stale = [];
  const projectYml = join(genRoot, 'project.yml');
  if (existsSync(projectYml)) {
    const m = readFileSync(projectYml, 'utf8').match(/deploymentTarget:\s*\n\s*iOS:\s*([0-9.]+)/);
    if (m && m[1] !== want) {
      stale.push(`project.yml: ${m[1]}`);
    }
  }
  const pbxproj = join(genRoot, `${conf.productName}.xcodeproj/project.pbxproj`);
  if (existsSync(pbxproj)) {
    const found = [
      ...readFileSync(pbxproj, 'utf8').matchAll(/IPHONEOS_DEPLOYMENT_TARGET = ([0-9.]+)/g),
    ].map((x) => x[1]);
    for (const v of new Set(found)) {
      if (v !== want) {
        stale.push(`project.pbxproj: ${v}`);
      }
    }
  }
  if (stale.length > 0) {
    console.error(
      `最低 iOS バージョンが設定と食い違う（設定 ${want} / ${stale.join(', ')}）。\n` +
        'src-tauri/gen/apple を消して tauri ios init をやり直す',
    );
    process.exit(1);
  }
}

// 2. アイコン。tauri ios init は Assets.xcassets を シェル 既定のロゴで作り直す。
// 新規 clone でも同じことが起きるので、icons/ios を出所として毎回上書きし直す。
const icons = readdirSync(src).filter((f) => f.endsWith('.png'));
if (icons.length === 0) {
  console.error(`${src} に PNG が無い`);
  process.exit(1);
}
// Contents.json は init が作ったものを使う。差し替えるのは PNG の中身だけ。
// 名前が食い違っていれば ビルドツール のビルドが落ちるので、ここで黙って通さない。
const listed = new Set(readdirSync(dest).filter((f) => f.endsWith('.png')));
const missing = icons.filter((f) => !listed.has(f));
if (missing.length > 0) {
  console.error(`appiconset に無いファイル名がある: ${missing.join(', ')}`);
  process.exit(1);
}

for (const icon of icons) {
  copyFileSync(join(src, icon), join(dest, icon));
}
console.log(`最低 iOS ${want} を確認、アイコン ${icons.length} 件を icons/ios から同期した`);
