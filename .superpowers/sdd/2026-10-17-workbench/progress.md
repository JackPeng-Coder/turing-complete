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

- 侧栏宽度、下方面板高度是固定值，没有拖拽分隔条；折叠只能通过面板标签 / 活动栏 / 收起箭头。
- 真模型端到端（`agent-live.spec.ts`）仍需要 `DEEPSEEK_API_KEY`，本机没有 key，未跑。
- 地图打开时侧栏、下方面板仍在原位（VSCode 的行为），下方面板显示的是上一个关卡的用例。
