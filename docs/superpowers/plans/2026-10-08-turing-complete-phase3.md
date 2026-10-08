# Phase 3 — 第 4 章「编程」+ 汇编 IDE 与调试器 实施计划

Spec: `docs/superpowers/specs/2026-09-25-turing-complete-replica-design.md`（§6.1–6.3、§7、§12 阶段 3）
Predecessor: `docs/superpowers/plans/2026-09-29-turing-complete-phase2.md`
Ledger: `.superpowers/sdd/2026-10-08-turing-complete-phase3/progress.md`
关卡表：`GAME_RESEARCH_2026-10-03.md` §5「第 4 章 编程」7 关（2.x 基线）

阶段 2 交付了第 3 章 10 关与 OVERTURE 的全部元件、`asm` 内核与 `program` 检查器，
**并把 IDE 明确留给阶段 3**（phase-2 计划裁决 14）。本阶段把游戏推进到
**第 4 章 7 关（全局第 50–56 关）+ 汇编 IDE + 调试器**。

spec §12 规定的验收标准：

> 阶段 3：第 4 章 7 关（编程）+ IDE + 调试器。
> 验收：《打孔编程》《迷宫》等关卡的参考汇编程序通过

**基线（2026-10-08 12:00 实测）**：`pnpm test` → 37 文件 / **1227 用例全绿**，`tsc --noEmit` 干净。

## Global Constraints

沿用阶段 0–2 的十四条全局约束（零运行时依赖、分层单向、信号只有 0/1、每组件 1 单位延迟、
存储元件契约、评分权值走 `SCORE_WEIGHTS`、关卡是纯数据、关卡 I/O 按实例 id 绑定、
版权边界、测试策略、CPU 由玩家搭出、程序检查器离线纯函数、`asm_*` 与 `program` 是内核设施、
IDE UI 属阶段 3）。本阶段新增六条：

15. **关卡可以携带起始电路，但那不是内置 CPU。** `board` 只是「把上一章搭好的机器带进来」
    的导入通道，玩家仍可编辑；任何 `class Overture` 仍然禁止（约束 11 不变）。
16. **玩家程序是关卡之外的状态，只经 `runChecks` 的第四个参数进入内核。** 缺省（不传）= 阶段 2
    行为；关卡数据里的 `source` 与玩家缓冲区是两条不同的通路，不得互相回填。
17. **程序真空仍然是硬失败。** 玩家没写、写了但汇编成 0 字节、或没有任何断言的步骤，
    一律 `missing-program`；解析/汇编失败是 `invalid` 且 `detail` 必须带行号。
18. **`custom` 只承载「无声明参数的谜题模拟」。** 本阶段注册 `lock` 与 `maze` 两个，
    各服务一关；把同一段驱动逻辑复制进三个关卡 = 把引擎藏进关卡层（phase-2 裁决 2 的同一课）。
19. **本阶段不做断点与反汇编视图**（spec §6.3 列了，但见裁决 5）。
20. **每个任务的评审合并为一次两段式评审**（先规格符合、再代码质量），以降低本阶段的
    子代理调用成本；这是控制器裁决，记入账本。

## 本阶段的范围裁决（控制器裁决，记入账本）

**裁决 1 — 第 4 章的关卡携带参考 CPU（`LevelSpec.board`）。**
第 4 章的教学目标是「用自己的 CPU 写程序」，不是「把 CPU 再搭 7 遍」。spec §11 风险表
第 384 行已经给出许可：「编程章节允许导入关卡提供的参考 CPU（可跳过但标记）」。
因此 `LevelSpec` 新增可选 `board?: BoardInit`，`main.ts` 打开关卡时用它建图而不是
`emptyGraph`。代价：关卡数据里出现一份电路形状，必须与 `test/fixtures/ch3-references.ts`
的 `overtureMachine` 同源，否则参考解与关卡会漂移——用同一个 builder 消掉这个风险。

