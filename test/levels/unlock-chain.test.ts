import { describe, expect, it } from 'vitest';
import { STARTER_COMPONENTS } from '../../src/app/progress';
import { DECODER_DEF_IDS } from '../../src/core/defs/wide';
import type { PortValue } from '../../src/core/signal';
import { CH2_LEVELS } from '../../src/levels/content/ch2/index';
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
 * THE COMPONENT LIST IS THE SPEC'S, NOT THE DATA'S. §3.3 of the design spec names
 * the 33 parts chapter 2 introduces; the list below is that list, copied once. If
 * it were derived from the levels it could not fail -- a part nobody rewards
 * would simply not appear in it -- so the two are compared instead: every name on
 * the list must be unlocked by exactly one level (or be one of the two ruled
 * deviations below), and every reward a chapter-2 level hands out that is NOT on
 * the list is named by a test of its own, so a disagreement between the spec and
 * the data is visible rather than absorbed.
 *
 * TWO MORE SPEC-VS-DATA DISAGREEMENTS ARE REPORTED THAT WAY rather than failing a
 * rule -- `ram8` is rewarded by a chapter-2 level but appears nowhere in §3.3,
 * and `switch`/`switch8` unlock at level 22 where §3.3's note says level 32 (see
 * the two tests below). Both are exactly-one-unlock as the rule requires, so the
 * rule passes; what the tests pin is the disagreement itself, so it cannot drift
 * unnoticed.
 *
 * THE TWO RULED DEVIATIONS are encoded as assertions, not as exemptions that
 * silence the rule:
 *
 *  * `mem1` is unlocked by CHAPTER 1's capstone (level 12), not by a chapter-2
 *    level. Chapter 2's latch level builds from it, so it has to exist before
 *    chapter 2 opens; the level data records the ruling and the test below pins
 *    both the level and the chapter.
 *  * `decoder2` is unlocked by NO level. No chapter-2 level name introduces the
 *    2-bit decoder -- the chapter teaches `decoder1` (level 25) and `decoder3`
 *    (level 26), and `decoder2` is the same generator one width up
 *    (`createDecoderDef(2)`, `src/core/defs/wide.ts`). It is registered and
 *    usable, and the test says so; it just never becomes a palette entry.
 *
 * Anything ELSE unlocked by zero or two levels is a real defect -- a part no
 * player can ever hold, or a level whose reward is already in the player's hands
 * -- and the tests below report it by name instead of carving out an exemption.
 */

/**
 * Spec §3.3's chapter-2 component list: the 33 parts the chapter introduces,
 * verbatim.
 */
const CH2_COMPONENTS: readonly string[] = [
  'switch',
  'full_adder',
  'decoder1',
  'decoder2',
  'decoder3',
  'mem1',
  'reg8',
  'counter8',
  'mux8',
  'switch8',
  'splitter',
  'maker',
  'const8',
  'add8',
  'neg8',
  'and8',
  'or8',
  'not8',
  'nand8',
  'nor8',
  'xor8',
  'xnor8',
  'less_s',
  'less_u',
  'equal8',
  'shift_l8',
  'shift_r8',
  'ashr8',
  'rot_l8',
  'rot_r8',
  'mul8',
  'div8',
  'delay8',
];

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
// Rule 2: every listed part is unlocked by exactly one level
// ---------------------------------------------------------------------------

