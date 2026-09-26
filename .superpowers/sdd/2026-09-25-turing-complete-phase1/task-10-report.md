# Task 10 report — chapter-2 levels 23–27 (batch 3)

**Status:** DONE_WITH_CONCERNS — one design question could not be put to you (the question tool refused
with *"human interaction is unavailable while the calling agent is owned by another live agent"*), so it
is decided, documented in the level data and flagged in §6 rather than blocking.

**Commit:** `59bc652` — `feat(levels): add chapter-2 levels 23-27, two's complement, decoders and the logic engine`

**Files changed (only these two):**

| File | Lines | State |
|---|---|---|
| `src/levels/content/ch2/batch3.ts` | 597 | new |
| `test/levels/ch2-batch3.test.ts` | 1326 | new |

`.superpowers/sdd/2026-09-25-turing-complete-phase1/progress.md` is left modified and **not** committed,
as instructed. Nothing in `src/core/`, `src/ui/`, `src/app/`, `src/levels/checks.ts`, `batch1.ts`,
`batch2.ts`, `ch2/index.ts` or `content/index.ts` was touched, and neither were the two files the
concurrent agent owns (`src/core/defs/index.ts`, `test/core/registry.test.ts` — its commit `523a7b9`
registering `full_adder` is in my baseline).

---

## 1. The five levels

| # | id | io | checker | rewards | `threeStar` (measured) | score |
|---|---|---|---|---|---|---|
| 23 | `ch2-23-negative-numbers` | `a:8` → `out:8` | fuzz, seed `0x2308`, 256 rounds | `div8` | gate 104, delay 2, tick 0 | 112 |
| 24 | `ch2-24-signed-negator` | `a:8` → `out:8` | fuzz, seed `0x2408`, 256 rounds | `less_s shift_l8 shift_r8` | gate 80, delay 2, tick 0 | 88 |
| 25 | `ch2-25-1-bit-decoder` | `sel:1` → `out:2` | truth-table, 2 rows | `decoder1` | gate 1, delay 1, tick 0 | 5 |
| 26 | `ch2-26-3-bit-decoder` | `sel:3` → `out:8` | truth-table, 8 rows | `decoder3` | gate 27, delay 3, tick 0 | 39 |
| 27 | `ch2-27-logic-engine` | `a:8 b:8 op:8` → `out:8` | fuzz, seed `0x2708`, 256 rounds | `ashr8 rot_l8 rot_r8` | gate 668, delay 8, tick 0 | 700 |

Every target is its reference solution's own metrics measured by `grade()`, and the test block
`three-star targets are the reference solutions own metrics` fails if a level's `threeStar` and its
reference's measurement differ in either direction. All five levels are purely combinational, so `tick`
is 0 on every target for the reason batches 1 and 2 state.

### Reference solutions (the circuits the targets are measured from)

* **23** — `add8(xor8(a, m), 0, m7)` where `m` is the sign bit spread over the byte and `m7` is that same
  bit as the carry-in: 32 + 72 = **104** gates, depth **2** (the splitter and maker that spread the sign
  are wiring, 0 on both metrics). The identity is `abs = (a XOR m) + m`: for a non-negative byte the mask
  is 0, and for a negative one `(255 − a) + 1` is `−a`, because subtracting 255 and adding 1 are the same
  eight-bit operation. It needs no mux at all — the byte adder *is* the conditional.
* **24** — `not8` → `add8(·, 0, 1)`: 8 + 72 = **80** gates, depth **2**. This is the level's own teaching
  line (取反 + 1). `nand8(a, a)` ties it exactly (one NAND per bit is one NOT per bit on the documented
  basis).
* **25** — `not(sel)` into maker bit 0, `sel` into bit 1: **1** gate, depth **1** (the maker is wiring).
  The floor for any circuit that has to invert one bit.
* **26** — the two-level tree: two NOTs + four ANDs for the four low minterms, one NOT + eight ANDs to
  split each by the top select bit = 3 + 8 + 16 = **27** gates, depth **3**.
* **27** — the eight results (`and8` 16, `or8` 24, `xor8` 32, `not8(a)` 8, `add8` 72, `not8(b)` 8 +
  `add8` 72, `shift_l8` 125, `ashr8` 140 = **497**), the shift amount being `b & 7` for free (splitter +
  maker are wiring), then a three-level 2:1-mux tree per output bit driven by `op0`, `op1`, `op2` — 56
  muxes × 3 NANDs plus the three inverters of the opcode bits = **171**; total **668** gates, depth **8**
  (the deepest result arrives at 2 and each mux level adds 2 after its op-bit inverter).

### Counterexamples (graded-and-wrong, not malformed — `stars === 0`, non-empty failure records)

| # | counterexample | where it first fails |
|---|---|---|
| 23 | `neg8(a)` alone — always negate, the sign never read as a magnitude | round 0, `{a:56}`: expected `out=56`, actual `200` |
| 24 | `not8(a)` alone — invert without the plus one | round 0, `{a:72}`: expected `out=184`, actual `183` |
| 25 | the two decode bits swapped (anti-decoder) | row `sel=0`: expected `{out:1}`, actual `{out:2}` |
| 26 | the select value passed straight through (a binary value is not one-hot) | row `sel=0`: expected `{out:1}`, actual `{out:0}` |
| 27 | `ashr8` replaced by `shift_r8` in opcode 7's slot — correct on the other seven | round 35, `{a:187, b:194, op:255}` (opcode 7): expected `out=238`, actual `46` |

The three fuzz counterexamples are checked the way batch 2 checks its own: the test captures the kernel's
vector sequence through the level's own expectation functions, recomputes the first disagreeing round from
the counterexample's behaviour as a pure function, and asserts the failure record's `round`, `inputs`,
`expected`, `actual` and `detail` are that round's — plus that exactly one record exists (the checker stops
at the first bad round) and that the captured sequence has exactly `firstBad + 1` entries.

### What the targets separate (all measured, all one star)

| level | correct alternative | measured | reference |
|---|---|---|---|
| 23 | the textbook `(a XOR m) − m`, spelled `add8(xor8, not8(m), 1)` | 112 / 2 | 104 / 2 |
| 23 | the bit-serial magnitude: eight XORs spreading the sign, then a carry-only ripple | 78 / 9 | 104 / 2 |
| 24 | the same NOT spelled `xor8(a, const8)` (`const8` is all ones) | 104 / 2 | 80 / 2 |
| 24 | the bit-serial incrementer: eight NOTs, then a carry-only ripple | 54 / 9 | 80 / 2 |
| 26 | the flat decode: eight 3-input ANDs, one per output | 35 / 2 | 27 / 3 |

Each of these is graded in `the targets separate the constructions they measure`, so every comparative
claim in the level comments is a measurement rather than prose. The two 23/24 rows are the interesting
pair: the bit-serial forms are **smaller in gates and much deeper**, and the star rule denies them three
stars on delay alone — which is exactly what "the reference's own metrics" means.

### Palette gating

* The walk test seeds `STARTER_COMPONENTS`, then walks `CH1_PART1 + CH1_PART2 + CH2_BATCH1 + CH2_BATCH2 +
  CH2_BATCH3`, adding each level's rewards **before** testing its own palette, so a level may offer the
  parts it hands out (25 lists `decoder1`, 26 lists `decoder3`) and nothing from a later level.
  `mux8`, `delay8`, `reg8`, `counter8` and `ram8` are asserted to be unlocked by no level in the batch.
