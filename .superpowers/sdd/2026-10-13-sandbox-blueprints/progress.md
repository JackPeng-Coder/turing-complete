# Sandbox + player-built components — build record

- Date: 2026-10-13
- Requested by the user as: 「把沙盒模式相关的功能先实现了先」 + 「蓝图是什么」 →
  after the explanation, 「并进这一期：先内核展开，再做编辑器」
- Approved plan: the `exit_plan_mode` payload of this session (S1–S5 below)
- Outcome: all five stages delivered, six commits, three gates green at the end.

## What was asked, and what was decided

| Question | The user's answer |
| --- | --- |
| Sandbox scope | 第一步：自由建造 + 全解锁 + 回路存档 + 电路文件导入导出 (no peripherals) |
| Palette scope | 正常模式 = 全部**基础**元件 ∪ 已解锁；开发者模式（`?dev=1`）= 全部 |
| Blueprints | 并进这一期：先内核展开，再做编辑器 |

Everything else in the plan was the Lead's call; the load-bearing ones are listed
under "Rulings" below, with the cost of being wrong.

## Commits

| # | SHA | Subject |
| --- | --- | --- |
| 1 | `74c56d5` | `docs(archive): add a transcript reader for the archived session` (clears the work left by the previous request) |
| 2 | `2825f98` | `feat(core): expand player-built components in the netlist and both metrics` |
| 3 | `60398d4` | `feat(levels): wrap a board selection into a reusable component` |
| 4 | `e827adc` | `feat(ui): wrap a selection from the toolbar and edit a component's body` |
| 5 | `7e30daa` | `feat(ui): add the sandbox screen and a circuit file to carry work out of it` |
| 6 | (this record) | `docs(sdd): record the sandbox and blueprint build` |

## The stages, and what each one cost

**S1/S2 — the kernel (`2825f98`).** `ComponentDef.body` carries a whole
`CustomComponentDef`; `flattenForCompile` walks a document into leaves keyed by
PATH (`i3/i1`); `compile` aliases a component's declared pins to the body pins
they bind; `gateCostOf` and `delayOf` walk the same flattening, so wrapping is
free on both metrics.

Three defects the work found, all in the "expensive if shipped" class:

1. **The wire loop resolved only the root graph.** A component's own wiring was
   never driven -- the first wrapped circuit compiled and computed nothing.
   Fixed by one pass per graph, addressed by compiled path.
2. **The boundary read `graph.customComponents`.** The definitions live in the
   library (`Progress.blueprints`), so a wrapped circuit's pins were unconnected.
   Fixed by reading the surface off `ComponentDef.body`.
3. **The capacity estimate counted leaves' reading regions twice.** Two
   `net.test.ts` cases caught it as a `RangeError` at compile.

**S3 — the wrap (`60398d4`).** `planWrap` derives the pin surface from the wires;
`applyWrap` writes both halves of the change. Two more defects, both found by
tests that simulate rather than inspect:

4. **The plan had the wire direction inverted for inputs**, so a wrapped circuit
   wired itself in a loop. Caught by the half-adder round trip.
5. **The new instance's id was minted from the shortened board**, re-issuing an id
   one of the moved instances still used inside the component. Caught by the same
   test after (4) was fixed.

**S3b — the editor (`e827adc`).** Toolbar button, draft panel with the derived
pins, 编辑内部 with a breadcrumb, rename, and a delete that refuses while the
board still uses the component. `CommandStack` learned to carry a library with a
command, because a wrap is one action that changes two things.

**S4 — the sandbox (`7e30daa`).** A `LevelSpec` with every challenge field empty,
`tc.sandbox.v1` written on change (by circuit signature, not per frame), and
`tc-circuit` import/export with the components inline and clashing ids renamed.

## Rulings (Lead's calls, with the cost if wrong)

| # | Ruling | Cost if wrong |
| --- | --- | --- |
| 1 | The sandbox is a `LevelSpec`, not a second screen (`levels/sandbox.ts`). | A second screen has to re-implement open/rebuild/measure/display and will drift; the cost of this ruling is a spec with a fake chapter number. |
| 2 | `?dev=1` reaches for the SANDBOX palette, which leaves `level_input`/`level_output` out. | Dev mode loses the level pins as draggable parts. Reversible in one line; the alternative (a special case for dev) keeps a second palette alive. |
| 3 | A player's component does NOT enter an ordinary level's palette. | A component built in the sandbox is not usable in chapter 1. A level's palette is the puzzle, so this is the intended reading, but it is the ruling most likely to be questioned. |
| 4 | The sandbox circuit is a SEPARATE storage key with no migration. | A future change to its shape reads as an empty board, not as a migrated one. The sandbox is scratch, so losing it is survivable -- unlike a star. |
| 5 | Import merges components by RENAMING the clashing ones (`bp1` → `bp1_2`) and repoints the circuit, instead of prompting. | The player may end up with two similarly named components and no prompt to merge them. Overwriting was the alternative and is not recoverable. |
| 6 | Delete refuses while the board uses the component, rather than cascading. | The player has to remove the instances by hand. Cascading would delete parts of a circuit the player did not point at. |
| 7 | Blueprints scope to one level's board, not added to the level's `allowedComponents`. | Same as (3). |

## Gates at the end

- `pnpm test` — **54 files / 1537 tests passed**
- `pnpm build` — `tsc --noEmit` clean, `vite build` 70 modules
- `pnpm smoke` — **24 passed** (two new cases: the saved component, the sandbox)

## Known gaps, reported to the user

- No sandbox-only parts (`wire_probe`, `mem_probe`, `program`, `rom`, `time`,
  `file_loader`, `network`) and no peripherals (screen, keyboard, sound). The
  board already paints every wire and pin live, so the probes are the least
  valuable of the ten; the peripherals are a phase of their own.
- Wide widths stay at 8 bits (`MAX_WIDE_WIDTH = 32`); 16/32/64 is still phase 5.
- Editing a component's body is one level deep: wrapping a selection inside a
  component is refused with a message rather than opening a second breadcrumb.
- A rename is by `prompt()`, which is the browser's own dialog rather than a
  styled field.
- The `?dev=1` palette no longer offers the level plumbing pins (ruling 2).
