# Task 1 report — 内核宽位端口正确性

Plan: `docs/superpowers/plans/2026-09-25-turing-complete-phase1.md` (Task 1, 核心难度 1+2)
Brief: `.superpowers/sdd/2026-09-25-turing-complete-phase1/task-1-brief.md`
Commit: `c4fb3ab` — `fix(core): read wide input pins per bit and give inputBase a coherent region`
Status: **DONE** (one design assumption worth a reviewer's eye: §6.1)

Worktree `.worktrees/phase1`, branch `phase1`, base `2a2cece`. Toolchain exactly as
instructed (nothing from PATH): node `C:\Users\ME\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe`,
pnpm `...\pnpm\bin\pnpm.mjs`.

## 1. What I implemented

Both kernel defects in `src/core/net.ts`. `src/core/signal.ts` is **untouched**: the gather
needs `drive`, which is netlist knowledge, not table knowledge, so no helper genuinely
belonged there. `src/levels/`, `src/ui/`, `src/app/` untouched (Task 2 owns them).

### 1.1 `Simulation.#readInputs` — per-bit gather (mandatory invariant 1)

New `Simulation.#gather(base, width)` assembles a pin one bit at a time:

```ts
if (slots[this.#drive[base + bit]!] === 1) out |= 1 << bit;   // width <= 8 → number
if (slots[this.#drive[base + bit]!] === 1) bytes[bit >> 3]! |= 1 << (bit & 7);  // > 8 → bytes
```

`#readInputs` now calls it per input pin. The number/bytes split mirrors
`SignalTable.getPort` exactly (`width <= 8` → `number`, else `Uint8Array` of
`ceil(width / 8)` bytes), so a def sees the same value form as before at every width.
No consecutive-slot read, no masking. `#gather`'s doc comment states why the old shape was
wrong (a narrower driver pulls in the slots allocated after it).

### 1.2 `Netlist.inputBase` — a coherent, fresh region (mandatory invariant 2)

`compile()` now, after `drive` is built, walks every input pin once and decides:

- `contiguousRun(drive, base, width)` returns the single driver base the pin's bits read from,
  or `-1`. The identity answer (`base`) counts: an unwired pin reads its own slots, and a
  driver at least as wide as the pin is one contiguous run.
- `run >= 0` → `inputBase` reports `run`. **Nothing is allocated**: the common case (unwired
  pin; equal-or-wider driver) aliases existing slots, exactly as the ruling requires.
- `run < 0` (driver narrower than the pin, so the tail falls back to the pin's own slots) →
  `table.alloc(width)` a region and record `ReadRegion { base, width, src }`; `inputBase`
  reports the region base. Per-byte/bit the region is a *full* copy of the pin's gathered
  value, so a bit with no driver is a defined 0 rather than leftover slot content.

`Simulation.#refreshReadRegions()` republishes every region with `setPort(region.base,
region.width, #gather(region.src, region.width))`, called on the success path of `settle()`
immediately before it returns. So `read(net.inputBase(key), pin.width)` is coherent
(one pin) and current (no extra call) for every caller. `read`/`write` signatures unchanged,
and the Jacobi sweep, `#holds`, `#staged` and `SETTLE_LIMIT` were not touched at all.

`capacityFor` now reserves headroom for regions (`+ Σ widths of driven input pins wider
than 1 bit`, the exact upper bound on what can be materialised) so the fixed-capacity table
still cannot overflow. The table still never grows.

### 1.3 Documentation changed in the same commit

Every comment that had become false or incomplete, since these encode hard-won lessons:

| Where | Change |
|---|---|
| `Netlist` header | "one slot per bit of every pin" → "+ a read region for the pins that need one" |
| `Netlist.slotCount` | now says it counts regions too |
| `Netlist.drive` | says it covers pin slots only; an unwired bit keeps its own slot (never written ⇒ 0); regions are not addressed through `drive` |
| `Netlist.inputBase` | rewritten: region semantics, *why* the driver's base is the wrong answer for a narrow driver, refreshed-by-`settle`, read-alias-only |
| identity-default comment in `compile()` | no longer claims `slotCount` equals pin bits; now explains that the identity tail is what makes an undriven bit read 0 |
| `capacityFor` | documents the region headroom bound |
| `compile()` | records that widths come from the def today and a later task resolves `params.width` — and that every width-dependent step goes through those values |
| `#readInputs` / `#gather` | why not `getPort(drive[base], width)` |
| `settle()` | regions are refreshed last, on success |

## 2. What I tested and the results

| Check | Command | Result |
|---|---|---|
| Baseline, focused | `pnpm test test/core/net.test.ts` | PASS — `19 passed (19)` |
| Baseline, full | `pnpm test` | PASS — 15 files, `239 passed (239)` (matches the ledger) |
| RED, focused | `pnpm test test/core/net.test.ts` (tests only, no impl change) | FAIL, exit 1 — `3 failed \| 22 passed (25)` (§3) |
| GREEN, focused | same command after the fix | PASS, exit 0 — `25 passed (25)` |
| Full suite, committed tree | `pnpm test` | PASS — 15 files, **`245 passed (245)`** (239 existing + 6 new; no existing test weakened or edited) |
| Typecheck | `pnpm exec tsc --noEmit` | PASS, exit 0 |
| Blob hygiene | `git cat-file -s` vs worktree size | committed blobs are LF (24,443 B = 25,038 B − 595 line-feet), so no line-ending churn; real diff is 358+/28− |

Six new tests in `test/core/net.test.ts` (module-level `feedDef(width)` / `passDef(width)`
factories plus a `narrowDriverFixture()`, so the kernel's wide-port contract is provable
without waiting for the real chapter-2 defs):

1. **`shows only the driving bit when a 1-bit output feeds an 8-bit input beside a live signal`**
   — the reproduction. Document order fixes the slots: `bit.in` 0, `bit.out` 1,
   `feed.out` 2..9, `wide.in` 10..17, `wide.out` 18..25, so the 1-bit driver is physically
   adjacent to seven live bits of a directly driven feed that toggles `0xff ⇄ 0x00`. The test
   asserts that adjacency itself (`expect(feed).toBe(outputBase('bit.out') + 1)`) so a future
   reallocation cannot silently turn the reproduction into a no-op. Out of an 8-bit
   pass-through the wide input must show exactly the driving bit.
2. **`takes only the low bit when an 8-bit output drives a 1-bit input`** — six values,
   asserts the pin sees `value & 1` and that `inputBase` is the driver's base (contiguous).
3. **`transfers every bit when an 8-bit output drives an 8-bit input`** — six values, both
   through the consumer and through `read(inputBase(...), 8)`.
4. **`hands back a read region that belongs to one pin and is fresh after settle`** — asserts
   the returned base is **not** the driver's base (the anti-pattern the ruling forbids), that
   the region is bit-0-only while the neighbouring feed is `0xff` and later `0x00` (no
   leakage), that a second `settle()` refreshes it to the new driver bit, and that it agrees
   with what the pin's own consumer saw.
5. **`zero-extends a narrower driver into a 12-bit input`** — covers the other `#gather`
   branch (byte arrays) and a `> 8`-bit region; bits 8..11 are 0, not neighbours.
6. **`materialises a region only for a pin whose driver is narrower`** — structural: equal
   widths ⇒ `slotCount === 24` (nothing allocated); narrow driver ⇒ `34`
   (26 pin bits + exactly one 8-bit region).

## 3. TDD evidence

### RED

Command: `pnpm test test/core/net.test.ts` (before touching `src/core/net.ts`)
Exit code: **1**

```
 ❯ test/core/net.test.ts (25 tests | 3 failed) 111ms
   ✓ Simulation (11)
   ❯ wide ports (6)
     × shows only the driving bit when a 1-bit output feeds an 8-bit input beside a live signal 5ms
     ✓ takes only the low bit when an 8-bit output drives a 1-bit input 0ms
     ✓ transfers every bit when an 8-bit output drives an 8-bit input 0ms
     × hands back a read region that belongs to one pin and is fresh after settle 1ms
     ✓ zero-extends a narrower driver into a 12-bit input 1ms
     × materialises a region only for a pin whose driver is narrower 1ms

⎯⎯⎯⎯ Failed Tests 3 ⎯⎯⎯⎯⎯⎯

 FAIL  test/core/net.test.ts > wide ports > shows only the driving bit when a 1-bit output
       feeds an 8-bit input beside a live signal
AssertionError: feed=255 bit=1: expected 255 to be 1 // Object.is equality

- Expected
+ Received

- 1
+ 255

 FAIL  test/core/net.test.ts > wide ports > hands back a read region that belongs to one pin
       and is fresh after settle
AssertionError: expected 1 not to be 1 // Object.is equality
 ❯ test/core/net.test.ts:429:22
    429|     expect(base).not.toBe(net.outputBase('bit.out'));

 FAIL  test/core/net.test.ts > wide ports > materialises a region only for a pin whose driver
       is narrower
AssertionError: expected 26 to be 34 // Object.is equality
```

Why each failure is the expected one, not an accident:

- `expected 255 to be 1`: the wide input must show the single driving bit; 255 is
  `bit | (feed's low 7 bits << 1)` — i.e. the old `getPort(drive[wide.in] = 1, 8)` read seven
  slots **that belong to another pin**. This is the silent corruption itself, and 255 is the
  proof it happens rather than a noisy throw.
- `expected 1 not to be 1`: `inputBase` returned the driver's slot (`1`), so a following
  `read(base, 8)` would read the neighbour — the second defect, exactly as the ruling states.
- `expected 26 to be 34`: no region was materialised at all (26 = pin bits only).

The other three new tests pass before the fix **by construction**, and I am recording that
plainly rather than dressing them up as reproductions: 8→1 and 8→8 were already correct
because the old read only misfires when the driver is *narrower* than the pin, and the 12-bit
case had zeroed slots happen to sit after the driver. They are guards for behaviour the fix
must not break (a 1-bit input must still take only bit 0; equal widths must stay a direct
alias, not become a copy).

Process note for honesty: my first RED run showed `ReferenceError: graph is not defined` in
three of the tests (a local variable was named `g`, not `graph`). That run is not the evidence
above; I fixed the typo, re-ran, and only then recorded RED. No production file had been
touched at that point.

### GREEN

Command: `pnpm test test/core/net.test.ts` (after the `net.ts` change)
Exit code: **0**

```
 ✓ test/core/net.test.ts (25 tests) 103ms

 Test Files  1 passed (1)
      Tests  25 passed (25)
```

Then, on the committed tree:

```
 ✓ test/core/net.test.ts (25 tests) 146ms
 Test Files  15 passed (15)
      Tests  245 passed (245)          # 239 baseline + 6 new
```

`pnpm exec tsc --noEmit` → exit 0.

## 4. Files changed

Commit `c4fb3ab`, 2 files, 358 insertions, 28 deletions:

```
src/core/net.ts       | 183 +++++++++++++++++-------
test/core/net.test.ts | 203 +++++++++++++++++++++++++++++++-
```

This report is not committed (`.superpowers/sdd/.gitignore`). `.superpowers/.../progress.md`
was already modified in the worktree by the controller before I started and is untouched by
my commit (I staged only the two files above).

## 5. Self-review findings

I read my own diff line by line and re-ran every command on the committed tree.

1. **`contiguousRun` cannot be fooled by an adjacent narrow driver.** For a driver narrower
   than the pin, bit `d` (the driver's width) maps to `base + d`, so contiguity requires
   `first == base`, i.e. identity — the unwired case. The fixture is exactly this hazard
   (driver at slot 1, pin at 10) and the test fails pre-fix, so the detection is exercised.
2. **Regions never alias a pin** (allocated strictly after every pin), and nothing maps *into*
   a region: `drive` entries are only ever written from `inst.outputs[...]` bases, so the
   refresh cannot feed back into the sweep.
3. **`drive` covers pin slots, regions do not.** Documented on the field; the array is built
   before regions are allocated, and `#gather` only indexes pin bases. No consumer iterates
   `drive.length` expecting table coverage (checked by grep).
4. **The capacity bound is an upper bound, not a guess.** A region is materialised only for a
   pin that (a) has width > 1 — width 1 always returns a run — and (b) has an incoming wire;
   `capacityFor` adds the full width of exactly that set. `validateGraph` has already rejected
   the error-severity issues that would make a wire unresolvable, so no path allocates past
   the reservation.
5. **Jacobi semantics preserved.** The refresh runs *after* the loop converges, outside the
   sweep; nothing about staging, `#holds`, `SETTLE_LIMIT` or `UnstableCircuitError` changed.
   The two-inverter-ring test still throws and the delay-line tests still pass.
6. **Stale-region window is closed for every in-repo reader.** `levels/checks.ts` is the only
   non-core reader of slots, and every read path there settles first (`runRow` → `settle`,
   the `script` path → `settle` then `tick`). Grep confirms no other `sim.read`/`sim.write`
   call sites outside core.
7. **`inputBase` error behaviour unchanged**: unknown keys still throw `no such input pin: …`
   from the same `baseOf` helper, which `bindLevelIo` relies on to try its key candidates.
8. **`slotCount` is no longer "pin bits"** — it is "slots allocated". The only assertions on it
   (`3`, `gates * 4`) are wire-free circuits where no region exists, so they hold unchanged;
   the doc now says so.
9. **Line endings:** the worktree is CRLF (host `core.autocrlf=true`); I verified the committed
   blobs are LF by byte size, so this commit does not introduce a whitespace-only rewrite.

## 6. Issues / concerns

### 6.1 Undriven bits of a *partially* driven pin read the pin's own slot (0 unless written)

This is the one judgement call. `#gather` reads `drive[base + bit]` literally, as the ruling
mandates; for a bit above a narrow driver that mapping is the identity, i.e. the pin's own
slot. Those slots are 0 in every path the kernel and the level layer take (the kernel writes
output pins only; `bindLevelIo` writes `outputBase("IN_x.out")`), and the region copy is a
*defined* 0 written on every refresh. The alternative — pointing those bits at a shared zero
slot — would need a driven-bit mask and would make a partially driven pin behave differently
from an unwired one, while the identity fallback is precisely what keeps an unwired input
directly writable (an existing test depends on that). Cost if the reading is wrong: a caller
that writes a partially driven pin's own raw slots would see that write reach the pin; no
in-repo caller does, and `inputBase` no longer hands out those slots for such a pin.

### 6.2 `inputBase` for a partially driven pin is a read alias, not a write target

Writing `write(inputBase(key), …)` on a region-backed pin now reaches the region, not the
kernel, and is overwritten at the next `settle`. Nothing in `src/` does this (level inputs are
driven through the `level_input` **output** slot), but it is a real sharp edge, so it is
documented on `inputBase` itself.

### 6.3 Hand-off to Task 2: two more width-dependent sites

Task 2 must resolve effective widths as `inst.params.width ?? def.pin.width` **and** route them
through the two sites this task added: the region-materialising loop in `compile()` and the
`capacityFor` region reservation, on top of the four the Task 2 brief lists (slot allocation,
`drive`, `#readInputs`, write-back). Missing either one yields a region sized for the def width
while the pin is a different width — the same silent-corruption class this task exists to
remove. `compile()`'s doc comment now names this explicitly.

### 6.4 Regions are refreshed only on the success path

If `settle()` throws `UnstableCircuitError`, regions keep their previous contents. Deliberate:
the values are meaningless in that state anyway, and `runChecks` records `'unstable'` without
reading outputs. The `settle()` comment says "on success" rather than implying otherwise.

### 6.5 Ledger suggestions (controller's file, not edited by me)

- Record the ruling that read regions are materialised in `compile()` and refreshed at the end
  of `settle()`, so the "no extra call needed" contract is a kernel guarantee rather than a
  convention.
- Note for Task 2's author the two extra width-dependent sites from §6.3.
