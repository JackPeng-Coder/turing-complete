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
- 12:52 看了 e2e 的截图，发现最刺眼的一处不是逻辑而是**可读性**：工具行印的是模型看的 JSON
  （`place_part · {"id":"i1","defId":"nand","x":160,"y":160}`）。这正是 DSH 用
  `presentCall`/`presentResult` 分开处理的那一层——**一个结果，两个读者**。于是给 `ToolSpec`
  加一个可选的 `present(result, args)`，`ToolOutcome` 多一个 `note`（给玩家的中文一行），
  循环把它放进事件，面板优先显示它；模型的 `content` 仍然原样是 JSON。
  表写在工具列表旁边而不是每个工具里，并且加了一条测试断言**每个工具都有 present**——
  没有的那一行会退回打印原始 JSON，而 `read_board` 的原始 JSON 是一整块板子。
  另外给系统提示词加了一句"左上角被仪表盘挡着，从 (240,240) 往右下铺"：截图里第一个与非门
  正压在工具箱下面。
- 12:54 第三批之后门禁重跑：`pnpm build` exit 0；`pnpm test` **60 文件 1637 用例**；
  `pnpm smoke` **26 通过（28.6 s）exit 0**（e2e 里那行断言同时改成断言中文那一行）。
- 17:4x **用户拿真 key 实测，贴回一段日志：agent 在第 8 关原地打转 16 轮。** 两个根因，都在我这边：
  1. **关卡连接器被我的工具挡掉了。** `place_part` 明确拒绝 `category === 'level'`，`list_parts` 还按
     `hidden` 过滤——可玩家本来就能手放「关卡输入/关卡输出」，而且关卡是**按实例名绑定**的
     （`IN_a` / `OUT`，见 `ui/board/interact.ts` 的 `levelIoPlacement`）。于是 agent 永远搭不出
     "电路接到关卡上"，凡是需要连接器的关卡都不可能通过；日志里它把三条延迟线串起来、测了三次，
     始终"2 个用例不符"。修：新增 `AgentHost.connectorFor(defId)`，main.ts 实现成同一个
     `levelIoPlacement`，**id 和宽度一起给**（宽度也是绑定的一部分）；`list_parts` 如实列出调色板
     给的全部元件。测试：连接器拿到 `IN_a`、宽度 1、可撤销，放完之后再放是普通元件 `i1`。
  2. **判定只说"未通过：2 个用例不符"，模型没有任何可执行的信息，只能猜。** 修：`TestOutcome.failures`
     带上 `{inputs, expected, actual, tick}`（最多 8 条），工具结果里就是这些数字；工具行的人话是
     "第 2 拍 out 期望 1、实际 0，还有 1 个用例不符"；提示词改成"照着期望与实际的差值改**一处**，
     再测一次，不要一次改一堆"。
  另外：`read_board` 现在也报**输出引脚**（模型曾对着一个不存在的输入 `y` 调 `set_input`），
  `set_input` 的拒绝会说清"这一关没有输入，要驱动的是输出 out"；提示词要求**所有给玩家的文字
  必须是中文**（实测那次独白全是英文）。
- 17:5x 用户要求：思考时只展示最末几行（后定为**六行**）、思考结束把它收起来。改成 `thought`
  （`reasoning_content`，客户端新开一路 delta——它不是回答，也不该进对话历史）与 `text` 两个字段，
  共用一个可折叠块：流式时是固定高度窗口、每次增量重填并滚到底；这一步结束时折成一行
  `▸ 思考 · N 行`，点标题展开。**没有调用工具的那一步是回答**：它的推理折在上面，结论照旧可读。
- 17:5x 新增 opt-in 的真模型端到端用例 `test/smoke/agent-live.spec.ts`：环境里没有
  `DEEPSEEK_API_KEY` 就 skip，所以 `pnpm smoke` 仍然免费且离线；带 key 时打开第 7 关
  （一个高电平接出去）让真模型做，断言用的是**关卡自己的判定**（结果卡片 + ★），不是模型的自述。
