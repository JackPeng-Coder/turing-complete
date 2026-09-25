# Phase 1 — 第 2 章「算术与存储」实施计划

Spec: `docs/superpowers/specs/2026-09-25-turing-complete-replica-design.md`
Predecessor: `docs/superpowers/plans/2026-09-25-turing-complete-phase0.md`
Ledger: `.superpowers/sdd/2026-09-25-turing-complete-phase1/progress.md`

阶段 0 交付了可玩的第 1 章 12 关（239 个测试通过）。本阶段把游戏扩展到
**第 2 章 26 关 + 宽位组件体系**。spec §12 规定的验收标准：

> 阶段 1：第 2 章 26 关（算术与存储）+ 宽位组件体系。
> 验收：26 关回归通过；锁存器/振荡器/计数器测试通过。

## Global Constraints

以下约束来自 spec，适用于本阶段每一个任务，违反即为缺陷。

1. **零运行时依赖**。`dependencies` 必须保持为空；一切进 `devDependencies`。
   版本已钉死：`vite@8.3.1`、`vitest@5.0.2`、`typescript@5.9.3`、
   `@playwright/test@1.63.0`、`jsdom@28.1.0`。不得升级、不得新增。
2. **分层依赖单向**：`ui → app → levels → core`，`persist → app`。
   `core/` 不得 import 任何上层模块。新组件定义放 `core/defs/`，
   新检查器放 `levels/`，不得反向。
3. **信号只有 `0` / `1`**。宽位端口在内部就是连续的多条 1 位槽位，
   **永不打包**。`SignalTable` 容量在 `compile()` 时确定且永不重分配。
4. **延迟约定**：每个组件恰好贡献 1 单位延迟；存储元件在组合路径上贡献 0
   （`sequential: true` 双向切断路径）。组合环无存储元件 → `UnstableCircuitError`，
   `SETTLE_LIMIT = 512`。
5. **存储元件契约**（阶段 0 用两个 bug 换来，不得违反）：
   `evaluate(inputs, outputs, state, ctx)` **只发布 state，绝不读 inputs**；
   `clockEdge` **只把 inputs 采样进 state，绝不写 outputs**。
   `state` 是**必填**第三参数，类型 `Uint8Array | undefined`。
6. **评分权值**从 `SCORE_WEIGHTS` 读取，不得硬编码。`score = gate + delay*4 + tick*8`。
   星级只有 0/1/3，没有 2 星。指标**等于**目标即算达标。
7. **关卡是纯数据**。新增关卡不得修改引擎代码。
   `truth-table` 检查器省略或留空 `rows` 是硬失败 `missing-rows`，
   绝不是「穷举所有组合」。
8. **关卡 I/O 按实例 id 绑定**：`IN_<pinId>` / `OUT` / `OUT_<pinId>`。
   引脚名来自组件定义，改不了，所以 id 是唯一能携带绑定的东西。
9. **版权边界**（spec §1.4）：不得复制原作对话、文本、美术资产。
   关卡名沿用源资料的中英文对照表（识别性标题，非艺术资产）；
   简报与提示**必须是原创文案**。叙事角色是「考核者 / The Assessor」。
   所有未标为「源资料」的关卡数值都在数据注释里标为**本复刻版设计**。
10. **测试策略**（spec §10）：每个任务交付前 `pnpm test` 全绿；
    改动 UI 的任务还要 `pnpm build` 与 `pnpm smoke`。
    参考解必须通过，反例必须失败——只测参考解不算验证。

## 本阶段的核心难度

阶段 0 的每一个引脚宽度都是 1，因此三处缺陷无法被触发。它们已记录在阶段 0
账本的「Deferred into Phase 1」里，**必须最先修**，否则第 2 章的 8 位端口
会静默读错相邻槽位，而不是响亮地失败：

1. `Simulation.#readInputs` 用 `getPort(drive[base], width)` 一次性读 `width` 位。
   当驱动的输出引脚比输入引脚**窄**时（1 位 `level_input` 驱动 8 位 `add8.a`），
   它会连同相邻引脚一起读进来 —— 静默损坏。
