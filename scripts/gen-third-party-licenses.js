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
import {
  ASSETS as TESSERACT_ASSETS,
  MODEL_FILE as TESSERACT_MODEL_FILE,
} from './copy-tesseract-assets.js';

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

// tesseract-ocr/tesseract の LICENSE 本文（2026-08 に upstream から取得）。
// プロジェクト全体を束ねる単一の著作権表示は無く、末尾の Appendix も
// [yyyy] [name of copyright owner] のプレースホルダのまま。実際の著作権表示は
// ファイルごとのヘッダーに分散している（copyright フィールド側で代表例を示す）。
const TESSERACT_APACHE_TEXT = `
                                 Apache License
                           Version 2.0, January 2004
                        http://www.apache.org/licenses/

   TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION

   1. Definitions.

      "License" shall mean the terms and conditions for use, reproduction,
      and distribution as defined by Sections 1 through 9 of this document.

      "Licensor" shall mean the copyright owner or entity authorized by
      the copyright owner that is granting the License.

      "Legal Entity" shall mean the union of the acting entity and all
      other entities that control, are controlled by, or are under common
      control with that entity. For the purposes of this definition,
      "control" means (i) the power, direct or indirect, to cause the
      direction or management of such entity, whether by contract or
      otherwise, or (ii) ownership of fifty percent (50%) or more of the
      outstanding shares, or (iii) beneficial ownership of such entity.

      "You" (or "Your") shall mean an individual or Legal Entity
      exercising permissions granted by this License.

      "Source" form shall mean the preferred form for making modifications,
      including but not limited to software source code, documentation
      source, and configuration files.

      "Object" form shall mean any form resulting from mechanical
      transformation or translation of a Source form, including but
      not limited to compiled object code, generated documentation,
      and conversions to other media types.

      "Work" shall mean the work of authorship, whether in Source or
      Object form, made available under the License, as indicated by a
      copyright notice that is included in or attached to the work
      (an example is provided in the Appendix below).

      "Derivative Works" shall mean any work, whether in Source or Object
      form, that is based on (or derived from) the Work and for which the
      editorial revisions, annotations, elaborations, or other modifications
      represent, as a whole, an original work of authorship. For the purposes
      of this License, Derivative Works shall not include works that remain
      separable from, or merely link (or bind by name) to the interfaces of,
      the Work and Derivative Works thereof.

      "Contribution" shall mean any work of authorship, including
      the original version of the Work and any modifications or additions
      to that Work or Derivative Works thereof, that is intentionally
      submitted to Licensor for inclusion in the Work by the copyright owner
      or by an individual or Legal Entity authorized to submit on behalf of
      the copyright owner. For the purposes of this definition, "submitted"
      means any form of electronic, verbal, or written communication sent
      to the Licensor or its representatives, including but not limited to
      communication on electronic mailing lists, source code control systems,
      and issue tracking systems that are managed by, or on behalf of, the
      Licensor for the purpose of discussing and improving the Work, but
      excluding communication that is conspicuously marked or otherwise
      designated in writing by the copyright owner as "Not a Contribution."

      "Contributor" shall mean Licensor and any individual or Legal Entity
      on behalf of whom a Contribution has been received by Licensor and
      subsequently incorporated within the Work.

   2. Grant of Copyright License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      copyright license to reproduce, prepare Derivative Works of,
      publicly display, publicly perform, sublicense, and distribute the
      Work and such Derivative Works in Source or Object form.

   3. Grant of Patent License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      (except as stated in this section) patent license to make, have made,
      use, offer to sell, sell, import, and otherwise transfer the Work,
      where such license applies only to those patent claims licensable
      by such Contributor that are necessarily infringed by their
      Contribution(s) alone or by combination of their Contribution(s)
      with the Work to which such Contribution(s) was submitted. If You
      institute patent litigation against any entity (including a
      cross-claim or counterclaim in a lawsuit) alleging that the Work
      or a Contribution incorporated within the Work constitutes direct
      or contributory patent infringement, then any patent licenses
      granted to You under this License for that Work shall terminate
      as of the date such litigation is filed.

   4. Redistribution. You may reproduce and distribute copies of the
      Work or Derivative Works thereof in any medium, with or without
      modifications, and in Source or Object form, provided that You
      meet the following conditions:

      (a) You must give any other recipients of the Work or
          Derivative Works a copy of this License; and

      (b) You must cause any modified files to carry prominent notices
          stating that You changed the files; and

      (c) You must retain, in the Source form of any Derivative Works
          that You distribute, all copyright, patent, trademark, and
          attribution notices from the Source form of the Work,
          excluding those notices that do not pertain to any part of
          the Derivative Works; and

      (d) If the Work includes a "NOTICE" text file as part of its
          distribution, then any Derivative Works that You distribute must
          include a readable copy of the attribution notices contained
          within such NOTICE file, excluding those notices that do not
          pertain to any part of the Derivative Works, in at least one
          of the following places: within a NOTICE text file distributed
          as part of the Derivative Works; within the Source form or
          documentation, if provided along with the Derivative Works; or,
          within a display generated by the Derivative Works, if and
          wherever such third-party notices normally appear. The contents
          of the NOTICE file are for informational purposes only and
          do not modify the License. You may add Your own attribution
          notices within Derivative Works that You distribute, alongside
          or as an addendum to the NOTICE text from the Work, provided
          that such additional attribution notices cannot be construed
          as modifying the License.

      You may add Your own copyright statement to Your modifications and
      may provide additional or different license terms and conditions
      for use, reproduction, or distribution of Your modifications, or
      for any such Derivative Works as a whole, provided Your use,
      reproduction, and distribution of the Work otherwise complies with
      the conditions stated in this License.

   5. Submission of Contributions. Unless You explicitly state otherwise,
      any Contribution intentionally submitted for inclusion in the Work
      by You to the Licensor shall be under the terms and conditions of
      this License, without any additional terms or conditions.
      Notwithstanding the above, nothing herein shall supersede or modify
      the terms of any separate license agreement you may have executed
      with Licensor regarding such Contributions.

   6. Trademarks. This License does not grant permission to use the trade
      names, trademarks, service marks, or product names of the Licensor,
      except as required for reasonable and customary use in describing the
      origin of the Work and reproducing the content of the NOTICE file.

   7. Disclaimer of Warranty. Unless required by applicable law or
      agreed to in writing, Licensor provides the Work (and each
      Contributor provides its Contributions) on an "AS IS" BASIS,
      WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or
      implied, including, without limitation, any warranties or conditions
      of TITLE, NON-INFRINGEMENT, MERCHANTABILITY, or FITNESS FOR A
      PARTICULAR PURPOSE. You are solely responsible for determining the
      appropriateness of using or redistributing the Work and assume any
      risks associated with Your exercise of permissions under this License.

   8. Limitation of Liability. In no event and under no legal theory,
      whether in tort (including negligence), contract, or otherwise,
      unless required by applicable law (such as deliberate and grossly
      negligent acts) or agreed to in writing, shall any Contributor be
      liable to You for damages, including any direct, indirect, special,
      incidental, or consequential damages of any character arising as a
      result of this License or out of the use or inability to use the
      Work (including but not limited to damages for loss of goodwill,
      work stoppage, computer failure or malfunction, or any and all
      other commercial damages or losses), even if such Contributor
      has been advised of the possibility of such damages.

   9. Accepting Warranty or Additional Liability. While redistributing
      the Work or Derivative Works thereof, You may choose to offer,
      and charge a fee for, acceptance of support, warranty, indemnity,
      or other liability obligations and/or rights consistent with this
      License. However, in accepting such obligations, You may act only
      on Your own behalf and on Your sole responsibility, not on behalf
      of any other Contributor, and only if You agree to indemnify,
      defend, and hold each Contributor harmless for any liability
      incurred by, or claims asserted against, such Contributor by reason
      of your accepting any such warranty or additional liability.

   END OF TERMS AND CONDITIONS

   APPENDIX: How to apply the Apache License to your work.

      To apply the Apache License to your work, attach the following
      boilerplate notice, with the fields enclosed by brackets "[]"
      replaced with your own identifying information. (Don't include
      the brackets!)  The text should be enclosed in the appropriate
      comment syntax for the file format. We also recommend that a
      file or class name and description of purpose be included on the
      same "printed page" as the copyright notice for easier
      identification within third-party archives.

   Copyright [yyyy] [name of copyright owner]

   Licensed under the Apache License, Version 2.0 (the "License");
   you may not use this file except in compliance with the License.
   You may obtain a copy of the License at

       http://www.apache.org/licenses/LICENSE-2.0

   Unless required by applicable law or agreed to in writing, software
   distributed under the License is distributed on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   See the License for the specific language governing permissions and
   limitations under the License.`.trim();

