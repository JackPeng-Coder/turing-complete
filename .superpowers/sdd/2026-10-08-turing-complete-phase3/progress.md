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
| T1 | 起始电路 `board` | **已完成**（含两次修正） | `0175f86` + `839efe5` + `cd85377`；`pnpm test` 38 文件 / **1246 通过**；`pnpm build` 干净；`pnpm smoke` **20 通过（22.5s）** |
| T2 | 玩家程序通路 + 存档（并入 T3） | **已完成**（评审：APPROVED WITH MINOR ISSUES，遗留已并入 T4 的 Part A） | `1f9b6a9` + `8616949` + `f4d88ed`；`pnpm test` 39 文件 / **1279 通过**；`build` 干净；`smoke` 20 通过 |
| T3 | `src/asm/image.ts` 机器码格式（并入 T2） | **已完成** | `8616949`；`test/levels/image.test.ts` 10 个用例 |
| T4 | `lock` / `maze` 两个闭环检查器（含 T4b 修复） | **已完成**（评审 CHANGES REQUIRED → 修复后逐条红→绿，见下） | `8cd8cab` + `92c508f` + `0ea1592` + `5fb7398` + `922396d` + `a333623`；`pnpm test` 41 文件 / **1360 通过**；`build` 干净；`smoke` 20 通过 |
| T5 | `Simulation.readState` + `src/levels/run.ts`（并入 T6） | **已完成** | `f875a3f` + `9000537` |
| T6 | 汇编 IDE + 调试面板（并入 T5） | **已完成**（评审：APPROVED WITH MINOR ISSUES；I1/I2/I3/M1/M3/M5 已并入 T6b 修复） | `f138f7b` + `f875a3f` + `9000537` + `912ef8c`；`pnpm test` 44 文件 / **1399 通过**；`build` 干净；`smoke` 20 通过 |
| T7 | 第 50–52 关 | **已完成**（评审 CHANGES REQUIRED → 修复轮 1 后 scoped 复审：全部 ADDRESSED） | `4a60852` + `2a6849d`；修复后 `pnpm test` 46 文件 / **1435 通过**；`build` 干净 |
| T8 | 第 53–56 关 | **已完成**（评审：APPROVED，2 Minor 延后） | `b51a065`；`pnpm test` 47 文件 / **1470 通过**；`build` 干净 |
| T9 | 章节装配与定点更新 | **已完成**（评审：APPROVED，5 Minor 延后） | `e1e6e5a`；`pnpm test` 48 文件 / **1495 通过**；`build` 干净；`smoke` 20 通过 |
| T10 | 阶段收尾（build/test/smoke + 整分支评审） | **进行中**（见文末「T10」） | |

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

**三次提交**：`0175f86`（`BoardPart`/`BoardWire`/`BoardInit` + `graphFromBoard` + `overtureBoard` +
`main.ts` 两个建图点）、`839efe5`（`inputId` 选项：`IN_<id>` + 源值 mux）、
`cd85377`（`move|inp|out` 通路 + 用 `COND_BITS.b6` 取代比较器）。

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

**根级待办（T10 前处理）**：`06acea7` 的提交信息缺 scope（AGENTS.md 规则 4 要求
`type(scope): summary`，应为 `fix(test): …`）；`0175f86` 的 body 在第 77 字节处有一个
字面退格符（`\x08`）。两者都在未推送的本地历史上，T10 收尾时一并修正并记录。

**遗留（不阻塞）**：`calc` 的保留 op 6/7 只有 `defs-cpu` 测试与注释覆盖，
没有板级行为测试（已并入上面第 2 条待办）。

### T2 + T3 玩家程序通路与机器码格式 — 已完成（评审：APPROVED WITH MINOR ISSUES）

**执行裁决（成本）**：把原计划的 T3（`src/asm/image.ts`）并入 T2 同一次派发，减少一轮实现者与
评审的往返。T3 以独立提交 `8616949` 落地，评审覆盖两次提交。

**提交**：`1f9b6a9`（T1 评审的五条遗留）、`8616949`（`parseImage`）、`f4d88ed`（通路 + 存档）。

**实测**：`pnpm test` 39 文件 / 1279 用例全绿；`pnpm build` 干净；`pnpm smoke` 20 通过。
`8616949` 另用 stash 单独验证过（1259 用例、tsc 0）。

**评审确认**：通道解析无泄漏（缺第四参 / `''` / 纯空白 → `missing-program`；关卡通道与玩家通道
互不串用、各有测试）；`Progress` 只有 `emptyProgress`/`migrate`/`applyGrade` 三个构造点，
三者都带上 `programs`（实现者自己发现：不改 `applyGrade` 会让每次通关静默删掉玩家程序——
这是本阶段最有价值的一处自查）；`stripComment` 共享后汇编器行为未变。

**评审遗留 → 已并入 T4 Part A**：`grade()` 第四参转发缺覆盖（0/100 调用点）；未知
`from`/`format` 静默回退（`from:'players'` 会静默评关卡自己的文本）；`parseImage` 只认 U+0020
作分隔符（制表符会报引号里看不见的字符）。

**实现者的两个判断（已接受）**：「空字段」定义为连续两个空白（字面规则会*接受* `1011  0101`，
只有这个读法才产出错误）；`parseImage` 的规则同时写进模块头部，便于 IDE 帮助面板引用。

### T4 闭环检查器（lock / maze）— 已完成（评审进行中）

**提交**：`8cd8cab`（空白分隔）、`92c508f`（`params` + 玩家程序 + 通路因子化）、
`0ea1592`（lock）、`5fb7398`（maze）。

**实测**：`pnpm test` 41 文件 / 1331 用例全绿；`pnpm build` 干净；`pnpm smoke` 20 通过。

**落地形态**：`resolveProgramText`（通道规则）、`loadProgramImage`（解析 + 定位 ram_prog +
`reset()` 后载入）从程序分支因子化并导出，程序分支的失败记录保持逐字节不变；
`CustomChecker(io, spec, check, player?)` 让检查器拿到自己的 `params` 与玩家程序；
两个检查器只用 `io.reset/writeInput/readOutput/tick`（不碰 `io.sim`），因此可以用
`test/fixtures/level-io.ts` 的脚本化 stub 直接做单元测试（18 + 26 个用例）。

**实现者的偏差（评审需复核）**：
1. `loadProgramImage` **没有** `spec` 参数（`noUnusedParameters` 会拒绝未用参数，且该函数不从
   关卡取任何东西，唯一关卡来源是 `check.ram`）。
2. 简介里「右手沿墙解 L 形迷宫」不可满足：右手法则解不了普通 L 形走廊（右侧敞开会被转回去），
   测试改为「单格宽闭环迷宫 + 参考算法 10 拍到达终点并断言路线」。
3. `test/fixtures/level-io.ts` 的 stub 带一处有注释的 cast（`sim`）。

### T4 闭环检查器（lock / maze）— 评审 **CHANGES REQUIRED**，修复中（T4b）

**评审实测**：`pnpm test` 41 文件 / 1331、`build`、`smoke` 20 全绿——**但绿的门禁掩盖了两个真缺陷**，
因为两个检查器的单元测试走的是脚本化 stub，stub 只模仿接口、不模仿内核时序。

