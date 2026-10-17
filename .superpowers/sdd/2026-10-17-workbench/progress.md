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
