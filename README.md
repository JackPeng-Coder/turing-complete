# Turing Complete Replica (图灵完备 · 复刻版)

**This project is not affiliated with, endorsed by, or produced by LevelHead, and it is not an
official product.** None of the original game's art, audio, or fonts is included: every graphic is
drawn procedurally and every line of in-game copy is original. It is an independent implementation
for study and personal use, not for commercial distribution. The mechanics and the teaching
progression are a homage to LevelHead's *Turing Complete* — please support the original.

**One exception, and it is deliberate.** The repository also carries two user-supplied research
documents that this replica was built from — [`GAME_REFERENCE.md`](GAME_REFERENCE.md) (a 1.x
compendium) and [`GAME_RESEARCH_2026-10-03.md`](GAME_RESEARCH_2026-10-03.md) (a sourced 2.x
dossier) — plus the structure extract derived from the first under `.superpowers/research/`. Both
are third-party documents about the game and **both reproduce passages of the original's text**,
including dialogue and the official store description. They are committed as research provenance,
not as content the game ships: nothing under `src/` reads them, no image of the original's art is
committed at all, and the shipped game's own text remains entirely original.

[`RESEARCH.md`](RESEARCH.md) is the entry point to all of it: what each file is, where the two
disagree — they describe different versions of the game — and which one this replica follows. For
what the *game* contains level by level, see
[chapter-2 level provenance](docs/research/chapter-2-level-provenance.md), which records exactly
which facts came from the source and which are this replica's own design.

## What this is

A from-scratch, from-NAND-to-CPU educational puzzle game that reimplements the *learning path* of
LevelHead's *Turing Complete*: you start with one primitive gate and build your way up, gate by gate,
towards a working CPU.

## What works today (phases 0–3, the sandbox, and the agent)

- **Chapter 1 — 13 levels**, from the NAND gate to the logic exam.
- **Chapter 2 — 26 levels (14–39)**: the four-bit reader, parity and counting, the byte operators,
  half and full adders, two's complement, decoders, the feedback and storage half — switch, delay,
  selector, register, RAM and counter.
- **Chapter 3 — 10 levels (40–49)**: the ALU and the machine around it — registers and buses, the
  opcode decoder, the program counter and its RAM, and a capstone that runs an assembled program
  against the machine you built.
- **Chapter 4 — 7 levels (50–56)**: programming the CPU you built — hand-written machine code, the
  assembler, arithmetic and conditional jumps, and two closed-loop puzzles (the code lock and the
  maze) whose checker drives your program one tick at a time.
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
- **A sandbox**: a board with no puzzle, no test cases and no verdict, holding every part the game has.
  It is reached from the map and is always open. What you build there is saved as you draw it and can
  be exported to a `.json` circuit file and imported back — the only way work leaves the browser.
- **Components of your own.** Band-select parts (Ctrl+drag), press 封装为元件, and the selection becomes
  one part: the wires crossing its edge become its pins, and it joins the palette so the next circuit
  can use it. 编辑内部 opens it again on the same board. Cost is measured through the expansion, so
  wrapping a circuit never makes it cheaper.
- **A sandbox circuit can be written to an Arduino.** The 开发板 tab builds a table-driven sketch
  from the sandbox board — the first version knows the one-bit gates, the full adder, the delay
  line, the one-bit memory and the two connectors — costs it against Uno, Nano or Mega budgets,
  and either downloads a self-contained `.ino` or flashes it through `tools/arduino-bridge.mjs`, a
  loopback daemon that runs `arduino-cli` (a browser cannot). Once flashed, the board is driven and
  read over Web Serial with the sketch's own line protocol; the banner's hash says whether the
  board is running the circuit on screen.
- **A built-in agent you can talk to.** Fill in an API address, a key and a model once — the request
  goes straight from the browser to that endpoint, so the app still ships **no runtime dependency and
  no server** — then describe what you want in Chinese and watch it happen. The agent calls one
  operation at a time: place, move, wire, disconnect, delete, select, 封装 as a component, open a
  component's circuit and edit it, rename or delete one, undo and redo, drive an input pin, run the
  clock, step it, press 测试, write the program text, and export or import the circuit. The board holds
  a frame between steps, so each one is visible, and the part just touched wears the selection ring.
  Its edits go through the same command stack as your own, so Ctrl+Z walks back through them, and it
  may place exactly the parts the level's palette is offering you. The key is kept in `localStorage`
  under `tc.agent.v1` — 设置 can forget it, the panel says what is missing when it is not set up, and
  nothing asks at startup, because the game plays fine without any of it.

