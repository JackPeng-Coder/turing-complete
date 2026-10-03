# AGENTS.md

What a new session -- human or agent -- needs before touching this repository.
These rules used to live only inside a dated plan
(`docs/superpowers/plans/2026-09-25-turing-complete-phase0.md`), which is now a
historical document: read it for the reasoning behind a decision, not for what
the repository looks like today.

## The rules

**1. Zero runtime dependencies.** `package.json` has no `dependencies` field and
must not grow one: state, the undo stack, the renderer and the assembler are all
hand-written. Every `devDependency` is pinned to an exact version -- no `^`, no
`~` -- and adding one needs a reason, because this host's pnpm rejects packages
published inside a supply-chain cutoff window (see the waiver in
`pnpm-workspace.yaml`, and add an entry only if a clean
`pnpm install --frozen-lockfile` demands it).

**2. Dependencies flow one way.** `core` <- `asm` <- `levels` <- `app` <- `ui`,
with `persist` reading `app` to build an empty save. Nothing imports upwards,
runtime or type. `src/app/viewport.ts` exists only to keep that true: the camera
and point types are declared in `app/` because `AppState` holds them, and the
board reads them downwards.

**3. Colour, spacing and geometry come from `src/ui/theme.ts`.** No literal
colour in drawing code. On the board green is 1, red is 0 and blue is wider than
one bit; slate -- never red -- means nothing has been simulated. On the chrome
cyan is the instrument's voice and magenta is the operator's hand, and magenta
never appears on the board. There are no shadows anywhere, and no rounded corners
except the bit arrows and the result medal.

**4. Commits: Conventional Commits, in English, `type(scope): summary`.** The
scope is the area, not the file: `board`, `ui`, `levels`, `core`, `panel`,
`docs`. One commit per coherent change, and no commit that leaves the tree
failing the gate below.

## The gate

Every one of these must pass before a change is called done. All three are run
from the repository root.

| Task | Command |
| --- | --- |
| Types and production bundle | `pnpm build` |
| Unit, level and convention tests | `pnpm test` |
| Browser smoke tests (builds and serves the bundle first) | `pnpm smoke` |

On this host `pnpm` on `PATH` is a broken wrapper; README.md's "Running it"
section has the bundled-node invocation that works instead.

## What is enforced, and where

`test/conventions.test.ts` is this project's linter. There is no ESLint or
Prettier, deliberately: the dependency policy above is worth more than the
convenience, and the rules that matter are cheap to assert directly.

That file fails the build when: a module imports upwards; a top-level source
directory is missing from the README's layout block; the README claims a
directory that does not exist; a runtime dependency appears, or a devDependency
is not pinned exactly; a shadow or an unlisted rounded corner appears in the
stylesheet; or two levels share an id. A rule worth keeping belongs there, not in
prose.

## Layout

```
src/core/     simulator: signals, registry and definitions, graph/netlist, settle and tick
src/asm/      the assembler and its ISA: field ranges, modes, operands, program images
src/levels/   LevelSpec types, checks, grader, and content/ (chapters 1-3 so far)
src/app/      state, command/undo stack, progress, shared viewport types
src/ui/       the chrome, and ui/board/ -- camera, hit testing, routing, painting
src/persist/  localStorage save and load
test/         Vitest tests, the convention assertions, and the Playwright smoke spec
tools/sdd/    PowerShell helpers for a phase's SDD workspace
docs/         the design spec, the phase plans, level provenance
```

## Where the record lives

`.superpowers/sdd/<date>-<plan-slug>/` holds each phase's build record: task
briefs, implementer reports, review diffs, the decision ledger. It is tracked
deliberately -- it is the evidence behind each verdict -- and it is the one place
in the repository whose files are ignored by default and un-ignored per phase:

```gitignore
*                      # inside .superpowers/sdd/.gitignore
!<phase directory>/    # one pair per phase, added when the phase starts
```

`tools/sdd/sdd-workspace.ps1` creates that file **only when it is absent**; it
must never overwrite it, because doing so would silently hide every phase from
git. The session transcripts that used to sit in `docs/session-archive/` were
dropped from the working tree -- they remain reachable through
`git log --all -- docs/session-archive`.