**Critical（必须修）**
- **C1 玩家程序根本没进电路。** `callLock(io, _spec, _check, _player)` 忽略玩家参数、什么都没载入；
  `loadProgramImage` 的唯一调用者是 `program` 分支，而每个 check 各自一个 `Simulation`，
  兄弟 check 帮不上忙。按计划第 54 关只有 `custom: lock` 一个检查器 ⇒ `ram_prog` 全 0、
  玩家的程序从不执行、**关卡无解**（除非 secret 为 0）。
- **C2 没有任何检查器复位电路，第一次 `readOutput` 读到的是伪造的 0。** `createSim` 只编译绑定，
  custom 分支不复位；于是 `lock` 在 `secret: 0` 时会**在任意板子上通过**（包括没有 CPU、
  连 `IN_match`/`OUT` 都没有的板子），`ticksUsed: 0`——这是一个 fail-open 的通过。

**Important**：I1 写输入后不 settle 直接 tick，会锁存**上一拍**的字节（内核注释写明），
而第 4 章参考板把输入脚经组合逻辑接到 CPU，两个检查器的注释却断言相反；
I2 `params.budget` 没有上限（1e9 会让每次编辑都跑十亿次 settle，`FUZZ_ROUNDS_CAP` 就是为这类事存在的）；
I3 两处记录与事实不符（maze 说最后一拍「未施加」其实已施加并已锁存；lock 的 budget 单位是拍、
maze 的是步，注释与测试互相矛盾）；I4 检查器硬编码引脚名却忽略 `spec`，关卡换了引脚名就会
把 `invalid` 的锅甩给检查器而不是关卡数据。

**修复（T4b）**：检查器自己载入玩家程序（共享 helper）、开头 `io.reset()`、
给 `LevelIo` 加 `settle()` 并把协议改成「读输出 → 写输入 → settle → tick」、
给 budget 加上限常量、改正失实记录、开头上前校验关卡引脚；
**并要求用真实电路（`overtureBoard` + 内核 `compile`/`bindLevelIo` + `runChecks` + 参考程序）
写验收测试**——这三条缺陷正是因为测试只走 stub 才活下来的。

**评审也确认了做对的部分**：通道解析无泄漏、失败记录契约（除 I3）、迷宫四向与边界几何正确、
机器人不会走出网格、`ticksUsed` 语义与 `Math.max` 合并正确、没有重复计数或漏掉最后一拍、
未触碰 `src/levels/content/**` 与 `testcases.test.ts`。

### T4b 修复（评审 CHANGES REQUIRED 的回应）— 已完成

**提交**：`922396d`（`LevelIo.settle()` + 协议）、`a333623`（检查器载入玩家程序 + 复位 + budget 上限 +
记录改正 + 引脚校验）。**实测**：`pnpm test` 41 文件 / **1360 通过**（+29）；
`pnpm build` 干净；`pnpm smoke` 20 通过。

**逐条缺陷的红→绿证据**
- **C1**：真实电路验收测试先红（检查器对着全 0 的 `ram_prog` 读了 4096 拍）；修后参考程序 +
  `{secret: 42}` **在第 590 拍通过**，空文本 → `missing-program`，载入的镜像与参考字节一致。
- **C2**：`emptyGraph` + `{secret: 0}` 修前**在第 0 拍通过**（fail-open）；修后 `missing-io` 并点名 `ram_prog`。
- **I1**：协议日志修前没有 reset/settle；修后为 `reset … readOutput → writeInput → settle → tick`。
  机器级证据：有 settle 时板子发布**刚写入**的字节（`0x2a`/`0x5c`），没有 settle 时发布**上一拍**的
  字节（`0x33` vs 应有 `0x5c`）——正是内核注释里的那个陷阱。
- **I2**：上限测试修前跑了 **14 096** 次交换；修后恰好 **4096**（`CUSTOM_BUDGET_CAP`，超限钳制，
  非整数/0/负数仍 `invalid`）。
- **I3**：maze 的「未施加」改为「after applying move 3」；lock 改为恰好 budget 次交换，
  测试里那句注释现在字面为真并被断言。
- **I4**：引脚名不符的关卡修前照跑；修后一条 `invalid` 点名缺失/多余/过窄的引脚，什么都不驱动。

**只有真实电路才能暴露的六件事（评审从代码看不出来，实现者测出来了）**
1. **闭环关卡必须 `halt: false`**：默认板会在第一次 `move|sN|out` 冻住 PC（实测锁卡在 PC=2、
   `try` 恒 0），第 54/56 关将无解。已写进计划与 `reference-programs.md`。
2. **参考迷宫程序原本只读一次传感器**：三个回边都跳到地址 1，而读 `inp` 在地址 0。
   已修正为跳回 0（字节 15/21/25 由 `01` 改 `00`），并用汇编器复核了 27 字节。
3. **锁的 `match` 在现行机器语义下不可观测**：`out` 是组合输出、只在写它的那条指令期间发布，
   读 `match` 是另一条指令，那一拍 `out` 已回落为 0 ⇒ 程序采样到的 match 恒 0，
   参考程序的「找到就自旋」分支实际不执行。**本阶段不改机器**（给 `out` 加寄存会推翻第 3 章的
   `halt` 教学设计），而是把局限如实写进关卡 brief 与最终报告。
4. **关卡 io 必须 8 位**：板的连接器是 8 位，`match:1`/`sensors:3` 会在 `bindLevelIo` 就宽度不符。
5. **`secret: 0` 在真实板上第一拍即通过**（板子在任何指令发布前读到的就是 0）⇒ 关卡数据取 42，并留一条测试钉住这个行为。
6. `custom/index.ts` 现在从 `checks.ts` 取 `CUSTOM_BUDGET_CAP`，而 `checks.ts` 又从
   `custom/index.ts` 取 `getCustomCheck`——模块图上多了一条边（两种导入顺序都有测试覆盖，无 TDZ 问题，
   但属于可以消掉的坏味道，已列入 T6 的清理项）。

### T5 + T6 运行面、汇编 IDE 与调试器 — 已完成（评审：APPROVED WITH MINOR ISSUES）

**执行裁决（成本）**：T5（`readState` + `run.ts`）与 T6（IDE + 调试面板）合并为一次派发。

**提交**：`f138f7b`（Part A：消掉 custom↔checks 运行期环、恢复通道措辞、`ram` 非字符串判 invalid）、
`f875a3f`（`Simulation.readState`）、`9000537`（`src/levels/run.ts`）、`912ef8c`（IDE + 调试面板）。
**实测**：`pnpm test` 44 文件 / **1399 通过**（+39）；`pnpm build` 干净；`pnpm smoke` 20 通过。

**评审确认**：八项规格全部满足、三条门禁复跑全绿、第 1–3 章盘面 DOM 一字未变
（`levelExpectsProgram` 对当时全部 49 关为假，bench 处于休眠态）；`ide.ts` 在 textarea 上截住
keydown 是必要的（`interact.ts` 的监听在 `globalThis` 上且没有 `event.target` 守卫，否则退格会删元件、
Ctrl+Z 会撤销电路）。

**评审的关键发现（I1，必须在第 4 章数据之前修）**：盘面由 `createDisplay` 自己的 `Simulation` 绘制，
而它**从不 `loadImage`**——画出来的 CPU 永远在执行全 0 程序；IDE 与调试器读的却是 `ProgramRun`
那台已载入镜像的机器。于是点五次「单步」后，调试器显示 5 拍而同屏的时钟卡显示 0 拍、关卡的 `out`
行显示的是零程序电路的值。修法（T6b）：**两台机器合并成一台**。另有 I2（调试面板的 RAM 缓存永不命中，
平移缩放都会重建 72 个格子）、I3（`errors` 的「非空即未载入」在引脚宽度不符那条路径上是假的）、
M1（程序被拒后调试面板仍在描述一台从未启动的机器）、M3（一句过时注释）、M5（切到地图后程序计时器不停）。