**裁决 2 — 玩家程序的通路是 `runChecks(graph, registry, spec, player?)`。**
`ProgramCheck` 增加 `from?: 'level' | 'player'` 与 `format?: 'asm' | 'bytes'`，`source` 变为可选
（`from` 缺省或 `'level'` 时必填，否则是 `invalid`）。玩家文本经第四个参数进入内核，
`grade()` 同步增参。代价：`checks.ts` 的程序分支要同时处理两条来源，且必须保住
「空白即失败」的既有契约。

**裁决 3 — 第 1 关的机器码格式是「逐行 8 位二进制」。**
新模块 `src/asm/image.ts` 的 `parseImage(text)`：`#` 注释、空行跳过、每行 8 位二进制
（允许空格分组），每行一个字节。错误带行号，契约与 `assemble()` 一致（永不抛异常）。
理由：`打孔编程` 的教学点是「手工编码」，所以不能用汇编器；而玩家需要一个可读、
可打错、可定位的格式。

**裁决 4 — 闭环谜题（密码锁、迷宫）走 `custom` + `params`。**
`custom` 的文档注释本来就写着它是给「mazes, dance machines, AI duels」用的逃生舱。
`CustomCheck` 因此增加可选 `params`（数字/字符串/数字数组），`CustomChecker` 的签名增加
一个上下文参数（玩家程序文本 + spec）。注册两个 id：`lock`（道破心机）与 `maze`（路在脚下）。
代价：`test/levels/testcases.test.ts` 里「会产出 mismatch 记录的检查器种类」这条断言要扩到
`custom`，并给出理由；两个 checker 自己拥有 `ticksUsed`。

**裁决 5 — IDE 范围：编辑、汇编、运行、单步、寄存器/PC/程序 RAM 查看；断点与反汇编延后。**
spec §6.3 的清单里，`断点` 需要一个常驻执行循环与断点命中语义，`反汇编视图` 需要把
`OVERTURE_ISA` 反向渲染——两者都不在本阶段的验收线上（验收线是「参考汇编程序通过」）。
本阶段交付 `src/ui/ide.ts`（textarea + 行号层 + 汇编结果 + 二进制视图 + 错误行）
与 `src/ui/debug.ts`（REG0–5、PC、程序 RAM 窗口并高亮当前 PC、停机标志）。
**断点与反汇编记为本阶段的显式延后项，报告给用户。**

**裁决 6 — 玩家程序随存档保存（`Progress.programs`）。**
第 0 阶段的验收含「刷新后进度保留」；玩家的程序就是他在这一关的全部工作，
刷新即丢失与「进度保留」自相矛盾。`Progress` 增加 `programs: Record<string, string>`，
`migrate()` 继续吞掉未知字段、只保留已知字段，并对键做 id 迁移（同 `levels`）。
存储键仍是 `tc.progress.v1`。

**裁决 7 — 第 4–7 章的阶段划分（spec §12 表已给出，本阶段确认采用）。**
阶段 3 = 第 4 章 7 关 + IDE + 调试器；阶段 4 = 第 5 章 Symphony 26 关 + RAM/栈；
阶段 5 = 第 6 章 7 关 + 16/32/64 位组件；阶段 6 = 第 7 章 4 关 + 沙盒 + 外设。

## 引擎事实（recon，2026-10-08 读码确认，替代独立的 recon 任务）

- `LevelSpec` 全字段见 `src/levels/spec.ts:177-196`；`LevelCheck` 联合见 `:169-175`。
- `runChecks(graph, registry, spec)` 在 `src/levels/checks.ts:585`；每个 check 一次
  `createSim`（`:602`），`program` 分支在 `:925-1046`，汇编在 `:992`（**写死 `OVERTURE_ISA`**），
  镜像经 `io.sim.loadImage(id, bytes)` 在 `reset()` **之后**载入（`:1042`）。
- `LevelIo` 的公开面见 `checks.ts:24-39`：`reset/writeInput/readOutput/tick/sim`。
  `custom` 检查器拿到的就是它（`custom/index.ts:29`）。
- 驱动步骤 `driveSteps`（`checks.ts:1170-1195`）只按 step 边界写输入——**没有闭环**，
  这正是密码锁/迷宫必须走 `custom` 的原因。
