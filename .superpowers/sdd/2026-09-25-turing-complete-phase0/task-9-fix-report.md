# Task 9 fix report — chapter 1 three-star targets

Status: **DONE_WITH_CONCERNS** — all gates green (170/170 tests, `pnpm build` clean); one
brief-vs-tree discrepancy is reported below (level 11's "stale comment" does not exist).

Commit: `e3fbd84 fix(levels): tighten ch1 three-star targets to the reference metrics` on
`master` (tree clean; this report is a gitignored working-tree artifact under `.superpowers/sdd/`,
matching the earlier task reports).

## 1. The three target values changed

All three now read exactly `{ gate: 2, delay: 2, tick: 0 }`.

| Level id | File | Before | After |
|---|---|---|---|
| `ch1-06-nor-gate` | `src/levels/content/ch1/part1.ts:126` | `{ gate: 4, delay: 3, tick: 0 }` | `{ gate: 2, delay: 2, tick: 0 }` |
| `ch1-10-bigger-or-gate` | `src/levels/content/ch1/part2.ts:159` | `{ gate: 6, delay: 4, tick: 0 }` | `{ gate: 2, delay: 2, tick: 0 }` |
| `ch1-11-bigger-and-gate` | `src/levels/content/ch1/part2.ts:188` | `{ gate: 4, delay: 2, tick: 0 }` | `{ gate: 2, delay: 2, tick: 0 }` |

The arithmetic checks out against the code that computes it, not just the brief:

- `gateCost` (`src/levels/grader.ts:29`) sums `registry.get(def).cost`; `src/core/defs/index.ts`
  gives every gate `cost: 1` (lines 23, 81–89) and every source / level-IO / storage part
  `cost: 0` (lines 45, 98, 112, 132, 156). The three reference solutions are two-gate chains
  between level IO, so `gate` is exactly 2 — not 4 and not 6.
- `delayOf` (`src/core/net.ts:407`) is the longest combinational path in base-gate delays and
  skips storage elements; a two-gate chain behind zero-cost sources is exactly 2.
- `starsOf` (`src/levels/grader.ts:38`) treats a metric equal to its target as met, so a target
  equal to the reference metrics is safe and still earns 3 stars.

Evidence that the references really do meet 2/2/0: the two tests that grade each reference and
assert `stars === 3` (`test/levels/ch1-part1.test.ts:190`, `test/levels/ch1-part2.test.ts:165`)
pass. `starsOf` returns 3 only when `gate <= 2`, `delay <= 2` and `tick <= 0`, so those are
observed upper bounds; the two cost-1 gates and the two combinational stages in each reference
are the matching lower bounds. No reference solution, check, palette or reward was touched.

## 2. Comments added

The rule, as one line directly above each `threeStar` line, in all three places (and in the
plan's matching code blocks):

```ts
// Three-star target = the reference solution's own metrics; the reference scores exactly it.
```

**Discrepancy with the brief (level 11):** the brief says level 11's current line carries a
comment about an earlier delay change from 4 to 2 and that it is now stale. No such comment
exists in the tree at HEAD (`git show ae41b06` and the current file both show a bare
`threeStar: { gate: 4, delay: 2, tick: 0 },`), and no comment matching that description exists
anywhere in the repository. Also, level 11's looseness was in `gate` (4 vs the reference's 2),
not in `delay` (already 2). I therefore **inserted** the rule comment rather than replacing a
stale one; the requested end state (rule comment + `{ gate: 2, delay: 2, tick: 0 }`) is reached.

## 3. Plan updated: `docs/superpowers/plans/2026-09-25-turing-complete-phase0.md`

- **Task 8 code block** (level 6) and **Task 9 code block** (levels 10, 11): the same three
  `threeStar` values updated to `{ gate: 2, delay: 2, tick: 0 }`, with the same one-line rule
  comment, so the plan and the shipped data agree.
- **Chapter-1 summary table** (rows 6–12) rewritten against the code blocks, which the new note
  above the table declares authoritative (with 「上」 defined as the previous row's palette, so
  the cumulative shorthand is unambiguous):
  - 6: palette/IO/check already matched; added `三星 gate:2 delay:2` since the target changed
    (same style as row 9's existing `三星 gate:4`).
  - 7: palette was the stale union `nand not and or const_on` → the true palette `const_on`;
    unlock was `xor` → `delay_line` `xor` (the code block's reward, and the reason level 8 can
    offer Delay Line at all).
  - 8: palette `上 + xor + delay_line` → `上 + delay_line` (the code block omits `xor`); check
    `script（t=2 断言 1）` → `script（tick 0/1 为 0，tick 2/3 为 1；三星 tick:3）`.
  - 9: palette `上 + and3` → `上 + nand not and or and3` (the code block omits `xor` at 9 too);
    the existing `三星 gate:4` is correct for the four-NAND reference and was left alone.
  - 10: palette `上 + or3` → `上 + xor`; added `三星 gate:2 delay:2`.
  - 11: palette `上 + xnor` → `上 + or3`; added `三星 gate:2 delay:2`.
  - 12: palette 全部 (unchanged); IO `b3..b0 / out` → `b3..b0 / out3..out0`; check
    `constraint（玩家读目标数并用二进制复现）` → `truth-table（b3..b0 穷举 0–15，四位直通）`.
- Rows 1–5 were re-checked against their code blocks and already matched; they were not touched.

## 4. Verification

Iterating run (the two level suites), then the full suite, then the build. The full-suite command
is exactly:

```
& "C:\Users\ME\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe" "C:\Users\ME\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\pnpm\bin\pnpm.mjs" test
```

Output:

```
$ vitest run

 RUN  v5.0.2 D:/Documents/turing-complete

 ✓ test/core/signal.test.ts (16 tests) 28ms
 ✓ test/core/registry.test.ts (24 tests) 45ms
 ✓ test/smoke/sanity.test.ts (1 test) 11ms
 ✓ test/levels/grader.test.ts (12 tests) 47ms
 ✓ test/levels/checks.test.ts (20 tests) 86ms
 ✓ test/levels/ch1-part2.test.ts (29 tests) 69ms
 ✓ test/levels/ch1-part1.test.ts (34 tests) 71ms
 ✓ test/core/net.test.ts (19 tests) 413ms
   ✓ compile (4)
     ✓ sizes the signal table for the circuit instead of the 65,536 default 357ms
 ✓ test/core/graph.test.ts (15 tests) 726ms
   ✓ validateGraph (9)
     ✓ scans a 50,000-instance cycle without recursing 690ms

 Test Files  9 passed (9)
      Tests  170 passed (170)
   Start at  21:47:59
   Duration  1.60s (transform 47%, tests 29%, import 17%, worker 6%)
```

`pnpm build` (`tsc --noEmit && vite build`): `✓ 4 modules transformed`, `✓ built in 63ms`,
`dist/index.html 0.33 kB`, `dist/assets/index-Cunev-bE.js 0.76 kB` — no type errors.

## 5. No test expectation was edited

`git diff --name-only` touches exactly three files:

```
docs/superpowers/plans/2026-09-25-turing-complete-phase0.md
src/levels/content/ch1/part1.ts
src/levels/content/ch1/part2.ts
```

Nothing under `test/` is modified (no expectation, fixture or reference solution), and nothing
under `src/core/`, `src/app/`, `src/ui/`, `src/persist/` or `package.json` is touched. No
dependency was added. The tightened targets were satisfied by the existing references on the
first run — had a reference failed, the target would not have been relaxed further.

## 6. Concerns

1. The brief's claim that level 11 carried a stale delay comment is not true of this tree; see
   §2. The intended end state was still produced, but any downstream instruction that assumed
   the comment was deleted should be re-checked.
2. The summary table now records three-star targets for rows 6, 9, 10 and 11. Targets embedded
   in prose can go stale again (row 9's `三星 gate:4` was already there and is still correct);
   the note above the table makes the code blocks authoritative, which is the mitigation.
