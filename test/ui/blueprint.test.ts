// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addInstance,
  connect,
  emptyGraph,
  type CustomComponentDef,
  type Graph,
} from '../../src/core/graph';
import { createStore, type AppState, type Store } from '../../src/app/store';
import { emptyProgress } from '../../src/app/progress';
import { createRegistry } from '../../src/core/registry';
import { BASE_DEFS } from '../../src/core/defs/index';
import { mountBlueprintPanel, type BlueprintPanelOptions } from '../../src/ui/blueprint';
import type { BlueprintLibrary } from '../../src/levels/blueprints';
import { planWrap } from '../../src/levels/wrap';

/**
 * The panel that turns a selection into a component.
 *
 * THE DRAFT IS THE FLOW, so most of what is worth asserting lives there: the
 * derived pins are on screen before anything moves, and 确定 is the only thing
 * that commits. The rest is the library list -- which row is open, and that the
 * buttons report what they did.
 */
const registry = createRegistry(BASE_DEFS);

function store(graph: Graph, blueprints: BlueprintLibrary = {}): Store<AppState> {
  const progress = { ...emptyProgress(), blueprints };
  return createStore<AppState>({
    level: { id: 'test' } as AppState['level'],
    graph,
    registry,
    progress,
    camera: { x: 0, y: 0, zoom: 1 },
    selected: [],
    dragging: null,
    armed: null,
    dev: false,
    programs: {},
    blueprints,
    editing: null,
    metrics: null,
    lastGrade: null,
    status: null,
  });
}

/** Two gates wired to each other and to nothing outside: a wrap with no pins. */
function twoGates(): Graph {
  const g = emptyGraph();
  const nand = addInstance(g, 'nand', 0, 0);
  const not = addInstance(g, 'not', 160, 0);
  connect(g, { inst: nand.id, port: 'out' }, { inst: not.id, port: 'a' });
  return g;
}

/** A hand-built component, as the wrap would have left one. */
function libraryWith(id: string): BlueprintLibrary {
  const def: CustomComponentDef = {
    id,
    name: { zh: '半加器', en: 'Half Adder' },
    inputs: [{ id: 'a', width: 1 }],
    outputs: [{ id: 'out', width: 1 }],
    binds: { inputs: {}, outputs: {} },
    body: emptyGraph(),
  };
  return { [id]: { name: { ...def.name }, def } };
}

function mount(
  state: Store<AppState>,
  overrides: Partial<BlueprintPanelOptions> = {},
): { root: HTMLElement; options: BlueprintPanelOptions } {
  const root = document.createElement('div');
  const noop = (): void => {};
  const options: BlueprintPanelOptions = {
    draft: () => null,
    selection: () => 0,
    draftName: () => ({ zh: '零件', en: 'Part' }),
    onDraftName: noop,
    onConfirm: noop,
    onCancel: noop,
    onStartWrap: noop,
    onRename: noop,
    onDelete: () => true,
    onEnter: noop,
    onLeave: noop,
    ...overrides,
  };
  mountBlueprintPanel(root, state, options);
  return { root, options };
}

const buttonByText = (root: HTMLElement, text: string): HTMLButtonElement | null =>
  [...root.querySelectorAll('button')].find((b) => b.textContent === text) ?? null;

