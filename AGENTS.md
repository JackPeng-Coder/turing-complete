# AGENTS.md

Compact rules for working in this repo. The gate is below — read it before calling anything done.

## Hard rules (enforced by tests)

1. **No runtime dependencies.** `package.json` has no `dependencies` field: state, the undo stack, the renderer and the assembler are all hand-written. Every `devDependency` is pinned to an exact version (`^` / `~` are forbidden). `pnpm-workspace.yaml` carries a `minimumReleaseAgeExclude` list for four pinned dev deps — this host's pnpm rejects packages published inside a supply-chain cutoff window, so a clean `pnpm install --frozen-lockfile` fails without the exemption.
2. **Dependencies point one way.** `core` <- `asm` <- `levels` <- `flash`, with `app` beside `flash` (the exporter reads a circuit, not the application), `persist` reading `app`, and `agent` reading `app` through the `agent/host.ts` interface the composition root implements. The chrome imports `agent` and `flash`, never the reverse; `agent/` may not import `ui/`. Nothing imports upwards, runtime or type. `src/app/viewport.ts` exists only to keep the camera and point types in `app/`, where `AppState` holds them.
3. **Colour, spacing and geometry come from `src/ui/theme.ts`.** No literal colour in drawing code. On the board green is 1, red is 0, blue is wider than one bit, and slate — never red — means not simulated. On the chrome cyan is the instrument's voice and magenta is the operator's hand; magenta never appears on the board. No shadows anywhere; the only rounded corners are the bit arrows and the result medal.
4. **Commits:** English Conventional Commits, `type(scope): summary`. Scope is the area, not the file: `board`, `ui`, `levels`, `core`, `panel`, `docs`. One coherent change per commit, and never leave the tree failing the gate.

## The gate

All three run from the repository root; all must pass before a change is called done.

| Task | Command |
| --- | --- |
| Types and production bundle | `pnpm build` |
| Unit, level and convention tests | `pnpm test` |
| Browser smoke tests (builds and serves the bundle first) | `pnpm smoke` |

On this host `pnpm` on `PATH` is a broken wrapper. The portable form is `pnpm <task>`; the invocation that actually works here is:

```powershell
$NODE = "$env:USERPROFILE\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"
$PNPM = "$env:USERPROFILE\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\pnpm\bin\pnpm.mjs"
& $NODE $PNPM build
& $NODE $PNPM test
& $NODE $PNPM smoke
```

Focused runs:

- `pnpm test test/levels/campaign-shape.test.ts` — pass the path **without** `--`. `pnpm test -- <path>` silently ran the whole 78-file suite here.
- `pnpm smoke test/smoke/agent-live.spec.ts`, or `pnpm smoke -g "real model"`; `pnpm smoke --list <path>` enumerates.
- Smoke needs Chromium installed once: `node node_modules\@playwright\test\cli.js install chromium`. Playwright builds and previews on 4173 itself. Screenshots go to `test-results/` and are wiped each run. Two live-model tests skip unless `DEEPSEEK_API_KEY` is set.

## What fails the build, and where

- `test/conventions.test.ts` is this project's linter — there is deliberately no ESLint or Prettier. It fails on upward imports, a top-level source directory missing from the README layout block (or a claimed directory that does not exist), a runtime dependency, an imprecise devDependency pin, a CSS shadow or unlisted rounded corner, and duplicate level ids. The literal README headings `## Project layout` and `## Running it` and the fenced layout block are parsed as text: do not rename or remove them, and keep the two-space-aligned child entries.
- Level comments carry test-enforced tokens. The `SOURCED` / `AUTHORED` markers are asserted by the chapter-2 and chapter-4 batch tests, and these English strings must survive edits: `periodicity`, `kind`, `driver selection`, `2-Bit Decoder`, `addressable`, `defines`, `achievement, not a pass condition`, `ABSOLUTE`, `SAME tick`.
- `test/levels/palette-answer.test.ts`: no level may be solved by one part on its own palette. Its exemption table is load-bearing — a row that stops firing fails the test.
- `test/levels/campaign-shape.test.ts`: `src/levels/campaign.ts` is the authority for id, chapter, index and both names. Change that table, not a level object. The shape is four chapters of 13 / 26 / 10 / 7 levels.

## Toolchain quirks

- `vite.config.ts`: Vitest runs `test/**/*.test.ts` in Node; `test/smoke/**` is excluded and belongs to Playwright — never rename a spec to `*.test.ts`. DOM tests opt in with `// @vitest-environment jsdom` on the first line. Vitest 5 silently ignores `environmentMatchGlobs`; do not reintroduce it.
- `playwright.config.ts` sits outside `tsconfig.include` because it reads `process.env` and the project pins no `@types/node`. It finds the bundled `pnpm.mjs` itself and falls back to a real `pnpm`; `NODE_BIN` / `PNPM_BIN` override both.
- `pnpm dev` and `pnpm start` run `tools/launch.mjs`, which starts the Arduino bridge in the same Node process (`startBridge()`, 127.0.0.1:8765) and stops it on exit (a bridge already on 8765 is reused and left running); `pnpm dev:vite` and `pnpm preview` are the plain servers. The browser cannot spawn a process: a bare `dist/index.html` can never compile or flash, and the bridge's Origin allowlist rejects `file://`.
- Build output `dist/` is static (`base: './'`); `pnpm dev` is only for development.

## Behaviours that are easy to misread

- `?dev=1` opens every level and offers every listed part, but writes no progress. `resumePointOf` ignores dev, so startup does not jump to a late level. The amber DEV light in the shell exits dev mode and cleans the URL in place.
- Chapter 4 (levels 50–56) is **experimental and hidden outside dev mode**: the map omits the CH.4 band, normal-mode resume clamps to level 49, and `nextLevelId` returns null after 49. In dev mode the band is shown with the `实验性章节` tag.
- The Arduino export is **standalone**: the sketch has no serial protocol, D0–D13 and A0–A5 are pin-mappable, and the run clock is compiled in from the panel field (default 1 Hz; 0 = combinational only). Wide connectors are refused at build time. Upload still uses the bootloader on D0/D1, so external wiring on those pins can break flashing.
- Progress is per-browser in `localStorage`; there is no cross-machine sync. The built-in agent is a feature of the game, needs a user-supplied key, and is not required to play.

## Records to leave alone

- `.superpowers/sdd/.gitignore` is deny-by-default with one `!<phase>/` pair per phase. `tools/sdd/sdd-workspace.ps1` writes it only when absent; never overwrite it or every phase disappears from git.
- Root research documents and `docs/superpowers/` are historical records, not product docs; nothing under `src/` reads them.
- `record.md` and `dsh-session-*.zip` are git-ignored because they carry keys or large dumps. Do not sweep them into a commit with `git add -A`.
