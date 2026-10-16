/**
 * The operations an agent may perform, as tools.
 *
 * ONE TOOL PER THING A HAND CAN DO, and every one of them is built out of the
 * same pieces the hand uses: an undoable `Command` on the player's own stack, or
 * one of the toolbar's buttons reached through `AgentHost`. Nothing here touches
 * the graph directly -- `do` and `undo` are the only places a mutation happens,
 * which is what makes an agent edit undoable with Ctrl+Z and identical to the
 * edit the player would have made by hand (requirement A3).
 *
 * WHY THE SURFACE IS NOT "EVERYTHING". The tool list is what the model reads
 * before every step, so every tool in it costs attention on every request and
 * adds a way to choose wrongly. What is left out is left out on purpose and
 * recorded as such: opening levels, unlocking parts, editing progress and the
 * blueprint library are absent, because the objective scopes the agent to the
 * circuit in front of the player. See the phase plan's 裁决 table.
 *
 * COORDINATES ARE THE BOARD'S OWN. A tool takes world pixels and snaps them
 * through the host, so the agent's arithmetic never has to know the grid size --
 * `ui/theme.ts` owns that, and this layer may not import it.
 */
import {
  addInstance,
  connect,
  disconnect,
  nextId,
  removeInstance,
  type Graph,
  type Instance,
  type Wire,
} from '../core/graph';
import type { AgentHost, PartInfo } from './host';
import { ToolError, numberArg, optionalString, stringArg, stringArrayArg, type ToolSpec, type ToolArgs } from './tools';

/** A bit of schema, so every tool's parameters read the same way. */
const TEXT = (description: string): { type: 'string'; description: string } => ({
  type: 'string',
  description,
});
const NUM = (description: string): { type: 'number'; description: string } => ({
  type: 'number',
  description,
});

const BOARD_HELP =
  '元件 id（例如 i1）、元件类型（nand）、引脚 id 都在 read_board 和 list_parts 的结果里，不要凭空猜。';

/**
 * What the palette says about one instance's pins.
 *
 * The instance's DEF is looked up rather than assumed: a board can hold a part
 * whose definition the agent has not seen, and a pin id is only meaningful
 * against the definition that declared it.
 */
interface Placement {
  readonly graph: Graph;
  readonly defs: ReadonlyMap<string, PartInfo>;
  readonly insts: ReadonlyMap<string, Instance>;
}

function placementOf(host: AgentHost): Placement {
  const graph = host.graph();
  return {
    graph,
    defs: new Map(host.parts().map((part) => [part.id, part])),
    insts: new Map(graph.instances.map((inst) => [inst.id, inst])),
  };
}

function instanceOf(placement: Placement, id: string): Instance {
  const inst = placement.insts.get(id);
  if (!inst) {
    const known = [...placement.insts.keys()].join('、');
    throw new ToolError(`电路里没有元件 ${id}。现在的元件是：${known === '' ? '（空的）' : known}`);
  }
  return inst;
}

function pinOf(
  placement: Placement,
  inst: Instance,
  port: string,
  side: 'inputs' | 'outputs',
): void {
  const def = placement.defs.get(inst.def);
  if (!def) throw new ToolError(`元件 ${inst.id} 的类型 ${inst.def} 不在当前可用元件里`);
  const pins = side === 'inputs' ? def.inputs : def.outputs;
  if (pins.some((pin) => pin.id === port)) return;
  const known = pins.map((pin) => pin.id).join('、');
  throw new ToolError(
    `${def.nameZh}（${inst.id}）没有${side === 'inputs' ? '输入' : '输出'}引脚「${port}」；它有：${known}`,
  );
}

function copyWire(wire: Wire): Wire {
  return { id: wire.id, from: { ...wire.from }, to: { ...wire.to } };
}

