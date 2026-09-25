import { ALL_LEVELS } from './content/index';
import type { LevelSpec } from './spec';

export const LEVELS: readonly LevelSpec[] = ALL_LEVELS;
export const LEVEL_ORDER: readonly string[] = LEVELS.map((l) => l.id);

const byId = new Map(LEVELS.map((l) => [l.id, l]));

export function getLevel(id: string): LevelSpec {
  const level = byId.get(id);
  if (!level) throw new Error(`unknown level: ${id}`);
  return level;
}

export function levelsOfChapter(chapter: number): readonly LevelSpec[] {
  return LEVELS.filter((l) => l.chapter === chapter);
}

export type { LevelSpec };
