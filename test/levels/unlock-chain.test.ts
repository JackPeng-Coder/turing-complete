// tsconfig lists only `vitest/globals` in `types`, so Node's ambient types are
// deliberately not in this program. The import is real at runtime (vitest runs
// this file in Node) and the assertion below is what proves it; the suppression
// is one line rather than a project-wide `@types/node` dependency. It also fails
// loudly if a later task ever does add Node types, at which point the directive
// can simply go.
// @ts-expect-error -- no Node ambient types in this project's tsconfig
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { STARTER_COMPONENTS } from '../../src/app/progress';
import { DECODER_DEF_IDS } from '../../src/core/defs/wide';
import type { PortValue } from '../../src/core/signal';
import { CH2_LEVELS } from '../../src/levels/content/ch2/index';
import { CH3_LEVELS } from '../../src/levels/content/ch3/index';
import { CH4_LEVELS } from '../../src/levels/content/ch4/index';
import { LEVELS, LEVEL_ORDER, levelsOfChapter } from '../../src/levels/index';
import type { LevelSpec } from '../../src/levels/spec';
import { registry } from '../fixtures/build';

/**
 * The chapter's unlock chain, asserted as a chain rather than level by level.
 *
 * WHAT THIS ADDS OVER THE OTHER TWO WALKS. `level-buildability.test.ts` checks
 * each level against its own palette (can the player build this level's
 * reference, and does the level offer anything it has not earned);
 * `ch2-batch*.test.ts` check each batch against its own file. Neither can see the
 * CHAPTER: whether every part the design says chapter 2 teaches is handed out,
 * whether one part is handed out twice (a level rewarding what an earlier level
 * already unlocked is a dead reward), or whether a part is offered before
 * anything unlocks it. That is what is below, over all 26 levels at once.
 *
 * THE EXPECTATION IS READ OUT OF THE SPEC, NOT RESTATED HERE. §3.3 of
 * `docs/superpowers/specs/2026-09-25-turing-complete-replica-design.md` is this
 * project's authority for which chapter unlocks what, so §3.3's rows are parsed
 * out of that markdown while this file runs (`specRow` below). This file used to
 * carry its own 33-name copy of §3.3's chapter-2 row and check the levels against
 * THAT. A copy is maintained by the same hand as the level data, so it tracks the
 * data and never the spec the data is supposed to match -- which is how §3.3 and
 * the levels could disagree for a whole phase with every test green. `ram8`,
 * rewarded by level 28 and named nowhere in §3.3, is what that cost.
 *
 * BOTH DIRECTIONS ARE CHECKED, and neither one restates the other's list:
 *
 *  * spec -> data: every part §3.3's chapter-2 row names is unlocked by exactly
 *    one chapter-2 level (the `describe` below titled "every part in spec §3.3's
 *    chapter-2 list ..."). There is no exemption left: `decoder2` had one until
 *    the 2.x shape gave it a level, and the test that recorded the hole now
 *    records the level that filled it.
 *  * data -> spec: every part a chapter-2 level hands out is named by that row
 *    ("spec §3.3's rows and the level data agree", above it). That is the
 *    direction the old copy could not see, and the one `ram8` would have failed.
 *
 * THE PHASE-END RULINGS, all settled, all of them now visible in §3.3 itself:
 *
 *  * `mem1` is a CHAPTER-1 part. Chapter 1's capstone (level 13, the Logic Exam)
 *    hands it out so chapter 2's latch level has a storage element to build its
 *    loop from; §3.3's chapter-1 row names it and the chapter-2 row no longer
 *    does.
 *  * `switch` unlocks at level 17 and `switch8` at level 27 in this replica --
 *    the two are no longer one hand-out. The latch level's reference is built
 *    from two `switch`es, so the 1-bit part lands there; the 8-bit version
 *    arrives with the byte adder. §3.3's chapter-2 row names both. The source
 *    teaches the 1-bit part at its own Bit Switch level, which is level 24 here,
 *    so that level is a re-teach rather than a first meeting.
 *  * `ram8` is in §3.3's chapter-2 row: level 17 rewards it and level 38's little
 *    box is built from it.
 *  * `decoder2` used to be the counter-example this block recorded: §3.3 named
 *    it, no level rewarded it, and rule 2 carried an exemption for it. The 2.x
 *    shape gives it a level (`ch2-36-2-bit-decoder`), so the three widths are now
 *    introduced one per level -- `decoder1` at 35, `decoder2` at 36, `decoder3`
 *    at 37 -- and nothing is exempt from the rule.
 *
 * Anything ELSE unlocked by zero or two levels is a real defect -- a part no
 * player can ever hold, or a level whose reward is already in the player's hands
 * -- and the tests below report it by name instead of carving out an exemption.
 */

