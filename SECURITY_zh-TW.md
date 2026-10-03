# 安全政策

**Language**: [日本語](SECURITY.md) | [English](SECURITY_en.md) | **繁體中文**
<!-- only:browser -->

aoiko 是純前端 BYOK（Bring Your Own Key）App。沒有 aoiko 自己的伺服器，帳簿資料留在使用者的裝置上。使用者明確啟動生成式 AI 分類・OCR・訂單匯入時，以及在設定畫面按「取得模型清單」（Gemini 會同時儲存 API 金鑰）或「連線測試」時，內容與 API 金鑰都會送到所選的引擎（選擇在裝置內完成的引擎時根本不會送出）。本文件整理已知風險・支援方針・漏洞回報流程。
<!-- /only -->
<!-- only:apple -->

aoiko 是純前端 BYOK（Bring Your Own Key）App。沒有 aoiko 自己的伺服器，帳簿資料留在使用者的裝置上。使用者明確啟動生成式 AI 分類・OCR・訂單匯入時，以及在設定畫面按「取得模型清單」（Gemini 會同時儲存 API 金鑰）或「連線測試」時，內容與 API 金鑰都會送到所選的引擎（選擇在裝置內完成的引擎時根本不會送出）。本文件整理已知風險・支援方針・漏洞回報流程。
<!-- /only -->
<!-- only:windows -->

aoiko 是純前端 BYOK（Bring Your Own Key）App。沒有 aoiko 自己的伺服器，帳簿資料留在使用者的裝置上。使用者明確啟動生成式 AI 分類・OCR・訂單匯入時，以及在設定畫面按「取得模型清單」（Gemini 會同時儲存 API 金鑰）或「連線測試」時，內容與 API 金鑰都會送到所選的引擎（選擇在裝置內完成的引擎時根本不會送出）。本文件整理已知風險・支援方針・漏洞回報流程。
<!-- /only -->
<!-- only:android -->

aoiko 是純前端 BYOK（Bring Your Own Key）App。沒有 aoiko 自己的伺服器，帳簿資料留在使用者的裝置上。使用者明確啟動生成式 AI 分類・OCR・訂單匯入時，以及在設定畫面按「取得模型清單」（Gemini 會同時儲存 API 金鑰）或「連線測試」時，內容與 API 金鑰都會送到所選的引擎（選擇 Tesseract 時不會送出。選擇裝置內的文字辨識時不會送出圖片和文字，但使用狀況會送給 Google）。本文件整理已知風險・支援方針・漏洞回報流程。
<!-- /only -->

## 正規發布來源

aoiko 只透過以下管道正式發布：

- 線上版：<https://aoiko.pages.dev>
<!-- only:apple -->
- App Store（macOS 版・iOS 版）
<!-- /only -->
<!-- only:windows -->
- Microsoft Store（Windows 版）
<!-- /only -->
<!-- only:android -->
- Google Play（Android 版）
<!-- /only -->
<!-- only:browser -->

如果你是從其他地方（來路不明的網站、執行檔等）拿到的，**在輸入 API 金鑰或任何敏感資訊之前，請務必回到上述線上版核對內容**。
<!-- /only -->
<!-- only:native -->

如果你是從商店以外的地方拿到的，**在輸入 API 金鑰或任何敏感資訊之前，請務必回到上述任一管道核對內容**。
<!-- /only -->

請留意有人冒用 aoiko 的名稱，偽裝散布釣魚或惡意程式。有疑慮時，可以到上面列出的正規發布來源核對真偽。

## 支援版本
<!-- only:browser -->

支援對象是 <https://aoiko.pages.dev> 目前公開的版本。
<!-- /only -->
<!-- only:native -->
支援對象是各商店上架的最新發布版。若以舊版回報，可能會請你確認在最新版是否仍然重現。
<!-- /only -->

## 漏洞回報

機密性的漏洞回報請用 **GitHub Security Advisories**：

1. repo 的 **Security** 分頁 → **Report a vulnerability**
2. 寫影響範圍・重現步驟・預期影響
3. 不要在 public issue 回報