Chapters 5–7 (the Symphony CPU, functions, the assembly challenges, and the peripherals) are planned but
not built yet.

## Interface

The chrome is styled as bench instrumentation, not as a page with cards on it: flat slabs separated
by 1px hairlines, **no shadows anywhere** — not one `box-shadow` or `text-shadow` in the stylesheet —
and no rounded corners except the bit arrows, whose roundness carries the value, and the result
medal, which is a stamped disc rather than a glowing orb. `test/conventions.test.ts` asserts both
halves of that — no shadow property anywhere, and no radius outside those two.

It is a **workbench**, laid out the way a code editor is: an activity rail on the left, the parts
tray beside it (with the component library a tab away and the clock/IO readout pinned below), the
board as the document in the middle, the assistant in a collapsible sidebar on the right, the level's
cases and the programming bench in a tabbed panel under the board, and the measured cost along the
bottom in a status bar. Every panel is docked in flow, so a tool never covers a wire being drawn. The
three docks fold away and drag wider or taller, and the workbench remembers the sizes and which of
them were left folded (`tc.layout.v1`); scrollbars are drawn by the stylesheet rather than left to
the platform.

Two colour axes, kept apart on purpose:

- **On the board**, green is 1, red is 0, and blue is wider than one bit. That is the value rule
  stated in [`src/ui/theme.ts`](src/ui/theme.ts), and slate — never red — means nothing has been
  simulated yet.
- **On the chrome**, cyan is the instrument's voice (titles, labels, measured numbers) and magenta is
  the operator's hand: every control you can press. Magenta never appears on the board, so a value
  can never be mistaken for something clickable.

A scale of 1px ticks finishes the two edges where something is *measured* — the cost readout in the
status bar and the case matrix along the bottom — and appears nowhere else.

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

### The agent

The agent is a dock, not a dialog: the `Agent` button in the activity rail claims the secondary sidebar
(the column closes and gives the board its width back), and the panel is available on every board
screen — an ordinary level, the sandbox, and `?dev=1`.
Type what you want in Chinese and press 发送 (Enter sends, Shift+Enter is a newline). While it works,
each step is a row in the log — `place_part · 在 (160, 160) 放了 与非门（i1）` — and each one is a
frame on the board: the parts appear one at a time, and the part just touched wears the selection ring
so you can see where the last action landed. Above the rows, the model's own reasoning scrolls through
a six-line window as it is written and then folds to `▸ 思考 · N 行`, one click from being read again;
the step that answers rather than acts keeps its sentence open.

设置 holds the API address, the key, the model and the **step limit** — 16 model calls per request by
default, `0` for no limit. When a request reaches the limit the log ends with a 继续执行 button, which
sends the same conversation again with a fresh budget: a long build is one click from finishing rather
than a retyped request.

The readings are **live**: the totaliser under the log starts ticking the moment a request begins and
updates at every step — elapsed time, steps, tokens, output speed, cache share and estimated cost — so a
long build is never a blank wait. Each finished request also leaves its own row under the reply
(`2.4s · 1.2k tok · 20 tok/s · 缓存 83% · ¥0.0004`). Token counts come from the provider's own usage
frame (the request asks for one) and the times from the wall clock; a provider that reports no usage
gets a time-only reading, never invented zeroes. The cost is estimated from DeepSeek's published price
list — CNY per million tokens, with the documented half-price idle windows (Chinese public holidays are
not modelled, so a holiday weekday is priced at peak) — and is shown only for models on that list.

What it will not do, and why:

- **It cannot touch your progress.** No level is opened, passed, skipped or cleared by the agent, and
  the campaign's stars change only when *you* press 测试 on a circuit. The tool list is the contract:
  it is what the model is offered, and nothing outside it is reachable.
