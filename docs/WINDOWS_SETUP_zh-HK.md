# War Room：喺 Windows 手提設定（Claude app + Codex app）

大約要 20 分鐘。全部指令都喺 **PowerShell** 打：撳「開始」，搜尋 PowerShell，打開佢。
每一步都有「點知成功」。如果唔同，就影低個畫面發俾我，唔使自己估。

> 呢個係 war room 第一次喺 Windows 用。我喺 Mac 測試過 Windows 會收到嘅指令同檔案，但未喺真正嘅 Windows 機行過，所以呢次就係真正嘅檢查。

---

## 第 0 步：裝兩樣基本工具（如果未裝）

1. **Node.js**：去 https://nodejs.org ，下載「LTS」版，一路撳 Next 裝完。
2. **Git for Windows**：去 https://git-scm.com/downloads/win ，下載，一路撳 Next 裝完。
   Claude app 喺 Windows 要用佢嚟行 war room 嘅守門程式。冇佢，守門程式可能會出錯。

裝完之後，**關咗 PowerShell 再開過一個新嘅**，然後打：

```powershell
node -v
git --version
```

**點知成功：** 兩行都出到版本號，例如 `v22.x.x` 同 `git version 2.x`。

---

## 第 1 步：喺 Claude app 裝 war room

1. 打開 Claude app，去 **Code** 分頁。開一個普通嘅本機 session，揀你做影片嗰個資料夾。**唔好揀 WSL**，因為 WSL 用唔到 plugin。
2. 喺輸入框打以下兩句，一句一句送出：

```
/plugin marketplace add hancheeeiz/war-room
/plugin install war-room@war-room
```

   如果輸入框唔接受呢兩句：
   - 撳輸入框旁邊嘅 **+**，揀 **Add plugins**（或者 **Plugins → Browse plugins**），搵 war-room 然後安裝，範圍揀 **user**。
   - 如果嗰度搵唔到 war-room，就影低畫面發俾我。

**點知成功：** 開一個新 chat，打 `/war`，應該見到 `/war-room:war-room` 同 `/war-room:join`。

---

## 第 2 步：攞一份 war room 落電腦（俾 Codex 同指令用）

喺 PowerShell 打：

```powershell
git clone https://github.com/hancheeeiz/war-room "$env:USERPROFILE\war-room"
```

之後每次開新嘅 PowerShell，先打下面呢一句。佢只係將 war room 嘅位置記喺 `$wr` 度，方便後面嘅指令用：

```powershell
$wr = "$env:USERPROFILE\war-room\bin\war-room.mjs"
```

**點知成功：** 打 `node $wr doctor` 會出到一段報告，第一行係 `War room doctor`。

---

## 第 3 步：喺你嘅影片資料夾開 war room

喺 Claude app（Code 分頁，影片資料夾）打：

```
/war-room:war-room 做一條 30 秒宣傳片：Codex 寫劇本，Claude 整畫面，Codex 檢查
```

佢會分析你嘅目標、問你揀邊個方案，再請團隊、分步驟。照住佢嘅問題答就得。

**點知成功：** 你嘅影片資料夾入面多咗一個 `.warroom` 資料夾。

---

## 第 4 步：接駁 Codex app

PowerShell 先去你嘅影片資料夾（下面嘅路徑換成你自己嘅），再睇吓 war room 會改咩：

```powershell
cd "$env:USERPROFILE\Documents\你的影片資料夾"
node $wr connect codex
```

佢會列出會改咩（Codex 嘅設定檔，同埋資料夾入面嘅 AGENTS.md）。冇問題就打：

```powershell
node $wr connect codex --yes
```

然後**完全關咗 Codex app 再開過**。

**點知成功：** Codex app 入面 **Settings → MCP servers** 見到 **war-room**。

---

## 第 5 步：開背景引擎同頁面

```powershell
node $wr engine install
```

**點知成功：**
- 會出 `Engine is on`。
- 瀏覽器打開 http://127.0.0.1:4818 ，見到你嘅 war room 頁面。
- 打 `node $wr engine status`，會見到你個資料夾前面有個 `●`。

之後每次開機，war room 都會自己開返。

---

## 第 6 步：第一次接力測試（細細條）

1. 喺 Claude app 同 commander 講：

   > 做一個測試：請 writer（Codex app 做，use app）寫一句宣傳標語去 tagline.md；請 checker（Claude app 做，use app）檢查得唔得，唔得就退返。

2. 開 **Codex app**，揀同一個影片資料夾，開一個新 chat，講：

   > stand by as writer

3. 喺 **Claude app** 再開一個新 chat（同一個資料夾），講：

   > /war-room:join checker

   然後再講：stand by

4. 打開 http://127.0.0.1:4818 ，睇 **Steps now**：
   - writer 喺 Codex app 寫緊；
   - 寫好之後自動交俾 checker；
   - checker 通過，或者退返俾 writer 改。

**點知成功：** 由頭到尾你冇 copy 過任何嘢，兩邊自己交接完成。

---

## 做完之後發俾我

- `node $wr doctor` 嘅結果（成段 copy 俾我）。
- **Steps now** 嘅截圖。
- 任何紅色錯誤訊息，或者卡住嘅位置。

## 常見問題

| 情況 | 點做 |
|---|---|
| `node` 唔認得 | 未裝 Node.js，或者裝完未開新 PowerShell。 |
| Claude app 出 hook 錯誤 | 確認已裝 Git for Windows，再重開 Claude app。 |
| Codex 等太耐出錯（timeout） | 再行一次 `node $wr connect codex --yes`，然後重開 Codex app。 |
| 頁面打唔開 | 打 `node $wr engine status` 睇吓係咪 `○`（冇行緊），再發俾我。 |
| 想停背景引擎 | `node $wr engine uninstall` |
| 之後更新 war room | Claude app：`/plugin update war-room@war-room`。指令嗰份：`git -C "$env:USERPROFILE\war-room" pull`。兩份都要更新。 |
