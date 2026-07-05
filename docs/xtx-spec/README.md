# .xtx スキーマ（国税庁公式 W3C XSD）

aoiko が `.xtx` 出力を生成するために参照する国税庁公式 XML スキーマ（W3C XSD）を格納する。
`scripts/build-xtx-schema.js` がこれらを解析し `src/tax-schema/2026/xtx-schema-*.generated.json` を生成する。

## 出処

- 配布元：国税庁 e-Tax「仕様公開資料」一覧 <https://www.e-tax.nta.go.jp/shiyo/shiyo3.htm>
- 元 CAB：`e-tax19.CAB`「XMLスキーマ」 <https://www.e-tax.nta.go.jp/shiyo/download/e-tax19.CAB>（約9.3MB、令和8年5月18日版）
- 展開：`7z x e-tax19.CAB` → `19XMLスキーマ/{shotoku,general}/`
- 取得日：2026-05-16（2026-05-20 に 5/18 更新版と対照済。本 dir 内の 7 ファイル（KOA020-023 / KOA210-011 / General / ITdefinition / ITreference / zeimusho / zeimoku）は byte 単位で一致、更新は不要）
- `KOA110-012.xsd`（白色申告用）は 2026-07-05 に同一 CAB から追加抽出。同じ CAB の再取得で SHA256 一致を確認済み

## なぜ XSD か（xlsx 構造設計書ではなく）

e-Tax `.xtx` は **2 段式 ID/IDREF モデル**：

- 定義側（IT部）：実値を持つ要素を `ID` 属性付きで列挙（`general/ITdefinition.xsd` の `ITtype`）
- 参照側（帳票個別部分）：様式 xsd（`shotoku/KOA020-023.xsd` 等）。各 leaf は
  `general/ITreference.xsd` の `*ref` 型で、`IDREF` 属性により定義側 ID を指す空要素

e-tax09 の xlsx「構造設計書」はこの 2 段式を人間向けに平坦化した派生物で、機械処理には
権威ある W3C XSD（本ディレクトリ）を単一ソースとする。

## 収録ファイル

| パス | 様式/役割 | 版 |
|---|---|---|
| `shotoku/KOA020-023.xsd` | 確定申告書（第一表〜第四表） | 23.0（令和8年分・2025-08-15） |
| `shotoku/KOA210-011.xsd` | 青色申告決算書（一般用） | 11.0（2023-09-27、現行適用） |
| `shotoku/KOA110-012.xsd` | 収支内訳書（一般用、白色申告用） | 12.0（2023-09-27、現行適用。KOA210 と同時改定） |
| `general/ITdefinition.xsd` | 定義側 IT部 カタログ | — |
| `general/ITreference.xsd` | 参照側 `*ref` 型（IDREF fixed） | — |
| `general/General.xsd` | 基底データ型（gen:） | — |
| `general/zeimusho.xsd` | 税務署コード（General 依存） | — |
| `general/zeimoku.xsd` | 税目コード（General 依存） | — |

ディレクトリ構成（`shotoku/` ＋ `general/`）は xsd 内の相対 `schemaLocation`
（`../general/...`）を保つため変更しないこと。

## SHA256

`scripts/build-xtx-schema.js` が起動時に主要ファイルを照合する。

```text
8de959bacc36112f0ae6972dadc809a9f793dd30da169af98f83ee5c91107d0d  shotoku/KOA020-023.xsd
806d4a5e3ee8e33ef82ec5904e12088e6c1f9e37ac0eedeb549facecadf60313  shotoku/KOA210-011.xsd
cab3142f8ef4e520951010d95220ea9ef32af9c1fba678c78c590e2b6e80da3f  shotoku/KOA110-012.xsd
b48b1afcacfc3623ad33bc0fc1c65ecf01ac9abf6587914bdde2aaaa60c30643  general/ITdefinition.xsd
09117f8c211ed60d1b86284da56593da55f1e0405c0bcd74d306ec2178e1c8d4  general/ITreference.xsd
```

## 著作権

国の機関が発する告示・通達等は **著作権法第 13 条** により著作物に該当しないため、
再配布に著作権法上の制限は無い。

## 更新方針

決算書（KOA210）は構造が安定しており毎年は改定されない。確定申告書（KOA020）は
年度版が増える。新版が出たら：

1. `e-tax19.CAB` を再取得し `7z x` で展開
2. 最新版 xsd（`KOA020-0NN.xsd` 等）を本ディレクトリへ更新（旧版は履歴で追跡）
3. 本 README の SHA256 と `scripts/build-xtx-schema.js` の `EXPECTED_SHA256` を更新
4. `npm run xtx:build-schema` で JSON 再生成、`npm run verify`