- **It cannot place parts the level does not offer you.** The tool's palette is derived from the same
  function the parts tray uses, and `?dev=1` only relaxes the unlock filter — it never adds a part a
  level's brief did not list — so a level's puzzle is not bypassed by asking nicely.
- **It does not pan, zoom, toggle the grid or band-select.** Those are the view, not the circuit: an
  agent that could move the camera could put the board somewhere you did not ask for it, and every one
  of them is one gesture away.
- **It only speaks OpenAI-compatible `chat/completions`** with streaming. Anthropic's messages API
  needs a browser-specific header and is not wired up; every other provider that speaks the OpenAI
  shape — including the DeepSeek, Moonshot and Zhipu endpoints — works.
- **The key is stored in this browser, in the clear.** There is no server to hold it: `localStorage`
  under `tc.agent.v1`, readable by any script on this origin. 设置 forgets it.
- **It is not a chat memory.** The conversation lasts for the session; a reload starts a new one. The
  circuit is what persists, and it persists the way it always has.

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
writes progress, so no level is passed and no star is awarded on its account. Nor does it widen a
level's palette: `?dev=1` on level 2 offers the NAND on that level's list, not the sandbox's 8-bit
adder — the flag only stops hiding listed parts the campaign has not handed out yet. The agent reads
the same list, so `?dev=1` does not turn it into a way around a level's puzzle either.

While it is on, the top bar carries an amber `DEV` light — a mode that unlocks the whole game has to be
impossible to forget — and clicking that light leaves the mode and cleans the URL, so a refresh does not
bring it back.

### Writing a sandbox circuit to a board

The 开发板 tab in the bottom panel is only there in the sandbox. It needs three things outside the
browser:

1. **`arduino-cli` on `PATH`** (1.x), with the AVR core installed once:
   `arduino-cli core install arduino:avr`. Set `TC_ARDUINO_CLI` to point at a binary that is not on
   `PATH`.
2. **The local bridge**, run from the repository root while you want to flash:
   `node tools/arduino-bridge.mjs` (default `http://127.0.0.1:8765`). It binds loopback only, refuses
   origins other than the game's own tabs, and requires the `X-TC-Arduino: 1` header on every request.
   Set `TC_ARDUINO_TOKEN` to require a shared secret as well; type the same value into the panel's
   令牌 field. The bridge can program a microcontroller, so do not expose it.
3. **A Chromium browser** for Web Serial (Chrome or Edge, over `localhost` or `https`). Firefox and
   Safari cannot open a serial port.

Then, on the sandbox screen: place at least one 关卡输入 or 关卡输出, open 开发板, and press 构建映像.
The card reports what the circuit compiles to (nodes, slots, states, tables) and what it is estimated
to cost in RAM and flash, against the board chosen in the 本地桥 card; a circuit that will not fit is
refused by name rather than failing on the board. 下载 .ino writes the sketch to disk — put it in a
folder of the same name and the Arduino IDE opens it — and 检查连接 / 编译 / 烧录 take the same sketch
through the bridge. The compiler's own size report and log are shown beside the estimate.

After a flash, press 连接串口 (the panel closes the port again with 断开; `arduino-cli` cannot upload
while it is open). The banner's hash is compared with the image the panel built, so "the board is
running the circuit on screen" is a check rather than a guess. 单步 T applies one clock edge, 复位 R
clears the storage and the inputs, 读取 S prints the current frame, each input connector has a value
field and 同步面板输入 copies the in-page input values onto the board, and the command line accepts
the documented protocol lines (`I <index> <value>`, `T`, `R`, `S`, `C <hz>`, `B`) directly.

The supported set is deliberately narrow: a wide part, a decoder or a CPU part is refused with the
instance named, and `src/flash/build.ts` is where the set is stated. The sketch is a table-driven
interpreter rather than one statement per gate, which is what lets a board of several hundred gates
fit an Uno at all; the price is settling speed, paid only while the circuit runs.

## Project layout

