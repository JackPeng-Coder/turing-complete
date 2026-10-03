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
 * chevron or a tab strip would read as a component named "▸". The one control
 * that does live here carries an `aria-label` and no text: it is the way OUT of
 * a part, and a tray you can only leave by pressing Esc is a tray that traps
 * you -- with a part armed, dragging the board places parts instead of panning
 * it, so "holding nothing" is a state a player has to be able to get back to.
 */
export function mountPalette(
  root: HTMLElement,
  store: Store<AppState>,
  onPick: (defId: string | null) => void,
): { render(): void } {
  const list = document.createElement('aside');
  list.className = 'palette';
  root.append(list);

  const heading = document.createElement('h2');
  heading.textContent = '元件';
  // The way back to holding nothing. Hidden until something is held, because a
  // disabled button that does nothing is worse than one that is not there.
  const release = document.createElement('button');
  release.type = 'button';
  release.className = 'palette-release';
  release.textContent = '✕';
  release.setAttribute('aria-label', '取消选择元件');
  release.title = '取消选择元件（Esc）— 之后可以在画板上拖动';
  release.hidden = true;
  release.addEventListener('click', () => onPick(null));
  heading.append(release);

  /**
   * The store notifies on every change, including each frame of a pan. The
   * palette's contents only depend on the level and the unlocked set, so it
   * rebuilds its buttons when that pair changes and not once per frame --
   * otherwise a drag would drop button hover and focus state 60 times a second.
   *
   * WHICH SLOT IS ARMED IS NOT PART OF THAT KEY. Arming and disarming changes a
   * class on buttons that already exist, so the list is not rebuilt and the
   * button the pointer is over keeps its hover.
   */
  let shown = '';
  /** The slot for each def, so arming one is a class change and not a rebuild. */
  const slots = new Map<string, HTMLButtonElement>();

  const render = (): void => {
    const { level, progress, registry, dev, armed } = store.get();
    const available = paletteDefsFor(progress, LEVELS, level, dev).filter((defId) =>
      registry.has(defId),
    );
    const key = `${level.id}|${available.join(',')}`;

    if (key !== shown) {
      shown = key;
      slots.clear();
      list.replaceChildren(heading);

      if (available.length === 0) {
        const empty = document.createElement('span');
        empty.textContent = '本关暂无可用元件';
        empty.style.color = THEME.textMuted;
        list.append(empty);
      } else {
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
          // The tooltip is where the two vocabularies meet: the tray says 与非门,
          // the board says NAND, and a player who needs to connect them finds the
          // connection here rather than by guessing. Not in the button's own text
          // -- the panel tests read that as the part's name.
          button.title = `${def.name.en} · 画板标记 ${partCodeOf(def)} — 点击后在画板上放置`;
          // NOT a toggle. Clicking a part that is already up keeps it up, because
          // stamping the same part three times in a row is the commonest thing a
          // player does on this board -- and a slot that put itself down on the
          // second click would place one part and then silently stop placing.
          // The ✕ above is the way out, and so is Esc.
          button.addEventListener('click', () => onPick(defId));
          slots.set(defId, button);
          list.append(button);
        }
      }
    }

    // The armed slot is FILLED, the way every other control on this board says
    // "this is on", and it stays lit until the part is placed and the player
    // presses the ✕ -- which is also what the ghost under the pointer shows.
    release.hidden = armed === null;
    for (const [defId, button] of slots) {
      const isArmed = defId === armed;
      button.classList.toggle('palette-item-armed', isArmed);
      button.setAttribute('aria-pressed', String(isArmed));
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
