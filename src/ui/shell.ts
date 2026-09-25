import type { AppState, Store } from '../app/store';
import { THEME } from './theme';

export interface ShellOptions {
  /** Leave the board and show the chapter map. */
  onOpenMap(): void;
}

/**
 * The top bar: which level is open, what the player has armed in the palette,
 * the last grade, and the way back to the chapter map.
 *
 * It is the first flex child of the app container so the screens below it get
 * the remaining height.
 */
export function mountShell(
  root: HTMLElement,
  store: Store<AppState>,
  options: ShellOptions,
): { render(): void } {
  const bar = document.createElement('header');
  bar.className = 'shell-bar';

  const title = document.createElement('span');
  title.className = 'shell-title';

  const mapButton = document.createElement('button');
  mapButton.type = 'button';
  mapButton.textContent = '章节地图';
  mapButton.addEventListener('click', () => options.onOpenMap());

  const status = document.createElement('span');
  status.className = 'shell-status';

  const metrics = document.createElement('span');
  metrics.className = 'shell-metrics';

  bar.append(title, mapButton, status, metrics);
  root.prepend(bar);

  const render = (): void => {
    const { level, lastGrade, status: message } = store.get();
    title.textContent = `${level.chapter}-${level.index} ${level.name.zh}`;
    status.textContent = message ? message.zh : '';

    if (!lastGrade) {
      metrics.textContent = '尚未评测';
      metrics.style.color = THEME.textMuted;
      return;
    }
    const stars = lastGrade.stars > 0 ? '★'.repeat(lastGrade.stars) : '未通过';
    metrics.textContent = `门 ${lastGrade.metrics.gate} · 延迟 ${lastGrade.metrics.delay} · 拍 ${lastGrade.metrics.tick} · 得分 ${lastGrade.score} · ${stars}`;
    metrics.style.color = lastGrade.passed ? THEME.success : THEME.error;
  };
  store.subscribe(render);
  render();
  return { render };
}
