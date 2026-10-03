# 《图灵完备》2.x 基线重构 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把已实现的第 1–3 章从 1.x 基线重构到 2.x 基线：13/26/10 = 49 关，关卡名、顺序、全局编号与 id 全部对齐 `GAME_RESEARCH_2026-10-03.md` §5。

**Architecture:** 关卡是纯数据（`LevelSpec`），引擎不随关卡改。重构的实质是四件事：**改名**（zh/en 与 id slug）、**重排**（`chapter` + 全局 `index`）、**替换集合**（新建 5 关、退役 3 关）、**追踪**（所有按 id 索引的测试、fixtures、剧情文案、解锁表、存档）。id 形如 `ch<章>-<全局序号>-<slug>`，`index` 是**全局序号**（ch2 的第一关是 `ch2-14-*` / `index: 14`），因此任何一章长度变化都会平移其后所有关——**这是一次原子改动，不能按章分次提交**。

**Tech Stack:** TypeScript 5.9 / Vite 8 / Vitest 5 / Playwright 1.63，零运行时依赖。

**Spec:** [`GAME_RESEARCH_2026-10-03.md`](../../GAME_RESEARCH_2026-10-03.md) §5（93 关全表，2.x 主来源）+ [`docs/superpowers/specs/2026-09-25-turing-complete-replica-design.md`](../specs/2026-09-25-turing-complete-replica-design.md)（引擎与评分口径）+ [`RESEARCH.md`](../../RESEARCH.md)（1.x/2.x 差异与冲突登记）

## Global Constraints

- 运行时依赖数量 = **0**；所有依赖都在 `devDependencies`，且精确钉版（`test/conventions.test.ts` 会失败）。
- 依赖单向：`core` ← `asm` ← `levels` ← `app` ← `ui`（`persist` 读 `app`）。
- 文案中英双语 `{ zh, en }`，**默认中文**；关卡介绍与提示全部原创，不抄原作文本。
- 每关：`id` / `chapter` / `index` / `name` / `brief` / `hint` / `allowedComponents` / `io` / `checks` / `threeStar`；`threeStar` = 参考解实测值。
- 解锁链硬规则：每关的调色板只含**之前已解锁**的组件；每个组件**恰好**被一关奖励；`mem1` 必须在第 2 章需要它之前到手（现在由 ch1-13 奖励）。
- 提交信息英文、Conventional Commits、一次提交一个连贯改动，且**不得让门禁失败**。
- 门禁：`pnpm build` + `pnpm test` + `pnpm smoke` 全绿（本机用 bundled node 跑 `pnpm.mjs`）。

## Review Focus

- **存档兼容**：玩家已存的星数按 id 索引（`Progress.levels: Record<string, LevelRecord>`）。id 改了，老存档必须**迁移而不是丢弃**——否则 47 关的进度一夜蒸发。迁移写进 `persist/storage.ts` 并有往返测试。
- **解锁链**：新增 5 关、退役 3 关后，`mem1` / `xnor` / `or8` / `nand8` / `less_u` 等奖励的归属会变；`unlock-chain.test.ts` 会解析设计规格 §3.3 的表格与关卡数据对账，**规格表必须与关卡数据同改**。
- **参考解仍然可建**：被移动的关卡（如 NOR 回到第 5 关）其参考解必须在**新的调色板**下可建——NOR 在第 5 关时 `or` 尚未解锁，参考解必须改用德摩根式（NOT+AND）。
- **剧情文案**：`src/ui/narrative.ts` 按 id 索引 12 条第 1 章台词，改名后必须跟随，否则第 1 章整章失去旁白。
- **注释里的 id**：`src/levels/checks.ts:1344,1446`、`src/ui/truthTable.ts:81` 用 id 举例，改 id 后这些注释会指向不存在的关卡。

---

## 目标形状（2.x，来源：新资料 §5）

**第 1 章 布尔代数 — 13 关**（全局 1–13）