- `Simulation`（`src/core/net.ts:382-710`）：`reset():416`、`tick():644`、`read:664`、
  `write:668`、`loadImage(instanceId, bytes):699`。**实例状态没有公开读口**——
  调试器需要 `readState(instanceId)`（本阶段 Task 5 增加）。
- 元件状态布局：`regfile6` = 6 字节（`src/core/defs/cpu.ts:262`），`pc8` = 1 字节（`:384`），
  `ram_prog` = 256 字节（`:438`）。
- 关卡开局一律空板：`src/main.ts:36`（初始）与 `:516`（`openLevel`）。
- 评分入口：`grade(graph, registry, current)`（`main.ts:256` 的 `finishTest`、`:551` 的 `measure`）。
- 存档：`src/persist/storage.ts`（`migrate` 只保留 `version`/`levels`），`Progress` 见
  `src/app/progress.ts:11-14`。
- ISA：`src/asm/isa.ts:162-214` 是数据表；`move` 的 src 可为 `inp`(6)，dst 可为 `out`(7)；
  跳转只有 `j`/`jz`/`jnz`，条件一律取 **REG3**，目标一律取 **REG0**；没有乘法、没有比较。

## 交付物

| # | 文件 | 内容 |
|---|---|---|
| 1 | `src/levels/spec.ts` | `BoardInit`/`BoardPart`/`BoardWire`；`ProgramCheck.from/format`；`CustomCheck.params` |
| 2 | `src/levels/board.ts` | `graphFromBoard(levelId, board): Graph` |
| 3 | `src/levels/boards/overture.ts` | `overtureBoard({ inputId }): BoardInit`（第 4 章参考 CPU = 第 3 章机器 + 输入端口通路） |
| 4 | `src/asm/image.ts` | `parseImage(text)`：逐行 8 位二进制 → 字节 + 行号错误 |
| 5 | `src/levels/checks.ts` | 程序来源双通路；`programTargets` 导出；`custom` 传参 |
| 6 | `src/levels/grader.ts` | `grade()` 转发玩家程序 |
| 7 | `src/levels/custom/lock.ts`、`maze.ts` | 两个闭环检查器 |
| 8 | `src/core/net.ts` | `Simulation.readState(instanceId)` |
| 9 | `src/levels/run.ts` | `createProgramRun(...)`：IDE/调试器用的单步运行面 |
| 10 | `src/ui/ide.ts`、`src/ui/debug.ts`、`src/ui/style.css` | 汇编 IDE 与调试面板 |
| 11 | `src/main.ts` | 起始电路、玩家程序状态、IDE/调试面板接线、测试按钮 |
| 12 | `src/app/store.ts`、`src/persist/storage.ts`、`src/app/progress.ts` | `programs` 状态与存档 |
| 13 | `src/levels/content/ch4/{batch1,batch2,index}.ts` | 第 50–56 关 |
| 14 | `src/levels/campaign.ts`、`src/levels/content/index.ts` | 第 4 章 7 行 + 装配 |
| 15 | `test/fixtures/ch4-references.ts` | 每一关的参考解（板 + 程序） |
| 16 | `test/levels/ch4-batch1.test.ts`、`ch4-batch2.test.ts` | 逐批测试 |
| 17 | 既有测试的定点更新 | 见 Task 9 |

## 第 4 章关卡表（全局 50–56）

| # | id | 名称 | io（inputs → outputs） | 检查器 | 参考程序语义 |
|---|---|---|---|---|---|
| 50 | `ch4-50-punchcard-programming` | 打孔编程 / Punchcard Programming | `in:8` → `out:8` | `program`（player, bytes） | `out = (in + 5) & 0xff` |
| 51 | `ch4-51-assembly-programming` | 汇编程序 / Assembly Programming | `in:8` → `out:8` | `program`（player, asm） | `out = (in + 3) & 0xff` |
| 52 | `ch4-52-circumference` | 三番两次 / Circumference | `r:8` → `out:8` | `program`（player, asm） | `out = (6 * r) & 0xff` |
| 53 | `ch4-53-conditional-jumps` | 条件跳转 / Conditional Jumps | `n:8` → `out:8` | `program`（player, asm） | `out = (n + (n-1) + … + 1) & 0xff`（计数到 0 的循环） |
| 54 | `ch4-54-code-breaker` | 道破心机 / Code Breaker | `match:1` → `try:8` | `custom: lock` | 逐值试探，直到 `match` 读到 1 |
| 55 | `ch4-55-mod-4` | 高速掩码 / Mod 4 | `in:8` → `out:8` | `program`（player, asm） | `out = in & 3` |
| 56 | `ch4-56-the-maze` | 路在脚下 / The Maze | `sensors:3` → `move:2` | `custom: maze` | 沿墙走：左空则左转，否则直行，否则右转 |

