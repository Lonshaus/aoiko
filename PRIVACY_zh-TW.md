# 隱私政策

**Language**: [日本語](PRIVACY.md) | [English](PRIVACY_en.md) | **繁體中文**

aoiko 是**沒有後端伺服器**的純前端 App。原則上使用者資料**不會離開本機**。本文件明列哪些資料會被收集・送出。

## 收集的資訊：無

開發者・發布者從使用者那裡**完全不收集**以下任何項目：

- 個人識別資訊（姓名・住址・電話・電子郵件）
- 帳簿資料、傳票、交易紀錄
- API 金鑰、認證資訊
- 裝置資訊、IP 位址
- 使用狀況分析（telemetry・analytics）
- cookie、本地儲存的追蹤器

<!-- only:browser -->
提供 <https://aoiko.pages.dev> 的 hosting 的 **HTTP access log** 可能依該服務政策保留。aoiko 這邊無法控制這部分。
<!-- /only -->

## 存在本機的資料
<!-- only:browser -->

以下會存到瀏覽器的 **IndexedDB**（資料庫 `aoiko`）：
<!-- /only -->
<!-- only:native -->

以下會存到 App 的管理區域（資料庫 `aoiko`）：
<!-- /only -->

| 資料 | 存放位置 | 送出目的地 |
|---|---|---|
| 傳票、明細、交易對象、輔助科目 | IndexedDB | 不送 |
| 固定資產、家事分攤規則 | IndexedDB | 不送 |
| 已申報 snapshot | IndexedDB | 不送 |
| Gemini API 金鑰 | IndexedDB | 只在使用者啟動生成式 AI/OCR 功能時送到 Gemini API |
| OpenAI 相容 API 金鑰・baseURL | IndexedDB | 只在使用者啟動生成式 AI/OCR 功能時送到使用者指定的 baseURL（指定 localhost 時不離開本機）|
| 事業者資訊（商號、發票登錄號碼）| IndexedDB | 不送 |
| 備份資料夾的 handle | IndexedDB | 不送 |
| 匯入紀錄（檔案 hash）| IndexedDB | 不送 |
<!-- only:browser -->

全部只存在使用者的本機。**瀏覽器站點資料清除會完全消失**。
<!-- /only -->
<!-- only:native -->

全部只存在使用者的本機。**移除 App 或刪除 App 的資料會完全消失**。
<!-- /only -->

## 會送出本機的資料

### OCR / 生成式 AI 引擎（使用者選用・BYOK・設定中選擇）

只在使用者**明確啟動**生成式 AI 分類・收據 OCR 時，內容才會送到選中的引擎：

- **vision 生成式 AI 路徑（Gemini / OpenAI 相容）**：生成式 AI 分類＝CSV 各列的文字（金額・摘要等）＋ 勘定科目清單／OCR＝收據圖片（Base64）＋ 抽取指示的 prompt
- **Tesseract 路徑（OCR 限定）**：不用生成式 AI。圖片在 WASM 內本機處理、不外送。`jpn.traineddata` / `eng.traineddata` 也由 aoiko 自己提供，不會有對外連線
<!-- only:native -->
- **作業系統內建的文字辨識路徑（OCR 限定）**：不用生成式 AI。圖片由作業系統提供的文字辨識在本機處理、不外送。也不需額外下載任何資料
<!-- /only -->
<!-- only:apple -->
- **Apple Intelligence 路徑（生成式 AI 分類・OCR 共用）**：推論全程在裝置內完成，圖片與文字都不會外送。也不需額外下載任何資料
<!-- /only -->
<!-- only:browser -->
- **瀏覽器內建 AI 路徑（生成式 AI 分類・OCR 共用）**：aoiko 自己不會送出任何東西，但推論是在本機還是在外部服務進行，由瀏覽器的實作決定（API 規格允許用雲端實作，所以 aoiko 無法保證內容不離開本機）。這個引擎只有在瀏覽器已經持有 AI 模型時才能使用，模型的取得不是 aoiko 執行的
<!-- /only -->

