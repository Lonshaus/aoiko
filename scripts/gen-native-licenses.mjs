// 同梱している Rust クレートの著作権表示を 1 ファイルへ集める。理由・出力形式は
// aoiko 本体の scripts/gen-third-party-licenses.js（JS 側の第三者ライセンス一覧）に揃えている。
//
// 一覧の出所は `cargo metadata`。対象ごと（x64/arm64 を含む）にクレート集合が
// 変わる（windows-sys 等がプラットフォーム限定依存のため）ので、配布対象の全プラットフォームで
// 取得して和集合を取る。1 枚だけでは載せ漏れが出る。
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = join(root, 'src-tauri', 'Cargo.toml');
const outPath = join(root, 'src-tauri', 'THIRD_PARTY_LICENSES_NATIVE.txt');

const TARGETS = [
  'aarch64-apple-darwin',
  'x86_64-apple-darwin',
  'aarch64-apple-ios',
  'x86_64-pc-windows-msvc',
  'aarch64-pc-windows-msvc',
];

// ファイル名の揺れ（LICENSE / LICENSE-MIT / license-apache-2.0 / LICENSE_MIT / *.txt 等）を総当たりで拾う。
const LICENSE_FILE = /^(licen[cs]e|copying)([-_.].*)?$/i;

// MPL-2.0 は改変ファイルの再配布時のみソース開示義務を負う（§3.3）。crates.io からそのまま
// 使っており改変していないため、本文を同梱する代わりに取得先を示す専用セクションにする。
const MPL_NAMES = new Set([
  'cssparser',
  'cssparser-macros',
  'dtoa-short',
  'selectors',
  'option-ext',
]);

// 以下 2 つは opensource.org 掲載の正文（SPDX の参照本文と同一）。crates.io の配布物に
// 本文ファイルが無いクレート向けに、著作権表示だけ差し替えて掲げる。
function mitLicenseText(copyrightLine) {
  return `MIT License

${copyrightLine}

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`;
}

function bsd3LicenseText(copyrightLine) {
  return `BSD 3-Clause License

${copyrightLine}
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

3. Neither the name of the copyright holder nor the names of its
   contributors may be used to endorse or promote products derived from
   this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.`;
}

