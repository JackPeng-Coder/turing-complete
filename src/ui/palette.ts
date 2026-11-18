import type { AppState, Store } from '../app/store';
import { offeredDefsFor } from '../app/progress';
import { LEVELS } from '../levels/index';
import { libraryIds } from '../levels/blueprints';
import type { ComponentCategory } from '../core/registry';
import { partCodeOf } from './board/markings';
import { THEME } from './theme';

/**
 * 本关允许玩家使用的元件，即原作右侧的元件面板。
 *
 * 列表来自 `offeredDefsFor`，而不是直接读 `level.allowedComponents`：
 * 那个辅助函数对关卡求「关卡允许的元件」与「玩家已解锁的元件（含本关自己的奖励）」的交集，
 * 对沙盒则给出完整的基础元件集；智能体也调用同一个函数，
 * 所以元件托盘与助手不会对「有什么可用」各说各话。
 *
 * 文字用本地化的元件名称——玩家绝不该看到 `const_on` 这种裸 def id——
 * 而 `onPick` 上报的是 id，因为画板存的是 id。
 *
 * 保留作者写下的顺序。原作把面板收在分类页签后面；本复刻没有可放进页签的
 * 自定义元件家族，所以分类标题改为内联的分组标签。它们只在分类变化处插入，
 * 从不重排列表，因为关卡列出元件的顺序是教学顺序——
 * 第 1 关先给 `const_on`、`const_off`，再给两个关卡连接器，
 * 那正是设计者希望玩家读这道题时遵循的顺序。
 *
 * 这里只放元件按钮。`panels.test.ts` 会读出这棵子树里的每个按钮，
 * 把标签与期望的托盘内容比较，所以一个折叠箭头或页签条都会被读成名为 "▸" 的元件。
 * 这里唯一不是元件的按钮带 `aria-label`、没有文字：它是「放下元件」的出口，
 * 而一个只能靠 Esc 离开的托盘会困住玩家——手里装着元件时，拖动画板是放元件而不是平移，
 * 所以「手里什么都没有」是玩家必须能回到的状态。
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
  // 回到「手里什么都没有」的入口。只在拿着元件时显示，
  // 因为一个按了没反应的禁用按钮，比根本不存在的按钮更糟。
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
   * store 在每次变化时都会通知，包括平移的每一帧。
   * 托盘内容只取决于关卡和已解锁集合，所以只在这对数据变化时重建按钮，而不是每帧重建——
   * 否则一次拖动就会每秒六十次丢掉按钮的悬停与焦点状态。
   *
   * 「哪个槽已装填」不在那个键里。装填与解除只是在已有按钮上改一个 class，
   * 列表不重建，指针下的按钮也就保住了悬停态。
   */
  let shown = '';
  /** 每个 def 对应的槽位，这样装填某个元件只是改 class，而不是重建。 */
  const slots = new Map<string, HTMLButtonElement>();

  const render = (): void => {
    const { level, progress, registry: registry0, dev, armed, blueprints } = store.get();
    // 唯一规则（`offeredDefsFor`），不是它的副本：智能体的托盘由同一个函数推导，
    // 所以托盘与助手不会对「提供了什么」产生分歧。沙盒托盘由 registry 推导而不是由关卡推导，
    // 因为沙盒没有要围绕它设计的谜题；`?dev=1` 在任何画板上都取同样的完整集合，
    // 关卡自己的连接器也会一并出现——详见 `offeredDefsFor`。
    const offered = offeredDefsFor(progress, LEVELS, level, dev, registry0, libraryIds(blueprints));
    const available = offered.filter((defId) => registry0.has(defId));
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
          const def = registry0.get(defId);
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
          // 提示文字是两套词汇相遇的地方：托盘说「与非门」，画板说 NAND，
          // 需要把两者对应起来的玩家在这里找到联系，而不是靠猜。它不写进按钮正文——
          // 面板测试会把正文读成元件名。
          button.title = `${def.name.en} · 画板标记 ${partCodeOf(def)} — 点击后在画板上放置`;
          // 不是开关按钮。再点一次已经装填的元件，它仍然保持装填，
          // 因为连续盖同一个元件三次是这块画板上最常见的行为——
          // 一个第二次点击就自动放下的槽位，会先放一个元件，然后静悄悄不再放。
          // 上面的 ✕ 是出口，Esc 也是。
          button.addEventListener('click', () => onPick(defId));
          slots.set(defId, button);
          list.append(button);
        }
      }
    }

    // 已装填的槽位是填充状态，就像画板上所有表示「开着」的控件；
    // 它一直亮到元件被放下、玩家按下 ✕ 为止——指针下的幽灵预览也在表达同一件事。
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

/** 每个分类贡献的标题，沿用原作的词汇。 */
const CATEGORY_LABEL: Record<ComponentCategory, string> = {
  logic1: '布尔',
  io: '常量',
  memory1: '存储',
  wide: '整型',
  cpu: '处理器',
  display: '外设',
  probe: '探针',
  level: '关卡',
  // 玩家自制元件排在目录之后。这个标题让封装后的选区重新可被找到：
  // `custom` 是唯一一类内容会因玩家而不同的分类。
  custom: '自制元件',
};
