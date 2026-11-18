import type { AppState, Store } from '../app/store';
import type { BlueprintLibrary } from '../levels/blueprints';
import type { WrapPlan } from '../levels/wrap';
import { THEME } from './theme';

/**
 * 玩家自制的元件：已经有哪些、一次封装即将产生什么，以及进入元件内部的入口。
 *
 * 为什么它是一个面板而不是画板上的东西：元件在世界里没有位置——在被放到画板上之前，
 * 你没法指着某个位置说「就是这个」。所以元件列表属于界面外壳，像元件托盘和测试矩阵
 * 一样浮在舞台上方，只在它所依赖的数据变化时重建。
 *
 * 草案是封装流程的核心。封装是一条命令（`wrap.ts`），而命令不能在玩家输入名字的中途
 * 只执行一半，所以面板先展示推导出的接口面（哪几根导线变成哪几个引脚）、给元件命名，
 * 最后才提交；在按下「确定」之前，画板上没有任何东西移动。
 *
 * 接口面上列出的部分，如果封装没能重绘（管路引脚、嵌套元件），会以计数告警报告出来：
 * 悄悄丢掉一条连接，是玩家唯一看不见的后果。
 */
export interface BlueprintPanelOptions {
  /** 正在起草的封装计划；没有草案时为 `null`。 */
  draft(): WrapPlan | null;
  /** 画板上选中的实例数，按钮据此在文字里报出数量。 */
  selection(): number;
  /** 草案提交时将使用的名字，即两个输入框里此刻的值。 */
  draftName(): { zh: string; en: string };
  onDraftName(name: { zh: string; en: string }): void;
  /** 提交草案：封装真正在这里发生。 */
  onConfirm(): void;
  onCancel(): void;
  /** 开始封装当前选区；只在有选中实例时调用（按钮在 0 选中时禁用）。 */
  onStartWrap(): void;
  onRename(id: string, name: { zh: string; en: string }): void;
  /** 尝试删除元件；它仍被画板实例使用时返回 `false`。 */
  onDelete(id: string): boolean;
  onEnter(id: string): void;
  onLeave(): void;
}

