/**
 * 画板输入：鼠标与键盘编辑。
 *
 * 所有修改都经过 `CommandStack`，让整个编辑过程可撤销；
 * 每次修改之后都会调用 `options.onChange()`，好让应用层重绘并重新判定。
 * 本模块只保存“临时的”指针状态（这次拖拽从哪个引脚开始、正在移动哪个元件），
 * 画面本身始终从 store 里绘制。
 */
import {
  addInstance,
  connect,
  disconnect,
  removeInstance,
  type Graph,
  type WireEnd,
} from '../../core/graph';
import type { CommandStack } from '../../app/commands';
import type { AppState, Store } from '../../app/store';
import type { LevelSpec } from '../../levels/spec';
import { isSandbox } from '../../levels/sandbox';
import { INSTANCE_HEIGHT } from '../theme';
import { placementAt, instanceRect } from './geometry';
import { hitTest, screenToWorld, snap, type Point } from './view';

/** 画板输入层的回调选项：由应用层实现，画板只在正确的时机调用。 */
export interface BoardInputOptions {
  /** 任何模型修改之后调用，让界面可以重绘并重新判定。 */
  onChange(): void;
  /**
   * 对某个元件的一次“点击”（不是拖拽），按实例 id 上报。
   *
   * 点击意味着什么由调用方决定：画板不知道哪些元件是开关。
   * 这是玩家不打开读数面板也能翻转关卡输入的方式——
   * 区别就落在“直接拨动电路”与“填一张表单”之间。
   */
  onPick?(instId: string): void;
  /**
   * 指针所在的世界坐标；指针离开画板时为 `null`。
   *
   * 只在元件托盘里“手持”着一个元件时才上报：画板上只有它会跟着指针走。
   * 没有手持元件时，悬停没有信息可报；为了没有信息的东西每次移动都重绘一次，就是白费。
   */
  onHover?(at: Point | null): void;
}

/** 新放下的关卡 IO 元件应采用的实例 id，以及该引脚的位宽。 */
export interface LevelIoPlacement {
  /** 按引脚顺序依次取 `IN_<pinId>`、`OUT` 或 `OUT_<pinId>`。 */
  readonly id: string;
  /** 关卡为该引脚声明的位宽（单位：位）。 */
  readonly width: number;
}

/**
 * 新放下的元件必须携带的关卡 IO 绑定；没有可分配的绑定时返回 `undefined`。
 *
 * `levels/checks.ts` 按实例 id 把电路与关卡绑定：关卡输入用 `IN_<pin>`，
 * 单输出关卡用 `OUT`，多输出关卡用 `OUT_<pin>`。
 * 从元件托盘拖出来的元件本来会被电路图自己的分配器命名成（`i1`、`i2`、…），
 * 永远绑不上关卡，从而让每一关都无法通过——所以放置时按引脚顺序发放这些约定俗成的 id；
 * 只有当关卡的引脚全部放完时，才退回分配器（多放一个 `level_input` 虽然冗余，但仍是合法元件）。
 *
 * 位宽和 id 一起返回，因为它们是同一个绑定的一部分，而只有本函数知道 id 指向哪个引脚：
 * `level_input` 和 `level_output` 声明的引脚都是 1 位，所以 8 位关卡引脚只有在
 * 为它放下的实例写着 `params.width = 8` 时才存在。
 * 若试图从 id 字符串反推位宽，就会多出第二个没有被强制的真相来源。
 *
 * 沙盒没有关卡引脚可数，它的连接器就是它的引脚：于是改为发放下一个空闲的
 * `IN_<n>` / `OUT_<n>`，位宽取元件定义自带的 1 位。
 * 这个 id 与画板给连接器印数值时使用的 `IN_`/`OUT` 前缀一致，
 * `sandboxPins` 也正把这些实例读回成画板的引脚清单。
 * 没有这段逻辑时，沙盒连接器会被命名成 `i1`、绑不到任何东西，
 * 侧边栏就会在明明放着连接器的画板上显示“尚未放置输入元件”。
 *
 * @param level 当前关卡（沙盒走单独分支）
 * @param graph 当前电路图，用于判断哪些 id 已被占用
 * @param defId 即将放下的元件定义 id
 * @returns 绑定信息（id 与位宽）；返回 undefined 表示交给分配器命名
 */
