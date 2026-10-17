import { scoreOf } from '../levels/grader';
import type { GradeResult, Metrics } from '../levels/grader';
import type { Registry } from '../core/registry';
import type { LevelSpec } from '../levels/spec';
import type { BlueprintLibrary } from '../levels/blueprints';
import { isSandbox } from '../levels/sandbox';

export interface LevelRecord {
  readonly passed: boolean;
  readonly best: Metrics | null;
  readonly stars: 0 | 1 | 3;
}

export interface Progress {
  readonly version: 1;
  readonly levels: Record<string, LevelRecord>;
  /**
   * The player's program text, keyed by level id.
   *
   * SAVED WITH THE STARS because on a programming level the text IS the work:
   * the board is handed to the player already built (`LevelSpec.board`), so a
   * refresh that dropped the program would drop the level. Keys are level ids and
   * go through the same translation as `levels` (`persist/storage.ts`), so a
   * program cannot outlive the level it was written for.
   *
   * Not every level has an entry: the map is sparse, and a level that has never
   * been typed into simply has no key. `AppState.programs` is the reader's view
   * of it, with `''` for the missing case.
   */
  readonly programs: Record<string, string>;
  /**
   * The player's own components, keyed by component id.
   *
   * SAVED WITH THE STARS, like the programs, and for the same reason: a component
   * is work, and it is work that outlives the circuit it was built in. This is
   * the LIBRARY -- the durable half -- and a circuit references an entry by id
   * (`Instance.def`), so the two can never disagree about what a part contains.
   *
   * ONE HOME, NOT TWO. A `Graph` also has a `customComponents` field, and this is
   * where its entries live: the graph is the DOCUMENT (what is on the board) and
   * the library is the RECORD (what the player has built). A circuit file carries
   * the entries it needs inline (`persist/circuit.ts`) so an exported file is
   * self-contained, and importing one merges them back in here; nothing else
   * duplicates them, so there is no second copy to fall out of sync.
   */
  readonly blueprints: BlueprintLibrary;
}

/**
 * Always available, whatever the player has unlocked.
 *
 * This is NOT just the level I/O plumbing. Level 1 offers `const_on` and its
 * reference solution IS `const_on -> level_output`, so the constants have to be
 * available from the very first level -- they cannot come from an earlier
 * reward, because there is no earlier level. Keeping them out of this set makes
 * level 1's palette empty of anything that can drive an output, which is the
 * "level 1 is unplayable" defect this derivation exists to prevent.
 *
 * This is the single copy: the chapter-1 gating tests import it instead of
 * each seeding their own walk with a lookalike list.
 */
export const STARTER_COMPONENTS = [
  'level_input',
  'level_output',
  'const_on',
  'const_off',
] as const;

/**
 * The scoring weights, re-exported rather than redeclared.
 *
 * `levels/grader.ts` owns the formula; a second copy here would let the two
 * drift, and a drifted copy silently invalidates every level's three-star
 * target. Consumers that need the weights import them from either module and
 * get the same object.
 */
export { SCORE_WEIGHTS } from '../levels/grader';

export function emptyProgress(): Progress {
  return { version: 1, levels: {}, programs: {}, blueprints: {} };
}

/**
 * Level unlocking is strictly linear: the first level is always reachable, and
 * every other one needs its immediate predecessor passed. `order` is the
 * authoritative level sequence (see `LEVEL_ORDER`).
 *
 * `dev` opens all of them (`app/dev.ts`). It is the last parameter rather than a
 * second function so that a caller cannot reach for "the unlocked check" and
 * silently get the gated one; `paletteDefsFor` takes the same flag, and passing
 * it to one and not the other gives a level you can open but not build.
 */
export function isUnlocked(
  progress: Progress,
  levelId: string,
  order: readonly string[],
  dev = false,
): boolean {
  const index = order.indexOf(levelId);
  if (index < 0) throw new Error(`unknown level: ${levelId}`);
  if (dev) return true;
  if (index === 0) return true;
  const previous = order[index - 1]!;
  return progress.levels[previous]?.passed === true;
}