`sensors` 位序：bit0 = 正前方有墙，bit1 = 左侧有墙，bit2 = 右侧有墙（墙为 1）。
`move` 编码：0 = 原地，1 = 前进，2 = 左转，3 = 右转。二者都由参考 CPU 的 `inp`/`out` 端口
承载（板上的 `level_input`/`level_output` 实例按 `IN_<pin>`/`OUT` 绑定）。

第 4 章**不发放任何新元件**（spec §3.3 的 Ch4 行为「无新元件；解锁汇编 IDE 与调试器」）：
7 关的 `rewards` 全部缺省，`allowedComponents` 列出参考板所需的全部元件 id。

## Task 1: 起始电路（`board`）——关卡可以把参考 CPU 带进来

**Files:**
- Modify: `src/levels/spec.ts`（新增 `BoardPart`/`BoardWire`/`BoardInit`，`LevelSpec.board?`）
- Create: `src/levels/board.ts`（`graphFromBoard`）
- Create: `src/levels/boards/overture.ts`（`overtureBoard()`）
- Modify: `src/main.ts:34-47` 与 `:514-523`（开局建图）
- Create: `test/levels/boards.test.ts`

**Steps:**
1. 先写 `test/levels/boards.test.ts`：`graphFromBoard('x', overtureBoard())` 的实例数、连线数、
   每个 `def` 都在 `BASE_DEFS` 里；`validateGraph` 无 error；`compile` 成功；
   `overtureBoard()` 两次调用结果深度相等（确定性）。
2. 跑测试确认失败（模块不存在）。
3. 在 `spec.ts` 加类型，在 `board.ts` 实现：`BoardWire` 按**下标**引用 parts
   （`{ part: number; port: string }`），建图时 `i<n>` 实例 id 由下标生成（`i1`, `i2`, …，
   与 `nextId` 同规则），坐标按 `parts[i].x/y` 写入。
4. **（2026-10-08 执行中修正）** `overtureBoard()` **不是** `overtureMachine()` 的副本：
   第 3 章那台机器**没有输入端口通路**（它的程序是直线/计数程序，从不读 `inp`，
   `move|inp|dN` 在那里读到的寄存器 6 被寄存器堆发布为 0），而第 4 章每一关都要读输入。
   因此第 4 章的参考板 = 第 3 章的 CPU 核心（同样的 `ram_prog`/`pc8`/`instr_decoder`/
   `regfile6`/`alu8`/`halt` 与模式、目的、条件、跳转粘合逻辑）**加上一条输入端口通路**：
   当指令的 `src` 字段为 6（`inp`）时，`move` 复制的是 `IN_<inputId>` 的值而不是 A 端口。
   插入点是**源值**通路（`d1` 之前），不是目的索引通路；`equal8` + `mux8`/`switch8` 足够。
   第 4 章的关卡 io 统一为 **8 位输入 + 8 位输出**（`lock` 的 0/1 与 `maze` 的 3 位传感器
   都按 8 位承载，位含义写在关卡 brief 里），所以一块板服务全部 7 关：
   `level_input` 实例 `IN_<inputId>`（8 位）+ `level_output` 实例 `OUT`（8 位）。
   `overtureMachine()` 的实现**最终改为复用 builder**（`graphFromBoard('ref', overtureBoard(options))`，
   计划原本禁止、执行后按裁决接受）：理由是它把第 3 章的三组反例旋钮（`jump`/`immediate`/`halt`）
   留在同一张电路的唯一来源里，避免两份接线漂移；代价是测试专用旋钮进了生产代码，已在文件里
   注明来源。第 3 章的逐批测试未做任何削弱（评审已核：`git show --name-only` 显示四个提交都没有
   触碰 `test/levels/ch3-*.test.ts`，第 49 关的 `threeStar {643, 6, 95}` 与逐拍断言仍原样通过）。
   T1 的验收因此是**行为**而非结构：装载 `B1 8F`（`move|inp|d1` / `move|s1|out`）、
   写入输入 `0x2A`、跑若干拍后断言 `OUT` 的输入引脚读到 `0x2A`。
