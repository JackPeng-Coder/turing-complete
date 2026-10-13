import type { AppState, Store } from '../app/store';
import type { BlueprintLibrary } from '../levels/blueprints';
import type { WrapPlan } from '../levels/wrap';
import { THEME } from './theme';

/**
 * The player's own components: what they have, what a wrap is about to make, and
 * the way into a component's body.
 *
 * A PANEL BECAUSE THERE IS NO ROOM ON THE BOARD. A component has no place in the
 * world -- it is not a part you can point at until it is dropped -- so the list of
 * them belongs on the chrome, like the palette and the test matrix. It floats over
 * the stage with the other panels and is rebuilt only when its subject changes.
 *
 * THE DRAFT IS THE POINT OF THE WRAP FLOW. Wrapping is one command (`wrap.ts`),
 * and a command cannot be half-applied while the player types a name at it -- so
 * the panel shows the derived surface first (which wires became which pins), names
 * the component, and only then commits. Nothing has moved until 确定.
 *
 * A component whose surface the panel shows but the wrap could not redraw -- a
 * plumbing pin, a nested component -- is reported as a count, because silently
 * dropping a connection is the one outcome a player cannot see.
 */
export interface BlueprintPanelOptions {
  /** The wrap being drafted, or `null`. */
  draft(): WrapPlan | null;
  /** How many board instances are selected, so the buttons can say so. */
  selection(): number;
  /** The name the draft would be committed under, as the inputs hold it. */
  draftName(): { zh: string; en: string };
  onDraftName(name: { zh: string; en: string }): void;
  /** Commit the draft: the wrap happens here. */
  onConfirm(): void;
  onCancel(): void;
  /** Start a wrap of the current selection; `false` when there is nothing to wrap. */
  onStartWrap(): void;
  onRename(id: string, name: { zh: string; en: string }): void;
  /** Reports whether the component could be removed (`false` while it is in use). */
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
   * Which library row the player opened, so its actions are on screen.
   *
   * IN THE PANEL rather than in the store: the selection is not a fact about the
   * document, only about which row is expanded, and putting it in `AppState` would
   * make every other panel re-render when it changed.
   */
  let open: string | null = null;

  /** The name inputs live across renders, so typing is not interrupted by one. */
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
        // Which connections were left behind, as a count: the player can see the
        // board still has them, and this is the panel saying so out loud.
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

  /** A titled list of pins, or nothing at all when the side has none. */
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
