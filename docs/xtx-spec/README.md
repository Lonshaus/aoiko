# .xtx 仕様書（令和 8 年分 / Ver23）

本ディレクトリには aoiko が `.xtx` 出力を生成するために参照する国税庁公式仕様書を格納する。

## 収録ファイル

| ファイル | 元名 | 役割 |
|---|---|---|
| `ver23-shotoku-shinkokusho.xml-design.xlsx`（リネーム後）→ `ver23-shotoku-shinkokusho.xlsx` | `XML構造設計書(所得税-申告)Ver23x.xlsx` | XML 要素ツリー仕様（タグ名・出現順・データ型・出現回数） |
| `ver23-shotoku-shinkokusho-fields.xlsx` | `帳票フィールド仕様書(所得税-申告)Ver23x.xlsx` | 各フィールドの帳票位置・桁数・補足説明 |

## 出処

- 配布元：国税庁 e-Tax「仕様公開資料 \> XML 関連」  
  <https://www.e-tax.nta.go.jp/shiyo/shiyo3.htm>
- 元 CAB：`e-tax09.CAB`（XML 構造設計書等【所得税】）  
  <https://www.e-tax.nta.go.jp/shiyo/download/e-tax09.CAB>
- 取得日：2026-05-14
- 様式 ID：`KOA020`（確定申告書第一表/第二表）
- 名前空間：`shotoku`
- バージョン：`23.0`（令和 8 年分・受付開始 2026-03-23）

## SHA256

ファイル改竄検知用。`scripts/build-xtx-schema.ts` が起動時に照合する。

```text
e3869b75f49e7999f59aeee241ba3d44bb65283ca62bdfdeca30aa58991e5b51  ver23-shotoku-shinkokusho.xlsx
a595e57edba83ef408fb6ffadb8ba71653cfbc176659cb1014bc4b821279bf34  ver23-shotoku-shinkokusho-fields.xlsx
```

## 著作権

国の機関が発する告示・通達等は **著作権法第 13 条** により著作物に該当しないため、再配布に著作権法上の制限は無い。

## 取得手順（手動再現用）

```bash
# 1. CAB を取得
curl -O https://www.e-tax.nta.go.jp/shiyo/download/e-tax09.CAB

# 2. 展開（macOS の場合）
brew install p7zip
7z x -obundle e-tax09.CAB

# 3. Ver23 ファイルをサイズで特定（CAB 内ファイル名は CP932 で macOS だと文字化け）
find bundle -name '*Ver23x.xlsx' -size 91732c   # XML 構造設計書
find bundle -name '*Ver23x.xlsx' -size 89193c   # 帳票フィールド仕様書
```

## 更新方針

毎年 9〜10 月頃に国税庁が翌年度版（Ver24, Ver25, ...）を公開する。新版が出たら：

1. 上記手順で新 CAB から最新 Ver の xlsx を取得
2. `docs/xtx-spec/verNN-*.xlsx` として保存（旧 Ver は履歴用に保持）
3. SHA256 を本 README に追記
4. `scripts/build-xtx-schema.ts` の参照 Ver を変更
5. `npm run xtx:build-schema` で JSON を再生成
6. `src/tax-schema/{年度}/` を新設（年度別 isolation）