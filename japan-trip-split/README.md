# 日本旅遊分帳所（多人即時同步版）

正式部署架構：Vite + React + TypeScript + Firebase Authentication（匿名登入）+ Cloud Firestore + Firebase Storage + Firebase Cloud Functions。  
網站可供 1～4 人加入同一房間，透過邀請網址及獨立房間密碼加入。每個人用自己的手機開啟，帳目透過 Firestore 即時同步。

## 功能
- 建立旅遊房間，設定 1～4 人上限
- 邀請網址（含隨機邀請 token）＋獨立房間密碼
- Firebase 匿名登入；每台裝置有獨立 UID
- 即時同步成員、消費、匯率及收據
- 日幣金額、台幣估算
- 每筆消費指定付款人及 1～4 位分攤人
- 自動計算各人已付款、應分攤及最後互相轉帳
- 收據照片上傳 Firebase Storage
- 匯出 CSV 帳單

## 重要限制／上線前請知道
1. 這是一份可部署的完整起始專案，不是已替你建立雲端帳號或已經公開上線的網址。你需要用自己的 Google 帳號建立 Firebase 專案及 Vercel 帳號。
2. 建立房間、加入房間使用 Cloud Functions。部署 Cloud Functions 通常需要 Firebase Blaze（隨用隨付）方案及啟用帳單；請設定預算通知。免費額度與實際費用依 Firebase 當時方案為準。
3. 收據圖片每張限制 8 MB。請勿上傳信用卡完整卡號、護照或其他敏感文件。
4. 房間密碼至少 6 個字元。邀請網址及密碼請分開傳給同行者。邀請網址本身等同入場憑證，請勿公開張貼。
5. 本專案以匿名登入為簡易旅行帳本設計；清除瀏覽器資料或換手機後，匿名 UID 可能無法恢復。換機前請先匯出帳單；若需要長期帳號恢復，應再加入正式電子郵件／Apple 登入。
6. 目前收據可拍照上傳與檢視，但不會自動 OCR 讀取品項；品項仍需手動輸入。分攤預設平均分攤。
7. 目前成員可新增、修改及刪除消費；房間成員加入由 Cloud Function 控制。沒有成員踢除／帳本刪除功能。

---

# A. 建立 Firebase 專案

1. 前往 https://console.firebase.google.com/ ，用 Google 帳號登入。
2. 按「新增專案」，名稱可用 `japan-trip-split`。
3. 專案建立後，進入 Project settings（齒輪）→ General → Your apps → Web（`</>`）註冊網站。
4. 複製 Firebase Web App 設定中的 apiKey、authDomain、projectId、storageBucket、messagingSenderId、appId，稍後填入 `.env.local`。
5. Authentication → Get started → Sign-in method → 啟用 **Anonymous（匿名）**。
6. Firestore Database → Create database。先選正式模式，資料庫位置建議選 `asia-east1`（台灣附近）。
7. Storage → Get started，建立 Storage bucket。
8. Functions 需要 Blaze 方案。Firebase Console → Usage and billing，依畫面升級並設定預算通知。Cloud Functions 部署也可能要求啟用 Google Cloud Billing。

# B. 本機準備

先安裝：
- Node.js 20 或更新 LTS：https://nodejs.org/
- Firebase CLI：`npm install -g firebase-tools`
- Git（部署至 Vercel 時建議使用）：https://git-scm.com/

解壓縮專案後，在專案根目錄開啟終端機：

```bash
npm install
cp .env.example .env.local
```

Windows PowerShell 可用：
```powershell
Copy-Item .env.example .env.local
```

編輯 `.env.local`，填入 Firebase Web App 設定：
```env
VITE_FIREBASE_API_KEY=你的apiKey
VITE_FIREBASE_AUTH_DOMAIN=你的專案.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=你的專案ID
VITE_FIREBASE_STORAGE_BUCKET=你的Storage bucket
VITE_FIREBASE_MESSAGING_SENDER_ID=你的sender ID
VITE_FIREBASE_APP_ID=你的app ID
```

# C. 部署 Firebase 後端及安全規則

1. 登入 Firebase：
```bash
firebase login
```
2. 在 Firebase Console 找到專案 ID，將 `.firebaserc.example` 複製成 `.firebaserc`，把 `YOUR_FIREBASE_PROJECT_ID` 改成你的專案 ID。
3. 部署規則及 Functions：
```bash
cd functions
npm install
cd ..
firebase deploy --only firestore:rules,storage,functions
```
首次部署若提示啟用 API，請依照指示啟用。Functions 區域使用 `asia-east1`。

# D. 本機測試

```bash
npm run dev
```
終端機會顯示網址（通常 http://localhost:5173）。建立一個房間，設定房間密碼及人數。複製邀請網址，在另一個瀏覽器或手機開啟，輸入暱稱及同一組密碼測試加入。請實際測試兩台裝置新增消費是否同步。

# E. 發布到 Vercel（取得分享網址）

1. 把專案推送到自己的 GitHub repository（不要上傳 `.env.local`）。
2. 前往 https://vercel.com/ ，用 GitHub 登入，按 Add New → Project，匯入該 repository。
3. Framework Preset 選 Vite（通常會自動偵測）；Build Command `npm run build`；Output Directory `dist`。
4. Vercel → Project → Settings → Environment Variables，加入 `.env.local` 的六個 `VITE_FIREBASE_...` 變數。
5. 按 Deploy。完成後會得到 `https://你的專案.vercel.app` 網址。
6. 之後更新程式推送 GitHub，Vercel 會自動重新部署。

也可以使用 Firebase Hosting：
```bash
npm run build
firebase deploy --only hosting
```
但若使用 Vercel，請確保 Firebase 後端仍已完成 C 步驟。

# F. 旅伴使用方法

1. 房主打開網站，輸入旅程名稱、暱稱、至少 6 字元房間密碼及人數上限，建立房間。
2. 網站顯示邀請 QR Code／連結。
3. 房主把邀請連結傳給同行者，並用另一個管道傳送房間密碼。
4. 同行者開啟連結，輸入暱稱及密碼，即可加入。
5. 所有人新增消費時，指定付款人、分攤對象，必要時上傳收據。
6. 在「最後結帳」查看誰要轉帳給誰。

## 常見問題
- **加入時顯示找不到房間／邀請無效：** 確認網址完整，沒有被聊天軟體截斷；請房主重新複製邀請連結。
- **密碼錯誤：** 房間密碼大小寫及符號需一致；密碼不在網址內。
- **資料不同步：** 確認兩台手機網路正常、登入匿名驗證已啟用，且 Firestore rules 已部署。
- **照片上傳失敗：** 確認 Storage 已啟用、Storage rules 已部署，圖片小於 8 MB。
- **Functions 部署失敗：** 確認 Firebase 專案已升級 Blaze、Cloud Functions API 已啟用，並安裝 Node.js 20。

## 安全備註
- 不要把 Service Account 私鑰、Firebase Admin SDK 金鑰或 `.env.local` 提交到 GitHub。
- Firebase Web API key 是前端設定值，不是管理員私鑰；真正的資料保護依靠 Authentication、Firestore Rules、Storage Rules 及 Cloud Functions。
- 部署後請先用兩個不同瀏覽器／手機做權限測試，再邀請旅伴使用。
- 如需公開長期服務，建議加上 App Check、速率限制、管理員移除成員、房間到期清除政策與完整帳號登入。
