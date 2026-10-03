import { LEVELS } from '../levels/index';
import type { AppState, Store } from '../app/store';
import { isUnlocked } from '../app/progress';
import { THEME } from './theme';

/**
 * The chapter map: one tile per level, in level order, banded by chapter.
 *
 * A tile is disabled while its level is locked (`isUnlocked` is strictly
 * linear: level 1 is always open, every other level needs its predecessor
 * passed), carries the star count of a passed level, and is highlighted while
 * it is the level the board has open. Selecting a tile is reported through
 * `onSelect`; the map never changes the level itself, because the caller owns
 * the graph, the undo stack and the briefing that a level change implies.
 *
 * THE BANDS ARE THE POINT. Forty-seven tiles in one grid was a list; the levels
 * are seven chapters and where a chapter ends is the single most useful fact on
 * this screen. Each band carries its own key -- the chapter, how many levels it
 * holds, and how many of its stars the player has -- so progress is legible
 * without counting tiles.
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
    const { progress, level: current, dev } = store.get();
    const order = LEVELS.map((l) => l.id);
    section.replaceChildren();
    const heading = document.createElement('h2');
    heading.textContent = '章节地图';
    section.append(heading);

    const chapters: number[] = [];
    for (const level of LEVELS) {
      if (!chapters.includes(level.chapter)) chapters.push(level.chapter);
    }

    for (const chapter of chapters) {
      const band = document.createElement('section');
      band.className = 'map-chapter';

      const inChapter = LEVELS.filter((level) => level.chapter === chapter);
      const earned = inChapter.reduce(
        (total, level) => total + (progress.levels[level.id]?.stars ?? 0),
        0,
      );
      const key = document.createElement('div');
      key.className = 'map-chapter-key';
      const number = document.createElement('b');
      number.textContent = `CH.${chapter}`;
      const size = document.createElement('span');
      size.textContent = `${inChapter.length} 关`;
      const stars = document.createElement('span');
      stars.textContent = `★ ${earned} / ${inChapter.length * 3}`;
      key.append(number, size, stars);
      band.append(key);

      const grid = document.createElement('div');
      grid.className = 'map-grid';
      for (const level of inChapter) {
        const tile = document.createElement('button');
        tile.type = 'button';
        tile.className = 'map-tile';
        const record = progress.levels[level.id];
        const unlocked = isUnlocked(progress, level.id, order, dev);
        tile.disabled = !unlocked;
        // The number lives in its own element rather than in the tile's text: it
        // is an address, it belongs in the address column, and it stays in the
        // button's accessible name by being a real node.
        const order0 = document.createElement('span');
        order0.className = 'map-tile-index';
        order0.textContent = String(level.index);
        const label = document.createElement('span');
        label.className = 'map-tile-name';
        label.textContent = `${level.name.zh}${record?.stars ? ` ${'★'.repeat(record.stars)}` : ''}`;
        tile.append(order0, label);
        if (level.id === current.id) tile.classList.add('map-tile-current');
        if (record?.passed) tile.style.color = THEME.success;
        else if (!unlocked) tile.style.color = THEME.textMuted;
        tile.addEventListener('click', () => onSelect(level.id));
        grid.append(tile);
      }
      band.append(grid);
      section.append(band);
    }
  };
  store.subscribe(render);
  render();
  return { render };
}