/** The whole tool list, bound to one host. */
export function circuitTools(host: AgentHost): ToolSpec[] {
  const tools: ToolSpec[] = [
    {
      name: 'read_board',
      description:
        '看现在的电路板：模式（关卡还是沙盒）、关卡名、所有元件及其坐标、所有导线、当前选中、是否在运行、门数与延迟、上一次判定、以及电路的结构问题（未接线的输入、多重驱动、反馈回路等）。做任何事之前先看它。',
      parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
      run: () => host.snapshot(),
    },
    {
      name: 'list_parts',
      description:
        '列出当前可以放置的元件类型及其全部引脚（id、位宽）。放置前用 pin 的 id 来连线。',
      parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
      run: () =>
        host
          .parts()
          .filter((part) => !part.hidden)
          .map((part) => ({
            id: part.id,
            nameZh: part.nameZh,
            nameEn: part.nameEn,
            category: part.category,
            inputs: part.inputs.map((pin) => ({ id: pin.id, width: pin.width })),
            outputs: part.outputs.map((pin) => ({ id: pin.id, width: pin.width })),
          })),
    },
    {
      name: 'place_part',
      description: `在电路板上放一个元件。坐标是世界像素，会被对齐到网格；原点在左上，x 向右、y 向下。元件大约 72×72，引脚在左右两侧，所以两个元件之间水平至少留 96、垂直至少留 96，否则会叠在一起。返回新元件的 id。${BOARD_HELP}`,
      parameters: {
        type: 'object',
        properties: {
          defId: TEXT('元件类型 id，例如 nand / not / and / or'),
          x: NUM('元件中心的横坐标（世界像素）'),
          y: NUM('元件中心的纵坐标（世界像素）'),
        },
        required: ['defId', 'x', 'y'],
        additionalProperties: false,
      },
      run: (args: ToolArgs) => {
        const defId = stringArg(args, 'defId');
        const placement = placementOf(host);
        const def = placement.defs.get(defId);
        if (!def) {
          const known = [...placement.defs.values()]
            .filter((part) => !part.hidden)
            .map((part) => part.id)
            .join('、');
          throw new ToolError(`没有元件类型「${defId}」。可用的有：${known}`);
        }
        if (def.category === 'level') {
          throw new ToolError(
            '关卡的输入/输出连接器由关卡自己摆好，不能手工放置；直接连到已有的 IN_… / OUT 元件上',
          );
        }
        if (def.hidden) throw new ToolError(`元件类型「${defId}」不对玩家开放`);
        const at = host.snap(numberArg(args, 'x'), numberArg(args, 'y'));
        // THE ID IS MINTED HERE, not inside `do`: a command has to be repeatable
        // (it runs again on every redo), so everything it does must be decided
        // before it is pushed -- see `app/commands.ts`.
        const id = nextId('i', placement.graph.instances);
        host.apply(
          {
            label: `agent add ${defId}`,
            do: (g) => {
              addInstance(g, defId, at.x, at.y, id);
            },
            undo: (g) => {
              removeInstance(g, id);
            },
          },
          [id],
        );
        return { id, defId, x: at.x, y: at.y };
      },
    },
    {
      name: 'move_part',
      description: `把一个已经存在的元件移到新坐标；坐标会被对齐到网格。${BOARD_HELP}`,
      parameters: {
        type: 'object',
        properties: {
          id: TEXT('要移动的元件 id'),
          x: NUM('新的横坐标'),
          y: NUM('新的纵坐标'),
        },
        required: ['id', 'x', 'y'],
        additionalProperties: false,
      },
      run: (args: ToolArgs) => {
        const id = stringArg(args, 'id');
        const inst = instanceOf(placementOf(host), id);
        const before = { x: inst.x, y: inst.y };
        const at = host.snap(numberArg(args, 'x'), numberArg(args, 'y'));
        host.apply(
          {
            label: `agent move ${id}`,
            do: (g) => {
              const target = g.instances.find((candidate) => candidate.id === id);
              if (target) {
                target.x = at.x;
                target.y = at.y;
              }
            },
            undo: (g) => {
              const target = g.instances.find((candidate) => candidate.id === id);
              if (target) {
                target.x = before.x;
                target.y = before.y;
              }
            },
          },
          [id],
        );
        return { id, x: at.x, y: at.y };
      },
    },
    {
      name: 'connect_pins',
      description:
        '把一根导线从某个元件的输出引脚接到另一个元件的输入引脚。一个输入引脚只能被一根导线驱动，新的连线会自动替换掉原来那根（并作为一个动作一起撤销）。不能从输入连到输出。',
      parameters: {
        type: 'object',
        properties: {
          fromInst: TEXT('输出端所在的元件 id'),
          fromPort: TEXT('输出引脚的 id'),
          toInst: TEXT('输入端所在的元件 id'),
          toPort: TEXT('输入引脚的 id'),
        },
        required: ['fromInst', 'fromPort', 'toInst', 'toPort'],
        additionalProperties: false,
      },
      run: (args: ToolArgs) => {
        const fromInst = stringArg(args, 'fromInst');
        const fromPort = stringArg(args, 'fromPort');
        const toInst = stringArg(args, 'toInst');
        const toPort = stringArg(args, 'toPort');
        const placement = placementOf(host);
        const source = instanceOf(placement, fromInst);
        const target = instanceOf(placement, toInst);
        pinOf(placement, source, fromPort, 'outputs');
        pinOf(placement, target, toPort, 'inputs');
        if (fromInst === toInst) {
          throw new ToolError(
            `不能把 ${fromInst} 的输出接回它自己的输入：那是一个反馈回路。要存储一位请用 delay/reg 之类的元件`,
          );
        }
        const replaced = placement.graph.wires.filter(
          (wire) => wire.to.inst === toInst && wire.to.port === toPort,
        );
        // The replaced wires are captured here, not read again during undo: a
        // command has to put the board back where it was BEFORE it ran, and by
        // undo time that state is only available in this closure.
        const id = nextId('w', placement.graph.wires);
        host.apply(
          {
            label: `agent connect ${fromInst}.${fromPort}->${toInst}.${toPort}`,
            do: (g) => {
              g.wires = g.wires.filter(
                (wire) => !(wire.to.inst === toInst && wire.to.port === toPort),
              );
              connect(g, { inst: fromInst, port: fromPort }, { inst: toInst, port: toPort }, id);
            },
            undo: (g) => {
              disconnect(g, id);
              for (const wire of replaced) g.wires.push(copyWire(wire));
            },
          },
          [toInst],
        );
        return { wireId: id, from: `${fromInst}.${fromPort}`, to: `${toInst}.${toPort}` };
      },
    },
    {
      name: 'delete_wire',
      description: `删掉一根导线，用 read_board 给出的导线 id。${BOARD_HELP}`,
      parameters: {
        type: 'object',
        properties: { wireId: TEXT('要删除的导线 id，例如 w3') },
        required: ['wireId'],
        additionalProperties: false,
      },
      run: (args: ToolArgs) => {
        const wireId = stringArg(args, 'wireId');
        const placement = placementOf(host);
        const wire = placement.graph.wires.find((candidate) => candidate.id === wireId);
        if (!wire) {
          const known = placement.graph.wires.map((candidate) => candidate.id).join('、');
          throw new ToolError(`没有导线 ${wireId}。现在的导线是：${known === '' ? '（没有）' : known}`);
        }
        const copy = copyWire(wire);
        host.apply({
          label: `agent delete wire ${wireId}`,
          do: (g) => {
            disconnect(g, wireId);
          },
          undo: (g) => {
            g.wires.push(copy);
          },
        });
        return { wireId };
      },
    },
    {
      name: 'delete_part',
      description:
        '删掉一个元件，连在它身上的导线会一起消失（一个动作，可以一次撤销）。',
      parameters: {
        type: 'object',
        properties: { id: TEXT('要删除的元件 id') },
        required: ['id'],
        additionalProperties: false,
      },
      run: (args: ToolArgs) => {
        const id = stringArg(args, 'id');
        const placement = placementOf(host);
        const inst = instanceOf(placement, id);
        const copy: Instance = { ...inst, params: { ...inst.params } };
        const attached = placement.graph.wires
          .filter((wire) => wire.from.inst === id || wire.to.inst === id)
          .map(copyWire);
        if (copy.def.startsWith('IN_') || id === 'OUT') {
          throw new ToolError('关卡的输入/输出连接器不能删除：关卡需要它们');
        }
        host.apply({
          label: `agent delete ${id}`,
          do: (g) => {
            removeInstance(g, id);
          },
          undo: (g) => {
            g.instances.push({ ...copy, params: { ...copy.params } });
            for (const wire of attached) g.wires.push(copyWire(wire));
          },
        });
        return { id, removedWires: attached.length };
      },
    },
    {
      name: 'undo_last',
      description: '撤销上一步（包括玩家自己做过的操作）。',
      parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
      run: () => {
        if (!host.undo()) throw new ToolError('没有可以撤销的操作了');
        return { undone: true };
      },
    },
    {
      name: 'redo_last',
      description: '重做上一步被撤销的操作。',
      parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
      run: () => {
        if (!host.redo()) throw new ToolError('没有可以重做的操作了');
        return { redone: true };
      },
    },
    {
      name: 'run_circuit',
      description: '让电路按当前时钟频率跑起来（等于工具栏的 运行）。',
      parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
      run: () => {
        host.run();
        return { running: true };
      },
    },
    {
      name: 'pause_circuit',
      description: '暂停时钟（等于工具栏的 暂停）。',
      parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
      run: () => {
        host.pause();
        return { running: false };
      },
    },
    {
      name: 'step_clock',
      description: '走一个时钟边沿（等于工具栏的 单步），用来观察存储元件的状态。',
      parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
      run: () => {
        host.stepOnce();
        return { stepped: true };
      },
    },
    {
      name: 'reset_circuit',
      description: '停止并复位电路（等于工具栏的 停止并复位）：清空所有存储元件的状态。',
      parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
      run: () => {
        host.reset();
        return { reset: true };
      },
    },
    {
      name: 'run_tests',
      description:
        '运行本关的测试用例并返回判定结果（等于工具栏的 测试）。沙盒里没有用例，会直接告诉你。要等它跑完再决定下一步。',
      parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
      run: async () => host.test(),
    },
    {
      name: 'export_circuit',
      description: '导出当前电路为 tc-circuit 文件的内容（JSON 文本），玩家也可以用它存盘。',
      parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
      run: () => ({ text: host.circuitText() }),
    },
    {
      name: 'import_circuit',
      description:
        '用一段 tc-circuit JSON 文本替换当前电路（等于工具栏的 导入电路）。整块电路会被替换，之前的编辑还在撤销栈里。',
      parameters: {
        type: 'object',
        properties: { text: TEXT('tc-circuit 文件的完整 JSON 文本') },
        required: ['text'],
        additionalProperties: false,
      },
      run: (args: ToolArgs) => {
        const outcome = host.loadCircuit(stringArg(args, 'text'));
        if (!outcome.ok) throw new ToolError(`导入失败：${outcome.error ?? '未知原因'}`);
        return { parts: outcome.parts ?? 0, wires: outcome.wires ?? 0 };
      },
    },
    {
      name: 'select_parts',
      description:
        '选中若干元件（等于 Ctrl+拖拽框选）。选中不改变电路，但它是「封装为元件」的前提，也会让这些元件亮起选中框，方便玩家看清你在说哪些。传空数组就是清空选择。',
      parameters: {
        type: 'object',
        properties: {
          ids: {
            type: 'array',
            description: '要选中的元件 id 列表，例如 ["i1","i2"]',
            items: { type: 'string' },
          },
        },
        required: ['ids'],
        additionalProperties: false,
      },
      run: (args: ToolArgs) => {
        const ids = stringArrayArg(args, 'ids');
        const placement = placementOf(host);
        for (const id of ids) instanceOf(placement, id);
        host.select(ids);
        return { selected: ids };
      },
    },
    {
      name: 'wrap_selection',
      description:
        '把当前选中的元件封装成一个自定义元件（等于 封装为元件 → 确定）。跨过选区边界的导线会变成它的引脚。返回新元件的 id。至少需要两个元件，而且必须有导线跨过边界。',
      parameters: {
        type: 'object',
        properties: {
          nameZh: TEXT('这个元件的中文名，例如「半加器」'),
          nameEn: TEXT('英文名；不填就用中文名'),
        },
        required: ['nameZh'],
        additionalProperties: false,
      },
      run: (args: ToolArgs) => {
        const nameZh = stringArg(args, 'nameZh');
        const nameEn = optionalString(args, 'nameEn') ?? nameZh;
        const id = host.wrapSelection({ zh: nameZh, en: nameEn });
        if (id === null) {
          const count = host.snapshot().selected.length;
          throw new ToolError(
            `这 ${count} 个元件无法封装：至少要有两个元件，而且得有导线跨过选区边界（那才是它的引脚）。先用 select_parts 选好再试`,
          );
        }
        return { id, name: nameZh };
      },
    },
    {
      name: 'enter_component',
      description:
        '打开一个自定义元件的内部电路（等于 编辑内部）。之后的 place_part / connect_pins 等操作都会改这个元件的实现，而不是外面的电路。改完记得 leave_component。',
      parameters: {
        type: 'object',
        properties: { id: TEXT('自定义元件 id，例如 bp1') },
        required: ['id'],
        additionalProperties: false,
      },
      run: (args: ToolArgs) => {
        const id = stringArg(args, 'id');
        if (!host.enterComponent(id)) throw new ToolError(`没有自定义元件 ${id}`);
        return { editing: id };
      },
    },
    {
      name: 'leave_component',
      description: '从自定义元件内部返回外面的电路（等于 返回）。',
      parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
      run: () => {
        host.leaveComponent();
        return { editing: null };
      },
    },
    {
      name: 'rename_component',
      description: '给一个自定义元件改名（等于 重命名）。',
      parameters: {
        type: 'object',
        properties: {
          id: TEXT('自定义元件 id'),
          nameZh: TEXT('新的中文名'),
          nameEn: TEXT('新的英文名；不填就用中文名'),
        },
        required: ['id', 'nameZh'],
        additionalProperties: false,
      },
      run: (args: ToolArgs) => {
        const id = stringArg(args, 'id');
        const nameZh = stringArg(args, 'nameZh');
        const nameEn = optionalString(args, 'nameEn') ?? nameZh;
        if (!host.renameComponent(id, { zh: nameZh, en: nameEn })) {
          throw new ToolError(`没有自定义元件 ${id}`);
        }
        return { id, name: nameZh };
      },
    },
    {
      name: 'delete_component',
      description:
        '删掉一个自定义元件（等于 删除）。如果电路上还有它的实例，会被拒绝——先把那些实例删掉。',
      parameters: {
        type: 'object',
        properties: { id: TEXT('自定义元件 id') },
        required: ['id'],
        additionalProperties: false,
      },
      run: (args: ToolArgs) => {
        const id = stringArg(args, 'id');
        if (!host.deleteComponent(id)) {
          throw new ToolError(`${id} 不能删：电路上还有它的实例，或者它本来就不存在`);
        }
        return { id };
      },
    },
    {
      name: 'set_input',
      description:
        '给关卡的一个输入引脚设定数值（等于点击读数面板里的那一行，用来手动驱动半成品电路）。位宽决定范围。',
      parameters: {
        type: 'object',
        properties: {
          pin: TEXT('输入引脚 id，例如 a'),
          value: {
            type: 'integer',
            description: '要驱动的整数值；超过位宽会被拒绝',
          },
        },
        required: ['pin', 'value'],
        additionalProperties: false,
      },
      run: (args: ToolArgs) => {
        const pin = stringArg(args, 'pin');
        const value = numberArg(args, 'value');
        const input = host.snapshot().inputs.find((candidate) => candidate.id === pin);
        if (!input) {
          const known = host.snapshot().inputs.map((candidate) => candidate.id).join('、');
          throw new ToolError(`本关没有输入引脚 ${pin}。有：${known === '' ? '（没有）' : known}`);
        }
        const max = input.width >= 31 ? Number.MAX_SAFE_INTEGER : 2 ** input.width - 1;
        if (!Number.isInteger(value) || value < 0 || value > max) {
          throw new ToolError(`引脚 ${pin} 是 ${input.width} 位，取值只能是 0 到 ${max}`);
        }
        host.setInput(pin, value);
        return { pin, value };
      },
    },
    {
      name: 'set_program',
      description:
        '写这条关卡的程序文本（等于在汇编编辑器里打字）。只有在会给程序判分的关卡上才可用；文本要先汇编通过，判定才可能通过。',
      parameters: {
        type: 'object',
        properties: { text: TEXT('完整的程序文本，可以多行') },
        required: ['text'],
        additionalProperties: false,
      },
      run: (args: ToolArgs) => {
        if (!host.snapshot().expectsProgram) {
          throw new ToolError('这一关不给程序判分：编辑器根本没有挂出来，写程序也没用');
        }
        const text = stringArg(args, 'text');
        host.setProgram(text);
        return { lines: text.split('\n').length };
      },
    },
  ];

  /**
   * THE PLAYER'S LINE FOR EACH TOOL, kept out of the tool objects.
   *
   * A presenter is a pure function of what the tool returned and what it was
   * asked, so it belongs beside the list rather than inside each entry -- and
   * writing them as one table is what makes it obvious at a glance which tools
   * have nothing to say (none of them, as it turns out: a row that reads
   * `read_board · {"mode":"level","dev":false,…}` is a row nobody can use).
   */
  const nameOf = (defId: string): string =>
    host.parts().find((part) => part.id === defId)?.nameZh ?? defId;

  const presenters: Record<string, (result: unknown, args: ToolArgs) => string> = {
    read_board: () => {
      const board = host.snapshot();
      return `看了一眼电路：${board.parts.length} 个元件、${board.wires.length} 根导线`;
    },
    list_parts: () =>
      `列出可用元件：${host
        .parts()
        .filter((part) => !part.hidden)
        .map((part) => part.nameZh)
        .join('、')}`,
    place_part: (result) => {
      const placed = result as { id: string; defId: string; x: number; y: number };
      return `在 (${placed.x}, ${placed.y}) 放了 ${nameOf(placed.defId)}（${placed.id}）`;
    },
    move_part: (result) => {
      const moved = result as { id: string; x: number; y: number };
      return `把 ${moved.id} 移到 (${moved.x}, ${moved.y})`;
    },
    connect_pins: (result) => {
      const wire = result as { from: string; to: string };
      return `把 ${wire.from} 接到 ${wire.to}`;
    },
    delete_wire: (_result, args) => `删掉导线 ${stringArg(args, 'wireId')}`,
    delete_part: (result) => {
      const removed = result as { id: string; removedWires: number };
      return removed.removedWires > 0
        ? `删掉 ${removed.id}，连带 ${removed.removedWires} 根导线`
        : `删掉 ${removed.id}`;
    },
    undo_last: () => '撤销一步',
    redo_last: () => '重做一步',
    run_circuit: () => '让时钟跑起来',
    pause_circuit: () => '暂停时钟',
    step_clock: () => '走一个时钟边沿',
    reset_circuit: () => '停止并复位',
    run_tests: (result) => (result as { summary: string }).summary,
    export_circuit: (result) => `导出电路（${(result as { text: string }).text.length} 个字符）`,
    import_circuit: (result) => {
      const imported = result as { parts: number; wires: number };
      return `导入电路：${imported.parts} 个元件、${imported.wires} 根导线`;
    },
    select_parts: (_result, args) => {
      const ids = stringArrayArg(args, 'ids');
      return ids.length === 0 ? '清空选择' : `选中 ${ids.join('、')}`;
    },
    wrap_selection: (result) => {
      const wrapped = result as { id: string; name: string };
      return `封装成「${wrapped.name}」（${wrapped.id}）`;
    },
    enter_component: (_result, args) => `打开 ${stringArg(args, 'id')} 的内部电路`,
    leave_component: () => '回到外面的电路',
    rename_component: (result) => {
      const renamed = result as { id: string; name: string };
      return `把 ${renamed.id} 改名为「${renamed.name}」`;
    },
    delete_component: (_result, args) => `删掉自定义元件 ${stringArg(args, 'id')}`,
    set_input: (result) => {
      const driven = result as { pin: string; value: number };
      return `把输入 ${driven.pin} 设为 ${driven.value}`;
    },
    set_program: (result) => `写入程序（${(result as { lines: number }).lines} 行）`,
  };

  return tools.map((tool) => {
    const present = presenters[tool.name];
    return present === undefined ? tool : { ...tool, present };
  });
}
