# 计划：内置 Agent（2026-10-16 开工）

上游文件：`2026-10-16-turing-complete-agent.md`（需求 A1–A6、事实 F1–F3、风险 R1–R4、探索结果）。
本文件是**当期正式计划**：任务、写范围、验收。粒度照 `2026-10-08-turing-complete-phase3.md`。

## 裁决（开工时定，用户未反对即按此走）

| 项 | 裁决 | 理由 |
| --- | --- | --- |
| 兼容面 | 只做 OpenAI 兼容 `POST {baseUrl}/chat/completions`，SSE 流式 | F1 实测 DeepSeek / Moonshot / 智谱都放行浏览器直连；Anthropic 要专用头，留作后续 |
| key 存放 | `localStorage` 新键 `tc.agent.v1`，设置页写明"同源脚本可见"并给一键清除 | 与 `tc.progress.v1` / `tc.sandbox.v1` 同一信任模型；只存内存会与 A1 冲突 |
| 工具面 | 只动**当前电路** + 运行/单步/复位/测试 + 电路导入导出；不跳关、不通关、不清档 | R4：状态类操作会让工具描述变长、模型更容易选错 |
| 视觉节奏 | 每条命令后 `await` 一个延时（默认 160ms，可调 0/×1/×2），随时可中断 | A5 要"逐个可见"；实测重绘链路只在 `store.set` 后触发，所以命令之间 await 就是逐帧 |

## 层与文件

新增顶层 `src/agent/`，位置与 `persist/` 同类：可以读 `core`/`asm`/`levels`/`app`，**不许读 `ui`**；
`ui/agent.ts` 是它唯一的界面。`test/conventions.test.ts` 的 `LAYERS` / `MAY_IMPORT` 同步加上 `agent`，
README 的 layout 块同步加上 `src/agent/`（否则 conventions 测试失败）。

```
src/agent/sse.ts         SSE 分帧：字节流 -> {event, data} 记录
src/agent/wire.ts        OpenAI 兼容的请求/响应/流式增量类型（手写，零依赖）
src/agent/client.ts      streamChat()：fetch + SSE -> 文本增量 + 拼装的 tool_calls
src/agent/config.ts      AgentConfig + tc.agent.v1 读写
src/agent/tools.ts       ToolSpec / defineTool / 参数校验 / 派发
src/agent/host.ts        AgentHost：agent 层向 app 要的那点东西（类型）
src/agent/ops.ts         circuitTools(host)：全部操作
src/agent/prompt.ts      系统提示词
src/agent/loop.ts        runAgent()：turn/step、工具执行、逐步延时、中断
src/ui/agent.ts          面板 + 首次配置对话框
```

## 任务

| # | 任务 | 写范围 | 验收 | 状态 |
| --- | --- | --- | --- | --- |
| T1 | SSE 分帧 + OpenAI 兼容流式客户端 + 配置读写 | `src/agent/sse.ts` `wire.ts` `client.ts` `config.ts` `test/agent/*` | 用假 fetch 喂一段真实形状的 SSE：文本增量按序回调；被切成任意字节边界仍能拼回完整 tool_call；`[DONE]` 结束；HTTP 401/网络错误变成可读中文 | 完成 |
| T2 | 工具注册表 + 操作面 | `src/agent/tools.ts` `host.ts` `ops.ts` `test/agent/ops.test.ts` | 假 host 上跑完"放两个元件、连一根线、删一根线、撤销"；参数缺失/类型错被拒；越界坐标被规范到网格 | 完成 |
| T3 | 循环 | `src/agent/loop.ts` `prompt.ts` `test/agent/loop.test.ts` | 假客户端返回 [工具调用, 无工具调用]：工具恰好执行一次、结果按顺序回填、第二步后结束；中断后不再发请求；每步之间有延时 | 完成 |
| T4 | 界面 | `src/ui/agent.ts` `style.css` `test/ui/agent.test.ts` | 首次启动显示配置对话框（会被记住，不再重复问）；面板显示对话、工具行三态、停止按钮；任何关卡/沙盒/dev 下都在 | 完成 |
| T5 | 接线 | `src/main.ts` `test/conventions.test.ts` `README.md` `test/smoke/ui.spec.ts` | host 的每个操作走的是人手同一条路径（`stack.push` + `onChange`）；撤销能撤销 agent 的改动；门禁三条全绿 | 完成 |
| T6 | 文档与账本 | `README.md` `docs/superpowers/specs/…` `.superpowers/sdd/2026-10-16-agent/` | README 说明 Agent 是什么、怎么配、不做什么；账本记录裁决与每步证据 | 完成 |

## 与计划的三处偏差（都已落进账本）

1. **首次配置卡片挡住了整个舞台**，把 24 个 smoke 用例全拦下。裁决：卡片保留（这是用户要的
   "首次启动要求自定义 API 信息"），但**只问一次**（`tc.agent.v1` 里记 `seen`），并且
   `hidden` 挂在**遮罩层**上而不是卡片上——隐藏卡片而留着遮罩，会得到一块看不见却能吃掉所有
   点击的玻璃。smoke 统一用一个 `open(page, url)` 帮助函数先过这道门。
2. **首次配置卡片压任务简报之上**（`z-index: 15` > 简报的 10）。反过来放的话，第一关的简报
   盖住配置卡片，卡片就成了一个没人能回答的问题。
3. `agentTest()` 必须**先订阅再 `startTest()`**：用例无法逐个演示的关卡会在 `startTest` 内部
   同步判完，订阅晚了就永远等不到通知。

## 不做的（写进 README 的限制）

- 不支持 Anthropic 消息格式（要专用请求头，且本机实测 403）。
- 不支持多轮之外的长期记忆/向量检索；对话只在当次会话里。
- 不让 Agent 改进度（跳关、通关、清档）、不发布全局变量、不装任何运行时依赖。
- 不做移动端布局。

## 依赖关系

T1 → T2 → T3 →（T4 与 T5 可并行，但同改 `README.md`/`style.css` 的文件只有一处写者：T4 写 `style.css` 与 `src/ui/agent.ts`，T5 写 `main.ts`/`toolbar.ts`/`conventions.test.ts`/`README.md`）。
