# Phase 2 — 第 3 章「CPU 架构 OVERTURE」实施计划

Spec: `docs/superpowers/specs/2026-09-25-turing-complete-replica-design.md`
Predecessor: `docs/superpowers/plans/2026-09-25-turing-complete-phase1.md`
Ledger: `.superpowers/sdd/2026-09-29-turing-complete-phase2/progress.md`

阶段 1 交付了第 2 章 26 关与宽位组件体系（23 个测试文件 / 938 个用例通过）。
本阶段把游戏推进到 **第 3 章 9 关（第 39–47 关）+ OVERTURE 第一台 8 位 CPU**。
spec §12 规定的验收标准：

> 阶段 2：第 3 章 9 关（OVERTURE）。
> 验收：能搭出可运行 OVERTURE 的程序并跑通《程序》《立即数》验证。

## Global Constraints

沿用 Phase 1 的十条全局约束（零运行时依赖、分层单向、信号只有 0/1、每组件 1 单位
延迟、存储元件契约、评分权值走 `SCORE_WEIGHTS`、关卡是纯数据、关卡 I/O 按实例 id
绑定、版权边界、测试策略），另加本阶段四条：

11. **CPU 是玩家搭出来的，不是内置模拟器**（spec §6.1）。引擎只提供元件与验证。
    `alu8` / `regfile6` / `instr_decoder` / `pc8` / `ram_prog` / `halt` 是**元件**，
    不是「CPU 对象」。任何形式的 `class Overture` 都违反这条。
12. **程序检查器必须离线、纯函数、可复现**。不得读真实时间、不得抓网络、
    不得依赖 `Math.random()`。汇编器的种子数据来自关卡数据本身。
13. **`asm_*` 组件与 `program` 检查器是内核/关卡层设施，不是内置 CPU**：
    它们只负责「把汇编文本变成字节放进 RAM」和「按拍驱动电路」，
    不理解指令语义——指令语义完全来自玩家搭的电路。
14. **本阶段不交付 IDE UI**（编辑器/调试器面板）。`asm` 模块是 Phase 3 的 IDE 的
    已完工内核；Phase 3 只加 UI。里程碑拆分见「本阶段的范围裁决」。

## 本阶段的范围裁决（控制器裁决，记入账本）

**裁决 1 — 汇编器拆成「内核」与「UI」两半，本阶段只做内核。**
spec §12 把「IDE + 调试器」列在**阶段 3**（第 4 章编程），而验收要求本阶段
「跑通《程序》《立即数》验证」。两者只有一种自洽读法：本阶段交付**能执行程序、
能被检查的 CPU 与关卡**，汇编器的**文本→字节**内核随本阶段落地（否则关卡无法
驱动程序），**编辑器 UI 与调试面板**留给阶段 3。代价：本阶段结束后玩家能玩到
《图灵完备》关，但写汇编仍要靠关卡预置程序，不能自己敲代码；这正是阶段 3 的入口。

**裁决 2 — 新增 `program` 检查器种类，而不是把程序逻辑塞进 `custom`。**
`custom` 是逃生舱，但 9 关里有 3 关（43、45、47）都要「跑一段程序并断言结果」。
把同一套驱动逻辑复制三遍进 `custom` 注册表，等于把引擎藏在关卡层。
因此 `LevelCheck` 新增 `{ kind: 'program', image, steps }`，由 `levels/checks.ts`
实现，`custom` 保持为空。代价：`FAILURE_REASONS` 与 `CheckFailure` 的契约要动一次，
且必须保持 `missing-rows`/`missing-vectors` 那一课：**空的程序镜像或空的断言序列
是硬失败，不是「随便跑跑」**。

**裁决 3 — 寄存器文件是「2 读 1 写」的 6×8 寄存器堆，条件写入由关卡搭建。**
源资料 §6.2 的 `move|sX|dY` 是双读单写。引擎不提供「CPU」，
`regfile6` 只提供 `addrA/addrB/waddr/data/we -> a/b`，
六级寄存器各自带 `we` 条件写入（内部六个 8 位存储），
**没有任何指令语义**。代价：第 40 关「寄存器之间」的源概念（寄存器间复制）
被落在**指令解码 + 复制模式**（第 42/43 关）里实现，第 40 关改为
「用 `mem1` + `decoder3` 搭出可寻址的 8 位寄存器堆」，是同一教学目标的更底层一步。