**显式延后（报告给用户）**：断点与反汇编（裁决 5）。

### T6b 盘面与运行共用一台机器 — 已完成

**提交**：`b351f48`（I1 + I3 + M1 + M5）、`69eab92`（I2）、`f1add6d`（M3）。
**实测**：`pnpm test` 45 文件 / **1406 通过**；`pnpm build` 干净；`pnpm smoke` 20 通过。

**I1 的红→绿（真实数值）**
- 修前：点五次「单步」后 `display.read().tick === 0`（IO 面板的时钟卡）而 `run.ticks === 5`
  （调试器），关卡的 `out` 行显示的是全 0 程序的值。评审描述属实且更宽。
- 修后：`display.read().tick === 5`、`run.ticks === 5`、`levelOutputs.get('out') === 0x2A`、
  `readOutputs() === { out: 0x2A }`、`REG1 === 0x2A`（输入 `0x2A`）。
- 做法：`ProgramRun.machine` 暴露 `{net, sim}`；`createDisplay(..., machine?)` 优先绘制这份机器，
  且**不对交进来的机器调用 `reset()`**（那会抹掉刚载入的镜像）；没有机器时行为与从前逐字节相同
  （另有测试钉住「无机器时自己编译一份」）。`core/net.ts` 未改。
- 连带发现：`mountBench()` 原本开头就 `dropPlayerRun()`，会把 `rebuild()` 刚建好的那台丢掉、
  再给面板建第二台——正是同一个 bug 换了张面孔。该调用移到 `openLevel()`，并在 `mountBench`
  的注释里写明它为什么不能拥有这台机器。

**其余**：I3 改为契约成真（电路级句子在载入之前追加，且此时跳过载入，非空 `errors` 真的等于
什么都没载入）；M1 让 `stateOf`/`readHalt`/`readRam`/`machine` 都过 `idle()`，被拒的程序显示破折号
而不是构造函数的零表；I2 改成按字节内容比较（并修掉它自己引入的两个新 bug：`null` 哨兵让首帧
看起来像未变、`sameBytes` 必须把 `null` 只与 `null` 视为相等）；M5 放在 `onOpenMap`。

**遗留（不阻塞，报告给用户）**：`main.ts` 没有 app harness，接线只在改动的接缝上被钉住；
M5 没有单测；`display.reset()` 现在连运行的存储一起清（同一台机器的必然结果，属新耦合）。
按裁决 8，T6b 的复核并入 T10 的整分支评审，不单独再派一次评审。

## 延后项（本阶段结束时汇总给用户）

- 断点与反汇编视图（spec §6.3）——裁决 5。
- `README.md:115-116` 的 bundled node/pnpm 路径写的是旧机器的 `C:\Users\ME\…`，本机不存在。
  （2026-10-10 续跑于 `D:\Documents\turing-complete`：本机 bundled 路径与 README 一致，此项已不成立。）

## 控制器预检（2026-10-10，T7 派发前；续跑于新主机 `D:\Documents\turing-complete`）

**环境**：基线复核通过——`pnpm test` **45 文件 / 1406 用例全绿**（与 T6b 记录一致，2026-10-10
13:46 实测）。本机 bundled node/pnpm 路径与 README「Running it」一致，`pwsh` 为 7.6.6。

**上下文恢复**：用户要求撤销 `cd6a280`（「又没钱了，先提交一下」的临时提交），本地历史已回到
`f1add6d`，工作区干净。该提交的内容（progress.md 的 T5/T6/T6b 三节、reference-programs.md 的
「板子的指标」表、9.5MB 会话压缩包）**不在工作区**；前两项属阶段记录、按计划的写范围表归 T10
所有，将在 T10 收尾时一并写回并按 Conventional Commits 提交；压缩包按 AGENTS.md
「会话记录不留工作区」的约定不入库。`cd6a280` 已在 origin/master 上，历史改写后的推送需要
force-push，未经用户同意不强推。

**T7–T10 预检扫描（计划冲突自查）**

| 任务对 / 任务 | 共享面 | 检查结果 | 裁决 |
|---|---|---|---|
| T7 ↔ T8 | `test/fixtures/ch4-references.ts`（T7 建、T8 追加） | 参考解形状必须同时容纳 bytes/asm 与 custom 关卡的玩家程序 | **R1**：`CH4_REFERENCES: Record<string, { program: string; format: 'asm' \| 'bytes' }>`，键=关卡 id；板不进 fixture，用关卡自己的 `board` 建图 |
| T7/T8 ↔ T9 | `content/ch4/**`、`campaign.ts`、`content/index.ts` | T7/T8 不注册关卡，T9 装配；ids/index 必须与 campaign 行一致（50–56） | **R2**：批测试直接 import `CH4_BATCHn`；注册只在 T9 |
| T7/T8 ↔ T9 | `level-buildability.test.ts` 的 `REFERENCE_SOLUTIONS` | 第 4 章参考解是「板 + 程序」 | **R1** 同时给出：T9 把 `REFERENCE_SOLUTIONS` 扩成支持 `{ program }`（图由关卡 `board` 建） |
| T9 ↔ T10 | `test/smoke/ui.spec.ts`（T9 改地图格数，T10 加第 50 关冒烟） | 顺序写，无冲突 | 无 |
| T8 自身 | 第 56 关迷宫图案计划未给定 | 计划/参考程序只给算法不给迷宫 | **R3**：迷宫由实现者设计，必须可解、参考解必经、平凡「一直前进」程序必须失败；图案写进关卡 brief 并被测试钉住 |
| T7 自身 | 模板 `ch3-batch3.test.ts` 依赖 `check.source` | 第 4 章关卡 `from:'player'`、无 `source` | **R4**：source 相关断言改为 fixture 程序断言；空/坏程序反例走玩家通路 |
| T7–T10 共通 | 计划把提交落在 master | T1–T6b 全部直接提交在 master（本账本为证），用户指令是「继续执行任务」 | **R5**：继续在 master，等同用户的继续指令即同意 |
| T7–T10 共通 | `.superpowers/sdd/…` 阶段记录 | 计划的写范围表把阶段目录划给 T10 | **R6**：实现者只提交代码/测试（显式路径暂存，禁止 `git add -A`），报告文件不提交；阶段记录在 T10 一次提交 |

### T7 第 50–52 关 — 已实现（`4a60852`），评审进行中

**提交**：`4a60852` `feat(levels): add chapter 4's first three programming levels`
（3 文件 +921 行：`src/levels/content/ch4/batch1.ts` 331、`test/fixtures/ch4-references.ts` 87、
`test/levels/ch4-batch1.test.ts` 503，显式路径暂存）。
**实测**：`pnpm test` **46 文件 / 1431 通过**（基线 45/1406，+25）；`pnpm build` 干净；
focused `ch4-batch1` 25/25。TDD 有 RED→GREEN 记录（RED = 找不到 `ch4/batch1` 模块）。
实测 metric：`threeStar` gate **675** / delay **6**（`grade()` 复测）、tick 10 / 10 / 14（每关
walk 最后断言拍，钉住参考运行的 `ticksUsed`）。

