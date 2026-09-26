# Compendium structure extract — game chapter spine + chapter-2 level detail

**Sole source**: `图灵完备_Turing_Complete_游戏资料全集.md` (1032 lines; self-dated 2026-07-13).
**Citation form**: `§x.y Lnn` = compendium section + line number in that file. All `"..."` strings are verbatim from the compendium.
**Extraction rule applied**: where the compendium is silent, this report writes `not stated in compendium`. Nothing below is imported from other sources or from prior knowledge of the game.

---

## 0. How the compendium numbers chapters (read this before the table)

- The compendium has **no first-class "chapter" heading**. The chapter spine is the seven `### 5.x` subsections of `§5 完整关卡列表与详解` (L138–L279), each titled `<Chinese>（<English>）— N 关`.
- `§16.5 完整关卡数量统计` (L975–L986) restates the same seven units under the column `章节` with a `合计 82` row. The two agree exactly.
- The compendium gives **no official in-game chapter number, chapter ID, or chapter screen name** anywhere (grep for `第…章` / `Chapter` returns no chapter identifiers). The indices 1–7 in the table below are **my ordering of §5.1–§5.7 only**.
- Level numbering 1–82 is likewise the compendium's own continuous numbering; it never states that the game displays these numbers (see U29).
- Chapter count arithmetic reconciles: 12+26+9+6+11+10+8 = 82 = `§16.5` 合计 (L986). `§5` intro says `"游戏包含 70+ 个关卡"` (L140), repeated at L893 — consistent with 82 but never reconciled (U28).

## 1. Full chapter table

| # (my order of §5.x) | Chinese title (compendium heading, verbatim) | English title as given | Levels stated | Level # range | Level count (my count) | §16.5 row | Lead line (verbatim) |
|---|---|---|---|---|---|---|---|
| 1 | 基础逻辑电路（Basic Logic）— 12 关 | Basic Logic | 12 | 1–12 | 12 ✓ | `基础逻辑 \| 12 \| 逻辑门推导` | `"本章从最原始的数字逻辑层面开始，玩家仅有一个 NAND 门，需要推导出所有其他基本逻辑门。"` (L144) |
| 2 | 算术运算与存储器（Arithmetic & Memory）— 26 关 | Arithmetic & Memory | 26 | 13–38 | 26 ✓ | `算术与存储器 \| 26 \| 运算电路 + 存储元件` | `"本章从简单逻辑门过渡到复杂组件，构建算术运算单元和存储器。"` (L163) |
| 3 | 处理器架构（CPU Architecture — OVERTURE）— 9 关 | CPU Architecture — OVERTURE | 9 | 39–47 | 9 ✓ | `CPU 架构（OVERTURE） \| 9 \| 第一台 CPU` | `"本章是游戏的核心转折点。玩家开始将之前构建的所有组件组装成一台完整的 8 位计算机——OVERTURE 架构。"` (L203) |
| 4 | 编程（Programming）— 6 关 | Programming | 6 | 48–53 | 6 ✓ | `编程 \| 6 \| 汇编编程入门` | (no lead paragraph) |
| 5 | 处理器架构 2（CPU Architecture 2 — LEG）— 11 关 | CPU Architecture 2 — LEG | 11 | 54–64 | 11 ✓ | `CPU 架构 2（LEG） \| 11 \| 第二台 CPU` | `"本章构建第二台 CPU——LEG 架构，引入更强大的指令集（4 字节指令、XOR、内存操作等）。"` (L232) |
| 6 | 函数（Functions）— 10 关 | Functions | 10 | 65–74 | 10 ✓ | `函数 \| 10 \| 高级编程概念` | `"本章引入 RAM、栈、函数调用等高级概念。"` (L250) |
| 7 | 汇编挑战（Assembly Challenges）— 8 关 | Assembly Challenges | 8 | 75–82 | 8 ✓ | `汇编挑战 \| 8 \| 综合编程挑战` | `"最终章节，玩家用 LEG CPU 解决复杂的编程挑战。"` (L267) |

**Level-count ambiguity: none found.** Every chapter states its count both in its heading and in §16.5, and both match the row count in its level table. This is the one place the compendium is internally exact.