```
src/
  core/     simulator: signals, component registry + definitions, graph/netlist, settle & tick
  asm/      the assembler and its ISA: field ranges, addressing modes, operands, program images
  levels/   LevelSpec types, the campaign table, checks, grader, content/ (chapters 1–4), the
            sandbox spec, and the custom-component library and wrap
  flash/    the Arduino exporter: component tables, the program image, the sketch emitter, the
            serial line protocol and the local bridge's client
  app/      application state, command/undo stack, progress, and the shared viewport types
  agent/    the built-in assistant: the tool list it may call, the operations behind them, the
            OpenAI-compatible streaming client, its settings, and the run loop
  ui/       the board's chrome: top bar, palette, clock + I/O readout, tool grid, test cases,
            chapter map, the components panel, the agent panel, and the Canvas board (see ui/board/)
  ui/board/ the board itself: camera and hit testing, wire routing, painting, live signals
  persist/  localStorage save and load, the sandbox circuit, and the `tc-circuit` file format
test/       Vitest unit and level tests, the convention assertions, and the Playwright smoke spec
tools/      the SDD PowerShell helpers that build a phase workspace and its briefs, and the
            session-transcript readers and the visual check (tools/*.mjs)
docs/       the design spec, the phase plans, and the per-chapter level provenance
```

Dependencies run one way: `core` ← `asm` ← `levels` ← `flash`, and `app` sits beside `flash` (it
does not import it: the exporter reads a circuit, not the application). `persist` reads `app` to
build an empty save and `agent` reads `app` to drive it the way a player does — the chrome imports
`agent` and `flash`, never the other way, and `agent/` may not import `ui/` at all. Nothing imports
upwards, and `test/conventions.test.ts` fails the build if anything starts to — that file is this
project's linter, because no linter is pinned (see `AGENTS.md` for why, along with the four rules
that shape everything else).

## Contributing / scope

Phases 0–3 cover chapters 1–4, which is **56 of the campaign's 93 levels**. Two phases followed outside
the campaign: the **sandbox** with **player-built components** — the two things the spec called for
(spec §3.4, §7, §8.1) — and the **built-in agent**, which is this project's own addition rather than a
feature of the game being replicated. The campaign follows the
**2.x** structure of the game (13/26/10/7/26/7/4 chapters, Symphony in place of LEG, 2–64-bit
widths); the table that fixes it is [`src/levels/campaign.ts`](src/levels/campaign.ts), and
`test/levels/campaign-shape.test.ts` holds every level to it. The remaining chapters 5–7 are listed
in [`GAME_RESEARCH_2026-10-03.md`](GAME_RESEARCH_2026-10-03.md) §5, and the scope and acceptance
criteria for the phases that will build them are in
[`docs/superpowers/plans/2026-10-16-turing-complete-chapters-5-7.md`](docs/superpowers/plans/2026-10-16-turing-complete-chapters-5-7.md).
[`RESEARCH.md`](RESEARCH.md) records where the two research documents disagree
and which one this project follows for what.

The record of how it was built is committed too. [`.superpowers/sdd/`](.superpowers/sdd/) holds one
directory per phase: phases 0 and 1 carry every task's brief, its implementer's report, and the
review diffs behind each verdict — phase 0 is missing the briefs for tasks 9 and 11, which were
written before the workspace convention settled — and phase 2 carries the decision ledger and the
ALU handoff rather than per-task reports, because it ran as fewer and larger tasks. `tools/sdd/`
holds the three PowerShell helpers that resolve such a workspace, write a task brief, and stage a
review package.

`docs/session-archive/` keeps one raw transcript, `session.v4.jsonl` (5.1 MB), the session behind the
phase-3 record, at the repository owner's request; earlier transcripts were dropped from the working
tree and remain reachable through `git log --all -- docs/session-archive`. The flat `digest.md` view is
regenerated by `tools/transcript-digest.mjs` and git-ignored, so a derived copy never becomes a second
source of truth.

## License

MIT — see [LICENSE](LICENSE). Not affiliated with LevelHead; no original art, audio, or fonts are
included, and every line of the game's own copy is original. The two research documents committed at
the repository root are separate third-party documents: they are not covered by that statement, and
[LICENSE](LICENSE) excludes them from the MIT grant by name. If you enjoy this, buy *Turing Complete*
and support the original.
