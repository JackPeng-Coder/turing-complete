# Phase 3 — 第 4 章「编程」+ 汇编 IDE 与调试器：决策账本

Plan: `docs/superpowers/plans/2026-10-08-turing-complete-phase3.md`
Spec: `docs/superpowers/specs/2026-09-25-turing-complete-replica-design.md`
Started: 2026-10-08（Asia/Shanghai），基线 `pnpm test` 37 文件 / 1227 用例全绿。

本文件是本阶段的**证据**：每个任务的实现者报告要点、评审结论、每一次裁决与延后项。
实现者与评审者只追加，不改写别人的条目。

## 裁决（控制器做出，记入此处）

| # | 裁决 | 理由 | 代价 |
|---|---|---|---|
| 1 | 第 4 章关卡携带参考 CPU（`LevelSpec.board`） | spec §11 风险表第 384 行许可「编程章节允许导入关卡提供的参考 CPU」；第 4 章的教学目标是写程序，不是把 CPU 再搭 7 遍 | 关卡数据里出现一份电路形状，必须与 `ch3-references` 同源（用同一个 builder 消除漂移） |
| 2 | 玩家程序经 `runChecks(graph, registry, spec, player?)` 第四参进入内核 | 玩家文本不属于关卡数据；`source` 与玩家缓冲区必须是两条通路 | `ProgramCheck` 增 `from`/`format`，`source` 变可选；`grade()` 同步增参 |
| 3 | 第 1 关（打孔编程）用「逐行 8 位二进制」格式 | 教学点是手工编码，不能用汇编器；玩家需要可读、可打错、可定位的格式 | 新模块 `src/asm/image.ts` 与一套行号错误契约 |
| 4 | 密码锁与迷宫走 `custom` + `params` 闭环 | `custom` 的设计用途原文就写着 mazes / dance machines；两个谜题各用一次，正是逃生舱的正当用法 | `CustomCheck` 增 `params`；`testcases.test.ts` 的 mismatch 种类断言要扩到 `custom` |
| 5 | IDE 交付编辑/汇编/运行/单步/寄存器-PC-程序 RAM 查看；**断点与反汇编延后** | 两者都不在阶段 3 的验收线上（验收线是参考汇编程序通过） | spec §6.3 的两项留到后续阶段，报告给用户 |
| 6 | 玩家程序随存档保存（`Progress.programs`） | 第 0 阶段验收含「刷新后进度保留」；程序就是玩家在这一关的全部工作 | `migrate()` 契约扩展；`tc.progress.v1` 键不变 |
| 7 | 第 4–7 章阶段划分采用 spec §12 表现有排法 | spec 第 239 行要求「阶段 3 启动时确定」 | 无 |
| 8 | 每任务评审合并为一次两段式评审（规格符合 → 代码质量） | 用户明确要求节省成本 | 评审者要在一次报告里给出两段结论，不得合并判断 |

## 任务状态

| 任务 | 内容 | 状态 | 证据 |
|---|---|---|---|
| T1 | 起始电路 `board` | **已完成**（含两次修正） | `9c92d0c` + `b62c4f5` + `8972931`；`pnpm test` 38 文件 / **1246 通过**；`pnpm build` 干净；`pnpm smoke` **20 通过（22.5s）** |
| T2 | 玩家程序通路 + 存档 | 未开始 | |
| T3 | `src/asm/image.ts` 机器码格式 | 未开始 | |
| T4 | `lock` / `maze` 两个闭环检查器 | 未开始 | |
| T5 | `Simulation.readState` + `src/levels/run.ts` | 未开始 | |
| T6 | 汇编 IDE + 调试面板 | 未开始 | |
| T7 | 第 50–52 关 | 未开始 | |
| T8 | 第 53–56 关 | 未开始 | |
| T9 | 章节装配与定点更新 | 未开始 | |
| T10 | 阶段收尾（build/test/smoke + 整分支评审） | 未开始 | |

## 环境事实（本机，2026-10-08）

- `pwsh` 工具实际是 **Windows PowerShell 5.1**（`$PSVersionTable` 未打印，但 `#Requires -Version 7`
  的 `tools/sdd/sdd-workspace.ps1` 拒绝运行）；本阶段的工作区目录因此手工创建，
  `.superpowers/sdd/.gitignore` 手工追加 `!2026-10-08-turing-complete-phase3/` 两行。
- 工具链走 `load_workspace_dependencies` 给的 bundled node + `pnpm.mjs`：
  `NODE_BIN=C:\Users\Administrator\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe`，
  `PNPM_BIN=…\dependencies\pnpm\bin\pnpm.mjs`。PATH 上的 `pnpm` 是 npm 装的 `pnpm.ps1`。
- 基线：`pnpm test` → 37 files / 1227 passed（3.45s）。

## 执行中的修正

**2026-10-08 T1 执行期修正（计划已同步改写）**：计划原写「`overtureBoard()` 按
`overtureMachine` 产出同一张电路，fixture 改为复用 builder」。读码后发现第 3 章那台机器
**没有输入端口通路**——它的程序从不读 `inp`，`move|inp|dN` 读到的是寄存器 6，被 6 级寄存器堆
发布为 0；而第 4 章每一关都要读输入。因此第 4 章的参考板改为「第 3 章 CPU 核心 + 输入端口
通路」。T1 的验收从「结构相同」改为「行为可证」（装载 `B1 8F`、写输入 `0x2A`、
断言 `OUT` 读到 `0x2A`）。第 4 章关卡 io 统一 8 位输入/8 位输出，一块板服务 7 关。
关于 fixture：计划一度改写为「fixture 不动」，但实现者交付的是**复用**（见下「裁决 1」），
评审确认该复用正确、且第 3 章测试一处未被削弱；两处记录现已统一。

