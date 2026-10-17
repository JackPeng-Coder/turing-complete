# 账本：工作台布局与 Agent 收尾（2026-10-17）

用户在同一条消息里给了五件事（第 5 条是 bug）：

1. 默认模型改为 `deepseek-flash`
2. 去掉「搭建速度」选项，速度直接定为不停顿
3. 首次启动不再弹 Agent 配置卡片，改为在 Agent 栏内提示
4. 参考 VSCode 的主侧栏 / 辅助侧栏 / 下部任务面板，重做布局
5. 部分关卡（如 2-38）在 Agent 跑测试时到后面直接卡死

## 提交

| # | SHA | 内容 |
|---|---|---|
| 1 | `1c5ebf9` | `fix(ui): sample the board while the test run's fast phase ticks`（第 5 条） |
| 2 | （本条账本所在提交） | 第 1–4 条 + 本记录 |

## 裁决

| # | 裁决 | 理由 / 代价 |
|---|---|---|
| 1 | `DEFAULT_MODEL = 'deepseek-flash'`，占位提示同步改 | 用户指定；`normalizeConfig` 忽略旧载荷里的 `stepMs`、`seen`，已配置的浏览器不掉设置 |
| 2 | 删除 `stepMs` 与三个档位；每条命令之间只 `await` 一个 0 ms 宏任务 | 用户要求「不停顿」。0 ms 仍让出一帧，板面逐帧重绘（A5 的可视性保留），但没有停顿 |
| 3 | 启动时不再打开设置卡片；未配置时面板内显示一行提示 + 「打开设置」 | 用户要求「不要在刚启动时就显示」。设置卡片仍是独立 modal（`position: fixed`，挂在 body 上，侧栏收起时也可见） |
| 4 | VSCode 式五段停靠：活动栏 / 主侧栏 / 中央编辑器 / 辅助侧栏 / 下方面板 + 状态栏 | 用户选 A：左=元件与组件，右=Agent，底=用例/程序/调试。画板让出侧栏与面板的宽度（停靠的固有代价），任何面板不再盖住导线 |
| 5 | 测试运行的「快速阶段」继续 `sample()`，只跳过 `paint()` | 根因：`while (snapshot.tick < item.tick)` 的条件读的是快照，而快速阶段只 `display.tick()` 不 `sample()`，超过 `TEST_DEMO_LIMIT = 32` 后快照冻结、同步 while 死循环。2-38（513 步）、2-39（265 步）都会命中 |
| 6 | I/O 读数放在主侧栏底部固定区，不占下方面板标签 | 驱动输入位是连线的一部分，必须与调色板同屏；实验过放进下方面板标签，smoke 立刻抓到「看不见」（`a level input shows the number it drives`） |
| 7 | 程序关卡打开时自动切到下方面板的「程序」标签 | 程序关卡的 IDE 就是这一关的工作面；不自动切则 `.ide-step` 等控件不可见（smoke 抓到两处） |

## 证据（新主机实测，按时间）

- 第 5 条：新增 smoke 用例 `a level with hundreds of cases finishes its run: level 38` 先**复现**：界面停在「正在测试 用例 32 / 513」不动（20 s 超时）；修复后同一用例 **10.5 s 通过**。
- 第 1–3 条（布局前）：`pnpm build` exit 0；`pnpm test` 60 文件 / 1642 通过；smoke 全量 27 通过 + 2 跳过。
- 第 4 条落地后：`pnpm build` exit 0（`dist` 284.85 kB / gzip 97.67 kB）、`pnpm test` 60 文件 / **1642 通过**、`pnpm smoke` **27 通过 + 2 跳过（37.9 s）**。
- 最终（含新增的 workbench 用例与「调试」标签修正）：`pnpm build` exit 0（284.89 kB / gzip 97.67 kB）、`pnpm test` 60 文件 / **1642 通过**、`pnpm smoke` **28 通过 + 2 跳过（34.2 s）**。
- 视觉核对：`test-results/look-board.png`、`look-agent.png`、`look-map.png`（`tools/visual-check.mjs` 的选择器同步改成 `.editor-tools`）。棋盘、活动栏、主侧栏、下方面板、状态栏、Agent 停靠都按设计出现；Agent 收起时画板宽度恢复（smoke 用 `boundingBox` 量了宽度差）。
- 全量门禁在提交前再跑一遍（见提交信息）。

