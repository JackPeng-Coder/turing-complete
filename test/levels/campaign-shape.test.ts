/**
 * The campaign's shape, held to `src/levels/campaign.ts`.
 *
 * The table in that file is the 2.x target (the sourced 93-level table's
 * chapters 1-4). This test is what makes it binding: id, chapter, global index
 * and both names have to agree exactly, in that order, and no level may exist
 * that the table does not name.
 *
 * It exists because the shape is the one thing that cannot be checked by looking
 * at a single level. The realignment that introduced it was prompted by exactly
 * this class of bug: a level object can be perfectly valid on its own while the
 * campaign it sits in is wrong -- two levels sharing one puzzle, a part that no
 * level ever hands out, a global index that skips a number.
 */
import { describe, expect, it } from 'vitest';
import { CAMPAIGN } from '../../src/levels/campaign';
import { LEVELS, LEVEL_ORDER, levelsOfChapter } from '../../src/levels/index';

describe('the campaign shape', () => {
  it('is exactly the table, in order', () => {
    expect(LEVEL_ORDER).toEqual(CAMPAIGN.map((entry) => entry.id));
  });

  it('gives every level the chapter, index and two names the table names', () => {
    const offenders: string[] = [];
    for (const entry of CAMPAIGN) {
      const level = LEVELS.find((candidate) => candidate.id === entry.id);
      if (!level) {
        offenders.push(`${entry.id}: no such level`);
        continue;
      }
      if (level.chapter !== entry.chapter)
        offenders.push(`${entry.id}: chapter ${level.chapter}, table says ${entry.chapter}`);
      if (level.index !== entry.index)
        offenders.push(`${entry.id}: index ${level.index}, table says ${entry.index}`);
      if (level.name.zh !== entry.zh)
        offenders.push(`${entry.id}: zh "${level.name.zh}", table says "${entry.zh}"`);
      if (level.name.en !== entry.en)
        offenders.push(`${entry.id}: en "${level.name.en}", table says "${entry.en}"`);
    }
    expect(offenders).toEqual([]);
  });

  it('ships four chapters of 13, 26, 10 and 7 levels', () => {
    expect(LEVELS).toHaveLength(CAMPAIGN.length);
    expect([1, 2, 3, 4].map((chapter) => levelsOfChapter(chapter).length)).toEqual([
      13, 26, 10, 7,
    ]);
  });

  it('numbers the levels 1..56 with no gap, repeat or stray', () => {
    expect(LEVELS.map((level) => level.index)).toEqual(CAMPAIGN.map((_, i) => i + 1));
    expect(new Set(LEVEL_ORDER).size).toBe(LEVEL_ORDER.length);
    const named = new Set(CAMPAIGN.map((entry) => entry.id));
    expect(LEVELS.filter((level) => !named.has(level.id)).map((level) => level.id)).toEqual([]);
  });
});