/**
 * Spec §3.3's unlock table, read out of the spec file.
 *
 * The parse is deliberately shallow, and that is the whole reason it is safe to
 * depend on: §3.3's rows are markdown table rows, one row per line, and the
 * components in a row are its backticked tokens. Re-wrapping a cell across lines
 * is not a reflow a table can survive as a table, so the shape this reads is the
 * shape the document is written in rather than an incidental one. Every way the
 * parse can come up short is loud rather than silent: a missing `### 3.3`
 * heading, a missing row and a repeated label all throw with the label in the
 * message, and the tests below pin what the rows they read have to contain.
 */
const SPEC_PATH = '../../docs/superpowers/specs/2026-09-25-turing-complete-replica-design.md';
const SPEC_MARKDOWN: string = readFileSync(new URL(SPEC_PATH, import.meta.url), 'utf8');

/** The text of `heading`'s section: from that heading to the next `###` one. */
function sectionOf(markdown: string, heading: string): string {
  const start = markdown.indexOf(heading);
  if (start < 0) throw new Error(`the design spec has no \`${heading}\` section to read`);
  const rest = markdown.slice(start + 1);
  const next = rest.indexOf('\n### ');
  return next < 0 ? rest : rest.slice(0, next);
}

/** §3.3's rows: chapter label -> the component ids that row names. */
function parseUnlockRows(markdown: string): Map<string, readonly string[]> {
  const rows = new Map<string, readonly string[]>();
  for (const line of sectionOf(markdown, '### 3.3').split('\n')) {
    const cells = /^\|\s*(Ch\d+|沙盒专用)[^|]*\|([^|]*)\|\s*$/.exec(line);
    if (!cells) continue;
    const label = cells[1]!;
    const ids = [...cells[2]!.matchAll(/`([a-z0-9_]+)`/g)].map((match) => match[1]!);
    if (rows.has(label)) throw new Error(`spec §3.3 has two rows labelled \`${label}\``);
    rows.set(label, ids);
  }
  return rows;
}

const UNLOCK_ROWS = parseUnlockRows(SPEC_MARKDOWN);

/** The component ids §3.3's row for `label` names, or a loud failure. */
function specRow(label: string): readonly string[] {
  const ids = UNLOCK_ROWS.get(label);
  if (!ids) throw new Error(`spec §3.3 has no row for ${label}`);
  return ids;
}

/** §3.3's chapter-1 row: level 13's `mem1` puts a memory part in this row. */
const CH1_ROW = specRow('Ch1');

/**
 * §3.3's chapter-2 row: the 30 parts the chapter's levels hand out. `decoder2`
 * is in it like every other name: `ch2-36-2-bit-decoder` is where it arrives
 * (see the ruling above).
 */
const CH2_ROW = specRow('Ch2');

/**
 * §3.3's chapter-3 row: the ten parts the chapter hands out -- the six the
 * OVERTURE machine is built from, plus `alu2` and the shift/rotate family the
 * retired Logic Engine used to carry, which `ch3-42-alu-2` hands out now.
 *
 * The six machine parts needed no ruling before they could be asserted: each is
 * introduced by a chapter-3 level, in row order, against a level whose brief is
 * the part itself. Chapters 1 and 2 both had to settle a name that had moved
 * (`mem1` into chapter 1's capstone, `switch` off the source's own level, `ram8`
 * named only late), which is why their blocks below carry rulings and this one
 * carries none.
 */
const CH3_ROW = specRow('Ch3');

/** The starters, as a `Set<string>` so `has` takes a plain string. */
const STARTERS = new Set<string>(STARTER_COMPONENTS);

/** The components `level` hands out, its reward list being optional. */
function rewardsOf(level: LevelSpec): readonly string[] {
  return level.rewards?.components ?? [];
}

/** Every shipped level that rewards `def`, in game order. */
function unlockersOf(def: string): readonly LevelSpec[] {
  return LEVELS.filter((level) => rewardsOf(level).includes(def));
}

