# Turing Complete Replica (图灵完备 · 复刻版)

**This project is not affiliated with, endorsed by, or produced by LevelHead, and it is not an
official product.** None of the original game's art, audio, or fonts is included: every graphic is
drawn procedurally and every line of in-game copy is original. It is an independent implementation
for study and personal use, not for commercial distribution. The mechanics and the teaching
progression are a homage to LevelHead's *Turing Complete* — please support the original.

**One exception, and it is deliberate.** The repository also carries the user-supplied research
compendium (`GAME_REFERENCE.md`) that this replica was built from, plus the
structure extract derived from it under `.superpowers/research/`. That compendium is a third-party
document about the game and **does reproduce passages of the original's text**, including some
dialogue. It is committed as research provenance, not as content the game ships: nothing under
`src/` reads it, and the shipped game's own text remains entirely original. If you are looking for
what the *game* contains, see [chapter-2 level provenance](docs/research/chapter-2-level-provenance.md),
which records per level exactly which facts came from the source and which are this replica's own
design.

## What this is

A from-scratch, from-NAND-to-CPU educational puzzle game that reimplements the *learning path* of
LevelHead's *Turing Complete*: you start with one primitive gate and build your way up, gate by gate,
towards a working CPU.

## What works today (Phases 0–2)

- **Chapter 1 — 12 levels**, from the NAND gate to a 4-bit binary reader.
- **Chapter 2 — 26 levels (13–38)**: parity and counting, the byte operators, half and full
  adders, two's complement, decoders, a logic-engine capstone, and the storage half — switch,
  delay, clock source, selector, register, RAM and counter.
- **Chapter 3 — 9 levels (39–47)**: the ALU and the machine around it — registers and buses, the
  opcode decoder, the program counter and its RAM, and a capstone that runs an assembled program
  against the machine you built.
- A **canvas wiring board**: place parts, drag wires, pan and zoom. Wires are routed, not just drawn:
  a run is chosen against every part and every wire already on the board, so it goes *around* a gate
  rather than through it, and two nets never settle into the same lane and read as one wire.
- **A live board**: every wire and pin shows the value it is carrying, the level's input bits are
  clickable so you can drive a half-built circuit and watch it work, and the clock can be stepped,
  run or reset.
- **The level's test cases, laid out as a matrix** while you build: one row per pin, one column per
  case, expectations filled in and your own output unknown until you run them.
- **An on-demand test run.** Nothing grades your circuit while you are drawing it. Press 测试 and the
  board is driven through the level's cases one at a time -- the inputs change, the column lights up,
  the output takes its value -- at a speed you choose, and the verdict comes at the end. A level whose
  cases the checker generates privately (a program image) says so instead of inventing one.
- **Gate / delay / tick cost, measured live**, and a three-star target for every level. The cost is a
  measurement and updates as you edit; whether the circuit is *correct* is what the test run says.
- **Progress saved to `localStorage`**, so a refresh keeps your stars.
- A **chapter map** for navigating levels and seeing what is unlocked.

Chapters 4–7 (programming and the assembly IDE, the LEG CPU, functions, the assembly challenges and
the sandbox) are planned but not built yet.

## Interface

The chrome is styled as bench instrumentation, not as a page with cards on it: flat slabs separated
by 1px hairlines, **no shadows anywhere** — not one `box-shadow` or `text-shadow` in the stylesheet —
and no rounded corners except the bit arrows, whose roundness carries the value, and the result
medal, which is a stamped disc rather than a glowing orb. `test/conventions.test.ts` asserts both
halves of that — no shadow property anywhere, and no radius outside those two.

Two colour axes, kept apart on purpose:

- **On the board**, green is 1, red is 0, and blue is wider than one bit. That is the value rule
  stated in [`src/ui/theme.ts`](src/ui/theme.ts), and slate — never red — means nothing has been
  simulated yet.
- **On the chrome**, cyan is the instrument's voice (titles, labels, measured numbers) and magenta is
  the operator's hand: every control you can press. Magenta never appears on the board, so a value
  can never be mistaken for something clickable.

A scale of 1px ticks finishes the two edges where something is *measured* — the cost readout in the
top bar and the case matrix along the bottom — and appears nowhere else.

A part is marked the way a chip is: a short uppercase mnemonic (`NAND`, `MUX`, `ADD`) with its width
in a corner badge, so `and` and `and8` share a marking and the `8` tells them apart. The palette keeps
the Chinese name, because that is what you read when *choosing* a part; the tooltip carries the English
name and the board marking, which is where the two vocabularies meet.

A level connector is named by a badge and carries its **number**: the output's disc shows what it holds
and the input's arrow shows what it is driving, so the two ends of a level are one kind of part rather
than two.

The board's gestures:
| Gesture | What it does |
| --- | --- |
| Drag empty board, or drag with the middle button | Pan the view |
| Click empty board | Clear the selection |
| **Ctrl+drag** | Band-select every part the band touches |
| Right-click a part or a wire | Delete it — one undoable step |
| Click a palette slot | Arm that part: the slot stays lit and a translucent copy follows the pointer, on the grid, at the size and position it will land |
| Click the board while armed | Place a copy, and stay armed so you can stamp several |
| The ✕ in the palette's plate, or Esc | Put the part back down, which gives the plain drag back to the board |

