# 账本：内置 Agent（2026-10-16）

计划：`docs/superpowers/plans/2026-10-16-turing-complete-agent-phase.md`
需求与探索：`docs/superpowers/plans/2026-10-16-turing-complete-agent.md`

## 开工裁决（12:05 定，未收到用户反对）

1. **兼容面**：只做 OpenAI 兼容的 `POST {baseUrl}/chat/completions` + SSE。实测（2026-10-16 09:2x）
   `api.deepseek.com`、`api.moonshot.cn`、`open.bigmodel.cn` 三家都回 `access-control-allow-origin`，
   连 `Origin: null`（file:// 打开构建产物）也放行；`api.anthropic.com` 预检 403，需要专用浏览器直连头；
   `api.openai.com` 本机超时。所以 v1 只做一套协议，Anthropic 留作后续。
2. **key 存放**：`localStorage` 键 `tc.agent.v1`，设置页写明"同源脚本可见"并给一键清除。
   与既有 `tc.progress.v1` / `tc.sandbox.v1` 同一信任模型。
3. **工具面**：只动当前电路 + 运行/单步/复位/测试 + 电路导入导出；不跳关、不通关、不清档。
4. **视觉节奏**：每条命令之间 `await` 一个延时（默认 160ms，可调），可随时中断。
   依据：`stack.push` 本身不重绘（`src/main.ts:1378` 的订阅者才 `paint()`），所以命令之间 await
   天然就是逐帧可见；`src/` 里没有 `requestAnimationFrame`，也不需要引入。

## 证据

（每条任务完成后在此追加：命令、结果、提交号。）

- 12:05 计划文件与账本建立；`src/` 现有 54 个测试文件 / 1537 个用例、工作区干净、`origin/master` 齐平。
- 12:05 T1 `pnpm test test/agent` → 3 文件 38 用例通过；`pnpm exec tsc --noEmit` 干净（发现两处
  `exactOptionalPropertyTypes` 问题：`ChatDelta.name` 不能显式给 `undefined`；`RequestInit.signal`
  同理。都改成条件展开）。
- 12:06 T2/T3 `pnpm test test/agent` → 5 文件 68 用例通过。测试自己写错的三处（吸附 100→104、
  坐标参数类型是 number 不是 integer、`messages` 下标算错）按内核行为改正，内核未改。
- 12:07 T4/T5 `pnpm build` 干净（`dist/assets/index-*.js` 270.39 kB / gzip 92.59 kB），
  `pnpm test` → **60 文件 1618 用例全通过**（原 54/1537，新增 6 文件 81 用例）。
- 12:16 **smoke 第一次失败：7 passed / exit 1。** 原因不是 Agent 逻辑，而是首次配置卡片
  （`.overlay-agent-setup`，`inset: 0` + `pointer-events: auto`）挡住了整个舞台，
  Playwright 报 `intercepts pointer events`，24 个用例全都在第一步就被拦下。
  裁决：卡片保留（用户要求"首次启动要求自定义 API 信息"），但**只问一次**——
  `markSetupSeen()` 写进 `tc.agent.v1` 的 `seen: true`，保存设置也算回答；
  smoke 统一加一个 `open(page, url)` 帮助函数替每个用例点一次"以后再说"，
  并新增一个专门的用例断言这条路径（问一次、记住、面板可开、未配置时发送只会再问）。
- 12:29 第二次 smoke 仍全红，两个原因各自独立：
  1. `.overlay-agent-setup` 的 `inset: 0` + `pointer-events: auto` 即使**卡片**被隐藏也照样挡点击
     —— `hidden` 因此改挂在**遮罩层**上（`setupOverlay.hidden`），卡片自己有 `hidden` 反而变成
     "看得见的玻璃后面什么也没有"。UI 测试相应改成查遮罩层（`setupShown()`）。
  2. 首次配置卡片压在任务简报（`z-index: 10`）之下，谁都点不到它；改成 `z-index: 15`，
     并要求 smoke 的 `open()` 先回答卡片、再由用例自己点"开始"读简报。
- 12:31 **门禁全绿**（最终工作区）：
  - `pnpm build` → 干净（`tsc --noEmit` + vite build，dist 270 kB / gzip 92.6 kB）
  - `pnpm test` → **60 文件 1623 用例全通过**（原 54/1537；新增 6 文件 86 用例）
  - `pnpm smoke` → **25 通过（27.7 s），exit 0**（原 24 个用例 + 新增的 agent 首次配置用例）

