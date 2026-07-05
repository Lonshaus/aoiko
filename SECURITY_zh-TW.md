# 安全政策

**Language**: [日本語](SECURITY.md) | [English](SECURITY_en.md) | **繁體中文**

aoiko 是純前端 BYOK（Bring Your Own Key）App。沒有後端伺服器、利用者的機微資料都閉合在瀏覽器內。本文件整理已知風險・支援方針・漏洞回報手順。

## 正規發布來源

aoiko 只透過以下管道正式發布：

- 原始碼：<https://github.com/Lonshaus/aoiko>
- 線上試用版：<https://aoiko.pages.dev>

如果你是從其他地方（不熟悉的網站、包裝過的執行檔等）拿到的,**在輸入 API 金鑰或任何機微資訊之前,請務必回來上述其中一個管道核對內容**。aoiko 是用 AGPL-3.0 發布,任何人都可以合法 fork、自己架設,但這不代表可以排除有人拿這個名字去偽裝散布釣魚或惡意程式。有疑慮時,可以去 GitHub repo 的 commit 歷史、issue 核對真偽。

## 支援版本

只支援 `master` branch 最新 commit。release tag 還沒運用（Phase 4 完成後預定開始）。

## 漏洞回報

機密性的漏洞回報請用 **GitHub Security Advisories**：

1. repo 的 **Security** tab → **Report a vulnerability**
2. 寫影響範圍・重現手順・預期影響
3. 不要在 public issue 回報

公開狀態的問題（例如錯誤的勘定科目、UI bug）走一般 issue 即可。

回應時間目標 7 日內，但志工性質、無法保證。

## 設計上的安全前提

### BYOK 模式

- 利用者選的 OCR/LLM 引擎（Google Gemini API ／ OpenAI 相容 ／ Tesseract）的 API 金鑰・endpoint 設定**由利用者自己登錄・存在自己的瀏覽器 IndexedDB**
- 開發者・發布者**不取得・轉發・保存**利用者的 API 金鑰・endpoint 資訊
- 外部 API 使用時的 request **從利用者瀏覽器直接送到選中的 endpoint**（不經 proxy）。選 Tesseract 時根本不會發生 LLM API 送出

### 儲存

- 帳簿資料、API 金鑰、設定全都存在 **IndexedDB（本機）**
- 備份：File System Access API（Chromium）／ OPFS（Safari、Firefox）／ 手動 JSON 下載
- **完全沒有送到 aoiko 管理伺服器**（aoiko 沒有管理伺服器）。LLM/OCR API 使用時只送到利用者設定的外部 endpoint（Gemini / OpenAI 相容等）

## 已知風險

### 1. 沒有伺服器端 audit log

- **沒有偵測**非法存取・資料外洩的手段
- 本機被入侵＝資料外洩

### 2. 瀏覽器儲存洩漏

- 同台機器其他使用者、惡意軟體、瀏覽器擴充功能可能讀到 IndexedDB
- 個人資訊・交易紀錄・API 金鑰會被原樣讀走
- 建議使用業務專用機、開啟磁碟加密

### 3. LLM API 送出內容的風險

- CSV 行・收據圖片依利用者選的引擎送到以下處：
  - **Gemini** → `generativelanguage.googleapis.com`（依 Google 資料處理方針，學習利用與否看合約）
  - **OpenAI 相容**（Ollama 等）→ 利用者指定的 baseURL。localhost 時不離開本機
  - **Tesseract** → 不送（WASM 在本機處理。只首次 DL traineddata）
- 機密度高的資料送出前請確認（外部引擎使用時送出前會跳確認對話框）
- LLM/OCR 機能是 **opt-in（UI 按鈕觸發）**，不自動送出

### 4. PWA 快取

- 舊版 build 可能被 Service Worker 快取
- bug 修正版的傳播會有時間差

## 強化建議

- 啟用磁碟加密
- 業務用與私用分開不同瀏覽器 profile
- 不安裝可疑的瀏覽器擴充功能
- 定期備份
- 不再需要的 API 金鑰請**務必到 Google 那邊失效**

## 相依函式庫的漏洞

- 計畫在 CI 跑 `npm audit`（未實裝）
- 高嚴重度 CVE 會盡快反映，但無法保證