// tesseract-ocr/tessdata_best の LICENSE 本文。tesseract 本体と同じ Apache-2.0 だが
// Appendix を含まず、本文が完全には一致しないため別テキストとして持つ。
const TESSDATA_APACHE_TEXT = `                                 Apache License
                           Version 2.0, January 2004
                        http://www.apache.org/licenses/

   TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION

   1. Definitions.

      "License" shall mean the terms and conditions for use, reproduction,
      and distribution as defined by Sections 1 through 9 of this document.

      "Licensor" shall mean the copyright owner or entity authorized by
      the copyright owner that is granting the License.

      "Legal Entity" shall mean the union of the acting entity and all
      other entities that control, are controlled by, or are under common
      control with that entity. For the purposes of this definition,
      "control" means (i) the power, direct or indirect, to cause the
      direction or management of such entity, whether by contract or
      otherwise, or (ii) ownership of fifty percent (50%) or more of the
      outstanding shares, or (iii) beneficial ownership of such entity.

      "You" (or "Your") shall mean an individual or Legal Entity
      exercising permissions granted by this License.

      "Source" form shall mean the preferred form for making modifications,
      including but not limited to software source code, documentation
      source, and configuration files.

      "Object" form shall mean any form resulting from mechanical
      transformation or translation of a Source form, including but
      not limited to compiled object code, generated documentation,
      and conversions to other media types.

      "Work" shall mean the work of authorship, whether in Source or
      Object form, made available under the License, as indicated by a
      copyright notice that is included in or attached to the work
      (an example is provided in the Appendix below).

      "Derivative Works" shall mean any work, whether in Source or Object
      form, that is based on (or derived from) the Work and for which the
      editorial revisions, annotations, elaborations, or other modifications
      represent, as a whole, an original work of authorship. For the purposes
      of this License, Derivative Works shall not include works that remain
      separable from, or merely link (or bind by name) to the interfaces of,
      the Work and Derivative Works thereof.

      "Contribution" shall mean any work of authorship, including
      the original version of the Work and any modifications or additions
      to that Work or Derivative Works thereof, that is intentionally
      submitted to Licensor for inclusion in the Work by the copyright owner
      or by an individual or Legal Entity authorized to submit on behalf of
      the copyright owner. For the purposes of this definition, "submitted"
      means any form of electronic, verbal, or written communication sent
      to the Licensor or its representatives, including but not limited to
      communication on electronic mailing lists, source code control systems,
      and issue tracking systems that are managed by, or on behalf of, the
      Licensor for the purpose of discussing and improving the Work, but
      excluding communication that is conspicuously marked or otherwise
      designated in writing by the copyright owner as "Not a Contribution."

      "Contributor" shall mean Licensor and any individual or Legal Entity
      on behalf of whom a Contribution has been received by Licensor and
      subsequently incorporated within the Work.

   2. Grant of Copyright License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      copyright license to reproduce, prepare Derivative Works of,
      publicly display, publicly perform, sublicense, and distribute the
      Work and such Derivative Works in Source or Object form.

   3. Grant of Patent License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      (except as stated in this section) patent license to make, have made,
      use, offer to sell, sell, import, and otherwise transfer the Work,
      where such license applies only to those patent claims licensable
      by such Contributor that are necessarily infringed by their
      Contribution(s) alone or by combination of their Contribution(s)
      with the Work to which such Contribution(s) was submitted. If You
      institute patent litigation against any entity (including a
      cross-claim or counterclaim in a lawsuit) alleging that the Work
      or a Contribution incorporated within the Work constitutes direct
      or contributory patent infringement, then any patent licenses
      granted to You under this License for that Work shall terminate
      as of the date such litigation is filed.

   4. Redistribution. You may reproduce and distribute copies of the
      Work or Derivative Works thereof in any medium, with or without
      modifications, and in Source or Object form, provided that You
      meet the following conditions:

      (a) You must give any other recipients of the Work or
          Derivative Works a copy of this License; and

      (b) You must cause any modified files to carry prominent notices
          stating that You changed the files; and

      (c) You must retain, in the Source form of any Derivative Works
          that You distribute, all copyright, patent, trademark, and
          attribution notices from the Source form of the Work,
          excluding those notices that do not pertain to any part of
          the Derivative Works; and

      (d) If the Work includes a "NOTICE" text file as part of its
          distribution, then any Derivative Works that You distribute must
          include a readable copy of the attribution notices contained
          within such NOTICE file, excluding those notices that do not
          pertain to any part of the Derivative Works, in at least one
          of the following places: within a NOTICE text file distributed
          as part of the Derivative Works; within the Source form or
          documentation, if provided along with the Derivative Works; or,
          within a display generated by the Derivative Works, if and
          wherever such third-party notices normally appear. The contents
          of the NOTICE file are for informational purposes only and
          do not modify the License. You may add Your own attribution
          notices within Derivative Works that You distribute, alongside
          or as an addendum to the NOTICE text from the Work, provided
          that such additional attribution notices cannot be construed
          as modifying the License.

      You may add Your own copyright statement to Your modifications and
      may provide additional or different license terms and conditions
      for use, reproduction, or distribution of Your modifications, or
      for any such Derivative Works as a whole, provided Your use,
      reproduction, and distribution of the Work otherwise complies with
      the conditions stated in this License.

   5. Submission of Contributions. Unless You explicitly state otherwise,
      any Contribution intentionally submitted for inclusion in the Work
      by You to the Licensor shall be under the terms and conditions of
      this License, without any additional terms or conditions.
      Notwithstanding the above, nothing herein shall supersede or modify
      the terms of any separate license agreement you may have executed
      with Licensor regarding such Contributions.

   6. Trademarks. This License does not grant permission to use the trade
      names, trademarks, service marks, or product names of the Licensor,
      except as required for reasonable and customary use in describing the
      origin of the Work and reproducing the content of the NOTICE file.

   7. Disclaimer of Warranty. Unless required by applicable law or
      agreed to in writing, Licensor provides the Work (and each
      Contributor provides its Contributions) on an "AS IS" BASIS,
      WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or
      implied, including, without limitation, any warranties or conditions
      of TITLE, NON-INFRINGEMENT, MERCHANTABILITY, or FITNESS FOR A
      PARTICULAR PURPOSE. You are solely responsible for determining the
      appropriateness of using or redistributing the Work and assume any
      risks associated with Your exercise of permissions under this License.

   8. Limitation of Liability. In no event and under no legal theory,
      whether in tort (including negligence), contract, or otherwise,
      unless required by applicable law (such as deliberate and grossly
      negligent acts) or agreed to in writing, shall any Contributor be
      liable to You for damages, including any direct, indirect, special,
      incidental, or consequential damages of any character arising as a
      result of this License or out of the use or inability to use the
      Work (including but not limited to damages for loss of goodwill,
      work stoppage, computer failure or malfunction, or any and all
      other commercial damages or losses), even if such Contributor
      has been advised of the possibility of such damages.

   9. Accepting Warranty or Additional Liability. While redistributing
      the Work or Derivative Works thereof, You may choose to offer,
      and charge a fee for, acceptance of support, warranty, indemnity,
      or other liability obligations and/or rights consistent with this
      License. However, in accepting such obligations, You may act only
      on Your own behalf and on Your sole responsibility, not on behalf
      of any other Contributor, and only if You agree to indemnify,
      defend, and hold each Contributor harmless for any liability
      incurred by, or claims asserted against, such Contributor by reason
      of your accepting any such warranty or additional liability.

   END OF TERMS AND CONDITIONS`;

