import type { LevelSpec } from '../spec';
import { CH1_PART1 } from './ch1/part1';
import { CH1_PART2 } from './ch1/part2';

export const ALL_LEVELS: readonly LevelSpec[] = [...CH1_PART1, ...CH1_PART2];
