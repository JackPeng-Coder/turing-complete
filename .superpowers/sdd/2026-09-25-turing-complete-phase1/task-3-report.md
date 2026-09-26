# Task 3 report — 宽位纯组合组件 (wide pure-combinational components)

**Status:** DONE_WITH_CONCERNS (two decisions the controller should ratify: `const8`'s
value and the `splitter`/`maker` parameter channel — both documented, both one line to
change).
**Commit:** `a57908a` — `feat(core): add the wide (8-bit) operator family and cap params.width`
(6 files, +1382/-8). Worktree `D:\Documents\turing-complete\.worktrees\phase1`, branch `phase1`,
BASE `e27d81a` as the ledger records.
**Verification:** full suite 315 passed / 16 files, `tsc --noEmit` 0 diagnostics, `pnpm build`
exit 0, `pnpm smoke` 2 passed. Logs listed in §6 and indexed in `task-3-commands.txt`.

---

## 1. What I implemented

`src/core/defs/wide.ts` (new, 573 lines) holds the whole family behind one generator,
`createWideDefs(width = 8)`, and `src/core/defs/index.ts` registers it at the default width.
All 24 ids and every pin name are the brief's table, verbatim:

| group | ids | pins |
|---|---|---|
| bitwise | `and8` `or8` `nand8` `nor8` `xor8` `xnor8` | `a:8 b:8 → out:8` |
| | `not8` | `a:8 → out:8` |
| arithmetic | `add8` | `a:8 b:8 cin:1 → out:8 cout:1` |
| | `neg8` | `a:8 → out:8` |
| | `mul8` `div8` | `a:8 b:8 → out:8` |
| compare | `less_s` `less_u` `equal8` | `a:8 b:8 → out:1` |
| shift/rotate | `shift_l8` `shift_r8` `ashr8` `rot_l8` `rot_r8` | `a:8 amount:8 → out:8` |
| source | `const8` | `— → out:8` (category `io`, like `const_on`) |
| packers | `splitter` | `in:8 → b0..b7:1` |
| | `maker` | `b0..b7:1 → out:8` |
| conditional | `switch` | `a:1 on:1 → out:1` |
| | `switch8` | `a:8 on:1 → out:8` |

Everything is pure combinational: `sequential: false`, `stateBytes: 0`, no `clockEdge`,
and `evaluate` is the two-argument shape the brief prescribes for combinational defs.
Categories: `'wide'` for the 23 operators/packers, `'io'` for `const8`.
Ids reach level data because `DEF_IDS` is now `[...PHASE0_DEF_IDS, ...WIDE_DEF_IDS]`, so
`DefId` includes them (the test pins that `WIDE_DEF_IDS` and the generated ids agree).

**Cost** (also a decision, §5.3): 1 per operator and for `switch`/`switch8`, 0 for `const8`
(a source) and for `splitter`/`maker` (pure wiring). Reason in §5.3 — `delayOf` charges
`def.cost` per node, so anything above 1 breaks "every component contributes exactly one
unit of delay".

**Extra fix routed from Task 2's review:** `src/core/graph.ts` now rejects
`params.width > MAX_PARAM_WIDTH = 4096` with the same `invalid-params` issue, and the issue
message quotes the bound. Two rows were added to the existing `invalid-params` case in
`test/core/net.test.ts`. Details in §4.

Not touched, verified with `git show --stat a57908a`: `src/core/net.ts`, `src/levels/`,
`src/ui/`, `src/app/`, `src/core/registry.ts` (the `'wide'` category already existed).

---

## 2. Decided semantics, per operator

Every operator returns through one helper that masks to the port width and forces the
result non-negative (`(value & mask) >>> 0`). That helper exists because a bare `&` on a
value with bit 31 set goes through `int32` and yields `-1`, and a negative number is
rejected by `assertWidth` on its way into a port. No path in this module can hand the
kernel a negative number.