/** Game position of the first level that lists `def` in `allowedComponents`, or -1. */
function firstListingOf(def: string): number {
  return LEVELS.findIndex((level) => level.allowedComponents.includes(def));
}

// ---------------------------------------------------------------------------
// Rule 1: a level may only offer parts the player can already hold
// ---------------------------------------------------------------------------

describe('every chapter-2 level offers only parts it has already earned', () => {
  for (const level of levelsOfChapter(2)) {
    it(level.id, () => {
      // "At or before", not "before": a level's own rewards are offered to build
      // with (see `paletteDefsFor`), which is how level 13's parity puzzle gets
      // the splitter it rewards.
      const position = LEVEL_ORDER.indexOf(level.id);
      expect(position, `${level.id} is not in the game's order`).toBeGreaterThanOrEqual(0);
      const earned = new Set<string>(STARTERS);
      for (const atOrBefore of LEVELS.slice(0, position + 1)) {
        for (const def of rewardsOf(atOrBefore)) earned.add(def);
      }
      for (const def of level.allowedComponents) {
        expect(
          earned.has(def),
          `${level.id} offers ${def}, which is neither a starter nor unlocked by a level at or before it`,
        ).toBe(true);
      }
    });
  }
});

// ---------------------------------------------------------------------------
// The spec's §3.3 rows and the level data, compared in both directions
// ---------------------------------------------------------------------------

describe("spec §3.3's rows and the level data agree", () => {
  it('reads a row for every chapter the table lists', () => {
    // Parse sanity. `specRow` already throws when a row it was asked for is
    // absent; this states the table's shape, so a deleted or renamed table is
    // reported here rather than as a confusing failure further down.
    for (const label of ['Ch1', 'Ch2', 'Ch3', 'Ch4', 'Ch5', 'Ch6', 'Ch7', '沙盒专用']) {
      expect(UNLOCK_ROWS.has(label), `spec §3.3 has no row for ${label}`).toBe(true);
    }
    // Chapters 4-7 and the sandbox row are read but not compared against data:
    // this build ships chapters 1-3 (47 levels), so the later rows have no
    // rewards to be checked against until their chapters exist.
  });

  it('names every part a chapter-2 level hands out', () => {
    // The direction rule 2 cannot see. Rule 2 walks the spec's list, so a part
    // the spec never names is invisible to it however many levels reward it --
    // `ram8` was exactly that until the phase-end ruling: rewarded by level 28,
    // listed by level 37's palette, and absent from §3.3 for a whole phase
    // because the expectation in this file was a copy of the same list.
    const rewarded = new Set<string>();
    const unnamed: string[] = [];
    for (const level of levelsOfChapter(2)) {
      for (const def of rewardsOf(level)) {
        rewarded.add(def);
        if (!CH2_ROW.includes(def)) unnamed.push(`${def} (rewarded by ${level.id})`);
      }
    }
    // Non-vacuity: the walk reached the chapter's rewards at all. A floor, not a
    // count of record -- how many there are is the spec's business, not this
    // file's, and a stub or empty parse must not pass this test.
    expect(rewarded.size).toBeGreaterThanOrEqual(25);
    expect(unnamed, "chapter-2 rewards spec §3.3's chapter-2 row does not name").toEqual([]);
  });

  it('agrees with the chapter-1 row in both directions, mem1 included', () => {
    // Chapter 1 is a shipped chapter with a row of its own, and `mem1` moving
    // into it is the reason this test exists: a name moved between two rows has
    // to be checked on both sides, or the move just changes which check is blind.
    const rewarded = new Set<string>();
    for (const level of levelsOfChapter(1)) for (const def of rewardsOf(level)) rewarded.add(def);
    expect(rewarded.size).toBeGreaterThanOrEqual(10);
    expect(
      [...rewarded].filter((def) => !CH1_ROW.includes(def)),
      "chapter-1 rewards spec §3.3's chapter-1 row does not name",
    ).toEqual([]);

    // The other direction, for chapter 1: a name in the row that no chapter-1
    // level hands out (or that two of them do) is a row that promises a part the
    // player never gets.
    const problems: string[] = [];
    for (const def of CH1_ROW) {
      const unlockers = unlockersOf(def);
      if (unlockers.length !== 1) {
        const who = unlockers.map((level) => level.id).join(', ') || 'no level';
        problems.push(`${def} is unlocked by ${unlockers.length} levels: ${who}`);
      } else if (unlockers[0]!.chapter !== 1) {
        problems.push(`${def} is unlocked by ${unlockers[0]!.id}, which is chapter ${unlockers[0]!.chapter}`);
      }
    }
    expect(problems, "parts spec §3.3's chapter-1 row names that chapter 1 does not hand out").toEqual(
      [],
    );
  });

  it('agrees with the chapter-3 row in both directions', () => {
    // Both directions in one test, deliberately: chapter 3's six parts are all
    // introduced by the six levels whose brief is that part, so the spec->data
    // and data->spec walks are two views of a single claim -- the machine is
    // handed out one piece per level, in order, with nothing left over. Splitting
    // them would let a part be dropped from the row and from the levels at once
    // and still read as two passes.
    const rewarded = new Set<string>();
    for (const level of levelsOfChapter(3)) for (const def of rewardsOf(level)) rewarded.add(def);
    // Non-vacuity: the walk reached every part the row names. The bound is the
    // ROW's own length rather than a literal, so the parts the retired Logic
    // Engine used to carry do not have to be restated here -- what this says is
    // that chapter 3 hands out exactly its row and nothing beside it. `ch3-47`
    // ..`ch3-49` reward nothing (chapter 3 ends on the integration levels rather
    // than on a part), so this is also the check that the last three levels did
    // not quietly grow a reward of their own.
    expect(rewarded.size).toBe(CH3_ROW.length);
    expect(
      [...rewarded].filter((def) => !CH3_ROW.includes(def)),
      "chapter-3 rewards spec §3.3's chapter-3 row does not name",
    ).toEqual([]);

    // The other direction: a name in the row that no chapter-3 level hands out
    // (or that two of them do) is a row promising a part the player never gets.
    // The level check is what stops a chapter-3 part being satisfied by, say, a
    // chapter-2 reward that happens to carry the same id.
    const problems: string[] = [];
    for (const def of CH3_ROW) {
      const unlockers = unlockersOf(def);
      if (unlockers.length !== 1) {
        const who = unlockers.map((level) => level.id).join(', ') || 'no level';
        problems.push(`${def} is unlocked by ${unlockers.length} levels: ${who}`);
      } else if (unlockers[0]!.chapter !== 3) {
        problems.push(`${def} is unlocked by ${unlockers[0]!.id}, which is chapter ${unlockers[0]!.chapter}`);
      }
    }
    expect(problems, "parts spec §3.3's chapter-3 row names that chapter 3 does not hand out").toEqual(
      [],
    );
  });
});