2. `Netlist.inputBase()` 返回**驱动槽位**，调用方再按 `width` 连续读，
   同样只在宽度相等时正确。
3. `level_input` / `level_output` 的引脚宽度硬编码为 1，而 `bindLevelIo`
   按 `spec.io` 的宽度连续写入 —— 8 位关卡输入会写花相邻槽位。
   `compile()` 目前**完全不读** `params`，而 spec §3.3 规定
   「多比特引脚由实例 `params.width` 覆盖」。

## 第 2 章设计总表

**关卡名与顺序来自源资料**（7 章 82 关结构，第 2 章 = 第 13–38 关）。
源资料**只给一行核心概念，没有真值表、没有端口、没有宽度、没有通关条件**。
因此下表的 `io`、检查器、`threeStar`、`rewards` **全部是本复刻版的设计**：
它们按源资料给出的名字与教学顺序推导，并在关卡数据注释里逐关标注出处。
两关源资料标为「限时小游戏」（15 二进制速算、23 负数）在本作中改建为
同一概念的电路关；第 34 关「总线」按 spec §3.1「不做总线协议（多驱动仲裁）」
改建为「同一时刻只有一个驱动器有效」的选择器关。三处改建都记录在账本里。

26 关的逐关定义在 **Task 8–11 各自的小节里**，每关四个批次只拥有自己那几关，
这样每个实施者的 brief 都是自足的（brief 提取器按 `## Task N:` 切分，
提取不到本节之外的内容）。总览：

| 批次 | 关卡 | 主题 | 检查器 |
|---|---|---|---|
| Task 8 | 13–17 | 标量逻辑与计数 | truth-table / constraint |
| Task 9 | 18–22 | 8 位逻辑与加法 | fuzz 起步 |
| Task 10 | 23–27 | 补码、解码器与逻辑引擎 | fuzz |
| Task 11 | 28–38 | 存储与时序 | script |

**全章共用的解锁链规则**（Task 7 必须把它们变成机器检查）：

- 每一关用到的组件，必须在**该关之前**已经解锁（否则玩家卡死）。
- 每个第 2 章组件必须**恰好**被一个关卡解锁，且解锁点不晚于它第一次被需要。
- `mem1` 已由第 1 章第 8 关解锁（阶段 0 事实），第 2 章不重复解锁。
- `half_adder` 不在 spec §3.3 的第 2 章清单里，因此**不做成组件**：
  第 20 关的奖励是 `full_adder`。
- `decoder2` 不在第 2 章清单里，因此 `decoder1` 与 `decoder2` 是
  **同一个宽度参数化解码器**（`params.width`），不各自占一个解锁点。

## Task 1: 内核宽位端口正确性

**Files:** `src/core/net.ts`, `test/core/net.test.ts`

修「核心难度」第 1、2 条，并给宽位端口立下不可违反的读写口径。

- `#readInputs` 必须**逐位**经 `drive[]` 追踪：对输入引脚的每个位 `b`，
  读 `drive[base + b]` 指向的**那一个槽位**，再组装成该引脚的值。
  1 位驱动 8 位输入时，高 7 位必须是 0，而不是隔壁引脚的信号。
- `Netlist` 必须提供一个**保证连续**的读区域：调用方
  `read(net.inputBase(key), width)` 拿到的 `width` 位必须属于**同一个引脚**，
  且每次 `settle()` 之后就已经是最新的，调用方无需额外调用。
  实现方式自选（编译期为每个输入引脚物化一段 gather 区域，或在写回时逐位拷贝）。
- **反例测试是重点**，必须包含：
  - 1 位输出驱动 8 位输入，且该 1 位输出与另一个正在翻转的信号**相邻**，
    断言宽输入只看到那 1 位（这是静默损坏的复现）。
  - 8 位输出驱动 1 位输入，断言只取最低位。
  - 8 位输出驱动 8 位输入，逐位正确。
  - `inputBase` + `read` 在 settle 之后读到完整 8 位。

## Task 2: 引脚宽度按实例解析