- 18:0x **用户第二段日志：`?dev=1` 下更糟。** 关卡 `ch2-14`（四位原样送出）在 dev 模式下调色板
  只有基础元件、**没有关卡连接器**——因为 `?dev=1` 走的是沙盒调色板，而 `sandboxPaletteDefs`
  按设计丢掉 `category: 'level'`。人和 agent 都摆不出 `IN_b0` / `OUT_out0`，这一关在 dev 模式下
  根本无解。模型随后开始猜元件名（`level_input`、`input`、`in`、`lv_in` ……二十来个），
  每次都被正确拒绝、每次都被回一整张 50 多个元件的清单，直到 16 步烧光。
  三处修改：
  1. **app 层修 bug**：新增 `offeredDefsFor()`（`app/progress.ts`）——"这块板子提供什么"从此只有
     一份实现，调色板和 agent 都调它；dev 模式仍然给沙盒的完整集合，**再补上这一关自己声明了的
     连接器**（沙盒本身没有引脚，照旧不补）。`ui/palette.ts` 与 `main.ts` 的 `offeredDefIds()`
     都改成调它，重复的那份规则删掉。
  2. **拒绝不再回整张清单**：改成"一共 N 种，例如前 12 个；不要再猜名字，先 list_parts"。
  3. **连续三次被拒就停**：`MAX_REFUSALS = 3`，新的停止原因 `stuck`，面板状态"连着被拒绝了，
     先停下来了"；提示词也写明"同一种失败不要试第三次"。
- 18:0x **收尾（用户要求先不跑门禁，直接提交推送）**，状态如实记在这里：
  - **最后一次完整的绿门禁早于本批最后两处改动**：`pnpm build` exit 0、`pnpm test` 60 文件
    **1648 用例**、`pnpm smoke` **26 通过**。那之后只动过两个**测试文件**——
    `test/app/progress.test.ts`（连接器断言改用带输入的关卡）与 `agent-live.spec.ts`（新增
    `?dev=1` 那条）。**这两处之后没有再跑过 `pnpm build` / `pnpm test` / `pnpm smoke`。**
  - **真模型验证未完成。** `agent-live.spec.ts` 的两个用例被两次打断（用户消息中断了工具调用），
    从未拿到一次完整结果。所以"用真 key 跑通第 7 关"与"dev 模式下能摆出连接器"这两件事
    目前**只有间接证据**：09:2x 的 CORS 预检、以及用户自己贴回的两段真实日志（它们暴露的问题
    都已修）。自己跑：
    `$env:DEEPSEEK_API_KEY='sk-…'; pnpm smoke -g "real model"`，或 `-g "own connectors"`。
  - 未提交的临时文件已清掉（`live*.txt`），预览端口 4173 已释放。

## 收尾复核（2026-10-17，用户拉取后）

- 用户 `git pull` 后本地快进到 `1874419`（15 个提交：沙盒/自制元件、内置 Agent、第 5–7 章路线图、
  会话记录阅读工具）。控制器在新主机实跑三门禁，**全绿**：
  - `pnpm build` exit 0 —— 84 模块，`dist/assets/index-*.js` 282.09 kB / gzip 96.86 kB
  - `pnpm test` **60 文件 / 1648 用例全通过**（22.4 s）
  - `pnpm smoke` **26 通过 / 2 跳过（28.9 s），exit 0**；跳过的两条正是 `agent-live.spec.ts`
    （无 `DEEPSEEK_API_KEY` 时自动 skip）
- 因此上面「最后一次完整的绿门禁早于本批最后两处测试文件改动」的保留意见**解除**：`1874419` 本身即绿。
- **仍未验证的唯一一项**：真模型端到端（`-g "real model"` / `-g "own connectors"`）。本机没有 key，
  未跑；有 key 时一条命令即可补上，所以它是环境缺口，不是代码缺口。
- 文档对齐（同日 docs 提交）：README（标题、交付范围、session-archive 段）、AGENTS.md（layer、layout、
  第 5–7 章状态、transcript 段）、spec §12（Agent 一期注）、第 5–7 章路线图（基线数字与已交付清单）。