**裁决 4 — 第 41 关「元件工坊」改建为「控制信号扇出」，蓝图封装不属本阶段。**
spec §3.4 的蓝图（封装为自定义组件）在阶段 3 与 IDE 同期；源资料第 41 关
的教学目标是「把功能电路模块化为可复用组件」。本阶段不可用蓝图，
因此第 41 关改建为**同一目标的可用形态**：把一个控制位正确扇出到多个目标、
并处理「一条指令同时驱动寄存器堆的读与写」的组合/时序边界。
代价：这是相对源概念的一次**改建**，与第 2 章第 15/23/34 关同样在关卡数据里
标为 `AUTHORED` 并记入账本。

**裁决 5 — 指令字布局（本复刻版的 OVERTURE ISA）。**
源资料 §6.3 固定了「高 2 位操作码 + 低 6 位参数」与四种模式，但**没有给字段位序**：

| 模式 | op[7:6] | 低 6 位含义（本复刻版设计） |
|---|---|---|
| 立即数 `loadi` | `00` | 6 位立即数（0–63），写入 REG0 |
| 计算 `calc` | `01` | `[5:3]` = 操作（000 add, 001 sub, 010 and, 011 or, 100 nand, 101 nor），`[2:0]` 保留必须为 0 |
| 复制 `move` | `10` | `[5:3]` = 源，`[2:0]` = 目标 |
| 跳转 `jump` | `11` | `[5:3]` = 条件（000 j, 001 jz, 010 jnz），`[2:0]` 保留必须为 0 |

源/目标编码：`0–5` = REG0–REG5，`6` = `inp`（输入端口），`7` = `out`（输出端口）。
跳转目标取自 **REG0**，条件值取自 **REG3**，与源资料 §6.4 一致。
代价：字段位序是**本复刻版的设计**，源资料没给；关卡数据的注释逐条标注。

## 本阶段的交付物

| # | 文件 | 内容 |
|---|---|---|
| 1 | `src/core/defs/cpu.ts` | 6 个 CPU 元件定义 |
| 2 | `src/asm/isa.ts` | OVERTURE ISA 描述（字段、助记符、模式） |
| 3 | `src/asm/assemble.ts` | 汇编文本 → 字节数组（标签、注释、`\|` 字段） |
| 4 | `src/asm/index.ts` | 导出面 |
| 5 | `src/levels/spec.ts` | `ProgramCheck` + `ProgramStep` + 失败原因 `missing-program` |
| 6 | `src/levels/checks.ts` | `program` 检查器的驱动实现 |
| 7 | `src/core/net.ts` | `params.image` → `ram_prog` 初始状态 |
| 8 | `src/levels/content/ch3/batch1.ts` | 第 39–41 关 |
| 9 | `src/levels/content/ch3/batch2.ts` | 第 42–44 关 |
| 10 | `src/levels/content/ch3/batch3.ts` | 第 45–47 关 |
| 11 | `src/levels/content/ch3/index.ts` | 章节装配 |
| 12 | `src/levels/content/index.ts` | 追加第 3 章 |

## Task 1: recon — 内核参数与初始状态通路

**目标**：把「`ram_prog` 的初始程序镜像怎么进到 `Simulation`」这条路摸清楚并写进
账本，避免 Task 2 在一个不存在的机制上设计。

必须回答（读代码，不猜）：
- `compile()`（`src/core/net.ts`）是否读实例 `params`？读了哪些键？`level_input` 的
  `params.width` 是怎么被用上的（Phase 1 Task 2 引入了它）？
- `Simulation` 的 state 槽是怎么分配的（`stateBytes`）？有没有一个「装载初始状态」
  的入口，还是只能在 `compile` 时写入？
- `reset()` 会不会把初始状态清掉？如果会，`ram_prog` 的镜像必须在 `reset` 后仍然存在
  ——这是本任务最关键的未知。

交付：`.superpowers/sdd/2026-09-29-turing-complete-phase2/recon-kernel.md`，
每一条结论都要有「文件名:行号」与一句代码原文。

## Task 2: 六个 CPU 元件（`src/core/defs/cpu.ts`）

新增文件，注册进 `DEF_IDS` 与 `BASE_DEFS`（或 `defs/index.ts` 的对应阵）。
全部 `sequential: false` 的元件按组合语义写；带状态的按存储元件契约写。