**Files:** `src/core/net.ts`, `src/core/graph.ts`, `src/levels/checks.ts`,
`src/ui/board/interact.ts`, `test/core/net.test.ts`, `test/levels/checks.test.ts`,
`test/ui/panels.test.ts`

修「核心难度」第 3 条。spec §3.3：「多比特引脚由实例 `params.width` 覆盖」。

- `compile()` 必须把**有效引脚宽度**解析为 `inst.params.width ?? def.pin.width`，
  并在**所有**用到宽度的地方使用它：槽位分配、`drive` 长度、`#readInputs`、写回。
  `params.width` 缺省时行为必须与阶段 0 完全一致（回归测试钉死）。
- `level_input` / `level_output` 的引脚宽度因此随实例变化，不再恒为 1。
- `interact.ts` 的 `place()` 在实例 id 是 `IN_<pin>` / `OUT` / `OUT_<pin>` 时，
  必须把该引脚的宽度写进 `params.width`。否则玩家从调色板拖出的 8 位关卡输入
  只有 1 位宽，而 `bindLevelIo` 会按 8 位连续写 —— 又是静默损坏。
- `bindLevelIo` 的宽度必须以**编译后的引脚定义**为准；
  当它与 `spec.io` 不一致时**报错**，而不是静默按其中一个写。
  电路里根本没有该实例时保持阶段 0 行为（读作 0）。
- 测试：8 位关卡输入 → 8 位组件的往返；缺省 1 位（回归）；
  宽度不一致时报错；`place()` 写出正确的 `params.width`。

## Task 3: 宽位纯组合组件

**Files:** `src/core/defs/wide.ts`（新建）, `src/core/defs/index.ts`,
`src/core/registry.ts`, `test/core/registry.test.ts`

按 spec §3.3「同一套算子的宽度参数化」做成生成器，宽度本阶段只放开 8，
生成器签名接受宽度，为阶段 5 的 16/32/64 留口。
id 与引脚名必须**逐字**如下（关卡数据依赖它们）：

| id | 输入 | 输出 |
|---|---|---|
| `and8` `or8` `nand8` `nor8` `xor8` `xnor8` | `a:8` `b:8` | `out:8` |
| `not8` | `a:8` | `out:8` |
| `add8` | `a:8` `b:8` `cin:1` | `out:8` `cout:1` |
| `neg8` | `a:8` | `out:8` |
| `less_s` `less_u` `equal8` | `a:8` `b:8` | `out:1` |
| `shift_l8` `shift_r8` `ashr8` | `a:8` `amount:8` | `out:8` |
| `rot_l8` `rot_r8` | `a:8` `amount:8` | `out:8` |
| `mul8` `div8` | `a:8` `b:8` | `out:8` |
| `const8` | — | `out:8` |
| `splitter` | `in:8` | `b0..b7:1`（8 条） |
| `maker` | `b0..b7:1`（8 条） | `out:8` |
| `switch` | `a:1` `on:1` | `out:1` |
| `switch8` | `a:8` `on:1` | `out:8` |

要求：

- 溢出与边界语义必须**定义并测试**：`add8.cout` 是第 8 位进位；
  `mul8` 只保留低 8 位；**`div8` 除零的行为必须定义**（取 `0xff`），不能是未定义行为；
  `ashr8` 符号位扩展；`shift_*` 的 `amount >= 8` 定义为 0（`rot_*` 则为 `amount % 8`）。
  负数读数一律按无符号位模式处理，不引入 `number` 负数。
- 宽位值用 `number` 承载（8 位远在安全整数内）。`assertWidth` 在 >32 位时报错，
  这是**有意的**：64 位值是 `Uint8Array`，属于阶段 5。本阶段不得出现
  把 64 位值塞进 `number` 的路径。
- `splitter` / `maker` 的引脚数量与宽度**必须可配置**（`params`），
  这是它们在后续章节唯一的用法。`params` 缺省即 8。
- 测试：每个运算符至少一组边界向量（0、1、最大值、进位/借位、符号边界）
  加一组性质检查；`div8` 被测到除零；`maker(splitter(x)) === x` 往返若干 `x`。

