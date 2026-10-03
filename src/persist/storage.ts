import { emptyProgress } from '../app/progress';
import type { LevelRecord, Progress } from '../app/progress';
import { currentIdOf } from '../levels/id-map';

/**
 * Persistence for the progress record.
 *
 * `localStorage` is not always there -- the unit tests run in node with no DOM,
 * and a browser in private mode can refuse writes. Nothing in here may throw
 * because of that: the caller keeps the authoritative `Progress` in memory and
 * storage is best-effort, so an unavailable store degrades to a session-only
 * save instead of breaking the game.
 */
export const STORAGE_KEY = 'tc.progress.v1';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Validates and repairs an untrusted progress payload.
 *
 * Returns a FRESH object holding only `version` and `levels`: a save written by
 * an older build may carry fields that no longer have meaning (the stored
 * `unlockedComponents` set, now derived from level rewards), and copying it
 * through would resurrect them.
 *
 * Level keys are translated through `levels/id-map.ts`. The 2.x realignment
 * changed the id of 37 levels and removed three, and a save is keyed by id -- so
 * without this the player's stars would silently belong to levels that no longer
 * exist. A key that is already current passes through untouched, and one that
 * names a retired level is dropped: there is no level left for it to describe.
 */
export function migrate(raw: unknown): Progress {
  if (!isRecord(raw)) {
    throw new Error('not a progress payload');
  }
  if (raw.version !== 1) {
    throw new Error(`unsupported progress version: ${String(raw.version)}`);
  }
  const levels: Record<string, LevelRecord> = {};
  if (isRecord(raw.levels)) {
    for (const [id, record] of Object.entries(raw.levels)) {
      const current = currentIdOf(id);
      if (current !== null) levels[current] = record as LevelRecord;
    }
  }
  return { version: 1, levels };
}

/** Best-effort load; an absent or corrupt store reads as a fresh save. */
export function loadProgress(): Progress {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (!raw) return emptyProgress();
    return migrate(JSON.parse(raw));
  } catch {
    return emptyProgress();
  }
}

/** Best-effort save; without a store the progress simply stays in memory. */
export function saveProgress(progress: Progress): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(progress));
  } catch {
    /* storage unavailable (private mode, tests): progress stays in memory */
  }
}

/** Pretty-printed, so an exported save is readable and diffable by hand. */
export function exportProgress(progress: Progress): string {
  return JSON.stringify(progress, null, 2);
}

/** Throws on malformed JSON and on any payload `migrate` rejects. */
export function importProgress(json: string): Progress {
  return migrate(JSON.parse(json));
}
