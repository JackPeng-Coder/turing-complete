# Chapter 2 level provenance — what is the source's, and what is this replica's

This document records, per level, which parts of it came from the user-supplied research
compendium and which parts are this replica's own design. It exists because the answer is
uncomfortable and should be auditable rather than buried: **the compendium fixes the level names,
their order, and a one-line teaching concept — and supplies no truth tables, no port lists, no bit
widths, no pass conditions, and no per-level component rewards.**

The compendium is in this repository at the root
(`GAME_REFERENCE.md`, renamed from `图灵完备_Turing_Complete_游戏资料全集.md` on 2026-09-29), as is the structure extract derived from it
(`.superpowers/research/compendium-structure.md`). Both reproduce passages of the original game's
text; the repository owner chose to publish them. What follows is the derived factual content,
with a section citation for each source claim so the reading can be checked against the compendium
directly.

## What the source supplies

Chapter 2 is `算术运算与存储器（Arithmetic & Memory）— 26 关` — levels 13 through 38 of the
compendium's own continuous 1–82 numbering (compendium §5.2, and the count reconciles with §16.5's
`合计 82` row). Its lead line is `本章从简单逻辑门过渡到复杂组件，构建算术运算单元和存储器。`
Internally it is split by two unnumbered sub-headings — `算术运算部分` (levels 13–27) and
`存储器部分` (levels 28–38) — and the compendium never states whether the shipped game presents
these as one chapter or two.

Per level, the source supplies a name (English and Chinese) and a one-line concept. Nothing else.
The only reward the compendium states for **any** level in the whole game is chapter 1's level 2
(`获得初始元件 NAND`).

## The 26 levels