## Task 4: 宽位存储与序列组件

**Files:** `src/core/defs/wide.ts`, `src/core/net.ts`,
`test/core/registry.test.ts`, `test/core/net.test.ts`

落地 `reg8` `counter8` `mux8` `delay8` `ram8`，引脚名：

| id | 输入 | 输出 | 语义 |
|---|---|---|---|
| `mux8` | `a:8` `b:8` `sel:1` | `out:8` | `sel=0 → a`，`sel=1 → b` |
| `delay8` | `a:8` | `out:8` | 延迟恰好一个时钟拍 |
| `reg8` | `d:8` `load:1` `reset:1` | `out:8` | 时钟沿且 `load=1` 时采样；`reset=1` 时清零 |
| `counter8` | `en:1` `reset:1` | `out:8` | 时钟沿且 `en=1` 时 `+1`，溢出回绕到 0；`reset=1` 时清零 |
| `ram8` | `d:8` `addr:8` `load:1` | `out:8` | 256 字节存储；`load=1` 时写入 `addr`，否则读 |

- 存储契约（Global Constraint 5）是**硬约束**。
- `Simulation.#publishState` 目前假设「每个状态字节对应一条 1 位输出引脚」
  （见 `net.ts` 该函数注释）—— **必须扩展**，否则 `reg8` 只发布低 1 位。
- 同时给出 `reset=1` 与 `load=1` / `en=1` 时谁优先，并在**注释与测试**里钉死。
- 测试必须包含 spec §12 点名的三类：
  - **锁存**：`reg8` 在输入翻转后、下一个时钟沿之前保持旧值
    （阶段 0 `delay_line` 正是在这里栽过：镜像输入 = 退化成导线）。
  - **振荡**：`nand` + `delay_line`（或 `not` + `delay8`）构成的环形振荡器
    在 `settle()` 下**必须稳定**（存储元件切断组合环），每个 `tick()` 翻转一次。
  - **计数器**：连续 `tick` 计数正确、`en=0` 时不计、溢出正确回绕到 0。

## Task 5: `fuzz` 检查器

**Files:** `src/levels/spec.ts`, `src/levels/checks.ts`, `test/levels/checks.test.ts`

spec §5.2 要求 `fuzz` 在开始第 2 章之前实现。

- `FuzzCheck`：`{ kind: 'fuzz'; seed: number; rounds: number; inputs; outputs }`，
  `inputs` / `outputs` 是按名给出的**纯函数**：不抓网络、不读真实时间、
  不依赖 `Math.random()`。
- 随机数必须自带**确定性 PRNG**（如 xorshift32），种子写进关卡数据。
  必须有测试**跨两次运行比对向量序列**，证明同种子同向量。
- 失败报告必须给出**具体哪一轮、哪组输入、期望什么、实际什么**，
  而不是只说「模糊测试失败」。
- `rounds` 的缺省与上限必须定义并测试（防止关卡写出 10^9 轮卡死编辑器）。
  **`rounds: 0` 或 `inputs` 为空不得静默通过** —— 这是 `missing-rows` 的同类教训。

## Task 6: `custom` 检查器

**Files:** `src/levels/spec.ts`, `src/levels/checks.ts`, `src/levels/custom/index.ts`（新建）,
`test/levels/checks.test.ts`

spec §5.2：`custom` 是逃生舱，但必须只依赖内核公开接口，且能离线跑通。

- `CustomCheck`：`{ kind: 'custom'; id: string }`，`id` 在注册表里查一个
  实现 `(io: LevelIo, spec: LevelSpec) => CheckOutcome` 的函数。
  内核**不**接受关卡数据里内联的函数 —— 那既不能序列化也不能审查。
- 注册表里未注册的 `id` 必须是硬失败（`missing-check`），不得静默通过。
- checker 抛异常必须被转成失败结果，而不是把 `grade()` 打穿（阶段 0 的 `RangeError` 教训）。
- 测试：注册假 checker 断言被调用、返回值被采纳；未注册 id 失败；抛异常转失败。
- 本阶段**不**添加真实 `custom` 关卡（第 2 章用不到），但机制必须先存在。