5. `main.ts`：初始状态与 `openLevel` 都改为
   `level.board ? graphFromBoard(level.id, level.board) : emptyGraph(level.id)`。
6. `pnpm test` + `tsc --noEmit` 全绿；提交 `feat(levels): let a level ship its starting circuit`。

**写范围**：`src/levels/spec.ts`、`src/levels/board.ts`、`src/levels/boards/**`、`src/main.ts`、
`test/levels/boards.test.ts`、`test/fixtures/ch3-references.ts`

## Task 2: 玩家程序通路（`from`/`format` + `runChecks` 第四参 + 存档）

**Files:**
- Modify: `src/levels/spec.ts`（`ProgramCheck.source?`/`from?`/`format?`）
- Modify: `src/levels/checks.ts`（程序分支双来源；导出 `programTargets`）
- Modify: `src/levels/grader.ts`（`grade(..., player?)` 转发）
- Modify: `src/app/store.ts`（`AppState.programs: Record<string, string>`）
- Modify: `src/app/progress.ts`、`src/persist/storage.ts`（`Progress.programs` + 迁移）
- Modify: `src/main.ts`（把当前关卡的玩家文本传给 `grade`）
- Modify: `test/levels/program-check.test.ts`（新增玩家来源用例）
- Modify: `test/persist/storage.test.ts`、`test/app/store.test.ts`（如涉及）

**Steps:**
1. 先扩展 `test/levels/program-check.test.ts`：`from:'player'` + 第四参给出汇编 → 通过；
   第四参缺失/空串 → `missing-program`；汇编报错 → `invalid` 且 detail 含行号；
   `from:'level'` 行为与阶段 2 完全一致（既有用例不动，作为回归）。
2. 确认新用例失败。
3. `spec.ts`：`source?: string`，`from?: 'level' | 'player'`，`format?: 'asm' | 'bytes'`，
   并把注释补成「两条来源」的完整说明（真空判定对两者一视同仁）。
4. `checks.ts`：程序分支取出文本（`from==='player' ? player?.text ?? '' : check.source`），
   `from==='level'` 且 `source` 非字符串 → `invalid`（保住既有契约）；
   `format==='bytes'` 走 Task 3 的 `parseImage`，其余走 `assemble`。
5. `runChecks(graph, registry, spec, player?)`；`grade(graph, registry, spec, player?)` 转发。
6. `AppState.programs` + `Progress.programs`；IDE 每次编辑写这两处并 `saveProgress`；
   `migrate()` 只保留字符串值的 `programs` 并按 `currentIdOf` 迁移键。
7. `pnpm test` 全绿；提交 `feat(levels): accept a player-authored program`。

**写范围**：`src/levels/spec.ts`、`src/levels/checks.ts`、`src/levels/grader.ts`、`src/app/**`、
`src/persist/storage.ts`、`src/main.ts`、`test/levels/program-check.test.ts`、`test/persist/**`

## Task 3: 机器码格式（`src/asm/image.ts`）

**Files:**
- Create: `src/asm/image.ts`、`test/levels/image.test.ts`
- Modify: `src/asm/index.ts`（导出）
- Modify: `src/levels/checks.ts`（`format:'bytes'` 走 `parseImage`，见 Task 2 step 4）

**Steps:**
1. 先写 `test/levels/image.test.ts`：`B1 05 82 40 9F` 的二进制文本 → 5 字节；
   空行与 `#` 注释被跳过；非 8 位、含非 0/1 字符、空字段各自产出**带行号**的错误且不产字节；
   `parseImage('')` → 0 字节 0 错误（由检查器判 `missing-program`）。