公開狀態的問題（例如錯誤的會計科目、UI 錯誤）用一般 issue 回報即可。

回應時間以 7 日內為目標，但因為是志工性質，無法保證。

## 設計上的安全前提

### BYOK 模式
<!-- only:browser -->

- 使用者選的 OCR/AI 引擎（Google Gemini API ／ OpenAI 相容 ／ Tesseract ／ 瀏覽器內建的 AI）的 API 金鑰・端點設定**由使用者自己登錄・存在自己的瀏覽器 IndexedDB**（Tesseract 與瀏覽器內建的 AI 不需要 API 金鑰也不需要設定）
<!-- /only -->
<!-- only:apple -->
- 使用者選的 OCR/AI 引擎（Google Gemini API ／ OpenAI 相容 ／ Tesseract ／ 作業系統內建的文字辨識 ／ Apple Intelligence）的 API 金鑰・端點設定**由使用者自己登錄・存在 App 的管理區域**（Tesseract、作業系統內建的文字辨識與 Apple Intelligence 不需要 API 金鑰也不需要設定）
<!-- /only -->
<!-- only:windows -->
- 使用者選的 OCR/AI 引擎（Google Gemini API ／ OpenAI 相容 ／ Tesseract ／ 作業系統內建的文字辨識）的 API 金鑰・端點設定**由使用者自己登錄・存在 App 的管理區域**（Tesseract 與作業系統內建的文字辨識不需要 API 金鑰也不需要設定）
<!-- /only -->
<!-- only:android -->
- 使用者選的 OCR/AI 引擎（Google Gemini API ／ OpenAI 相容 ／ Tesseract ／ 裝置內的文字辨識）的 API 金鑰・endpoint 設定**由使用者自己登錄・存在 App 的管理區域**（Tesseract 與裝置內的文字辨識不需要 API 金鑰也不需要設定）
<!-- /only -->
- 開發者・發布者**不取得・轉發・儲存**使用者的 API 金鑰・端點資訊
<!-- only:browser -->
- 使用外部 API 時的請求，**從使用者瀏覽器直接送到選中的端點**（不經 proxy）。選擇在本機辨識的引擎時，根本不會送出 AI API 請求
<!-- /only -->
<!-- only:apple -->
- 使用外部 API 時的請求，**由 App 直接送到選中的端點**（沒有 aoiko 的中繼伺服器）。選擇在本機辨識的引擎時，根本不會送出 AI API 請求
<!-- /only -->
<!-- only:windows -->
- 使用外部 API 時的請求，**由 App 直接送到選中的端點**（沒有 aoiko 的中繼伺服器）。選擇在本機辨識的引擎時，根本不會送出 AI API 請求
<!-- /only -->
<!-- only:android -->
- 外部 API 使用時的 request **由 App 直接送到選中的 endpoint**（沒有 aoiko 的中繼伺服器）。選在本機辨識的引擎時，AI API（Gemini・OpenAI 相容）不會送出。不過使用裝置內的文字辨識時，負責辨識的 ML Kit 會把使用狀況送給 Google（不含圖片與文字內容）
<!-- /only -->

### 儲存

- 帳簿資料、API 金鑰、設定全都存在 **IndexedDB（本機）**
<!-- only:browser -->
- 備份：同步資料夾（File System Access API・支援的瀏覽器）／ OPFS（不支援的瀏覽器的備援）／ 手動匯出
<!-- /only -->
<!-- only:native -->
- 備份：同步資料夾（App 會記住一個）／ 手動匯出
<!-- /only -->
- **完全不會送到 aoiko 的管理伺服器**（aoiko 沒有管理伺服器）。使用 AI/OCR API 時，只會送到使用者設定的外部端點（Gemini / OpenAI 相容等）

## 已知風險

### 1. 沒有伺服器端稽核紀錄

- **沒有任何手段可以偵測**非法存取・資料外洩
- 本機被入侵＝資料外洩

### 2. 裝置內儲存洩漏
<!-- only:browser -->