| # | Name (source) | The source's one-line concept | This replica's design |
|---|---|---|---|
| 13 | ODD Number of Signals 奇数个信号 | 判断输入中高电平数量是否为奇数（连异或） | 4-bit input (width is our choice), 1-bit output, 16-row truth table, rewards `splitter`/`maker`/`const8` |
| 14 | Double Trouble 成对的麻烦 | 判断 4 个输入中至少 2 个为高电平 | Four separate 1-bit inputs, `at-least` constraint check |
| 15 | Binary Racer 二进制速算 | 限时二进制转换小游戏 | **Kind changed.** Was a timed mini-game with no circuit spec; rebuilt as 4-bit → 3-bit popcount. Rewards `less_u` |
| 16 | Counting Signals 信号计数 | 将 4 个信号相加（类似半加器） | Four 1-bit inputs → 3-bit count. Deliberately shares level 15's function; the difference is the interface. Rewards `equal8` |
| 17 | Double the Number 加倍 | 二进制左移一位 | 8-bit in/out; built by rewiring, no shift part. Rewards `add8`/`mul8` |
| 18 | Byte OR 8 位或 | 8 位宽的或运算 | `fuzz` 256 rounds, seed fixed. Rewards `and8`/`or8`/`nand8`/`nor8` |
| 19 | Byte NOT 8 位非 | 8 位宽的非运算 | `fuzz` 256 rounds. Rewards `xor8`/`xnor8`/`not8` |
| 20 | Half Adder 半加器 | 1 位加法器（和 + 进位） | `a`,`b` → `sum`,`carry`; 4-row table. Rewards `full_adder` (the source's catalog has no *Half* Adder entry, so no such part exists here) |
| 21 | Full Adder 全加器 | 带进位输入的 1 位加法器（成就：仅用 5 个蓝色元件） | 8-row table. **Achievement mapped**: this replica has no "blue component" system (that is custom/blueprint parts, a later phase), so the 5-component achievement becomes a measured gate threshold of 15. Rewards `neg8` |
| 22 | Adding Bytes 8 位加法器 | 级联全加器实现 8 位加法（成就：延迟 ≤ 35） | `fuzz` 256 rounds. **Achievement treated as a target, not a pass condition**: the source's 35 is recorded as the source's reference value, and `threeStar` is the measured metrics of the reference — an eight-`full_adder` cascade at 72/8/0. Rewards `switch`/`switch8` |
| 23 | Negative Numbers 负数 | 二进制补码表示练习（限时小游戏） | **Kind changed.** Was a timed mini-game with no circuit spec; rebuilt as a two's-complement magnitude circuit. Rewards `div8` |
| 24 | Signed Negator 相反数 | 取反 + 1 实现求相反数 | `fuzz` 256 rounds. Rewards `less_s`/`shift_l8`/`shift_r8`; withholds `neg8`, which has exactly this level's I/O shape |
| 25 | 1 Bit Decoder 1 位解码器 | 1-to-2 解码器 | 2-row table. Rewards `decoder1`. Part of a generated per-width family; the catalog's `2-Bit Decoder` is the same generator at width 2 (`decoder2`), introduced by no level's name |
| 26 | 3 Bit Decoder 3 位解码器 | 3-to-8 解码器 | 8-row table. Rewards `decoder3` |
| 27 | Logic Engine 逻辑引擎 | 用或门和非门构建完整逻辑运算集（成就：仅用 8 位系列元件） | **The opcode table is entirely ours**: the source never enumerates the "complete logic operation set", so this replica defines an 8-bit `op` selecting `and/or/xor/not a/add/sub/shift_l/ashr`. The `Symmetric ALU` achievement is recorded as sourced-but-ungraded. Rewards `ashr8`/`rot_l8`/`rot_r8` (no opcode selects a rotate — recorded, not hidden) |
| 28 | Circular Dependency 循环依赖 | 引入反馈回路概念，构建基本锁存器 | Per-tick script. Withholds `mem1`, which would answer the level in one drop; the lesson is building the loop |
| 29 | Delayed Lines 延迟线 | 信号延迟一拍输出 | 8-bit delay, per-tick script. Rewards `reg8`/`delay8` |
| 30 | Odd Ticks 奇变偶不变 | 构建振荡电路（时钟信号发生器） | Period, duty cycle and gating are all unstated by the source; this replica asserts a 16-tick alternating period and that `enable = 0` holds |
| 31 | Bit Inverter 1 位取反器 | 使用 XOR 进行位翻转 | 4-row table; `a`,`inv` → `out` |
| 32 | Bit Switch 1 位开关 | 条件通断信号（类似与门但可级联省或门） | 4-row table. **The part is unlocked ten levels earlier in this replica** (level 22's adder lists `switch`/`switch8`), so this level re-teaches rather than introduces it — recorded in the level data |
| 33 | Input Selector 数据选择器 | 2-to-1 多路复用器（MUX） | `fuzz` 256 rounds. Rewards `mux8` |
| 34 | The bus 总线 | 共享数据传输线路的概念 | **Reframed.** A concept, not a computable spec, and spec §3.1 forbids multi-driver arbitration in this engine, so a literal tri-state bus is unimplementable by design. This level teaches driver selection instead: `out` equals the selected line |
| 35 | Saving Gracefully 优雅存储 | 1 位锁存器/寄存器（条件写入） | Per-tick script; write-enable semantics are ours |
| 36 | Saving Bytes 存储一字节 | 8 位寄存器 | Per-tick script. Rewards `counter8` |
| 37 | Little Box 小盒子 | 刚好装满存储空间的电路设计 | **Undetermined by the source** — no capacity, no address width, no definition of 装满. This replica defines it as all 256 bytes of a `ram8` being writable and reading back, and the check covers the full address range |
| 38 | Counter 计数器 | 自增寄存器（成就：≤ 65 个门） | Increment step, reset and wrap are unstated; this replica asserts wrap at 256 and reset-over-enable. **Achievement mapped** to the measured gate count of 41, recorded alongside the source's 65 |

## Where this replica knowingly diverges from the source

1. **Three levels changed kind.** 15 and 23 were timed mini-games with no circuit specification at
   all; 34 is a concept rather than a spec and is reframed because the engine forbids the mechanism
   a literal bus needs. Each conversion is recorded in the level's own data.
2. **No per-level component rewards exist in the source.** Every `rewards.components` value in
   chapter 2 is this replica's design, chosen so the parts arrive where a level first needs them.
   Two parts are deliberately withheld from a level that would otherwise offer them (`add8` at 22,
   `neg8` at 24, `mem1` at 28), because a one-drop answer would replace the circuit the level
   teaches.
3. **`switch`/`switch8` arrive at level 22, not the source's level 32**, because level 22's adder
   palettes them. Consequence recorded at level 32.
4. **The achievement numbers are not pass conditions.** §5.4 of the design spec classes them as
   scoring. Each is recorded in the level data as the source's figure, and the graded target is the
   measured metric of that level's reference solution.
5. **`decoder2` is unlocked by no level.** The source's catalog lists a `2-Bit Decoder` that no
   level name introduces, so it is registered and usable but never handed out.

## How the discipline is enforced, not just asserted

Every chapter-2 level carries a `SOURCED`/`AUTHORED` comment pair, and a test in each batch file
fails if either marker is missing. `test/levels/unlock-chain.test.ts` parses the component table out
of the design spec and checks it against the level data in both directions, so a component the spec
forgets or the data never unlocks is a test failure rather than a discovery.
`test/levels/level-buildability.test.ts` walks every shipped level, uses the application's own
palette function, and fails if a level's reference solution uses a part the player cannot have.

## What to check if you doubt any of this

Read the compendium's §5.2 (levels 13–38) and §8 (the component catalog) directly, then compare
against `src/levels/content/ch2/batch*.ts`. Each level's data comment cites the specific source
claim it rests on.