| id | 中文/英文 | inputs | outputs | 语义 |
|---|---|---|---|---|
| `alu8` | 8 位运算器 / 8-Bit ALU | `a:8` `b:8` `op:3` | `out:8` | op: 0 add, 1 sub, 2 and, 3 or, 4 nand, 5 nor；6/7 输出 0 |
| `regfile6` | 六级寄存器堆 / 6-Register File | `addrA:3` `addrB:3` `waddr:3` `data:8` `we:1` | `a:8` `b:8` | 2 读 1 写；`we` 为高时时钟沿写入 `waddr`；`evaluate` 只发布 state，按地址**索引**（与 `ram8.addr` 同一条例外） |
| `instr_decoder` | 指令解码器 / Instruction Decoder | `instr:8` | `mode:2` `op:3` `dst:3` `src:3` `imm:6` | 组合解码，字段见裁决 5；保留位不校验（保留位的校验是关卡的事） |
| `pc8` | 程序计数器 / Program Counter | `load:1` `in:8` | `out:8` | 时钟沿：`load` 高则 `state = in`，否则 `state = (state + 1) & 0xff`；发布 state |
| `ram_prog` | 程序存储器 / Program RAM | `addr:8` | `out:8` | 256 字节，初始镜像来自实例 `params.image`（Task 1 的通路）；读按地址索引 |
| `halt` | 停机 / Halt | `in:1` | `out:1` | 组合直通（`out = in`），`cost: 0`、`gateCost: 0`；存在意义是给关卡一个可断言的停机点 |

**门成本**（NAND 等价，写死并给出构造注释）：
`alu8` = 一个 8 位加减器 + 按位逻辑的展开值（加法器 72、sub 用补码再 +16、
五个逻辑各按宽度计），`regfile6` = 0（存储免费，与 `reg8` 一致）、
`instr_decoder` 按位切片与比较展开、`pc8` = 0（存储）、
`ram_prog` = 0、`halt` = 0。**每个数都要有构造注释**，与 Phase 1 的口径一致。

`config.ts` 里 `SCORE_WEIGHTS` 不动。

## Task 3: 汇编器内核（`src/asm/`）

`isa.ts`：把裁决 5 的表格写成数据。导出 `OVERTURE_ISA`：
每个模式的名字、操作码、字段位域、助记符→字段值映射。
不得把指令语义写进编译器——`isa.ts` 只描述**编码**。

`assemble.ts`：`assemble(source: string, isa): AssembleResult`
- 支持 `#` 注释、空行、`label name` 标签、`|` 字段分隔、大小写敏感（源资料 §6.6）。
- 输出 `{ bytes: number[]; labels: Record<string, number>; errors: AssembleError[] }`。
- 错误必须**可读且定位到行**（行号 + 原文 + 原因），不得抛异常穿透到 UI。
- 必须纯函数、无 I/O、无时间、无随机。

`test/levels/asm.test.ts`：每个指令一条往返用例；一个标签前向引用用例；
一个错误用例（未知助记符、字段越界、未定义标签）各断言行号。

## Task 4: `program` 检查器（`src/levels/spec.ts` + `checks.ts`）

```ts
export interface ProgramStep {
  readonly tick: number;
  readonly inputs?: Readonly<Record<string, number>>;
  readonly expect?: Readonly<Record<string, number>>;
}
export interface ProgramCheck {
  readonly kind: 'program';
  /** 汇编源码，由关卡数据提供；编译在检查器内进行，逐拍驱动。 */
  readonly source: string;
  readonly steps: readonly ProgramStep[];
}
```

- 空 `steps`（或全部没有 `expect`）是硬失败 `missing-program`——`missing-rows` 那一课。
- 编译失败（`errors` 非空）是 `invalid`，`detail` 带上第一行错误。
- 编译产物写入 `ram_prog` 实例的 `params.image` 之后再 `compile`；具体通路按 Task 1 的结论。
- `ticksUsed` 计真（喂给星级），与 `script` 同一口径。

## Task 5: 第 39–41 关（`ch3/batch1.ts`）

| 关 | id | 名称 | io | 检查器 | 奖励 |
|---|---|---|---|---|---|
| 39 | `ch3-39-arithmetic-engine` | 算数引擎 / Arithmetic Engine | `a:8 b:8 op:3 -> out:8` | fuzz | `alu8` |
| 40 | `ch3-40-registers` | 寄存器之间 / Registers | `clk:1 we:1 addr:3 data:8 -> out:8` | script | `regfile6` |
| 41 | `ch3-41-component-factory` | 元件工坊 / Component Factory | `clk:1 sel:2 data:8 -> a:8 b:8` | script | `instr_decoder` |