export function levelIoPlacement(
  level: LevelSpec,
  graph: Graph,
  defId: string,
): LevelIoPlacement | undefined {
  const taken = new Set(graph.instances.map((inst) => inst.id));
  if (isSandbox(level)) {
    const prefix = defId === 'level_input' ? 'IN_' : defId === 'level_output' ? 'OUT_' : null;
    if (prefix === null) return undefined;
    // 位宽 1：用元件定义自带的宽度。沙盒连接器不绑定任何关卡引脚，
    // 因此没有“声明位宽”可携带。`taken` 是有限集合，搜索一定会在第一个空闲编号处结束。
    for (let n = 1; ; n += 1) {
      const id = `${prefix}${n}`;
      if (!taken.has(id)) return { id, width: 1 };
    }
  }
  if (defId === 'level_input') {
    for (const pin of level.io.inputs) {
      const id = `IN_${pin.id}`;
      if (!taken.has(id)) return { id, width: pin.width };
    }
    return undefined;
  }
  if (defId === 'level_output') {
    const pins = level.io.outputs;
    if (pins.length === 1) {
      const pin = pins[0]!;
      return taken.has('OUT') ? undefined : { id: 'OUT', width: pin.width };
    }
    for (const pin of pins) {
      const id = `OUT_${pin.id}`;
      if (!taken.has(id)) return { id, width: pin.width };
    }
  }
  return undefined;
}

/**
 * 把选中的东西作为一个可撤销步骤全部删除，导线一并处理。
 *
 * 它是独立导出，而不只是按键处理里的一个分支：工具栏的垃圾桶按钮做的是同一件事，
 * 两份“收集相关导线”的规则就是两次留下悬空导线的机会。
 * 返回是否真的删掉了东西，让调用方能区分“没有选中任何东西”和“已经删完”。
 */
export function deleteSelection(
  store: Store<AppState>,
  stack: CommandStack,
  onChange: () => void,
): boolean {
  if (store.get().selected.length === 0) return false;
  if (!deleteParts(store, stack, store.get().selected)) return false;
  store.set({ selected: [] });
  onChange();
  return true;
}

/**
 * 把元件从画板上取下，并带走所有碰到它的导线，作为“一个”步骤。
 *
 * 撤销时必须把导线也恢复：一个元件和接到它上面的导线，是玩家画下的同一件东西；
 * 如果撤销只还原光秃秃的元件，它曾被剪自的那个电路仍然是断的。
 */
function deleteParts(
  store: Store<AppState>,
  stack: CommandStack,
  ids: readonly string[],
): boolean {
  const graph = store.get().graph;
  const removed = graph.instances.filter((inst) => ids.includes(inst.id));
  if (removed.length === 0) return false;
  const wires = graph.wires.filter((w) => ids.includes(w.from.inst) || ids.includes(w.to.inst));
  stack.push(
    {
      label: 'delete',
      do: (g) => {
        for (const inst of removed) removeInstance(g, inst.id);
      },
      undo: (g) => {
        for (const inst of removed) g.instances.push(inst);
        for (const wire of wires) g.wires.push(wire);
      },
    },
    graph,
  );
  return true;
}

/**
 * 指针最多可以移动多少屏幕像素，仍然算“点击”。
 *
 * 取 4：人的手不是捕鼠夹。若用严格相等判断，点击时手抖一个像素就会变成平移，
 * 本来该清空选区的点击反而什么都没清。每个界面都有这么个数字，这里就是画板自己的。
 */
const CLICK_SLOP = 4;