## 任务证据

### T1 起始电路（`board`）— 已完成（评审：APPROVED WITH MINOR ISSUES）

**评审结论**：六项规格全部满足且有行为证据；输入通路的三条风险路径（写通路 / `out` 通路 /
跳转目标 `pc_in`）逐条核过，无 Critical。评审者独立复跑了三条门禁：`pnpm test` 38/1246、
`pnpm build` 干净、`pnpm smoke` 20/20（20.6s）。

**三次提交**：`9c92d0c`（`BoardPart`/`BoardWire`/`BoardInit` + `graphFromBoard` + `overtureBoard` +
`main.ts` 两个建图点）、`b62c4f5`（`inputId` 选项：`IN_<id>` + 源值 mux）、
`8972931`（`move|inp|out` 通路 + 用 `COND_BITS.b6` 取代比较器）。

**实测**：`pnpm test` 38 文件 / 1246 用例全绿（基线 1227）；`pnpm build` 干净；
`pnpm smoke` **20 通过（22.5s）**（本机修好后才可运行，见下）。

**行为证据**（`test/levels/boards.test.ts`，19 个用例）：
- 接线板 + `move|inp|d1`/`move|s1|out`，写入 `0x2A` → `OUT` 读到 `0x2A`；无 `inputId` 的板 → `0`。
- 接线板 + `move|inp|out`（`0xB7`），写入 `0x5C` → `0x5C`（修前恒为 0）；无 `inputId` 的板 → `0`。
- 接线板 + `loadi|42`/`move|s0|out` → `42`；`loadi|50`（立即数字段看着像 6）→ `50`。
- 结构钉：无 `inputId` 42 元件 / 95 连线；接线板 44 / 98；`overtureMachine()` 仍与
  `graphFromBoard('ref', overtureBoard())` 深度相等。

**本任务期做出的裁决**
1. **接受 fixture 复用 builder**（原计划禁止）。理由：它保住了第 3 章的三组反例旋钮
   （`jump`/`immediate`/`halt`），并给出一条强反漂移钉；代价是测试专用旋钮进了生产代码，
   已在文件里说明来源。评审需复核是否有第 3 章测试被削弱。
2. **输入端口是 `overtureBoard({ inputId })` 的选项**，缺省 = 第 3 章机器原样。
3. **`out` 通路改读 `moveSource`**：否则合法指令 `move|inp|out` 会静默发布 0——
   那正是「看起来对的程序发布 0」这类陷阱，本仓库拒绝交付。
4. **选择信号用 `COND_BITS.b6`**（第 3 章机器已有的独热线，`DEC.op` 与 `DEC.src` 是同一
   3 位切片）。实测：接线板 gate 729 → 675，**delay 两者都是 6**（实现者指出我给的
   「省 1 延迟」不成立，并按实测写注释）。
5. **本机 `pnpm smoke` 首次可运行**：两处环境修复——`playwright.config.ts` 的
   `vite preview` 加 `--host 127.0.0.1`（Vite 8 只绑 IPv6 `::1`，而配置探测 IPv4
   `127.0.0.1`，此前必然 180 秒超时），以及安装 Playwright 浏览器
   （`chromium-headless-shell`，本机原本只有 MCP 的 chrome）。

**评审留下的待办（已并入 T2 的 Part A 一起修）**
1. `test/levels/boards.test.ts` 里 `expect(overtureMachine()).toEqual(graphFromBoard('ref', overtureBoard()))`
   是**同义反复**（前者就是后者的调用），不能当反漂移证据；真正的钉是 42/95 计数、第 49 关的
   `643/6` 与逐拍断言。要改注释或换断言，不要说它证明了什么。
2. 接线板上缺两个用例：`calc` 保留 op 6 的字节 `[0x70, 0x9F]` 必须发布 0（证明选择信号
   不能污染 calc 的写通路）；用第 49 关那串已钉字节的循环程序在接线板上跑出 `21`
   （证明 `pc_in`/`pc_load` 未受影响、输入脚不能劫持跳转目标）。
3. `overture.ts` 里「第 4 章的目标从这张板量」写的是 643，而第 4 章用的是接线板 **675/6**，
   要点名清楚。
4. `overture.ts` 的「这个选项的全部门成本」措辞：`inputId` 选项本身的成本是 mux8 的 32 门，
   54 是「用比较器换独热线」这个选择的成本。
5. `graphFromBoard` 的坏下标抛错（`board.ts:41-43`）没有测试。
6. 打开带 `board` 的关卡时应 `fitView()`（`main.ts:431` 已有），否则第 4 章关卡只显示机器左侧
   三分之一（`camera {x:40,y:40,zoom:1}` 而板面跨 x≈40…2016）。

**根级待办（T10 前处理）**：`2468d61` 的提交信息缺 scope（AGENTS.md 规则 4 要求
`type(scope): summary`，应为 `fix(test): …`）；`9c92d0c` 的 body 在第 77 字节处有一个
字面退格符（`\x08`）。两者都在未推送的本地历史上，T10 收尾时一并修正并记录。

**遗留（不阻塞）**：`calc` 的保留 op 6/7 只有 `defs-cpu` 测试与注释覆盖，
没有板级行为测试（已并入上面第 2 条待办）。

## 延后项（本阶段结束时汇总给用户）

- 断点与反汇编视图（spec §6.3）——裁决 5。
- `README.md:115-116` 的 bundled node/pnpm 路径写的是旧机器的 `C:\Users\ME\…`，本机不存在。
