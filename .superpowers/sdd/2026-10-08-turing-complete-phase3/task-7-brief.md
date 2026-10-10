# Task 7 brief — 第 50–52 关（`src/levels/content/ch4/batch1.ts`）

逐字摘自 `docs/superpowers/plans/2026-10-08-turing-complete-phase3.md` 的「Task 7」与
「第 4 章关卡表」两节，并补入控制器裁决。**数字与字符串以本文件为准。**

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

## 本任务的三关（逐字取自计划的「第 4 章关卡表」）

| # | id | 名称 | io（inputs → outputs） | 检查器 | 参考程序语义 |
|---|---|---|---|---|---|
| 50 | `ch4-50-punchcard-programming` | 打孔编程 / Punchcard Programming | `in:8` → `out:8` | `program`（player, bytes） | `out = (in + 5) & 0xff` |
| 51 | `ch4-51-assembly-programming` | 汇编程序 / Assembly Programming | `in:8` → `out:8` | `program`（player, asm） | `out = (in + 3) & 0xff` |
| 52 | `ch4-52-circumference` | 三番两次 / Circumference | `r:8` → `out:8` | `program`（player, asm） | `out = (6 * r) & 0xff` |

## 第 4 章的共同规则（逐字取自计划）

- **board 设置（T4b 用真实电路测出，2026-10-08 补记）**：直线关卡（50–53、55）用
  `overtureBoard({ inputId })` 的默认 `halt: true`——程序最后一条 `move|sN|out` 会让 PC 停在
  `out` 指令上，输出保持住，这正是第 3 章的设计。**闭环关卡（54、56）必须用 `halt: false`**。
  本批三关都是直线关卡 ⇒ 一律默认 `halt: true`。
- **第 4 章不发放任何新元件**（spec §3.3 的 Ch4 行为「无新元件；解锁汇编 IDE 与调试器」）：
  7 关的 `rewards` 全部缺省，`allowedComponents` 列出参考板所需的全部元件 id。
- **关卡 io 统一 8 位输入 / 8 位输出**（板上只有 8 位连接器；写 1 位会在 `bindLevelIo`
  就宽度不符）。
- **裁决 1**：关卡携带参考 CPU（`LevelSpec.board`）；那是「把上一章搭好的机器带进来」的导入通道，
  玩家仍可编辑，任何内置 CPU 类都禁止。
- **裁决 2**：玩家程序只经 `runChecks(graph, registry, spec, player?)` 的第四参进入内核；
  关卡数据里的 `source` 与玩家缓冲区是两条通路，不得互相回填。第 4 章关卡一律
  `from: 'player'`，**关卡数据不写 `source`**（参考程序只出现在 fixture 与测试里）。
- **裁决 3**：第 50 关的机器码格式是「逐行 8 位二进制」（`format: 'bytes'` → `parseImage`）。
- **约束 17**：程序真空是硬失败——玩家没写、汇编成 0 字节、或没有任何断言的步骤 ⇒ `missing-program`；
  解析/汇编失败 ⇒ `invalid` 且 `detail` 带行号。

## 参考程序与实测值（权威）

`.superpowers/sdd/2026-10-08-turing-complete-phase3/reference-programs.md`：

- 「ch4-50 打孔编程」「ch4-51 汇编程序」「ch4-52 三番两次」三节的字节是**控制器预先验证过**的
  参考解（六程序全部 0 错误、字节与手工编码一致），直接使用；
- 「实测的『输出出现在第几拍』」表：50 → **4**、51 → **4**、52 → **8**（真实板上输出出现的拍，
  之后由 `halt` 保持）；
- 「写 steps 的两个坑」：`driveSteps` 每个 step 都会写全部输入脚（缺省写 0），后续每一步都必须
  重复 `inputs`，否则输入被清零；`expect` 只比较它声明的键。

**板子的指标（`grade()` 实测，供 `threeStar` 用）**——本节尚未落回 reference-programs.md，
数值逐字如下，直接用：

| 板 | gate | delay |
|---|---|---|
| `overtureBoard({ inputId })`（`halt` 默认 true，本批三关用这个） | **675** | **6** |

`halt` 是 0 成本元件。`threeStar.tick` 取参考解在该关检查器下的实测 `ticksUsed`
（本批 = `steps` 里最后断言的拍）。

## 接口事实（前序任务已落地）

- `LevelSpec.board?: BoardInit`（`src/levels/spec.ts`）；`graphFromBoard(levelId, board): Graph`
  （`src/levels/board.ts`）。
- `overtureBoard(options?: { halt?: boolean; inputId?: string }): BoardInit`
  （`src/levels/boards/overture.ts`）；`inputId` 会建 `IN_<inputId>` 的 8 位 `level_input` 并把
  它接进 CPU 的源值通路。
- `ProgramCheck { source?, from?: 'level' | 'player', format?: 'asm' | 'bytes' }`（`spec.ts:91`）。
- `runChecks(graph, registry, spec, player?)`（`checks.ts:643`）与
  `grade(graph, registry, spec, player?)`（`grader.ts:73`）；玩家文本的形状是
  `PlayerProgram`（`checks.ts:631`）。
- `parseImage(text)`（`src/asm/image.ts:90`）：逐行 8 位二进制 → 字节，错误带行号，永不抛异常。
- 测试模板：`test/levels/ch3-batch3.test.ts`；fixture 形状参考 `test/fixtures/ch3-references.ts`
  （`CH3_REFERENCES: Record<string, () => Graph>`）；`registry` 来自 `test/fixtures/build.ts`。
- 三条门禁命令（本机 `pnpm` 是坏包装器，用 bundled node + pnpm.mjs，见 README「Running it」）：
  `$NODE $PNPM test` / `$NODE $PNPM build` / `$NODE $PNPM smoke`。

## 控制器裁决（对含糊处的裁定，按此执行）

1. **`test/fixtures/ch4-references.ts` 的形状**：
   `export const CH4_REFERENCES: Record<string, { program: string; format: 'asm' | 'bytes' }>`，
   键是关卡 id。**板不进 fixture**——参考运行用关卡自己的 `board` 建图
   （`graphFromBoard(level.id, level.board)`），避免两份电路漂移（裁决 1 的同源要求）。
   调用 `grade(..., player)` 时把 `program` 文本包成 `PlayerProgram`。
2. **本批关卡此时不注册进 `campaign.ts` / `content/index.ts`**（那是 Task 9 的活）；
   `test/levels/ch4-batch1.test.ts` 直接 `import { CH4_BATCH1 } from '../../src/levels/content/ch4/batch1'`
   （导出名对齐 `CH3_BATCH3`）。
3. `threeStar` 三项 = 参考解在该关检查器下的**实测** metric（gate/delay 见上表 675/6，
   tick 为参考程序实测），并用测试钉住「`threeStar` 等于实测」。
4. 索引区间：三关 `index` 分别为 **50、51、52**。
5. 模板 `ch3-batch3.test.ts` 里依赖 `check.source` 的断言（程序字节、labels 等）在第 4 章改为
   **fixture 程序**的断言——第 4 章关卡没有 `source`；反例走玩家通路（空文本 ⇒ `missing-program`；
   改坏的程序 ⇒ `mismatch`/`invalid`）。`SOURCED`/`AUTHORED` 注释标记必须有（conventions
   与 ch2-batch4 的既有做法）。