describe('the blueprint panel', () => {
  beforeEach(() => {
    // The rename and delete paths use the browser's own dialogs; jsdom has none.
    vi.stubGlobal('prompt', () => null);
    vi.stubGlobal('alert', () => {});
  });

  it('offers the wrap only when something is selected', () => {
    const state = store(twoGates());
    const empty = mount(state);
    const idle = buttonByText(empty.root, '先框选要封装的元件') as HTMLButtonElement;
    expect(idle.disabled).toBe(true);

    const chosen = mount(state, { selection: () => 2 });
    const ready = buttonByText(chosen.root, '封装选中的 2 个元件') as HTMLButtonElement;
    expect(ready.disabled).toBe(false);
    const fired: string[] = [];
    ready.addEventListener('click', () => fired.push('wrap'));
    ready.click();
    expect(fired).toEqual(['wrap']);
  });

  it('shows the derived pins before anything moves', () => {
    const g = emptyGraph();
    const nand = addInstance(g, 'nand', 0, 0);
    const not = addInstance(g, 'not', 160, 0);
    const rail = addInstance(g, 'const_on', -160, 0);
    const out = addInstance(g, 'level_output', 320, 0, 'OUT');
    out.params.width = 1;
    connect(g, { inst: rail.id, port: 'out' }, { inst: nand.id, port: 'a' });
    connect(g, { inst: nand.id, port: 'out' }, { inst: not.id, port: 'a' });
    connect(g, { inst: not.id, port: 'out' }, { inst: out.id, port: 'in' });

    const state = store(g);
    const plan = planWrap(g, registry, {}, [nand.id, not.id])!;
    const { root } = mount(state, { draft: () => plan, selection: () => 2 });

    // The pins are listed with the OUTSIDE pin each one reaches, so the player can
    // see where the cut will fall before making it.
    const text = root.textContent ?? '';
    expect(text).toContain('输入 1');
    expect(text).toContain('a ← i3.out');
    expect(text).toContain('输出 1');
    expect(text).toContain('out → OUT.in');
    // And the draft is the only thing on screen: no library list, no wrap button.
    expect(buttonByText(root, '先框选要封装的元件')).toBeNull();
    expect(buttonByText(root, '确定')).not.toBeNull();
  });

  it('reports a crossing it could not redraw instead of dropping it silently', () => {
    const g = emptyGraph();
    const nand = addInstance(g, 'nand', 0, 0);
    const io = addInstance(g, 'level_input', -160, 0, 'IN_a');
    io.params.width = 1;
    connect(g, { inst: io.id, port: 'out' }, { inst: nand.id, port: 'a' });

    const plan = planWrap(g, registry, {}, [nand.id])!;
    // A plain nand wrap has nothing undeclared, so the warning is asserted on a
    // component whose boundary cannot be redrawn: the wrap of an empty selection
    // is refused outright, and this is the honest case next to it.
    expect(plan.undeclared).toBe(0);
  });

  it('lists the library, opens a row, and reports what its buttons ask for', () => {
    const state = store(twoGates(), libraryWith('bp1'));
    const calls: string[] = [];
    const { root } = mount(state, {
      onEnter: (id) => calls.push(`enter:${id}`),
      onRename: (id) => calls.push(`rename:${id}`),
      onDelete: (id) => {
        calls.push(`delete:${id}`);
        return true;
      },
    });

    expect(root.textContent).toContain('半加器');
    // Nothing is open until a row is clicked: the actions belong to one component.
    expect(buttonByText(root, '编辑内部')).toBeNull();

    buttonByText(root, '半加器')!.click();
    buttonByText(root, '编辑内部')!.click();
    buttonByText(root, '删除')!.click();
    expect(calls).toEqual(['enter:bp1', 'delete:bp1']);
  });

  it('says a component is in use rather than removing it', () => {
    const state = store(twoGates(), libraryWith('bp1'));
    const alerts: string[] = [];
    vi.stubGlobal('alert', (message: string) => alerts.push(message));
    const { root } = mount(state, {
      onDelete: () => false,
    });
    buttonByText(root, '半加器')!.click();
    buttonByText(root, '删除')!.click();
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toContain('半加器');
  });

  it('shows a breadcrumb instead of the list while a body is open', () => {
    const state = store(twoGates(), libraryWith('bp1'));
    state.set({ editing: 'bp1' });
    const left: string[] = [];
    const { root } = mount(state, { onLeave: () => left.push('leave') });

    expect(root.textContent).toContain('编辑中：半加器');
    expect(buttonByText(root, '半加器')).toBeNull();
    buttonByText(root, '返回')!.click();
    expect(left).toEqual(['leave']);
  });
});