| 全局# | id | 中文名 | 英文名 | 来源 |
|---|---|---|---|---|
| 1 | `ch1-01-humble-beginnings` | 从零开始 | Humble Beginnings | 复用 `ch1-01-crude-awakening`（改名） |
| 2 | `ch1-02-nand-gate` | 与非门 | NAND Gate | 复用 |
| 3 | `ch1-03-not-gate` | 非门 | NOT Gate | 复用 |
| 4 | `ch1-04-and-gate` | 与门 | AND Gate | 复用 |
| 5 | `ch1-05-nor-gate` | 或非门 | NOR Gate | 复用 `ch1-06-nor-gate`（**前移 6→5**，参考解改德摩根式） |
| 6 | `ch1-06-or-gate` | 或门 | OR Gate | 复用 `ch1-05-or-gate`（**后移 5→6**） |
| 7 | `ch1-07-always-on` | 长明灯 | Always On | 复用 |
| 8 | `ch1-08-second-cycle` | 第二周期 | Second Cycle | 复用 `ch1-08-second-tick`（改名） |
| 9 | `ch1-09-xor-gate` | 异或门 | XOR Gate | 复用 |
| 10 | `ch1-10-bigger-or-gate` | 三路或门 | Bigger OR Gate | 复用（**交出 `xnor` 奖励**，给新的第 12 关） |
| 11 | `ch1-11-bigger-and-gate` | 三路与门 | Bigger AND Gate | 复用 |
| 12 | `ch1-12-xnor-gate` | 同或门 | XNOR Gate | **新建**（奖励 `xnor`） |
| 13 | `ch1-13-logic-exam` | 逻辑试炼 | Logic Exam | **新建**（综合测验；奖励 `mem1`） |

**第 2 章 算术运算、存储器 — 26 关**（全局 14–39）

| 全局# | id | 中文名 | 英文名 | 来源 |
|---|---|---|---|---|
| 14 | `ch2-14-binary-racer` | 二进制速算 | Binary Racer | 复用 `ch1-12-binary-racer` 的谜题（一眼读四位数并转发），**移章** |
| 15 | `ch2-15-double-detection` | 成双成对 | Double Detection | 复用 `ch2-14-double-trouble`（改名） |
| 16 | `ch2-16-odd-number-of-signals` | 奇数计数技术 | Odd Number of Signals | 复用 `ch2-13-*` |
| 17 | `ch2-17-circular-dependency` | 循环依赖 | Circular Dependency | 复用 `ch2-28-*`（消费 `mem1`） |
| 18 | `ch2-18-counting-signals` | 信号计数 | Counting Signals | 复用 `ch2-16-*` |
| 19 | `ch2-19-half-adder` | 半加器 | Half Adder | 复用 `ch2-20-*` |
| 20 | `ch2-20-delayed-lines` | 晚点到站 | Delayed Lines | 复用 `ch2-29-*` |
| 21 | `ch2-21-double-the-number` | 超级加倍 | Double the Number | 复用 `ch2-17-*` |
| 22 | `ch2-22-full-adder` | 全加器 | Full Adder | 复用 `ch2-21-*` |
| 23 | `ch2-23-odd-cycles` | 奇变偶不变 | Odd Cycles | 复用 `ch2-30-odd-ticks`（改名） |
| 24 | `ch2-24-bit-switch` | 二进制开关 | Bit Switch | 复用 `ch2-32-*` |
| 25 | `ch2-25-byte-nand` | 单字节与非 | Byte NAND | **新建**（奖励 `['and8','or8','nand8','nor8']`，整族接管退役的《8 位或》） |
| 26 | `ch2-26-byte-not` | 单字节非门 | Byte NOT | 复用 `ch2-19-*` |
| 27 | `ch2-27-adding-bytes` | 单字节加法 | Adding Bytes | 复用 `ch2-22-*` |
| 28 | `ch2-28-bit-inverter` | 可控反相器 | Bit Inverter | 复用 `ch2-31-*` |
| 29 | `ch2-29-negative-numbers` | 负数 | Negative Numbers | 复用 `ch2-23-*` |
| 30 | `ch2-30-multiplexer` | 数据选择器 | Multiplexer | 复用 `ch2-33-input-selector`（**英文名改**） |
| 31 | `ch2-31-signed-negator` | 数值反转 | Signed Negator | 复用 `ch2-24-*` |
| 32 | `ch2-32-the-bus` | 总线 | The Bus | 复用 `ch2-34-*` |
| 33 | `ch2-33-saving-gracefully` | 优雅存储 | Saving Gracefully | 复用 `ch2-35-*` |
| 34 | `ch2-34-saving-bytes` | 整存整取 | Saving Bytes | 复用 `ch2-36-*` |
| 35 | `ch2-35-1-bit-decoder` | 二进制译码 | 1 Bit Decoder | 复用 `ch2-25-*` |
| 36 | `ch2-36-2-bit-decoder` | 2-4 译码器 | 2 Bit Decoder | **新建**（奖励 `['decoder2']`——该组件目前**没有任何关卡发放**，是既有的解锁洞） |
| 37 | `ch2-37-3-bit-decoder` | 3-8 译码器 | 3 Bit Decoder | 复用 `ch2-26-*` |
| 38 | `ch2-38-little-box` | 方寸之间 | Little Box | 复用 `ch2-37-*` |
| 39 | `ch2-39-counter` | 计数器 | Counter | 复用 `ch2-38-*` |

