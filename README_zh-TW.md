# aoiko（あおいこ）

<p align="center">
  <img src="src/assets/logo-wordmark.png" alt="aoiko" width="360" />
</p>

**Language**: [日本語](README.md) | [English](README_en.md) | **繁體中文**

[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](LICENSE)

🌐 **線上版**: <https://aoiko.pages.dev>

給日本個人事業主用的純前端記帳工具。支援青色申告特別控除自令和 9 年分起分為 75 萬／65 萬／10 萬日圓三段（要件見手冊「01. 初次設定」「14. 所得控除・税額控除」），把 CSV／OCR／EC 訂單頁匯入、複式簿記、減價償卻、資產負債表、`.xtx`（e-Tax 申報檔）輸出以單一 Web App 提供。也支援白色申告（収支内訳書）。無後端、BYOK（API 金鑰使用者自備）。

<p align="center">
  <img src="docs/images/screenshot-home-zh-TW.png" alt="首頁：本月概況、新增仕訳表單與最近的仕訳" width="49%" />
  <img src="docs/images/screenshot-reports-zh-TW.png" alt="報表：年度概況與月別銷售額" width="49%" />
</p>


## 主要功能

- **複式簿記**：仕訳、訂正仕訳（修正仕訳）、保留原始仕訳的稽核履歷
- **CSV 匯入**：銀行＝三菱UFJ／三井住友／SBI新生／PayPay（僅支援信用卡消費，餘額未對應）；卡片＝楽天／JCB（含 Recruit Card 等）／セゾン／三井住友／三菱UFJ／au PAY／PayPay／ビュー（JRE CARD）／ライフ
- **匯入紀錄**：CSV 匯入的批次紀錄、檔案 hash 重複偵測、可整批 reverse
- **OCR**：收據 → 仕訳候補。引擎可選：Gemini Vision（預設）／OpenAI 相容・Ollama 等本地 vision AI／瀏覽器內建的 AI／**Tesseract（純本地 WASM OCR、不擷取店名・品項（欄位維持空白）、必須人工確認）**
- **訂單匯入（貼上 → AI 抽取）**：把 Amazon・楽天 等的訂單頁全文貼進來，由 AI 抽取品項明細 → 確認 → 轉成仕訳。不依賴 DOM 解析，網站改版不怕
- **AI 分類**：CSV 列 → 勘定科目（規則優先、AI 後援）。引擎可選 Gemini／OpenAI 相容・Ollama 等本地 AI／瀏覽器內建的 AI
- **OCR/AI 隱私**：對外送出前會跳確認對話框（可在設定跳過）。把 Ollama 等指向 localhost、或選 Tesseract 時，影像不會離開本機（使用 localhost 時需在 Ollama 端的 `OLLAMA_ORIGINS` 允許 aoiko 的公開網址；Tesseract 連語言資料都內附，完全不會有對外連線）
- **家事按分**：把家庭兼事務所的經費自動拆成事業用與事業主貸
- **減價償卻**：定額法、200% 定率法（耐用年數 2〜20 年）、月分攤、留 1 円殘存
- **少額減價償卻資產特例**：措法 28 之 2（30→40 萬日圓、2026-04-01 起），年合計 300 萬日圓上限管理
- **前期繰越**：去年年末殘高 → 期首振替仕訳自動產生（純利益、事業主貸借吸收至元入金）
- **開業時設定（開業精靈）**：開業費、轉用資產（私用轉事業用的未償卻殘額依國稅廳方式自動算）、自由項目，一次生成傳票與固定資產登記
- **消費稅概算**：本則課稅、簡易課稅（第 1〜6 種，一律顯示）與該年分適用的特例（2 割特例到 2026 年分為止，3 割特例限 2027、2028 年分）比較，80/70/50/30% 經過措置自動套用
- **e-Tax `.xtx` 輸出**：確定申告書（KOA020）+ 決算書（青色申告決算書 KOA210 或収支内訳書 KOA110，依確定申告方式切換）併載於同一檔
- **報表**：月別銷貨、損益計算書、貸借対照表、月別 PL（科目 × 月）、取引先別／補助科目別集計、消費稅的方式比較
- **複合搜尋**：仕訳清單可組合兩項以上的 年/月/摘要/金額範圍/取引先 搜尋
- **請求書・見積書**：含明細行與稅率別內訳（記載インボイス制度的登録番号、各稅率消費稅額）的製作與列印、發行時自動產生売掛金傳票、以沖銷傳票訂正、見積書 → 請求書轉換
- **修正申告引導**：申告済 snapshot 與目前值的差異顯示＋提交流程
- **備份**：File System Access API（Chromium）→ OPFS（Firefox / Safari 26 以後）自動 fallback（兩者都不支援時只剩手動下載）
- **PWA**：記帳・報表・減價償卻・消費稅計算・`.xtx`・請求書・見積書・備份還原都可離線運作。Tesseract 只在首次辨識時從同源取得約 3MB 語言資料，使用雲端引擎與查看第三方授權清單則需要連線

## 使用方式

操作步驟請見 [docs/manual/](docs/manual/README_zh-TW.md)。分章節說明初次設定・建立傳票・CSV 匯入・報表（日文・英文版也有）。

## 授權

[GNU Affero General Public License v3.0](LICENSE)（AGPL-3.0）

## 法務・安全相關文件

- [DISCLAIMER_zh-TW.md](DISCLAIMER_zh-TW.md) — 免責事項（實際申告、稅法遵循、AI 使用風險）
- [SECURITY_zh-TW.md](SECURITY_zh-TW.md) — 安全政策、漏洞回報流程
- [PRIVACY_zh-TW.md](PRIVACY_zh-TW.md) — 隱私政策、資料收集／傳送內訳