// ---------------------------------------------------------------------------
// Rule 2: every listed part is unlocked by exactly one level
// ---------------------------------------------------------------------------

describe("every part in spec §3.3's chapter-2 list is unlocked by exactly one level", () => {
  it('walks the spec row itself, with no repeats and nothing dropped', () => {
    // Non-vacuity for the rule below: a parse that returned nothing, or half a
    // row, would quietly stop checking parts. The floor is a sanity band rather
    // than a count of record -- the counts belong to the spec, and restating one
    // here is the mistake this file was rewritten to stop making. The duplicate
    // check is a check on the spec: one part spelled twice is one the row cannot
    // honestly claim to introduce once.
    expect(CH2_ROW.length).toBeGreaterThanOrEqual(25);
    expect(new Set(CH2_ROW).size).toBe(CH2_ROW.length);
  });

  it('hands out every listed part at exactly one chapter-2 level', () => {
    const errors: string[] = [];

    for (const def of CH2_ROW) {
      const unlockers = unlockersOf(def);
      if (unlockers.length !== 1) {
        const who = unlockers.map((level) => level.id).join(', ') || 'no level';
        errors.push(`${def} is unlocked by ${unlockers.length} levels: ${who}`);
        continue;
      }
      // And the one level is a chapter-2 level: a part the chapter teaches must
      // not be a chapter-1 handout. This is the check that would fire if `mem1`
      // were put back in §3.3's chapter-2 row, and it does not depend on this
      // file knowing where `mem1` lives.
      const unlocker = unlockers[0]!;
      if (unlocker.chapter !== 2) {
        errors.push(`${def} is unlocked by ${unlocker.id}, which is chapter ${unlocker.chapter}`);
      }
    }

    expect(errors, 'components not unlocked by exactly one chapter-2 level').toEqual([]);
  });

  it('hands ram8 out at level 17, ahead of the level that builds from it', () => {
    // SETTLED, and §3.3 now names `ram8` in its chapter-2 row -- the row test
    // above fails if it stops. What is left to pin here is the part the spec
    // does not carry: WHICH level hands it out, and that the reward precedes the
    // first level that offers it. Load-bearing: level 38 lists `ram8`, so if
    // level 17 stopped rewarding it, level 38 would offer a part no level
    // unlocks and the buildability walk would fail.
    const unlockers = unlockersOf('ram8');
    expect(unlockers.map((level) => level.id)).toEqual(['ch2-17-circular-dependency']);
    expect(LEVEL_ORDER.indexOf('ch2-17-circular-dependency')).toBeLessThan(
      LEVEL_ORDER.indexOf('ch2-38-little-box'),
    );
  });

  it('unlocks switch at level 17 and switch8 at level 27, where each is needed', () => {
    // SETTLED, and §3.3's chapter-2 row names both. What is pinned here is WHERE,
    // which rule 2 cannot see: the 1-bit part lands on the latch level, whose
    // reference is built from two `switch`es (`test/fixtures/ch2-references.ts`
    // `circularDependencyReference`), and the 8-bit version arrives with the byte
    // adder. The source teaches the 1-bit part at its own Bit Switch level --
    // level 24 here, seven levels after the player already holds it -- which is
    // the recorded cost of teaching the part where a puzzle needs it.
    expect(unlockersOf('switch').map((level) => level.id)).toEqual(['ch2-17-circular-dependency']);
    expect(unlockersOf('switch8').map((level) => level.id)).toEqual(['ch2-27-adding-bytes']);
  });

  it('unlocks mem1 at chapter 1 level 13, the row the spec puts it in', () => {
    // The ruling: chapter 2's latch level builds from `mem1`, and the part is
    // handed out by chapter 1's capstone so it exists before chapter 2 opens.
    // Both halves are asserted, because "unlocked by chapter 1" is only half the
    // ruling -- it is one specific level, and it is the last one of chapter 1.
    const unlockers = unlockersOf('mem1');
    expect(unlockers.map((level) => level.id)).toEqual(['ch1-13-logic-exam']);
    const capstone = unlockers[0]!;
    expect(capstone.chapter).toBe(1);
    expect(capstone.index).toBe(13);
    // And §3.3 says the same thing: `mem1` is in the chapter-1 row and not in
    // the chapter-2 row. Rule 2's chapter check would also catch a `mem1`
    // reappearing in the chapter-2 row; this states it directly, where the
    // ruling is, so neither half depends on the other.
    expect(CH1_ROW).toContain('mem1');
    expect(CH2_ROW).not.toContain('mem1');
    expect(levelsOfChapter(2).filter((level) => rewardsOf(level).includes('mem1'))).toEqual([]);
  });

  it('hands decoder2 out at the level the campaign table gives it', () => {
    // The hole this test used to record is closed. `decoder2` was registered,
    // named by §3.3, and rewarded by no level, so it could never reach a palette
    // and rule 2 had to carry an exemption for it. `ch2-36-2-bit-decoder` is that
    // level now, and the exemption is gone: the assertion below is the same shape
    // as every other row name's, plus the direction that would catch the hole
    // reopening (the row naming a part no level hands out is rule 2's business,
    // and it now fails rather than being skipped).
    expect(CH2_ROW).toContain('decoder2');
    expect(unlockersOf('decoder2').map((level) => level.id)).toEqual(['ch2-36-2-bit-decoder']);

    // Registered...
    expect(registry.has('decoder2')).toBe(true);
    expect(DECODER_DEF_IDS).toEqual(['decoder1', 'decoder2', 'decoder3']);

    // ...and reachable: the same pin contract as the widths the levels do
    // introduce, and a working one-hot decode of every select value.
    const def = registry.get('decoder2');
    expect(def.inputs.map((pin) => `${pin.id}:${pin.width}`)).toEqual(['sel:2']);
    expect(def.outputs.map((pin) => `${pin.id}:${pin.width}`)).toEqual(['out:4']);
    expect(def.evaluate, 'decoder2 has no transfer function').toBeDefined();
    for (let sel = 0; sel < 4; sel += 1) {
      const out: PortValue[] = [0];
      def.evaluate?.([sel], out, undefined, { tick: 0 });
      expect(out[0], `decoder2(${sel})`).toBe(2 ** sel);
    }

    // The family's other two widths are unlocked by exactly one level each, and
    // in order: 35 introduces `decoder1`, this level is 36, and 37 introduces
    // `decoder3`. Together with the assertion above that is the whole claim --
    // one width per level, and no width without a level.
    expect(unlockersOf('decoder1').map((level) => level.id)).toEqual(['ch2-35-1-bit-decoder']);
    expect(unlockersOf('decoder3').map((level) => level.id)).toEqual(['ch2-37-3-bit-decoder']);
  });
});

