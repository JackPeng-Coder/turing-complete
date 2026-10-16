# 计划：内置 Agent（自然语言操作电路）

状态：**探索中，2026-10-16 12:00 开工**。这份文件先只记录需求、已确认的事实和待定项；
具体设计留到开工后按当期计划展开（与 `2026-10-16-turing-complete-chapters-5-7.md`
同一粒度习惯）。

## 1. 需求（用户原话拆解）

| # | 要求 | 验收 |
| --- | --- | --- |
| A1 | 首次启动要求用户自定义 API 信息 | 没有配置时不进游戏主界面 / 或弹出一次性设置，填 base URL、key、model；可跳过；之后能在设置里改 |
| A2 | 自然语言发给 Agent，Agent 自动调用后台方法操作电路 | 输入一句中文，电路按预期变化，不需要人手点 |
| A3 | 覆盖人能做的所有操作（最好） | 工具栏、调色板、蓝图、存档、导入导出等每条人手路径都有一个对应工具；缺口要列出来而不是假装覆盖 |
| A4 | 任何模式都能用 | 关卡模式、沙盒、`?dev=1` 里都能唤起 Agent 面板 |
| A5 | 搭建/修改时逐个创建修改的视觉效果 | 每一步单独可见（放置、连线、删除逐条发生），不是一次性刷新成结果 |
| A6 | 其他做法参考文本生成 Agent 项目 | 参考 `C:\Users\Administrator\Desktop\deepseek-harness\`（DeepSeek Harness 源码）：provider 配置、工具声明与派发、流式输出、工具调用在界面上的呈现 |

## 2. 已确认的事实

**F1（关键）浏览器直连大模型 API 可行** —— 2026-10-16 实测预检请求：

| 端点 | `Origin: http://localhost:5173` | `Origin: null`（file://） |
| --- | --- | --- |
| `api.deepseek.com/chat/completions` | 200，回 `access-control-allow-origin`、`allow-headers: authorization,content-type` | 200，回 `access-control-allow-origin: null` |
| `api.moonshot.cn/v1/chat/completions` | 204，同上 | 未测 |
| `open.bigmodel.cn/api/paas/v4/chat/completions` | 200，同上 | 未测 |
| `api.anthropic.com/v1/messages` | 403（需要专门的浏览器直连请求头） | 未测 |
| `api.openai.com/v1/chat/completions` | 超时（本机网络不可达） | 未测 |

失败响应也带 CORS 头（实测 401 的 body 可在跨域下读到），所以配置错误能显示成可读的错误，
而不是一个静默的 `TypeError: Failed to fetch`。

**F2 不必新增运行时依赖** —— `src/` 目前零网络代码（`fetch`/`XHR`/`WebSocket` 全无）。
浏览器自带的 `fetch` + 手写 SSE 解析即可，`package.json` 的 `dependencies` 仍然为空，
`test/conventions.test.ts` 的依赖规则不受影响。

**F3 参考项目的体量** —— `deepseek-harness` 是 16255 文件的 pnpm monorepo，
值得抄的是它的**结构**（provider 配置 → 工具声明 → 派发 → 流式呈现），不是代码。

## 3. 待定（开工时先问用户，或先按推荐值走）

1. 兼容面：只做 OpenAI 兼容的 `chat/completions`，还是把 Anthropic 消息格式也做进去。
2. key 的存放：`localStorage` 明文（本项目现有存档全在这个级别）还是只存内存、每次启动重填。
3. 工具面边界：是否允许 Agent 动**进度**（通关、跳关、清档），还是只动当前电路。
4. 视觉节奏：每步固定延时（可调快慢）还是"下一步"逐步确认；能否中途打断。

**默认值**（用户没回答就按这个走，开工当天写进当期计划和 SDD 账本）：

