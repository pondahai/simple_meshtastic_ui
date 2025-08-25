# simple_meshtastic_ui
這是與chatgpt協作的一個程式
以下由chatgpt整理的README

# meshtastic-usb-react v4.0.6

以 **React + TypeScript + Vite** 實作的「**直接連 USB Meshtastic 裝置**」的範例前端。  
透過 **Web Serial**（`@meshtastic/transport-web-serial`）與 **Phone/Client API** 對話，並把封包解碼為**人類可讀**（文字/節點/位置/遙測），同時提供**節點清單即時刷新**。

> 本專案重點：**USB 直連**、**事件訂閱**、**多路徑文字解碼 fallback**、**節點 seeNode() 刷新**、**JSR 相依處理**。

---

## 目錄
- [快速開始](#快速開始)
- [依賴與 Registry（JSR）](#依賴與-registryjsr)
- [功能總覽](#功能總覽)
- [架構說明](#架構說明)
- [初始握手（Initial Handshake）](#初始握手initial-handshake)
- [事件訂閱與資料流](#事件訂閱與資料流)
- [解碼策略（人類可讀）](#解碼策略人類可讀)
- [節點清單刷新（seeNode）](#節點清單刷新seenode)
- [錯誤處理與除錯筆記](#錯誤處理與除錯筆記)
- [版本沿革](#版本沿革)
- [這份對話的大綱（技術細節）](#這份對話的大綱技術細節)
- [未來工作](#未來工作)
- [授權](#授權)

---

## 快速開始

> 需要 Chrome／Edge（支援 Web Serial）與 Windows/Linux/macOS。

```bash
將zip檔下載後解包
在資料夾路徑列執行cmd指令進入命令列
執行以下命令
# 1) 安裝
npm i

# 2) 開發模式
npm run dev
# 開啟 http://localhost:5173
# 點「Connect via USB」→ 選你的 Meshtastic 串列埠
```

若你是第一次連線，瀏覽器可能會要求授權使用 USB；請選擇正確的序列埠。

---

## 依賴與 Registry（JSR）

Meshtastic 的 protobuf 與部分核心套件發佈在 **JSR**（jsr.io），而非 npmjs。  
我們在專案根目錄放置 **.npmrc**：

```
@jsr:registry=https://npm.jsr.io
```

`package.json` 透過 **npm alias** 指向 JSR 相容名稱：

```jsonc
"@meshtastic/protobufs": "npm:@jsr/meshtastic__protobufs@^2.7.0",
"@meshtastic/core": "npm:@jsr/meshtastic__core@^2.6.6",
"@meshtastic/transport-web-serial": "npm:@jsr/meshtastic__transport-web-serial@^0.2.5",
"ste-simple-events": "^3.0.11",
"tslog": "^4.9.3"
```

另外 `vite.config.ts` 內有 `optimizeDeps.include` 與 `resolve.conditions`，讓 Vite 在預打包與條件匯出時更穩定。

---

## 功能總覽

- **USB 直連**：使用 `TransportWebSerial.create()` 與 `new MeshDevice(transport)`。
- **初始握手**：呼叫 `device.configure?.()` 觸發狀態同步；`setHeartbeatInterval(15000)` 送心跳保活。
- **事件訂閱**：自動偵測並訂閱 `onMessagePacket / onUserPacket / onPosition / onTelemetry / onNodeInfo / onFromRadio`。
- **多路徑解碼**：優先取 `pkt.text` / `packet.decoded.text` / `decoded.text` / `data.text`；失敗再試 schema.fromBinary；最後 UTF‑8 fallback。
- **節點即時刷新**：任何封包都會 `seeNode(num, { lastHeard })`，節點列表依最近聽到排序。
- **UI**：三個分頁（文字訊息／節點／Logs），搜尋、排序、狀態燈與相對時間。

---

## 架構說明

```
src/
 ├─ App.tsx           // UI：分頁、節點清單、文字訊息、Logs
 ├─ main.tsx          // React 入口
 ├─ store.ts          // Zustand 狀態（texts/positions/telemetry/nodes/logs/...）
 └─ lib/
     ├─ meshtastic.ts // 串接與事件處理（connectSerial、handleText/Position/...）
     └─ humanize.ts   // 通用工具（tryDecode、findFirstPayload、intToPortName...）
```

關鍵組件：

- `connectSerial()`：建立 transport + device、訂閱事件、呼叫 `configure()`、設定心跳。
- `handleText/handlePosition/handleTelemetry/handleNode/handleGeneric`：將 FromRadio 事件翻譯成 store 的資料結構。
- `seeNode(num, patch)`：更新/提升節點於清單最上方，並依 `lastHeard` 排序。

---

## 初始握手（Initial Handshake）

1. **開啟串列並建立流（Web Serial）**：USB/Serial 採連續 byte stream，但每個 protobuf frame 前有 magic `0x94 0xC3 + length` 作為 framing。
2. **客戶端發起同步**：呼叫 `device.configure?.()`（等同於送 `startConfig/want_config_id`），要求裝置回傳必要狀態＋ NodeDB。
3. **裝置回傳初始序列**（FromRadio 多筆）：`RadioConfig` → `User` → `MyNodeInfo` → **多筆 `NodeInfo`** → `endConfig` →（可選）補送離線期間的 MeshPacket。
4. **開始心跳**：`setHeartbeatInterval(15000)`。對 Serial 連線尤其必要，避免裝置停止向這條流推送資料。
5. **持續收包/發包**：事件流穩定後，依 `portnum` 分流到各 handler。

> 這些細節在 log 會看到：`Ping ❤️ Send heartbeat...`、`HandleMeshPacket Received TEXT_MESSAGE_APP` 等。

---

## 事件訂閱與資料流

- 先嘗試訂閱**語義化事件**：
  - 文字：`onUserPacket` / `onMessagePacket` / `onTextPacket`
  - 位置：`onPosition` / `onPositionPacket`
  - 節點：`onNodeInfo` / `onNodeInfoPacket`
  - 遙測：`onTelemetry` / `onTelemetryPacket`
- 若某類事件不存在（依版本差異），**退回 `onFromRadio` + `handleGeneric()`**，靠 `portnum` 分流。
- 每個 handler 都會：
  1) 取 `payload/metadata/from/to/channel`（`findFirstPayload()`）  
  2) 嘗試解碼 → 推送到對應 store → `seeNode(num, { lastHeard: Date.now() })`。

---

## 解碼策略（人類可讀）

### 文字（Text）
解碼順序：
1. 直接欄位：`pkt.text` / `data.text` / `decoded.text` / `packet.decoded.text` / `decoded.data.text` / `packet.decoded.data.text`
2. **Schema** 解碼：嘗試 `Mesh.*Schema` 或 `Mesh.*`（`fromBinary / type.fromBinary / decode`）→ 搜尋 `text/message/content` 等鍵。
3. **UTF‑8 fallback**：`new TextDecoder('utf-8')` 解 payload，清除 `\u0000`，並用 `isMostlyText()` 檢查；否則顯示 `(binary)`。
4. Debug：抓不到時會在 Logs 出現 `TEXT fallback:`（包含 payload 短預覽與可疑字串）。

### 位置/遙測/節點
以 `tryDecode(schema, payload)` 嘗試多種生成器：
- `schema.fromBinary(bytes)`（buf.build）
- `schema.type.fromBinary(bytes)`（部分包裝）
- `schema.decode(bytes)`（protobuf.js 風格）

---

## 節點清單刷新（seeNode）

任何封包（文字/位置/遙測/節點）一抵達：
- 會 `seeNode(num, { lastHeard: Date.now() })`；
- 若該節點已存在，合併 patch 並**移到清單最上方**；
- 清單依 `lastHeard`（或 `at`）由新到舊排序；
- 這讓「節點」分頁會像即時名單般自動刷新。

---

## 錯誤處理與除錯筆記

- **JSR / npm E404**：`@meshtastic/protobufs` 不在 npmjs，需 `.npmrc` 指到 `https://npm.jsr.io` 並用 `npm:@jsr/...` 別名。
- **transport-web-serial 入口解析**：改用 JSR 相容別名可避開某些版本的 `exports` 解析問題。
- **缺相依**：`@meshtastic/core` 內部使用 `ste-simple-events`、`tslog`，在某些環境需顯式安裝。
- **Vite dep-scan**：在 `vite.config.ts` 加 `optimizeDeps.include`（核心套件）與 `resolve.conditions` 可提升穩定性。
- **fromBinary 匯出**：`@bufbuild/protobuf` 沒有頂層 `fromBinary`，要用**每個訊息類型的** `fromBinary()`；本專案 `tryDecode()` 已兼容多種生成器。
- **(binary) 現象**：通常是解不到文字或尚未完成初始同步；等配置/通道資訊到齊、或用 fallback 會恢復可讀文字。
- **NO_CHANNEL**：表示通道資訊/路由尚未就緒或封包屬性不匹配；通常在初始同步結束後就不再出現。

---

## 版本沿革

- **v4.0.6**
  - 修正 `tryDecode()`：改用 `schema.fromBinary / type.fromBinary / decode`，移除錯誤的 `fromBinary` 頂層匯入。
  - 保留節點即時刷新、UI 三分頁與 Logs。
- **v4.0.5**
  - 套件來源統一改用 JSR 相容別名；補 `ste-simple-events`、`tslog`；Vite `optimizeDeps` 提示。
- **v4.0.4**
  - 重建骨架，補齊 `@vitejs/plugin-react`、`App.tsx` 缺失。
- **v4.0.1 ~ v4.0.3**
  - 人類可讀的多路徑解碼、節點刷新 `seeNode()`、多事件訂閱與 `onFromRadio` 守門。

---

## 這份對話的大綱（技術細節）

1. **初版（v2.x）**：已能連 USB、收到封包；畫面偶爾空白 → 加入錯誤欄位與 try/catch，避免 handler throw 造成 UI 中斷。
2. **人類可讀**：
   - 問題：收到 `(binary)`；
   - 解法：補多路徑文字解碼 + UTF‑8 fallback + Debug log（`TEXT fallback:`）；
   - 結果：能顯示「好 / Test / 愛💖」等訊息，但仍會看到伴隨的 `(binary)`（由另一條非文字 payload 觸發）；
   - 後續：在 `handleGeneric` 將 text/position/telemetry/node portnum 分流，降低誤判。
3. **事件 API 差異**：`device.events.onFromRadio/onMessagePacket/...` 在不同版本名稱略不同；我們改成**事件探測後訂閱**，並用 `onFromRadio` 作為後盾。
4. **節點清單**：新增 `seeNode()`，於每個 handler 末尾更新 `lastHeard` 並提升排序；UI 提供搜尋/排序/狀態燈。
5. **JSR 相依問題**：
   - `@meshtastic/protobufs` 不在 npmjs → `.npmrc` + `npm:@jsr/meshtastic__protobufs`；
   - `@meshtastic/transport-web-serial` 在某些版本下入口解析失敗 → 改 JSR 別名；
   - `@meshtastic/core` 缺少的相依（`ste-simple-events`、`tslog`）顯式加入。
6. **Vite 問題**：`@vitejs/plugin-react` 遺漏 / `App.tsx` 路徑錯誤 / dep-scan → 一一補齊並加 `optimizeDeps.include`。
7. **Buf 解碼**：移除不正確的 `fromBinary` 頂層匯出用法；以 **schema 靜態方法**為準並提供多種相容路徑。  
8. **初始握手**：說明了 `configure()` 觸發的 RadioConfig / MyNodeInfo / NodeInfo... 的初始序列，以及 Serial 模式心跳的必要性。

---

## 未來工作

- 文字**發送**與送達回報（ACK/Want ACK）。
- **地圖頁**顯示位置（OpenLayers/Leaflet），含最近軌跡。
- 節點卡片加入 **RSSI/SNR** 最近值。  
- **Channel / RadioConfig** 的 GUI 編輯與同步。
- 快速匯出 **原始 payload**（供除錯或回報 issue）。
- 以 `Service Worker` 緩存最新 NodeDB（離線可瀏覽）。

---

## 授權

本範例以 MIT 授權釋出；Meshtastic 相關商標/著作權屬原專案與作者。