**过程事故（本 harness 的事实，记录备查）**：
1. 后台 subagent 的结算通知会**丢失**——第一实现者（`521dd1ea`）后台派发后长时间无音讯、
   `send_message`/`interrupt_agent` 均报「active teammate not found」，一度被判定死亡；它其实存活，
   最终自行收尾。**裁决 R7**：实现者一律**前台**派发（会话可观测），评审因读 51KB diff 超过约
   25 分钟被同步执行器杀掉（两次 `subagent run failed`）⇒ 评审改**后台**派发并接受延迟通知。
2. 两个实现者并发抢同一个任务（后者在前者还在读码时写入并提交 `4a60852`；前者零写入、
   转为独立复核并把 addendum 追加进 `task-7-report.md`）。**裁决 R8**：一次只派一个实现者，
   派发后不重派（除非有结算失败的确证）；双会话的独立复核结果并入报告但不构成第二个评审席。

**实现者与独立复核者共同提出的三条关注点（待评审裁定后由控制器裁决）**：
1. 计划「参考解拿到 1 星」与 R3（`threeStar` = 实测 ⇒ 三星）机制上矛盾；两边都断言 3。
   计划措辞需一行修正。
2. 第 52 关单走一条 walk，恒定输出的作弊程序可过（另一会话实测验证；修法 = 每关加第二个
   `program` check，如 `r=9 → 54`）。第 50/51 关在所选输入下不可作弊。
   **裁决 R9（2026-10-10）**：读了 `batch1.ts` 的 walk 与实现者报告后确认：三关的 walk 都是
   单向量（100→105/103、200→176）。**第 52 关已实测可被常数程序通关**（8 拍揭示＝9 条指令预算，
   `loadi|63 … add` 就能从常数造出 176 并在第 8 拍发布，`runChecks` 判过）；第 50/51 关的
   105/103 需要 6 条指令构造、而揭示在第 4 拍（仅 5 条指令预算），**靠拍数算术侥幸防住**——
   这不是可依赖的防线（第 53/55 关揭示更晚，同样会漏）。「输出对、依赖错」的程序通过关卡是
   本仓库拒绝交付的陷阱类缺陷。裁定：第 4 章 `program` 关卡一律**至少两条独立 walk、
   不同输入向量**（每个 `program` check 是一次独立 `Simulation` 运行，`ticksUsed` 取 `Math.max`，
   机制成本已核）；批测试必须把「按时输出常数」程序钉为失败反例；T7 修复轮执行，T8 起直接照此写。
   代价：每关多一条 check 数据；`threeStar.tick` 取各 walk 的最大值（同形 walk 不变）。
3. 双实现者并发一事本身（已由 R8 关闭）。

**T7 评审（独立评审者，两段式）— CHANGES REQUIRED**
- 规格符合：结构、id/名称/io/索引/检查器/语义逐项对上；唯一规格缺口 = Important-1。
- **Important-1**：`ch4-52` 的检查不执行自己声称的语义 `out = (6*r)&0xff`——忽略 `r`、硬编码 176
  的九指令程序能过整条 walk（实现者与评审者各自用 ISA 表复现；且换任何单向量都堵不住：
  `nor` 对零寄存器堆一指令得 255，8 条准备指令内几乎任何字节都造得出）。
  修法（评审建议）：每关加第二个 `program` check（52 关用已验证的 `r=9 → 54`），
  并改掉「一次 `runChecks` 恰好一条失败」的空/坏程序断言（双 check 真空=每 check 一条）。
- **⚠️ 三项无法从 diff 验证**：约束 17 的引擎侧（`checks.ts`，未改）；重复 id/README 约定要等
  T9 注册才生效；「参考解拿到 1 星」与裁决 3 的矛盾。
- **裁决 R10（对 ⚠️ (c) 的裁定）**：计划的「参考解拿到 1 星」读作**「参考解至少拿到 1 星（即通过）」**；
  裁决 3（threeStar=实测）⇒ 参考解必然 3 星，实现断言 3 是正确的分支。计划措辞在 T10 收尾时
  修正一行。⚠️ (a)(b) 不是缺口：引擎侧先于本任务存在且被新测试覆盖；注册是 T9 的职责。
- **Minor（4 项，按流程记账延后，交 T10 整分支评审裁量）**：
  `Task 7: minor (deferred): 三关 hint 含完整解法（50 的 hint 逐条给出五个字节）——应缩到编码表+一例`；
  `Task 7: minor (deferred): SOURCED/AUTHORED 正则从文件首个 /** 懒惰匹配，未来模块注释出现该词会静默失效`；
  `Task 7: minor (deferred): 未测「玩家缓冲区不存在」（runChecks 不传第四参）`；
  `Task 7: minor (deferred): threeStar.tick 是 walk 的函数而非程序的函数（计划规定的定义，星级不甄别）`。
- 评审确认的优点：写范围严格三文件、真实内核零 mock、`threeStar` 双向钉、反例覆盖超出门槛、
  50/51 的 105/103 在第 4 拍揭示下结构上防住常数作弊（ISA 推导复核）、裁决双向钉住。

**T7 修复轮 1/5 — 已完成（`2a6849d`），scoped 复审进行中**
- 提交 `2a6849d` `fix(levels): drive two vectors through each chapter-4 program check`
  （`batch1.ts` + `ch4-batch1.test.ts` 两文件，显式暂存）。
- 实测：focused `ch4-batch1` 29/29（RED 先行：「ch4-52 … passed a program that ignores its input」
  先红后绿）；全量 **46 文件 / 1435 通过**（+4）；`pnpm build` 干净；`threeStar` 复测仍 10/10/14、
  675/6 不变。
- 三关各两条 walk（50：100→105 + 42→47；51：100→103 + 200→203；52：200→176 + 9→54）。
- 实现者注：50/51 的 kept walk 上不存在可达的常数作弊（105/103 第 4 拍造不出），故其作弊反例
  针对新增向量（`loadi|47`、`~52` 得 203），测试断言的是裁决的不变量：**单走一条 walk 能过、
  整关必须拒**。
- **用户指令（2026-10-10 16:16）**：收尾时**强制推送**（`git push --force`）——T10 的历史改写
  （撤下 `cd6a280`、修正 `06acea7`/`0175f86` 两处坏信息）已获用户授权，放在全部工作提交之后执行。

**T7 scoped 复审（修复轮 1）— 全部 findings ADDRESSED，无新 Critical/Important**
- Important-1（52 关常数作弊）ADDRESSED：两条 check（200→176 / 9→54），原九指令作弊程序现在是
  测试用例并在兄弟 walk 的第 8 拍被拒（期望 54、实得 176）；空/坏程序断言改为「每 check 一条」；
  `threeStar` 仍是实测 675/6、tick 10/10/14。
- R9 ADDRESSED：三关各两条独立 check、向量各不相同；复核者在**内核代码**上确认独立性
  （`runChecks` 每 check 一次 `createSim`、`ticksUsed` 取 `Math.max`），并加了结构性测试
  （每关 ≥2 条 program check、向量/答案互异、checks 长度 2）；反例测试断言「作弊程序单跑该 walk
  能过、整关必须拒」。复审者另跑了 focused 测试：29/29。