**退役（2.x 无此关）**：`ch2-18-byte-or`（8 位或；其 `or8` 奖励移交 26《单字节非门》或 25《单字节与非》之一）、`ch2-27-logic-engine`（逻辑引擎；2.x 已移除）、`ch2-15-binary-racer`（与《信号计数》重复的 popcount 关，其注释已承认；2.x 只有一关 Binary Racer）。

**第 3 章 处理器架构（OVERTURE）— 10 关**（全局 40–49）

| 全局# | id | 中文名 | 英文名 | 来源 |
|---|---|---|---|---|
| 40 | `ch3-40-alu-1` | 逻辑整合 | Arithmetic Logic Unit (ALU) 1 | 复用 `ch3-39-arithmetic-engine` |
| 41 | `ch3-41-registers` | 川流不息 | Registers | 复用 `ch3-40-*` |
| 42 | `ch3-42-alu-2` | 算术逻辑单元 | Arithmetic Logic Unit (ALU) 2 | **新建**（在 ALU 1 之上加 ADD/SUB；奖励 `['ashr8','rot_l8','rot_r8']`——它们原本由被退役的《逻辑引擎》发放） |
| 43 | `ch3-43-the-foundry` | 元件工坊 | The Foundry | 复用 `ch3-41-component-factory`（改名） |
| 44 | `ch3-44-instruction-decoder` | 指令译码器 | Instruction Decoder | 复用 `ch3-42-*` |
| 45 | `ch3-45-conditions` | 条件判断 | Conditions | 复用 `ch3-44-*` |
| 46 | `ch3-46-alu` | 计算核心 | ALU | 复用 `ch3-43-calculations`（改名） |
| 47 | `ch3-47-immediate-values` | 立即数 | Immediate Values | 复用 `ch3-46-*`（**与 48 交换先后**） |
| 48 | `ch3-48-program` | 程序 | Program | 复用 `ch3-45-*`（**与 47 交换先后**） |
| 49 | `ch3-49-turing-complete` | 图灵完备 | Turing Complete | 复用 `ch3-47-*` |

**账目**：47 存量 − 3 退役 + 5 新建 = **49** ✓（13 + 26 + 10）。

---

## Task 1: 落地 2.x 形状（原子改动，一次提交）

