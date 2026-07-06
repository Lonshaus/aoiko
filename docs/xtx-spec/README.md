# .xtx スキーマ（国税庁公式 W3C XSD）

aoiko が `.xtx` 出力を生成するために参照する国税庁公式 XML スキーマ（W3C XSD）を格納する。
`scripts/build-xtx-schema.js` がこれらを解析し `src/tax-schema/2026/xtx-schema-*.generated.json` を生成する。

## 出処

- 配布元：国税庁 e-Tax「仕様公開資料」一覧 <https://www.e-tax.nta.go.jp/shiyo/shiyo3.htm>
- 元 CAB：`e-tax19.CAB`「XMLスキーマ」 <https://www.e-tax.nta.go.jp/shiyo/download/e-tax19.CAB>（約9.3MB、令和8年5月18日版）
- 展開：`7z x e-tax19.CAB` → `19XMLスキーマ/{shotoku,general}/`
- 取得日：2026-05-16（2026-05-20 に 5/18 更新版と対照済。本 dir 内の 7 ファイル（KOA020-023 / KOA210-011 / General / ITdefinition / ITreference / zeimusho / zeimoku）は byte 単位で一致、更新は不要）
- `KOA110-012.xsd`（白色申告用）は 2026-07-05 に同一 CAB から追加抽出。同じ CAB の再取得で SHA256 一致を確認済み
- `shohi/SHA020-009.xsd`・`shohi/SHB070-001.xsd`（消費税・2割特例用）、`shohi/SHB047-001.xsd`・`shohi/SHB067-001.xsd`（消費税・簡易課税用）、`shohi/SHA010-010.xsd`・`shohi/SHB017-002.xsd`・`shohi/SHB033-002.xsd`（消費税・一般課税用）は 2026-07-05 に同一 CAB から追加抽出

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
| `shohi/SHA020-009.xsd` | 消費税及び地方消費税の申告書（簡易課税用）。2割特例もこの様式構造を使う | 9.0（2023-06-26） |
| `shohi/SHB070-001.xsd` | 付表6（税額控除に係る経過措置＝2割特例用） | 1.0（2023-06-26） |
| `shohi/SHB047-001.xsd` | 付表4-3（税率別消費税額計算表兼地方消費税の課税標準となる消費税額計算表） | 1.0（2020-09-07） |
| `shohi/SHB067-001.xsd` | 付表5-3（控除対象仕入税額等の計算表） | 1.0（2020-09-07） |
| `shohi/SHA010-010.xsd` | 消費税及び地方消費税の申告書（一般用） | 10.0（2023-06-26） |
| `shohi/SHB017-002.xsd` | 付表1-3（税率別消費税額計算表兼地方消費税の課税標準となる消費税額計算表） | 2.0（2023-06-26） |
| `shohi/SHB033-002.xsd` | 付表2-3（課税売上割合・控除対象仕入税額等の計算表） | 2.0（2023-06-26） |
| `shohi/RSH0010-232.xsd` | 手続定義：消費税及び地方消費税申告(**一般**・個人)。CONTENTS が SHA010 系統のみ許可 | 23.2.0（2023-11-27） |
| `shohi/RSH0030-232.xsd` | 手続定義：消費税及び地方消費税申告(**簡易課税**・個人)。CONTENTS が SHA020 系統のみ許可 | 23.2.0（2023-11-27） |
| `general/ITdefinition.xsd` | 定義側 IT部 カタログ | — |
| `general/ITreference.xsd` | 参照側 `*ref` 型（IDREF fixed） | — |
| `general/General.xsd` | 基底データ型（gen:） | — |
| `general/zeimusho.xsd` | 税務署コード（General 依存） | — |
| `general/zeimoku.xsd` | 税目コード（General 依存） | — |

ディレクトリ構成（`shotoku/` ＋ `general/`）は xsd 内の相対 `schemaLocation`
（`../general/...`）を保つため変更しないこと。