**Structural ambiguity that does exist — chapter 2's identity.** §5.2 is one numbered unit in §16.5 (`26`), but internally it is split by two un-numbered sub-headings with no counts:

- `#### 算术运算部分` (L165) — rows 13–27 = **15 levels**
- `#### 存储器部分` (L185) — rows 28–38 = **11 levels**

The compendium never says whether the shipped game presents these as **one chapter or two**. Both readings fit the text. If the planner's target chapter is "the chapter after the logic-gate tutorial", the compendium's own answer is §5.2 as a whole (26 levels, rows 13–38); the arithmetic/memory seam is at row 27 → 28.

---

## 2. Chapter 2 detail — §5.2, levels 13–38 (all 26)

Format per level: **N. English | 中文** — Goal; Behavior spec; Grant; Constraint; Quote.
`Grant` is almost always `not stated in compendium`: the compendium states a component reward for exactly one level in the entire game (`L149`, ch.1 row 2: `"获得初始元件 NAND"`). See §3 for the name-correspondence proxy and U03.

### 2a. 算术运算部分 (L165) — rows 13–27 (15 levels)

**13. ODD Number of Signals | 奇数个信号**
Goal: decide whether the number of high inputs is odd.
Behavior spec: parity/odd-count predicate over the inputs; the compendium hints the intended construction is chained XOR (`连异或`).
Grant: not stated in compendium.
Constraint: none stated.
Quote (L169): `| 13 | ODD Number of Signals | 奇数个信号 | 判断输入中高电平数量是否为奇数（连异或） |`

**14. Double Trouble | 成对的麻烦**
Goal: with 4 inputs, output high when at least 2 are high.
Behavior spec: `"判断 4 个输入中至少 2 个为高电平"` — an at-least-2-of-4 (majority-threshold) predicate. Output polarity beyond "detect" is not stated.
Grant: not stated in compendium.
Constraint: none stated.
Quote (L170): `| 14 | Double Trouble | 成对的麻烦 | 判断 4 个输入中至少 2 个为高电平 |`

**15. Binary Racer | 二进制速算**
Goal: a timed binary-conversion mini-game.
Behavior spec: `"限时二进制转换小游戏"` — no circuit spec given at all.
Grant: not stated in compendium.
Constraint: a time limit exists by description; its value is not stated. Achievement `Binary Racer | 二进制速算家 | 通过"二进制速算"关卡的最高级` (L778) implies the level has multiple difficulty tiers (`最高级`); the tier count is not stated.
Quote (L171): `| 15 | Binary Racer | 二进制速算 | 限时二进制转换小游戏 |`

**16. Counting Signals | 信号计数**
Goal: add 4 signals together.
Behavior spec: `"将 4 个信号相加（类似半加器）"` — sum of four 1-bit inputs, i.e. a 3-bit count result. The compendium's analogue is "similar to a half adder" only; output width/ports are not stated.
Grant: not stated in compendium.
Constraint: none stated.
Quote (L172): `| 16 | Counting Signals | 信号计数 | 将 4 个信号相加（类似半加器） |`

**17. Double the Number | 加倍**
Goal: double the input value.
Behavior spec: `"二进制左移一位"` — binary left shift by one. Input/output width not stated (U09).
Grant: not stated in compendium. Weak name-correspondence to §8.2 `8-Bit Shift Left | 逻辑左移` (L535) — inference only.
Constraint: none stated.
Quote (L173): `| 17 | Double the Number | 加倍 | 二进制左移一位 |`

**18. Byte OR | 8 位或**
Goal: 8-bit-wide OR.
Behavior spec: `"8 位宽的或运算"`.
Grant: not stated in compendium. Name-corresponds to §8.2 `8-Bit OR | 8 位或` (L540) — inference only.
Constraint: none stated.
Quote (L174): `| 18 | Byte OR | 8 位或 | 8 位宽的或运算 |`

**19. Byte NOT | 8 位非**
Goal: 8-bit-wide NOT.
Behavior spec: `"8 位宽的非运算"`.
Grant: not stated in compendium. Name-corresponds to §8.2 `8-Bit NOT | 8 位非` (L542) — inference only.
Constraint: none stated.
Quote (L175): `| 19 | Byte NOT | 8 位非 | 8 位宽的非运算 |`

