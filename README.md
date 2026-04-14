# N5 Vocabulary Master

<div align="center">

<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />

  <h1>Built with AI Studio</h2>

  <p>The fastest path from prompt to production with Gemini.</p>

  <a href="https://aistudio.google.com/apps">Start building</a>

</div>

這是一個基於 AI 的 JLPT N5 單字學習工具，能夠自動分析學習進度並生成 Google 表單測驗。

**專案網址**: [https://ais-dev-kicu6tt5kmvvhoxsr6lhzu-253556148361.asia-east1.run.app](https://ais-dev-kicu6tt5kmvvhoxsr6lhzu-253556148361.asia-east1.run.app)

## 🌟 核心功能

- **AI 自動生成單字表**：使用 Gemini API，根據過去的錯誤記錄自動調整單字表，包含 40 個新單字與 10 個複習單字。
- **一鍵建立 Google 表單**：自動建立具備自動評分功能的 Google 表單測驗。
- **混合題型**：支援 90% 選擇題與 10% 簡答題，提升學習效果。
- **學習記錄與排行榜**：所有測驗結果自動記錄於 Google 試算表，並在儀表板顯示排行榜。
- **歷史表單管理**：追蹤所有已生成的表單，並即時查看已考人數。

## 🛠️ 技術棧

- **Frontend**: React (Vite), Tailwind CSS, Framer Motion, Lucide Icons.
- **Backend**: Express.js (Node.js).
- **AI**: Google Gemini API.
- **Storage & Auth**: Google Sheets API, Google Forms API, Google OAuth 2.0.

## 🚀 快速開始

1. **環境變數設定**：
   在 `.env` 檔案中設定以下變數：
   - `GEMINI_API_KEY`: 您的 Gemini API 金鑰。
   - `GOOGLE_CLIENT_ID`: Google OAuth 客戶端 ID。
   - `GOOGLE_CLIENT_SECRET`: Google OAuth 客戶端密鑰。
   - `APP_URL`: 應用程式的部署網址。

2. **安裝依賴**：
   ```bash
   npm install
   ```

3. **啟動開發伺服器**：
   ```bash
   npm run dev
   ```

## 📝 使用說明

1. 點擊「使用 Google 帳號登入」並授權相關權限。
2. 點擊「生成 Google 表單」，系統將自動分析並建立測驗。
3. 將生成的表單網址分享給學生或朋友。
4. 在儀表板查看歷史記錄與成績。

## 📄 專案文件

- [Spec.md](./Spec.md): 詳細功能規格與資料結構。
- [GEMINI.md](./GEMINI.md): AI 助手開發規範與專案上下文。

---
Made with ❤️ for JLPT Learners.