// DanBloomberg/leptonica の leptonica-license.txt。BSD-2-Clause の一般形と違い、
// 独自の文面（``AS IS'' の引用符表記や見出し罫線）を持つため、汎用テンプレートで
// 代替せずそのまま採録する。
const LEPTONICA_LICENSE_TEXT = `/*====================================================================*
 -  Copyright (C) 2001-2020 Leptonica.  All rights reserved.
 -
 -  Redistribution and use in source and binary forms, with or without
 -  modification, are permitted provided that the following conditions
 -  are met:
 -  1. Redistributions of source code must retain the above copyright
 -     notice, this list of conditions and the following disclaimer.
 -  2. Redistributions in binary form must reproduce the above
 -     copyright notice, this list of conditions and the following
 -     disclaimer in the documentation and/or other materials
 -     provided with the distribution.
 -
 -  THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
 -  \`\`AS IS'' AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
 -  LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
 -  A PARTICULAR PURPOSE ARE DISCLAIMED.  IN NO EVENT SHALL ANY
 -  CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL,
 -  EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO,
 -  PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR
 -  PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY
 -  OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING
 -  NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
 -  SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 *====================================================================*/`;

// huntabyte/shadcn-svelte の LICENSE.md。著作権者は同ファイルの宣言をそのまま使う。
const SHADCN_SVELTE_LICENSE_TEXT = `MIT License

Copyright (c) 2023 Hunter Johnston <https://github.com/huntabyte>
Copyright (c) 2023 CokaKoala <https://github.com/adriangonz97>
Copyright (c) 2023 shadcn

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

// npm パッケージではないが配布物へ入る成果物。package-lock.json は npm の依存グラフ
// しか表現しないため、これらは自動収集の対象外になる。ビルド構成を変えたら
// 手で見直すこと（下の assertTesseractAssetsCovered が WASM・モデルの取りこぼしだけは検知する）。
const EXTERNAL_ARTIFACTS = [
  {
    name: 'Tesseract OCR engine',
    // tesseract-wasm 0.11.0 に静的リンクされた版で、上流の tesseract 自体の
    // バージョン番号は tesseract-wasm 側で公開されていない。
    version: '(バージョン不明・tesseract-wasm 0.11.0 に静的リンク)',
    license: 'Apache-2.0',
    // distFiles はここへ直書きした値。copy-tesseract-assets.js の ASSETS とは
    // 独立に保守し、assertTesseractAssetsCovered で両者を突き合わせる
    // ―― import した配列をそのまま参照すると自己比較になり検査が無意味になるため。
    location: 'public/tesseract/tesseract-core.wasm, public/tesseract/tesseract-core-fallback.wasm',
    upstream: 'https://github.com/tesseract-ocr/tesseract',
    // プロジェクト全体を束ねる単一の著作権表示は存在しない（LICENSE 末尾の
    // Appendix もプレースホルダのまま）。ソース中のヘッダーに残る代表的な
    // 2 件を実物から採録した（src/ccmain/control.cpp, src/api/baseapi.cpp）。
    copyright:
      '(C) Copyright 1992, Hewlett-Packard Ltd.\n  (C) Copyright 2006, Google Inc.\n  （プロジェクト全体の単一の著作権表示は無く、ファイルごとのヘッダーに分散。上記は代表例）',
    text: TESSERACT_APACHE_TEXT,
    distFiles: ['tesseract-core.wasm', 'tesseract-core-fallback.wasm'],
  },
  {
    name: 'Leptonica',
    version: '(バージョン不明・上記 Tesseract の WASM に静的リンク)',
    license: 'BSD-2-Clause（Leptonica 独自の文面）',
    location: 'public/tesseract/tesseract-core.wasm, public/tesseract/tesseract-core-fallback.wasm',
    upstream: 'https://github.com/DanBloomberg/leptonica',
    copyright: 'Copyright (C) 2001-2020 Leptonica. All rights reserved.',
    text: LEPTONICA_LICENSE_TEXT,
    distFiles: ['tesseract-core.wasm', 'tesseract-core-fallback.wasm'],
  },
  {
    name: '日本語学習モデル（jpn.traineddata）',
    version: '4.0.0_best_int（@tesseract.js-data/jpn@1.0.0 経由で取得、原本は tessdata_best）',
    license: 'Apache-2.0',
    location: 'public/tesseract/jpn.traineddata',
    upstream: 'https://github.com/tesseract-ocr/tessdata_best',
    // tessdata_best にも NOTICE や埋まった著作権表示は無い。同じ tesseract-ocr
    // 組織が Tesseract 本体と一体で保守しているため、上と同じ代表例を掲げる。
    copyright:
      '(C) Copyright 1992, Hewlett-Packard Ltd.\n  (C) Copyright 2006, Google Inc.\n  （tessdata_best 自体に個別の著作権表示は無く、tesseract-ocr 組織が Tesseract 本体と一体で保守）',
    text: TESSDATA_APACHE_TEXT,
    distFiles: ['jpn.traineddata'],
  },
  {
    name: 'shadcn-svelte（vendor コンポーネント）',
    version: '(バージョン不明・src/lib/components/ui/ へ都度コピーされる生成コード)',
    license: 'MIT',
    location:
      'src/lib/components/ui/alert-dialog/, src/lib/components/ui/button/（bundle へ組み込み）',
    upstream: 'https://github.com/huntabyte/shadcn-svelte',
    copyright:
      'Copyright (c) 2023 Hunter Johnston / Copyright (c) 2023 CokaKoala / Copyright (c) 2023 shadcn',
    text: SHADCN_SVELTE_LICENSE_TEXT,
    distFiles: [],
  },
];

// copy-tesseract-assets.js が実際に複製する WASM・モデルのファイル名と、上の
// EXTERNAL_ARTIFACTS が「対象」と称しているファイル名が一致するかを確認する。
// worker.js は tesseract-wasm 自身の npm ライセンスで別途カバーされるため対象外。
function assertTesseractAssetsCovered() {
  const actual = new Set([
    ...TESSERACT_ASSETS.filter((f) => f.endsWith('.wasm')),
    TESSERACT_MODEL_FILE,
  ]);
  const claimed = new Set(EXTERNAL_ARTIFACTS.flatMap((a) => a.distFiles));
  const missing = [...actual].filter((f) => !claimed.has(f));
  const extra = [...claimed].filter((f) => !actual.has(f));
  if (missing.length > 0 || extra.length > 0) {
    throw new Error(
      `EXTERNAL_ARTIFACTS が copy-tesseract-assets.js の実際の複製先と食い違っている。` +
        `未記載: [${missing.join(', ')}]  記載だけ余分: [${extra.join(', ')}]`,
    );
  }
}

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

// MIT License の標準本文（SPDX の canonical text）。本文を同梱していないパッケージの
// ために持つ。著作権者の行は各パッケージの宣言を上に並べるため差し替えている。
const MIT_TEXT = `MIT License