| 项 | 默认 | 一句话理由 |
| --- | --- | --- |
| 1 兼容面 | 只做 OpenAI 兼容的 `POST {base}/chat/completions` + SSE 流式 | 实测 DeepSeek / Moonshot / 智谱三家都通；先跑通一套协议，Anthropic 的专用请求头留作后续 |
| 2 key 存放 | `localStorage` 新键（与 `tc.progress.v1` 同级），设置页写明"同源脚本可见"并给一键清除 | 只存内存就和 A1「首次配置一次」矛盾；这里沿用本项目既有的信任模型 |
| 3 工具面 | 只动**当前电路** + 运行/单步/复位 + 电路导入导出；不碰进度（不跳关、不通关、不清档） | 见 R4：状态类操作会让工具描述变长、模型更容易选错 |
| 4 视觉节奏 | 每步固定延时（默认 ~120ms，可调 ×0.5 / ×1 / ×2），随时可中断 | A5 要"逐个可见"，逐步确认会逼人一直点

## 4. 已知风险

- R1 任意 base URL 都可能因 CORS 失败：报错必须说清是"对方不允许浏览器直连"，并给出改用代理的办法。
- R2 把电路状态序列化进 prompt 会随电路变大而变贵：需要一层"给 Agent 看的电路摘要"，不是原始 JSON。
- R3 `localStorage` 里的 key 对同源脚本可见；这是本项目的既有信任模型，但要在设置页写明。
- R4 A3 的"所有操作"里，撤销/重做、运行、单步这些和电路无关的状态操作若也暴露，会让工具描述变长、模型更容易选错。

## 5. 相关文档

- `AGENTS.md`：零运行时依赖、层序 `core <- asm <- levels <- app <- ui`、门禁三条命令。
- `docs/superpowers/specs/2026-09-25-turing-complete-replica-design.md` §1.4：不得提交原作美术资源。
- `docs/superpowers/plans/2026-10-16-turing-complete-chapters-5-7.md`：第 5–7 章的路线图，本期不冲突。

## 6. 推送账户（用户追加要求）

用户要求最后用 **JackPengCoder** 的账户推送。开工前查过，本来就是：

- `origin` = `https://github.com/JackPeng-Coder/turing-complete`（fetch / push 同一个）
- 仓库级与全局 `user.name` / `user.email` = `JackPeng-Coder` / `jackpeng-coder@qq.com`
- `credential.helper = manager`；Windows 凭据里存着 `git:https://JackPeng-Coder@github.com`
- 上次推不动的现象是 Git Credential Manager 弹窗在非交互 shell 里挂住，不是账号错。所以：`git push origin master` 前加 `GIT_TERMINAL_PROMPT=0`，失败就把提交留在本地并说明，不要换账号。

## 7. 探索结果（2026-10-16 上午，两份只读调研）

### 7.1 参考项目 DSH 里值得抄的形状

| 形状 | 出处（DSH 仓库内相对路径） | 抄什么 |
| --- | --- | --- |
| 工具声明 | `packages/core/tools/src/schema.ts:554` `defineTool({name, description, parameters, output, execute, presentCall, presentResult})`，`parameters` 是自定义小 DSL → 编译成 JSON Schema，**调用前校验**，只有 name/description/parameters 进模型 | 一个 `defineTool` 等价物 + 参数校验先行；`presentCall`/`presentResult` 是**纯函数**，只描述"该怎么画"，不碰 DOM |
| 工具派发 | `packages/core/agent-loop/src/tool-calls.ts:60`；按 `isConcurrencySafe` 决定并行池还是串行栅栏，**结果严格按模型给出的顺序落账** | 我们只需要串行（要逐步可见），但"结果按模型顺序落账"要保留 |
| 回合/步 | `agent-loop/src/agent.ts:252` `while (await this.turn())`；`preStep` 组 prompt，`step/start`/`step/end` 夹住一次模型调用 | turn/step 状态机 + `AbortController` 贯穿请求与每个工具 |
| 终止 | `agent.ts:550` 没有工具调用即完成；**全仓没有 `maxIterations`**，只有 `maxParallelToolCalls`、每工具 `timeoutMs`、重复调用提醒 | 不设迭代上限，改用"没工具调用就停 + 可中断 + 每工具超时" |
| 流式 | `llm/llm-deepseek/src/sse.ts:13` 解 SSE，`accept: text/event-stream`，`stream: true` | 手写 SSE 解析；工具参数是**流式拼出来的 JSON**（`util/values/src/partial-json.ts:76`），所以"preparing"状态能显示正在生成的参数 |
| 界面呈现 | `client/ui-tool/.../ToolCallTree.tsx` 每个工具名注册一个行组件，`preparing | start | result` 三态，差量视图 `FileDiff{path,oldText,newText}`；时长 = `result.time - call.time` | 工具行三态 + 每个工具自己的"差量描述"（对我们就是"加了一个与非门 / 连了一根线"）；时长也照着算 |
| 首次配置 | 没有 CLI 提示，是浏览器里的 onboarding（`client/ui-settings-models/src/client/store.ts:374`）；key 当**引用**存，真值进凭据库 | 我们要的就是"首次启动让用户填"，天然对齐；但我们没有 host，key 只能进 `localStorage`（见默认值 2） |

