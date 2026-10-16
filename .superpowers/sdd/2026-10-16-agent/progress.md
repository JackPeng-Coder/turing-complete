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
- 12:39 补上**端到端**那一条：`test/smoke/ui.spec.ts` 新增"the agent builds what it was asked for"，
  用 `page.route` 把一个脚本化的模型挂在**同源**的 `/mock/v1/chat/completions` 上
  （跨域会引入预检和 CORS，那是"对方的策略"而不是这个程序的事实），于是浏览器发的是真请求、
  客户端读的是真 `text/event-stream`、循环跑的是真工具、板子上留下的是真电路：
  两个 `place_part` → 读数变成 `门 2 个`，日志里两行工具结果，末行文本"放好了"；
  再按一次 Ctrl+Z，读数回到 `门 1 个`——**agent 的改动就在玩家自己的撤销栈里**。
  调试过程中它先失败了一次，失败本身是好事：脚本让 level 1 放 `nand`，而第 1 关的
  `allowedComponents` 只有 `const_on`/`const_off`/`level_input`/`level_output`，
  工具如实拒绝并列出可用元件——这正是 A3 里"agent 只能用这一关给你的元件"的证据。
  测试改成 `seedProgress(page, 2)` 打开第 3 关（第一个给 `nand` 的关卡）。
- 12:41 最终工作区三门禁重跑：`pnpm build` exit 0；`pnpm test` **60 文件 1623 用例**；
  `pnpm smoke` **26 通过（28.3 s）exit 0**。
- 12:34 推送成功：`7853235..f4f30c6 master -> master`，用 JackPengCoder 账户
  （`origin` 改成 `https://JackPeng-Coder@github.com/...`，让 git 的凭据查找命中
  Windows 凭据里已有的 `git:https://JackPeng-Coder@github.com`；此前 `origin` 不带用户名，
  查找的 target 对不上，GCM 于是要弹窗而 `GIT_TERMINAL_PROMPT=0` 下直接失败）。
- 12:45 **补第二批工具，把 A3 的"所有操作"再推近一步**。第一批只覆盖"当前电路 + 运行/测试 +
  导入导出"，缺口是**自制元件**与**程序文本**这两条人手路径。第二批加八条，全部走人手同一条路：
  `select_parts`（框选，也是封装的前提）、`wrap_selection`（封装为元件，plan 由 `planWrap` 出、
  `null` 原样透传成拒绝）、`enter_component`/`leave_component`（编辑内部/返回）、
  `rename_component`、`delete_component`（拒绝逻辑仍是 `deleteBlueprint` 的那一次扫描）、
  `set_input`（驱动关卡输入，位宽越界会被拒）、`set_program`（写程序文本，没有程序判分的关卡直接拒）。
  为了让模型能自己判断，`read_board` 多报三样：`components`（库 + 每种的实例数）、
  `inputs`（引脚、位宽、当前值）、`program` 与 `expectsProgram`。
  仍然**不做**的：导航（开关卡/回地图/开沙盒）、进度（跳关/通关/清档）、视图（平移缩放、网格、
  框选手势本身）。前两类是裁决里就排除的，第三类是视图不是电路。
- 12:47 第二批之后门禁重跑：`pnpm build` exit 0；`pnpm test` **60 文件 1633 用例**；
  `pnpm smoke` **26 通过（28.6 s）exit 0**。测试里那一批新用例全部走假 host：
  封装成功的返回、封装失败的"边界"解释、进入/改名/返回的顺序、删除被拒的透传、
  位宽越界、没有程序判分的关卡拒绝写程序。

