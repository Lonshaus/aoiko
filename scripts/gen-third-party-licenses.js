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

function productionPackages() {
  const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
  const found = [];
  for (const [path, meta] of Object.entries(lock.packages ?? {})) {
    if (!path.startsWith('node_modules/') || meta.dev || meta.devOptional) {
      continue;
    }
    found.push({
      name: path.slice('node_modules/'.length),
      version: meta.version ?? '',
      license: meta.license ?? '(不明)',
      dir: join(root, path),
    });
  }
  return found.sort((a, b) => a.name.localeCompare(b.name));
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
    'aoiko の本番依存と、その著作権表示',
    '',
    'このファイルは scripts/gen-third-party-licenses.js が package-lock.json と',
    'node_modules から生成しています。直接編集せず、依存を変えたら再生成してください。',
    '',
    `対象：本番依存 ${packages.length} 件（開発用の依存は配布物に含まれないため除く）。`,
    'バンドラの tree shaking で最終的な配布物へ入らないものも含む。実際に入るものだけを',
    '機械的に判定する手段が無く、載せ漏らすほうがライセンス上まずいため、広いほうへ倒している。',
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

const generated = render(productionPackages());
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