## Running it

On any normal machine with Node and pnpm on `PATH`:

| Task | Command |
| --- | --- |
| Dev server (http://localhost:5173) | `pnpm dev` |
| Unit and level tests (Vitest) | `pnpm test` |
| Production build (`tsc --noEmit && vite build`) | `pnpm build` |
| Browser smoke test (Playwright) | `pnpm smoke` |

On **this** host the `pnpm` on `PATH` is a broken wrapper script, so the same four tasks are run by
handing the bundled `pnpm.mjs` to the bundled Node binary. These are the commands that actually work
here:

```powershell
$NODE = "C:\Users\ME\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"
$PNPM = "C:\Users\ME\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\pnpm\bin\pnpm.mjs"

& $NODE $PNPM dev     # dev server on http://localhost:5173
& $NODE $PNPM test    # Vitest, once
& $NODE $PNPM build   # tsc --noEmit && vite build -> dist/
& $NODE $PNPM smoke   # Playwright end-to-end smoke test
```

`pnpm <task>` is the portable form and the one to put in a script or a document; the `& $NODE $PNPM`
form is only the workaround for this machine.

`pnpm-workspace.yaml` exists for one reason and carries one thing: a `minimumReleaseAgeExclude`
list. This host's pnpm refuses packages published inside a supply-chain cutoff window, the four
pinned versions are younger than that window, and without the exemption a clean
`pnpm install --frozen-lockfile` fails with `ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION`. Every entry is
a devDependency; nothing is exempted on the runtime side, because there is nothing there to exempt.

### Smoke test prerequisites

The Playwright suite (`pnpm smoke`) needs two things the unit tests do not:

1. **A Chromium build, installed once:**
   `node node_modules\@playwright\test\cli.js install chromium`
2. **A build and preview server**, which Playwright starts itself on port 4173 (see the `webServer`
   block in `playwright.config.ts`). The config finds the Node binary and this host's bundled
   `pnpm.mjs` on its own — no environment variables are needed — and falls back to a real `pnpm`
   executable when the bundled script is not there. Set `NODE_BIN` / `PNPM_BIN` to override either one.

Screenshots are written under `test-results/`, which Playwright wipes at the start of every run.

### Developer mode

`?dev=1` opens every level from the chapter map and offers every part a level lists, so a level can be
opened and built without playing up to it. It opens exactly those two gates and nothing else: it never
writes progress, so no level is passed and no star is awarded on its account.

While it is on, the top bar carries an amber `DEV` light — a mode that unlocks the whole game has to be
impossible to forget — and clicking that light leaves the mode and cleans the URL, so a refresh does not
bring it back.

## Project layout

```
src/
  core/     simulator: signals, component registry + definitions, graph/netlist, settle & tick
  asm/      the assembler and its ISA: field ranges, addressing modes, operands, program images
  levels/   LevelSpec types, checks, grader, and content/ (47 levels: chapters 1–3)
  app/      application state, command/undo stack, progress, and the shared viewport types
  ui/       the board's chrome: top bar, palette, clock + I/O readout, tool grid, test cases,
            chapter map, and the Canvas board (see ui/board/)
  ui/board/ the board itself: camera and hit testing, wire routing, painting, live signals
  persist/  localStorage save and load
test/       Vitest unit and level tests, the convention assertions, and the Playwright smoke spec
tools/      the SDD PowerShell helpers that build a phase workspace and its briefs
docs/       the design spec, the phase plans, and the per-chapter level provenance
```

Dependencies run one way: `core` ← `asm` ← `levels` ← `app` ← `ui`, with `persist` reading `app` to
build an empty save. Nothing imports upwards, and `test/conventions.test.ts` fails the build if
anything starts to — that file is this project's linter, because no linter is pinned (see
`AGENTS.md` for why, along with the four rules that shape everything else).

## Contributing / scope

Phases 0–2 cover chapters 1–3 (47 of the plan's 82 levels). The full plan — 7 chapters, 82 levels, up to a working
CPU and assembly challenges — is in [`docs/superpowers/plans/`](docs/superpowers/plans/); the design
spec it follows is in [`docs/superpowers/specs/`](docs/superpowers/specs/).

The record of how it was built is committed too. [`.superpowers/sdd/`](.superpowers/sdd/) holds one
directory per phase: phases 0 and 1 carry every task's brief, its implementer's report, and the
review diffs behind each verdict — phase 0 is missing the briefs for tasks 9 and 11, which were
written before the workspace convention settled — and phase 2 carries the decision ledger and the
ALU handoff rather than per-task reports, because it ran as fewer and larger tasks. `tools/sdd/`
holds the three PowerShell helpers that resolve such a workspace, write a task brief, and stage a
review package.

`docs/session-archive/` used to hold the raw session transcripts behind those ledgers, 47 MB of
them. They were dropped from the working tree rather than carried forward; the commits that added
them still contain them, and `git log --all -- docs/session-archive` finds them.

## License

MIT — see [LICENSE](LICENSE). Not affiliated with LevelHead; no original art, audio, or fonts are
included, and every line of the game's own copy is original. The research compendium committed at
the repository root is a separate third-party document and is not covered by that statement or by
this project's MIT license — see the note above. If you enjoy this, buy *Turing Complete* and
support the original.