describe("every part in spec §3.3's chapter-2 list is unlocked by exactly one level", () => {
  it('walks the spec list itself, with no repeats and nothing dropped', () => {
    // Non-vacuity for the rule below: a shortened or de-duplicated list would
    // quietly stop checking parts, and a duplicate would double-count one part
    // while hiding another.
    expect(CH2_COMPONENTS).toHaveLength(33);
    expect(new Set(CH2_COMPONENTS).size).toBe(33);
  });

  it('hands out every listed part at exactly one chapter-2 level, bar the rulings', () => {
    const errors: string[] = [];

    for (const def of CH2_COMPONENTS) {
      // The two ruled deviations, each pinned by its own test below.
      if (def === 'mem1' || def === 'decoder2') continue;
      const unlockers = unlockersOf(def);
      if (unlockers.length !== 1) {
        const who = unlockers.map((level) => level.id).join(', ') || 'no level';
        errors.push(`${def} is unlocked by ${unlockers.length} levels: ${who}`);
        continue;
      }
      // And the one level is a chapter-2 level: a part the chapter teaches must
      // not be a chapter-1 handout, which is exactly what makes `mem1` a ruling.
      const unlocker = unlockers[0]!;
      if (unlocker.chapter !== 2) {
        errors.push(`${def} is unlocked by ${unlocker.id}, which is chapter ${unlocker.chapter}`);
      }
    }

    expect(errors, 'components not unlocked by exactly one chapter-2 level').toEqual([]);
  });

  it('rewards one part the spec list does not name: ram8 -- a reported finding', () => {
    // FINDING, pinned rather than silenced. Spec §3.3's chapter-2 row names 33
    // parts and no RAM at all -- the spec's only RAMs are `ram_prog` (ch3) and
    // the `ram*` family (ch5) -- but this replica's chapter 2 hands out `ram8`
    // (the 256-byte memory level 37's little box is built from) at level 28.
    // Level 28's own data comment rules on it ("`ram8` is this level's reward and
    // is deliberately not in its palette"), the same shape as chapter 1's
    // capstone rewarding `mem1` without listing it.
    //
    // It is asserted as a FACT rather than exempted from a rule: `ram8` is not on
    // §3.3's list, so rule 2 cannot cover it. What this fails on is a SECOND
    // unnamed part appearing, or `ram8` changing hands -- either of which is
    // spec/data drift nobody has ruled on.
    const extra = [
      ...new Set(levelsOfChapter(2).flatMap((level) => [...rewardsOf(level)])),
    ].filter((def) => !CH2_COMPONENTS.includes(def));
    expect(extra, "chapter-2 rewards outside spec §3.3's list").toEqual(['ram8']);
    expect(unlockersOf('ram8').map((level) => level.id)).toEqual(['ch2-28-circular-dependency']);
    // Load-bearing: level 37 lists `ram8`, so if level 28 stopped rewarding it,
    // level 37 would offer a part no level unlocks and the buildability walk
    // would fail. The unlock really does precede the first listing.
    expect(LEVEL_ORDER.indexOf('ch2-28-circular-dependency')).toBeLessThan(
      LEVEL_ORDER.indexOf('ch2-37-little-box'),
    );
  });

  it('unlocks switch and switch8 at level 22, not the level 32 the spec prose names', () => {
    // FINDING, pinned for the same reason. §3.3's note on `switch` says it is
    // deferred to chapter 2 and "unlocks at level 32 together with `switch8`";
    // the level data unlocks both at level 22 (adding bytes), which is the
    // earliest level that lists them. The data cannot follow the prose: level
    // 28's reference solution is built from two `switch` parts and its palette
    // lists `switch`, and level 22 lists both in its own palette -- a part
    // offered at or before level 28 has to be unlocked at or before it.
    //
    // Rule 2 is satisfied either way (exactly one level unlocks each), which is
    // why this is recorded here instead of failing the rule: what it pins is
    // WHERE, so a later move of either reward is visible.
    expect(unlockersOf('switch').map((level) => level.id)).toEqual(['ch2-22-adding-bytes']);
    expect(unlockersOf('switch8').map((level) => level.id)).toEqual(['ch2-22-adding-bytes']);
  });

  it('unlocks mem1 at chapter 1 level 12 -- the first ruled deviation', () => {
    // Ruled: chapter 2's latch level builds from `mem1`, and the part is handed
    // out by chapter 1's capstone so it exists before chapter 2 opens. Both
    // halves are asserted, because "unlocked by chapter 1" is only half the
    // ruling -- it is one specific level, and it is the last one of chapter 1.
    const unlockers = unlockersOf('mem1');
    expect(unlockers.map((level) => level.id)).toEqual(['ch1-12-binary-racer']);
    const capstone = unlockers[0]!;
    expect(capstone.chapter).toBe(1);
    expect(capstone.index).toBe(12);
    // It is NOT a chapter-2 reward, and no chapter-2 level rewinds the chain by
    // handing it out again.
    expect(levelsOfChapter(2).filter((level) => rewardsOf(level).includes('mem1'))).toEqual([]);
  });

  it('registers decoder2 and records that no level unlocks it -- the second ruling', () => {
    // Ruled: no chapter-2 level name introduces the 2-bit decoder. The chapter
    // teaches `decoder1` (level 25) and `decoder3` (level 26) and `decoder2` is
    // the same generated family one width up, so it is registered and usable
    // without ever becoming a palette entry. Zero unlockers is the ruling, stated
    // as an assertion so it cannot drift into a silent "somebody rewards it now".
    expect(unlockersOf('decoder2').map((level) => level.id)).toEqual([]);

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

    // The family's other two widths ARE unlocked, by exactly one level each:
    // this is what makes "no level introduces decoder2" a statement about the
    // name and not about the family being unreachable.
    expect(unlockersOf('decoder1').map((level) => level.id)).toEqual(['ch2-25-1-bit-decoder']);
    expect(unlockersOf('decoder3').map((level) => level.id)).toEqual(['ch2-26-3-bit-decoder']);
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

describe('chapter 2 is exactly 26 levels, at indices 13-38', () => {
  it('has 26 levels, one per index from 13 to 38', () => {
    const chapter2 = levelsOfChapter(2);
    expect(chapter2).toHaveLength(26);
    expect(chapter2.map((level) => level.index)).toEqual(
      Array.from({ length: 26 }, (_, offset) => 13 + offset),
    );
    // Contiguous AND unique. Both, because the two are different claims: 26
    // distinct indices could still be 13..37 plus 40, and 13..38 with a repeat
    // would be 26 entries over 25 indices.
    expect(new Set(chapter2.map((level) => level.index)).size).toBe(26);
    expect(new Set(chapter2.map((level) => level.id)).size).toBe(26);
  });

  it('is the chapter join point, in the same order, with nothing in front of it', () => {
    // `CH2_LEVELS` (`content/ch2/index.ts`) is what `content/index.ts` appends to
    // chapter 1, so this ties the chapter's own export to the game's order.
    expect(levelsOfChapter(2).map((level) => level.id)).toEqual(
      CH2_LEVELS.map((level) => level.id),
    );
    expect(LEVEL_ORDER.slice(12)).toEqual(CH2_LEVELS.map((level) => level.id));
    expect(levelsOfChapter(1)).toHaveLength(12);
    expect(LEVELS).toHaveLength(38);
  });
});