/**
 * First reachable level that has not been passed; the last level if all are.
 *
 * Deliberately NOT "the last unlocked level": that skips work whenever the
 * player reopens an older level, because passing level 3 unlocks level 4 while
 * levels 5+ stay locked, yet the last unlocked level is 4 -- resuming there
 * would jump over level 4 only by accident and over nothing at all once the
 * player has passed levels out of order.
 */
export function resumePointOf(progress: Progress, order: readonly string[]): string {
  if (order.length === 0) throw new Error('empty level order');
  for (const id of order) {
    if (isUnlocked(progress, id, order) && progress.levels[id]?.passed !== true) return id;
  }
  return order[order.length - 1]!;
}

/**
 * The unlocked component set is *derived*, not stored: every reward from a
 * passed level, plus the starter components. Storing it as well lets the two
 * drift apart after importing an older save, which shows up as "the level
 * requires NAND but progress has no NAND".
 */
export function unlockedComponents(
  progress: Progress,
  levels: readonly LevelSpec[],
): Set<string> {
  const unlocked = new Set<string>(STARTER_COMPONENTS);
  for (const level of levels) {
    if (progress.levels[level.id]?.passed !== true) continue;
    for (const component of level.rewards?.components ?? []) unlocked.add(component);
  }
  return unlocked;
}

/**
 * Parts offered by this level that the player has actually unlocked.
 *
 * The level's own palette is the upper bound: a reward that this level does not
 * offer stays out of it, so the player can only build what the level allows.
 *
 * A level's OWN rewards are offered to build with, before the level is passed.
 * The parts a level hands out are the parts its puzzle was designed around, so
 * withholding them until the player has already solved it is backwards. Level 13
 * is the case that named the rule: its parity puzzle cannot be built without the
 * `splitter` it rewards -- every chapter-1 part has 1-bit pins, and a wire from
 * the 4-bit input copies bit 0 alone -- so a first-time palette that omitted it
 * could not build the level it was a palette for.
 *
 * The asymmetry with `allowedComponents` is deliberate and load-bearing. A
 * level's own reward is offered to *build* with, but the palette still stays
 * bounded by that level's own list, so a part the level does not offer stays out
 * even once it is unlocked: level 12 rewards `mem1` without listing it, and its
 * palette is unchanged by that. The other half -- that a level may not offer a
 * part no level at or before it hands out -- is not enforced here at all, and
 * cannot be: it is a property of the level data, and
 * `test/levels/level-buildability.test.ts` walks every shipped level for it.
 *
 * This is a NO-OP for chapter 1, verified rather than assumed: no chapter-1
 * level lists its own reward, and every chapter-1 reference solution draws only
 * on parts an earlier level rewards. `test/app/progress.test.ts` states the rule
 * for a synthetic level, and the buildability walk's `chapter 1 palettes are
 * unchanged` block pins both halves of that claim on the shipped data.
 *
 * `dev` skips the unlocked half of the intersection and keeps the other: the
 * level's own list is still the upper bound, because dev mode is "open every
 * gate", not "hand out parts this level was never designed around". The same
 * flag opens the levels themselves -- see `isUnlocked`.
 */
export function paletteDefsFor(
  progress: Progress,
  levels: readonly LevelSpec[],
  level: LevelSpec,
  dev = false,
): string[] {
  if (dev) return [...level.allowedComponents];
  const unlocked = new Set([
    ...unlockedComponents(progress, levels),
    ...(level.rewards?.components ?? []),
  ]);
  return level.allowedComponents.filter((def) => unlocked.has(def));
}