// license 本文ファイルを同梱していないクレート向けに、宣言された SPDX 識別子から
// 標準本文を補う。選択式（MIT OR Apache-2.0 等）は MIT を採用する（本文を確実に
// 用意できる側を選ぶだけで、他の選択肢を否定するものではない）。該当が無ければ null を返し、
// 呼び出し側が「補えなかった」クレートとして残す。
function supplyLicenseText(pkg) {
  const spdx = pkg.license ?? '';
  const tokens = spdx
    .split(/\s+OR\s+|\//)
    .map((s) => s.trim())
    .filter((s) => s !== '');
  let body;
  let choiceNote = '';
  if (tokens.includes('MIT')) {
    body = mitLicenseText;
    if (tokens.length > 1) {
      choiceNote = `宣言されたライセンスは「${spdx}」。このうち MIT の条件を選択して本文を掲げる。`;
    }
  } else if (spdx === 'BSD-3-Clause') {
    body = bsd3LicenseText;
  } else {
    return null;
  }
  const copyrightLine =
    pkg.authors && pkg.authors.length > 0
      ? `Copyright (c) ${pkg.authors.join(', ')}`
      : `著作権者の宣言なし（Cargo.toml の authors が空）。原本は ${pkg.repository ?? '(リポジトリ不明)'} を参照。`;
  const parts = [];
  if (choiceNote !== '') {
    parts.push(choiceNote, '');
  }
  parts.push(body(copyrightLine));
  return parts.join('\n');
}

function cargoMetadata(target) {
  const out = execFileSync(
    'cargo',
    [
      'metadata',
      '--format-version',
      '1',
      '--manifest-path',
      manifestPath,
      '--filter-platform',
      target,
    ],
    { maxBuffer: 1024 * 1024 * 256 },
  );
  return JSON.parse(out.toString('utf8'));
}

// resolve.nodes を root から辿り、kind === null（通常依存）の辺だけを踏む。
// dev は配布物に入らず、build はコンパイル時にしか動かず自身のコードはリンクされない。
function normalDepIds(metadata) {
  const nodes = new Map(metadata.resolve.nodes.map((n) => [n.id, n]));
  const included = new Set();
  const queue = [metadata.resolve.root];
  while (queue.length > 0) {
    const id = queue.pop();
    const node = nodes.get(id);
    if (node === undefined) {
      continue;
    }
    for (const dep of node.deps) {
      const isNormal = dep.dep_kinds.some((k) => k.kind === null);
      if (!isNormal || included.has(dep.pkg)) {
        continue;
      }
      included.add(dep.pkg);
      queue.push(dep.pkg);
    }
  }
  return included;
}

function collectPackages() {
  const byId = new Map();
  for (const target of TARGETS) {
    const metadata = cargoMetadata(target);
    const included = normalDepIds(metadata);
    const pkgById = new Map(metadata.packages.map((p) => [p.id, p]));
    for (const id of included) {
      const pkg = pkgById.get(id);
      // ワークスペース内クレート（aoiko-desktop 自身・tauri-plugin-aoiko-native）は source が無い。
      if (pkg === undefined || pkg.source === null) {
        continue;
      }
      byId.set(id, pkg);
    }
  }
  return [...byId.values()].sort(
    (a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version),
  );
}

function readLicenseTexts(pkg) {
  const dir = dirname(pkg.manifest_path);
  if (!existsSync(dir)) {
    return [];
  }
  const hits = readdirSync(dir)
    .filter((f) => LICENSE_FILE.test(f))
    .sort();
  if (hits.length > 0) {
    return hits.map((f) => readFileSync(join(dir, f), 'utf8').trimEnd());
  }
  if (pkg.license_file) {
    const path = join(dir, pkg.license_file);
    if (existsSync(path)) {
      return [readFileSync(path, 'utf8').trimEnd()];
    }
  }
  return [];
}

function render(packages) {
  const lines = [
    'aoiko のネイティブ版（Windows / macOS / iPadOS / iOS）が配布物に含む第三者 Rust クレートと、その著作権表示',
    '',
    'このファイルは scripts/gen-native-licenses.mjs が cargo metadata から生成しています。',
    '直接編集せず、依存を変えたら再生成してください。',
    '',
    `対象：配布物へリンクされる依存 ${packages.length} 件（macOS / iOS / Windows の通常依存の和集合）。`,
    'dev-dependencies（テスト専用）と build-dependencies（ビルド時にしか動かず自身のコードは',
    'リンクされない proc macro 等）は除く。',
    'aoiko デスクトップ版自身のライセンスは同梱の LICENSE を参照してください。',
    '',
  ];
  lines.push('■ 一覧', '');
  for (const p of packages) {
    lines.push(`  ${p.name}@${p.version}  —  ${p.license ?? '(不明)'}`);
  }
  lines.push('');

  const mpl = packages.filter((p) => MPL_NAMES.has(p.name));
  const rest = packages.filter((p) => !MPL_NAMES.has(p.name));

  // 同一本文（複数ファイルを持つクレートはその組み合わせ）が並ぶ場合、対象クレートをまとめて 1 回だけ載せる。
  const byText = new Map();
  const supplied = new Map();
  const residual = [];
  for (const p of rest) {
    const texts = readLicenseTexts(p);
    if (texts.length > 0) {
      const key = texts.join('\n\0\n');
      const entry = byText.get(key) ?? { packages: [], texts };
      entry.packages.push(`${p.name}@${p.version}`);
      byText.set(key, entry);
      continue;
    }
    const suppliedText = supplyLicenseText(p);
    if (suppliedText === null) {
      residual.push(p);
      continue;
    }
    const entry = supplied.get(suppliedText) ?? { packages: [], text: suppliedText };
    entry.packages.push(`${p.name}@${p.version}`);
    supplied.set(suppliedText, entry);
  }
  for (const entry of byText.values()) {
    lines.push('─'.repeat(78), '');
    lines.push(`対象：${entry.packages.join(', ')}`, '');
    for (const text of entry.texts) {
      lines.push(text, '');
    }
  }

  if (mpl.length > 0) {
    lines.push('─'.repeat(78), '');
    lines.push(
      '■ MPL-2.0（Mozilla Public License 2.0）のクレートについて',
      '',
      'MPL-2.0 §3.3 は、改変していないファイルをそのまま「Larger Work」に組み込んで',
      '他のライセンス条件の下で配布することを認めている。以下は crates.io から無改変で',
      '取得しており、対象ファイルのソースは各クレートの配布元（crates.io）から入手できる。',
      '',
    );
    for (const p of mpl) {
      lines.push(`  ${p.name}@${p.version}  —  https://crates.io/crates/${p.name}`);
    }
    lines.push('');
  }

  if (supplied.size > 0) {
    lines.push('─'.repeat(78), '');
    lines.push(
      '■ crates.io の配布物に本文ファイルを含めていないクレートについて（当方が標準本文を補って掲げたもの）',
      '',
      'これらのクレートは crates.io へ公開された配布物にライセンス本文のファイルを含めていない',
      '（上流の Cargo.toml の include 設定から漏れているだけで、ライセンスが無いわけではない）。',
      '本文が無いままでは MIT 等が求める表示を満たせないため、各クレートが宣言しているライセンスの',
      '標準本文を以下に掲げる。著作権者は各クレートの Cargo.toml が宣言する authors をそのまま採った。',
      '原本は各クレートのリポジトリを参照のこと。',
      '',
    );
    for (const entry of supplied.values()) {
      lines.push('─'.repeat(78), '');
      lines.push(`対象：${entry.packages.join(', ')}`, '');
      lines.push(entry.text, '');
    }
  }

  if (residual.length > 0) {
    lines.push('─'.repeat(78), '');
    lines.push(
      '次のクレートは本文ファイルを同梱しておらず、宣言されたライセンス識別子から標準本文を',
      '機械的に補うこともできませんでした。識別子を手掛かりに原本を別途参照してください。',
      '',
    );
    for (const p of residual) {
      lines.push(`  ${p.name}@${p.version}  —  ${p.license ?? '(不明)'}`);
    }
    lines.push('');
  }
  // BOM は JS 側（public/THIRD_PARTY_LICENSES.txt）と同じ理由。charset 指定のない配信環境で
  // 文字化けしないよう、ファイル自身に持たせる。
  return `﻿${lines.join('\n').trimEnd()}\n`;
}

const generated = render(collectPackages());
if (process.argv.includes('--check')) {
  const current = existsSync(outPath) ? readFileSync(outPath, 'utf8') : '';
  if (current !== generated) {
    console.error(
      'src-tauri/THIRD_PARTY_LICENSES_NATIVE.txt が依存と一致していません。npm run licenses:native:generate を実行してください。',
    );
    process.exit(1);
  }
  console.log('src-tauri/THIRD_PARTY_LICENSES_NATIVE.txt は依存と一致しています。');
} else {
  writeFileSync(outPath, generated);
  console.log(
    `src-tauri/THIRD_PARTY_LICENSES_NATIVE.txt を書き出しました（${generated.length} 文字）。`,
  );
}
