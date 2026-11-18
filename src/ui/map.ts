import { LEVELS } from '../levels/index';
import { SANDBOX_ID } from '../levels/sandbox';
import type { AppState, Store } from '../app/store';
import { isUnlocked } from '../app/progress';
import { THEME } from './theme';

/**
 * 章节地图：按关卡顺序每关一块瓷砖，并按章节分带。
 *
 * 关卡未解锁时瓷砖禁用（`isUnlocked` 是严格线性的：第 1 关永远开放，
 * 其余每一关都要先通过它的前一关），已通过的关卡带着星数，
 * 而画板当前打开的关卡会被高亮。选中瓷砖通过 `onSelect` 上报；
 * 地图本身从不切换关卡，因为切换关卡牵连的电路图、撤销栈和简报都由调用方拥有。
 *
 * 分带才是这张图的意义。几十块瓷砖挤进一个网格只是一份清单；
 * 关卡按章节组织（战役整体规划为七章），而「一章到哪里结束」是这一屏上最有用的一条信息。
 * 每一带自带说明：章节号、本带关卡数、玩家在本带已拿到的星数，
 * 所以不用数瓷砖就能读懂进度。
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

    for (const chapter of chapters) {      const band = document.createElement('section');
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
        // 序号放在自己的元素里而不是瓷砖的文本里：它是一个地址，属于地址列；
        // 作为真实节点，它又仍然会留在按钮的无障碍名称里。
        const order0 = document.createElement('span');
        order0.className = 'map-tile-index';
        order0.textContent = String(level.index);
        const label = document.createElement('span');
        label.className = 'map-tile-name';
        label.textContent = `${level.name.zh}${record?.stars ? ` ${'★'.repeat(record.stars)}` : ''}`;
        tile.append(order0, label);
        if (level.id === current.id) tile.classList.add('map-tile-current');        if (record?.passed) tile.style.color = THEME.success;
        else if (!unlocked) tile.style.color = THEME.textMuted;
        tile.addEventListener('click', () => onSelect(level.id));
        grid.append(tile);
      }
      band.append(grid);
      section.append(band);
    }

    // 沙盒不是一个章节，但对玩家来说，它是同一类东西：一个可以去的地方。
    // 所以它沿用章节带的形状——左边一列说明，右边一扇门——
    // 而不是在最后一个网格下面丢一个按钮；那样看起来像补丁，还破坏了页面的左边缘。
    const sandbox = document.createElement('section');
    sandbox.className = 'map-chapter map-sandbox';
    const key = document.createElement('div');
    key.className = 'map-chapter-key';
    const mark = document.createElement('b');
    mark.textContent = '自由';
    const size = document.createElement('span');
    size.textContent = '沙盒';
    const note = document.createElement('span');
    note.textContent = '无判定';
    key.append(mark, size, note);

    const body = document.createElement('div');
    body.className = 'map-sandbox-body';
    const enter = document.createElement('button');
    enter.type = 'button';
    enter.className = 'map-sandbox-open';
    const line = document.createElement('span');
    line.className = 'map-sandbox-name';
    line.textContent = '自由建造';
    const detail = document.createElement('span');
    detail.className = 'map-sandbox-note';
    detail.textContent = '整个元件目录 · 电路存盘 · 可导出成文件';
    enter.append(line, detail);
    enter.title = '没有题目、没有判定：拿任何元件搭任何东西，电路一直在跑';
    enter.addEventListener('click', () => onSelect(SANDBOX_ID));
    if (current.id === SANDBOX_ID) enter.classList.add('map-tile-current');
    body.append(enter);
    sandbox.append(key, body);
    section.append(sandbox);
  };
  store.subscribe(render);
  render();
  return { render };
}