/**
 * Every part the sandbox offers, in registry order.
 *
 * THE SANDBOX IS NOT A LEVEL, so its palette is not a level's palette: there is
 * no `allowedComponents` to intersect with, because there is no puzzle to design
 * around. What it offers instead:
 *
 *  * every BASE part -- the registry's own defs, less the `hidden` plumbing, so
 *    the palette cannot drift from the components that exist; a part added to the
 *    game is offered here without a second list to update. Wide components are
 *    included: they are ordinary registry defs, and "16-bit" is a phase-5
 *    question about widths, not about whether the sandbox may use `add8`.
 *  * plus everything the campaign has handed the player, which for the base parts
 *    is already true, so the union only ever ADDS a player's own components --
 *    passed in as `extra` because a component is data (`Progress.blueprints`)
 *    rather than a registry entry.
 *
 * `dev` widens nothing here (the base set is already complete) and is accepted so
 * the two palettes take the same arguments: a caller that passes the flag to
 * `paletteDefsFor` and forgets it here would otherwise be a silent difference
 * between two screens that are meant to be parallel.
 */
export function sandboxPaletteDefs(
  registry: Registry,
  extra: readonly string[] = [],
): string[] {
  const offered = registry
    .all()
    .filter((def) => def.hidden !== true && def.category !== 'level')
    .map((def) => def.id);
  const seen = new Set(offered);
  for (const id of extra) {
    if (seen.has(id)) continue;
    seen.add(id);
    offered.push(id);
  }
  return offered;
}

/**
 * The parts a board offers, whichever board it is.
 *
 * ONE RULE, THREE CALLERS. The parts tray draws this list, the agent's
 * `list_parts` reports it, and `place_part` refuses anything outside it. Two
 * copies of "what is on offer" is exactly how the tray and the assistant drift
 * apart -- so all three call this, and a change here is a change everywhere.
 *
 * DEVELOPER MODE ONLY RELAXES THE UNLOCK FILTER; IT ADDS NO PARTS. A level's
 * `allowedComponents` IS the puzzle, and `?dev=1` merely stops hiding the listed
 * parts the campaign has not handed out yet (`paletteDefsFor`'s `dev` parameter).
 * A level's own connectors are on that list, so a four-bit level under `?dev=1`
 * still offers `level_input`/`level_output`; an 8-bit adder on level 1 is not
 * offered, to the player or to the assistant. The sandbox is the exception,
 * because it is not a puzzle: there is no list to intersect with, so it offers
 * every base part (see `sandboxPaletteDefs`).
 */
export function offeredDefsFor(
  progress: Progress,
  levels: readonly LevelSpec[],
  level: LevelSpec,
  dev: boolean,
  registry: Registry,
  extra: readonly string[] = [],
): string[] {
  if (isSandbox(level)) return sandboxPaletteDefs(registry, extra);
  return paletteDefsFor(progress, levels, level, dev);
}

/**
 * Records a pass: keeps the best score and the best star rating. Pure.
 *
 * `grade()` scores ANY valid-graph circuit, including one that fails its
 * checks, so a failed attempt is rejected before anything is written. The
 * comparison is against the grader's own `scoreOf`, not a local re-derivation:
 * one formula, one place to change it.
 *
 * `programs` IS CARRIED THROUGH, with the same reference. This function returns a
 * fresh record holding only the fields it knows about, so a field it forgets is
 * deleted rather than left stale -- and the moment a level is passed is the worst
 * moment to lose the player's program, because the run that proves it works is
 * the run that would erase it. Nothing here edits a program, so the map is shared
 * rather than copied.
 */
export function applyGrade(
  progress: Progress,
  level: LevelSpec,
  result: GradeResult,
): Progress {
  if (!result.passed) return progress;

  const previous = progress.levels[level.id];
  const best = previous?.best ?? null;
  const improved = best === null || result.score < scoreOf(best);

  return {
    version: 1,
    levels: {
      ...progress.levels,
      [level.id]: {
        passed: true,
        best: improved ? { ...result.metrics } : best,
        stars: Math.max(previous?.stars ?? 0, result.stars) as 0 | 1 | 3,
      },
    },
    programs: progress.programs,
    blueprints: progress.blueprints,
  };
}