export function mountBlueprintPanel(
  root: HTMLElement,
  store: Store<AppState>,
  options: BlueprintPanelOptions,
): { render(): void } {
  const panel = document.createElement('section');
  panel.className = 'blueprints';
  root.append(panel);

  /**
   * 玩家展开了哪一行元件，好让这一行的操作按钮出现在屏幕上。
   *
   * 放在面板内部而不是 store 里：哪一行展开并不是关于文档的事实，只是界面状态；
   * 放进 `AppState` 会让它一变就触发其它所有面板重渲染。
   */
  let open: string | null = null;

  /** 两个名字输入框跨渲染保留，这样输入到一半不会被某次重建打断。 */
  const zh = document.createElement('input');
  const en = document.createElement('input');

  const render = (): void => {
    const { blueprints, editing } = store.get();
    const draft = options.draft();
    panel.replaceChildren();

    const head = document.createElement('div');
    head.className = 'card-head';
    const title = document.createElement('span');
    title.textContent = '自制元件';
    const count = document.createElement('span');
    count.className = 'blueprints-count';
    count.textContent = `${Object.keys(blueprints).length}`;
    head.append(title, count);
    panel.append(head);

    if (editing !== null) {
      const crumb = document.createElement('div');
      crumb.className = 'blueprints-crumb';
      const label = document.createElement('span');
      label.textContent = `编辑中：${nameOf(blueprints, editing)}`;
      const back = button('返回', () => options.onLeave());
      back.className = 'blueprints-leave';
      crumb.append(label, back);
      panel.append(crumb);
      return;
    }

    if (draft) {
      const note = document.createElement('p');
      note.className = 'blueprints-note';
      note.textContent =
        '框选的部分会被封装成一个元件：穿过选区边界的导线各成为一个引脚，内部的导线随之收进去。';
      panel.append(note);

      const nameRow = document.createElement('div');
      nameRow.className = 'blueprints-name';
      zh.placeholder = '元件名（中文）';
      en.placeholder = 'component name (english)';
      if (zh.value === '' || zh.dataset.draft !== draft.component.id) {
        const suggested = options.draftName();
        zh.value = suggested.zh;
        en.value = suggested.en;
        zh.dataset.draft = draft.component.id;
        en.dataset.draft = draft.component.id;
      }
      const sync = (): void => options.onDraftName({ zh: zh.value, en: en.value });
      zh.oninput = sync;
      en.oninput = sync;
      nameRow.append(zh, en);
      panel.append(nameRow);

      const inputs = pinList('输入', draft.inputs.map((pin) => `${pin.id} ← ${pin.label}`));
      const outputs = pinList('输出', draft.outputs.map((pin) => `${pin.id} → ${pin.label}`));
      panel.append(inputs, outputs);
      if (draft.undeclared > 0) {
        const warn = document.createElement('p');
        warn.className = 'blueprints-warn';
        // 哪些跨边界连接被留在了外面，用数量表示：玩家看得见画板上它们还在，这句就是面板把话说出来。
        warn.textContent = `${draft.undeclared} 条跨边界的导线无法收进元件（关卡引脚或嵌套元件），已留在画板上。`;
        panel.append(warn);
      }

      const actions = document.createElement('div');
      actions.className = 'blueprints-actions';
      actions.append(
        button('确定', () => options.onConfirm(), 'blueprints-confirm'),
        button('取消', () => options.onCancel(), 'blueprints-cancel'),
      );
      panel.append(actions);
      return;
    }

    const selected = options.selection();
    const start = button(
      selected > 0 ? `封装选中的 ${selected} 个元件` : '先框选要封装的元件',
      () => options.onStartWrap(),
      'blueprints-wrap',
    );
    start.disabled = selected === 0;
    panel.append(start);

    const ids = Object.keys(blueprints);
    if (ids.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'blueprints-note';
      empty.textContent = '还没有自制元件。在画板上按住 Ctrl 框选若干元件，再点上面的按钮。';
      panel.append(empty);
      return;
    }

    const list = document.createElement('ul');
    list.className = 'blueprints-list';
    for (const id of ids) {
      const entry = blueprints[id]!;
      const row = document.createElement('li');
      row.className = 'blueprints-row';
      const pick = button(entry.name.zh, () => {
        open = open === id ? null : id;
        render();
      });
      pick.className = 'blueprints-pick';
      pick.title = `${entry.name.en} · ${id}`;
      row.append(pick);

      if (open === id) {
        const actions = document.createElement('div');
        actions.className = 'blueprints-actions';
        actions.append(
          button('编辑内部', () => options.onEnter(id)),
          button('重命名', () => {
            const next = globalThis.prompt?.('新的元件名', entry.name.zh);
            if (next === null || next === undefined || next.trim() === '') return;
            options.onRename(id, { zh: next.trim(), en: next.trim() });
          }),
          button('删除', () => {
            if (!options.onDelete(id)) {
              globalThis.alert?.(`画板上还在用 ${entry.name.zh}，先删掉那些实例。`);
            }
          }),
        );
        row.append(actions);
      }
      list.append(row);
    }
    panel.append(list);
  };

  /** 一块带标题的引脚列表；某一侧没有引脚时给出说明，而不是一个空块。 */
  function pinList(title: string, pins: readonly string[]): HTMLElement {
    const box = document.createElement('div');
    box.className = 'blueprints-pins';
    if (pins.length === 0) {
      const empty = document.createElement('span');
      empty.textContent = title === '输入' ? '没有输入引脚' : '没有输出引脚';
      empty.style.color = THEME.textMuted;
      box.append(empty);
      return box;
    }
    const label = document.createElement('div');
    label.className = 'blueprints-group';
    label.textContent = `${title} ${pins.length}`;
    box.append(label);
    for (const pin of pins) {
      const line = document.createElement('code');
      line.textContent = pin;
      box.append(line);
    }
    return box;
  }

  function button(label: string, onClick: () => void, className = ''): HTMLButtonElement {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = `blueprints-btn ${className}`.trim();
    el.textContent = label;
    el.addEventListener('click', onClick);
    return el;
  }

  function nameOf(library: BlueprintLibrary, id: string): string {
    return library[id]?.name.zh ?? id;
  }

  store.subscribe(render);
  render();
  return { render };
}
