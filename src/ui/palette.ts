import type { AppState, Store } from '../app/store';
import { paletteDefsFor } from '../app/progress';
import { LEVELS } from '../levels/index';
import { THEME } from './theme';

/**
 * The parts this level lets the player use, as buttons.
 *
 * The list comes from `paletteDefsFor`, not from `level.allowedComponents`:
 * the helper intersects the level's palette with what the player has actually
 * unlocked and always keeps the starter set, so level 1 is never empty.
 *
 * Labels are the localised component names -- the player must never be shown a
 * raw def id like `const_on` -- while `onPick` reports the id, because that is
 * what the board stores.
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
    const { level, progress, registry } = store.get();
    const available = paletteDefsFor(progress, LEVELS, level).filter((defId) =>
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

    for (const defId of available) {
      const def = registry.get(defId);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'palette-item';
      button.textContent = def.name.zh;
      button.title = `${def.name.en} — 点击后在画板上放置`;
      button.addEventListener('click', () => onPick(defId));
      list.append(button);
    }
  };
  store.subscribe(render);
  render();
  return { render };
}