2. 确认失败。
3. 实现 `parseImage(source: string): { bytes: readonly number[]; errors: readonly ImageParseError[] }`，
   错误形状与 `assemble()` 的 `AssembleError` 对齐（行号 + 原文 + 原因）。
4. `pnpm test` 全绿；提交 `feat(asm): parse hand-written machine code`。

**写范围**：`src/asm/image.ts`、`src/asm/index.ts`、`test/levels/image.test.ts`

## Task 4: 闭环谜题的两个检查器（`lock`、`maze`）

**Files:**
- Modify: `src/levels/spec.ts`（`CustomCheck.params?`）、`src/levels/custom/index.ts`（`CustomChecker` 上下文）
- Create: `src/levels/custom/lock.ts`、`src/levels/custom/maze.ts`
- Create: `test/levels/custom-lock.test.ts`、`test/levels/custom-maze.test.ts`
- Modify: `test/levels/testcases.test.ts`（mismatch 种类断言扩到 `custom`）

**Steps:**
1. 先写两个测试：用一个**确定性**的假电路（`test/fixtures/build.ts` 搭出的最小板）
   证明 checker 的循环语义——`lock`：秘密值 42 时必须观察到 `try` 递增到 42 且 `match` 变 1；
   秘密值 0 时第一拍即成功；秘密值 255 时在预算内成功。
   `maze`：给定固定迷宫与起点朝向，参考程序走出终点；撞墙必须记为失败。
2. 确认失败（两个 id 未注册 → `missing-check`）。
3. `spec.ts` 给 `CustomCheck` 加 `params`；`custom/index.ts` 的 `CustomChecker` 增加第三参
   `ctx: { program: string; spec: LevelSpec }`，并把注释里的契约补上「闭环 + 玩家程序」。
4. 实现两个 checker：自己 `tick()`、自己读写 `io`、自己决定 `ticksUsed` 与 failure 记录
   （键必须是关卡自己的 pin id）。`lock` 的秘密值与 `maze` 的迷宫写在 `params` 里。
5. 更新 `testcases.test.ts` 的 mismatch 种类断言（加 `custom` 并写明理由）。
6. `pnpm test` 全绿；提交 `feat(levels): check the lock and the maze in closed loop`。

**写范围**：`src/levels/spec.ts`、`src/levels/custom/**`、`test/levels/custom-*.test.ts`、
`test/levels/testcases.test.ts`

## Task 5: 运行面（`Simulation.readState` + `src/levels/run.ts`）

**Files:**
- Modify: `src/core/net.ts`（`readState(instanceId): Uint8Array | null`，返回副本）
- Create: `src/levels/run.ts`（`createProgramRun`）
- Modify: `test/core/net.test.ts`（`readState` 用例）

**Steps:**
1. 先写 `net.test.ts` 用例：对 `ram_prog` 实例 `loadImage` 后 `readState` 能读回镜像；
   未知 id → `null`；返回的是副本（改它不影响仿真）。
2. 确认失败。
3. 实现 `readState`：按实例 id 找 instance，返回 `new Uint8Array(state)`，未知 id 返回 `null`。
4. `run.ts`：`createProgramRun(graph, registry, spec, text, format)` →
   `{ errors, bytes, tick(), reset(), readPorts(), readRegisters(), readPc(), readRam(), setInput(name, value), ticks }`；
   元件定位规则与 `checks.ts` 的 `programTargets` 同一个（`ram_prog`）、寄存器/PC 按 def id
   `regfile6`/`pc8` 找，找不到就给 `null`/`[]`（板可能还没搭）。
5. `pnpm test` 全绿；提交 `feat(core): expose instance state for the debugger`。

**写范围**：`src/core/net.ts`、`src/levels/run.ts`、`test/core/net.test.ts`

## Task 6: 汇编 IDE 与调试面板

**Files:**
- Create: `src/ui/ide.ts`、`src/ui/debug.ts`、`test/ui/ide.test.ts`
- Modify: `src/ui/style.css`、`src/main.ts`、`src/ui/shell.ts`（如需新容器）

