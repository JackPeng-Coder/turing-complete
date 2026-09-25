# Turing Complete Replica (图灵完备 · 复刻版)

**This project is not affiliated with, endorsed by, or produced by LevelHead, and it is not an
official product.** It contains and distributes none of the original game's art, audio, text, or
fonts: every graphic is drawn procedurally and every line of copy is original. It is an independent
implementation for study and personal use, not for commercial distribution. The mechanics and the
teaching progression are a homage to LevelHead's *Turing Complete* — please support the original.

## What this is

A from-scratch, from-NAND-to-CPU educational puzzle game that reimplements the *learning path* of
LevelHead's *Turing Complete*: you start with one primitive gate and build your way up, gate by gate,
towards a working CPU.

## What works today (Phase 0)

- **Chapter 1 — 12 levels**, from the NAND gate to a 4-bit binary reader.
- A **canvas wiring board**: place parts, drag wires, pan and zoom.
- **Live truth-table checking** as you build.
- **Gate / delay / tick scoring**, with a three-star target for every level.
- **Progress saved to `localStorage`**, so a refresh keeps your stars.
- A **chapter map** for navigating levels and seeing what is unlocked.

Chapters 2–7 (arithmetic, memory, the OVERTURE and LEG CPUs, assembly) are planned but not built yet.

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
  levels/   LevelSpec types, checks, grader, and content/ (12 chapter-1 levels)
  app/      application state, command/undo stack, progress
  ui/       DOM shell + Canvas board, palette, truth table, chapter map
  persist/  localStorage save and load
test/       Vitest unit/level tests and the Playwright smoke specs
```

## Contributing / scope

Phase 0 covers chapter 1 only (12 levels). The full plan — 7 chapters, 82 levels, up to a working
CPU and assembly challenges — is in [`docs/superpowers/plans/`](docs/superpowers/plans/); the design
spec it follows is in [`docs/superpowers/specs/`](docs/superpowers/specs/).

## License

MIT — see [LICENSE](LICENSE). Not affiliated with LevelHead; no original art, audio, fonts, or text
are included. If you enjoy this, buy *Turing Complete* and support the original.