- 同台機器其他使用者、惡意軟體、瀏覽器擴充功能可能讀到 IndexedDB
<!-- /only -->
<!-- only:native -->

- 同台機器其他使用者、惡意軟體可能讀到 App 的儲存區域
<!-- /only -->
- 個人資訊・交易紀錄・API 金鑰會被原樣讀走
- 建議使用業務專用機、開啟磁碟加密
- 開啟「備份時包含 API 金鑰」時，API 金鑰會以明文寫進備份檔；開啟「納入申報者資訊（利用者識別號碼・姓名・地址・稅務署）」時也一樣。備份的儲存位置若在同步資料夾內，這些資料也會原樣送到同步服務

### 3. AI API 送出內容的風險

- CSV 匯入中未分類的列（摘要・金額）・收據照片・訂單匯入時貼上的完整文字（可能含收件人姓名・地址・電話）依使用者選的引擎送到以下處：
  - **Gemini** → `generativelanguage.googleapis.com`（依 Google 的資料處理方針，是否用於訓練要看合約而定）
  - **OpenAI 相容**（Ollama 等）→ 使用者指定的 baseURL。localhost 時不離開本機
<!-- only:browser -->
  - **Tesseract** → 不送（WASM 在本機處理。程式與語言資料在第一次使用時從 aoiko 的發布來源取得並儲存，除此之外不會有連線）
<!-- /only -->
<!-- only:native -->
  - **Tesseract** → 不送（WASM 在本機處理。語言資料內建在 App 中，不會有任何連線）
<!-- /only -->
<!-- only:browser -->
  - **瀏覽器內建的 AI** → aoiko 這邊不會送出（推論在哪裡執行，取決於瀏覽器的實作，不一定在本機）
<!-- /only -->
<!-- only:apple -->
  - **作業系統內建的文字辨識** → 不送（全程在本機處理）
<!-- /only -->
<!-- only:windows -->
  - **作業系統內建的文字辨識** → 不送（全程在本機處理）
<!-- /only -->
<!-- only:android -->
  - **裝置內的文字辨識** → 圖片與文字都不送（在本機處理；負責辨識的 ML Kit 會把使用狀況送給 Google）
<!-- /only -->
<!-- only:apple -->
  - **Apple Intelligence** → 不送（推論全程在本機完成）
<!-- /only -->
- 收據照片只有在長邊超過 2048px 時才會先縮小並轉成 JPEG 再送出（轉換後沒有變小時除外）；其餘照片以原檔送出，若含拍攝日期時間・位置等 Exif 資訊，也會一併送到送出對象
- Gemini 的 API 金鑰依 Google API 的規格，以 URL 查詢參數送出。連線雖以 HTTPS 加密，但若職場網路或安全軟體會檢查 HTTPS 內容，整個網址（含 API 金鑰）可能會在那裡被記錄
- 機密度高的資料送出前請確認（使用外部引擎時，送出前會跳出確認對話框；跳過確認的設定只有一個，會套用到三項功能，以及之後更換的引擎・送出對象，還原備份時也會一併帶入）
- 生成式 AI 分類・OCR・訂單匯入，以及設定畫面的「取得模型清單」（Gemini 會同時儲存 API 金鑰）・「連線測試」，都是**由使用者操作觸發**（UI 按鈕）才會送出，不會自動送出（OpenAI 相容的「儲存」不會送出）
<!-- only:browser -->

### 4. PWA 快取

- 如果 Service Worker 的快取裡還留著舊版 build，錯誤修正版送達的時間可能會延後
<!-- /only -->

## 強化建議

- 開啟磁碟加密
<!-- only:browser -->
- 業務用與私用請分開使用不同的瀏覽器設定檔
- 不安裝可疑的瀏覽器擴充功能
<!-- /only -->
- 定期備份
- 不再需要的 API 金鑰請**務必到發行端（Google、OpenAI 相容服務等）讓它失效**

## 相依函式庫的漏洞

- 高嚴重度 CVE 會盡快反映，但無法保證