- 非阻塞 Minor（记账）：双 walk 会让一个错误程序产生两条 mismatch 记录（`result.ts:143` 只读
  `checks[0]`，两条都是 `program`，无影响）。
- **Out-of-scope（转 T9/T10 关注）**：`test/levels/testcases.test.ts:113-114` 对「多于一条 check」的
  关卡跳过计数断言——ch4 注册后该跳过会静默生效（program 关卡本返回 `{kind:'none'}`，无害，
  但 T9 要知道这条交互）。

**Task 7: complete (commits f1add6d..2a6849d, review clean after fix round 1)**

### T8 第 53–56 关 — 已实现（`b51a065`），评审进行中

**提交**：`b51a065` `feat(levels): add chapter 4's closing four levels`
（`src/levels/content/ch4/batch2.ts` 488、`test/levels/ch4-batch2.test.ts` 1121、`test/fixtures/ch4-references.ts` +157，
显式路径暂存；未注册进 campaign/content index。）
**实测**：`pnpm test` **47 文件 / 1470 通过**（+35）；`pnpm build` 干净；TDD RED（找不到 batch2）→ 33/35
→ 修正一处实测数（迷宫 258 → **168**，初版把前进通路的 `out` 偏移算成 24，实际 jz 落在地址 23、
偏移 14）→ GREEN。
**四关形态**：53 `n:8→out:8` 两条 walk（n=10、n=1）；54 `match:8→try:8` `custom lock {secret:42, budget:1024}`、
board `halt:false`；55 `in:8→out:8` 两条 walk（42、255）；56 `sensors:8→move:8` `custom maze {grid, budget:1024}`、
board `halt:false`。索引 53–56，无 rewards。
**实测 `threeStar`（测试内用真实内核重测并断言 `threeStar === metrics`，字面钉 [135,590,10,168]）**：
53 = 675/6/135（两条 walk 的最后断言取 max；揭示拍 13n−1）、54 = 675/6/590（检查器 ticksUsed = 2+14·42）、
55 = 675/6/10（第 4 拍揭示、保持到 10）、56 = 675/6/168（9 次 17 指令通过 + 第 10 次 move 的 out 在偏移 14 + 到达边）。
**迷宫**：`#######` / `#S.....#` / `#.#.##.#` / `#.#..#.#` / `#.##.#.#` / `#....#G#` / `#######`，
S(1,1) 朝东，G(6,5)；测试断言矩形、四周封闭、无 2×2 空块、恰好一个 S/G、BFS 可达；
「一直前进」在 (7,1) 墙前失败（第 21 拍撞墙）。
**反例覆盖**：53/55 的 R9 常数作弊（各自单跑该 walk 能过、整关被兄弟 walk 拒）；53 add→sub、55 and→or
的一比特破坏；54 步长 4 的搜索（不落在 42）预算耗尽被拒 + 空/不可汇编；56 一直前进 + 只转向 + 空。
**实现者的四条关注点（转 T9/T10）**：
1. budget 1024/1024 是实现者自选（1.7× 锁的 590、6× 迷宫的 168）——与仓库是否另有口径需确认；
2. 迷宫含一个环（不是「完美迷宫」），但 R3 要求的每条性质都有断言；
3. 锁在玩家已知 secret 时仍可被常数 42 通关（检查器的既有契约，非本任务引入）；
4. 两个检查器目前只由**测试侧 import** 注册——T9 在 content 通路上必须同样注册（否则 `missing-check`）。

**T8 评审（独立评审者，两段式）— APPROVED（Spec compliant），仅 2 条 Minor**
- 评审确认：四关的 id/索引/名称/io 精确；板设置正反两面钉住（53/55 默认 halt、54/56 `halt:false`）；
  `from:'player'` 且无 `source`；R9 两向量且「忽略输入按时输出常数」真程序被拒（并证明 `halt:true`
  下该程序只有一个可观测点 (首 out 拍, 字节)，53 的两条 walk 要求 (12,1) 与 (129,55) 不可能同时满足）；
  R3 迷宫三处钉住（params/brief/测试字面）、包围/无 2×2 空块/唯一 S,G/BFS 可达，
  「一直前进」第 21 拍撞墙被拒；约束 17 在 program 与 custom 两条通道都成立；
  四段 fixture 程序与 `reference-programs.md` **逐字节一致**（15/18/5/27 条指令）；
  `CUSTOM_BUDGET_CAP=4096` 故 1024 未被钳制。
- **Minor（记账延后，交 T10 整分支评审裁量）**：
  `Task 8: minor (deferred): batch2.ts:79-128 的 BOARD_PARTS 逐字复制 batch1.ts:73-104——durable home 是 boards/overture.ts 的导出`；
  `Task 8: minor (deferred): ch4-batch2.test.ts:360-363、:1005 三条断言比较测试内字面量，永不可能失败`；
  `Task 8: minor (deferred): SOURCED/AUTHORED 用的是同一套正则（house style，非缺陷）`。
- **⚠️ 移交 T9（已写入 T9 brief）**：`src/` 下没有任何模块 import `levels/custom/lock|maze`，
  检查器只在 import 时自注册 ⇒ T9 的 content 通路必须 import 两者，并加一条**不自己 import 检查器**
  的测试钉住 54/56 的 `custom` 检查可用。

**Task 8: complete (commit 2a6849d..b51a065, review clean)**

### T9 章节装配与定点更新 — 已实现（`e1e6e5a`），评审进行中

**提交**：`e1e6e5a` `docs(levels): register chapter 4 and refresh every pinned count`（14 文件 +406/-102）。
**实测**：`pnpm test` **48 文件 / 1495 通过**（基线 47/1470）；`pnpm build` 干净（70 模块）；
`pnpm smoke` **20/20**（25.1s，注册后跑过）。`testcases.test.ts` 无需改动（50–53、55 两条 check 的
program 关卡与 54/56 单 check 的 custom 关卡都返回 `{kind:'none'}`）。
**装配**：`content/ch4/index.ts`（`CH4_LEVELS`）→ `content/index.ts`（按 index 排序）→
`campaign.ts` 七行（50–56），形状 `[13,26,10,7]`、总数 56。
**注册通路（brief 裁决 8）已关闭**：选**内容通路副作用 import**（`content/ch4/index.ts` import
`../../custom/lock|maze`），理由是 `custom/index.ts` 自 import 会形成运行期环、在
`const checkers = new Map()` 上 TDZ。证明：新增 `test/levels/ch4-registration.test.ts` **自己不 import
任何检查器**，只经 `content/index.ts` 取关卡；临时注释掉那两条 import 会精确地红成
`missing-check`（lock/maze），恢复后 3/3 绿。
**被钉住的测试更新**：campaign-shape 形状与 1..56；unlock-chain 49→56、章 3 块的 `LEVEL_ORDER`
长度换成 `slice(49)`；level-buildability 的 `slice(39)` 拆成 `slice(39,49)`+`slice(49)` 并加
「keeps chapter 4 whole」块、`REFERENCE_SOLUTIONS` 变成 `(() => Graph) | { program }` 联合（既有条目
不动、`...CH4_REFERENCES` 整份摊开、图由关卡 `board` 建）；grader 同样联合 + 第四参玩家程序；
smoke 的 `toHaveCount(49)`×5 → 56 与「level 49 是最后一关」的标题/注释。
**文档定点**：spec §12 新增「阶段 3 已完成（2026-10-10）」、§1.1/§5.3 计数 49→56 与 Ch4 状态；
RESEARCH §3 的指定句 + §5 计数；README（Phases 0–3、Chapter 4 bullet、Chapters 5–7、layout 56）；
AGENTS.md（Chapters 1-4 56 / 5-7 37、layout 行）。
**实现者三条自陈（需评审/控制器裁量）**：
1. `test/ui/ide.test.ts` 因注册而变红（原断言「全部 56 关都没有编辑器」），改为两面走
   （第 1–3 章无编辑器、第 4 章有），意图与整集走查保留——属必要的定点更新，但不在 brief 名单里；