**20. Half Adder | 半加器**
Goal: build a 1-bit adder.
Behavior spec: `"1 位加法器（和 + 进位）"` — must produce **sum and carry** for two 1-bit inputs. Whether these are two distinct output ports is implied, not spelled out (U10).
Grant: not stated in compendium. Note: §8.1's component catalog lists `Full Adder | 全加器` (L507) but **has no `Half Adder` entry** — so there is no catalog counterpart for this level.
Constraint: none stated.
Quote (L176): `| 20 | Half Adder | 半加器 | 1 位加法器（和 + 进位） |`

**21. Full Adder | 全加器**
Goal: build a 1-bit adder that also accepts a carry input.
Behavior spec: `"带进位输入的 1 位加法器"` — sum + carry-out for a + b + carry-in. Port list not enumerated.
Grant: not stated in compendium. Name-corresponds exactly to §8.1 `Full Adder | 全加器` (L507) — inference only.
Constraint (achievement-derived, not a stated pass requirement): table cell `"（成就：仅用 5 个蓝色元件）"`; §12 row `5 Component Full Adder | 五门全加器 | 仅用 5 个蓝色元件完成"全加器"关卡 | ~19-59%` (L773). `蓝色元件` is defined at §9.4 as custom components built in earlier levels (gate count computed after expansion); `绿色/基础组件` are base elements such as NAND (L632–636). Which specific components count as "blue" at level 21 is not stated (U06).
Quote (L177): `| 21 | Full Adder | 全加器 | 带进位输入的 1 位加法器（成就：仅用 5 个蓝色元件） |`

**22. Adding Bytes | 8 位加法器**
Goal: 8-bit addition by cascading full adders.
Behavior spec: `"级联全加器实现 8 位加法"`. Whether a carry-out beyond the 8-bit sum is required, and whether a carry-in input exists, is not stated (U11).
Grant: not stated in compendium. Name-corresponds to §8.2 `Add | 加法器` (L529) — inference only.
Constraint (achievement-derived): table cell `"（成就：延迟 ≤ 35）"`; §12 row `Fast Adder | 高速加法器 | 延迟 ≤ 35 通过"8 位加法器"关卡 | ~2-11%` (L774). `延迟` is defined at §9.1 as `"从输入到输出的最长路径传播延迟"` (L619). Not stated whether ≤35 is required to pass or optional (U05).
Quote (L178): `| 22 | Adding Bytes | 8 位加法器 | 级联全加器实现 8 位加法（成就：延迟 ≤ 35） |`

**23. Negative Numbers | 负数**
Goal: two's-complement representation practice, delivered as a timed mini-game.
Behavior spec: `"二进制补码表示练习（限时小游戏）"` — no circuit spec given.
Grant: not stated in compendium.
Constraint: timed by description; limit not stated.
Quote (L179): `| 23 | Negative Numbers | 负数 | 二进制补码表示练习（限时小游戏） |`

