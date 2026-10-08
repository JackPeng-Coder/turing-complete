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
| T2 | 玩家程序通路 + 存档（并入 T3） | **已完成**（评审：APPROVED WITH MINOR ISSUES，遗留已并入 T4 的 Part A） | `3fac5ed` + `53d28b6` + `417b76f`；`pnpm test` 39 文件 / **1279 通过**；`build` 干净；`smoke` 20 通过 |
| T3 | `src/asm/image.ts` 机器码格式（并入 T2） | **已完成** | `53d28b6`；`test/levels/image.test.ts` 10 个用例 |
| T4 | `lock` / `maze` 两个闭环检查器（并入 T2 评审遗留） | **已完成**（评审进行中） | `5601acc` + `e9dee5b` + `ef3b47f` + `e8b9fb5`；`pnpm test` 41 文件 / **1331 通过**；`build` 干净；`smoke` 20 通过 |
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

### T2 + T3 玩家程序通路与机器码格式 — 已完成（评审：APPROVED WITH MINOR ISSUES）

**执行裁决（成本）**：把原计划的 T3（`src/asm/image.ts`）并入 T2 同一次派发，减少一轮实现者与
评审的往返。T3 以独立提交 `53d28b6` 落地，评审覆盖两次提交。

**提交**：`3fac5ed`（T1 评审的五条遗留）、`53d28b6`（`parseImage`）、`417b76f`（通路 + 存档）。

**实测**：`pnpm test` 39 文件 / 1279 用例全绿；`pnpm build` 干净；`pnpm smoke` 20 通过。
`53d28b6` 另用 stash 单独验证过（1259 用例、tsc 0）。

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

**提交**：`5601acc`（空白分隔）、`e9dee5b`（`params` + 玩家程序 + 通路因子化）、
`ef3b47f`（lock）、`e8b9fb5`（maze）。

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

**提交**：`0300bcd`（`LevelIo.settle()` + 协议）、`1f654d9`（检查器载入玩家程序 + 复位 + budget 上限 +
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

## 延后项（本阶段结束时汇总给用户）

- 断点与反汇编视图（spec §6.3）——裁决 5。
- `README.md:115-116` 的 bundled node/pnpm 路径写的是旧机器的 `C:\Users\ME\…`，本机不存在。