不可抄的部分：host 进程、WebSocket 传输、`node:fs`/`node:child_process`、磁盘上的 JSONL 会话与凭据库。可抄的正好是**纯浏览器能跑的那一半**（循环、工具注册表、渲染意图、事件日志）。

### 7.2 本仓的操作面与程序化入口

**入口形状**：`Command{label, do(graph), undo(graph), blueprints?, blueprintsBefore?}`（`src/app/commands.ts:12`）；`CommandStack.push/undo/redo/clear/depth/canUndo/canRedo/current`（`commands.ts:87`）；`Store.get/set/update/subscribe`（`src/app/store.ts:137`，同步、无条件通知）。
**现状障碍**：`src/main.ts` 不导出任何东西，`store`（:56）与 `stack`（:82）是模块级私有，且所有挂载都在 `if (app)`（:160）里；全仓没有发布过全局。→ Agent 要么让 `main.ts` 导出这几个句柄，要么自带一套。

**重绘链路（决定"逐步可见"怎么做）**：唯一的画笔是 `paint()`（`main.ts:278`），仅由 `store.subscribe`（`main.ts:1378`）和 resize 触发；`stack.push` **本身不重绘**。板面改动走 `attachBoardInput` 的 `options.onChange()` → `rebuild()`（:519）→ `measure()`（:721）→ `store.set({metrics,...})`（:730）→ 订阅者 → `paint()`。所以每一步之间 `await` 一个延时再调 `onChange()` 就能得到逐步动画；全仓无 `requestAnimationFrame`。

**可撤销的（走 `stack.push`）**：放置元件、移动、连线、断开输入、删导线、删元件、删除选中、封装确定（`wrap <id>`）、撤销/重做本身。
**不可撤销的（直接改 state）**：选择/框选、相机平移缩放、网格开关、调色板选件、I/O 位翻转、时钟频率、运行/暂停/单步/停止复位、测试与判分、开关卡/开沙盒、地图与说明面板、程序文本与汇编/单步/运行/速度、调试器翻页、封装草稿与命名、进出元件内部、重命名、删除元件定义、导出/导入电路。
→ 默认值 3 已经把工具面收在"当前电路 + 运行/单步/复位 + 导入导出"，正好覆盖上表里电路相关的那些；**跳关/通关/清档不暴露**。

**约束（本仓）**：层序 `core ← asm ← levels ← app ← ui`，`persist` 与 `app` 平级；只有 `ui` 能 import 所有层（`test/conventions.test.ts:119`），`app` 不许 import `ui`（:118）。新建顶层 `src/<dir>/` 不在 `LAYERS`（:95）里、不受层序判，但 README 的 layout 块必须写上它（:207）。`dependencies` 必须为空（:239），新 devDependency 必须精确版本（:243）。`style.css` 不许出现阴影（:267），圆角只允许 `.bit` 与 `.result-medal`（:271）。→ **LLM 客户端放 `src/ui/` 是合法的**；若单开一层，要同步 README。

**持久化**：只有两个键——`tc.progress.v1`（`persist/storage.ts:15`）与 `tc.sandbox.v1`（`persist/sandbox.ts:19`）；沙盒自动存档在 store 订阅里按 `circuitSignature` 比对后才写（`main.ts:1389`）。→ 新增 `tc.agent.v1` 放 API 配置与对话记录，与既有两键同级。