// ---------------------------------------------------------------------------
// Rule 3: the unlock never comes after the first level that needs it
// ---------------------------------------------------------------------------

describe('every component is unlocked at or before the first level that lists it', () => {
  it('holds for every component any shipped level offers', () => {
    // The whole-set form of the ordering rule, over BOTH chapters: for each name
    // any level lists, the first level that unlocks it is at or before the first
    // level that offers it. `decoder2` is the one name listed by no level at all,
    // so there is no "first listing" to compare against; the test above owns it.
    const offered = new Set<string>();
    for (const level of LEVELS) for (const def of level.allowedComponents) offered.add(def);

    const problems: string[] = [];
    for (const def of [...offered].sort()) {
      if (STARTERS.has(def)) continue;
      const listing = firstListingOf(def);
      if (listing < 0) continue;
      const unlocking = unlockersOf(def).map((level) => LEVEL_ORDER.indexOf(level.id));
      if (unlocking.length === 0) {
        problems.push(`${def} is offered by ${LEVEL_ORDER[listing]} but unlocked by no level`);
        continue;
      }
      const first = Math.min(...unlocking);
      if (first > listing) {
        problems.push(
          `${def} is first offered by ${LEVEL_ORDER[listing]}, but not unlocked until ${LEVEL_ORDER[first]}`,
        );
      }
    }

    expect(problems, 'components offered before anything unlocks them').toEqual([]);
    // Non-vacuity: the walk actually reached both chapters' palettes.
    expect(offered.size).toBeGreaterThan(20);
  });
});

