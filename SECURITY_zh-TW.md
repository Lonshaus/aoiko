# 安全政策

**Language**: [日本語](SECURITY.md) | [English](SECURITY_en.md) | **繁體中文**

aoiko 是純前端 BYOK（Bring Your Own Key）App。沒有 aoiko 自己的伺服器，帳簿資料留在使用者的裝置上。只有在使用者明確啟動生成式 AI 分類・OCR 時，內容才會送到所選的引擎（選擇在裝置內完成的引擎時連送出都不會發生）。本文件整理已知風險・支援方針・漏洞回報手順。

## 正規發布來源

aoiko 只透過以下管道正式發布：

- 原始碼：<https://github.com/Lonshaus/aoiko>
- 線上試用版：<https://aoiko.pages.dev>
<!-- only:apple -->
- App Store（macOS 版・iOS 版）
<!-- /only -->
<!-- only:windows -->
- Microsoft Store（Windows 版）
<!-- /only -->
<!-- only:browser -->

如果你是從其他地方（不熟悉的網站、包裝過的執行檔等）拿到的，**在輸入 API 金鑰或任何機微資訊之前，請務必回來上述其中一個管道核對內容**。
<!-- /only -->
<!-- only:native -->

如果你是從商店以外的地方拿到的，**在輸入 API 金鑰或任何機微資訊之前，請務必回到上述任一管道核對內容**。
<!-- /only -->

aoiko 是用 AGPL-3.0 發布，任何人都可以合法 fork，但這不代表可以排除有人拿這個名字去偽裝散布釣魚或惡意程式。有疑慮時，可以去 GitHub repo 的 commit 歷史、issue 核對真偽。

## 支援版本

<!-- only:browser -->
支援對象是反映 `master` branch 最新 commit 的公開版（<https://aoiko.pages.dev>）。
<!-- /only -->
<!-- only:native -->
支援對象是各商店上架的最新發布版。若以舊版回報，可能會請你確認在最新版是否仍然重現。
<!-- /only -->

## 漏洞回報

機密性的漏洞回報請用 **GitHub Security Advisories**：

1. repo 的 **Security** tab → **Report a vulnerability**
2. 寫影響範圍・重現手順・預期影響
3. 不要在 public issue 回報

公開狀態的問題（例如錯誤的勘定科目、UI bug）走一般 issue 即可。

回應時間目標 7 日內，但志工性質、無法保證。

## 設計上的安全前提

### BYOK 模式

<!-- only:browser -->
- 使用者選的 OCR/AI 引擎（Google Gemini API ／ OpenAI 相容 ／ Tesseract ／ 瀏覽器內建的 AI）的 API 金鑰・endpoint 設定**由使用者自己登錄・存在自己的瀏覽器 IndexedDB**（Tesseract 與瀏覽器內建的 AI 不需要金鑰也不需要設定）
<!-- /only -->
<!-- only:apple -->
- 使用者選的 OCR/AI 引擎（Google Gemini API ／ OpenAI 相容 ／ Tesseract ／ 作業系統內建的文字辨識 ／ Apple Intelligence）的 API 金鑰・endpoint 設定**由使用者自己登錄・存在 App 的管理區域**（Tesseract、作業系統內建的文字辨識與 Apple Intelligence 不需要金鑰也不需要設定）
<!-- /only -->
<!-- only:windows -->
- 使用者選的 OCR/AI 引擎（Google Gemini API ／ OpenAI 相容 ／ Tesseract ／ 作業系統內建的文字辨識）的 API 金鑰・endpoint 設定**由使用者自己登錄・存在 App 的管理區域**（Tesseract 與作業系統內建的文字辨識不需要金鑰也不需要設定）
<!-- /only -->
- 開發者・發布者**不取得・轉發・保存**使用者的 API 金鑰・endpoint 資訊
<!-- only:browser -->
- 外部 API 使用時的 request **從使用者瀏覽器直接送到選中的 endpoint**（不經 proxy）。選在本機辨識的引擎時根本不會發生 AI API 送出
<!-- /only -->
<!-- only:native -->
- 外部 API 使用時的 request **由 App 直接送到選中的 endpoint**（沒有 aoiko 的中繼伺服器）。選在本機辨識的引擎時根本不會發生 AI API 送出
<!-- /only -->

### 儲存

- 帳簿資料、API 金鑰、設定全都存在 **IndexedDB（本機）**
<!-- only:browser -->
- 備份：同步資料夾（File System Access API・支援的瀏覽器）／ OPFS（不支援的瀏覽器的後備）／ 手動匯出
<!-- /only -->
<!-- only:native -->
- 備份：同步資料夾（App 會記住一個）／ 手動匯出
<!-- /only -->
- **完全沒有送到 aoiko 管理伺服器**（aoiko 沒有管理伺服器）。AI/OCR API 使用時只送到使用者設定的外部 endpoint（Gemini / OpenAI 相容等）

## 已知風險

### 1. 沒有伺服器端 audit log

- **沒有偵測**非法存取・資料外洩的手段
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

### 3. AI API 送出內容的風險

- CSV 各列・收據圖片依使用者選的引擎送到以下處：
  - **Gemini** → `generativelanguage.googleapis.com`（依 Google 資料處理方針，學習利用與否看合約）
  - **OpenAI 相容**（Ollama 等）→ 使用者指定的 baseURL。localhost 時不離開本機
  - **Tesseract** → 不送（WASM 在本機處理。語言資料也是同梱，不會產生對外通訊）
<!-- only:browser -->
  - **瀏覽器內建的 AI** → aoiko 這邊不送（推論在哪裡跑由瀏覽器的實作決定，不一定在本機）
<!-- /only -->
<!-- only:native -->
  - **作業系統內建的文字辨識** → 不送（全程在本機處理）
<!-- /only -->
<!-- only:apple -->
  - **Apple Intelligence** → 不送（推論全程在本機完成）
<!-- /only -->
- 機密度高的資料送出前請確認（外部引擎使用時送出前會跳確認對話框）
- AI/OCR 功能是 **opt-in（UI 按鈕觸發）**，不自動送出

<!-- only:browser -->
### 4. PWA 快取

- 舊版 build 可能被 Service Worker 快取
- bug 修正版的傳播會有時間差
<!-- /only -->

## 強化建議

- 啟用磁碟加密
<!-- only:browser -->
- 業務用與私用分開不同瀏覽器 profile
- 不安裝可疑的瀏覽器擴充功能
<!-- /only -->
- 定期備份
- 不再需要的 API 金鑰請**務必到 Google 那邊失效**

## 相依函式庫的漏洞

- 計畫在 CI 跑 `npm audit`（未實裝）
- 高嚴重度 CVE 會盡快反映，但無法保證