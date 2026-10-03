import type { AppState, Store } from '../app/store';
import { paletteDefsFor } from '../app/progress';
import { LEVELS } from '../levels/index';
import type { ComponentCategory } from '../core/registry';
import { partCodeOf } from './board/markings';
import { THEME } from './theme';

/**
 * The parts this level lets the player use, as the original's right-hand
 * component panel.
 *
 * The list comes from `paletteDefsFor`, not from `level.allowedComponents`:
 * the helper intersects the level's palette with what the player has actually
 * unlocked and always keeps the starter set, so level 1 is never empty.
 *
 * Labels are the localised component names -- the player must never be shown a
 * raw def id like `const_on` -- while `onPick` reports the id, because that is
 * what the board stores.
 *
 * THE AUTHORED ORDER IS KEPT. The original groups its panel behind category
 * tabs; this replica has no custom-component family to put behind a tab, so the
 * headings are inline group labels instead. They are inserted where the category
 * changes and never reorder the list, because the order a level lists its parts
 * in is a teaching order -- level 1 hands out `const_on`, `const_off`, then the
 * two level connectors, which is the order the puzzle is meant to be read in.
 *
 * ONLY PART BUTTONS LIVE IN HERE. `panels.test.ts` reads every button in this
 * subtree and compares the labels to the expected palette, so a collapse
 * chevron or a tab strip would read as a component named "▸".
 */
export function mountPalette(
  root: HTMLElement,
  store: Store<AppState>,
  onPick: (defId: string) => void,
): { render(): void } {
  const list = document.createElement('aside');
  list.className = 'palette';
  root.append(list);

  /**
   * The store notifies on every change, including each frame of a pan. The
   * palette's contents only depend on the level and the unlocked set, so it
   * rebuilds its buttons when that pair changes and not once per frame --
   * otherwise a drag would drop button hover and focus state 60 times a second.
   */
  let shown = '';

  const render = (): void => {
    const { level, progress, registry, dev } = store.get();
    const available = paletteDefsFor(progress, LEVELS, level, dev).filter((defId) =>
      registry.has(defId),
    );
    const key = `${level.id}|${available.join(',')}`;
    if (key === shown) return;
    shown = key;

    list.replaceChildren();
    const heading = document.createElement('h2');
    heading.textContent = '元件';
    list.append(heading);

    if (available.length === 0) {
      const empty = document.createElement('span');
      empty.textContent = '本关暂无可用元件';
      empty.style.color = THEME.textMuted;
      list.append(empty);
      return;
    }

    let lastCategory: ComponentCategory | null = null;
    for (const defId of available) {
      const def = registry.get(defId);
      if (def.category !== lastCategory) {
        lastCategory = def.category;
        const group = document.createElement('div');
        group.className = 'palette-group';
        group.textContent = CATEGORY_LABEL[def.category];
        list.append(group);
      }
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'palette-item';
      button.textContent = def.name.zh;
      // The tooltip is where the two vocabularies meet: the tray says 与非门, the
      // board says NAND, and a player who needs to connect them finds the
      // connection here rather than by guessing. Not in the button's own text --
      // the panel tests read that as the part's name.
      button.title = `${def.name.en} · 画板标记 ${partCodeOf(def)} — 点击后在画板上放置`;
      button.addEventListener('click', () => onPick(defId));
      list.append(button);
    }
  };
  store.subscribe(render);
  render();
  return { render };
}

/** The heading a category contributes, in the original's vocabulary. */
const CATEGORY_LABEL: Record<ComponentCategory, string> = {
  logic1: '布尔',
  io: '常量',
  memory1: '存储',
  wide: '整型',
  cpu: '处理器',
  display: '外设',
  probe: '探针',
  level: '关卡',
};