Copyright (c) 上記各パッケージの著作権者

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
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR OTHER DEALINGS IN THE SOFTWARE.`;

// author は文字列（"Rich Harris"）とオブジェクト（{ name, email }）の両形式がある。
// 推測はせず、宣言されたものだけを返す。
function declaredAuthor(dir) {
  const path = join(dir, 'package.json');
  if (!existsSync(path)) {
    return '';
  }
  const author = JSON.parse(readFileSync(path, 'utf8')).author;
  if (typeof author === 'string') {
    return author;
  }
  return typeof author?.name === 'string' ? author.name : '';
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
    'このファイルは scripts/gen-third-party-licenses.js が package-lock.json・node_modules・',
    '手で保守する EXTERNAL_ARTIFACTS から生成しています。直接編集せず、依存やビルド構成を',
    '変えたら再生成してください。',
    '',
    `対象：npm 依存として自動収集した ${packages.length} 件 + npm 外から手動で追跡する ${EXTERNAL_ARTIFACTS.length} 件。`,
    'npm の dependencies に加え、devDependencies に置かれていても実際に配られるもの',
    '（Svelte のランタイム・UI 部品・フォント・サービスワーカー等）とその依存を含む。',
    'ビルド時にしか動かないものは除く。バンドラの tree shaking で最終的に落ちるものも',
    '含んでいる：実際に残るものだけを機械的に判定する手段が無く、載せ漏らすほうが',
    'ライセンス上まずいため、広いほうへ倒している。',
    'aoiko 自身のライセンスは同梱の LICENSE（AGPL-3.0）を参照してください。',
    '',
  ];
  lines.push('■ 一覧（npm 依存）', '');
  for (const p of packages) {
    lines.push(`  ${p.name}@${p.version}  —  ${p.license}`);
  }
  lines.push('');
  lines.push('■ 一覧（ビルド成果物・npm パッケージではない）', '');
  lines.push(
    'package-lock.json は npm の依存グラフしか表現せず、次のものはそこに載らない：',
    'WASM へ静的リンクされた C/C++ コード、gzip 展開で取り出す学習モデル、CLI が',
    'src へコピーした vendor コード。npm 由来ではない以上、この生成器が自動で',
    '見つける手段が無いため、下の一覧は手で保守している。ビルド構成（同梱ファイルや',
    '取り込み元）を変えたら、ここも合わせて見直すこと。',
    '',
  );
  for (const a of EXTERNAL_ARTIFACTS) {
    lines.push(`  ${a.name}  ${a.version}  —  ${a.license}`);
    lines.push(`    所在: ${a.location}`);
    lines.push(`    upstream: ${a.upstream}`);
  }
  lines.push('');
  // 同一本文が何度も並ぶと、どれがどのパッケージのものか読み手が追えなくなる。
  // Apache-2.0 のように全文が完全一致するものは 1 回だけ載せ、対象を列挙する。
  // npm 依存・EXTERNAL_ARTIFACTS の双方をこの 1 つの Map へ集めるので、
  // 例えば tesseract の Apache-2.0 本文が dexie 等と偶然一致すればここで合流する。
  const byText = new Map();
  for (const p of packages) {
    const text = readNamed(p.dir, LICENSE_FILE);
    if (text === '') {
      continue;
    }
    const entry = byText.get(text) ?? { packages: [], notices: [], externals: [] };
    entry.packages.push(`${p.name}@${p.version}`);
    const notice = readNamed(p.dir, NOTICE_FILE);
    if (notice !== '' && !entry.notices.some((n) => n.text === notice)) {
      entry.notices.push({ owner: p.name, text: notice });
    }
    byText.set(text, entry);
  }
  for (const a of EXTERNAL_ARTIFACTS) {
    const entry = byText.get(a.text) ?? { packages: [], notices: [], externals: [] };
    entry.externals.push(a);
    byText.set(a.text, entry);
  }
  for (const [text, entry] of byText) {
    lines.push('─'.repeat(78), '');
    const labels = [...entry.packages, ...entry.externals.map((a) => `${a.name}（${a.location}）`)];
    lines.push(`対象：${labels.join(', ')}`, '');
    for (const a of entry.externals) {
      lines.push(
        `── ${a.name} の著作権表示（upstream: ${a.upstream}） ──`,
        '',
        `  ${a.copyright}`,
        '',
      );
    }
    lines.push(text, '');
    for (const notice of entry.notices) {
      lines.push(`── ${notice.owner} の NOTICE ──`, '', notice.text, '');
    }
  }
  const missing = packages.filter((p) => readNamed(p.dir, LICENSE_FILE) === '');
  if (missing.length > 0) {
    lines.push('─'.repeat(78), '');
    lines.push(
      'これらのパッケージは npm へ公開された配布物にライセンス本文のファイルを含めていない。',
      '（上流の files 設定から漏れているだけで、ライセンスが無いわけではない。）',
      '識別子だけでは MIT が求める「著作権表示と許諾条文を複製物に含めること」を満たせないため、',
      '各パッケージが宣言しているライセンスの標準本文を掲げる。著作権者は各パッケージの',
      'package.json が宣言する author をそのまま採った。原本は各リポジトリを参照のこと。',
      '',
    );
    for (const p of missing) {
      const holder = declaredAuthor(p.dir);
      lines.push(`  ${p.name}@${p.version}  —  ${p.license}`);
      lines.push(holder === '' ? '  （author の宣言が無い）' : `  ${holder}`, '');
    }
    // 本文が無いのは今のところ MIT のみ。他のライセンスが出てきたら、その標準本文を
    // 足すまでここへ落とさない（識別子だけ載せて満たしたことにはできない）。
    const other = missing.filter((p) => p.license !== 'MIT');
    if (other.length > 0) {
      throw new Error(
        `本文を同梱せず MIT でもないパッケージがある。標準本文を用意すること: ${other
          .map((p) => `${p.name}@${p.version}（${p.license}）`)
          .join(', ')}`,
      );
    }
    lines.push('以下は MIT License の標準本文（上記各パッケージの著作権者に読み替えること）。', '');
    lines.push(MIT_TEXT, '');
  }
  // BOM を付けるのは text/plain に charset が付かない配信環境があるため。
  // 付けないとブラウザが既定の旧エンコーディングで解釈し、日本語が全て文字化けする
  // （vite preview で実測）。_headers で charset を足せるのは web 版だけで、
  // wrapper 版は独自プロトコル配信なので効かない。ファイル自身に持たせれば両方で直る。
  return `﻿${lines.join('\n').trimEnd()}\n`;
}

assertTesseractAssetsCovered();
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