| operator | overflow / edge behaviour (decided and tested) |
|---|---|
| `and8` `or8` `nand8` `nor8` `xor8` `xnor8` | bitwise on masked operands, result masked to 8 bits. No carry, no sign. `xnor8 = ~xor8`, `nand8 = ~and8`, `nor8 = ~or8` (property-tested). |
| `not8` | `~a & 0xff`; `not8(not8(a)) === a`. |
| `add8` | `out = (a+b+cin) mod 256`; `cout` = bit 8 = 1 iff `a+b+cin >= 256`. The sum is ≤ 511, so the carry is exact. Both pins come from the same integer, so they cannot disagree. Computed with `Math.floor(sum / 2**w)`, not `>>`, because `>>` takes its count mod 32 and would report bit 0 at w = 32. |
| `neg8` | `(256 - a) mod 256`. `neg8(0) = 0`, `neg8(0x80) = 0x80`. `a + neg8(a) = 0 mod 256` with `cout = 1` for every `a != 0` (the sum really is 256 — my first test expectation said `cout = 0` and the reference formula was right, see §7.2). |
| `less_s` | two's complement compare. The sign reading is internal; the output pin is one unsigned bit. `less_s(0x80, 0x7f) = 1`, `less_s(0x7f, 0x80) = 0` — the case unsigned gets backwards. |
| `less_u` | unsigned compare on the masked patterns. |
| `equal8` | 1 iff the patterns are equal. |
| `shift_l8` `shift_r8` | `amount >= 8` → 0 (decided). Below that, a logical shift with the result masked; bits shifted past bit 7 are dropped. |
| `ashr8` | two's complement. `amount >= 8` → sign fill (`0xff` when the sign bit is set, `0` otherwise) rather than 0 — that is what keeps it distinct from `shift_r8`. Below that, an arithmetic shift returned as an unsigned pattern. Never negative on the wire. |
| `rot_l8` `rot_r8` | `amount % 8` (decided): 8/16/24 are the identity, 255 rotates by 7. Rotating by 0 is the identity. |
| `mul8` | low 8 bits of the product only — `mul8(16,16) = 0`, `mul8(255,255) = 1`. There is no high output pin, so the truncation is the whole contract. Implemented with a half-width split so no intermediate exceeds 2^53 (a plain `x*y` would lose the low bits at w = 32). |
| `div8` | `floor(a/b)` for `b != 0`; **`b = 0` → `0xff`** (the brief's value, marked DECIDED in a comment, not an accident). Every numerator gets the same answer. |
| `const8` | drives `0xff`. See §5.2. |
| `splitter` | `b_i` = bit `i` of `in`, least significant first. Pure wiring. |
| `maker` | `out = Σ b_i · 2^i`; the exact inverse of `splitter`. |
| `switch` `switch8` | `on = 1` passes `a`; `on = 0` forces the output to all-zero (ruling 1: the conditional pass, safe to cascade — tested by chaining two `switch8`s). |

The width generator clamps (`clampWidth`): `undefined`/`NaN` → 8, everything else truncated
toward zero into `[1, 32]` (`Infinity` → 32, `1e9` → 32, `0`/negative → 1). 32 is the
ceiling because `PortValue` is a `number` up to 32 bits and a `Uint8Array` above, and every
operator here carries its result in a `number`; the byte-array carrier is phase 5's.

---

## 3. `splitter` / `maker` parameter rule (ruling 4)

**Rule chosen: the pin count is a parameter of the DEF — `createWideDefs(width)` — not of
the instance. `params.width` is not the knob, and the reason is a hard kernel fact, not a
preference:**

* The kernel resolves a pin's width as `inst.params.width ?? pin.width` for **every** pin of
  the instance (`net.ts`, `effectiveWidth`). On a def whose pins differ in width, that knob
  cannot re-count pins: `params.width = 4` on a splitter gives its **eight** outputs four
  bits each — a different, wrong component — instead of giving it four one-bit outputs.
  Task 2's override rule only makes sense for a def whose pins are all the same width.
* So `createWideDefs(w)` builds `splitter` with exactly `w` one-bit outputs `b0..b{w-1}` and
  `maker` with exactly `w` one-bit inputs, and this phase registers the default 8. A level
  that needs four bits uses `b0..b3` of the registered splitter; the unused high pins read 0.
  This is asserted, not just asserted-in-prose: with `params.width = 4` on a splitter,
  `test/core/defs-wide.test.ts` pins that `in` and every `b_i` became 4 bits and that bit 0
  of each `b_i` still carries the split bit, so a future def-level count hook in `net.ts`
  fails that test instead of quietly disagreeing with these docs.
* Both the default 8 and a non-default 4 (and 16) are tested through the generator, including
  `maker(splitter(x)) === x` for every value at each width — the parameter is exercised, not
  decorative.
* Per-instance pin counts would need a def-level hook in `net.ts` (e.g. `def.expand(params)`),
  which is out of this task's scope. If the controller wants that, it belongs to whichever
  task owns `net.ts`.

---

## 4. The routed fix: `params.width` ceiling

`validateGraph` accepted any positive safe integer, so `params.width = 1e9` passed validation
and `capacityFor` reserved `slots * 1.25 + regions + 16` **bytes** before `alloc` ever ran:
the `RangeError` came from the typed-array allocation and escaped `compile` → `createSim` →
`runChecks`/`grade`, reopening exactly the hole Task 2 closed for `alloc` itself.

* `graph.ts` gains `export const MAX_PARAM_WIDTH = 4096`; the check is now
  `Number.isSafeInteger(width) && width > 0 && width <= MAX_PARAM_WIDTH`, otherwise the
  `invalid-params` issue (same code, same severity), with the bound in both messages.
* 4096 is far above anything the game ships (8 this phase, at most 64 in phase 5) and keeps
  the table in the megabytes, so a larger width is a malformed document rather than a large
  circuit.
* Test: the existing `it.each` case in `test/core/net.test.ts` gained `4097` and
  `Number.MAX_SAFE_INTEGER`. RED showed both failing for the right reasons (4097 compiled
  with no error at all; MAX_SAFE_INTEGER escaped as `RangeError: Invalid typed array length`);
  GREEN shows both as `CircuitValidationError` with `['invalid-params']`.

---

## 5. Decisions the brief and the rulings left open

### 5.1 `div8` by zero
`0xff`, per the brief, written as a DECIDED behaviour in the operator's doc comment and
tested for every numerator (`0`, `1`, `255`) — the value is deliberate, not fallout.

### 5.2 `const8`'s value = `0xff` (all ones) — **ratify or change**
The brief fixes `const8`'s pins but not its value, and there is no value channel: `params`
carries numbers and the kernel reads only `params.width`. So the value is a module constant
(`CONST_VALUE = 0xff`). All-zeros would need no component at all — an unwired input already
reads 0, and the kernel says so with a `dangling-input` warning — so the constant worth a
palette slot is the one a circuit cannot synthesise for free. It is one line to change if the
chapter-2 level author wants zeros; `defs-wide.test.ts` pins the current value.

### 5.3 `cost`
1 for every operator and for `switch`/`switch8`; 0 for `const8` (source, like `const_on`) and
for `splitter`/`maker` (wires, like `level_output`). `gateCost` sums `def.cost`, but
`delayOf` also charges `def.cost` **per node**, so a NAND-equivalent cost (an 8-bit adder
worth 40) would give a wide part a 40-unit delay and contradict Global Constraint 4 ("every
component contributes exactly one unit of delay"). The spec's NAND-equivalent gate metric
needs `expand()`, which does not exist yet; when it lands it can re-derive these numbers in
one place. Level three-star targets for chapter 2 must be written against cost 1 wide parts.

### 5.4 Non-8-bit ids
`createWideDefs(w)` names the suffixed members `stem + width` (`and4`, `add16`, `switch4`),
but `less_s`, `less_u`, `splitter`, `maker` and the one-bit `switch` keep their unsuffixed
names, because the contract's ids for them carry no width. Phase 5 should settle the 16/32/64
spelling before registering them; nothing in this phase depends on it.

### 5.5 Test-file scope
Two rows were added to `test/core/net.test.ts` even though the file list named only
`registry.test.ts`/`defs-wide.test.ts`. That file already owns the regression
(`compile` must throw `CircuitValidationError`, not `RangeError`), and it is the only place
the escape is observable end to end. `registry.test.ts` needed one change: its phase-0
"declares 1-bit pins everywhere" invariant now skips the wide family (which intentionally
breaks it) and adds a positive assertion that `byCategory('wide')` is non-empty; the wide
pins' exact widths are pinned against the brief's table in `defs-wide.test.ts` instead. No
other existing test needed touching — nothing else in the repo assumed all pins are 1 bit.

---

## 6. Tests and results

`test/core/defs-wide.test.ts` (new, 754 lines, 47 cases):

* **The contract.** All 24 ids × their exact `inputs`/`outputs` id+width lists; registry
  reachability (`registry.get('add8')` etc., plus `DEF_IDS` membership and
  `WIDE_DEF_IDS === createWideDefs(8).map(id)`); every wide def combinational with no state,
  no clock edge and not hidden; categories (`byCategory('wide')` is exactly the 23; `const8`
  is `io`); costs; no duplicate ids.
* **Boundary vectors per operator** (0, 1, max, carry/borrow, sign boundary):
  all six bitwise ops on 9 boundary pairs incl. `0x80/0x7f`; `add8` on 11 vectors incl.
  `255+1`, `255+255+1`, `0x7f+1`, `0x80+0x80`; `neg8` on all 256; `less_u`/`less_s` on the
  sign boundary and on all 121 sampled pairs; shifts at amounts 0, 1, 3, 7, 8, 9, 255;
  `mul8` incl. `16*16 = 0` and `255*255 = 1`; `div8` incl. `255/2 = 127`, `254/255 = 0`;
  `switch`/`switch8`; `splitter`/`maker` on `0`, `0xff`, `0x81`, `0x0f`.
* **Property checks** where a property is clearer than vectors: `add8.out === (a+b+cin) & 0xff`
  and `add8.cout === ((a+b+cin) >> 8) & 1` for the full 11×11×2 grid; `neg8(a) === (256-a) & 0xff`
  and `neg8(neg8(a)) === a` and `a + neg8(a) = 0` for all 256; `mul8`/`div8` against their
  reference formulas over the grid; `xor8` its own inverse over 11×11; `xnor8/nand8/nor8` as
  negations of `xor8/and8/or8`; shifts against reference lambdas at amounts 0–15 plus 255 and
  rotates at amounts 0–32 plus 255; `rot_r8(rot_l8(a,k),k) === a`; `rot_*` at 8/16/24 as the identity; `shift_*` at
  `amount >= 8` as 0; `div8` by zero as `0xff`; `maker(splitter(x)) === x` for all 256.
* **The generator at two widths.** Default 8 (pins and ids verbatim) and 4 (`splitter` gets
  `b0..b3` only, round trip for all 16 values) plus 16 (`add16`, `shift_l16`), and the clamp
  behaviour including `createWideDefs(1e9)` → a 32-pin splitter rather than gigabytes.
* **Through the kernel** (the part that proves the defs work with the multi-bit kernel Tasks
  1–2 built, not just in isolation): a real `add8` circuit with `level_input`/`level_output`
  (sum and carry for 5 vectors), `splitter → maker` driven at the pin level for **every byte**
  0–255, and a 1-bit `level_input` feeding `switch8`'s 8-bit `a` pin (the narrow-driver case:
  high bits read 0, not the neighbour's signal).

Results: 47/47 pass. Two of the 47 were wrong *expectations* of mine on first run (§7.2); the
implementation matched the reference formulas already used elsewhere in the same file.

Regression safety: 266 tests existed before this task; the suite is now 315 (+47 wide cases,
+2 `invalid-params` rows), all green, with one existing phase-0 test rescoped (§5.5) and no
existing assertion loosened.

### TDD evidence

* **RED 1** — `PNPM test test/core/defs-wide.test.ts` → exit 1,
  log `task-3-red-1-wide.txt`:
  ```
  Error: Cannot find module '../../src/core/defs/wide' imported from
  D:/Documents/turing-complete/.worktrees/phase1/test/core/defs-wide.test.ts
   Test Files  1 failed (1)
        Tests  no tests
  ```
  Expected: the tests were written against the API the task specifies before any of it
  existed, so nothing could pass by accident. (The file held 46 cases then; a 47th,
  the `params.width`-on-a-splitter boundary case, was added during self-review and is covered
  by the GREEN logs.)
* **RED 2** — `PNPM test test/core/net.test.ts` → exit 1, log `task-3-red-2-net.txt`:
  ```
  FAIL > compile > rejects a malformed params.width (4097) as a validation issue
  AssertionError: expected undefined to be an instance of CircuitValidationError
  FAIL > compile > rejects a malformed params.width (9007199254740991) as a validation issue
  AssertionError: expected RangeError: Invalid typed array length: 1… to be an instance of
                  CircuitValidationError
   Test Files  1 failed (1)
        Tests  2 failed | 36 passed (38)
  ```
  Expected: the old guard was one-sided, so `4097` compiled without complaint and
  `MAX_SAFE_INTEGER` let the allocation's `RangeError` escape `compile` — the escape the cap
  has to close.
* **Interim full run** — `PNPM test` → exit 1, log `task-3-full-1.txt`: exactly one failure,
  `registry.test.ts > declares 1-bit pins everywhere` (`and8.a: expected 8 to be 1`), which is
  the phase-0 invariant the wide family intentionally breaks. Fixed by scoping that test
  (§5.5), not by weakening it for the phase-0 defs.
* **GREEN (focused)** — `task-3-green-focused.txt`: 3 files, 109 tests passed, exit 0.
* **GREEN (full)** — `task-3-green-full.txt`: 16 files, 315 tests passed, exit 0.
* **GREEN (static + browser)** — `task-3-tsc.txt` (exit 0, 0 diagnostics), `task-3-build.txt`
  (exit 0, 32 modules, `dist/assets/index-DL7UemDA.js` 50.08 kB), `task-3-smoke.txt`
  (exit 0, playwright 2 passed).

Log paths (all in `.superpowers/sdd/2026-09-25-turing-complete-phase1/`):
`task-3-red-1-wide.txt`, `task-3-red-2-net.txt`, `task-3-full-1.txt`,
`task-3-green-focused.txt`, `task-3-green-full.txt`, `task-3-tsc.txt`, `task-3-build.txt`,
`task-3-smoke.txt`, `task-3-commands.txt` (command + exit code + log index),
`task-3-commit-msg.txt`.

---

## 7. Self-review findings

1. **Three type errors, caught by `tsc` before the commit.** `bitwise1`/`bitwise2` passed
   `i[0]` (type `PortValue | undefined`) to the `number`-only masking helper; the def wrappers
   now go through `toUint`, which is the function that exists for reading a pin. Fixed; the
   re-run log has 0 diagnostics. (The first `tsc` log kept the failing output — see 7.5.)
2. **Two wrong test expectations, not code bugs.** `add8(a, neg8(a))` has `cout = 1` for every
   `a != 0` (the two's-complement inverse makes the sum exactly 256), and `rot_l8(a, 255)` is a
   rotation by 7 (`255 % 8`), not the identity. Both were corrected against the reference
   formulas the rest of the file already uses — the implementation was right, my hand-written
   expectation was not. Called out because "fix the test until it passes" is the failure mode
   this note is meant to rule out: no assertion was loosened, and the two cases still assert
   the exact values.
3. **A missing boundary test, added.** Nothing pinned what `params.width` actually does on a
   splitter, which is the question ruling 4 turns on. Added §3's test (all pins widen; bit 0
   still carries the bit) so the documented rule fails loudly if `net.ts` ever changes.
4. **Test-helper cleanup.** The kernel-integration helper built two registries per call
   (`compile(g, createRegistry(BASE_DEFS))` and the same again for the `Simulation`); it now
   uses the file's one registry.
5. **A stale log artifact, found and fixed.** `... | Tee-Object -FilePath` does not truncate
   the file when the command produces no output, so the first (failing) `tsc` diagnostics
   stayed in `task-3-tsc.txt` after the fix and would have looked like an unresolved error.
   The log was rewritten from a fresh run with the command and exit code as a header, and
   `task-3-commands.txt` now indexes every command, exit code and log — which is precisely the
   gap Task 2's reviewer hit.
6. **Comments corrected** during review: "would build a million-pin splitter" → a billion
   (1e9), and a comment claiming "the two comparisons" are the only signed reading, when there
   are three compare defs and only `less_s` reads a sign.
7. **Boundary re-checked by hand:** `neg8(0) = 0`, `ashr8(0x80, 8) = 0xff` vs
   `shift_r8(0x80, 8) = 0`, `rot_*` at 8/16/24 as identity, `mul8(16,16) = 0`,
   `div8(x, 0) = 0xff`, `splitter`/`maker` round trip for all 256, and no operator path can
   return a negative number (all results pass through the `& mask` + `>>> 0` helper).

---

## 8. Concerns for the controller

1. **`const8`'s value (0xff) is a decision, not a contract.** If chapter 2's level author
   wants a zero constant, it is one line (`CONST_VALUE`) and one test value.
2. **`splitter`/`maker` cannot be re-counted per instance with today's kernel.** The count is
   the def factory's parameter; a 4-bit splitter is `b0..b3` of the registered 8-bit one. If
   per-instance counts are wanted, `net.ts` needs a def-level hook and that is another task's
   file — I did not touch it.
3. **`cost = 1` for every wide operator** because `delayOf` charges `def.cost` per node.
   Chapter-2 three-star targets must be written against that, and the spec's NAND-equivalent
   gate metric stays unavailable until `expand()` exists.
4. **Phase 5 naming.** `createWideDefs(w)` suffixes the suffixed operators only;
   `less_s`/`less_u`/`splitter`/`maker`/`switch` keep their bare ids at every width. Whoever
   opens 16/32/64 should decide their spelling before registering them.
5. **`MAX_PARAM_WIDTH = 4096` is policy,** not a kernel limit: high enough for any pin the
   game ships and low enough to keep the signal table small. It is defined once in `graph.ts`
   and quoted in the issue message, so raising it is a one-line change with one test row.
6. **Two files outside the task's file list were touched, both deliberately:**
   `test/core/net.test.ts` (two rows on the existing `invalid-params` case — the only place the
   RangeError escape is observable) and nothing else; `src/core/registry.ts` was *not* needed,
   since `'wide'` was already in the category union.

---
---

# Fix round 1 (Task 3 review) — DONE

**Commit:** `0ebb7bc` — `fix(core): count NAND equivalents in the gate metric, not the delay cost`
(7 files, +668 / −42), parent `a57908a`, branch `phase1`, worktree
`D:\Documents\turing-complete\.worktrees\phase1`.

**Files changed (all of them in the round's file list):** `src/core/registry.ts`,
`src/core/defs/wide.ts`, `src/core/defs/index.ts`, `src/levels/grader.ts`,
`test/core/defs-wide.test.ts`, `test/core/registry.test.ts`, `test/levels/grader.test.ts`.
`src/core/net.ts`, `src/ui/`, `src/app/` and `src/levels/content/` are untouched
(`git show --stat 0ebb7bc`).

**Verification (all exit 0 unless noted):** focused 3 files / 115 tests passed; full suite
16 files / **347 tests passed** (315 before this round: +32); `tsc --noEmit` 0 diagnostics;
`pnpm build` 32 modules, `dist/assets/index-C52OAPSl.js` 50.61 kB; `pnpm smoke` 2 passed
(the browser check re-run anyway, since it is cheap and it rebuilds first). Commands, exit codes
and log index: `task-3-fix-commands.txt`. Raw logs: `task-3-fix-green-focused.txt`,
`task-3-fix-green-full.txt`, `task-3-fix-tsc.txt`, `task-3-fix-build.txt`, `task-3-fix-smoke.txt`,
`task-3-fix-red-mutation.txt`, `task-3-fix-baseline.txt`, `task-3-fix-commit-msg.txt`.

## F1. Finding 1: the two metrics are now two fields

**Mechanism chosen: the field you proposed first — an optional `gateCost?: number` on
`ComponentDef`, defaulting to `cost`.** I did not take the alternative (`nandEquivalent` lookup
table outside `registry.ts`) because the count belongs to the def that owns the semantics: a
table keyed by id would be a second list that can drift from `WIDE_DEF_IDS`, and
`createWideDefs(w)` already has to scale the numbers with `w`, which a static table cannot do
without becoming a function of the id anyway.

The observable contract, exactly as specified:

| quantity | field | who reads it | wide part |
|---|---|---|---|
| delay | `cost` | `delayOf` (`net.ts:616`), one charge per node | **1** |
| gates | `gateCost ?? cost` | `gateCost()` (`levels/grader.ts:33`) | NAND equivalents |
| phase 0 | neither states `gateCost` | fallback `cost` | 1 for a 1-bit gate, 0 for a source |

* `registry.ts`: `cost` is re-documented as the DELAY unit (spec §3.2) and `gateCost` added as
  the NAND-equivalent GATE count (spec §5.4), with "absent means `cost`" stated in the field's
  doc comment. This is the only interface change.
* `grader.ts`: `total += def.gateCost ?? def.cost;` — the loop now reads the field through a
  local `def` instead of calling `registry.get` inline. Nothing else in the file moved.
* `defs/index.ts`: one comment on the phase-0 `gate()` factory recording *why* those defs state
  no `gateCost` (their two numbers are equal, and stating one would move a chapter-1 score) and
  one on the wide spread noting these are the defs that do.
* `wide.ts`: `cost` is still 1 for every operator, 0 for `const8`, `splitter`, `maker` — no
  delay number changed. Every one of the 24 defs now states `gateCost` explicitly; none leans
  on the `?? cost` fallback, so the family's whole gate surface is in one file and one test
  pins all 24.

## F2. NAND equivalents, per operator, with the construction

The unit is one 2-input NAND (spec §5.4). The 1-bit basis, each with its standard all-NAND
cell written out in `wide.ts`: `NAND 1`, `NOT 1` (`NAND(a,a)`), `AND 2` (NAND → NOT),
`OR 3` (¬a, ¬b, NAND), `NOR 4` (AND of the negations), `XOR 4` (the classic four-NAND cell),
`XNOR 5` (XOR → NOT), `MUX2 4` (¬s, NAND(a,¬s), NAND(b,s), NAND of those), `FULL_ADDER 9`
(the 9-NAND sum+carry cell, derivation in the source comment).

| def(s) | construction | 8-bit count |
|---|---|---|
| `and8` | 8 × AND | 16 |
| `or8` | 8 × OR | 24 |
| `nand8` | 8 × NAND | **8** |
| `nor8` | 8 × NOR | 32 |
| `xor8` | 8 × XOR | 32 |
| `xnor8` | 8 × XNOR | 40 |
| `not8` | 8 × NOT | 8 |
| `add8` | 8 × FULL_ADDER (`cin`/`cout` are the adder's own) | 72 |
| `neg8` | NOT8 + add8 with `cin` tied high (a rail, not a gate) | 80 |
| `less_u` | subtract = NOT b + add, then NOT of `cout` (read the borrow) | 81 |
| `less_s` | `less_u` + XOR of the sign bits (4) + one sign-fix 2:1 mux (4) | 89 |
| `equal8` | 8 × XNOR into a 7-gate AND tree — the XOR/OR/NOT mirror also totals 54 | 54 |
| `shift_l8`, `shift_r8` | barrel (24 muxes, 96) + over-shift logic: OR-reduce amount[7:3] (12) + NOT (1) + 8 ANDs (16) | 125 |
| `ashr8` | barrel (96) + OR-reduce amount[7:3] (12) + 8 sign-fill muxes (32) | 140 |
| `rot_l8`, `rot_r8` | barrel alone: acting on the low 3 amount bits *is* `amount % 8` | 96 |
| `mul8` | 8 × (AND8 partial product + add8 accumulation) = 8 × 88 | 704 |
| `div8` | restoring division: 8 × (NOT b + add + 8-wide restore mux) = 8 × 112, plus the divide-by-zero rule (zero-detect 22 + a final 8-wide pass onto all ones 32) | 950 |
| `const8` | a rail | 0 |
| `splitter`, `maker` | wires | 0 |
| `switch` | one AND (`a AND on`, which is exactly the decided pass/force-zero) | 2 |
| `switch8` | 8 × AND | 16 |

Every count is written in the source as the composition (e.g. `w * XNOR + (w - 1) * AND`,
`barrelNand(w) + overShiftNand(w) + NOT + w * AND`), not as a magic literal, so the arithmetic
and the doc comment cannot drift apart silently. The generator scales them with the width it is
asked for (`and4` 8, `add4` 36, `rot_l16` 256 …), and a test pins three widths.

### Where I deviated from your list, and why

* **`shift_*` / `rot_*` are NOT `8 × mux2`.** Your list gave 8 × mux2; I used a barrel shifter
  — `ceil(log2 w)` stages × `w` muxes, i.e. **24** muxes at `w = 8`. Reason: these operators'
  `amount` pin is 8 bits wide and their declared behaviour covers 0…255 (0…7 shift, `>= 8` is 0
  for the shifts, `amount % 8` for the rotates). Eight muxes is a *conditional shift by one* —
  it cannot produce `shift_l8(1, 7) = 0x80`, so as a NAND-equivalent count for the function the
  def actually implements it understates by ~4×. The barrel also makes the corner rules fall
  out naturally: the rotator needs no extra logic at all (mod-8 is structural), while the two
  logical shifts need the `amount >= 8 -> 0` gate and `ashr8` needs the sign-fill select —
  each of those is counted separately above rather than hidden in a round number. If you would
  rather have the rounder number for level-authoring purposes, it is one expression per def to
  change; say so and I will, but I did not want to publish a count I could not derive.
* **`div8` had no count in your list.** I chose restoring long division (`950`) and wrote the
  construction out; the alternative (non-restoring) lands in the same range.
* `mul8` is yours (`8 × (add8 + AND8)`); `add8`, `neg8`, the bitwise family, `equal8`,
  `less_u`/`less_s`, `switch`, `switch8`, `const8`, `splitter`/`maker` follow your list.
* `less_s`/`equal8` were only specified as "from gates + a reduction", so both constructions are
  written out in the source comments.

### What I am NOT claiming

These are **counts of documented constructions, not proven minima.** The two I would least
defend as tight are `mul8` (704 — a shift-and-add array; a Booth or Wallace tree is cheaper)
and `div8` (950 — restoring division; SRT is cheaper). `shift_*`/`ashr8` fold their corner-case
logic into the count rather than treating it as free. Every one of those choices is written in
the source with its arithmetic; nothing is a number with no derivation, which was the standard
you set.

## F3. The test that fails if the two fields are re-conflated

`test/levels/grader.test.ts` → `gateCost > separates the gate metric from the delay metric on a
wide part`: one `and8` between two 8-bit level inputs and a level output, asserting
`def.cost === 1`, `def.gateCost === 16`, `delayOf(...) === 1`, `gateCost(...) === def.gateCost`,
`=== 16`, and `> 1`.

**Mutation evidence (RED on purpose), `task-3-fix-red-mutation.txt`:** reverting the one line in
`grader.ts` to `total += def.cost;` makes exactly two tests fail —

```
FAIL  test/levels/grader.test.ts > gateCost > reads gateCost when a def states it and cost when it does not
AssertionError: expected 2 to be 5
FAIL  test/levels/grader.test.ts > gateCost > separates the gate metric from the delay metric on a wide part
AssertionError: expected 1 to be 16
 Test Files  1 failed | 1 passed (2)
      Tests  2 failed | 88 passed (90)
```

`grader.ts` was restored from a backup immediately after that run; the committed file is
`total += def.gateCost ?? def.cost;`. Note that the twelve phase-0 assertions stayed green under
the mutation — they are a *no-change* guard, and the conflation guard is the pair above. Two
different jobs, two different tests.

The inverse direction (charging `gateCost` into `cost`) is covered from three sides: the
`and8` test's `delayOf === 1`, the defs-wide "keeps the DELAY cost at one unit per operator"
test, and the phase-0 freeze.

**A test bug I hit and fixed, disclosed:** the first focused run failed
`composes each count out of the others` with `expected 140 to be 124`. The source was right
(`ashr8` = 96 + 12 + 8 × **4** = 140) and my new identity was wrong — I had reused
`gate('switch8')` (8 × AND = 16) as a stand-in for eight *muxes* (8 × 4 = 32). The identity now
reads `rot_l8 + 12 + 8 * 4` with the "at 4 NANDs" comment. No implementation number changed as
a result of that failure.

## F4. Phase-0 regression: twelve reference solutions, literal numbers

`test/levels/grader.test.ts` → `phase-0 regression: the chapter-1 reference scores do not move`
(25 cases): a coverage case (12 levels, same ids in both tables), then per level
`grades to its frozen metrics and score` and `still meets every three-star target`.

The numbers were **captured from the pre-change tree (commit `a57908a`)** by a temporary
print test *before* any source edit; its output is `task-3-fix-baseline.txt`, and the temp file
was deleted before the commit. They are asserted as literals — and the score is additionally
checked against `scoreOf(frozen.metrics)`, so a typo in either literal cannot pass:

| level | gate | delay | tick | score | threeStar |
|---|---|---|---|---|---|
| ch1-01-crude-awakening | 0 | 0 | 0 | 0 | 0/0/0 |
| ch1-02-nand-gate | 1 | 1 | 0 | 5 | 1/1/0 |
| ch1-03-not-gate | 1 | 1 | 0 | 5 | 1/1/0 |
| ch1-04-and-gate | 2 | 2 | 0 | 10 | 2/2/0 |
| ch1-05-or-gate | 3 | 2 | 0 | 11 | 3/2/0 |
| ch1-06-nor-gate | 2 | 2 | 0 | 10 | 2/2/0 |
| ch1-07-always-on | 0 | 0 | 0 | 0 | 0/0/0 |
| ch1-08-second-tick | 0 | 0 | 3 | 24 | 0/0/3 |
| ch1-09-xor-gate | 4 | 3 | 0 | 16 | 4/3/0 |
| ch1-10-bigger-or-gate | 2 | 2 | 0 | 10 | 2/2/0 |
| ch1-11-bigger-and-gate | 2 | 2 | 0 | 10 | 2/2/0 |
| ch1-12-binary-racer | 0 | 0 | 0 | 0 | 0/0/0 |

All twelve pass with `failures: []`, `passed: true`, `stars: 3`, and each `threeStar` bound is
compared directly (`metrics.gate <= target.gate` etc.), not merely implied by the star count.
Any movement here is a finding against the change, and the test says so in its own doc comment.

**Scope note on the fixtures:** the twelve circuits are restated in `grader.test.ts` rather than
imported, because `ch1-part1.test.ts` / `ch1-part2.test.ts` keep their `solutions` local and
those files are outside this round's file list (their own assertion is "passes with three
stars", which a metric change can leave intact). The duplication is deliberate and commented;
the two definitions are the same declarations, and the frozen numbers came from the pre-change
run of exactly these circuits.

## F5. The two ratifications

* **`const8` = `0xff` — kept as implemented.** `CONST_VALUE`, the module-constant comment, the
  `io` category and the value test are unchanged.
* **`splitter`/`maker` count is a def-factory parameter — kept, limitation RECORDED not
  solved.** `wide.ts`'s module header now carries a paragraph headed **RECORDED LIMITATION (not
  solved here)**: *the project has no way to instantiate `splitter`/`maker` at a non-8 pin
  count* — the registered instances are 8-wide, `params.width` cannot re-count pins, and
  per-instance counts would need a def-level hook in `net.ts` (`def.expand(params)`), which is
  not this task's file. It is recorded as a constraint with its workaround (`b0..b3` for a 4-bit
  level), not presented as a feature. The Task-2 boundary test that pins what `params.width`
  actually does is untouched and still green.

## F6. Tests I ran, the exact commands, and their output

`pnpm` is not on PATH in this session, so every command is the bundled
`node.exe` + `pnpm.mjs` pair; `<NODE> <PNPM>` below stands for

```
& "C:\Users\ME\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe" `
  "C:\Users\ME\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\pnpm\bin\pnpm.mjs"
```

1. **Baseline capture, PRE-FIX** — `<NODE> <PNPM> test test/levels/zz-baseline-capture.test.ts`
   → exit 0, 1 file / 1 test passed; the `===BASELINE===` block in `task-3-fix-baseline.txt` is
   the source of every number in F4.
2. **Focused, post-fix** —
   `<NODE> <PNPM> test test/core/defs-wide.test.ts test/core/registry.test.ts test/levels/grader.test.ts`
   → exit 0, log `task-3-fix-green-focused.txt`:

   ```
    ✓ test/core/registry.test.ts (25 tests) 13ms
    ✓ test/levels/grader.test.ts (39 tests) 17ms
    ✓ test/core/defs-wide.test.ts (51 tests) 51ms
    Test Files  3 passed (3)
         Tests  115 passed (115)
   ```
3. **Mutation RED (on purpose)** — see F3; exit 1, log `task-3-fix-red-mutation.txt`.
4. **Full suite** — `<NODE> <PNPM> test` → exit 0, log `task-3-fix-green-full.txt`:

   ```
    Test Files  16 passed (16)
         Tests  347 passed (347)
   ```
   (Was 315 / 16 before this round. The +32 are: 4 new defs-wide cases, 1 new registry case,
   27 new grader cases — 2 `gateCost` cases + 25 phase-0 freeze cases — and no existing
   assertion was loosened or deleted. Two existing cases were reshaped for accuracy:
   defs-wide's cost case is now explicitly the *delay* cost, and registry.test.ts gained the
   "phase 0 states no `gateCost`" invariant.)
5. **Types** — `<NODE> <PNPM> exec tsc --noEmit` → exit 0, log `task-3-fix-tsc.txt`
   (0 diagnostics; tsc prints nothing on success, so the log holds the command and `EXIT=0`).
6. **Build** — `<NODE> <PNPM> build` → exit 0, log `task-3-fix-build.txt`:

   ```
   $ tsc --noEmit && vite build
   ✓ 32 modules transformed.
   dist/assets/index-C52OAPSl.js   50.61 kB │ gzip: 18.79 kB
   ✓ built in 58ms
   ```
7. **Browser smoke** — `<NODE> <PNPM> smoke` → exit 0, log `task-3-fix-smoke.txt`:

   ```
   Running 2 tests using 1 worker
     ok 1 test\smoke\ui.spec.ts:41:1 › level 1 is playable end to end and shows its epilogue (598ms)
     ok 2 test\smoke\ui.spec.ts:64:1 › progress survives a reload and unlocks the next level (641ms)
     2 passed (5.0s)
   ```
   Nothing in this round touches `src/ui/` or `src/app/`, so this is a "did not break the app"
   check rather than coverage of the amendment; it also rebuilds via the project's own webServer
   command, which is a second, independent confirmation of step 6.

## F7. Notes for the re-reviewer

1. **The line to look at is one line**: `src/levels/grader.ts` — `total += def.gateCost ?? def.cost;`.
   Everything else is the numbers and the proof that they do not disturb phase 0.
2. **`cost` is untouched for the whole wide family** (`cost: 1` per operator, 0 for `const8`,
   `splitter`, `maker`), so `delayOf` output for any circuit — phase 0 or wide — is
   bit-for-bit what it was at `a57908a`.
3. **Phase-0 defs state no `gateCost`**, and `test/core/registry.test.ts` now fails if one ever
   does. That is the mechanism that keeps the twelve chapter-1 scores frozen; the freeze test in
   `grader.test.ts` is the tripwire if it is bypassed.
4. **The worktree's `.superpowers/sdd/.../progress.md` is left modified and uncommitted on
   purpose** — it is the controller's ledger (it records this round's ruling and the two
   ratifications) and per the BASE convention it is the controller's to commit, not the
   implementer's. My commit contains the 7 source/test files and nothing else.
5. **No subagents were dispatched** and no reviewer was spawned, per the round's instruction.
6. **The wide-family gate numbers are mine, not the original game's.** They are the documented
   constructions above; if Tasks 8–11 would rather author `threeStar.gate` targets against
   rounder numbers, the per-operator expressions in `createWideDefs` are the single place to
   change, and the defs-wide table is the single place the change would be pinned.

---
---

# Fix round 2 (Task 3 review) — DONE

**Commit:** `2027b75` — `fix(core): price the built-in 1-bit gates in NAND equivalents`
(9 files, +246 / −64), parent `0ebb7bc`, branch `phase1`, worktree
`D:\Documents\turing-complete\.worktrees\phase1`.

**Files changed (all nine are in the round's file list):** `src/core/defs/index.ts`,
`src/core/defs/wide.ts`, `src/core/registry.ts`, `src/levels/grader.ts`,
`src/levels/content/ch1/part1.ts`, `src/levels/content/ch1/part2.ts`,
`test/core/registry.test.ts`, `test/core/defs-wide.test.ts`, `test/levels/grader.test.ts`.
`src/core/net.ts`, `src/ui/`, `src/app/`, `src/levels/checks.ts` and the chapter-2 content
directory are untouched (`git show --stat 2027b75`). `test/levels/ch1-part1.test.ts` and
`ch1-part2.test.ts` were in scope but needed no edit: their assertion is
"the reference solution passes with three stars", and the recalibrated targets make that true
again — verified by running them, not by assuming it.

**Verification, all exit 0** (`task-3-fix2-commands.txt` indexes every command, exit code and
log): focused 5 files / **181 tests passed**; full suite 16 files / **350 tests passed**
(347 before this round); `tsc --noEmit` 0 diagnostics; `pnpm build` 32 modules,
`dist/assets/index-Lk4_vByB.js` 50.67 kB; `pnpm smoke` 2 passed. Two mutation runs below.

## G1. The finding, applied: `gateCost` on every built-in gate

The metric was still two units because the phase-0 `gate()` factory stated only `cost: 1`, so
`gateCost()`'s `?? def.cost` fallback priced a built-in `and` at 1 while one bit of `and8` cost
2 — under one "NAND equivalent" label. The metric changed; the documentation followed it.

**1. Every 1-bit gate now states its count, on the same basis `wide.ts` uses.** The factory's
new parameter is `gateCost`, and `defs/index.ts` carries the basis as a table plus a
per-call-site derivation:

| gate | `gateCost` | construction (as written in the source) | call site expression |
|---|---|---|---|
| `nand` | 1 | the unit | `NAND` |
| `not` | 1 | `NAND(a, a)` | `NOT` |
| `and` | 2 | `NAND(a, b) -> NOT` | `AND` |
| `or` | 3 | `NOT a, NOT b, NAND(~a, ~b)` (De Morgan) | `OR` |
| `nor` | 4 | `NOT(or)` = OR's three NANDs plus one inverter | `OR + NOT` |
| `xor` | 4 | the classic four-NAND cell | `XOR` |
| `xnor` | 5 | `NOT(xor)` | `XOR + NOT` |
| `and3` | 4 | `AND(a, b)` (2), then `AND(ab, c)` (2) | `2 * AND` |
| `or3` | 6 | `NOT a, NOT b, NOT c`, then a 3-input NAND (itself 3) | `2 * OR` |

Two notes on the derivation, per your "the derivation is the deliverable" instruction:

* **`and3` = 4 — same number as yours, different reason.** "Two ANDs *sharing* one NOT" would
  be 3, and sharing is not available here: the second AND's inverter sees `NAND(ab, c)`, not
  `NAND(a, b)`. So the construction I documented is the two-AND cascade (2 + 2). It is also
  minimal at 4, and I put that argument in the table: the last of three NANDs could only invert
  a product of two signals already in hand (two primary inputs, a primary input and an earlier
  NAND, or two earlier NANDs), and none of those products is `~(abc)` — few enough cases to
  check by hand, and 4 is also what the standard library's 3-input AND cell costs.
* **`or3` = 6 — same number as yours; both constructions agree.** `NOT a, NOT b, NOT c` plus a
  3-input NAND built from three 2-input NANDs is 6, and the two-OR cascade is also 3 + 3 = 6
  (no sharing, for the same reason as `and3`). The source comment says so, in the same spirit
  as `equal8`'s "both drawings give 54".

**2. `cost` stays 1 on all nine gates, so delay is unchanged.** `registry.test.ts`'s existing
"marks sources as zero cost and gates as one" case is untouched and still green; the freeze
table's delay column is byte-identical to `a57908a`, and every recalibrated measurement below
shows the same delay and tick numbers as before.

**3. The false doc claims are corrected, in all four places that carried one:**

* `defs/index.ts` — the `gate()` factory now documents the table and says plainly that `cost`
  is the delay unit and `gateCost` the NAND count, that the two coincide only for `nand`/`not`,
  and that an `and` worth one NAND equivalent *was the bug*.
* `registry.ts` — the `gateCost` field comment states the real rule: not "one per gate", the
  basis prices a 1-bit `and` at 2 and an `or` at 3, a wide part scales with its width, and
  "absent means `cost`" is for the defs that are **zero on both** metrics (a rail, a level
  connector, a wire-like packer, a storage element) — a real case, not a legacy default.
* `levels/grader.ts` — the same false claim lived here ("a NAND is one NAND equivalent, a
  source is zero"), so the `?? def.cost` fallback's doc comment was corrected too. **No
  mechanism change:** the body is still `total += def.gateCost ?? def.cost;`.
* `defs/index.ts`'s wide-family spread comment no longer says the wide defs are "the defs that
  DO state `gateCost`".

**4. `ashr8`'s sign fill is now documented as a ratified exclusion.** The
`shiftRightArithmeticOp` comment says, in terms, that the operator is DELIBERATELY EXCLUDED
from the "`shift_*` with `amount >= w` gives 0" rule because that rule is the logical shifts'
edge behaviour, that filling with the sign bit is what keeps `ashr8` from being a second
`shift_r8`, and "ratified behaviour, not an oversight. Do not 'fix' this to 0."
`shiftRightOp`'s own comment points at it, so a reader who lands on the logical shift first is
not left with the wrong rule. **Behaviour unchanged** (`defs-wide.test.ts`'s sign-fill cases
are untouched and green).

**5. The minor you ratified:** `wide.ts`'s "**Exact** for the widths the game registers" is now
"**Documented** for the widths the game registers", matching the same file's "documented
constructions, not proven minima" framing and the report's §"What I am NOT claiming".

## G2. The recalibration: three targets, all raised, measured not guessed

Re-measured all twelve chapter-1 reference solutions with a temporary print fixture **before**
touching any level data (`task-3-fix2-measure-before.txt`, deleted before the commit). Exactly
the three you predicted moved, and **every move is up — nothing had to move down, so there is
no `BLOCKED` case**:

| level | gate before → after | target before → after | delay | tick | why the reference moved |
|---|---|---|---|---|---|
| `ch1-06-nor-gate` | 2 → **4** | 2 → **4** | 2 (unchanged) | 0 | reference is `or` (3) + `not` (1) |
| `ch1-10-bigger-or-gate` | 2 → **6** | 2 → **6** | 2 (unchanged) | 0 | two cascaded `or`s |
| `ch1-11-bigger-and-gate` | 2 → **4** | 2 → **4** | 2 (unchanged) | 0 | two cascaded `and`s |

The other nine references are unchanged (0, 1, 1, 2, 3, 0, 0, 4, 0 — identical gate, delay and
tick to the pre-change capture). Each target was set to the measured reference value, which is
the phase-0 rule. `task-3-fix2-measure-after.txt` shows twelve `MEETS` and twelve `stars 3`.
**No chapter-1 `delay` or `tick` metric or target moved** — the freeze table's two columns are
the `a57908a` literals, and `measure-after` prints the same delay/tick as `measure-before` for
all twelve.

Scores follow the metrics and are updated in the same freeze table: `ch1-06` 10 → 12,
`ch1-10` 10 → 14, `ch1-11` 10 → 12.

## G3. The machine check the ruling asked for

`test/levels/grader.test.ts` → **`every shipped level: its reference solution meets its own
three-star bounds`** (13 cases). It walks the **shipped** level set, `LEVELS` / `LEVEL_ORDER`
from `src/levels/index.ts`, not the test file's own table:

* a coverage case asserting every shipped level has a reference circuit in this file (so a
  level that ships later cannot silently skip the check);
* one case per shipped level: grade the reference solution, assert it passes, then compare
  **each declared bound** (`gate`, `delay`, `tick`) directly, with both numbers in the failure
  message (`ch1-11-bigger-and-gate gate: reference 4 > target 2`), plus `stars === 3`.

This replaces the per-level "still meets every three-star target" cases round 1 added inside the
freeze describe — same intent, but keyed to the shipped set instead of the copy, and no test
was dropped without a replacement. The freeze describe keeps its own frozen-metrics cases, so
the two jobs stay separate: **the freeze says what the numbers are; this says they still satisfy
the levels they belong to.**

Two more tests pin the new metric surface:

* `test/core/registry.test.ts` → **`prices every 1-bit gate on the NAND-equivalent basis,
  explicitly`**: the nine literals above, plus `byCategory('logic1')` being exactly those nine
  (a tenth gate added without a count cannot slip past). The old round-1 case that *required*
  the phase-0 gates to state no `gateCost` is replaced by
  **`leaves gateCost to the ?? cost fallback only where both metrics are zero`**, which asserts
  the fallback's remaining users are the free parts.
* `test/core/defs-wide.test.ts` → **`prices each bit-sliced cell on the same NAND basis as the
  registered 1-bit gate`**: `and8 === 8 × and`, `or8 === 8 × or`, and the same for
  `nand8/nor8/xor8/xnor8/not8`. That is the anti-drift guard the finding is really about — it
  fails if either table is edited into a different basis.

## G4. Mutation evidence (both RED on purpose, both reverted immediately)

**Mutation 1 — a built-in gate's `gateCost` removed** (`task-3-fix2-red-mutation-1.txt`, exit 1).
The factory stopped emitting `gateCost` for `and`, so it fell through to `?? cost` = 1 — the
pre-fix state for that gate. Three tests failed, from three independent directions:

```
FAIL test/levels/grader.test.ts > phase-0 regression > ch1-11-bigger-and-gate grades to its frozen metrics and score
AssertionError: expected { gate: 2, delay: 2, tick: +0 } to deeply equal { gate: 4, delay: 2, tick: +0 }
FAIL test/core/registry.test.ts > prices every 1-bit gate on the NAND-equivalent basis, explicitly
AssertionError: and: expected undefined to be 2
FAIL test/core/defs-wide.test.ts > prices each bit-sliced cell on the same NAND basis as the registered 1-bit gate
Error: no gateCost on the 1-bit gate and
 Test Files  3 failed | 2 passed (5)
      Tests  3 failed | 178 passed (181)
```

Worth noting for the reviewer: `ch1-part1.test.ts` / `ch1-part2.test.ts` stayed **green** under
this mutation. Their assertion is "passes with three stars", which a *lower* score satisfies —
exactly why the freeze literals and the cross-basis check carry this round's evidence.

**Mutation 2 — a recalibrated target reverted** (`task-3-fix2-red-mutation-2.txt`, exit 1).
`ch1-11`'s target put back to `gate: 2`, which its own reference (4) fails:

```
FAIL test/levels/grader.test.ts > every shipped level: its reference solution meets its own three-star bounds > ch1-11-bigger-and-gate meets every bound its level declares
AssertionError: ch1-11-bigger-and-gate gate: reference 4 > target 2: expected 4 to be less than or equal to 2
FAIL test/levels/ch1-part2.test.ts > reference solutions pass with three stars > ch1-11-bigger-and-gate
AssertionError: metrics={"gate":4,"delay":2,"tick":0}: expected 1 to be 3
```

The freeze test stayed green under mutation 2 — it pins measured values, not target
satisfaction. That is the gap the new shipped-set check closes, demonstrated rather than
asserted.

## G5. Tests I ran, the exact commands, and their output

`pnpm` is not on PATH in this session, so every command is the bundled `node.exe` + `pnpm.mjs`
pair; `<NODE> <PNPM>` stands for

```
& "C:\Users\ME\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe" `
  "C:\Users\ME\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\pnpm\bin\pnpm.mjs"
```

1. **Measurement, pre-recalibration** — `<NODE> <PNPM> test test/levels/zz-measure-ch1.test.ts`
   → exit 0, log `task-3-fix2-measure-before.txt`: the table quoted in G2, three `MISSES`.
2. **Measurement, post-recalibration** — same command → exit 0,
   `task-3-fix2-measure-after.txt`: twelve `MEETS`, twelve stars-3, delays and ticks unchanged.
   The temp file was deleted before the commit (`git status` clean apart from the controller's
   `progress.md`).
3. **Focused, post-fix** — `<NODE> <PNPM> test test/core/registry.test.ts
   test/core/defs-wide.test.ts test/levels/grader.test.ts test/levels/ch1-part1.test.ts
   test/levels/ch1-part2.test.ts` → exit 0, log `task-3-fix2-green-focused.txt`:

   ```
    ✓ test/core/registry.test.ts (26 tests) 16ms
    ✓ test/levels/ch1-part2.test.ts (29 tests) 15ms
    ✓ test/levels/ch1-part1.test.ts (34 tests) 16ms
    ✓ test/levels/grader.test.ts (40 tests) 23ms
    ✓ test/core/defs-wide.test.ts (52 tests) 61ms
    Test Files  5 passed (5)
         Tests  181 passed (181)
   ```
4. **Mutations 1 and 2** — see G4; logs `task-3-fix2-red-mutation-1.txt` (3 failed / 178
   passed) and `task-3-fix2-red-mutation-2.txt` (2 failed / 101 passed).
5. **Full suite** — `<NODE> <PNPM> test` → exit 0, log `task-3-fix2-green-full.txt`:

   ```
    Test Files  16 passed (16)
         Tests  350 passed (350)
   ```
   (347 before this round. The +3 are: 1 registry case net — one replaced by two — 1 defs-wide
   cross-basis case, and 1 grader case net — the 12 per-level target cases replaced by the 13
   shipped-set cases. No assertion was loosened; the two reshaped cases are named in G3.)
6. **Types** — `<NODE> <PNPM> exec tsc --noEmit` → exit 0, log `task-3-fix2-tsc.txt`
   (0 diagnostics; tsc prints nothing on success, so the log holds the command and `EXIT=0`).
7. **Build** — `<NODE> <PNPM> build` → exit 0, log `task-3-fix2-build.txt`:

   ```
   $ tsc --noEmit && vite build
   ✓ 32 modules transformed.
   dist/assets/index-Lk4_vByB.js   50.67 kB │ gzip: 18.84 kB
   ✓ built in 55ms
   ```
8. **Browser smoke** — `<NODE> <PNPM> smoke` → exit 0, log `task-3-fix2-smoke.txt`:
   `2 passed (4.9s)`. Nothing in this round touches `src/ui/` or `src/app/`; this is a "did not
   break the app" check that also rebuilds through the project's own webServer command.

Log paths (all in `.superpowers/sdd/2026-09-25-turing-complete-phase1/`):
`task-3-fix2-measure-before.txt`, `task-3-fix2-measure-after.txt`,
`task-3-fix2-green-focused.txt`, `task-3-fix2-red-mutation-1.txt`,
`task-3-fix2-red-mutation-2.txt`, `task-3-fix2-green-full.txt`, `task-3-fix2-tsc.txt`,
`task-3-fix2-build.txt`, `task-3-fix2-smoke.txt`, `task-3-fix2-commands.txt` (command + exit
code + log index), `task-3-fix2-commit.txt`, `task-3-fix2-commit-msg.txt`.

## G6. Deferred minors — confirmed untouched

The four you adjudicated "do not fix" are untouched and still recorded: `toUint`'s
`Uint8Array` branch (unexercised until phase 5's 16/32-bit defs), `makeOp`'s negative
intermediate at w = 32, the copied freeze-test circuits vs the part files' local `solutions`,
and the absent `grade()`-end-to-end-on-wide-parts test. Nothing in this round spent time on
them.

## G7. Notes for the re-reviewer

1. **The one-line mechanism is unchanged**: `levels/grader.ts` still reads
   `def.gateCost ?? def.cost`. This round changed *which defs state the field*, not how it is
   read — deliberately, so the fix is in the data (`defs/index.ts`) where the wrong numbers were.
2. **The nine numbers to check are in two places on purpose**: the table in `defs/index.ts` and
   the literals in `test/core/registry.test.ts`. Change one without the other and the test
   fails; that is the same two-places rule `defs-wide.test.ts` uses for the wide family.
3. **The delay metric is untouched** everywhere: `cost: 1` on all nine gates, unchanged on every
   wide def, and the freeze table's delay/tick columns are the `a57908a` literals.
4. **The `?? cost` fallback is not dead code** — it is now *only* the free parts (rails, level
   plumbing, packers, storage), and a test asserts exactly that. If a later def leans on it
   without being free, `registry.test.ts` fails.
5. **The worktree's `progress.md` is again left modified and uncommitted on purpose** — it is
   the controller's ledger, per the BASE convention; my commit contains the nine source/test
   files and nothing else.
6. **No subagents were dispatched** and no reviewer was spawned, per the round's instruction.
