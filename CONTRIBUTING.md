# 貢献ガイド

aoiko への貢献を歓迎します。主に求めているのは **CSV パーサーの追加** です。
ご自身がお使いの銀行・カード・電子マネーに対応するパーサーを書いてください。

## 開発環境

- Node 22 LTS（`.nvmrc` を見て fnm / nvm で揃えるのが楽）
- 任意の OS（macOS / Linux / Windows）
- 任意の Chromium ベースのブラウザ（Chrome / Edge / Brave 等）

```bash
git clone <your-fork>
cd aoiko
npm install
npm run dev    # http://localhost:10708
```

## 提交前のチェック

```bash
npm run verify   # typecheck + tests + build を順に実行
```

これが全部緑であれば PR を投げて OK です。

---

## CSV パーサーを追加する

### A. TypeScript で書く（推奨、柔軟）

1. **テンプレートをコピー**

   フラット配置（既存の大半の parser）：
   ```bash
   cp src/parsers/_template.example.ts src/parsers/<bank-name>.ts
   cp src/parsers/_template.example.test.ts src/parsers/<bank-name>.test.ts
   cp src/parsers/fixtures/_template.example-sample.csv \
      src/parsers/fixtures/<bank-name>-sample.csv
   ```

   フォルダ配置（`.ts`・テスト・fixture を1フォルダに完結させたい場合。`src/parsers/aupay-card/` が実例）：
   ```bash
   mkdir src/parsers/<bank-name>
   cp src/parsers/_template.example.ts      src/parsers/<bank-name>/<bank-name>.ts
   cp src/parsers/_template.example.test.ts src/parsers/<bank-name>/<bank-name>.test.ts
   cp src/parsers/fixtures/_template.example-sample.csv \
      src/parsers/<bank-name>/<bank-name>-sample.csv
   ```
   フォルダ配置の場合、test 内の fixture import は同じフォルダの相対パス（`./<bank-name>-sample.csv?raw`）にする。
   `index.ts` の auto-discovery は再帰的なので、どちらの配置でも `index.ts` を編集する必要は無い。
   `_` で始まるファイル・フォルダ（`_template.example` 等）は除外される。

2. **値を編集**
   - `name`: URL-safe 文字列、他のパーサーと重複しないもの（例：`my-bank`）
   - `displayName`: UI に表示される正式名（例：`マイ銀行`）
   - `accountCode`: 既知側の勘定科目コード
     - `1110` 現金
     - `1130` 普通預金
     - `2120` 未払金（クレジットカード）
     - その他は `src/tax-schema/2026/accounts.ts` を参照
   - `encoding`: `'utf-8'` または `'shift_jis'`
   - `REQUIRED` の配列：CSV ヘッダーで必須の列名
   - `parse` 関数の中身：実際の解析ロジック

3. **fixture CSV を作る**
   - **匿名化**：実際の金額、店名、口座番号は虚構の値に置き換える
   - 数行で OK（例：入金 1 件 + 出金 2 件 + 任意項目あり 1 件）
   - 実際の銀行 CSV のエンコーディング・改行コードと一致させる

4. **テストを書く**
   - 最低 3 つ：`metadata`、`parses sample fixture`、`throws on missing required column`
   - エッジケースがあれば追加（千分位カンマ、CRLF、BOM 等）

5. **動作確認**
   ```bash
   npm run test           # 自分の parser テスト含めて全部通る
   npm run dev            # /import で UI から実 CSV をテスト
   ```

6. **PR**
   - タイトル例：`feat(parser): add my-bank parser`
   - 説明に：対応している銀行/カードの名前、フォーマットの参考情報

### B. JSON 設定で宣言的に書く（簡単、限定的）

実装が「ヘッダー列の対応関係 + 数値正規化」だけで済むなら JSON で十分。

例：

```typescript
import { defineParser } from './json-config';

const myBankParser = defineParser({
  name: 'my-bank',
  displayName: 'マイ銀行',
  accountCode: '1130',
  encoding: 'shift_jis',
  columns: {
    date: { header: '取引日' },
    description: { header: '内容' },
    withdrawal: { header: '出金額' },
    deposit: { header: '入金額' },
    balance: { header: '残高' },
  },
});

export default myBankParser;
```

サポートする 3 種のパターン：

| パターン | 例 | 設定キー |
|---------|------|--------|
| 銀行型（出金/入金で側決定） | 三菱UFJ、三井住友、SBI新生 | `withdrawal` + `deposit` |
| カード型（全行固定側） | 楽天カード、JCBカード、au PAY カード | `amount` + `side` |
| 符号付き型（金額符号で判定） | 単一の金額列に符号付き数値（+/-）で入出金が混在する形式 | `signedAmount` |

複雑な分岐（複数列マージ、特殊な日付フォーマット、ユーザー欄含む）は TypeScript で書いてください。

---

## fixture の匿名化指針

- **金額**：きりの良い数字に変更（実際の金額を避ける）
- **店名・取引先**：実在企業名はそのままでも fair use の範囲内だが、明らかに虚構と分かる名前推奨（`取引先A`、`サービスB`）
- **口座番号・カード番号**：絶対に残さない
- **個人情報**：氏名、住所、電話番号は削除または虚構値に
- **件数**：3-5 行で十分。網羅的な例を作る必要はない

---

## テストの方針

- **すべての parser に fixture スナップショットテストが必須**
- **エッジケース**（BOM、CRLF、千分位、空行、欠損列）も対象に
- **DB 関連の domain function** は `fake-indexeddb` で実 Dexie API を叩く（モック禁止）
- 詳細は `CLAUDE.md` の Testing Requirements を参照

## 質問・相談

issue を立てるか、PR の段階でメンテナーに `@` で呼んでください。実 CSV ファイルの匿名化が
難しい場合や、対応した方が良いか判断に迷う場合は気軽に相談を。