/**
 * 给画板挂上指针、滚轮与键盘监听。
 *
 * 这是画板编辑的唯一入口：它把“用户动作”翻译成对 store 的读取和命令栈的压入，
 * 自身不持有任何模型状态——只有下面几个闭包变量记录拖拽的中间过程。
 *
 * @param canvas 画板画布；指针、滚轮、右键菜单事件都绑在它上面
 * @param store 应用状态；相机、选区、拖拽状态都从这里读写
 * @param stack 撤销栈；每次结构性修改都作为一个命令压入
 * @param options 回调：模型变化、点击元件、指针悬停
 * @returns 卸载函数，移除全部监听器（调用方销毁画板时执行）
 */
export function attachBoardInput(  canvas: HTMLCanvasElement,
  store: Store<AppState>,
  stack: CommandStack,
  options: BoardInputOptions,
): () => void {
  let pendingFrom: WireEnd | null = null;
  let panning: Point | null = null;
  /**
   * 在空白纸面上按下、但还没有升级成平移的那次按压。
   *
   * 只有指针移动超过 `CLICK_SLOP`，这个手势才算平移；在那之前什么都还没发生：
   * 此时松手就是一次“点空白”，会清空选区——这正是过去把平移挪到空白处后丢掉的那个手势。
   */
  let panFrom: Point | null = null;
  let moving: {
    id: string;
    startX: number;
    startY: number;
    offsetX: number;
    offsetY: number;
  } | null = null;

  const localPoint = (event: PointerEvent | WheelEvent): Point => {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const worldPoint = (event: PointerEvent | WheelEvent): Point =>
    screenToWorld(store.get().camera, localPoint(event));

  const instanceOf = (id: string) => store.get().graph.instances.find((i) => i.id === id);

  const armedDef = (): string => store.get().armed ?? '';

  const place = (world: Point, defId: string): void => {
    // 鼠标落在元件左边缘、引脚所在的那一行（垂直中心）：
    // 于是在 (px, py) 放下的元件，其输出引脚在 (px + 72, py)，
    // 正是玩家随后沿着一路拖出去接线的位置。
    // 这条规则由 `placementAt` 只写一次，指针上的手持预览也按它绘制。
    const reg = store.get().registry;
    const { x, y } = reg.has(defId)
      ? placementAt(world, reg.get(defId))
      : { x: snap(world.x), y: snap(world.y - INSTANCE_HEIGHT / 2) };
    const placement = levelIoPlacement(store.get().level, store.get().graph, defId);
    let created: string | null = null;
    stack.push(
      {
        label: `add ${defId}`,
        do: (g) => {
          const inst = addInstance(g, defId, x, y, placement?.id);
          // 绑定 = id + 位宽：`compile` 按 `params.width ?? def.pin.width` 决定引脚宽度，
          // 而 `bindLevelIo` 会拒绝宽度与关卡声明不符的引脚。
          // 因此一个只带 id、不带位宽的 8 位关卡输入会被编译成 1 位，
          // 让这一关自己的画板无法判定。
          if (placement) inst.params.width = placement.width;
          created = inst.id;
        },
        undo: (g) => {
          if (created) removeInstance(g, created);
        },
      },
      store.get().graph,
    );
    options.onChange();
    // 元件已经放上画板，再画手持预览就会正好盖住它——
    // 刚放下的东西压在自己半透明的副本下面，直到鼠标移动。
    // 下一次移动时预览会回来，那时它才有新的位置可去。
    options.onHover?.(null);
  };

  const onPointerDown = (event: PointerEvent): void => {
    canvas.setPointerCapture(event.pointerId);
    const world = worldPoint(event);
    const state = store.get();
    const hit = hitTest(state.graph, state.registry, world);

    if (event.button === 1) {
      // 中键没有歧义，所以按下就立刻平移，永远不算“点空白”。
      panning = localPoint(event);
      panFrom = null;
      return;
    }
    if (event.button !== 0) return;

    // Ctrl 拖拽是框选，从哪儿开始都行：空白处、元件上、导线上。
    // Ctrl 表示“这次拖拽只关乎选择”，所以它不能再同时表示“移动这个元件”——
    // 而从元件上开始拉框，正是把该元件和邻居一起选中的自然操作。
    if (event.ctrlKey || event.metaKey) {
      options.onHover?.(null);
      store.set({ dragging: { kind: 'marquee', x0: world.x, y0: world.y, x1: world.x, y1: world.y } });
      return;
    }

    if (hit?.kind === 'pin' && !hit.isInput) {
      pendingFrom = { inst: hit.inst, port: hit.port };
      // 写进 store，好让画板画出跟着指针走的导线，并点亮它出发的那个引脚。
      store.set({
        dragging: { kind: 'wire', fromInst: hit.inst, fromPort: hit.port, to: null },
      });
      return;
    }

    if (hit?.kind === 'pin' && hit.isInput) {
      // 点击已经接线的输入引脚会把它拔掉；玩家随后再从别处拖一根新线进来。
      const existing = state.graph.wires.find((w) => w.to.inst === hit.inst && w.to.port === hit.port);
      if (existing) {
        stack.push(
          {
            label: 'disconnect',
            do: (g) => disconnect(g, existing.id),
            undo: (g) => void g.wires.push(existing),
          },
          state.graph,
        );
        options.onChange();
      }
      return;
    }

    if (hit?.kind === 'instance') {
      const inst = instanceOf(hit.id);
      if (!inst) return;
      moving = {
        id: hit.id,
        startX: inst.x,
        startY: inst.y,
        offsetX: world.x - inst.x,
        offsetY: world.y - inst.y,
      };
      store.set({
        selected: [hit.id],
        dragging: { kind: 'instance', ids: [hit.id], offsetX: moving.offsetX, offsetY: moving.offsetY },
      });
      return;
    }

    if (hit?.kind === 'wire') {
      const wire = state.graph.wires.find((w) => w.id === hit.id);
      if (wire) {
        stack.push(
          {
            label: 'delete wire',
            do: (g) => disconnect(g, wire.id),
            undo: (g) => void g.wires.push(wire),
          },
          state.graph,
        );
        options.onChange();
      }
      return;
    }

    // 空白处平移。除第一关外，画板都比窗口大，而“拖动纸张”是手最先尝试的动作；
    // 习惯用中键的人仍然可以用中键。
    //
    // 手持元件时这次点击仍然交给“放置”，因为盖章是玩家主动打开的模式，
    // 而点击放下正是它该有的退出方式之一。
    const defId = armedDef();
    if (defId) place(world, defId);
    else panFrom = localPoint(event);
  };

  const onPointerMove = (event: PointerEvent): void => {
    // 只有在“手里拿着元件”且“没有在拖任何东西”时才有手持预览：
    // 拉框或拉线时，指针正在画别的东西，
    // 这时再让一个半透明元件跟着走，只会挡住玩家真正在做的操作。
    if (options.onHover && armedDef() && store.get().dragging === null) {
      options.onHover(worldPoint(event));
    }

    const band = store.get().dragging;
    if (band?.kind === 'marquee') {
      const at = worldPoint(event);
      store.set({
        dragging: { kind: 'marquee', x0: band.x0, y0: band.y0, x1: at.x, y1: at.y },
      });
      return;
    }

    // 在空白处按下，要等移动足够远才算平移。
    // 在这里（移动时）才升级，而不是在按下时，意味着一次点击对视口的移动量恰好为零——
    // 早先的版本会把抖动的那几个像素也平移掉，然后还把它当作点击。
    if (panFrom && !panning) {
      const now = localPoint(event);
      if (Math.hypot(now.x - panFrom.x, now.y - panFrom.y) <= CLICK_SLOP) return;
      panning = panFrom;
    }

    if (panning) {
      const now = localPoint(event);
      const camera = store.get().camera;
      store.set({
        camera: {
          x: camera.x + (now.x - panning.x) / camera.zoom,
          y: camera.y + (now.y - panning.y) / camera.zoom,
          zoom: camera.zoom,
        },
      });
      panning = now;
      return;
    }

    if (pendingFrom) {
      // 橡皮筋预览。每次移动重绘一次正是目的：移动的东西就是这根线。
      store.set({
        dragging: {
          kind: 'wire',
          fromInst: pendingFrom.inst,
          fromPort: pendingFrom.port,
          to: worldPoint(event),
        },
      });
      return;
    }

    if (moving) {
      const inst = instanceOf(moving.id);
      if (!inst) return;
      const world = worldPoint(event);
      inst.x = snap(world.x - moving.offsetX);
      inst.y = snap(world.y - moving.offsetY);
      // 原地修改不会因为对象引用变化而触发通知，而 store 的通知本来就是无条件的：
      // `set({})` 就是“请重绘”的调用。正是它让被拖拽的元件跟住指针。
      store.set({});
    }
  };

  const onPointerUp = (event: PointerEvent): void => {
    const band = store.get().dragging;
    if (band?.kind === 'marquee') {
      // 框碰到的东西全部进入同一个选区。没有移动过的框是一个点，
      // 于是只选中它下面的那个元件——这就是“Ctrl+点击只选一个、不清空其他”的实现方式。
      const left = Math.min(band.x0, band.x1);
      const right = Math.max(band.x0, band.x1);
      const top = Math.min(band.y0, band.y1);
      const bottom = Math.max(band.y0, band.y1);
      const { graph, registry } = store.get();
      const selected: string[] = [];
      for (const inst of graph.instances) {
        if (!registry.has(inst.def)) continue;
        const rect = instanceRect(inst, registry.get(inst.def));
        const overlaps =
          rect.x <= right &&
          rect.x + rect.w >= left &&
          rect.y <= bottom &&
          rect.y + rect.h >= top;
        if (overlaps) selected.push(inst.id);
      }
      store.set({ selected, dragging: null });
      return;
    }

    if (panFrom || panning) {
      const dragged = panning !== null;
      panFrom = null;
      panning = null;
      // 它始终没变成拖拽，所以这是一次“点空白”：清空选区。
      // 真正的平移故意不清空——四处看看画板，并不表示你对选中的东西改变了主意。
      if (!dragged) store.set({ selected: [] });
      store.set({ dragging: null });
      return;
    }

    if (moving) {
      const current = instanceOf(moving.id);
      const { id, startX, startY } = moving;
      moving = null;
      if (current && (current.x !== startX || current.y !== startY)) {
        // 拖拽过程中元件已经被移动过了；这条命令只需记录如何重放和反向执行这次移动，
        // 所以两个方向存的都是绝对坐标。
        const endX = current.x;
        const endY = current.y;
        stack.push(
          {
            label: 'move',
            do: (g) => {
              const target = g.instances.find((i) => i.id === id);
              if (target) {
                target.x = endX;
                target.y = endY;
              }
            },
            undo: (g) => {
              const target = g.instances.find((i) => i.id === id);
              if (target) {
                target.x = startX;
                target.y = startY;
              }
            },
          },
          store.get().graph,
        );
        options.onChange();
      } else if (current) {
        // 它没动，所以这是一次点击。坐标都吸附在网格上，
        // 因此在一个网格单元内按下再松开，落点还是元件原来的坐标，不需要撤销记录。
        options.onPick?.(id);
      }
      store.set({ dragging: null });
      return;
    }

    if (!pendingFrom) {
      store.set({ dragging: null });
      return;
    }

    const from = pendingFrom;
    pendingFrom = null;
    const hit = hitTest(store.get().graph, store.get().registry, worldPoint(event));
    if (hit?.kind === 'pin' && hit.isInput) {
      const to: WireEnd = { inst: hit.inst, port: hit.port };
      // 每个输入只能有一个驱动源：接到这个引脚上的旧导线会被替换，
      // 替换过程是一个单一的可撤销步骤。
      const replaced = store
        .get()
        .graph.wires.filter((w) => w.to.inst === to.inst && w.to.port === to.port);
      let createdId: string | null = null;
      stack.push(
        {
          label: 'connect',
          do: (g) => {
            for (const wire of replaced) disconnect(g, wire.id);
            createdId = connect(g, from, to).id;
          },
          undo: (g) => {
            if (createdId) disconnect(g, createdId);
            for (const wire of replaced) g.wires.push(wire);
          },
        },
        store.get().graph,
      );
      options.onChange();
    }
    store.set({ dragging: null });
  };

  const onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    const camera = store.get().camera;
    const before = screenToWorld(camera, localPoint(event));
    const zoom = Math.min(4, Math.max(0.25, camera.zoom * (event.deltaY < 0 ? 1.1 : 1 / 1.1)));
    const next = { ...camera, zoom };
    const after = screenToWorld(next, localPoint(event));
    // 缩放时让光标下的世界点保持钉在原地。
    store.set({
      camera: { zoom, x: next.x + (after.x - before.x), y: next.y + (after.y - before.y) },
    });
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    const key = event.key.toLowerCase();
    const accel = event.ctrlKey || event.metaKey;

    if (accel && key === 'z' && !event.shiftKey) {
      event.preventDefault();
      if (stack.undo(store.get().graph)) {
        // 记录下来的命令可能恢复或移除任意被选中的元件，
        // 所以选区不会跨越一次历史步骤保留。
        store.set({ selected: [] });
        options.onChange();
      }
      return;
    }

    if (accel && ((key === 'z' && event.shiftKey) || key === 'y')) {
      event.preventDefault();
      if (stack.redo(store.get().graph)) {
        store.set({ selected: [] });
        options.onChange();
      }
      return;
    }

    if (event.key === 'Delete' || event.key === 'Backspace') {
      deleteSelection(store, stack, options.onChange);
      return;
    }

    if (event.key === 'Escape' && armedDef()) {
      // 放下手里拿着的元件：否则盖章模式会一直开着，之后每次点空白都会再放一个。
      store.set({ armed: null, status: null });
    }
  };

  /** 指针离开了画板：手持预览没有地方可画。 */
  const onPointerLeave = (): void => options.onHover?.(null);

  /**
   * 右键删除指针下面的东西，而且只删它。
   *
   * 它是画板上两种最常见编辑的快捷方式——撤掉放错位置的元件、剪掉走错地方的导线——
   * 两者都是单个可撤销步骤，所以误按一次右键只花一次 Ctrl+Z。
   * 它故意不碰选区：已经选中五个元件的人再右键第六个，意思就是“删第六个”。
   *
   * 整个画板范围内都会屏蔽浏览器自带的菜单，无论有没有点中东西：
   * 这里是一张工作台，右键从来不是为了在电路上盖一个上下文菜单。
   */
  const onContextMenu = (event: MouseEvent): void => {
    event.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const world = screenToWorld(store.get().camera, {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    });
    const graph = store.get().graph;
    const hit = hitTest(graph, store.get().registry, world);
    if (!hit) return;

    if (hit.kind === 'wire') {
      const wire = graph.wires.find((w) => w.id === hit.id);
      if (!wire) return;
      stack.push(
        {
          label: 'delete wire',
          do: (g) => disconnect(g, wire.id),
          undo: (g) => void g.wires.push(wire),
        },
        graph,
      );
      options.onChange();
      return;
    }

    const id = hit.kind === 'instance' ? hit.id : hit.inst;
    if (!deleteParts(store, stack, [id])) return;
    // 被选中、现在又被删掉的元件不能留在选区里，
    // 否则下一次按垃圾桶按钮会试图删它第二次。
    store.set({ selected: store.get().selected.filter((selected) => selected !== id) });
    options.onChange();
  };

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('contextmenu', onContextMenu);
  canvas.addEventListener('pointerleave', onPointerLeave);
  globalThis.addEventListener('keydown', onKeyDown);

  return () => {
    canvas.removeEventListener('pointerdown', onPointerDown);
    canvas.removeEventListener('pointermove', onPointerMove);
    canvas.removeEventListener('pointerup', onPointerUp);
    canvas.removeEventListener('wheel', onWheel);
    canvas.removeEventListener('contextmenu', onContextMenu);
    canvas.removeEventListener('pointerleave', onPointerLeave);
    globalThis.removeEventListener('keydown', onKeyDown);
  };
}