## Task 7: 章节装配与解锁链校验

**Files:** `src/levels/index.ts`, `src/levels/content/index.ts`,
`src/levels/content/ch2/`（新建目录）, `src/app/progress.ts`, `src/ui/map.ts`,
`test/levels/unlock-chain.test.ts`（新建）, `test/app/progress.test.ts`

- 章节装配容纳 26 关，顺序稳定。
- 组件解锁仍然**从已通过关卡的奖励推导**，绝不存储
  （阶段 0 的 `migrate` 会丢弃 `unlockedComponents`，这条不能退化）。
- 章节地图显示 2 章。
- 第 2 章关卡文件按批次拆分（`ch2/batch1.ts` 等），`content/index.ts` 汇总。
  本任务只建目录与汇总入口，**不写关卡数据**（Task 8–11 各自拥有自己的批次文件）。
- **本任务不写解锁链测试**：它要遍历全部 26 关，而关卡数据要到 Task 11 才齐。
  Task 12 拥有那条测试（见 Task 12）。这是有意的顺序，不是遗漏。

## Task 8: 第 2 章关卡 13–17（标量逻辑与计数）

**Files:** `src/levels/content/ch2/batch1.ts`, `test/levels/ch2-batch1.test.ts`

逐关定义（`id` 形如 `ch2-13-odd-number-of-signals`）：

| # | 关卡名（源资料） | io | 检查器 | 解锁 | 教学点 |
|---|---|---|---|---|---|
| 13 | ODD Number of Signals 奇数个信号 | `a:4` → `out:1` | truth-table 16 行 | `splitter` `maker` `const8` | 异或链判奇偶；宽端口拆成位 |
| 14 | Double Trouble 成对的麻烦 | `a,b,c,d:1` → `out:1` | constraint `at-least` 2 | — | 至少 2 个为高 |
| 15 | Binary Racer 二进制速算 | `a:4` → `out:3` | truth-table 16 行 | `less_u` | 4 位量化成 3 位计数 |
| 16 | Counting Signals 信号计数 | `a,b,c,d:1` → `out:3` | truth-table 16 行 | `equal8` | 4 个 1 位信号相加（半加器思想） |
| 17 | Double the Number 加倍 | `a:8` → `out:8` | truth-table 256 行（生成） | `add8` `mul8` | 左移一位即加倍 |

每关必须提供完整 `LevelSpec`：`id` `chapter: 2` `index` `name`(中英)
`brief`(原创) `hint`(原创) `allowedComponents` `io` `checks` `threeStar` `rewards`。

要求：

- 第 15、16 关输出是 3 位计数，用 `generateRows` 生成真值表行，
  **不得**留空 `rows`（空 `rows` 是硬失败 `missing-rows`）。
- 第 13 关的 4 位输入是**有意的**：源资料没说宽度，4 位既够教学又让
  16 行真值表可穷举。这一选择在关卡数据注释里标为「本复刻版设计」。
- 第 15 关源资料是「限时二进制转换小游戏」，本作改建为 4 位 → 3 位计数电路。
  这一改建必须写进关卡 `brief` 的数据注释。
- `threeStar` 三项都必须由参考解**实测**得出，且参考解本身就满足。
- 每关一条参考解测试 + 一条**必须真的失败**的反例测试。

## Task 9: 第 2 章关卡 18–22（8 位逻辑与加法）

**Files:** `src/levels/content/ch2/batch2.ts`, `test/levels/ch2-batch2.test.ts`

| # | 关卡名（源资料） | io | 检查器 | 解锁 | 教学点 |
|---|---|---|---|---|---|
| 18 | Byte OR 8 位或 | `a:8` `b:8` → `out:8` | fuzz 256 轮 | `and8` `or8` `nand8` `nor8` | 8 位按位或 |
| 19 | Byte NOT 8 位非 | `a:8` → `out:8` | fuzz 256 轮 | `xor8` `xnor8` `not8` | 8 位按位非 |
| 20 | Half Adder 半加器 | `a:1` `b:1` → `sum:1` `carry:1` | truth-table 4 行 | `full_adder` | 和与进位 |
| 21 | Full Adder 全加器 | `a:1` `b:1` `cin:1` → `sum:1` `cout:1` | truth-table 8 行 | `neg8` | 带进位的 1 位加法器 |
| 22 | Adding Bytes 8 位加法器 | `a:8` `b:8` `cin:1` → `out:8` `cout:1` | fuzz 256 轮 | `switch` `switch8` | 级联全加器 |