2. brief 未点名但已失真的计数（spec §1.1/§5.3、RESEARCH §5）一并修正，无散文重写；
3. **故意留下**：`test/levels/program-check.test.ts:623`（「49 of them declare a `source`」）与
   `:770`（「49 shipped levels declare neither field」）——正确的修法是把句子改写、不是换数字，
   而该文件不在 brief 名单里。**T10 处理**（控制器已确认要处理）。

**T9 评审（独立评审者，两段式）— APPROVED（Spec compliant），仅 5 条 Minor**
- 评审确认（含它自己做的越界核查）：campaign 七行「章节 + 索引」双钉；`content/index.ts` 合并后按
  index 排序；注册落在命名检查器的那一层（并核对 `src/` 无其他导入者、`levels/index.ts` 拉
  `content/index`、`checks.ts:875/888` 正是 `missing-check` 的出处）；无检查器 import 的测试
  **结构上不可能**在删掉那两条 import 后仍通过（且 `vite.config.ts` 无 `isolate:false`/`setupFiles`，
  该文件的模块注册表独立）；TDZ 理由成立（`custom/index.ts:60` 的 `const checkers` 与 `lock.ts:1-7`
  的顶层注册）；`package.json` 无 `sideEffects` ⇒ Rollup 保留副作用导入，**修复不是测试专属**；
  被钉数字全数替换（全仓 grep 无 `toHaveLength(49)`/`toBe(49)`/`toHaveCount(49)` 残留）；
  `REFERENCE_SOLUTIONS` 只加联合与整份摊开、既有条目未动、图一律来自关卡自己的 `board`；
  文档四文件定点、README layout 成员未变；提交信息与 brief 逐字一致。
- 逐条复核被改写的既有测试都保住主体与齿：campaign-shape 三个断言、unlock-chain 的章 3 段
  + 章 4 段（总数仍钉在 56）、level-buildability 三个长度与 `slice(39,49)`/`slice(49)`、
  grader 同一条走查、ui.spec 只改计数、ide.test 两面走（1–3 章 false、第 4 章 true）。
- **Minor（5，记账延后，交 T10 整分支评审裁量）**：
  1. `program-check.test.ts:623`/`:770` 过时注释（**T10 已修**）；
  2. 报告的 §7 说两个批测试都 import 检查器，实际只有 `ch4-batch2.test.ts:25-26`（措辞问题，不动代码）；
  3. `grader.test.ts:441-448` 与 `level-buildability.test.ts:98-115` 各有一份 `FiledReference` 联合与
     helper（可抽共享 fixture 防漂移）；
  4. spec §12 的「阶段 3 已完成」用块注而非表行（表无状态列）——**控制器裁定：此形式可接受**，不改；
  5. README 的「Chapters 5–7 (the LEG CPU…)」与同文 Symphony 口径矛盾（**T10 已定点修正**）。
- **观察（非本任务缺陷）**：`testcases.test.ts:113-114` 对多 check 关卡的计数跳过，现在静默覆盖
  50/51/52/53/55；brief 裁决 6 已预见，无断言变化，收紧属新工作。

**Task 9: complete (commits b51a065..e1e6e5a, review clean)**

## T10 阶段收尾（2026-10-10，续跑于 `D:\Documents\turing-complete`）

### 历史改写（用户 2026-10-10 16:16 指令：收尾时强制推送）

- **撤下 `cd6a280`**（用户指令）：内容处理见上文「控制器预检」；本地历史回到 `f1add6d`。
- **修正两处根级待办**：`2468d61` → `06acea7`（提交信息补 scope：`fix(test): bind the smoke preview
  server to IPv4 so the gate can start`）；`9c92d0c` → `0175f86`（body 里第 77 字节的字面退格符
  0x08 去掉，恢复成 "carry a \`board\`:"）。
- 改写范围 `ec0429c..HEAD`：**27 个提交换了 SHA**，105 个更早的提交（含第 0–2 阶段）不动。
  之所以整段改写，是因为 `0175f86` 是 `ec0429c` 之后的第二个提交，改它必然重排其后所有提交。
- **旧 → 新短 SHA 映射**（读本账本上文、三份 review 包与各任务报告里的历史引用时用）：

| 旧 | 新 | 旧 | 新 | 旧 | 新 |
|---|---|---|---|---|---|
| 9c92d0c | 0175f86 | 5601acc | 8cd8cab | 4ab1b68 | f875a3f |
| b62c4f5 | 839efe5 | e9dee5b | 92c508f | 06c97dd | 9000537 |
| 2468d61 | 06acea7 | ef3b47f | 0ea1592 | c116018 | 912ef8c |
| 8972931 | cd85377 | e8b9fb5 | 5fb7398 | 5911858 | b351f48 |
| 89eafa2 | 63ecc00 | 0300bcd | 922396d | 444658e | 69eab92 |
| 3fac5ed | 1f9b6a9 | 1f654d9 | a333623 | a64614e | f1add6d |
| 53d28b6 | 8616949 | 1928788 | 01a46b9 | 65ee370 | 4a60852 |
| 417b76f | f4d88ed | 7b97a56 | 72f2f60 | 54322dd | 2a6849d |
| 430eb1c | f138f7b | | | | |
| | | | | e75e494 | e1e6e5a |

- 本账本内的 SHA 引用已按上表替换；三份 review 包按新范围重新生成
  （`review-f1add6d..4a60852.diff`、`review-4a60852..2a6849d.diff`、`review-2a6849d..b51a065.diff`、
  `review-b51a065..e1e6e5a.diff`）。各**实现者/评审者报告的正文保留当时写下的旧 SHA**——它们是
  当时的叙述证据，换算用上表。
- `refs/original/refs/heads/master` 保留改写前的提交对象（仅本地，不推送）；推送用
  `git push --force-with-lease`（用户已授权强制推送）。

### 阶段收尾动作

- 恢复 `cd6a280` 里被撤下的阶段记录：本文件的 T5/T6/T6b 三节与任务表完成行、以及
  `reference-programs.md` 的「板子的指标」一节（并按 T7/T8 的实测补全 tick 表）。
- 计划措辞修正（裁决 R10）：Task 7 step 1 的「参考解拿到 1 星」改为「参考解通过——『拿到 1 星』
  读作『至少 1 星』，裁决 3 下参考解必然 3 星」。
- smoke 新增「第 50 关端到端」用例；`program-check.test.ts` 两处过时注释按 49/7 拆分改写；
  README 的 LEG/Symphony 措辞定点修正（T9 评审 Minor 1、5）。

### T10 实现（`ddfc60e` + `4757e39`）

