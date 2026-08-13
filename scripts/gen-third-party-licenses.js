// 同梱している第三者ソフトウェアの著作権表示を 1 ファイルへ集める。
// MIT・BSD は「複製物に著作権表示を含めること」、Apache-2.0 は §4 でライセンス本文と NOTICE の
// 添付を求めており、配布物そのものに載っていなければ満たせない。商店の規約ではなく
// 各ライセンス自身の要求なので、web 版・app 版のどちらにも等しく掛かる。
//
// 一覧の出所は package-lock.json（実際に配る版が固定されている唯一の場所）で、
// node_modules は本文を読むためだけに使う。--check は生成し直して差分を見る。
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
// public/ に置くと vite がそのまま dist/ へ複製する。MIT・BSD が求めているのは
// 「複製物に著作権表示を含めること」なので、リンクを 1 本張るのではなく配布物の中へ入れる。
const outPath = join(root, 'public', 'THIRD_PARTY_LICENSES.txt');
// ライセンス本文のファイル名は統一されていない。大文字小文字も揺れるので総当たりで探す。
const LICENSE_FILE = /^(licen[cs]e|copying)(\.(md|txt|markdown))?$/i;
const NOTICE_FILE = /^notice(\.(md|txt))?$/i;

// npm の dev フラグは「インストール時に要るか」であって「配布物へ入るか」ではない。
// 次の 2 つは devDependencies に置かれているがコードや資産がそのまま配られるもので、
// 判定根拠は src からの import か、dist に出る成果物そのもの。
// こちらは自身も依存も一緒に配られるため、推移的依存まで辿る。
const SHIPPED_DEV_ROOTS = [
  'svelte', // ランタイムが全 bundle に入る
  'bits-ui', // vendor した shadcn 部品が import する
  'clsx', // lib/utils.ts の cn()
  'tailwind-merge',
  'tailwind-variants',
  '@fontsource-variable/inter', // フォント本体（dist/assets/inter-*.woff2）。OFL は複製物への表示を要求する
  'tw-animate-css', // CSS が bundle に入る
];
// 自身のコードは配られるが、依存は配られないもの。依存は辿らない。
const SHIPPED_DEV_ONLY = [
  // 生成物 src/paraglide/ は ./runtime.js しか import しない自己完結のコードで、
  // 生成器側の依存（sqlite-wasm・kysely 等）は建置時にしか動かない。
  '@inlang/paraglide-js',
  // dist/workbox-*.js へ束ねられる実行時モジュール。どれが入るかは workbox の
  // 建置設定で決まり、minify 後の成果物からは判定できない（識別子が消える）。
  // globPatterns で precaching、navigateFallback で routing を使っているため
  // 実行時一式を対象にする。建置専用の workbox-build は入らない。
  'workbox-core',
  'workbox-precaching',
  'workbox-routing',
  'workbox-strategies',
  'workbox-window',
];

// package-lock は入れ子の node_modules も表現する。npm と同じく、要求元から
// 上へ辿って最初に見つかったものを採る。
function resolveEntry(packages, fromPath, name) {
  let base = fromPath;
  for (;;) {
    const candidate = base === '' ? `node_modules/${name}` : `${base}/node_modules/${name}`;
    if (packages[candidate]) {
      return candidate;
    }
    if (base === '') {
      return null;
    }
    const cut = base.lastIndexOf('/node_modules/');
    base = cut < 0 ? '' : base.slice(0, cut);
  }
}

// 配布物へ入る依存を集める。dependencies は丸ごと、SHIPPED_DEV_ROOTS は
// そこから辿れる推移的依存まで（bits-ui のように自身も依存を持つため）。
function shippedPackages() {
  const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
  const packages = lock.packages ?? {};
  const paths = new Set();
  for (const [path, meta] of Object.entries(packages)) {
    if (path.startsWith('node_modules/') && !meta.dev && !meta.devOptional) {
      paths.add(path);
    }
  }
  const queue = [];
  for (const [name, follow] of [
    ...SHIPPED_DEV_ROOTS.map((n) => [n, true]),
    ...SHIPPED_DEV_ONLY.map((n) => [n, false]),
  ]) {
    const path = resolveEntry(packages, '', name);
    if (path === null) {
      throw new Error(`一覧に指定されたパッケージが package-lock に無い: ${name}`);
    }
    if (follow) {
      queue.push(path);
    } else {
      paths.add(path);
    }
  }
  while (queue.length > 0) {
    const path = queue.pop();
    if (path === undefined || paths.has(path)) {
      continue;
    }
    paths.add(path);
    // optionalDependencies は入らない環境があり、peerDependencies は利用側が
    // 持つものなので辿らない。実際に同梱されるのは dependencies の連鎖だけ。
    for (const name of Object.keys(packages[path]?.dependencies ?? {})) {
      const next = resolveEntry(packages, path, name);
      if (next !== null && !paths.has(next)) {
        queue.push(next);
      }
    }
  }
  const found = [];
  for (const path of paths) {
    const meta = packages[path];
    const dir = join(root, path);
    found.push({
      name: path.slice(path.lastIndexOf('node_modules/') + 'node_modules/'.length),
      version: meta?.version ?? '',
      license: meta?.license ?? licenseNameFromText(dir),
      dir,
    });
  }
  return found.sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
}