// ---------------------------------------------------------------------------
// Rule 4: the chapter is 26 levels, indices 13-38, contiguous and unique
// ---------------------------------------------------------------------------

describe('chapter 2 is exactly 26 levels, at indices 14-39', () => {
  it('has 26 levels, one per index from 14 to 39', () => {
    const chapter2 = levelsOfChapter(2);
    expect(chapter2).toHaveLength(26);
    expect(chapter2.map((level) => level.index)).toEqual(
      Array.from({ length: 26 }, (_, offset) => 14 + offset),
    );
    // Contiguous AND unique. Both, because the two are different claims: 26
    // distinct indices could still be 14..38 plus 40, and 14..39 with a repeat
    // would be 26 entries over 25 indices.
    expect(new Set(chapter2.map((level) => level.index)).size).toBe(26);
    expect(new Set(chapter2.map((level) => level.id)).size).toBe(26);
  });

  it('is the chapter join point, whole, with nothing in front of it', () => {
    // `CH2_LEVELS` (`content/ch2/index.ts`) is what `content/index.ts` appends
    // after chapter 1, so this ties the chapter's own export to the game's order.
    // The slice is bounded at BOTH ends: it used to run to the end of the order,
    // which silently became "chapter 2 plus everything appended after it" the
    // moment chapter 3 landed. The chapter's own span is 14..39, so that is what
    // it is compared against.
    //
    // The chapter's export is compared to the game as a SET rather than as a
    // sequence, and that is the 2.x shape rather than a relaxation: the four
    // batches hold scattered slices of the chapter's numbering (batch 1 is 14,
    // 15, 16, 18, 21), so `content/index.ts` sorts the joined set by index and
    // `LEVEL_ORDER` is the campaign's order, not the batches'. The sibling test
    // above is what pins that order; this one pins that the game's chapter-2
    // span is exactly chapter 2, with nothing lost and nothing doubled.
    expect(LEVEL_ORDER.slice(13, 39)).toEqual(levelsOfChapter(2).map((level) => level.id));
    expect([...levelsOfChapter(2)].map((level) => level.id).sort()).toEqual(
      [...CH2_LEVELS].map((level) => level.id).sort(),
    );
    expect(levelsOfChapter(1)).toHaveLength(13);
    expect(LEVELS).toHaveLength(56);
  });
});