* **Level 24 withholds `neg8`** — batch 2's palette rule used once more: it is not the level's own reward,
  it has precisely this level's I/O shape, and its documented cell *is* the circuit the level teaches (the
  same 80 NAND equivalents, one unit of delay instead of two). Level 23 offers `neg8` because there it does
  not answer the level (a magnitude is not a negation); the test asserts both halves.
* `full_adder` (level 20's reward, registered by the concurrent agent mid-task) is offered nowhere but its
  own level in batches 2 and 3 alike, so no target here is measured from it.

---

## 2. Source fidelity — the SOURCED / AUTHORED split

Each level carries a data comment split into `SOURCED` and `AUTHORED`, and
`test/levels/ch2-batch3.test.ts` fails if either marker is missing (batch 1's assertion, copied), plus
three assertions for the specific notes this batch owes. No number in the file is presented as the
source's own.

* **23 — SOURCED:** the name in both languages, its position (23rd), the concept two's-complement
  representation (二进制补码), **and** the form the source gives it: its level of this name is a 限时小游戏,
  a timed mini-game with **no circuit specification at all** — no ports, no gates, no pass condition.
  **AUTHORED:** the conversion. The level's KIND changes: a mini-game played against a clock becomes a
  two's-complement arithmetic circuit. The comment says so in those words, calls it "a change of the
  level's kind rather than a translation of it", names it as one of the three places in this phase where a
  level's kind changes, and cross-references batch 1's level 15 (the chapter's other timed mini-game,
  converted the same way). Also authored: the `a:8 → out:8` shape, the function (publish the magnitude —
  a reading of the sign, deliberately not the negation level 24 asks for), the fuzz check, the target and
  the `div8` reward. The test asserts the comment contains `限时小游戏`, `补码` and `kind`.
* **24 — SOURCED:** the name, position (24th) and the concept (取反 + 1). **AUTHORED:** the shape, the fuzz
  check, the target, the three rewards, and the palette decision above (recorded with its arithmetic).
* **25 — SOURCED:** the name, position (25th), the concept (1-to-2 decoding), and the catalog fact that
  `decoder1` / `decoder2` / `decoder3` are one width-parametrised definition — no level name introduces the
  catalog's `2-Bit Decoder`. **AUTHORED:** the shape, the two rows, the target, the palette; and the whole
  "what the kernel does with a width" paragraph in §6. The test asserts the comment contains `params.width`,
  `decoder2` and `2-Bit Decoder`.
* **26 — SOURCED:** the name, position (26th), and that it is the same family one width up (`decoder3` is
  `decoder1` at width 3). **AUTHORED:** the shape, the eight rows, the target (and the flat alternative the
  target separates), the palette.
* **27 — SOURCED:** the name, position (27th), and the concept verbatim, 用或门和非门构建完整逻辑运算集.
  **AUTHORED, and this is the load-bearing one:** the source **enumerates no opcodes**, so the eight-value
  table is this replica's design. It is stated in the level comment, listed in the brief for the player,
  implemented as the expectation function, and proven one opcode at a time by the test (§3). Also authored:
  the shape, the fuzz check, the target, the three rewards (noting that `rot_l8` / `rot_r8` are handed out
  without an opcode selecting them), and the palette.

---

## 3. Level 27: how each of the eight opcodes is exercised

Four independent demonstrations, all in `level 27's eight opcodes are all exercised`:

1. **Coverage of the level's own sequence.** The test captures the 256 vectors the level's fixed seed
   actually drives and counts the low three bits of `op`: the counts are
   **31, 30, 31, 33, 34, 31, 35, 31** for opcodes 0…7 (all eight present, none marginal — the assertion is
   `> 3`, not `> 0`). Because the seed is a literal in the level data, this is a fact about the level, not
   about a run.
2. **Correctness of the specification for all eight.** `expects the eight opcodes the logic engine states,
   in the brief` grades the level's own expectation function on hand-picked vectors, one per opcode, plus
   the three places an eight-bit op surprises a reader: the discarded carry (`0xf0 + 0x3c`), the shift
   amount read from `b`'s **low three bits** (`b = 0x0b` is a shift by 3, not 11), the arithmetic shift's
   sign fill (`0x81 ashr 3 = 0xf0`, `0xff ashr 7 = 0xff`), and 32 vectors proving the top five bits of `op`
   change nothing.
3. **Each opcode is genuinely compared, not merely present.** For every `k` in 0…7 the test grades a
   variant of the reference whose opcode `k` mux input is wired to opcode `k+1`'s result — a wiring change
   that makes the circuit wrong on exactly one opcode. Each variant fails with exactly one failure record,
   and the round it fails on is **a round of opcode `k`** (first failing rounds: 0, 6, 1, 8, 4, 9, 3, 14
   for k = 0…7). The test also asserts the record's `expected` is opcode `k`'s value and its `actual` is
   opcode `k+1`'s on that same vector, so the failure is the injected disagreement and not an expectation
   the level got wrong.
4. **The low-three-bits rule is graded too.** The variant that feeds the whole `b` byte to the barrel
   shifter fails at round 3 on `{a:83, b:50, op:118}` — opcode 6, with `b ≥ 8` — which is what makes that
   round a meaningful one rather than a coincidence.

The opcode list is also asserted to be **in the brief, in both languages**, as numbered mnemonics
(`0=and` … `7=ashr`), which is where the player can actually learn it.

---

## 4. What was tested, and the results

`test/levels/ch2-batch3.test.ts` — **67 tests**, all passing:

| block | covers |
|---|---|
| `chapter 2, levels 23-27` (18) | indices/chapter/ids, pin shapes, bilingual names, both palette walks, the five-branch vacuity invariant, decoder row counts and their one-hot contents, fuzz shape (fixed non-zero integer seeds ×3 distinct, 256 rounds, pin maps naming every pin and nothing else), the two's-complement expectation values on both sides of the sign bit, the eight opcode values plus the carry/amount/sign edges, the brief's opcode list and its `params.width` sentence, the rewards per level, and the palette claims the comments make |
| `every level carries its sourced-vs-authored data comment` (8) | the SOURCED/AUTHORED marker per level (batch 1's assertion), plus level 23's kind change, level 25's width note, level 27's authored table |
| `reference solutions pass with three stars` (5) | every reference: no failures, `passed`, `stars === 3` |
| `three-star targets are the reference solutions own metrics` (5) | `spec.threeStar` deep-equals the measured `{gate, delay, tick}` exactly |
| `reference solutions are buildable from the palette they are graded against` (5) | every instance's def is in the level's `allowedComponents` |
| `plausible wrong circuits fail` (7) | the five counterexamples fail graded-and-wrong (0 stars, ≥1 failure record, not a refused graph), plus the two table-level counterexamples' exact first failing rows |
| `an empty circuit fails every level instead of throwing` (5) | an empty graph fails every level |
| `the fuzz levels name the round and the vector that failed` (3) | the round/vector/expected/actual/detail of 23, 24 and 27 |
| `the fuzz levels drive varying, reproducible vectors` (1) | 256 vectors, reproducible across two runs, >100 distinct |
| `level 27's eight opcodes are all exercised` (4) | §3 |
| `the targets separate the constructions they measure` (5) | the six measured alternatives of §1 |
| `the two decoder rewards are one width-parametrised definition` (1) | neither decoder level's reference instantiates `decoder1/2/3`, and those ids stay out of the palettes that cannot use them |

Verification commands (all from the worktree, all exit 0):

| command | result | log |
|---|---|---|
| `pnpm test test/levels/ch2-batch3.test.ts` | 1 file, **67 passed** | `task-10-vitest-green-3.log`, `task-10-vitest-green-verbose.log` |
| `pnpm test` | **21 files, 671 passed** | `task-10-vitest-full.log` |
| `pnpm exec tsc --noEmit` | clean, no output | `task-10-tsc.log` |
| `pnpm build` (`tsc --noEmit && vite build`) | built in ~60 ms | `task-10-build.log` |

### TDD evidence

1. **RED-1** — the test file was written first, against a `batch3.ts` that did not exist:
   `Error: Cannot find module '../../src/levels/content/ch2/batch3'`, *0 tests, 1 failed suite*, exit 1
   → `task-10-vitest-red-1.log`.
2. **RED-2** — after writing the level data: **65 tests | 4 failed**, and every failure was informative
   → `task-10-vitest-red-2.log`:
   * two comment-quote assertions (level 23's `补码`, level 25's `2-Bit Decoder` — the comments quoted the
     concepts in English only);
   * the pass-through decoder's predicted first failing row (I wrote `sel=1`; the table starts at `sel=0`,
     where the expected one-hot 1 is driven as 0);
   * **a real bug the test caught in a circuit I wrote as a measured alternative**: the textbook
     `(a XOR m) − m` form was built with the carry-in tied low, so it computed `a − 1` for non-negative
     bytes (`{a:56}`: expected 56, actual 55). The fix is the `const_on` carry-in; the corrected form
     measures 112 / 2.
3. **GREEN-1** — 65 / 65 → `task-10-vitest-green-1.log`.
4. **RED-3** — adding the two bit-serial alternatives of §1 produced a second, genuine red: my hand-counted
   delay of 8 was wrong for both circuits; the measured delay is **9** (the carry chain is seven ANDs deep
   *after* the flip stage's own gate) → `task-10-vitest-red-3-bit-serial-delay.log`
   (`expected { gate: 54, delay: 9 } to deeply equal { gate: 54, delay: 8 }`, and the same for 78). Both the
   assertions **and the two data comments** were corrected to the measured 9; the comments now state 9.
5. **GREEN final** — 67 / 67, full suite 671 / 671, tsc clean, build clean, all against commit `59bc652`
   (`git diff HEAD` for the two files is empty; only `progress.md` is modified).

---

## 5. Self-review findings (what I changed after re-reading my own diff)

1. **The carry-in bug** in the level-23 alternative (RED-2 above) — caught by the test, not by reading.
2. **Two comment claims that were not measured.** The first draft of level 23's and 24's comments asserted
   a bit-serial incrementer's size and depth without anything measuring it; the circuits were added to the
   test, and the measurement then corrected my numbers (78 / **9** and 54 / **9**, not 8).
3. **The bit-serial helper's delay.** Tracing it by hand gave 8; the kernel says 9. The comments, the
   assertions and the report now all say 9, and the helper's own comment explains the chain.
4. **Level 26's comment** said the first tree stage is "three NOTs and four ANDs" when only two NOTs belong
   to that stage (the third is the top bit's inverter, used by the second stage). Reworded to
   two NOTs + four ANDs, then "one more NOT and eight ANDs" — the total is unchanged at 27.
5. **A stale cross-reference.** The module header originally said the decoder rewards are undeclared "exactly
   like batch 2's `full_adder`"; the concurrent agent registered `full_adder` in `523a7b9` while I was
   working, so the sentence now describes batch 2's *palette* decision about `full_adder` instead, and the
   decoder paragraph stands on its own.
6. **Level 27's alternative-construction remark** was phrased as a finding ("strictly more expensive") when
   I had only computed it. It is now explicitly labelled as arithmetic on the defs' documented counts
   (`switch8` 8 × 16 + `or8` 7 × 24 + a 27-gate one-hot decode = 323 for the select logic), not a
   measurement, and the sentence that nothing is measured from a second-best construction is kept.
7. **Verified no out-of-scope edits**: `git show --stat 59bc652` lists exactly the two new files.

---

## 6. Concerns and open decisions

1. **The decoder's width parameter cannot do what the brief asks, on this kernel — this is the one thing
   worth your decision.** The task requires level 25's brief to tell the player they can widen the part to
   get the 2-bit decoder, and I have done exactly that (`params.width = 2` → "the 2-bit decoder in the
   source catalog: two select bits, four outputs"). But `compile()` resolves a pin as
   `inst.params.width ?? pin.width` and **one width literal covers every pin of the instance**
   (`src/core/net.ts`, `effectiveWidth`; `wide.ts` records the same limitation for `splitter`/`maker` pin
   counts). So a def declaring `sel:1 / out:2` compiled at `params.width = 2` has *both* pins two bits wide
   (`sel:2 / out:2`), not the catalog's `2 → 4`; the pins of a decoder must differ, because the output
   count is `2 ** width`. No `decoder1`/`decoder2`/`decoder3` def is registered in this phase, so nothing
   is broken today, and level 25's data comment records the whole finding — including that the shape this
   kernel *can* express is one definition generated per width (`createWideDefs(width)`'s shape) — and
   flags it as the registering task's decision. **If the intended mechanism was a single `params.width`
   that widens select and output differently, that needs a kernel change (`def.expand(params)` or a
   per-pin width syntax), which is outside this task's files.**
2. **Level 23's function is my choice, not the source's.** The source supplies only "Negative Numbers / 负数"
   and the concept "two's-complement representation", and its level of that name is a mini-game. I read the
   concept as *reading* a signed byte and made the level publish the byte's **magnitude** (the absolute
   value), deliberately distinct from level 24's negation. If the intent was a different two's-complement
   operation (sign-magnitude → two's complement, bias/excess-128, saturation), only the expectation
   function, the reference and the target change — the shape and the fuzz discipline stay.
3. **`rot_l8` / `rot_r8` are level 27's rewards but no opcode selects a rotate.** The brief fixes both the
   opcode list and the rewards, and I did not narrow either silently: the mismatch is recorded in the
   level's comment. If the intent was that opcodes 6/7 include rotates, the table, the brief, the
   expectation and the reference all move together.
4. **Level 24's target is the lesson's metrics ({80, 2}), and that denies three stars to two *smaller*
   correct circuits** (54 / 9 and 78 / 9 on levels 24/23 respectively). That is the star rule as specified
   (all metrics must be met, equality counts), and both alternatives are measured and documented; flagging
   it because "smaller but one star" is the kind of thing a reviewer notices.
5. **The batch is not joined into the app.** `ch2/index.ts` still lists batch 1 only (assembly is a later
   task, and that file is out of scope), so `test/levels/level-buildability.test.ts` does not yet walk
   levels 23–27 and the palette walk over the at-or-before set lives in my test file instead. When the
   assembly task appends `CH2_BATCH3`, the whole-set walk picks it up with no edit — but note that file's
   `REFERENCE_SOLUTIONS` map will then need entries for the five new ids (it fails loudly without them).
6. **`decoder1` / `decoder3` are reward-only ids** (no def), the same class of seam batch 2 recorded for
   `full_adder`. Neither decoder level's reference depends on them, and a test asserts that, so registering
   the family later cannot invalidate anything measured here.

---

## 7. Log files (all in this directory)

| log | what it is |
|---|---|
| `task-10-vitest-red-1.log` | RED: test file first, `batch3.ts` absent (`Cannot find module`, 0 tests) |
| `task-10-vitest-red-2.log` | RED: 65 tests, 4 failed — the two comment quotes, the pass-through row, the `(a^m)−m` carry-in bug |
| `task-10-vitest-red-3-bit-serial-delay.log` | RED: 2 failed — the bit-serial alternatives measure delay 9, not the 8 I had authored |
| `task-10-vitest-green-1.log` | GREEN: focused, 65 / 65 |
| `task-10-vitest-green-2.log` | GREEN: focused, 67 / 67 (after the delay correction) |
| `task-10-vitest-green-3.log` | GREEN: focused, 67 / 67, final |
| `task-10-vitest-green-verbose.log` | the same run with every test name (`--reporter=verbose`) |
| `task-10-vitest-full.log` | full suite: 21 files, 671 tests passed |
| `task-10-tsc.log` | `pnpm exec tsc --noEmit` — empty (clean) |
| `task-10-build.log` | `pnpm build` — `tsc --noEmit && vite build`, built in ~60 ms |

---

# decoder family registration

**Task:** register the decoder family that chapter-2 levels 25 and 26 reward *and* offer in their own
palettes — `decoder1` (`sel:1` → `out:2`) and `decoder3` (`sel:3` → `out:8`) — as one
width-parametrised definition, with `decoder2` (`sel:2` → `out:4`) produced by the same generator.
**Worktree:** `D:\Documents\turing-complete\.worktrees\phase1`, branch `phase1`.
**Commit:** `a5e618a` — `feat(defs): register the decoder1/decoder2/decoder3 family`
(parent `59bc652`, the batch-3 commit, which landed while this task was running).
**Files changed:** `src/core/defs/wide.ts`, `src/core/defs/index.ts`, `test/core/registry.test.ts` —
nothing else. `src/levels/content/ch2/batch3.ts` and its test file are untouched, and no other level
data is touched.

## 1. The defect, and why every existing test passed anyway

`decoder1` and `decoder3` were reward/palette *data* with no def anywhere in `src/`; the strings
appeared only in comments and in `batch3.ts`. The silence is cumulative, and worth writing down because
it is the `full_adder` class (commit `523a7b9`) with one extra layer:

* `LevelSpec.rewards.components` is `readonly string[]`, not `readonly DefId[]`, so the compiler cannot
  see the mistake;
* `paletteDefsFor` intersects a level's `allowedComponents` with the unlocked set — ids, not defs;
* `ui/palette.ts` then filters that list through `registry.has`, so a part with no def simply never
  appears and nothing records that it did not;
* both decoder levels' reference solutions are wired from gates, so no gate/delay/tick metric moves
  when the part is missing — `test/levels/ch2-batch3.test.ts` asserts exactly that, that neither
  reference instantiates `decoder1`/`decoder2`/`decoder3`.

**The guard did not see the batch.** `shipped level rewards` in `test/core/registry.test.ts` walked
`[...LEVELS, ...CH2_LEVELS, ...CH2_BATCH2]`, and `CH2_LEVELS` still lists batch 1 alone, so the walk
passed *vacuously* for levels 25 and 26. The first change of this task therefore gives batch 3 the
same treatment batch 2 already had — `...CH2_BATCH3` in that walk, plus `decoder1`/`decoder3`
non-vacuity anchors, so the walk cannot pass while the hole stands — and the guards then fail by name:

```
FAIL  test/core/registry.test.ts > shipped level rewards > names only registered defs in rewards.components
AssertionError: rewards that name no def: expected [ …(2) ] to deeply equal []
+ [ "ch2-25-1-bit-decoder rewards decoder1", "ch2-26-3-bit-decoder rewards decoder3" ]

FAIL  test/core/registry.test.ts > shipped level rewards > names only registered defs in allowedComponents
AssertionError: palette ids that name no def: expected [ …(2) ] to deeply equal []
+ [ "ch2-25-1-bit-decoder offers decoder1", "ch2-26-3-bit-decoder offers decoder3" ]
```

No guard was weakened and none was skipped; the walk got strictly wider.

## 2. What was added

### `src/core/defs/wide.ts` — new section, `THE DECODER FAMILY (task 10)`

Placed between the operators (`createWideDefs`) and the storage family, with a section note that states
the three decisions: why it is not a `createWideDefs` product, that the output is one-hot, and the cost
split.

| export | what it is |
|---|---|
| `DECODER_MAX_WIDTH = 5` | widest select field the generator builds — `out` is `2 ** w` bits and `2 ** 5 = 32` is the widest value a `number` carries exactly |
| `createDecoderDef(width)` | the generator: one decoder at `w` select bits, `sel:w` → `out:2 ** w`, id `decoder{w}` |
| `DECODER_WIDTHS = [1, 2, 3]` | the registered select widths, in order |
| `DECODER_DEF_IDS = ['decoder1', 'decoder2', 'decoder3']` | literal tuple, in `WIDE_DEF_IDS` style, so `DEF_IDS` spreads it and `DefId` narrows |
| `DECODER_DEFS` | `DECODER_WIDTHS.map(createDecoderDef)` — the registered family |

Every def: `category: 'wide'`, `cost: 1`, `sequential: false`, `stateBytes: 0`, an explicit `gateCost`
(1 / 10 / 27), no `clockEdge`, `hidden` unset, `name` `{ zh: '<w> 位解码器', en: '<w>-Bit Decoder' }`:

| id | pins | `cost` | `gateCost` |
|---|---|---|---|
| `decoder1` | `sel:1` → `out:2` | 1 | 1 |
| `decoder2` | `sel:2` → `out:4` | 1 | 10 |
| `decoder3` | `sel:3` → `out:8` | 1 | 27 |

`createDecoderDef` throws for a width outside `1..5` (`decoder width must be an integer in 1..5, got
6`) rather than clamping: `clampWidth` would answer a request for 6 with 6, whose `out` pin is 64 bits —
a part with a different pin shape than the caller asked for, silently, and no level name can reach such
a width anyway.

### `src/core/defs/index.ts`

`DECODER_DEF_IDS` joins `DEF_IDS` (so `DefId` can spell the three ids), and `...DECODER_DEFS` joins
`BASE_DEFS` after the storage family, with a comment naming the two levels and pointing at `wide.ts` for
the paper trail. Registration order is not load-bearing (`DEF_IDS` is spread into `DefId` and read by
two test files; the palette order comes from `BASE_DEFS`).

### `test/core/registry.test.ts`

* a `describe('the decoder family')` block with the truth tables, the registration table and the
  generator tests (section 6 below);
* `...CH2_BATCH3` in the `SHIPPED` walk, with the block comment updated to describe two unjoined
  batches instead of one, and `decoder1`/`decoder3` added to both non-vacuity anchor sets;
* the two def-enumeration loops that build a `wide` id set — the `?? cost` fallback rule and the
  1-bit-pin rule — gain `...DECODER_DEF_IDS`, because the decoders are wide-pinned parts and are not
  free. That is an *extension* of those rules, not an exemption: the decoder tests pin the same surface
  (category, both metrics, both pin shapes) directly.

## 3. `gateCost` derivation (also written at `decoderNand` in `wide.ts`)

The basis is the file's own: one 2-input NAND is the unit, `NOT` = 1, `AND` = 2. The construction is the
shared minterm tree that level 26's own comment teaches — do not rebuild the low decode once per output
line:

* invert every select bit: `w` NOTs, which hand the tree both literals of each bit;
* grow the minterms one literal at a time. Layer 2 ANDs each literal of bit 1 with each literal of bit 0
  → 4 ANDs (the four minterms of the low two bits). Layer `j` does the same to the `2 ** (j - 1)`
  minterms already in hand with bit `j - 1`'s two literals → `2 ** j` ANDs. The last layer *is* the
  `2 ** w` output lines, so no minterm is decoded twice and the tree is `w` gates deep;
* ANDs total `sum(2 ** j for j in 2..w)` = `2 ** (w + 1) - 4`, so
  `decoderNand(w) = w * NOT + (2 ** (w + 1) - 4) * AND`.

| w | NOTs | ANDs | `gateCost` | the same number in the level data |
|---|---|---|---|---|
| 1 | 1 | 0 | **1** | level 25's `threeStar.gate` is 1 — one `not`, the `maker` free |
| 2 | 2 | 4 | **10** | (no level; the compendium's 2-bit decoder) |
| 3 | 3 | 12 | **27** | level 26's `threeStar.gate` is 27 — 3 NOTs + 4 ANDs + 8 ANDs |

Both level targets are this tree's own arithmetic, which is the check that the numbers describe the
construction the levels were authored against rather than a drawing invented here — the task brief's
"show your derivation" requirement, answered with a cross-check rather than an assertion. `cost` stays 1
for all three: one delay unit per node (spec §3.2), which is the whole reason the two fields are
separate. The flat alternative (eight 3-input ANDs at w = 3) is 35, which is what makes 27 the lesson
level 26 teaches, and is recorded in the def's comment as the reference point rather than as a claim of
minimality.

## 4. One-hot, not the select value

`out` is a one-hot vector: `2 ** sel`, i.e. bit `sel` high and every other bit low. The level data
states the same expectation at both widths —
`truthTable(io, { out: ({ sel }) => 1 << (sel ?? 0) })` — and the tests write the tables out rather
than computing them from the def, so the level and the part cannot agree by sharing a mistake. A
decoder that published `sel` (a wire wearing a decoder's pins) agrees with the one-hot reading at
`sel` 0 and 1 and disagrees at every value above, which is exactly the "pass-through decoder" the batch-3
test file measures as a grade-0 failure. The tests assert both halves: the exact one-hot value for every
`sel`, and that from `sel = 2` up the output is *not* `sel`.

`2 ** sel` is used rather than `1 << sel` on purpose: `<<` converts through int32, so at the widest
legal field (5 bits) bit 31 would come out negative, and every value in this file passes through the
`u()` truncation for the same reason.

## 5. Why the generator, and not `params.width`

`decoder1` and `decoder2` are one definition at two widths — the source catalog's "2-Bit Decoder" is
introduced by no level name, so it must not become a hand-written part. The width is a parameter of the
**def**, built by `createDecoderDef(w)`, for exactly the reason the module header already gives for
`splitter` / `maker`: `net.ts`'s `effectiveWidth` resolves a pin as `inst.params.width ?? pin.width`
for **every** pin of an instance, so an instance knob cannot make `sel` three bits and `out` eight — it
would widen both to the same width, and a decoder's pins must differ because the output count is
`2 ** sel`. `params.width` was not touched anywhere, no def gained one, and a test pins the reasoning
from the other side.

The generator is deliberately **not** part of `createWideDefs`: that builds one width for every pin of
every def it produces, so a width-8 decoder would be a part whose `out` pin is `2 ** 8 = 256` bits — a
port this project has no carrier for, under an id (`decoder8`) no level data spells. A test asserts
`createWideDefs(8)` grows no decoder id at all. The widths this phase registers come from the literal
`DECODER_WIDTHS` list; a later chapter wanting `decoder4` adds a width, not a def.

## 6. Tests (TDD: RED recorded first, then GREEN)

New coverage in `test/core/registry.test.ts`:

1. **`decoder1` truth table** — both `sel` values, asserting the exact one-hot outputs `0b01`, `0b10`,
   plus that `sel = 1` reads 2 and not 1.
2. **`decoder3` truth table** — all eight `sel` values, asserting `0b0000_0001` … `0b1000_0000`
   literally, plus the invariants that every row has exactly one bit set and that from `sel = 2` up the
   output is not `sel`.
3. **Registration** — for each of the three ids: present in `DEF_IDS` and in the registry,
   `category: 'wide'`, `cost` 1, `sequential: false`, `stateBytes` 0, no `clockEdge`, `hidden`
   unset, an explicitly stated `gateCost` equal to 1 / 10 / 27, exact pins (`sel:1`/`out:2`,
   `sel:2`/`out:4`, `sel:3`/`out:8`) and the exact names.
4. **Cost derivation** — the literal decomposition (`w` NOTs + `2 ** (w + 1) - 4` ANDs at the file's
   basis), the recurrence each extra select bit obeys (`+ 1 + 2 ** w * 2`), and the level-data
   cross-check (1 and 27).
5. **The generator** — `DECODER_WIDTHS` / `DECODER_DEF_IDS` / `DECODER_DEFS` agree with each other and
   with `DEF_IDS`; every width the generator builds, registered or not (1..5), has pins
   `sel:w` / `out:2 ** w` and decodes every `sel` to `2 ** sel`; out-of-range widths (0, 6, 1.5) throw;
   `createWideDefs(8)` contains no decoder.
6. **The defect-class guards** — now covering batch 3 (section 1).

### Commands and results

All commands run from the worktree with the provided pnpm/node paths; logs are in this directory beside
this report.

| command | result | log |
|---|---|---|
| `pnpm test test/core/registry.test.ts` (RED) | 4 failed / 28 passed — the two decoder tables (`unknown component: decoder1` / `decoder3`) and the two shipped-level guards naming `ch2-25`/`ch2-26` | `task-10-decoder-red-1.log` |
| `pnpm test test/core/registry.test.ts` (GREEN) | 35 passed / 35 | `task-10-decoder-green-focused.log` |
| `pnpm test` (full, before commit) | 675 passed / 676, 1 failed | `task-10-decoder-full-1.log` |
| `pnpm exec tsc --noEmit` | clean (empty log, exit 0) | `task-10-decoder-tsc.log` |
| `pnpm build` | `tsc --noEmit && vite build`, built in 59 ms | `task-10-decoder-build.log` |
| `pnpm test` (full, after commit `a5e618a`) | 675 passed / 676, 1 failed — same single failure | `task-10-decoder-full-2-postcommit.log` |

`test/levels/ch2-batch3.test.ts` keeps passing (67 tests) with the defs registered — its "neither
reference instantiates a decoder" assertion is about the reference circuits, not about the registry, so
this change does not invalidate anything measured there.

## 7. The one red assertion is OUTSIDE this task's declared file scope (needs a controller decision)

`pnpm test` is **not** fully green: 675 pass, and exactly one assertion fails —
`test/core/defs-wide.test.ts` → `wide defs: the brief's contract` → `categorizes every wide part as wide
and const8 as a source` (line 224):

```
AssertionError: expected [ 'add8', 'and8', 'ashr8', …(28) ] to deeply equal [ 'add8', 'and8', 'ashr8', …(25) ]
+   "decoder1",
+   "decoder2",
+   "decoder3",
 ❯ test/core/defs-wide.test.ts:224:58
```

That test asserts the exact membership of `byCategory('wide')` against a hard-coded list, so three new
wide-category ids necessarily change it. There is no way to avoid it inside my scope: the brief requires
`category: 'wide'` on both parts, and `createRegistry.byCategory` does not filter `hidden` (hiding them
would in any case drop them from the palette, which is the silence this task exists to end).

I did **not** edit that file, because my brief puts it explicitly out of scope ("Files in scope:
`src/core/defs/wide.ts`, `src/core/defs/index.ts`, `test/core/registry.test.ts`. Nothing else") and asks
for scope limits to be reported rather than worked around. The fix is one import plus one spread, and it
is a *strengthening* edit (the list stays exhaustive):

```ts
// test/core/defs-wide.test.ts, in the import from '../../src/core/defs/wide':
+  DECODER_DEF_IDS,

// line 224:
   expect(r.byCategory('wide').map((d) => d.id).sort()).toEqual(
-    [...WIDE_OP_IDS, ...STORAGE_IDS].sort(),
+    [...WIDE_OP_IDS, ...STORAGE_IDS, ...DECODER_DEF_IDS].sort(),
   );
```

The project's own precedent supports that edit (task 4 appended the whole storage contract to
`defs-wide.test.ts` when it registered the storage family), which is why I am flagging it as the
controller's call rather than as a defect in the decoders. Say the word and it is a two-line follow-up
commit; everything else is green.

## 8. Not done, deliberately

* **No level data touched.** Levels 25 and 26 keep their rewards, palettes and targets byte for byte;
  both now resolve. `decoder1`/`decoder3` are not added to any other level's `allowedComponents`.
* **`decoder2` has no level**, by design — it is registered so a later chapter can reach it, and its
  behaviour, pins and price are pinned by the generator tests.
* **`params.width` untouched** (section 5) — the recorded limitation in `wide.ts`'s header (no
  per-instance pin counts) still stands, and this family is the generator answer to it, not a hook in
  `net.ts`.
* **`hidden` not set** on any decoder: a hidden def is dropped by `ui/palette.ts` even when a level
  lists it, which is precisely the behaviour being fixed.

---

# Task 10 follow-up — the category assertion and level 25's brief

Two small connected fixes, both consequences of the two commits above: `a5e618a` (the decoder family
became real defs) and `59bc652` (the levels were written against a family that did not exist yet).

* **Fix 1** — `test/core/defs-wide.test.ts`'s "categorizes every wide part as wide and const8 as a
  source" asserted `byCategory('wide')` against a hand-maintained literal list, so the three new
  `wide` ids broke it. The expectation is now **derived** from the wide module's own exported id
  tuples, not extended by a fourth literal (section 2).
* **Fix 2** — level 25's brief told the player to set `params.width = 2` to get the catalog's 2-bit
  decoder. That is impossible on this kernel (`compile` resolves a pin as `inst.params.width ??
  pin.width` for every pin of an instance, and a decoder's two pins must differ). The brief now names
  the parts — `decoder1` for this level's 1-to-2 form, `decoder2` for the 2-to-4 form — and the level's
  data comment records the resolution instead of the open question (section 3).

Scope kept to the three files the follow-up brief lists:

| file | changed | why |
|---|---|---|
| `test/core/defs-wide.test.ts` | +51 / −6 | the derived `wide` expectation and the `const8` exception |
| `src/levels/content/ch2/batch3.ts` | +77 / −39 | level 25's brief and comment, plus two module-header claims that the registered family made false |
| `test/levels/ch2-batch3.test.ts` | +72 / −24 | the brief assertion rewritten against the new claim; two stale test comments; one new measured test |

Nothing else was touched: no `src/core/defs/`, no `src/ui/`, no `src/app/`, no other content file.
Committed as **`0e0828a` — `fix(levels): correct level 25's decoder brief, and derive the wide-category
set`** (3 files, +200 / −69; amended once for a wording fix in a comment — `a9b6795` was the
pre-amend SHA and is not in the branch's history); the controller's `progress.md` was left modified and
is not in the commit.

## 1. Fix 1 — the category assertion is DERIVED, not a longer list

### What the derivation is

`test/core/defs-wide.test.ts` now derives the expected `wide` set from the module's own registration
tuples — the same three `DEF_IDS` in `src/core/defs/index.ts` is built from — instead of from the
test's two transcribed contract tables:

```ts
const WIDE_MODULE_IDS = [...WIDE_DEF_IDS, ...WIDE_STORAGE_DEF_IDS, ...DECODER_DEF_IDS] as const;
const WIDE_CATEGORY_IDS = WIDE_MODULE_IDS.filter((id) => id !== 'const8');   // const8 is a source

expect(r.byCategory('wide').map((d) => d.id).sort()).toEqual([...WIDE_CATEGORY_IDS].sort());
// ...and the one exception stated as an exception rather than left implicit:
expect(WIDE_MODULE_IDS.filter((id) => r.get(id).category !== 'wide')).toEqual(['const8']);
```

So: **derived, not a list.** `DECODER_DEF_IDS` is spread in, as the minimum required, but via the same
expression that already spreads the operator and storage tuples — a fourth generated family means one
tuple added to `WIDE_MODULE_IDS`, not a list of ids re-typed in the test file. The `const8` carve-out
(the module's one deliberate `io` part) is no longer a silence: the second assertion says out loud that
exactly one id in those tuples is filed under a category other than `wide`, and the test name lives up
to its other half (`r.get('const8').category === 'io'`, `byCategory('io')` contains it).

### Why it is still an assertion and not a tautology

This was the deciding constraint. Two derivations were rejected as tautological:

* `BASE_DEFS.filter((d) => d.category === 'wide')` — `createRegistry` copies `category` straight
  through, so both sides of the comparison would be the same expression;
* anything built from the *registered defs'* category fields — a part filed under the wrong category
  drops out of the expected set and out of `byCategory('wide')` at the same time, and the assertion
  passes on exactly the mistake it exists to catch.

`WIDE_MODULE_IDS` is neither: it is ids from the module's registration tuples, so the category of the
registered def is an independent fact. A part filed under the wrong category is still in the expected
set and still missing from `byCategory('wide')`.

### Evidence it still catches that (mutation, logged)

`createDecoderDef`'s category was temporarily changed `'wide'` → `'logic1'` (one token in `wide.ts`,
reverted with `git checkout -- src/core/defs/wide.ts` immediately afterwards; `git status` confirms the
file is unmodified):

```
 FAIL  test/core/defs-wide.test.ts > wide defs: the brief's contract > categorizes every wide part as wide and const8 as a source
AssertionError: ... to deeply equal ...
  [ "add8", "and8", "ashr8", "counter8",
-   "decoder1",
-   "decoder2",
-   "decoder3",
    "delay8", ... ]
 ❯ test/core/defs-wide.test.ts:265:58
 Tests  1 failed | 59 passed (60)
```

The derived expectation fails on a mis-filed decoder, which is the whole job of the assertion.

### What the derivation does and does not promise

* It does promise: the expectation tracks `wide.ts` rather than the test file. Adding the decoder
  family's ids to a list here is no longer part of registering a family.
* It does not promise: zero-touch coverage of a hypothetical *fourth* family. That family's tuple has
  to join `WIDE_MODULE_IDS` — one line next to the derivation and its documentation, instead of an ids
  list buried in a test table. A derivation that needed no line at all would have to enumerate
  "everything `wide.ts` exports that is a list of defs" by reflection over the module namespace, which
  this codebase does not do anywhere and which would be less auditable than the three tuples it is
  derived from; the alternative that would make it genuinely zero-touch — one combined
  `WIDE_MODULE_DEF_IDS` tuple exported from `wide.ts` and used by both `DEF_IDS` and this test — was
  not taken because it needs an edit in `src/core/defs/`, which the follow-up brief puts out of scope
  except as a last resort, and because it only moves that same one line into the module. Both were
  weighed; the trade is recorded here rather than hidden in a comment.

## 2. Fix 2 — level 25's brief, and the resolution in its comment

### The new brief text (player-facing, both languages, verbatim)

```ts
zh: '解码器把一个选择值变成一条为高的输出线，而且是按宽度分档的：一档一颗元件。这一关要做的是 decoder1，也就是 1 位选择、2 路输出的那一颗——sel 为 0 时第 0 位为高（out 读作 1），sel 为 1 时第 1 位为高（out 读作 2）。2 位选择、4 路输出的那一颗是 decoder2，也就是源资料目录里的「2 位解码器」：没有任何关卡为它命名，以后哪一关需要 4 路输出，直接把它放进去就行。',
en: 'A decoder turns a select value into one high output line, and it comes in widths: one part per width. This level asks for decoder1, the 1-to-2 form -- sel 0 lights bit 0 (out reads 1) and sel 1 lights bit 1 (out reads 2). The 2-to-4 form is decoder2: two select bits, four output lines, the catalog\'s 2-bit decoder, which no level name introduces and which a later circuit can drop in as it is.',
```

Original prose (this replica's own, not the source's), so nothing is copied from the original game. The
three things it has to say are all in it: the decoder comes in widths, `decoder1` is the 1-to-2 part
this level asks for, `decoder2` is the 2-to-4 form available for later. `params.width` is gone from
both languages, and the test asserts its absence so the old wording cannot come back unnoticed.

### The data comment records the resolution

The old comment recorded an open question ("how that width reaches two differently-sized pins is the
decision of the task that registers the family"). It now records how the question was answered, with
the rejected mechanism kept:

* the family is generated **per width** — `createDecoderDef(w)` builds one part with `sel: w` in and
  `out: 2 ** w` out, `DECODER_WIDTHS` registers w = 1, 2, 3, and the ids are `decoder1` / `decoder2` /
  `decoder3`;
* `params.width` cannot be the mechanism, and the comment keeps the full reason so nobody tries it
  again: the kernel resolves a pin as `inst.params.width ?? pin.width` for EVERY pin of the instance
  (`src/core/net.ts`, `effectiveWidth`), so one width literal covers the whole part — `sel: 1 / out: 2`
  at `params.width = 2` becomes `sel: 2 / out: 2`, never the catalog's `sel: 2 / out: 4`. A decoder's
  pins must differ, so the width has to be a property of the DEF. (Verified as well as argued: a
  compiled `decoder1` with `params.width = 2` reports `{sel: 2, out: 2}` — see the evidence log.)

### The palette decision: `decoder2` is NOT added, and the comment says why

Chosen: **leave `decoder2` out.** Two independent reasons, both recorded in the comment:

1. **No level unlocks it.** A palette entry is a part the chapter has already handed out;
   `decoder2` is the family member no level name introduces (level 25 rewards `decoder1`, level 26
   `decoder3`), and `gates every part behind a component unlocked at or before it` in
   `test/levels/ch2-batch3.test.ts` walks the unlock order and refuses an entry nothing has unlocked by
   then. Adding it would have required adding it to a level's rewards too, i.e. inventing an unlock for
   a part the source never introduces.
2. **It would answer the level by itself.** Wired to this level's one-bit `sel`, `decoder2`'s second
   select bit is simply unwired (an unwired pin reads 0), so its low two output bits are `1 << sel` —
   this level's whole two-row table, from a part the player never builds. Measured, not assumed:
   grading a `decoder2` drop-in against `ch2-25-1-bit-decoder` gives `passed: true, stars: 1,
   metrics {gate: 10, delay: 1, tick: 0}, failures []`.

The brief still names it (that is the point of naming it), the palette still does not offer it, and
`test/levels/ch2-batch3.test.ts` now pins both halves — `brief.en` contains `decoder2`,
`allowedComponents` does not.

**`decoder1` stays in the palette, and that is the rule rather than an inconsistency.** Batch 2's
palette rule subtracts only parts that are *not* the level's own reward, and `paletteDefsFor` offers a
level its own rewards before it is passed (level 13's `splitter`, level 20's `full_adder` are the same
case). Now that the def exists, a player can drop `decoder1` in and score the target exactly —
measured: `passed: true, stars: 3, metrics {gate: 1, delay: 1, tick: 0}` against a target of
`{gate: 1, delay: 1, tick: 0}`. That is the documented price of the own-reward half of the rule, not a
hole this fix should paper over by deleting the id the level exists to hand out; the level's comment
states it in those terms, and the measurement is now taken in the test file rather than described.

### The sweep for the same wrong claim elsewhere

`params.width` and `decoder` were grepped across `src/levels/`. Findings and actions:

* `src/levels/content/ch2/batch3.ts`, module header, the "LEVEL 25'S DECODER …" item — "LEVEL 25'S
  DECODER IS WIDTH-PARAMETRISED … the brief's claim about widening the part": rewritten to the
  per-width family and the brief naming ids, and it now records that an earlier revision of this batch
  shipped the wrong story.
* `src/levels/content/ch2/batch3.ts`, module header, the "REWARDS THAT NAME NO DEF ARE NORMAL HERE"
  paragraph — "no def of either id is registered in this phase": false since `a5e618a`; rewritten to
  say the rewards' defs exist now, that no number in the file moved, and that `decoder2` is registered
  but offered nowhere.
* `src/levels/content/ch2/batch3.ts`, module header, the palette-rule paragraph — "Nothing else in
  this batch is answered by a single unlocked part" needed the own-reward clause now that `decoder1`
  is a registered drop-in; amended to name level 25's own-reward case explicitly.
* `src/levels/content/ch2/batch3.ts`, level 26's SOURCED line — "the same part as level 25 one width
  up … `decoder3` is `decoder1` at width 3" reworded to the generator (`createDecoderDef(3)`), so it
  does not read as two ids of one part.
* `src/levels/checks.ts` — mentions `params.width` only as the kernel's own resolution rule
  (`net.inputWidth`); correct, untouched.
* Everything else in `src/levels/` that mentions a decoder is level 27's *opcode* decoder (a different
  thing: the mux tree's one-hot select), and `ch2/index.ts` still assembles batch 1 alone, as its own
  comment says.

## 3. Covering tests

Everything the two fixes claim is now pinned by an assertion in a shipped test file:

| claim | test |
|---|---|
| `byCategory('wide')` is exactly the wide module's parts | `test/core/defs-wide.test.ts` → `categorizes every wide part as wide and const8 as a source` (derived set) |
| exactly one module id is not `wide`, and it is `const8` | same test, second assertion |
| the brief names `decoder1` / `decoder2` and the widths they decode, in both languages | `test/levels/ch2-batch3.test.ts` → `tells the player the decoder comes in widths, and names the parts` |
| the brief does NOT offer `params.width` as the mechanism | same test, `not.toContain('params.width')` in both languages |
| the comment records the family and why `params.width` cannot do it | `test/levels/ch2-batch3.test.ts` → `records the per-width decoder family and why a width parameter cannot do it` |
| no reference solution drops a decoder in | `… → the decoder rewards are generated per width, and no reference drops one in → wires both decoder levels from gates, not from a decoder drop-in` |
| level 25 names `decoder2` and does not offer it | same test, new assertions |
| level 25's own reward scores the target (the own-reward rule) | same describe → `lets level 25's own reward score the target, which is the own-reward rule` (new; grades a `decoder1` drop-in and compares `metrics` with `L25.threeStar`) |

No assertion was deleted: the old level-25 brief assertion (`zh`/`en` contain `params.width`,
`2 位解码器`, `2-bit decoder`) became its opposite for the mechanism and its successor for the naming
— the test still fails if the brief stops telling the player how to get a 4-output decoder.

Second mutation, for Fix 2: the old sentence (`set params.width to 2 and it is the catalog's 2-bit
decoder`) was put back into the `en` brief temporarily and the batch-3 file re-run:

```
 FAIL  test/levels/ch2-batch3.test.ts > chapter 2, levels 23-27 > tells the player the decoder comes in widths, and names the parts
AssertionError: expected '…' not to contain 'params.width'
 ❯ test/levels/ch2-batch3.test.ts:453:30
 Tests  1 failed | 66 passed (67)
```

The mutation was reverted immediately (the file's final content is the new brief above); the run is in
`task-10-fix-mutation-brief-params-width.log`.

Two temporary scratch test files were used for the measurements quoted above
(`test/scratch-l25-evidence.test.ts`, `test/scratch-l25-own-reward.test.ts`) and were deleted before the
commit; `git status` shows only the three in-scope files. One more scratch file — a byte-for-byte copy
of the pre-fix `test/core/defs-wide.test.ts` (`git show HEAD:test/core/defs-wide.test.ts`), placed at
`test/core/scratch-baseline.test.ts` so its relative imports resolve — produced the pre-fix baseline
log, and was deleted as well.

## 4. Commands and output

All run from `D:\Documents\turing-complete\.worktrees\phase1` with the bundled runtime:

```
node "C:\Users\ME\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe" \
     "C:\Users\ME\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\pnpm\bin\pnpm.mjs" <script>
```

| command | result | log |
|---|---|---|
| `test test/core/defs-wide.test.ts test/levels/ch2-batch3.test.ts` | **2 files, 128 tests passed** (60 + 68) | `task-10-fix-focused-green.log` |
| `test` (full suite) | **21 files, 677 tests passed** | `task-10-fix-full-green.log` |
| `exec tsc --noEmit` | clean — zero bytes of output | `task-10-fix-tsc.log` |
| `build` (`tsc --noEmit && vite build`) | `✓ 34 modules transformed`, `✓ built in 58ms` | `task-10-fix-build.log` |
| `smoke` (playwright) | `2 passed (5.9s)` | `task-10-fix-smoke.log` |
| baseline: the pre-fix copy of the assertion, run before any edit | `FAIL … categorizes every wide part as wide and const8 as a source`, `Tests 1 failed \| 59 passed (60)` — the failure this task was opened for, reproduced | `task-10-fix-baseline-red.log` (the log names the scratch copy the file was run from) |
| mutation: decoder filed as `logic1` | 1 failed / 59 passed, as intended | `task-10-fix-mutation-miscategorized-decoder.log` |
| mutation: `params.width` back in the brief | 1 failed / 66 passed, as intended | `task-10-fix-mutation-brief-params-width.log` |
| scratch measurements | decoder2 drop-in: `passed, 1 star, gate 10, delay 1`; decoder1 drop-in: `passed, 3 stars, gate 1, delay 1`; `decoder1 @ params.width=2 → {sel: 2, out: 2}` | `task-10-fix-evidence.log` |

The full-suite count rose from 675/676 (one red) to 677 green because of the one test added in
`test/levels/ch2-batch3.test.ts`; the failing assertion is the one this task was for.

Re-run **on the committed tree** (`0e0828a`), so the green above is not a pre-commit coincidence:

| command | result | log |
|---|---|---|
| `test` (full suite, post-commit) | **21 files, 677 tests passed** | `task-10-fix-full-green-postcommit.log` |
| `exec tsc --noEmit` (post-commit) | clean — zero bytes | `task-10-fix-tsc-postcommit.log` |
| `build` (post-commit) | `✓ built in 58ms` | `task-10-fix-build-postcommit.log` |

`git status` after the commit: only `.superpowers/sdd/2026-09-25-turing-complete-phase1/progress.md`,
modified, untracked by this commit — as the brief requires.

## 5. Concerns and notes for the controller

* **Residual in Fix 1's derivation, stated plainly.** A hypothetical fourth generated family still
  needs one line in `WIDE_MODULE_IDS`. It is now one line in one expression that is documented as the
  derivation, rather than ids re-typed into a contract table; making it truly zero-touch would need a
  combined tuple exported from `wide.ts` (out of the follow-up's declared scope) and would only move
  that line into the module. If the controller wants the zero-touch version, it is a small follow-up:
  export `WIDE_MODULE_DEF_IDS` from `wide.ts`, spread it in `DEF_IDS`, and use it here.
* **The own-reward drop-in on level 25 is a pre-existing rule, now reachable.** `decoder1` ties the
  three-star target (1 gate, 1 delay) because a one-NAND minterm tree and the one NOT it is built from
  are the same gate. It is in the palette because batch 2's rule offers a level its own rewards before
  the level is passed; level 20's `full_adder` and level 13's `splitter` are the same case. If the
  controller wants own rewards withheld until first pass, that is a change to `paletteDefsFor` and to
  every level that offers its own reward — much larger than this fix, and deliberately not attempted
  here.
* **`decoder2` has still never been offered to a player.** It is registered, priced, tested, and named
  in level 25's brief, but no level's palette lists it. The next chapter that needs a 2-to-4 decoder
  must add it to a level's rewards (which is what makes it legal to offer) rather than only to a
  palette.
* `.superpowers/sdd/2026-09-25-turing-complete-phase1/progress.md` was left modified and was **not**
  committed, per the brief; the commit contains the three in-scope files only.