**Steps:**
1. 先写 `test/ui/ide.test.ts`（jsdom）：面板对没有玩家程序的关卡不渲染；
   输入文本 → 点「汇编」→ 显示字节数与二进制视图；语法错误 → 列表里出现行号；
   「单步」推进 `PC` 显示；「运行/停止」切换按钮文案。
2. 确认失败。
3. 实现 `ide.ts`：`<textarea>` + 行号层（`aria` 可读）、`汇编`、二进制视图、错误列表、
   三个按钮（`测试`/`单步`/`运行`）、速度选择沿用既有 `TEST_RATES` 语义。
   实现 `debug.ts`：`REG0–5`、`PC`、程序 RAM 十六进制窗口（当前 PC 高亮）、停机标志。
4. `main.ts` 接线：关卡屏幕右侧按需挂载 IDE；`测试` 走既有 `finishTest` 流程，
   `单步/运行` 走 `createProgramRun`；每次编辑程序文本 → 更新 `state.programs` + 存档 + 清 `lastGrade`。
5. 样式只用 `theme.ts` 的色与间距（conventions 测试会拦字面色值）；无阴影、无圆角。
6. `pnpm test` 全绿；提交 `feat(ui): add the assembly IDE and the debugger`。

**写范围**：`src/ui/ide.ts`、`src/ui/debug.ts`、`src/ui/style.css`、`src/main.ts`、
`test/ui/ide.test.ts`

## Task 7: 第 50–52 关（`ch4/batch1.ts`）

**Files:**
- Create: `src/levels/content/ch4/batch1.ts`、`test/fixtures/ch4-references.ts`、`test/levels/ch4-batch1.test.ts`

**Steps:**
1. 先写 `test/levels/ch4-batch1.test.ts`（模板 `test/levels/ch3-batch3.test.ts`）：
   参考解（`level.board` 建图 + 参考程序）拿到 1 星；`threeStar` 三项等于实测；
   调色板覆盖参考解用到的每个元件；反例（改坏程序/空程序）必须失败；
   索引区间、`rewards` 缺省、没有未解锁元件。
2. 确认失败（关卡不存在）。
3. 写三关数据：`brief/hint` 说清「这台 CPU 是你第 3 章搭的，现在给它写程序」；
   `SOURCED`/`AUTHORED` 注释标明名字来自 2.x 资料、io 与目标为本复刻设计。
4. 写参考程序（第 50 关给**字节**，第 51–52 关给**汇编**），把实测 metric 写进 `threeStar`。
5. `pnpm test` 全绿；提交 `feat(levels): add chapter 4's first three programming levels`。

**写范围**：`src/levels/content/ch4/batch1.ts`、`test/fixtures/ch4-references.ts`、
`test/levels/ch4-batch1.test.ts`

## Task 8: 第 53–56 关（`ch4/batch2.ts`）

**Files:**
- Create: `src/levels/content/ch4/batch2.ts`、`test/levels/ch4-batch2.test.ts`
- Modify: `test/fixtures/ch4-references.ts`（追加）

**Steps:** 同 Task 7 的口径。第 54/56 关用 `custom`（`lock`/`maze`，参数写在关卡数据里），
第 55 关用 `program`；第 56 关的参考程序是沿墙走算法（只用 `and`/`jz`/`jnz` 与
`move`，因为 ISA 没有位移与比较）。`maze` 的迷宫必须是**可解且参考解必经**的固定图案。

**写范围**：`src/levels/content/ch4/batch2.ts`、`test/levels/ch4-batch2.test.ts`、
`test/fixtures/ch4-references.ts`

## Task 9: 章节装配与既有断言更新

**Files:**
- Create: `src/levels/content/ch4/index.ts`
- Modify: `src/levels/content/index.ts`、`src/levels/campaign.ts`
- Modify: `test/levels/campaign-shape.test.ts`、`test/levels/unlock-chain.test.ts`、
  `test/levels/level-buildability.test.ts`、`test/levels/grader.test.ts`、`test/smoke/ui.spec.ts`
- Modify: `README.md`、`AGENTS.md`、`docs/superpowers/specs/2026-09-25-turing-complete-replica-design.md`、
  `RESEARCH.md`