| 引擎（設定中選擇） | 送出目的地 | 是否離開本機 |
|---|---|---|
| Google Gemini（預設） | `generativelanguage.googleapis.com` | 是（雲端） |
| OpenAI 相容 / Ollama 等：指定 localhost 時 | 本機內（例 `http://localhost:11434`） | **否** |
| OpenAI 相容 / Ollama 等：指定遠端時 | 使用者指定的 host | 是 |
| Tesseract（純本地 WASM OCR） | 圖片不離開本機。`jpn.traineddata` / `eng.traineddata` 也內附 | **無**（不會有對外連線）|
<!-- only:native -->
| 作業系統內建的文字辨識 | 圖片不離開本機 | **無**（不會有對外連線）|
<!-- /only -->
<!-- only:apple -->
| Apple Intelligence | 圖片與文字都不離開本機 | **無**（不會有對外連線）|
<!-- /only -->
<!-- only:browser -->
| 瀏覽器內建 AI | 由瀏覽器的實作決定（不一定在本機）。只有在使用者的瀏覽器已持有 AI 模型時才能使用（aoiko 不會取得該模型） | aoiko 這邊沒有。**瀏覽器會不會送到外部，aoiko 無法保證** |
<!-- /only -->

<!-- only:browser -->
- 送出是使用者瀏覽器**直接**進行，不經由 aoiko 的管理伺服器（不存在）
<!-- /only -->
<!-- only:native -->
- 送出是 App **直接**進行，不經由 aoiko 的管理伺服器（不存在）
<!-- /only -->
- **外部（雲端）送出引擎使用時送出前會跳確認對話框**
- Gemini：送出內容依 Google 隱私政策與使用者 API 方案合約處理，是否用於訓練看合約形態（免費 vs 付費）
- 本地（Ollama 等以 localhost）使用時資料不離開本機（OCR 必須 vision 對應模型）。在裝置內完成的引擎同樣不會產生送出
- Tesseract：不用生成式 AI，從 WASM OCR 文字以確定性規則抽取（只 T+13 位登錄號碼・日期・合計）。精度有限、店名與品項不推測。使用者務必人工確認
<!-- only:native -->
- 作業系統內建的文字辨識：不用生成式 AI，從作業系統辨識出的文字以確定性規則抽取（只 T+13 位登錄號碼・日期・合計）。店名與品項不推測。使用者務必人工確認
<!-- /only -->
<!-- only:apple -->
- Apple Intelligence：推論在裝置內完成，使用者的資料不會外送。只有在這台裝置支援 Apple Intelligence 時才會出現在選項中
<!-- /only -->
<!-- only:browser -->
- 瀏覽器內建 AI：aoiko 不會把使用者的資料送到任何地方，但推論是否在本機進行取決於瀏覽器的實作（規格允許用雲端實作）。這個引擎只有在使用者的瀏覽器已持有 AI 模型時才能使用，模型由瀏覽器何時、如何取得不在 aoiko 的管理範圍內
<!-- /only -->

### 備份（使用者選擇）

| 方法 | 送出目的地 |
|---|---|
<!-- only:browser -->
| 同步資料夾（File System Access API・支援的瀏覽器） | 使用者選的**本機**資料夾 |
| OPFS（不支援的瀏覽器的後備） | 瀏覽器管理的**本機**儲存 |
| 手動匯出 | 使用者的「下載」資料夾 |
<!-- /only -->
<!-- only:native -->
| 同步資料夾（App 會記住一個） | 使用者選的**本機**資料夾 |
| 手動匯出 | 使用者指定的儲存位置 |
<!-- /only -->

aoiko 這邊的伺服器**完全不**收任何東西。

## cookie・追蹤

- aoiko 自身不用 cookie
- 沒有第三方廣告・分析 tag
<!-- only:browser -->
- referer 送出依瀏覽器預設行為
<!-- /only -->

## 法令對應

- 預定日本國內使用。**個人情報保護法**的「個人情報取扱事業者」要件因 aoiko 開發者・發布者不收集使用者個人資訊、視為不適用。
- 使用者自身透過 aoiko 處理的第三方個人資訊（交易對象名・收據上顧客名等）管理責任在使用者身上。
- 並未預設在歐盟地區使用；就 GDPR 而言，因為不收集任何資料，構成資料控管者（data controller）的可能性也低。

## 變更歷史

本政策可能無預告變更。重要變更可在 GitHub commit log 確認。