要求：

- **`fuzz` 从本批开始使用**（第 18、19、22 关），必须用 `seed` + `rounds: 256`，
  期望函数是纯函数。
- 第 20 关的 id 是 `ch2-20-half-adder`，但**不**产出 `half_adder` 组件
  （spec §3.3 的第 2 章清单里没有它）；奖励是 `full_adder`，玩家下一关就要用。
- 第 22 关的 `threeStar.delay` 必须**由参考解实测**得出。源资料给的
  「延迟 ≤ 35」是**成就**而非通关条件：把它作为注释里的参考值记下来，
  但 `threeStar` 用实测值。若实测值大于 35，照实写实测值。
- 第 21 关源资料的成就是「仅用 5 个蓝色元件」；本作没有「蓝色元件」体系
  （那是自定义组件，阶段 3 才有），因此改为 `threeStar.gate` 实测门槛，
  并在数据注释里说明这一映射。

## Task 10: 第 2 章关卡 23–27（补码、解码器与逻辑引擎）

**Files:** `src/levels/content/ch2/batch3.ts`, `test/levels/ch2-batch3.test.ts`

| # | 关卡名（源资料） | io | 检查器 | 解锁 | 教学点 |
|---|---|---|---|---|---|
| 23 | Negative Numbers 负数 | `a:8` → `out:8` | fuzz 256 轮 | `div8` | 二进制补码表示 |
| 24 | Signed Negator 相反数 | `a:8` → `out:8` | fuzz 256 轮 | `less_s` `shift_l8` `shift_r8` | 取反 + 1 |
| 25 | 1 Bit Decoder 1 位解码器 | `sel:1` → `out:2` | truth-table 2 行 | `decoder1` | 1-to-2 解码 |
| 26 | 3 Bit Decoder 3 位解码器 | `sel:3` → `out:8` | truth-table 8 行 | `decoder3` | 3-to-8 解码 |
| 27 | Logic Engine 逻辑引擎 | `a:8` `b:8` `op:8` → `out:8` | fuzz 256 轮 | `ashr8` `rot_l8` `rot_r8` | 8 位算术逻辑单元 |

要求：

- 第 23 关源资料是「限时小游戏」，本作改建为补码运算电路；
  这一改建写进关卡数据注释。
- 第 27 关的 `op` 语义**源资料没有枚举**，因此必须由本计划钉死并在
  关卡 `brief` 里对玩家说清楚。采用 `op` 的低 3 位选择运算：
  `0=and 1=or 2=xor 3=not a 4=add 5=sub 6=shift_l(a, b 低 3 位) 7=ashr(a, b 低 3 位)`，
  `out` 为 8 位结果（`add`/`sub` 丢弃高位进位）。`brief` 必须逐条列出这 8 个操作码。
- 第 25 关解锁的解码器是**宽度参数化**的：`decoder1` 与 `decoder2` 是同一个
  组件定义在不同 `params.width` 下的形态，不各占一个解锁点。
  第 25 关的 `brief` 必须说明玩家可以用 `params.width` 得到 2 位解码器。
- 第 24 关的 `threeStar` 与第 23 关一样由参考解实测。

## Task 11: 第 2 章关卡 28–38（存储与时序）

**Files:** `src/levels/content/ch2/batch4.ts`, `test/levels/ch2-batch4.test.ts`