**Steps:**
1. `campaign.ts` 追加 7 行（第 4 章，全局 50–56，zh/en 用 §5 表的名字）。
2. `content/index.ts` 追加 `...CH4_LEVELS`（保持按 `index` 排序）。
3. 更新被钉住的数字：章节形状 `[13,26,10,7]`、关卡总数 49→56、`slice(39)` 的边界、
   grader 的参考解联合加 `CH4_REFERENCES`、smoke 的地图格数。
4. `level-buildability` 的 `REFERENCE_SOLUTIONS` 支持 `{ graph, program }`（第 4 章的参考解
   是「板 + 程序」，板来自关卡自己的 `board`）。
5. 文档：spec §12 阶段表加一行「阶段 3 已完成」；`RESEARCH.md` §3 把「第 4–7 章尚未实现」
   改成「第 4 章 7 关已实现（2.x 基线），剩余第 5–7 章 37 关」；README/AGENTS 的关卡数同步。
6. `pnpm test` 全绿；提交 `docs(levels): register chapter 4 and refresh every pinned count`。

**写范围**：`src/levels/content/**`、`src/levels/campaign.ts`、测试的定点更新、文档

## Task 10: 阶段收尾

- `pnpm build`、`pnpm test`、`pnpm smoke` 三条全绿（在干净 shell 里跑，记录真实输出）。
- smoke 增加一条：打开第 50 关、写入参考二进制、点测试、断言通过。
- 账本 `progress.md` 收尾：每个任务的实现者报告、评审结论、全部裁决与延后项。
- 最终整分支评审（独立子代理），CI 口径的完整回归。
- Conventional Commits 拆分提交；尝试推送（本机代理若再次挡住，如实在报告里说明）。

## 依赖图

```
T1 board ──> T2 player-program ──> T4 lock/maze ──> T8 (53-56) ──┐
T3 image ──┘                       T5 readState/run ─> T6 IDE ───┼─> T9 ─> T10
                                    T7 (50-52) ──────────────────┘
```

T3 与 T1/T2 无写范围重叠，可并行；其余按序（其间有 `spec.ts`/`main.ts`/`checks.ts` 的先后写关系）。

## 文件所有权（写范围，避免并发写冲突）

| 任务 | 独占写范围 |
|---|---|
| T1 | `src/levels/spec.ts`, `src/levels/board.ts`, `src/levels/boards/**`, `src/main.ts`, `test/levels/boards.test.ts`, `test/fixtures/ch3-references.ts` |
| T2 | `src/levels/spec.ts`, `src/levels/checks.ts`, `src/levels/grader.ts`, `src/app/**`, `src/persist/**`, `src/main.ts`, `test/levels/program-check.test.ts`, `test/persist/**`, `test/app/**` |
| T3 | `src/asm/image.ts`, `src/asm/index.ts`, `test/levels/image.test.ts` |
| T4 | `src/levels/spec.ts`, `src/levels/custom/**`, `test/levels/custom-*.test.ts`, `test/levels/testcases.test.ts` |
| T5 | `src/core/net.ts`, `src/levels/run.ts`, `test/core/net.test.ts` |
| T6 | `src/ui/ide.ts`, `src/ui/debug.ts`, `src/ui/style.css`, `src/main.ts`, `src/ui/shell.ts`, `test/ui/ide.test.ts` |
| T7 | `src/levels/content/ch4/batch1.ts`, `test/fixtures/ch4-references.ts`, `test/levels/ch4-batch1.test.ts` |
| T8 | `src/levels/content/ch4/batch2.ts`, `test/levels/ch4-batch2.test.ts`, `test/fixtures/ch4-references.ts` |
| T9 | `src/levels/content/**`, `src/levels/campaign.ts`, 定点测试与文档 |
| T10 | `.superpowers/sdd/2026-10-08-turing-complete-phase3/**`, 文档收尾 |

**同一文件的多任务写关系**：`src/levels/spec.ts`（T1→T2→T4）、`src/main.ts`（T1→T2→T6）、
`src/levels/checks.ts`（T2）、`test/fixtures/ch4-references.ts`（T7→T8）——**一律串行**，
不得并发派发同一写范围的实现者。
