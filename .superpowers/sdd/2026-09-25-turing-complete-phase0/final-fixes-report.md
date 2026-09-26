# Phase 0 final fixes — report

- Date: 2026-09-25
- Branch: `master`
- Base commit: `452e90d` (`feat(ui): add chapter map, original narrative shell and playwright smoke test`)
- Final commit: `efde2bc`
- Scope: the five non-code findings from the whole-branch review. No file under `src/core/`,
  `src/levels/` or `src/app/` was touched, no test expectation was changed, no dependency was added,
  and `package.json` is byte-identical to `452e90d`.

## Commits

| SHA | Subject |
| --- | --- |
| `fe993aa` | `docs: untrack research compendium, add LICENSE and rewrite README` |
| `19ae4b7` | `fix(test): make pnpm smoke runnable without NODE_BIN and PNPM_BIN` |
| `efde2bc` | `refactor(ui): rename the narrative character to an original name` |

Final diff against the base:

```
 .gitignore                                         |    5 +
 LICENSE                                            |   36 +
 README.md                                          |   92 +-
 playwright.config.ts                               |   40 +-
 src/ui/narrative.ts                                |    8 +-
 ...265\204\346\226\231\345\205\250\351\233\206.md" | 1032 --------------------
 6 files changed, 166 insertions(+), 1047 deletions(-)
```

---

## Fix 1 — Untrack the research compendium

**Change.** `git rm --cached "图灵完备_Turing_Complete_游戏资料全集.md"`, then the exact filename was
added to `.gitignore` with a comment explaining why it must not ship (it quotes the original game's
dialogue verbatim, which contradicts the README claim that the project contains no original text).

**Evidence.**

```
$ git rm --cached "图灵完备_Turing_Complete_游戏资料全集.md"
rm '图灵完备_Turing_Complete_游戏资料全集.md'

$ git check-ignore -v "图灵完备_Turing_Complete_游戏资料全集.md"
.gitignore:13:图灵完备_Turing_Complete_游戏资料全集.md	"..."

$ git ls-tree --name-only HEAD        # final tree root, compendium gone
.gitignore
LICENSE
README.md
docs  index.html  package.json  playwright.config.ts  pnpm-lock.yaml
pnpm-workspace.yaml  src  test  tools  tsconfig.json  vite.config.ts

$ git ls-files --error-unmatch "图灵完备_Turing_Complete_游戏资料全集.md"
error: pathspec '...' did not match any file(s) known to git

$ (Get-Item "图灵完备_Turing_Complete_游戏资料全集.md").Length
39664                                 # still on disk, bytes untouched
```

The file is still on disk as the user supplied it; only the tree changed.

## Fix 2 — `LICENSE`

**Change.** New `LICENSE` (36 lines): a short English preamble, then the standard MIT body with
`Copyright (c) 2026 Turing Complete Replica contributors`.

The preamble states, and claims nothing more than:

- an independent, educational reimplementation inspired by LevelHead's *Turing Complete*;
- not affiliated with, endorsed by, or produced by LevelHead, and containing none of the original's
  art, audio, fonts, or text (graphics procedural, copy original);
- intended for study and personal use, and the MIT grant covers **only** the code in this repository
  — it does not extend to the *Turing Complete* name or to any LevelHead-owned material, and no
  permission from LevelHead is claimed or implied.

## Fix 3 — `README.md`