- **`ddfc60e`** `test(smoke): grade chapter 4's first level end to end`：新增 smoke 用例
  「chapter 4 grades a hand-written program: level 50」——种子存档 49 → 简报 → 地图（56 格、
  第 49 格可用）→ 点格 → **第二次简报**（实现者第一版就死在这里：`<div class=briefing>`
  拦截指针事件）→ 关闭 → 二进制编辑器（按 aria-label）→ 填入五行参考机器码（与
  `CH4_REFERENCES['ch4-50-punchcard-programming']` **逐字节一致**，程序化校验过）→ 点 `.ide-test`
  → 断言「全部用例通过」「总开销」、`.ide-bytes = B10582409F`、对话框「关卡完成 + 程序关卡」
  → 继续 → 地图第 49 格 ★、第 50 格解锁。未改 `src/`（等级 50 与等级 49 的到达路径相同）。
- **`4757e39`**（原 `8f1b678`，控制器 amend）`docs(levels): correct the last stale counts, the
  chapter-5 wording and the smoke header`：两处 program-check 注释按 49/7 拆分改写；README 的
  chapter 5 改为 2.x 的 Symphony；smoke 头注释不再是「last six tests」。
- **裁决 R11（提交信息）**：实现者按控制器给出的字面消息提交，故 `docs:` 缺 scope——正是 T10 要修的
  `2468d61` 同类缺陷；控制器 amend 为 `docs(levels): …`。实现者主动上报该冲突，行为正确。
- **裁决 R12（注释措辞）**：实现者指出「49 关都声明 `source`」并不字面成立（第 1–3 章只有 4 关带
  `program` check：ch3-43/45/46/47），把「声明 `source`」挂在「其中的 `program` check」上——**接受**，
  这比原句更准确；控制器不再要求逐字。
- **门禁（控制器在 `4757e39` 上自跑，非实现者转述）**：`pnpm test` **48 文件 / 1495 通过**；
  `pnpm build` 干净（216.76 kB JS）；`pnpm smoke` **21 通过（24.4s）**。

### 整分支评审（独立评审者，range `c3d2002..4757e39`）— **Ready to merge: With fixes**

- 评审自己复跑：`pnpm test` 48/1495、`pnpm build` 干净（smoke 由控制器跑，21）。**验收线达成**：
  `level-buildability` 与 `grader` 用真实内核把第 4 章参考解跑到通关（含打孔编程、迷宫）。
- 强项（摘要）：一份 builder 两个读者消除「参考解 vs 出厂板」漂移类；玩家程序通道双向 fail-closed
  （真空先判、拼错的 `from`/`format` 拒绝而非默认回退、两条通路互不读对方）；T4b 的 C1/C2 与
  T6b 的 I1 都有真实电路/同机测试钉住；R9 落实且常数作弊反例为红；注册通路由「自己不 import
  检查器」的测试从外部证明；存档 `tc.progress.v1` 迁移向后兼容；文档计数全扫。
- **Important-1（修）**：「停止并复位」经 `display.reset()` 抹掉共享机器里的玩家程序
  （`main.ts:944-952`、`board/signals.ts:167-184`、`run.ts:253-262`）。后果：编辑器仍显示「5 字节」、
  调试器 RAM 全 0、PC 跑零程序，且**「汇编」不会重载**（`ensurePlayerRun` 的 key 未变）；
  `ProgramRun.reset()` 在 `src/` 里无调用者。`main.ts:357` 有同一隐患（既有用例表又有玩家程序的关卡）。
  修法：`onStop` 走 `dropPlayerRun(); rebuild(); refreshBench();`，或把复位经运行面走。
- **Important-2（修）**：第 54 关首次失败即把 secret 摆到屏幕上——`lock.ts:203-211` 的
  `expected: { try: secret }` 被 `truthTable.ts:266-276`/`:299-301` 渲染成矩阵列，于是
  `loadi|42 / move|s0|d5 / move|s5|out` 第 2 拍通关拿三星。**T8 账本里「玩家已知秘密才能过」的记录
  弱于事实**。修法：保留 `actual: { try: tried }`、去掉 `expected`、detail 不点名 secret，并加测试钉住。
- **Minor 的裁量结论（评审逐条给出）**：`BOARD_PARTS` 重复、`FiledReference` 重复、
  SOURCED/AUTHORED 正则、`threeStar.tick` 语义、spec §12 块注形式——**均不阻塞**；
  「未测『玩家缓冲区不存在』」**已被覆盖**（`program-check.test.ts:569-575`、`:824-829`）⇒
  本账本 T7 那条 Minor 记录**作废**；`ch4-batch2.test.ts:1005`（`expect(590).toBeLessThan(1024)`
  比的是字面量）应改成读 metric；第 50/51 关 hint 给全答案「不阻塞但应修」；
  `main.ts:52-55` 注释说「IDE 是以后的任务」已过时；`checks.ts:1550` 把 Task 6 写成 Task 9。
- **裁决 R13（对评审 M5）**：另有 4 个更早的 `docs:` 提交缺 scope（`ec0429c`、`63ecc00`、`01a46b9`、
  `72f2f60`）。再改一次会二次重排全部 SHA、使本账本刚记下的映射表失效 ⇒ **不改**，
  作为历史卫生遗留项报告给用户；`06acea7` 的修正保留（它是上一阶段就记下的根级待办）。
- 评审的「Declined to judge」共 10 条（断点/反汇编、第 54 关 `match` 不可观测、测试旋钮留在生产
  builder、`testcases.test.ts` 的多 check 跳过、每次按键写存档、`Progress.programs` 增长、
  `state.programs` 共享引用、smoke 未验程序跨刷新持久化、工作区未提交的 T10 记录等）：
  **控制器逐条接受其「不做」判断**，理由与该评审所述相同。

**修复波（final fix wave）— 已完成（`e7244ca` + `5cce329` + `163fddc`）**

- `e7244ca` `fix(ui): keep the player's program when the board is reset`：新增导出接缝
  `resetBoard(display, run)`（`src/ui/board/signals.ts:204`）——运行面拥有这台机器时走 `run.reset()`
  （会重载镜像），否则退回 `display.reset()`；`main.ts:960` 的 onStop 与 `main.ts:361` 的同类隐患
  都改走它。回归测试 `test/ui/display-run.test.ts:117`（RED：共享机器 `ram_prog` 变 `[0,0]`）。
  另修 `main.ts:52-55` 的过时注释。
- `5cce329` `fix(levels): stop the lock's record naming the secret`：`lock.ts:210` 改 `expected: {}`、
  detail 不再点名 secret；判据与 `ticksUsed` 未动；`custom-lock.test.ts`、`ch4-batch2.test.ts:765-766`
  断言面板记录不再携带 secret（RED：旧检查器下 4 例失败）。
- `163fddc` `docs(levels): trim the chapter-4 hints and correct two stale notes`：第 50/51 关 hint 改为
  「编码表 + 一个示例（`move|s2|d4` = 10010100）」；`ch4-batch2.test.ts` 的 `590 < 1024` 字面量对
  改为读 `runReference(spec)` 的 metric、算术断言改由关卡自己的向量经 `answerOfWalk` 推导；
  `checks.ts:1550` 的 Task 9 → Task 6。
- 门禁：`pnpm test` **48 文件 / 1497 通过**（+2 回归测试）；`build` 干净；`smoke` 21 通过。
  实现者如实上报两条**未被测试覆盖的接缝**：`main.ts` 的闭包接线没有 vitest harness（只用临时
  Playwright 脚本验证过、脚本已删）、锁记录的真值表 DOM 未单独挂载。