// ---------------------------------------------------------------------------
// Rule 4 for chapter 3: ten levels, indices 40-49, and the machine in order
// ---------------------------------------------------------------------------

describe('chapter 3 is exactly 10 levels, at indices 40-49', () => {
  it('has 10 levels, one per index from 40 to 49', () => {
    const chapter3 = levelsOfChapter(3);
    expect(chapter3).toHaveLength(10);
    expect(chapter3.map((level) => level.index)).toEqual(
      Array.from({ length: 10 }, (_, offset) => 40 + offset),
    );
    expect(new Set(chapter3.map((level) => level.index)).size).toBe(10);
    expect(new Set(chapter3.map((level) => level.id)).size).toBe(10);
  });

  it('is the chapter join point, in the same order, with chapter 4 following it', () => {
    // Chapter 3 USED TO BE the last chapter this build ships, so this block's
    // sibling in chapter 2 is the shape that warned about it: `slice(39)` running
    // to the end of the order would have silently become "chapter 3 plus
    // everything appended after it" the moment a later chapter appeared, so the
    // bound was written in regardless -- "the day chapter 4 lands this fails
    // loudly instead of silently widening". Chapter 4 landed in this task and the
    // bound is what kept the assertion honest: chapter 3 is still exactly
    // `LEVEL_ORDER.slice(39, 49)`, and the seven levels after it are chapter 4's,
    // in the campaign's order, at indices 50-56.
    expect(levelsOfChapter(3).map((level) => level.id)).toEqual(
      CH3_LEVELS.map((level) => level.id),
    );
    expect(LEVEL_ORDER.slice(39, 49)).toEqual(CH3_LEVELS.map((level) => level.id));
    expect(LEVEL_ORDER.slice(49)).toEqual(CH4_LEVELS.map((level) => level.id));
  });

  it('hands the six machine parts out one per level, in the order they are built', () => {
    // The chain the plan asks to be pinned, as a chain rather than as six
    // independent facts. `test/levels/ch3-batch*.test.ts` already assert each
    // level's OWN reward, and the row test above asserts each part is unlocked by
    // exactly one chapter-3 level; neither says WHICH one. This is the claim that
    // makes the chapter teach a machine instead of six unrelated parts: the ALU
    // arrives before the level that does arithmetic with it, the register file
    // before the level that decodes into it, `ram_prog` before the three levels
    // whose programs are assembled into it, and `halt` before level 49 needs a
    // place to stop.
    //
    // Written as an explicit table, not derived from the level data: a table
    // derived from the thing it checks cannot disagree with it, and reordering
    // two levels is exactly the regression this is here to catch.
    const expected: ReadonlyArray<readonly [string, string]> = [
      ['ch3-40-alu-1', 'alu8'],
      ['ch3-41-registers', 'regfile6'],
      ['ch3-43-the-foundry', 'instr_decoder'],
      ['ch3-44-instruction-decoder', 'pc8'],
      ['ch3-46-alu', 'ram_prog'],
      ['ch3-45-conditions', 'halt'],
    ];
    for (const [levelId, def] of expected) {
      expect(unlockersOf(def).map((level) => level.id), def).toEqual([levelId]);
    }
    // And each part is first OFFERED at or after the level that unlocks it --
    // "unlocks at level N" is only half the claim; the other half is that no
    // level before N already assumed the player had it.
    for (const [levelId, def] of expected) {
      const unlockAt = LEVEL_ORDER.indexOf(levelId);
      const firstOffered = firstListingOf(def);
      expect(unlockAt, `${def} is unlocked after it is first offered`).toBeGreaterThanOrEqual(0);
      expect(firstOffered, `${def} is never offered by any level`).toBeGreaterThanOrEqual(0);
      expect(
        firstOffered,
        `${def} is offered at ${LEVEL_ORDER[firstOffered]}, before ${levelId} unlocks it`,
      ).toBeGreaterThanOrEqual(unlockAt);
    }
  });
});