**Change.** Rewritten as English developer documentation. The copyright notice is the **first
paragraph** (spec §1.4 and plan step 9's checklist both read it that way), then: what the project is;
what Phase 0 ships (chapter 1 / 12 levels, NAND → 4-bit binary reader, canvas board, live truth
table, gate/delay/tick scoring with three-star targets, `localStorage` progress, chapter map);
how to run it; smoke-test prerequisites; project layout; contributing/scope; license. The existing
attribution and "support the original" sentiment are kept (first paragraph and the License section).

The run section documents both forms and says which is which:

```
On any normal machine with Node and pnpm on PATH:
  pnpm dev | pnpm test | pnpm build | pnpm smoke

On this host (the pnpm on PATH is a broken wrapper script):
  $NODE = "C:\Users\ME\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"
  $PNPM = "C:\Users\ME\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\pnpm\bin\pnpm.mjs"
  & $NODE $PNPM dev | test | build | smoke
```

Smoke prerequisites are documented as: install Chromium once
(`node node_modules\@playwright\test\cli.js install chromium`), plus the build+preview server
Playwright starts on port 4173 — resolved by the config itself, with `NODE_BIN` / `PNPM_BIN` as
overrides. Screenshots land in `test-results/`, wiped each run.

## Fix 4 — `pnpm smoke` from a clean shell

**Change.** `playwright.config.ts` now resolves both halves instead of defaulting to bare strings:

```ts
const NODE = process.env.NODE_BIN ?? process.execPath;
const PNPM_CANDIDATES = [
  'C:\\Users\\ME\\.dsh\\dsh-runtimes\\dsh-primary-runtime\\dependencies\\pnpm\\bin\\pnpm.mjs',
  resolve(dirname(process.execPath), '..', '..', 'pnpm', 'bin', 'pnpm.mjs'),
];
const BUNDLED_PNPM = PNPM_CANDIDATES.find((candidate) => existsSync(candidate));
const PNPM = process.env.PNPM_BIN ?? BUNDLED_PNPM ?? 'pnpm';

/** `pnpm.mjs` is a script for node to run; a bare `pnpm` is a command to spawn. */
const PNPM_COMMAND = /[/\\]/.test(PNPM) ? `"${NODE}" "${PNPM}"` : PNPM;
```

and the webServer command is `${PNPM_COMMAND} build && ${PNPM_COMMAND} preview --port 4173 --strictPort`.

Two findings from actually running it, both now handled:

1. **`process.execPath` is not the bundled node when the suite is started via `pnpm smoke`.**
   pnpm runs `node_modules/.bin/playwright`, which picks up whatever `node` is on PATH — here
   `C:\Program Files\nodejs\node.exe`. A sibling-of-node guess for `pnpm.mjs` therefore missed, and
   the first attempt still fell back to the broken `pnpm` wrapper (`[WebServer] The system cannot
   find the path specified.`, exit 1). The explicit runtime path is therefore the **first** candidate;
   the sibling path stays as the second, and it is the one that resolves when the CLI is run directly
   with the bundled node. Both were exercised (below).
2. **Quoting.** A resolved script is handed to node and quoted; a bare `pnpm` is spawned directly and
   left unquoted, so the old `"node" "pnpm" build` module error cannot come back. If `PNPM_BIN` is
   set to a path it is treated as a script; if it is set to bare `pnpm` (the documented Linux CI
   form) the command becomes `pnpm build && pnpm preview …`.

`package.json`'s `"smoke": "playwright test"` needed **no change** — it was verified working as-is
inside every run below. With `NODE_BIN`/`PNPM_BIN` set the command is unchanged from before, so the
override behaviour is preserved.

## Fix 5 — Narrative character rename

**Change.** `src/ui/narrative.ts`: 监督者 / `Overseer` → **考核者 / The Assessor**, in the two `zh`
and two `en` strings that used it (the `ch1-09-xor-gate` briefing and the generic fallback briefing).
A doc-comment sentence records that the name is ours, like the lines, because §1.4 requires original
character naming. Every line's meaning and tone is unchanged; only the name changed.

```diff
-    before: { zh: '「四个与非门。监督者认为这是衡量悟性的标准。」', en: 'Four NANDs. The Overseer considers this the measure of a mind.' },
+    before: { zh: '「四个与非门。考核者认为这是衡量悟性的标准。」', en: 'Four NANDs. The Assessor considers this the measure of a mind.' },
-      before: { zh: '监督者没有留下说明。', en: 'The Overseer left no instructions.' },
+      before: { zh: '考核者没有留下说明。', en: 'The Assessor left no instructions.' },
```

`src/levels/content/` was not touched, per instructions. No test asserted on either string.

---

## Verification (final HEAD `efde2bc`, `NODE_BIN`/`PNPM_BIN` unset)

### Vitest — `& $NODE $PNPM test`

```
$ vitest run

 RUN  v5.0.2 D:/Documents/turing-complete

 ✓ test/core/signal.test.ts (16 tests) 12ms
 ✓ test/app/commands.test.ts (6 tests) 8ms
 ✓ test/core/registry.test.ts (24 tests) 18ms
 ✓ test/ui/view.test.ts (6 tests) 9ms
 ✓ test/app/progress.test.ts (14 tests) 11ms
 ✓ test/levels/grader.test.ts (12 tests) 19ms
 ✓ test/levels/checks.test.ts (20 tests) 33ms
 ✓ test/persist/storage.test.ts (12 tests) 12ms
 ✓ test/smoke/sanity.test.ts (1 test) 3ms
 ✓ test/app/store.test.ts (11 tests) 9ms
 ✓ test/levels/ch1-part1.test.ts (34 tests) 22ms
 ✓ test/levels/ch1-part2.test.ts (29 tests) 22ms
 ✓ test/core/net.test.ts (19 tests) 162ms
 ✓ test/core/graph.test.ts (15 tests) 301ms
 ✓ test/ui/panels.test.ts (20 tests) 43ms

 Test Files  15 passed (15)
      Tests  239 passed (239)
   Start at  22:40:02
   Duration  1.36s
### test exit=0
```

### Build — `& $NODE $PNPM build`

```
$ tsc --noEmit && vite build
vite v8.3.1 building client environment for production...
transforming...
✓ 31 modules transformed.
rendering chunks...
computing gzip size...
dist/index.html                  0.41 kB │ gzip:  0.30 kB
dist/assets/index-BJi6Tn_M.css   2.31 kB │ gzip:  0.88 kB
dist/assets/index-DG9hRydu.js   43.44 kB │ gzip: 16.45 kB

✓ built in 53ms
### build exit=0
```

### Smoke — `& $NODE $PNPM smoke`, `NODE_BIN=[] PNPM_BIN=[]`, port 4173 free beforehand

```
$ playwright test
[WebServer] $ tsc --noEmit && vite build
[WebServer] $ vite preview "--port" "4173" "--strictPort"

Running 2 tests using 1 worker

  ok 1 test\smoke\ui.spec.ts:41:1 › level 1 is playable end to end and shows its epilogue (544ms)
  ok 2 test\smoke\ui.spec.ts:64:1 › progress survives a reload and unlocks the next level (627ms)

  2 passed (4.8s)
### smoke exit=0
### artifacts
.last-run.json
smoke-chapter-map.png
smoke-level1-parts-placed.png
smoke-level1-passed.png
### port 4173 after run: free (webServer cleaned up)
```

The `[WebServer]` lines are the proof that the suite really started its own build+preview (the port
was free before the run, so this was not a reused server). The `NO_COLOR`/`FORCE_COLOR` warnings
Playwright echoes from the child processes are pre-existing noise, not errors.

The resolve branches were also exercised individually with `DEBUG=pw:webserver`, which prints the
launched command:

- variables unset, started via `pnpm smoke` (system node is `process.execPath`) — candidate 1:
  ```
  Starting WebServer process "C:\Program Files\nodejs\node.exe" "C:\Users\ME\.dsh\...\pnpm\bin\pnpm.mjs" build && ... preview --port 4173 --strictPort
  WebServer available      2 passed (4.9s)      exit 0
  ```
- variables unset, started via `& $NODE node_modules\@playwright\test\cli.js test` (bundled node is
  `process.execPath`) — candidate 2: same resolved command, `2 passed (5.0s)`, exit 0.
- `NODE_BIN`/`PNPM_BIN` set to the bundled paths — override still honoured, `2 passed (4.9s)`, exit 0.
- `PNPM_BIN=pnpm` (bare) — command is `pnpm build && pnpm preview --port 4173 --strictPort`, i.e.
  spawned directly, no `"node" "pnpm"` module error; on this host it then fails on the broken wrapper
  (`The system cannot find the path specified.`), which is exactly why the default resolves the
  bundled script instead.

Playwright wipes `test-results/` at the start of each run, so the earlier PNGs were replaced; the
three files listed above are from this final run.

## Concerns / notes

1. **The original name still appears outside `src/ui/narrative.ts`.** `src/levels/content/ch1/part1.ts`
   (line 48-49) and `part2.ts` (line 104-105) still say 监督者 / `Overseer`, and so do the narrative
   snippets in `docs/superpowers/plans/2026-09-25-turing-complete-phase0.md`. The level copy was
   explicitly ruled out of scope for this task, and the plan is a historical record, so both were
   left alone — but a reader who greps the repo will still find the original character name until a
   follow-up applies 考核者 / The Assessor there too.
2. **`playwright.config.ts` now contains one host-specific absolute path** (the DSH runtime's
   `pnpm.mjs`), guarded by `existsSync` and used only as the first candidate. On any other machine it
   is inert and the config falls back to the sibling candidate or a real `pnpm`. That is deliberate:
   `process.execPath` under `pnpm smoke` is the PATH node, not the bundled one, so a path that is
   *not* derived from `process.execPath` is required to keep the variables optional on this host.
3. `.gitignore` carries the compendium's Chinese filename verbatim; if the user ever renames the
   source file, the ignore entry has to be updated with it.
