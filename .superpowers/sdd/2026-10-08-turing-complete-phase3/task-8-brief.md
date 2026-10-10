# Task 8 brief — 第 53–56 关（`src/levels/content/ch4/batch2.ts`）

逐字摘自 `docs/superpowers/plans/2026-10-08-turing-complete-phase3.md` 的「Task 8」与
「第 4 章关卡表」两节，并补入控制器裁决。**数字与字符串以本文件为准。**

## Task 8: 第 53–56 关（`ch4/batch2.ts`）

**Files:**
- Create: `src/levels/content/ch4/batch2.ts`、`test/levels/ch4-batch2.test.ts`
- Modify: `test/fixtures/ch4-references.ts`（追加）

**Steps:** 同 Task 7 的口径。第 54/56 关用 `custom`（`lock`/`maze`，参数写在关卡数据里），
第 55 关用 `program`；第 56 关的参考程序是沿墙走算法（只用 `and`/`jz`/`jnz` 与
`move`，因为 ISA 没有位移与比较）。`maze` 的迷宫必须是**可解且参考解必经**的固定图案。

**写范围**：`src/levels/content/ch4/batch2.ts`、`test/levels/ch4-batch2.test.ts`、
`test/fixtures/ch4-references.ts`

## 本任务的四关（逐字取自计划的「第 4 章关卡表」）

| # | id | 名称 | io（inputs → outputs） | 检查器 | 参考程序语义 |
|---|---|---|---|---|---|
| 53 | `ch4-53-conditional-jumps` | 条件跳转 / Conditional Jumps | `n:8` → `out:8` | `program`（player, asm） | `out = (n + (n-1) + … + 1) & 0xff`（计数到 0 的循环） |
| 54 | `ch4-54-code-breaker` | 道破心机 / Code Breaker | `match:8` → `try:8` | `custom: lock` | 逐值试探；检查器读到 `try == secret` 的那一拍通过 |
| 55 | `ch4-55-mod-4` | 高速掩码 / Mod 4 | `in:8` → `out:8` | `program`（player, asm） | `out = in & 3` |
| 56 | `ch4-56-the-maze` | 路在脚下 / The Maze | `sensors:8` → `move:8` | `custom: maze` | 沿墙走：左空则左转，否则直行，否则右转 |

## 第 4 章的共同规则（逐字取自计划）

- **board 设置**：直线关卡（50–53、55）用 `overtureBoard({ inputId })` 的默认 `halt: true`。
  **闭环关卡（54、56）必须用 `halt: false`**：否则第一次写 `out` 就把 PC 冻住
  （实测锁在第 2 条指令、`try` 恒为 0），两关都会无解。⇒ 53、55 用默认；54、56 用 `halt: false`。
- **关卡 io 全部按 8 位声明**（`match:8`、`try:8`、`sensors:8`、`move:8`）：板只有 8 位连接器，
  声明 1 位 / 3 位会在 `bindLevelIo` 阶段就宽度不符。
- **`sensors` 位序**：bit0 = 正前方有墙，bit1 = 左侧有墙，bit2 = 右侧有墙（墙为 1）。
  **`move` 编码**：0 = 原地，1 = 前进，2 = 左转，3 = 右转。两者都由参考 CPU 的 `inp`/`out`
  端口承载（板上的 `level_input`/`level_output` 实例按 `IN_<pin>`/`OUT` 绑定）。
- **第 4 章不发放任何新元件**：7 关的 `rewards` 全部缺省，`allowedComponents` 列出参考板所需
  的全部元件 id。
- **裁决 4（闭环谜题走 `custom` + `params`）**：`CustomCheck.params` 承载谜题参数
  （`lock` 的秘密值、`maze` 的迷宫图案）；`CustomChecker` 拿到玩家程序文本与 spec；
  checker 自己 `tick()`、自己读写 `io`、自己决定 `ticksUsed` 与 failure 记录（键必须是关卡自己的
  pin id）。**把同一段驱动逻辑复制进关卡 = 把引擎藏进关卡层，禁止。**
- **约束 17**：程序真空是硬失败（`missing-program`）；解析/汇编失败是 `invalid` 且带行号。

## 参考程序与实测值（权威）

`.superpowers/sdd/2026-10-08-turing-complete-phase3/reference-programs.md`：

- 「ch4-53 条件跳转」「ch4-54 道破心机」「ch4-55 高速掩码」「ch4-56 路在脚下」四节：
  字节与汇编都是**控制器预先验证过**的参考解（`assemble()` 0 错误），直接使用；
- 「实测的『输出出现在第几拍』」表：53 随 n 增长（n=10 时在预算内）、55 ≤ 8；
- 「给 T7/T8 的口径」四条是这两批关卡的硬规则（参考程序与检查器语义对齐；迷宫可解且平凡程序
  不得通过；54/56 必须 `halt: false`；io 全 8 位）。

**板子的指标（`grade()` 实测，供 `threeStar` 用）**——本节尚未落回 reference-programs.md，
数值逐字如下，直接用：

| 板 | gate | delay |
|---|---|---|
| `overtureBoard({ inputId })`（`halt` 默认 true，第 53、55 关） | **675** | **6** |
| `overtureBoard({ inputId, halt: false })`（第 54、56 关） | **675** | **6** |