| # | 关卡名（源资料） | io | 检查器 | 解锁 | 教学点 |
|---|---|---|---|---|---|
| 28 | Circular Dependency 循环依赖 | `set:1` `value:1` → `out:1` | script + 稳定性 | `ram8` | 反馈回路构成锁存器 |
| 29 | Delayed Lines 延迟线 | `a:8` → `out:8` | script 逐拍 | `reg8` `delay8` | 延迟一拍 |
| 30 | Odd Ticks 奇变偶不变 | `enable:1` → `out:1` | script + 周期断言 | — | 振荡器即时钟源 |
| 31 | Bit Inverter 1 位取反器 | `a:1` `inv:1` → `out:1` | truth-table 4 行 | — | XOR 做条件取反 |
| 32 | Bit Switch 1 位开关 | `a:1` `on:1` → `out:1` | truth-table 4 行 | — | 条件通断 |
| 33 | Input Selector 数据选择器 | `a:8` `b:8` `sel:1` → `out:8` | fuzz 256 轮 | `mux8` | 2-to-1 MUX |
| 34 | The bus 总线 | `a:8` `b:8` `sel:1` → `out:8` | truth-table 4 行 | — | 唯一驱动有效 |
| 35 | Saving Gracefully 优雅存储 | `d:1` `load:1` → `out:1` | script 逐拍 | — | 条件写入锁存器 |
| 36 | Saving Bytes 存储一字节 | `d:8` `load:1` → `out:8` | script 逐拍 | `counter8` | 8 位寄存器 |
| 37 | Little Box 小盒子 | `d:8` `addr:8` `load:1` → `out:8` | script 逐拍 | — | 256 字节全装满 |
| 38 | Counter 计数器 | `en:1` `reset:1` → `out:8` | script + 回绕 | — | 自增寄存器 |

要求：

- 第 28 关的「稳定性」指：`settle()` **不得**抛 `UnstableCircuitError`。
  这是本关的核心断言 —— 玩家必须用存储元件切断组合环。必须有反例：
  纯组合的 `not` 环必须抛错。
- 第 30 关必须断言**周期性**（连续多拍的高低翻转规律），
  不能只断言「某一拍为高」。`enable=0` 时输出必须保持，不得继续振荡。
- 第 34 关按 spec §3.1「不做总线协议（多驱动仲裁）」改建为选择器关：
  `out` 恰好等于被选中的那一路。这一改建（以及「本引擎禁止多驱动」这条理由）
  必须写进关卡数据注释与 `brief`。
- 第 37 关源资料只有「刚好装满存储空间的电路设计」一句：
  本作定义为「用 `ram8` 的 256 字节全部可寻址且可读回」，
  即 `addr` 0–255 每一格写入后都能读回原值。这一定义必须写进 `brief`。
- 第 38 关源资料的成就是「≤ 65 个门」，映射为 `threeStar.gate` 实测门槛，
  并在数据注释里说明。


## Task 12: 阶段 1 收尾验证与解锁链校验

**Files:** `README.md`, `docs/superpowers/plans/2026-09-25-turing-complete-phase0.md`,
`test/levels/unlock-chain.test.ts`（新建）

- **新增 `test/levels/unlock-chain.test.ts`**，把整章的解锁链变成机器检查。
  这条测试放在最后，因为它要遍历全部 26 关，而关卡数据到 Task 11 才齐：
  1. 每一关的 `allowedComponents` 只含该关**之前**已解锁的组件（含 starter 集合
     `['level_input','level_output','const_on','const_off']` 与第 1 章已解锁的组件）。
     否则玩家卡死。
  2. 每个第 2 章组件（spec §3.3 的 26 项清单）**恰好**被一个关卡解锁。
  3. 组件在其首次**被需要**的关卡之前或同关解锁，
     且解锁点不晚于它第一次出现在某关 `allowedComponents` 里。
  4. 第 2 章恰好 26 关、`index` 为 13–38 且连续无重复。
- 全量回归：`pnpm test`、`pnpm build`、`pnpm smoke`。
- 更新 README 的进度表述（第 1 章 12 关 → 第 1–2 章 38 关）。
- 修正阶段 0 计划里那张**已知过时**的第 1 章汇总表：要么从代码块重新生成，
  要么删掉 —— 一张与代码不符的表比没有表更糟。
- 浏览器里从第 1 关连到第 38 关的冒烟确认，并截图存档。
