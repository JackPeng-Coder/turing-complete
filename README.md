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
- A **canvas wiring board**: place parts, drag wires, pan and zoom.
- **A live board**: every wire and pin shows the value it is carrying, the level's input bits are
  clickable so you can drive a half-built circuit and watch it work, and the clock can be stepped,
  run or reset.
- **Live truth-table checking** as you build.
- **Gate / delay / tick scoring**, with a three-star target for every level.
- **Progress saved to `localStorage`**, so a refresh keeps your stars.
- A **chapter map** for navigating levels and seeing what is unlocked.

Chapters 4–7 (programming and the assembly IDE, the LEG CPU, functions, the assembly challenges and
the sandbox) are planned but not built yet.

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

`pnpm <task>` is the portable form and the one to copy into CI or documentation; the `& $NODE $PNPM`
form is only the workaround for this machine.

### Smoke test prerequisites

The Playwright suite (`pnpm smoke`) needs two things the unit tests do not:

1. **A Chromium build, installed once:**
   `node node_modules\@playwright\test\cli.js install chromium`
2. **A build and preview server**, which Playwright starts itself on port 4173 (see the `webServer`
   block in `playwright.config.ts`). The config finds the Node binary and this host's bundled
   `pnpm.mjs` on its own — no environment variables are needed — and falls back to a real `pnpm`
   executable when the bundled script is not there. Set `NODE_BIN` / `PNPM_BIN` to override either one.

Screenshots are written under `test-results/`, which Playwright wipes at the start of every run.

## Project layout

```
src/
  core/     simulator: signals, component registry + definitions, graph/netlist, settle & tick
  levels/   LevelSpec types, checks, grader, and content/ (47 levels: chapters 1–3)
  app/      application state, command/undo stack, progress
  ui/       the board's chrome: top bar, palette, clock + I/O readout, tool grid, test cases,
            chapter map, and the Canvas board (see ui/board/)
  ui/board/ the board itself: camera and hit testing, wire routing, painting, live signals
  persist/  localStorage save and load
test/       Vitest unit/level tests and the Playwright smoke specs
```

## Contributing / scope

Phases 0–1 cover chapters 1–2 (38 of the plan's 82 levels). The full plan — 7 chapters, 82 levels, up to a working
CPU and assembly challenges — is in [`docs/superpowers/plans/`](docs/superpowers/plans/); the design
spec it follows is in [`docs/superpowers/specs/`](docs/superpowers/specs/).

The record of how it was built is committed too: each phase's ledger under
[`.superpowers/sdd/`](.superpowers/sdd/) carries every task's brief, its implementer's report, its
review verdicts, and each ruling the agent made on the owner's behalf, together with the test
evidence behind them. The session transcripts — the full conversation, including 68 subagent
traces — are archived in [`docs/session-archive/`](docs/session-archive/).

## License

MIT — see [LICENSE](LICENSE). Not affiliated with LevelHead; no original art, audio, or fonts are
included, and every line of the game's own copy is original. The research compendium committed at
the repository root is a separate third-party document and is not covered by that statement or by
this project's MIT license — see the note above. If you enjoy this, buy *Turing Complete* and
support the original.