上記に加え、`RSH0010-232.xsd`／`RSH0030-232.xsd` を xmllint で単体ロードできるよう、
これらが `xsd:include`/`xsd:import` する周辺様式（SHB013/015/025/030/043/045/055/065/
100/110、SHC025、SHE020/040/060/080/100、`general/CATALOG.xsd`、`general/XMLDSIG050.xsd`、
`somu/SOZ-001.xsd` とその依存一式）も `docs/xtx-spec/{shohi,general,somu}/` に置いている。
これらは aoiko が mapping を実装した様式ではなく、**schema のロードを通すためだけ**の
付随ファイル（`build-xtx-schema.js` の対象外、SHA256 追跡もしない）。

## SHA256

`scripts/build-xtx-schema.js` が起動時に主要ファイルを照合する。

```text
8de959bacc36112f0ae6972dadc809a9f793dd30da169af98f83ee5c91107d0d  shotoku/KOA020-023.xsd
806d4a5e3ee8e33ef82ec5904e12088e6c1f9e37ac0eedeb549facecadf60313  shotoku/KOA210-011.xsd
cab3142f8ef4e520951010d95220ea9ef32af9c1fba678c78c590e2b6e80da3f  shotoku/KOA110-012.xsd
977957b3407eb3b1ac0888ae86ac77cb1e2b1bf048ef0b272db98a45e8968d53  shohi/SHA020-009.xsd
25a603aa463d35803264ed2c55ad39a76146723fd6fa727b1a31a93bb6448fbc  shohi/SHB070-001.xsd
db0fb768bd9868a26d2b3ad8639c82c8c68b8a44b964fb845795f78f19719dbe  shohi/SHB047-001.xsd
43ccd8e2d01e22ca8c705b530aef4787a43752ab2ddcf14cac1075feb9bfe452  shohi/SHB067-001.xsd
1da04ae0ceaa9608967b0f3dbf6e882bcbfbd1975c48d3e65bc376ac83ca6465  shohi/SHA010-010.xsd
177ee78a92e30c2434cc862e39a8b7d6c0c456920c1cfca57347a974ff7509c5  shohi/SHB017-002.xsd
2205915de109a05b86525c27a2e43a131d4730fdf3961b672f8733c022b51713  shohi/SHB033-002.xsd
007ccdff1726206a82ac4d25954c1b5a864cca2f5eb54a927d78b5c471b160e2  shohi/RSH0010-232.xsd
6bb6289f54cc8b3976a59ec92d63acd8595d43db266f57f53a4e8ca4bf876397  shohi/RSH0030-232.xsd
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

### 消費税：対応状況

- **2割特例**（`SHA020` ＋ 付表6）・**簡易課税（単一事業区分のみ）**（`SHA020` ＋ 付表4-3 ＋ 付表5-3）・**一般課税（本則）**（`SHA010` ＋ 付表1-3 ＋ 付表2-3）：対応済み。`src/tax-schema/2026/xtx-mapping-sha020.ts` の `mapTwoWari()`/`mapSimplified()`、`xtx-mapping-sha010.ts` の `mapGeneral()`
- **一般課税・課税売上割合95%未満／課税売上高5億円超の場合の按分控除**（個別対応方式・一括比例配分方式）：対応済み（設定 → 消費税で選択）。免税売上（輸出）・非課税売上・課税貨物に係る消費税額（輸入消費税）・特定課税仕入れ（リバースチャージ）も `TaxCategory`/`InputUsageCategory` として記帳側で分類可能。`src/domain/consumption-tax.ts` の `computeTaxableSalesRatio()`/`isFullDeductionEligible()`、付表2-3 の DTB/DTC/DTD/DTE/DTG 各欄に反映
- **貸倒れに係る消費税額の調整・貸倒回収**（消費税法39条）：対応済み。本則・簡易課税・2割特例・3割特例のすべてに適用。記帳側は分錄の `TaxCategory` に `badDebt`/`badDebtRecovery` を指定（その行の既存 `taxRate`/`taxIncluded` から税額を逆算）。`src/domain/consumption-tax.ts` の `badDebtTotals()`、一般課税は SHA010 の AAJ00030/AAJ00070 ＋ 付表1-3 の DSE/DSF ＋ 付表2-3 の DTJ、簡易課税は付表4-3 の DUE/DUF ＋ 付表5-3 の DVB（基準消費税額に貸倒回収を算入）、2割特例は付表6 の AYB/AYD に反映
- **簡易課税で複数事業区分を営む場合の按分計算**（75%ルール等、付表5-3 二面）：未対応。aoiko の設定は単一の事業区分のみを持つ前提
- **3割特例**：令和8年度税制改正の新設制度。**現行 CAB（2026-05-18版）の消費税フォルダには対応欄が一切無い**（`SHA010`・`SHA020` とも）。SHA010 自体が次版（v11、令和8年10月公開予定）で改定される見込みのため、それを待って再調査すること
- 2割特例・簡易課税・一般課税とも「売上対価の返還等に係る税額」欄を意図的に省略している（課税標準額へネット計上済みのため、最終税額は正しいが内訳非表示）。詳細は各 `xtx-mapping-*.ts` 冒頭コメント参照

### 消費税 .xtx：実機組み込みで発覚した手続レベルの不具合（2026-07-05・修正済み）

xmllint による様式単体の検証（`xtx-validate-consumption-tax.test.ts`）は通っていたが、
実際に e-Taxソフト(ダウンロード版) へ組み込んだところ「不明な要素 'SHA020'」等、
SHA020 配下の全要素が unknown 扱いになるエラーで失敗した。原因は 2 点、いずれも
**手続（procedure）レベルの封包構造**の誤りで、様式個別の mapping には問題なかった：

1. **procedure_CD の取り違え**：2割特例・簡易課税は手続 `RSH0010`（消費税及び地方消費税
   申告・**一般**・個人）ではなく `RSH0030`（同・**簡易課税**・個人）を使う必要がある。
   `RSH0010-232.xsd` の CONTENTS 型を実際に読むと、xsd:group で許可される様式が
   `SHA010`・付表1-3/2-3 等の**一般課税系統のみ**で、`SHA020` 系統は一切許可されて
   いない（`RSH0030-232.xsd` の方が `SHA020`・付表4-3/5-3/6 を許可する）。
   一般課税（`SHA010`）は元々 RSH0010 のままで正しい。
2. **SOFUSHO（送信票）を含めていた**：所得税 RKO0010 の封包構造をそのまま流用して
   `<SOFUSHO fid="TEA060" .../>` を CONTENTS に含めていたが、RSH0010/RSH0030 いずれの
   CONTENTS 型にも SOFUSHO は定義されていない（許可される子要素ではない）。

いずれも `xtx-document.ts` の `buildXtxBundle()` に `includeSofusho` オプションを追加し
（既定 true＝所得税は従来どおり、消費税は false）、`xtx-consumption-tax.ts` で procedure
ごとに正しい procedureTag（RSH0010/RSH0030）を渡すよう修正して解決した。

**教訓**：様式単体の xmllint 検証だけでは、手続の CONTENTS 型がその様式を許可している
かどうか、手続がどの要素を必須/禁止としているかは検証できない。`RSH0010-232.xsd`／
`RSH0030-232.xsd` を直接読んで CONTENTS の `xsd:sequence`/`xsd:group ref` を確認した上で、
組み立てた完全な `.xtx`（procedure 込み）をその procedure の xsd に対して xmllint 検証する
（`xtx-validate-consumption-tax-envelope.test.ts`）ことで、この種の不具合を機械的に検出
できるようにした。新しい手続を追加する時は、様式単体の検証に加えて必ずこの封包全体の
検証も書くこと。

### schema 生成の注意（simpleContent 型の誤判定に注意）

`scripts/build-xtx-schema.js` の型判定は、`xsd:complexType` を参照する要素を無条件に
`kind: 'branch'` として扱っていたため、`simpleContent`（例：`AutoCalc` 属性付き decimal/
string、KOA110 の耐用年数 `AIM00090`・付表2-3 の課税売上割合 `DTD00000` 等）を持つ型が
「子の無い branch」として値を握り潰す不具合があった（2026-07-05 発見・修正）。
`isSimpleContentType()` で `xsd:simpleContent` の有無を判定し、該当すれば `kind: 'leaf'`
として扱うよう修正済み。新しい様式を追加する際、appinfo はあるのに値が出力されない
フィールドがあれば、まずこのパターン（simpleContent 型）を疑うこと。