**Files:**
- Create: `src/levels/campaign.ts`（49 行目标表：`id` / `chapter` / `index` / `zh` / `en`）
- Create: `test/levels/campaign-shape.test.ts`
- Modify: `src/levels/content/ch1/{part1,part2}.ts`、`ch2/batch{1,2,3,4}.ts`、`ch3/batch{1,2,3}.ts`、`ch3/index.ts`
- Modify: `src/ui/narrative.ts`、`src/levels/checks.ts`、`src/ui/truthTable.ts`（注释里的 id）
- Modify: **所有** 引用关卡 id 的测试与 fixtures（`test/**`：305 处）
- Modify: `docs/superpowers/specs/2026-09-25-turing-complete-replica-design.md` §3.3 解锁表

**Interfaces:**
- Produces: `CAMPAIGN: readonly { id: string; chapter: number; index: number; zh: string; en: string }[]`（49 项，顺序即解锁顺序）

- [ ] **Step 1: 写形状测试（先红）**——`test/levels/campaign-shape.test.ts`：断言 `LEVEL_ORDER` 逐项等于 `CAMPAIGN.map(c => c.id)`；每关的 `chapter`/`index`/`name.zh`/`name.en` 与表一致；`LEVELS.length === 49`；章长 13/26/10；每章 `index` 连续且全局连续。
- [ ] **Step 2: 跑它看红**——`pnpm test test/levels/campaign-shape.test.ts`，预期 49 项不匹配。
- [ ] **Step 3: 写 `src/levels/campaign.ts`**——按上表逐行录入，文件头注明来源（新资料 §5，2.x，2026-10-03）。
- [ ] **Step 4: 退役 3 关**——删除 `ch2-18-byte-or`、`ch2-27-logic-engine`、`ch2-15-binary-racer` 的 spec 及其专属测试与参考解；`ch2-18` 原本发放的 `['and8','or8','nand8','nor8']` 整族移交给新的 `ch2-25-byte-nand`（`ch2-19-byte-not` 的 `['xor8','xnor8','not8']` 不动，`mem1` 与 `less_u` 的归属见 Step 5/6）。
- [ ] **Step 5: 新建 5 关**——每关都要 `id`/`chapter`/`index`/`name`/`brief`/`hint`/`allowedComponents`/`io`/`checks`/`threeStar`，并在文件头按现有格式写 `SOURCED:` / `AUTHORED:` 出处注释：
  - `ch1-12-xnor-gate`：2 位同或真值表；调色板含 `nand` `not` `and` `or` `nor` `xor`（不含 `xnor`，玩家自己搭）；奖励 `['xnor']`（从原 ch1-10 移来）。
  - `ch1-13-logic-exam`：综合测验（三个输入、若干行的真值表或约束），只用第 1 章已解锁组件；奖励 `['mem1']`（从原 ch1-12 移来）。
  - `ch2-25-byte-nand`：`a:8 b:8 → out:8`，位运算；奖励 `['and8','or8','nand8','nor8']`（接管退役的《8 位或》）。
  - `ch2-36-2-bit-decoder`：`a:2 → out:4`（一个 4 位输出）或四个 1 位输出，二选一后**在注释里写明理由**；奖励 `['decoder2']`。
  - `ch3-42-alu-2`：在 ALU 1 的四运算之上加 `add8`/`sub8`；奖励 `['ashr8','rot_l8','rot_r8']`（三件注册组件，原本由退役的《逻辑引擎》发放）。**注意**：`alu2` 不是组件——那只是关卡名；计划初稿曾误以为它是"无人发放的组件"，`registry.test.ts` 会拦住这类不存在的 id。
  每关都要在 `test/fixtures/ch{2,3}-references.ts` 或对应批测试的 `solutions` 表里加**参考解**，并据此实测 `threeStar`（跑一次 grader，把测得的 gate/delay/tick 填回去）。