每关都要有 `SOURCED` / `AUTHORED` 注释（与第 2 章同一格式），
`threeStar` 三项**必须等于参考解实测值**，并有测试把它钉住。

## Task 6: 第 42–44 关（`ch3/batch2.ts`）

| 关 | id | 名称 | io | 检查器 | 奖励 |
|---|---|---|---|---|---|
| 42 | `ch3-42-instruction-decoder` | 指令解码器 / Instruction Decoder | `instr:8 -> mode:2 op:3 dst:3 imm:6` | truth-table（256 行生成） | `pc8` |
| 43 | `ch3-43-calculations` | 计算单元 / Calculations | `clk:1 instr:8 inp:8 -> res:8` | program | `ram_prog` |
| 44 | `ch3-44-conditions` | 条件判断 / Conditions | `clk:1 instr:8 -> skip:1` | script | `halt` |

第 44 关的源资料成就是「仅用 10 个蓝色元件」——按 spec §5.4 的既定口径，
**成就值只记录、不参与评分**，本关目标仍是参考解实测值。

## Task 7: 第 45–47 关（`ch3/batch3.ts`）

| 关 | id | 名称 | io | 检查器 | 奖励 |
|---|---|---|---|---|---|
| 45 | `ch3-45-program` | 程序 / Program | `clk:1 -> out:8` | program | 无 |
| 46 | `ch3-46-immediate-values` | 立即数 / Immediate Values | `clk:1 -> out:8` | program | 无 |
| 47 | `ch3-47-turing-complete` | 图灵完备 / Turing Complete | `clk:1 -> out:8` | program | 无 |

**第 47 关是本阶段的验收关**：它的参考解是**用第 39–46 关的元件在电路层搭出的
完整 OVERTURE**（`instr_decoder` + `regfile6` + `alu8` + `pc8` + `ram_prog` + `halt`
以及条件跳转的粘合逻辑），程序是一个真正的循环（递减到 0 并输出结果）。
测试必须：断言参考解拿到 1 星（通过），断言**去掉条件跳转粘合逻辑的反例失败**。

## Task 8: 章节装配与解锁链

- `ch3/index.ts` 汇总三个批次，`content/index.ts` 追加。
- `test/levels/unlock-chain.test.ts` 与 spec §3.3 的 Ch3 行必须一致
  （`alu8` `regfile6` `instr_decoder` `pc8` `ram_prog` `halt`，六个都要被某一关奖励，
  且解锁点不晚于第一次被需要）。
- `test/levels/level-buildability.test.ts` 自动覆盖新关（它走全量关卡）。

## Task 9: 阶段收尾验证

- `pnpm test` 全绿、`tsc --noEmit` 干净、`pnpm build` 干净、`pnpm smoke` 通过。
- 第 47 关的程序在浏览器里跑通（smoke 增加一条：进入第 47 关、载入参考解、断言通过）。
- 账本收尾 + 最终整分支评审。

## 依赖图

```
Task 1 (recon) ─┬─> Task 2 (cpu defs) ──┐
                └─> Task 4 (program) ───┼─> Task 5 ─┐
Task 3 (asm) ───────────────────────────┘          ├─> Task 8 ─> Task 9
                                        Task 6 ────┤
                                        Task 7 ────┘
```

Task 3 与 Task 1 可并行；Task 2 依赖 Task 1（镜像通路）；Task 5/6/7 依赖 2+3+4。

## 文件所有权（写范围，避免并发写冲突）

| 任务 | 独占写范围 |
|---|---|
| T1 | `.superpowers/sdd/2026-09-29-turing-complete-phase2/recon-kernel.md` |
| T2 | `src/core/defs/cpu.ts`, `src/core/defs/index.ts`, `test/core/defs-cpu.test.ts` |
| T3 | `src/asm/**`, `test/levels/asm.test.ts` |
| T4 | `src/levels/spec.ts`, `src/levels/checks.ts`, `src/core/net.ts`, `test/levels/program-check.test.ts` |
| T5 | `src/levels/content/ch3/batch1.ts`, `test/levels/ch3-batch1.test.ts` |
| T6 | `src/levels/content/ch3/batch2.ts`, `test/levels/ch3-batch2.test.ts` |
| T7 | `src/levels/content/ch3/batch3.ts`, `test/levels/ch3-batch3.test.ts` |
| T8 | `src/levels/content/ch3/index.ts`, `src/levels/content/index.ts` |
| T9 | `.superpowers/sdd/2026-09-29-turing-complete-phase2/progress.md`, `README.md` |