`halt` 是 0 成本元件，两形状门数相同。`threeStar.tick` 取参考解在该关检查器下的实测
`ticksUsed`（例如**第 54 关 `secret: 42` 是 590**）；第 53、55 关是 steps 里最后断言的拍。

## 关卡 54 的已知局限（记录在案，必须写进 brief，不得声称相反）

`out` 是组合输出、只在 `move|sN|out` 那条指令执行期间发布（第 3 章 `halt` 语义的基础，本阶段
不改机器），而 CPU 读 `match` 用的是另一条指令 `move|inp|dN`——那一拍 `out` 已回落为 0，
所以**程序采样到的 `match` 恒为 0**，参考程序里「找到就自旋」的分支实际不会执行。
关卡仍然可解（判据是「在预算内发布了 `secret` 这个字节」），但
**brief 不得声称「CPU 需要对 match 作出反应」**。

## 接口事实（前序任务已落地）

- `overtureBoard(options?: { halt?: boolean; inputId?: string }): BoardInit`；
  `graphFromBoard(levelId, board): Graph`；`LevelSpec.board?: BoardInit`。
- `ProgramCheck { source?, from?: 'level' | 'player', format?: 'asm' | 'bytes' }`；第 4 章一律
  `from: 'player'`，关卡数据不写 `source`。
- `CustomCheck { id: 'lock' | 'maze', params?: Record<string, number | string | readonly number[] | readonly string[]> }`
  （`src/levels/spec.ts:197`）；checker 签名与语义见 `src/levels/custom/{lock,maze,index}.ts`
  与 `src/levels/checks.ts` 的 `programTargets`/`loadProgramImage`。
- **T4b 的机器级事实（照抄，别重新发现）**：两个 checker 开头 `io.reset()`、自己载入玩家程序
  （共享 helper）、协议是「读输出 → 写输入 → settle → tick」；`params.budget` 有上限
  `CUSTOM_BUDGET_CAP`（超限钳制、非整数/0/负数判 `invalid`）；`secret: 0` 在真实板上第一拍即通过
  （已有一条测试钉住），所以**关卡数据的秘密值取 42**；检查器会校验关卡引脚（缺失/多余/过窄 ⇒
  `invalid` 并点名），所以关卡 pin id 必须正好是 `match`/`try`、`sensors`/`move`。
- `runChecks(graph, registry, spec, player?)` / `grade(graph, registry, spec, player?)`；
  `PlayerProgram` 见 `src/levels/checks.ts:631`。
- 测试模板：`test/levels/ch4-batch1.test.ts`（T7 交付，结构同 `ch3-batch3`）、
  `test/levels/custom-lock.test.ts`、`test/levels/custom-maze.test.ts`（T4 交付，看检查器语义）。

## 控制器裁决（对含糊处的裁定，按此执行）

1. **`CH4_REFERENCES` 形状（沿用 T7 的 R1）**：
   `Record<string, { program: string; format: 'asm' | 'bytes' }>`，键=关卡 id；
   板不进 fixture，用关卡自己的 `board` 建图。本批四关的 `format` 全是 `'asm'`。
2. **本批关卡此时不注册进 `campaign.ts` / `content/index.ts`**（那是 Task 9）；
   测试直接 `import { CH4_BATCH2 } from '../../src/levels/content/ch4/batch2'`。
   索引：53、54、55、56。
3. **迷宫图案（R3）由你设计**，但必须同时满足：(a) 单格宽、封闭、可解；(b) 「左空左转 → 前空前进 →
   否则右转」的参考算法能在预算内到达终点；(c) 平凡程序（例如「一直前进」）**必须失败**，
   反例测试要覆盖；(d) 图案写进关卡的 `params` 与 brief 文本，并被测试钉住（改图案 ⇒ 测试红）。
4. `threeStar` 三项 = 参考解在该关检查器下的**实测** metric（gate/delay 675/6，tick 实测；
   54 的 tick 已知 590），并用测试钉住「`threeStar` 等于实测」。
5. 第 53 关的 `steps`/断言写法照 reference-programs.md 的「写 steps 的两个坑」：
   每一步都必须重复 `inputs`，否则输入被清零；`expect` 只比较它声明的键。
6. 第 54/56 关的 `custom` 检查器读玩家程序（`from: 'player'`）；参考程序只是 fixture 里的玩家文本，
   测试把它当玩家提交跑。
7. **R9（多向量，控制器裁决 2026-10-10）**：`program` 关卡（53、55）**至少两条独立 walk**，
   输入向量不同（建议含 0 之外的边值）；每个 `program` check 是一次独立的 `Simulation` 运行
   （`runChecks` 对每个 check `createSim`，`ticksUsed` 取 `Math.max`），所以多条 check = 多个向量。
   理由：单向量的 walk 只验「在第 T 拍发布某个常数」，**忽略输入、按时输出常数的程序能通关**
   （T7 已实测）。批测试必须包含一条「输出对、依赖错」的反例——例如按时输出常数的程序——断言它
   **失败**。`threeStar.tick` = 各 walk 实测 `ticksUsed` 的最大值。
   （第 54/56 关是闭环 `custom`，判据由检查器自己定，不适用本条的 walk 形式。）