**修复波的 scoped 复审（独立复审者）— 六项 findings 全 ADDRESSED，但修复本身引入 1 条新 Important**

- I1/I2/M1/M2/M3/M4 逐条 ADDRESSED（证据见上文与该复审报告）。
- **新 Important（修复 diff 引入）**：`main.ts:960` 的 `resetBoard(display, ensurePlayerRun())` 在
  **编辑过程序之后**会去复位运行面的机器、而**不**复位盘面正在画的那台（`rebuild()` 是唯一把
  display 绑到 `run.machine` 的地方，而 `onProgramEdit` 只 `dropPlayerRun()` 不重建）⇒ 玩家在
  「改文本 → 单步/运行 → 停止并复位」这条常规路径上看到盘面不再复位（修复前 `display.reset()`
  至少会复位它）。
- **Low（同一守卫）**：`run.machine !== null` 把「运行面拥有机器」与「运行面还活着」混为一谈：
  运行面中途失效（settle 失败 ⇒ `errors` ⇒ `machine` 为 null）时退回 `display.reset()`，
  又会抹掉共享镜像。
- 越界观察：编辑后「盘面画 A、调试器读 B、工具栏单步 A、bench 单步 B」是 T6b 遗留的接线缺口
  （本阶段没有挂 `main.ts` 的 harness）；第 51 关的 **brief**（`batch1.ts:310-311`，本次未动）
  仍在用助记符写出答案——hint 已修，brief 未修。
- **裁决 R14（控制器；流程偏离并说明）**：SDD 的终局规则是「一次修复波 + 一次 scoped 复审，残留
  交给人」。但这里的新 Important 是**修复波自己引入的回归**、修法就是复审者点名的几行
  （onStop 改走 `dropPlayerRun(); rebuild(); refreshBench();`），且复审指出主 finding I1 的 app 级
  证据不足（提交的测试只覆盖接缝，未覆盖 `onStop` 接线）。判断：**再派一次最小修复**（残留
  Important + Low 守卫 + 补一条 app 级 smoke 证据 + 第 51 关 brief 的答案泄漏），随后只做一次
  微型 scoped 复审。代价（若判断错）：多一个提交、多一次复审；收益：不把已知回归推给用户。

**残留修复（R14 派发）— 已完成（`c7facc1` + `d5ded79` + `413cc5f`）**

- `c7facc1` `fix(ui): reset the board the player is looking at`：onStop 改为
  `dropPlayerRun(); rebuild(); paint(); io.render(); refreshBench(); paintTools();`——盘面重建、新运行面
  自会 reset + 重载镜像，所以复位一定落在玩家正看着的那张板；`main.ts:361` 的用例复位在
  `levelExpectsProgram` 为真时走同一条路（无程序的板仍在原地复位，避免每个 fuzz 用例重编译）。
  `resetBoard` 失去最后一个调用者 ⇒ **删除**（`src/`、`test/` grep 0 处，仅 `signals.ts:79` 的散文
  注释还提到名字），其性质改在 `ProgramRun.reset()` 上钉住（`test/ui/display-run.test.ts:123-159`：
  镜像仍在 `ram_prog`、tick 归 0、仍可跑）。
- `d5ded79` `test(smoke): pin the chapter-4 reset flow`：smoke 新增第 22 例——种子存档带上第 50 关的
  程序文本（`seedProgress` 现在还写 `programs`）→ 板面单步两次（io 卡 2 拍）→ 同文按键（丢弃运行面）
  → **停止并复位** → io 卡 **0 拍**、编辑器文本仍在 → 汇编单步后 `.ide-bytes = B10582409F`、
  调试器 RAM `B1 05 82 40 9F`。**RED 证据**：临时恢复旧 onStop 体，该例在时钟断言失败（实得
  `2 拍 · 10Hz`），失败点正确。
- `413cc5f` `docs(levels): keep level 51's brief out of the answer`：brief 不再写出助记符答案，
  改为指向 hint 的拼写表。
- **微型 scoped 复审（独立复审者）**：四项 **全 ADDRESSED**，无新 Critical/Important。它另核：
  `resetBoard` 删除后无悬空调用/测试；替换钉确实覆盖「复位后程序仍在」（但不覆盖 onStop 的新路线，
  那一半只由 smoke 用例覆盖）；非阻塞小瑕疵——`display-run.test.ts` 的注释把「同一条
  `createProgramRun` + `createDisplay` 接线」说得偏松（onStop 走的是构造函数，不是 `run.reset()`），
  且报告只给门禁数字、未贴 smoke 输出。
- 实现者自陈：没有关卡同时有 case list 与玩家程序 ⇒ `main.ts:361` 分支靠读码而非测试覆盖。
- **控制器在 `413cc5f` 上的最终门禁（自跑，非转述）**：`pnpm test` **48 文件 / 1497 通过**；
  `pnpm build` 干净（216.90 kB JS）；`pnpm smoke` **22 通过（26.4s）**。

## T10 收尾结论

**Task 10: complete** —— 提交 `ddfc60e`、`4757e39`、修复波 `e7244ca`/`5cce329`/`163fddc`、
残留修复 `c7facc1`/`d5ded79`/`413cc5f`；终局门禁 **48 文件 / 1497 通过 + build 干净 + smoke 22 通过**。

### 交付与遗留（汇总给用户）

1. **交付**：第 4 章 7 关（全局 50–56）、汇编 IDE 与调试器、关卡起始电路通道（`board`）、玩家程序通路
   与 `Progress.programs` 存档、`src/asm/image.ts`、`lock`/`maze` 两个闭环检查器、章节装配与全部
   定点计数/文档同步。战役形状 `[13,26,10,7] = 56` 关。
2. **显式延后（不变）**：断点与反汇编视图（spec §6.3，裁决 5）。
3. **已知局限（记录在案）**：第 54 关的 `match` 在当前机器语义下不可观测（`out` 是组合输出，
   只在写它的那条指令期间发布）；锁在玩家已知 `secret` 时仍可被常数通关（检查器契约，
   面板不再泄露 secret）；`threeStar.tick` 是 walk 的函数而非程序的函数（计划的定义）。
4. **非阻塞 Minor（终局评审逐条裁量）**：`BOARD_PARTS` 与 `FiledReference` 的重复、
   SOURCED/AUTHORED 正则、spec §12 用块注而非表行、`testcases.test.ts` 对多 check 关卡的计数跳过。
5. **历史卫生**：`ec0429c`、`63ecc00`、`01a46b9`、`72f2f60` 四个更早提交用无 scope 的 `docs:`
   （裁决 R13：不再改写，避免二次重排全部 SHA）；`06acea7`（补 scope）与 `0175f86`（去退格符）已修。
6. **未验证的接缝**：`main.ts` 的闭包接线（只有「停止并复位」这条流程被 smoke 覆盖）；
   程序跨刷新在浏览器里的持久化（单测覆盖了存储与迁移）。
7. **工作区事实**：`docs/session-archive/session.v4.jsonl`（52MB）仍被跟踪（由 `c3d2002` 引入，
   AGENTS.md 说会话记录不该留在工作区——留给用户裁决）；被撤下的 9.5MB 会话压缩包随 `cd6a280`
   一并从历史移除（用户指令）。
8. **推送**：`git push --force-with-lease origin master`（用户 2026-10-10 16:16 授权强制推送）。
