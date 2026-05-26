# 隱私政策

**Language**: [日本語](PRIVACY.md) | [English](PRIVACY_en.md) | **繁體中文**

aoiko 是**沒有後端伺服器**的純前端 App。原則上利用者資料**不會離開本機**。本文件明列哪些資料會被收集・送出。

## 收集的資訊：無

開發者・發布者從利用者那裡**完全不收集**以下任何項目：

- 個人識別資訊（姓名・住址・電話・電子郵件）
- 帳簿資料、傳票、交易紀錄
- API 金鑰、認證資訊
- 裝置資訊、IP 位址
- 使用狀況分析（telemetry・analytics）
- cookie、本地儲存的追蹤器

Hosting 提供商（公開時預定 GitHub Pages / Vercel / Cloudflare Pages 等）的 **HTTP access log** 可能依各家政策保留。aoiko 這邊無法控制這部分。

## 存在本機的資料

以下會存到瀏覽器的 **IndexedDB**（資料庫 `aoiko`）：

| 資料 | 存放位置 | 送出目的地 |
|---|---|---|
| 傳票、明細、交易對象、輔助科目 | IndexedDB | 不送 |
| 固定資產、家事分攤規則 | IndexedDB | 不送 |
| 申告済 snapshot | IndexedDB | 不送 |
| Gemini API 金鑰 | IndexedDB | 只在利用者啟動 LLM/OCR 機能時送到 Gemini API |
| OpenAI 相容 API 金鑰・baseURL | IndexedDB | 只在利用者啟動 LLM/OCR 機能時送到利用者指定的 baseURL（指定 localhost 時不離開本機）|
| 事業者資訊（商號、發票登錄號碼）| IndexedDB | 不送 |
| 備份資料夾的 handle | IndexedDB | 不送 |
| 匯入紀錄（檔案 hash）| IndexedDB | 不送 |

全部只存在利用者的本機。**瀏覽器站點資料清除會完全消失**。

## 會送出本機的資料

### OCR / LLM 引擎（利用者選用・BYOK・設定中選擇）

只在利用者**明確啟動** LLM 分類・收據 OCR 時，內容才會送到選中的引擎：

- **vision LLM 路（Gemini / OpenAI 相容）**：LLM 分類＝CSV 行文字（金額・摘要等）＋ 勘定科目一覽／OCR＝收據圖片（Base64）＋ 抽取指示 prompt
- **Tesseract 路（OCR 限定）**：不用 LLM。圖片在 WASM 內本機處理、不外送。只有 `jpn.traineddata` / `eng.traineddata` 首次從 CDN 取（圖片不送）

| 引擎（設定中選擇） | 送出目的地 | 是否離開本機 |
|---|---|---|
| Google Gemini（預設） | `generativelanguage.googleapis.com` | 是（雲端） |
| OpenAI 相容 / Ollama 等：指定 localhost 時 | 本機內（例 `http://localhost:11434`） | **否** |
| OpenAI 相容 / Ollama 等：指定遠端時 | 利用者指定的 host | 是 |
| Tesseract（純本地 WASM OCR） | 圖片不離開本機。只有 `jpn.traineddata` / `eng.traineddata` 首次從 CDN 取（自架可做到完全離線）| **圖片不送**（只 DL traineddata）|

- 送出是利用者瀏覽器**直接**進行，不經由 aoiko 的管理伺服器（不存在）
- **外部（雲端）送出引擎使用時送出前會跳確認對話框**
- Gemini：送出內容依 Google 隱私政策與利用者 API 方案合約處理，是否用於訓練看合約形態（免費 vs 付費）
- 本地（Ollama 等以 localhost）使用時資料不離開本機、隱私保護最強（OCR 必須 vision 對應模型）
- Tesseract：不用 LLM，從 WASM OCR 文字以確定性規則抽取（只 T+13 位登錄番号・日期・合計）。精度有限、店名與品項不推測。利用者務必人工確認

### 備份（利用者選擇）

| 方法 | 送出目的地 |
|---|---|
| File System Access API（Chromium） | 利用者選的**本機**資料夾 |
| OPFS（Safari / Firefox） | 瀏覽器管理的**本機**儲存 |
| 手動 JSON 下載 | 利用者的「下載」資料夾 |
| Google Drive 同步（未來實裝） | 利用者的 Google Drive |

aoiko 這邊的伺服器**完全不**收任何東西。

## cookie・追蹤

- aoiko 自身不用 cookie
- 沒有第三方廣告・分析 tag
- referer 送出依瀏覽器預設行為

## 法令對應

- 預定日本國內使用。**個人情報保護法**的「個人情報取扱事業者」要件因 aoiko 開發者・發布者不收集利用者個人資訊、視為不適用。
- 利用者自身透過 aoiko 處理的第三方個人資訊（交易對象名・收據上顧客名等）管理責任在利用者身上。
- 不預期 EU 圈使用，但 GDPR 觀點下因不收集資料、data controller 該當性也低。

## 變更歷史

本政策可能無預告變更。重要變更可在 GitHub commit log 確認。