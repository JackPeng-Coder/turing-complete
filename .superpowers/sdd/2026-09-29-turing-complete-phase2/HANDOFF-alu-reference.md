# HANDOFF — `test/fixtures/ch3-references.ts` (`aluReference`) is OWNED BY THE SUBAGENT

**Written at 18:27 by the Lead, to stop a collision.** The subagent for level 39
(`649bd4c9-b62c-4a63-ab4f-17c30b23351c`) raised a coordination alert: it and I were both
editing `aluReference()` in this file. It did the right thing and did not overwrite my work.

## The ruling

**The Lead has stopped editing the file. The subagent owns it and is applying its mux tree.**
Do not edit `aluReference()` in this file concurrently. If you are the subagent reading this:
finish, and ignore any stricter claim below about which file you may touch — the file is yours.

## Why the subagent's version wins

| | gates | delay |
|---|---|---|
| Lead's one-hot `switch8` + OR-fold | 445 | 8 |
| Subagent's mux tree | 273 (predicted) | 5 (predicted) |

Same function, materially cheaper on both scored metrics. The level's three-star target is the
reference's measured metrics, so a smaller correct reference is strictly better.

## The Lead's construction was WRONG, and the subagent found the reason

The Lead's `enable()` helper built `not(nand(nand(t0,t1),t2))` and called it a 3-input AND. It
is not: it computes `~(t0&t1) & t2`, which differs from `AND3` on **4 of 8 rows**. So the
enable for op code 0 was 0, every enable was 0 for pins 000, and the OR-fold published 0 for
`add`. The internal-node dump showed it directly (`eAdd=0` with all three pins 0) after two
rounds of the Lead misattributing the symptom to the operand-bit order.

Verified independently by the Lead, not taken on trust:

```
t0 t1 t2 | not(nand(nand(t0,t1),t2)) | AND3 | agree
0  0  1   |            1              |  0   | false
0  1  1   |            1              |  0   | false
1  0  1   |            1              |  0   | false
1  1  1   |            0              |  1   | false
```

## The contract the circuit must satisfy (pinned, do not re-derive)

    op = op0 + 2*op1 + 4*op2          # pin opN is bit N of the ISA operation field

| op | operation | result on 8-bit operands |
|---|---|---|
| 0 | add | `(a + b) & 0xff` |
| 1 | subtract | `(a - b) & 0xff` |
| 2 | AND | `a & b` |
| 3 | OR | `a \| b` |
| 4 | NAND | `~(a & b) & 0xff` |
| 5 | NOR | `~(a \| b) & 0xff` |
| 6, 7 | reserved | 0 |

Control routing for a mux-tree implementation, derived from the hardware rather than from the
pin names — this is the mapping the file got wrong repeatedly:

- **class mux** (`arithmetic` on `a`, `logic` on `b`): `sel = op2`
- **add/sub mux** AND the adder's `cin`: both driven by `op1`
- **AND/OR mux**: `sel = op0`
- **inversion mask** (`switch8(all-ones, on) -> xor8`): `on = op0`
- **reserved zeroing**: `op2 AND op1` (codes 6 and 7), applied to both mux halves

Sanity values, a=106 b=252: add=102 sub=110 AND=104 OR=254 NAND=151 NOR=1 codes 6/7=0.

## Do not touch

- `src/levels/content/ch3/batch1.ts` — `aluOp` is `switch (op & 7)` over the ISA table,
  verified against the registered `alu8` over all 524,288 `(op, a, b)` triples. Correct.
- `test/levels/ch3-batch1.test.ts` — the test "the level expectation agrees with the ALU this
  level rewards" compares `aluOp` against the registered `alu8` directly. Green, and
  mutation-checked (breaking `aluOp`'s `sub` case makes it fail on `op=1 a=0 b=1`).
- The level's `threeStar: { gate: 0, delay: 0, tick: 0 }` is a PLACEHOLDER. It must become the
  rebuilt circuit's measured metrics; the Lead will make that edit from the subagent's report.

## Probes to delete

Mine: `test/zzz-alu8.test.ts`, `test/zzz-struct.test.ts`, `test/zzz-nodes.test.ts`.
The subagent's: `test/zzz-alu-verify.test.ts` (and any `test/zzz-perm*.test.ts` if still
present). None of these should ship.