// package.json に license を書いていないパッケージがある（svelte-toolbelt 等）。
// 本文の 1 行目はほぼ必ずライセンス名なので、そこから拾って「(不明)」を減らす。
function licenseNameFromText(dir) {
  const first = readNamed(dir, LICENSE_FILE).split('\n')[0]?.trim() ?? '';
  return first !== '' && first.length <= 60 ? `${first}（本文から判定）` : '(不明)';
}

function readNamed(dir, pattern) {
  if (!existsSync(dir)) {
    return '';
  }
  const hit = readdirSync(dir).find((f) => pattern.test(f));
  return hit ? readFileSync(join(dir, hit), 'utf8').trimEnd() : '';
}

function render(packages) {
  const lines = [
    'aoiko が配布物に含む第三者ソフトウェアと、その著作権表示',
    '',
    'このファイルは scripts/gen-third-party-licenses.js が package-lock.json と',
    'node_modules から生成しています。直接編集せず、依存を変えたら再生成してください。',
    '',
    `対象：配布物へ入る依存 ${packages.length} 件。`,
    'npm の dependencies に加え、devDependencies に置かれていても実際に配られるもの',
    '（Svelte のランタイム・UI 部品・フォント・サービスワーカー等）とその依存を含む。',
    'ビルド時にしか動かないものは除く。バンドラの tree shaking で最終的に落ちるものも',
    '含んでいる：実際に残るものだけを機械的に判定する手段が無く、載せ漏らすほうが',
    'ライセンス上まずいため、広いほうへ倒している。',
    'aoiko 自身のライセンスは同梱の LICENSE（AGPL-3.0）を参照してください。',
    '',
  ];
  lines.push('■ 一覧', '');
  for (const p of packages) {
    lines.push(`  ${p.name}@${p.version}  —  ${p.license}`);
  }
  lines.push('');
  // 同一本文が何度も並ぶと、どれがどのパッケージのものか読み手が追えなくなる。
  // Apache-2.0 のように全文が完全一致するものは 1 回だけ載せ、対象パッケージを列挙する。
  const byText = new Map();
  for (const p of packages) {
    const text = readNamed(p.dir, LICENSE_FILE);
    if (text === '') {
      continue;
    }
    const entry = byText.get(text) ?? { packages: [], notices: [] };
    entry.packages.push(`${p.name}@${p.version}`);
    const notice = readNamed(p.dir, NOTICE_FILE);
    if (notice !== '' && !entry.notices.some((n) => n.text === notice)) {
      entry.notices.push({ owner: p.name, text: notice });
    }
    byText.set(text, entry);
  }
  for (const [text, entry] of byText) {
    lines.push('─'.repeat(78), '');
    lines.push(`対象：${entry.packages.join(', ')}`, '');
    lines.push(text, '');
    for (const notice of entry.notices) {
      lines.push(`── ${notice.owner} の NOTICE ──`, '', notice.text, '');
    }
  }
  const missing = packages.filter((p) => readNamed(p.dir, LICENSE_FILE) === '');
  if (missing.length > 0) {
    lines.push('─'.repeat(78), '');
    lines.push(
      '次のパッケージはライセンス本文のファイルを同梱していません。上の一覧の識別子を参照してください。',
      '',
    );
    for (const p of missing) {
      lines.push(`  ${p.name}@${p.version}  —  ${p.license}`);
    }
    lines.push('');
  }
  // BOM を付けるのは text/plain に charset が付かない配信環境があるため。
  // 付けないとブラウザが既定の旧エンコーディングで解釈し、日本語が全て文字化けする
  // （vite preview で実測）。_headers で charset を足せるのは web 版だけで、
  // wrapper 版は独自プロトコル配信なので効かない。ファイル自身に持たせれば両方で直る。
  return `﻿${lines.join('\n').trimEnd()}\n`;
}

const generated = render(shippedPackages());
if (process.argv.includes('--check')) {
  const current = existsSync(outPath) ? readFileSync(outPath, 'utf8') : '';
  if (current !== generated) {
    console.error(
      'public/THIRD_PARTY_LICENSES.txt が依存と一致していません。npm run licenses:generate を実行してください。',
    );
    process.exit(1);
  }
  console.log('public/THIRD_PARTY_LICENSES.txt は依存と一致しています。');
} else {
  writeFileSync(outPath, generated);
  console.log(`public/THIRD_PARTY_LICENSES.txt を書き出しました（${generated.length} 文字）。`);
}