**24. Signed Negator | 相反数**
Goal: produce the additive inverse of the input.
Behavior spec: `"取反 + 1 实现求相反数"` — invert all bits then add 1 (the compendium's own recipe). Bit width not stated; whether a negate-enable/flag input is required is not stated (U12).
Grant: not stated in compendium. Name-corresponds to §8.2 `Negate | 取相反数器` (L530) — inference only.
Constraint: none stated.
Quote (L180): `| 24 | Signed Negator | 相反数 | 取反 + 1 实现求相反数 |`

**25. 1 Bit Decoder | 1 位解码器**
Goal: a 1-to-2 decoder.
Behavior spec: `"1-to-2 解码器"` — one select bit → one of two lines active.
Grant: not stated in compendium. Name-corresponds to §8.1 `1-Bit Decoder | 1-to-2 解码器` (L508) — inference only.
Constraint: none stated.
Quote (L181): `| 25 | 1 Bit Decoder | 1 位解码器 | 1-to-2 解码器 |`

**26. 3 Bit Decoder | 3 位解码器**
Goal: a 3-to-8 decoder.
Behavior spec: `"3-to-8 解码器"` — 3 select bits → one of eight lines active.
Grant: not stated in compendium. Name-corresponds to §8.1 `3-Bit Decoder | 3-to-8 解码器` (L510) — inference only.
Constraint: none stated.
Quote (L182): `| 26 | 3 Bit Decoder | 3 位解码器 | 3-to-8 解码器 |`

**27. Logic Engine | 逻辑引擎**
Goal: build a complete logic-operation set using OR and NOT gates.
Behavior spec: `"用或门和非门构建完整逻辑运算集"` — the composition of that "complete set" is **not enumerated** anywhere (U13). The level shares its name with the chapter-5 LEG architecture (`LEG（Logic Engine）`, L381; glossary `LEG (Logic Engine) | 逻辑引擎设计`, L812) — same name, different artifact.
Grant: not stated in compendium. §8.2's 8-bit family (`8-Bit AND/OR/NOT/NAND/NOR/XOR/XNOR`, L536–542) is the plausible family, unstated.
Constraint (achievement-derived, wording differs between the two places it appears): table cell `"（成就：仅用 8 位元件）"` (L183); §12 row `Symmetric ALU | 对称计算单元 | 仅用"8 位"系列元件通过"逻辑引擎"关卡 | ~8-32%` (L776). Not stated whether required to pass (U05).
Quote (L183): `| 27 | Logic Engine | 逻辑引擎 | 用或门和非门构建完整逻辑运算集（成就：仅用 8 位元件） |`

### 2b. 存储器部分 (L185) — rows 28–38 (11 levels)

**28. Circular Dependency | 循环依赖**
Goal: introduce feedback loops by building a basic latch.
Behavior spec: `"引入反馈回路概念，构建基本锁存器"` — a level-1 storage element from combinational feedback. Signal/port definitions not stated.
Grant: not stated in compendium. §8.1 `1-Bit Memory | 1 位存储器（锁存器）` (L505) is the plausible counterpart, unstated.
Constraint: none stated.
Quote (L189): `| 28 | Circular Dependency | 循环依赖 | 引入反馈回路概念，构建基本锁存器 |`

**29. Delayed Lines | 延迟线**
Goal: delay a signal by one tick.
Behavior spec: `"信号延迟一拍输出"`. Bit width (1-bit vs 8-bit; §8 has both `Delay Line` L506 and `8-Bit Delay Line` L516) and line count are not stated (U14).
Grant: not stated in compendium. Name-corresponds to §8.1 `Delay Line | 延迟线（延迟一拍）` (L506) — inference only.
Constraint: none stated.
Quote (L190): `| 29 | Delayed Lines | 延迟线 | 信号延迟一拍输出 |`

**30. Odd Ticks | 奇变偶不变**
Goal: build an oscillating circuit that acts as a clock signal generator.
Behavior spec: `"构建振荡电路（时钟信号发生器）"`. Period, duty cycle, and whether the oscillator is free-running or gated are not stated (U15).
Grant: not stated in compendium; §8 lists **no oscillator/clock component**.
Constraint: none stated.
Quote (L191): `| 30 | Odd Ticks | 奇变偶不变 | 构建振荡电路（时钟信号发生器） |`

**31. Bit Inverter | 1 位取反器**
Goal: flip a bit on demand.
Behavior spec: `"使用 XOR 进行位翻转"` — the intended mechanism is XOR. Whether a control input selects invert-vs-pass is not stated; width implied 1-bit by the name (U16).
Grant: not stated in compendium. Uses §8.1 `XOR | 异或门` (L501); no separate `Bit Inverter` component is listed in §8.
Constraint: none stated.
Quote (L192): `| 31 | Bit Inverter | 1 位取反器 | 使用 XOR 进行位翻转 |`

**32. Bit Switch | 1 位开关**
Goal: conditionally pass or block a signal.
Behavior spec: `"条件通断信号（类似与门但可级联省或门）"` — a gated pass; the parenthetical `可级联省或门` is a design hint (cascading avoids an OR gate), not a hard spec. Exact enable semantics and width not stated (U17).
Grant: not stated in compendium. §8.1 `Switch | 1 位开关（条件通断）` (L496) and §8.2 `8-Bit Switch | 8 位开关` (L520) both exist; which one this level yields is not stated.
Constraint: none stated.
Quote (L193): `| 32 | Bit Switch | 1 位开关 | 条件通断信号（类似与门但可级联省或门） |`

**33. Input Selector | 数据选择器**
Goal: a 2-to-1 multiplexer.
Behavior spec: `"2-to-1 多路复用器（MUX）"`. Select-line width is trivially 1 for 2-to-1; the compendium states nothing further, and whether it must be extensible is not stated (U18).
Grant: not stated in compendium. Name-corresponds to §8.2 `8-Bit Mux | 8 位多路复用器` (L519) on the MUX term only — inference.
Constraint: none stated.
Quote (L194): `| 33 | Input Selector | 数据选择器 | 2-to-1 多路复用器（MUX） |`

**34. The bus | 总线**
Goal: convey the concept of a shared data-transport line.
Behavior spec: `"共享数据传输线路的概念"` — a **concept, not a computable spec**. Nothing states what the grader tests, what the bus width is, or whether it is tri-state or mux-based (U19). Glossary: `Bus（总线） | 多组件共享的数据传输线路` (L1005).
Grant: not stated in compendium.
Constraint: none stated.
Quote (L195): `| 34 | The bus | 总线 | 共享数据传输线路的概念 |`

**35. Saving Gracefully | 优雅存储**
Goal: a 1-bit latch/register with conditional write.
Behavior spec: `"1 位锁存器/寄存器（条件写入）"` — "conditional write" implies a write-enable, but signal names and port count are not stated (U20).
Grant: not stated in compendium. §8.1 `1-Bit Memory | 1 位存储器（锁存器）` (L505) is the plausible counterpart, unstated.
Constraint: none stated.
Quote (L196): `| 35 | Saving Gracefully | 优雅存储 | 1 位锁存器/寄存器（条件写入） |`

**36. Saving Bytes | 存储一字节**
Goal: an 8-bit register.
Behavior spec: `"8 位寄存器"`. Whether enable/reset inputs are required is not stated (U21).
Grant: not stated in compendium. Name-corresponds to §8.2 `8-Bit Register | 8 位寄存器` (L518) — inference only.
Constraint: none stated.
Quote (L197): `| 36 | Saving Bytes | 存储一字节 | 8 位寄存器 |`

**37. Little Box | 小盒子**
Goal: `"刚好装满存储空间的电路设计"` — a circuit design that exactly fills the storage space.
Behavior spec: **effectively unspecified.** No target capacity, address width, or definition of "装满" is given (U22). This is the least determined level in chapter 2.
Grant: not stated in compendium.
Constraint: none stated.
Quote (L198): `| 37 | Little Box | 小盒子 | 刚好装满存储空间的电路设计 |`

**38. Counter | 计数器**
Goal: a self-incrementing register.
Behavior spec: `"自增寄存器"` — increment step, reset behaviour, and wrap behaviour are not stated (U23).
Grant: not stated in compendium. Name-corresponds to §8.2 `8-Bit Counter | 8 位计数器` (L517) — inference only.
Constraint (achievement-derived): table cell `"（成就：≤ 65 个门）"`; §12 row `Binary Counter | 二进制计数器 | 用 ≤ 65 个基本逻辑门通过"计数器"关卡 | ~2-8%` (L779). `基本逻辑门` corresponds to §9.4's `绿色/基础组件` (L635). Gate metric is §9.1's `门数量` = `"电路中使用的 NAND 门总数（展开自定义组件后）"` (L618). Not stated whether required to pass (U05).
Quote (L199): `| 38 | Counter | 计数器 | 自增寄存器（成就：≤ 65 个门） |`

---

## 3. New component types introduced by chapter 2

**Direct answer: the compendium does not state which parts any chapter-2 level grants.** Its only reward statement for any level is ch.1 row 2, L149: `"获得初始元件 NAND，了解真值表"`. Generic mechanism only: `§4.4 组件解锁：完成关卡会解锁新元件供后续使用` (L133) and `§16.1.2 组件解锁：随关卡进度逐步解锁` (L923). No level→component mapping table exists in the document (U03).

The nearest thing to evidence is **name correspondence** between chapter-2 level names and §8's catalog. Below, `[exact]` = component name identical to the level's English name; `[partial]` = shares a term. **All of these attributions are my inference; none is asserted by the compendium.**

| Component (name + verbatim §8 description) | §8 line | Corresponding ch.2 level | Match |
|---|---|---|---|
| `Full Adder \| 全加器` | L507 | 21 Full Adder | [exact] |
| `1-Bit Decoder \| 1-to-2 解码器` | L508 | 25 1 Bit Decoder | [exact] |
| `3-Bit Decoder \| 3-to-8 解码器` | L510 | 26 3 Bit Decoder | [exact] |
| `Delay Line \| 延迟线（延迟一拍）` | L506 | 29 Delayed Lines | [exact, singular/plural] |
| `Switch \| 1 位开关（条件通断）` | L496 | 32 Bit Switch | [partial; concept text identical: 条件通断] |
| `8-Bit Switch \| 8 位开关` | L520 | 32 Bit Switch | [partial, alternate candidate] |
| `8-Bit OR \| 8 位或` | L540 | 18 Byte OR | [partial] |
| `8-Bit NOT \| 8 位非` | L542 | 19 Byte NOT | [partial] |
| `Add \| 加法器` | L529 | 22 Adding Bytes | [partial] |
| `Negate \| 取相反数器` | L530 | 24 Signed Negator | [partial] |
| `8-Bit Mux \| 8 位多路复用器` | L519 | 33 Input Selector | [partial, MUX term only] |
| `1-Bit Memory \| 1 位存储器（锁存器）` | L505 | 28 Circular Dependency **or** 35 Saving Gracefully | [partial; two candidates, compendium does not disambiguate] |
| `8-Bit Register \| 8 位寄存器` | L518 | 36 Saving Bytes | [partial] |
| `8-Bit Counter \| 8 位计数器` | L517 | 38 Counter | [partial] |
| `8-Bit Shift Left \| 逻辑左移` | L535 | 17 Double the Number | [weak/speculative] |

**Chapter-2 levels with no component candidate in §8 at all**: 13, 14, 15, 16, 20, 23, 27, 30, 31, 34, 37. In particular §8.1 contains `Full Adder` but **no `Half Adder`**, and §8 contains **no oscillator/clock** and **no `Bit Inverter`** entry.

**Components §8 lists that no chapter-2 level plausibly accounts for** (so their unlock point is unstated): `2-Bit Decoder` (L509), `Byte Splitter` (L521), `8-Bit Maker` (L522), `8-Bit Constant` (L523), `Less (signed)` / `Less (unsigned)` / `Equal` (L524–526), `Multiply` (L527), `Divide` (L528), all shift/rotate variants (L531–535), `8-Bit XNOR/XOR/NOR/NAND/AND` (L536–541), plus `Constant On` / `Constant Off` (L493–494) vs ch.1's `Always On` level name.

---

## 4. Explicit uncertainties — what the compendium does NOT let me determine

Count: **30**.

- **U01** No official in-game chapter numbers, IDs, or chapter-screen names exist anywhere in the compendium. My chapter indices 1–7 are an ordering of §5.1–§5.7 and must not be presented as the game's own numbering.
- **U02** §5.2 is one unit in §16.5 (26 levels) but is internally split into `算术运算部分` (rows 13–27) and `存储器部分` (rows 28–38) with no counts and no statement of whether the shipped game treats these as one chapter or two.
- **U03** **No per-level component rewards.** The compendium states a component grant for exactly one level in the whole game (ch.1 L149). For all 26 chapter-2 levels, what the player gains is not stated. §3's table is name-correspondence inference only.
- **U04** **No truth tables anywhere in the document.** No per-level input/output port counts, no test vectors, no bit widths except where a level's own name says "8 位"/"1 位".
- **U05** No level states a **hard** gate/delay/tick limit. The only three numeric figures (5 blue components, delay ≤ 35, ≤ 65 gates) appear as **achievement** conditions, and the compendium never says whether achieving them is required to pass the level or is optional (§4.3 lists 门数量/延迟/时钟周期 as 评分指标, i.e. scoring).
- **U06** §9.4 defines `蓝色组件` as custom components from earlier levels and `绿色/基础组件` as base elements like NAND, but never says which components are blue *at the time of level 21* (or 27/38).
- **U07** Levels 15 and 23 are called `限时小游戏` with zero circuit spec: unknown whether they are circuit-building levels at all, what the time limit is, and (for 15) how many difficulty tiers `最高级` implies.
- **U08** Input width for level 13 is unstated (row 14 says 4 inputs, row 16 says 4 signals; row 13 says only `判断输入中高电平数量是否为奇数`).
- **U09** Level 17 `Double the Number`: bit width of input/output not stated.
- **U10** Level 20 `Half Adder`: whether sum and carry must be two distinct output ports is implied by `（和 + 进位）` but never spelled out; port names unstated.
- **U11** Level 22 `Adding Bytes`: whether a carry-out (and a carry-in) beyond the 8-bit sum is required is not stated; operand count unstated.
- **U12** Level 24 `Signed Negator`: bit width not stated; whether a negate-enable input is required is not stated.
- **U13** Level 27 `Logic Engine`: the members of the `完整逻辑运算集` are never enumerated. Only the achievement name `Symmetric ALU` and the phrases `用或门和非门构建` / `仅用"8 位"系列元件` constrain it.
- **U14** Level 29 `Delayed Lines`: bit width and number of parallel lines not stated (§8 lists both a 1-bit and an 8-bit delay line).
- **U15** Level 30 `Odd Ticks`: oscillation period, duty cycle, and whether the oscillator is free-running or gated are not stated.
- **U16** Level 31 `Bit Inverter`: whether a control input selects invert-vs-pass is not stated; width only implied by the name.
- **U17** Level 32 `Bit Switch`: exact enable semantics and width not stated; two candidate components (1-bit `Switch`, `8-Bit Switch`) both exist in §8.
- **U18** Level 33 `Input Selector`: nothing stated beyond `2-to-1`; whether wider selection is required is unstated.
- **U19** Level 34 `The bus`: no computable specification at all — only `"共享数据传输线路的概念"`. Unknown bus width, unknown grading criterion, unknown implementation style (tri-state vs mux).
- **U20** Level 35 `Saving Gracefully`: `条件写入` implies an enable signal, but signal names and port count are unstated.
- **U21** Level 36 `Saving Bytes`: whether enable/reset inputs are required is unstated.
- **U22** Level 37 `Little Box`: the entire requirement is `"刚好装满存储空间的电路设计"`. Target capacity, address width, and the meaning of "装满" are all unstated — this level is essentially undetermined by the compendium.
- **U23** Level 38 `Counter`: increment step, reset behaviour, and wrap behaviour are not stated.
- **U24** Chapter 2's English title `Arithmetic & Memory` is only the compendium's parenthetical in its own heading; the compendium never says this is the in-game English chapter name.
- **U25** Provenance of the Chinese level titles is unstated. The game supports 简体中文 (L44), so they may be official localisation, but the compendium does not say whether they are official or the author's translations.
- **U26** §8.1 lists a `2-Bit Decoder` (L509) that **no level in the 82-level list introduces** — its unlock point is unstated.
- **U27** No chapter/level is attributed to any 8-bit component in §8 (AND/XOR/XNOR/NAND/NOR, Multiply, Divide, Less/Equal, shifts/rotates, Byte Splitter, 8-Bit Maker, 8-Bit Constant). Chapter 2's level names cover only OR and NOT of that family.
- **U28** `§5` and `§15.3` say `70+ 关卡` (L140, L893) while `§16.5` totals 82 (L986). Consistent but never reconciled; also unknown whether the count includes the 4 ship side-quests (L103) and the sandbox.
- **U29** The compendium's continuous level numbering 1–82 is its own construction; the compendium never states that the game displays these numbers, nor whether ship/side-quest content is interleaved between them.
- **U30** Whether chapter 2 contains hidden, bonus, or optional levels is not stated (the document mentions hidden content only for hats/ship quests, L103, L783–784).

### Additional gap, flagged because it affects any reimplementation
`§4.3` states each level provides `输入条件` (defined input signals), `输出目标` (expected output as truth table or description), `可用工具` (components unlocked so far) and `评分指标` (L124–128) — but **the compendium supplies none of these four fields for any chapter-2 level except the one-line `核心概念` paraphrased in §2 above.** A planner should treat every chapter-2 level spec as needing external verification before implementation.
