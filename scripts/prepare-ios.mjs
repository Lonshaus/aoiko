// gen/apple は生成物で git に入っていない。設定を直しても、既に gen/apple がある作業
// コピーには反映されない。ここで「設定と生成物が食い違っていないか」を毎回見る。
import { copyFileSync, readdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';

const genRoot = new URL('../src-tauri/gen/apple/', import.meta.url).pathname;
const src = new URL('../src-tauri/icons/ios/', import.meta.url).pathname;
const dest = join(genRoot, 'Assets.xcassets/AppIcon.appiconset/');
// gen/apple の中の名前は Cargo の package 名から来ており、tauri.conf.json の
// productName とは違う。組み立てると存在しないパスになり、下の照合が黙って素通りする。
const genName = existsSync(genRoot)
  ? (readdirSync(genRoot).find((d) => d.endsWith('.xcodeproj')) ?? '').replace('.xcodeproj', '')
  : '';

// まだ init していない作業コピーでは見る先が無い。ここで落とすと ios:dev / ios:build が
// 本来の「先に init しろ」という案内へ進めなくなるので、黙って通す（何もしないのが正しい）。
if (!existsSync(dest)) {
  console.log('gen/apple がまだ無いので何もしない');
  process.exit(0);
}

// 1. 最低 OS バージョン。tauri ios init は既存の project.yml を上書きしないため、
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
  const pbxproj = join(genRoot, `${genName}.xcodeproj/project.pbxproj`);
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

// 2. Info.ios.plist の項目。tauri ios init はこのファイルを読まない（2026-08-22 実測。
// init 直後の生成物には 1 項目も入っていなかった）。アイコンと同じで、こちらを出所として
// 毎回入れ直す。カメラの利用目的が抜けたまま建った版は、審査中に選択ボタンを押した瞬間
// OS に終了させられて返ってきた。
const iosPlist = new URL('../src-tauri/Info.ios.plist', import.meta.url).pathname;
const genPlist = join(genRoot, `${genName}_iOS/Info.plist`);
if (!existsSync(iosPlist) || !existsSync(genPlist)) {
  console.error(`Info.ios.plist か生成物の Info.plist が無い（${iosPlist} / ${genPlist}）`);
  process.exit(1);
}
const readPlist = (f) =>
  JSON.parse(execSync(`plutil -convert json -o - ${JSON.stringify(f)}`, { encoding: 'utf8' }));
const wanted = readPlist(iosPlist);
const generated = readPlist(genPlist);
// 値まで見る。文言だけ直した時も生成物は古いままで、そちらが配られてしまう。
const applied = Object.keys(wanted).filter(
  (k) => JSON.stringify(generated[k]) !== JSON.stringify(wanted[k]),
);
if (applied.length > 0) {
  execSync(`plutil -convert xml1 -o ${JSON.stringify(genPlist)} -`, {
    input: JSON.stringify({ ...generated, ...wanted }),
  });
}

// 3. アイコン。tauri ios init は Assets.xcassets を既定のロゴで作り直す。
// 新規 clone でも同じことが起きるので、icons/ios を出所として毎回上書きし直す。
const icons = readdirSync(src).filter((f) => f.endsWith('.png'));
if (icons.length === 0) {
  console.error(`${src} に PNG が無い`);
  process.exit(1);
}
// Contents.json は init が作ったものを使う。差し替えるのは PNG の中身だけ。
// 名前が食い違っていればビルドが落ちるので、ここで黙って通さない。
const listed = new Set(readdirSync(dest).filter((f) => f.endsWith('.png')));
const missing = icons.filter((f) => !listed.has(f));
if (missing.length > 0) {
  console.error(`appiconset に無いファイル名がある: ${missing.join(', ')}`);
  process.exit(1);
}

for (const icon of icons) {
  copyFileSync(join(src, icon), join(dest, icon));
}

// 4. FoundationModels の weak link。build.rs が cargo へ渡す -weak_framework は
// デスクトップでは cargo 自身がリンクするので効くが、iOS は Xcode が最終リンクを
// 行うため cargo の link-arg は届かない。ビルド設定へ直接埋め込む必要がある。
// project.yml は tauri ios init が既存ファイルを上書きしない限りでしか効かない
// （xcodegen が動くのは init 時だけ）ので、実際にビルドへ効くのは pbxproj への直書き。
// project.yml 側も合わせておくのは、将来 gen/apple を消して作り直した時の出所にするため。
const ldflagText = '$(inherited) -weak_framework FoundationModels';
const projectYmlPath = join(genRoot, 'project.yml');
let ldApplied = 0;
if (existsSync(projectYmlPath)) {
  const yml = readFileSync(projectYmlPath, 'utf8');
  if (!yml.includes('OTHER_LDFLAGS')) {
    const patched = yml.replace(
      /(\n( +)EXCLUDED_ARCHS\[sdk=iphoneos\*\]:\s*x86_64\n)/,
      (_all, line, indent) => `${line}${indent}OTHER_LDFLAGS: ${ldflagText}\n`,
    );
    if (patched === yml) {
      console.error('project.yml の settings.base に差し込み位置が見つからない');
      process.exit(1);
    }
    writeFileSync(projectYmlPath, patched);
  } else if (!yml.includes('FoundationModels')) {
    console.error('project.yml に想定外の OTHER_LDFLAGS が既にある、手で確認する');
    process.exit(1);
  }
}
const pbxprojPath = join(genRoot, `${genName}.xcodeproj/project.pbxproj`);
if (!existsSync(pbxprojPath)) {
  console.error(`project.pbxproj が無い（${pbxprojPath}）`);
  process.exit(1);
}
let pbx = readFileSync(pbxprojPath, 'utf8');
const escaped = genName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const listMatch = pbx.match(
  new RegExp(
    `Build configuration list for PBXNativeTarget "${escaped}_iOS"[^{]*\\{[\\s\\S]*?buildConfigurations = \\(([\\s\\S]*?)\\);`,
  ),
);
if (!listMatch) {
  console.error(`project.pbxproj に ${genName}_iOS の Build configuration list が無い`);
  process.exit(1);
}
const configIds = [...listMatch[1].matchAll(/[0-9A-F]{24}/g)].map((m) => m[0]);
if (configIds.length === 0) {
  console.error('project.pbxproj から build configuration の ID を取れない');
  process.exit(1);
}
for (const id of configIds) {
  const blockRe = new RegExp(
    `${id} \\/\\*[^*]*\\*\\/ = \\{\\n\\t\\t\\tisa = XCBuildConfiguration;\\n\\t\\t\\tbuildSettings = \\{`,
  );
  const m = pbx.match(blockRe);
  if (!m) {
    console.error(`project.pbxproj の buildSettings ブロックが見つからない (${id})`);
    process.exit(1);
  }
  const blockStart = m.index + m[0].length;
  const blockEnd = pbx.indexOf('\n\t\t\t};', blockStart);
  if (blockEnd === -1) {
    console.error(`project.pbxproj の buildSettings が閉じていない (${id})`);
    process.exit(1);
  }
  const body = pbx.slice(blockStart, blockEnd);
  if (body.includes('OTHER_LDFLAGS')) {
    if (!body.includes('FoundationModels')) {
      console.error(`project.pbxproj に想定外の OTHER_LDFLAGS がある (${id})、手で確認する`);
      process.exit(1);
    }
    continue;
  }
  const insertion =
    '\n\t\t\t\tOTHER_LDFLAGS = (\n\t\t\t\t\t"$(inherited)",\n\t\t\t\t\t"-weak_framework",\n\t\t\t\t\tFoundationModels,\n\t\t\t\t);';
  pbx = pbx.slice(0, blockStart) + insertion + pbx.slice(blockStart);
  ldApplied++;
}
if (ldApplied > 0) {
  writeFileSync(pbxprojPath, pbx);
}

console.log(
  `最低 iOS ${want} を確認、Info.ios.plist から ${applied.length} 項目、` +
    `アイコン ${icons.length} 件、FoundationModels の weak link を ${configIds.length} 件中 ${ldApplied} 件に同期した`,
);