## 已知限制（报告给用户）

- 侧栏宽度、下方面板高度是固定值，没有拖拽分隔条；折叠只能通过面板标签 / 活动栏 / 收起箭头。（已由同日「追加」一节解决）
- 真模型端到端（`agent-live.spec.ts`）仍需要 `DEEPSEEK_API_KEY`，本机没有 key，未跑。
- 地图打开时侧栏、下方面板仍在原位（VSCode 的行为），下方面板显示的是上一个关卡的用例。

## 追加（2026-10-17 下午）：可收起 / 可拖拽 / 自绘滚动条

用户要求：左侧栏与下方面板可收起；三个侧栏可调宽（下方面板可调高）；探究滚动条能否自绘。上面第一条限制随之解决。

- **收起**：活动栏按钮再点一次收起（VSCode 习惯），主侧栏标签行右侧另有 `«`；下方面板沿用 `⌃/⌄`；辅助侧栏沿用 `✕` 与活动栏。三个收起状态都进布局存档。
- **拖拽**：新增 `src/ui/splitter.ts`；工作台网格里两条 4px 竖轨和一条 4px 横轨就是把手。主侧栏向右变宽、辅助侧栏向左变宽、下方面板向上变高（一个 `sign` 参数）。把手是 `role=separator` 的焦点元素，方向键 12px / Shift 48px。
- **持久化**：新键 `tc.layout.v1`（`src/persist/layout.ts`）：宽/高/三个收起状态；读入逐字段回退并夹在 180–420 / 260–620 / 140–600。启动即应用；首帧的 `showPanel/showSidebar` 带 `expand=false`，所以「上次收起」不会被开机流程重新展开。Agent 停靠若上次是开着的，启动时会自动打开卡片（否则只剩一列空白）。
- **滚动条**：CSS 自绘。Chromium/WebKit 走 `::-webkit-scrollbar*`（10px、`--slab` 轨道、`--hair-lit` 方块拇指、悬停 `--hot`）；Firefox 走 `scrollbar-width: thin` + `scrollbar-color`。**关键发现**：Chrome 121 起设置标准属性会让 Chrome 忽略 `::-webkit-scrollbar`（[frontendmasters 的说明](https://frontendmasters.com/blog/heads-up-on-custom-scrollbars-chrome-is-supporting-the-standard-now-which-overrides-the-old-pseudo-elements/)），所以标准属性用 `@supports (-moz-appearance: none)` 围栏为 Firefox 专用，两边各得其所。
- **顺带修了一处空转的规矩**：`test/conventions.test.ts` 的样式断言原来用 `?raw` glob 读 CSS，而 Vitest 把 CSS 导入替换为空模块，影子/圆角两条规则一直在空字符串上通过。改成 `readFileSync`（沿用仓库既有的 `@ts-expect-error` 约定）后首次名副其实，并新增「滚动条必须自绘」的断言。
- 测试：`test/persist/layout.test.ts`（7）、`test/ui/splitter.test.ts`（5）、smoke `the docks fold, resize, and remember`（拖宽 60px、活动栏收起/展开、下方面板收起、刷新后宽度/收起状态/Agent 停靠仍在）。
- 门禁：`build` exit 0（289.24 kB / gzip 99.03 kB）、`test` 62 文件 / **1655 通过**、`smoke` **29 通过 + 2 跳过（35.3 s）**。视觉核对：`test-results/look-resized.png`、`look-map-scroll.png`。

### 修正（同日，用户反馈「下方面板还是不能调高」）

- **根因**：第一版只写了 `grid-template-areas` 里的 `p-split/s-split/h-split`，忘了给三个把手写 `grid-area`。它们被自动排布到隐式轨道：`h-split` 的实际盒子是 `x:1400, y:49.5, width:0, height:493.5`——在屏幕外，所以下方面板没有可拖的边；`p-split`/`s-split` 也不在各自的 4px 轨道上（之前 smoke 拖 p-split 能"生效"只是因为拖到的是把手本身，改的是变量，与位置无关）。
- **修复**：补 `.p-split/.s-split/.h-split { grid-area: … }`。修复后实测：`p-split` x=300、w=4；`h-split` y=543、h=4；横拖 80px 后 `--panel-h` 300→380，刷新保留；`s-split` 在 Agent 打开后 x=1048、w=4。
- **测试护栏**：smoke 的 dock 用例增加横拖断言（把手高度 < 8px、拖动后面板高度 +40px 以上）——该断言在修复前会失败。

### 修正（同日，用户反馈「拉伸侧栏或下部面板时网格会随之拉伸」）

- **根因**：画布是位图。`renderBoard` 用 `clientWidth/clientHeight` 设 `canvas.width/height`；拖拽只改 CSS 变量，位图还是旧尺寸，浏览器把它拉伸到新盒子——网格方格变矩形。实测：拖 +100px 后 CSS 宽 996、`canvas.width` 仍是 1096。窗口 resize 原本会 `paint()`，停靠变化不会。
- **修复**：`applyLayout` 末尾调用 `onLayoutResize` 钩子（默认 no-op；`paint` 定义后赋值为它）。任何停靠变化都重绘画布，位图与盒子一致。
- **红绿验证**：先临时断开钩子跑新断言 → 失败（`canvasMatchesBox()` false）；恢复后 → 通过。smoke 用例增加两条断言：拖竖边、拖横边之后 `canvas.width/height` 都必须等于 `clientWidth/Height × dpr`（±1）。
- 门禁：`build` exit 0、62 文件 / 1655 通过、29 smoke 通过 + 2 跳过。

### 追加（同日，用户反馈「点击最左侧的用例按钮应当可以收起或展开用例面板」）

- 活动栏的 **用例 / 程序** 按钮现在是下方面板的开关，与主侧栏的 元件/组件 一致：当前就在该视图 → 收起；否则切到该视图并展开。
- smoke 的 dock 用例增加断言：点一次「用例」面板收起，再点一次回到用例标签且 `aria-pressed=true`。

### 追加（2026-10-17，用户反馈：dev 不得越过关卡；步数上限可配置）

**dev 模式不再越过关卡**

- 根因：`offeredDefsFor` 把 dev 当成「沙盒全套 + 连接器」，于是 `?dev=1` 的任意关卡都能放 8 位加法器；Agent 的 `parts()` / `place_part` 调同一函数，所以它也拿到了这张表。
- 修复：沙盒 → `sandboxPaletteDefs`；其余 → `paletteDefsFor(..., dev)`——**dev 只跳过解锁过滤，`allowedComponents` 仍是契约**。连接器本来就在各关的列表里，不再额外补。
- 测试：progress 的 dev 断言重写（dev = 本关完整列表且不含 add8/ram8；dev 下未声明的连接器也不会被补）；smoke 的 dev 用例增加「level 2 只有与非门、没有 8 位加法器」——Agent 与托盘共用同一函数，这条同时是 Agent 的上限。

**步数上限可配置 + 继续执行**

- `AgentConfig.maxSteps`（默认 `DEFAULT_MAX_STEPS = 16`，`0` = 不限），设置卡片新增「步数上限」数字输入。
- 循环按配置预算运行；耗尽时发 `{ kind: 'cap', limit }` 事件（不再发一条 error 文案）。面板把它渲染成日志末尾的一行 +「继续执行」按钮；点击用**同一段对话**再跑一次（不伪造用户消息），预算重新计。
- 测试：config（默认/坏值回退/0/正数）；loop（默认 16 与自定义 3 的 cap 事件）；面板单测（cap 行出现，点继续后第二次请求的 messages 与第一次一致）；smoke 端到端（预算设 1 → 第一次请求后出现 cap 行，点继续 → 第二次请求 → 状态「完成」）。
- 门禁：`build` exit 0（289.97 kB / gzip 99.26 kB）、`test` 62 文件 / **1660 通过**、`smoke` **30 通过 + 2 跳过**。

### 追加（2026-10-17，用户要求「像 DSH 一样显示性能与用量」）

参照 DSH 的 `StatsPills` / `TurnUsagePanel`（`packages/client/ui-chat/src/client/chat/`）：请求级一行读数、会话级累计条。

- **采集**：请求体加 `stream_options.include_usage`；客户端把两种 usage 方言（DeepSeek 的 `prompt_cache_hit_tokens`/`prompt_cache_miss_tokens`、OpenAI 的 `prompt_tokens_details.cached_tokens`）归一为 `{ input, output, total, cacheRead }`；循环测每步墙钟、首字时间与解码窗口，汇总成 `RunStats`（`llmMs` / `ttftMs` / `decodeMs` / `decodeTokens` / `usage`）。
- **展示**：每次请求结束在日志里追加一行 `.agent-run-stats`（`2.4s · 1.2k tok · 20 tok/s · 缓存 83%`，tooltip 里是精确 token、首字平均与输出速度）；日志下方 `.agent-session-stats` 累计「请求次数 · 步数 · 总 tok · 速度 · 缓存」。没有 usage 时只显示时间并注明「提供方没有返回用量」，不伪造 0。
- **测试**：`format.test.ts`（10 条）；客户端 usage 两种方言、缺失为 null、请求体含 `stream_options`；循环把两轮 usage 相加；面板单测两行文案与「无 usage 只显示时间」；smoke e2e 的 mock 带 usage 帧，断言 `1.2k tok`、`缓存 83%`、`累计 1 次`。
- **限制**：不显示费用（没有价目表）；会话累计不持久化，刷新归零（像仪表），请求级行留在日志里。
- 门禁：`build` exit 0（293.78 kB / gzip 100.69 kB）、`test` 63 文件 / **1678 通过**、`smoke` **30 通过 + 2 跳过**。

### 追加（2026-10-17，用户要求「实时显示」+ 参考 DeepSeek 价目表）

- **实时**：循环在每一步开始与结束各发一个 `progress` 事件（`{ stats, steps }`）；面板在忙碌时用 200 ms 定时器重绘总计量（不重建日志），所以请求一开始就有「运行中 · 3.2s · 2 步 · …」，token / 速度 / 缓存 / 费用随每个 step 的 usage 帧更新。结束落成「累计 …」，并把该次最终数字写进日志行。
- **费用**：新增 `src/agent/pricing.ts`，价目表取自 <https://api-docs.deepseek.com/zh-cn/quick_start/pricing/>（2026-10-17）：`deepseek-flash` 高峰 缓存命中 0.04 / 未命中 2 / 输出 8 元每百万 tokens，`deepseek-v4-pro` 0.30 / 9 / 27；空闲时段（北京时间工作日 9–12、14–18 之外）半价。**节假日未建模**（无法内置会过期的日历），节假日的工作日按高峰价计——偏保守的估算，不是账单。按三桶计价，无缓存数字时按未命中；模型不在表内则不显示费用。
- 展示：请求行与会话累计都追加 `¥` 金额；tooltip 注明「估算费用（按 DeepSeek 价目表）」。
- 测试：`pricing.test.ts`（9 条：峰谷、表、三桶计价、无缓存按未命中、未知模型）；面板新增「运行中」实时行单测；smoke 新增 `the agent shows its readings while the request is still running`（mock 延迟 1.2 s，断言出现「运行中」、结束后出现 820 tok 与 ¥）。
- 门禁：`build` exit 0（295.79 kB / gzip 101.46 kB）、`test` 64 文件 / **1690 通过**、`smoke` **31 通过 + 2 跳过**。

### 追加（2026-10-17，用户问「三路与门那关为什么直接就有三路与门的元件」）

**现象**：`ch1-11-bigger-and-gate`（三路与门）的调色板里就列着 `and3`，拖一个上去就能过关——而且实测还是三星（`{gate:4, delay:1}`，目标是 `gate:4 delay:2`）。

**根因，两处叠加**：

1. `ch1-08-second-cycle`（第二周期，延迟线关）的奖励是 `and3`：一个讲两拍延迟的关卡把三输入与门发了出去。之后第 9、10、11 关按「上一关列表 + 新元件」的写法，把 `and3` 一路带进调色板。
2. 第 11 关的 `allowedComponents` 因此直接包含「本关要造的元件」。项目其实有这条规则——第 10 关不提供 `or3`，第 12 关不提供 `xnor`——但只靠人工遵守，门禁里没有任何断言看得见它。

**为什么是硬伤**：`and3` 定价 4 个 NAND 等价门（`2 * AND`）、延迟一个节点，正好压在参考解（两个与门级联，4 门 / 2 层）的三星目标上，还快一格。评分器只认电路不认调色板（任何合法图都会被打分），所以唯一的防线就是 `allowedComponents`，它漏了就等于答案漏了；Agent 的 `list_parts` / `place_part` 走同一个 `offeredDefsFor`，一样能一步交卷。

**修复**：

- `and3` 的奖励从第 8 关移到第 11 关：先造出来、再发给你，与 2.x 里 `xnor` 的处理一致（第 12 关的注释记录了那条先例）。第 11 关因此既不列自己的奖励、又拿到它，`paletteDefsFor` 的 own-reward 规则对它保持无副作用。
- 第 9、10、11 关的 `allowedComponents` 删除 `and3`；第 9、10 关的谜题本来也用不到它。
- 注释同步：`part2.ts` 文件头（记录这次移动）、第 8 关（为什么不再发奖）、第 11 关（为什么列表里不能有它，以及拖进去会拿三星这一实测）、第 12 关（它列表的构成补上 `and3`）。

**测试**（`test/levels/ch1-part2.test.ts`，+6）：

- 「教哪颗门就不发哪颗门」：第 9 关无 `xor`、第 10 关无 `or3`、第 11 关无 `and3`、第 12 关无 `xnor`；第 7 关是写明了的例外（`const_on` 就是它的答案，也是它的教学点）。
- 单个 `and3` 的实测：`passed`、`{gate:4, delay:1, tick:0}`、三星——把「调色板是唯一防线」变成可执行证据。
- 奖励顺序：第 8 关没有 `rewards`，第 11 关的 `rewards` 是 `['and3']`。
- 红绿：把 `'and3'` 临时塞回第 11 关列表，新断言按预期失败（`expected [ 'nand', … ] to not include 'and3'`），移除后转绿。
- smoke（`test/smoke/ui.spec.ts`，+1）：`seedProgress(page, 10)` 把第 11 关变成续关点，断言 `.palette` 里没有「三路与门」按钮、而「与门」「或门」可用——托盘就是玩家和 Agent 实际看到的那张表；红绿同样验过（塞回 `'and3'` 后托盘上出现 1 个按钮，`toHaveCount(0)` 按预期失败）。

**没动的**：`docs/superpowers/plans/2026-09-25-turing-complete-phase0.md` 里那张速览表（它本来就停在 2.x 改版之前：`ch1-08-second-tick`、第 10 关解锁 `xnor` 等，文件自己也写着「权威定义始终是关卡数据本身」），以及 `xnor` / `or3` 既有的发奖位置。

**门禁**：`build` exit 0（295.94 kB / gzip 101.49 kB）、`test` 64 文件 / **1698 通过**、`smoke` **32 通过 + 2 跳过**。

### 追加（2026-10-17，用户要求「仔细检查所有关卡，不能有类似的失误」）

**做法：不读数据，打分。** 调色板决定「能放什么」，评分器却对任何合法电路打分——「这颗元件是不是答案」只能把元件接到关卡引脚上真的评一遍。于是对全部 56 关、每个 `allowedComponents` 里的元件、引脚到关卡输入/输出的所有接法（位宽必须相同；同一个关卡输入可以喂给元件的多个引脚，`NAND(a,a)` 就是这样变成非门的）逐个评分，另外扫四类「不用搭电路」的答案：

- `empty`：空板；
- `const`：只用常量源；
- `wire`：只用导线把输入接到输出；
- `one-part`：一个元件。

共 33 个命中、覆盖 18 关，全部逐条核对过关卡注释与测试：

- **唯一的意外命中就是用户发现的 `ch1-11-bigger-and-gate` ＋ `and3`**（已在上一条修掉：奖励移到第 11 关、9–11 关不再列它）。除此之外没有第二个「没写理由就出现在托盘上」的元件。
- 其余 32 个都是战营自己的设计，每一关的注释里都写了理由：本关就是讲那颗元件（第 1/2/3/7 关的教学关、第 14 关的四根直连导线）、元件是本关自己的奖励（`delay8`、`nand8`、`not8`、`mux8`、`decoder1/2/3`、第 44 关的 `instr_decoder`）、元件就是本关要「用」的现成件（`mem1` 在第 33 关、`ram8` 在第 38 关、`switch`/`and` 在第 24 关、`xor` 在第 28 关）、或者本关的功能就是它（第 32 关 = 第 33 关的 mux 加上总线框架）。第 2 章的「own reward 可以放进调色板」是写在关卡注释和批量测试里的成文规则（第 25/26/36/37 关都有测量：拿元件得几分、手搭得几分），不是漏网。

**固化成门禁**：`test/levels/palette-answer.test.ts`（4 条）

- `reports only the exemptions the table records`：出现表外命中就失败（把 `'and3'` 塞回第 11 关 → 报 `ch1-11-bigger-and-gate|one-part|and3`，已验证红绿）。
- `keeps every exemption load-bearing`：表里每一行都必须仍然命中（临时从第 35 关拿掉 `decoder1` → 该行变陈旧、测试失败，已验证红绿），表不会烂成过期白名单。
- 非空性：走完全部 56 关、评分次数 > 2000，扫空为空。
- 空板单独断言：任何关卡都不能被空板通过（这是完备性而不是政策）。

**Agent 那一半**：`main.ts` 的 `parts()` 走的就是 `offeredDefsFor`，所以「Agent 能放什么」=「托盘里有什么」。本机没有 `DEEPSEEK_API_KEY`（`agent-live` 两条 smoke 一直跳过），所以没有跑真模型；改为用 **Agent 的真实工具层**做确定性证明：`test/agent/palette.test.ts`（4 条）

- 第 11 关的 `list_parts` 不含 `and3`、`place_part('and3')` 被拒且错误信息指向 `list_parts`；同关 `place_part('and')` 正常放下——拒绝是关于那颗元件的。
- 第 39 关的 `list_parts` 不含 `counter8`（该关注释写明这是刻意扣下的答案），`place_part` 同样被拒。
- 全 56 关、dev 开/关两种模式：Agent 拿到的元件表恒为 `allowedComponents` 的子集（共 112 次走查），即 Agent 不可能拿到关卡列表之外的元件。
- `test/agent/host-fixture.ts` 的 `makeTestHost` 新增可选 `parts`，让这条测试用的是真实关卡调色板而不是桩表。

**没动的**：上面那 32 个「刻意的一步解」保持原样。它们是 2.x/3.x 战营的成文设计（关卡注释里逐条辩论过，批量测试里也测量过），而且大部分元件的唯一可放置位置就是它自己那一关——整体收紧等于改战营设计，不是修 bug；这条留给用户决定（结论里列了清单与代价）。

**门禁**：`build` exit 0（295.94 kB / gzip 101.49 kB）、`test` 66 文件 / **1705 通过**、`smoke` **32 通过 + 2 跳过**。