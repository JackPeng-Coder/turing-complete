# Session transcript archive

## What is here

Four files, covering two sessions and three spans. Sizes are as committed.

| File | Session | Span |
|---|---|---|
| `session-55a385c3-transcript.zip` | `55a385c3` | Phases 0 and 1. 80 entries, ~127 MB uncompressed, **30.5 MB** as committed |
| `session.v4.jsonl` | `55a385c3` | Through phase 2 and this session's own download. **13,987,303 bytes**, 3,869 lines |
| `session-e5d36c2c-asm-builder.jsonl` | `e5d36c2c` | One subagent: phase 2's assembler kernel. **2,251,418 bytes**, 413 lines |
| `dsh-session-e5d36c2c-….zip` | `e5d36c2c` | The bundle the line above was downloaded as. One entry, byte-identical to it; **528,213 bytes** |

**The two `55a385c3` files are different spans, not two copies.** The zip was
exported while its session was still running, so it ends at the phase-1 wrap-up;
the loose `.jsonl` is a later export of the same session covering phase 2 as well.
The loose file is kept uncompressed because it is the one a reader will grep.

**The zip in the fourth row is a wrapper, not extra content.** It holds exactly one
entry, also named `session.v4.jsonl`, and that entry is byte-identical to the loose
`asm-builder.jsonl` beside it — both SHA256
`C41B98B8D017C4F686C77F74EDF16EE714DC2E4AB7D39A9242A103E91C99D6DC`, verified by
extracting the entry and hashing it rather than by trusting the sizes. It is kept
as the form the record was actually received in.

**A filename collision nearly cost the parent transcript.** Both sessions were
exported as `session.v4.jsonl`, and the second download overwrote the first on
disk. The parent file was recovered from the object store by blob hash — not
retyped — and the two now have distinct names.

### What the phase-0/1 zip contains

| Path | What it holds |
|---|---|
| `session.v4.jsonl` | The main session: brainstorming, the design spec, the implementation plans, and the controller's coordination |
| `subagents/<id>/session.v4.jsonl` | One file per delegated task — 68 of them, each a fresh implementer or reviewer working on a single task |
| `media/sha256:*.png` | Images exchanged during the session |

The `.jsonl` format is JSON Lines: one event per line, each an object with a `type`, a `seq`,
a `time`, and a `data` payload.

## Why it is committed

So the reasoning behind the code is auditable. The interesting parts of this project are not
the 47 levels — they are *why* eleven of Phase 0's twelve tasks each reported "the plan's code
cannot pass the plan's own test", why Phase 1's chapter-2 level specifications are this
replica's own design rather than the source's, why phase 2 shipped nine levels that no player
could reach, and what was done about each. The transcripts preserve that.

**If you want the narrative rather than the raw record, read the ledgers instead.** They are far
smaller, they are tracked, and they were written as the durable record:

- [`.superpowers/sdd/2026-09-25-turing-complete-phase0/progress.md`](../../.superpowers/sdd/2026-09-25-turing-complete-phase0/progress.md)
- [`.superpowers/sdd/2026-09-25-turing-complete-phase1/progress.md`](../../.superpowers/sdd/2026-09-25-turing-complete-phase1/progress.md) —
  includes every ruling the controller made on the user's behalf, each with what it costs if wrong
- [`.superpowers/sdd/2026-09-29-turing-complete-phase2/progress.md`](../../.superpowers/sdd/2026-09-29-turing-complete-phase2/progress.md) —
  reconstructed after the fact, because phase 2 ran without a ledger; every reconstructed
  ruling is marked as such

Each phase's implementer reports, review packages, and test-evidence logs sit beside its ledger
and are tracked too: they are the per-task evidence, and they are where the *why* is recorded at
the granularity the ledger only summarises.

## Caveats — please read before treating this as documentation

- **It is a raw agent trace, not documentation.** It contains dead ends, superseded plans,
  and statements that were later corrected. Where this archive and the code disagree,
  **the code is right.**
- **Do not run anything it contains without reading it first.** Some transcript lines are
  commands the session executed; the environment they ran in is not this one.
- **Privacy:** the session is a record of one machine's working directory, so paths under
  `D:\Documents\` and `C:\Users\ME\` appear throughout.
- **Secrets:** both this archive and the documentation added alongside it were scanned for API
  keys, tokens, and credential material before being committed (OpenAI/DeepSeek/Anthropic key
  shapes, GitHub tokens, AWS keys, Slack tokens, Google API keys, private-key blocks, bearer
  tokens, and `key = value` assignments), and the scans found **no credentials**. The only
  matches for credential-*sounding* strings were error messages of the form "no
  `DEEPSEEK_API_KEY` is set", which carry no value. A scan is a point-in-time check, not a
  guarantee: if you extend this archive, re-run one.
- **The archive contains deliberately fake credential strings.** Scanning it turns up
  `AKIAIOSFODNN7EXAMPLE`, `xoxb-1234567890-abcdefghijkl`,
  `sk-ant-api03-abcdefghijklmnopqrstuvwxyz`, `ghp_abcdefghijklmnopqrstuvwxyz0123456789` and
  `api_key = "supersecretvalue12345"`. **None of these is a credential and none ever was.** They
  are the synthetic positive controls the session used to prove its secret-scanning patterns
  actually match something before trusting a clean result — a scan that finds nothing is
  worthless if the pattern was broken, so each scan built a known-positive sample first. The
  transcripts recorded those control strings verbatim, which is why they appear here. If your
  tooling flags them, that is a true positive for the pattern and a false positive for the
  finding: they are inert by construction (`AKIAIOSFODNN7EXAMPLE` is AWS's own documented
  placeholder, and the rest are alphabet runs).
- **Not included:** the derived research report that quotes the compendium. It reproduces passages
  of the original game's text, and this project claims to contain none of it. The compendium itself
  is tracked in this repository at the root (`GAME_REFERENCE.md`, renamed from
  `图灵完备_Turing_Complete_游戏资料全集.md` on 2026-09-29). The level names, their order, and their
  source citations — the facts this project actually needed — are recorded in
  [`docs/research/chapter-2-level-provenance.md`](../research/chapter-2-level-provenance.md), and
  chapter 3's provenance is recorded in its own ledger
  ([`.superpowers/sdd/2026-09-29-turing-complete-phase2/progress.md`](../../.superpowers/sdd/2026-09-29-turing-complete-phase2/progress.md),
  "Chapter-3 level provenance").
