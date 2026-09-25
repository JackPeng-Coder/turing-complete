import { LEVELS } from '../levels/index';
import type { AppState, Store } from '../app/store';
import { isUnlocked } from '../app/progress';
import { THEME } from './theme';

/**
 * The chapter map: one tile per level, in level order.
 *
 * A tile is disabled while its level is locked (`isUnlocked` is strictly
 * linear: level 1 is always open, every other level needs its predecessor
 * passed), carries the star count of a passed level, and is highlighted while
 * it is the level the board has open. Selecting a tile is reported through
 * `onSelect`; the map never changes the level itself, because the caller owns
 * the graph, the undo stack and the briefing that a level change implies.
 */
export function mountMap(
  root: HTMLElement,
  store: Store<AppState>,
  onSelect: (levelId: string) => void,
): { render(): void } {
  const section = document.createElement('section');
  section.className = 'map';
  root.append(section);

  const render = (): void => {
    const { progress, level: current } = store.get();
    const order = LEVELS.map((l) => l.id);
    section.replaceChildren();
    const heading = document.createElement('h2');
    heading.textContent = '章节地图';
    section.append(heading);
    const grid = document.createElement('div');
    grid.className = 'map-grid';
    for (const level of LEVELS) {
      const tile = document.createElement('button');
      tile.type = 'button';
      tile.className = 'map-tile';
      const record = progress.levels[level.id];
      const unlocked = isUnlocked(progress, level.id, order);
      tile.disabled = !unlocked;
      const stars = record?.stars ? ` ${'★'.repeat(record.stars)}` : '';
      tile.textContent = `${level.index}. ${level.name.zh}${stars}`;
      if (level.id === current.id) tile.classList.add('map-tile-current');
      if (record?.passed) tile.style.color = THEME.success;
      else if (!unlocked) tile.style.color = THEME.textMuted;
      tile.addEventListener('click', () => onSelect(level.id));
      grid.append(tile);
    }
    section.append(grid);
  };
  store.subscribe(render);
  render();
  return { render };
}