- [ ] **Step 6: 改名与重排**——按目标表逐关改 `id`、`chapter`、`index`、`name.zh`、`name.en`；`ch1-05`/`ch1-06` 对调后，**NOR 的参考解改用德摩根式（`not`+`and`）**并重测 `threeStar`。
- [ ] **Step 7: 追平所有 id 引用**——`test/**` 305 处、`src/**` 16 处、`narrative.ts` 12 条、`fixtures/*` 键、注释里的 id；`ch3/index.ts` 的 `PROGRAM_*` 注释同步。
- [ ] **Step 8: 更新设计规格 §3.3 解锁表**——章节行与组件归属按新关卡数据改写（`unlock-chain.test.ts` 会拿它和关卡数据对账）。
- [ ] **Step 9: 跑门禁**——`pnpm build`、`pnpm test`、`pnpm smoke`；三者全绿，且测试数 ≥ 1218（新增关卡只会更多）。
- [ ] **Step 10: 提交**——`refactor(levels): realign chapters 1-3 with the 2.x campaign (49 levels)`。

## Task 2: 老存档迁移

**Files:**
- Modify: `src/persist/storage.ts`（`migrate`）、`test/persist/storage.test.ts`
- Create: `src/levels/id-map.ts`（旧 id → 新 id 的 44 项映射，退役的 3 关映射为 `null`）

- [ ] **Step 1: 写失败测试**——喂一份 v1 存档（含 `ch2-13-odd-number-of-signals` 等旧 id 与星数），断言迁移后落在新 id 上；退役关卡的记录被丢弃；未知 id 不炸。
- [ ] **Step 2: 跑它看红**。
- [ ] **Step 3: 实现**——`STORAGE_KEY` 升到 `tc.progress.v2`，或保留 key 并把 `version` 升到 2；`migrate` 先按 `id-map` 重键，再走原有校验。规则：**能映射的保留星数，退役关卡丢弃，其余未知键丢弃**。
- [ ] **Step 4: 跑 `pnpm test test/persist test/app`**，全绿。
- [ ] **Step 5: 提交**——`feat(persist): carry saved progress across the 2.x id realignment`。

## Task 3: 文档与溯源同步

**Files:**
- Modify: `README.md`（章长 12/26/9 → 13/26/10、47 → 49、关卡范围、`Phases 0–2` 段、路线图）
- Modify: `RESEARCH.md`（§3「当前实现基线是 1.x」改为「已切到 2.x」；§5 谁说了算；§2/§3 的差异表更新为"已对齐"）
- Modify: `AGENTS.md`（基线一段：已实现内容现按 2.x）
- Modify: `docs/research/chapter-2-level-provenance.md`（逐关溯源按新 id 与新增关卡重写）
- Create: `docs/superpowers/plans/2026-10-04-turing-complete-2x-realign.md`（本文件，随提交入库）

- [ ] **Step 1: 改四处文档**，逐处核对数字与 id 真实存在（不得留下指向旧 id 的引用）。
- [ ] **Step 2: `pnpm test` 全绿**（`test/conventions.test.ts` 会检查 README 的布局块与依赖策略）。
- [ ] **Step 3: 提交**——`docs: move the project's stated baseline to 2.x`。

## Task 4: 收尾验证与复查

- [ ] **Step 1: 全量门禁**——`pnpm build` + `pnpm test` + `pnpm smoke`，记录数字。
- [ ] **Step 2: 派一个没有上下文的复查代理**读 diff 与 `RESEARCH.md`，回答：49 关是否与目标表逐项一致？有没有关卡引用了未解锁组件？有没有文档仍说 1.x/47 关？
- [ ] **Step 3: 按其发现修补并重跑门禁**。
- [ ] **Step 4: 推送**——`git push origin master`，确认 `HEAD == origin/master`。

---

## 自查

- **规格覆盖**：新资料 §5 的第 1–3 章 49 关 → Task 1 的完整表；§11 的技术要点不在本次范围（属后续章节）；存档、解锁链、剧情、文档 → Task 2/3。
- **类型一致**：`CAMPAIGN` 的字段名与 `LevelSpec` 的 `chapter`/`index`/`name.{zh,en}` 一一对应；id 一律 `ch<章>-<全局两位序号>-<slug>`。
- **风险排序**：存档迁移（丢进度）> 解锁链（卡关）> 参考解可建性（NOR 换序）> 剧情文案（静默丢旁白）> 注释里的死 id。
