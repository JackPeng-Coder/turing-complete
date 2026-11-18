/**
 * 智能体可以执行的操作，以工具的形式给出。
 *
 * 手上的每个动作对应一个工具，而每个工具都复用玩家双手所用的同一批零件：
 * 玩家自己撤销栈上的一个可撤销 `Command`，或者通过 `AgentHost` 触达的某个工具栏按钮。
 * 这里不直接改动电路图——只有 `do` 与 `undo` 会真正改动状态，所以智能体的编辑
 * 既能用 Ctrl+Z 撤销，也和玩家亲手做出的编辑完全一致（需求 A3）。
 *
 * 为什么工具面不是「全部功能」。工具清单是模型在每一步之前都要读的东西，
 * 每多一个工具，就在每次请求里多占一份注意力，也多一条选错的路。省略的工具
 * 是有意省略并记录在案的：打开关卡、解锁元件、修改进度与蓝图库都不在其中，
 * 因为目标把智能体限定在玩家眼前的电路上。见阶段计划的「裁决」表。
 *
 * 坐标就是画板自己的坐标。工具接收世界像素，再通过宿主吸附到网格，
 * 因此智能体的算术不必知道网格尺寸——那由 `ui/theme.ts` 负责，而本层不允许导入它。
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

/** 一小段 schema 工厂：让每个工具的参数声明都用同一种写法。 */
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
 * 元件托盘对一个实例的引脚给出的说法。
 *
 * 实例的定义（def）必须查表得到，不能凭假设：画板上可能有智能体从未见过的元件，
 * 而引脚 id 只有对照声明它的那份定义才有意义。
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

/** 整份工具清单，绑定到一个宿主上。 */
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
        '列出当前可以放置的元件类型及其全部引脚（id、位宽）。放置前用 pin 的 id 来连线。注意「关卡输入/关卡输出」也是普通元件：把它们放进电路，电路才和关卡接上。',
      parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
      run: () =>
        // 元件托盘原样照搬。托盘提供什么，智能体就能放什么，连接器也不例外——
        // 它们和别的元件一样，是玩家会随手放下的普通元件；把它们从这份清单里
        // 藏掉，曾让一次真实会话完全无法把电路接到关卡上。
        host.parts().map((part) => ({
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
      description: `在电路板上放一个元件。坐标是世界像素，会被对齐到网格；原点在左上，x 向右、y 向下。元件大约 72×72，引脚在左右两侧，所以两个元件之间水平至少留 96、垂直至少留 96，否则会叠在一起。返回新元件的 id（关卡输入/输出会拿到关卡固定的 id，例如 IN_a / OUT，不用管你传的坐标和名字）。${BOARD_HELP}`,
      parameters: {
        type: 'object',
        properties: {
          defId: TEXT('元件类型 id，例如 nand / not / and / or / const_on / level_output'),
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
          // 只给上限，不倾倒整个目录。五十个 id 排成一面墙，读起来很贵，
          // 而且每次重试都是同一面墙；一个在猜名字的模型会继续猜下去——
          // 它需要的是列表的指针和数量，不是列表本身。
          const known = [...placement.defs.values()].map((part) => part.id);
          const sample = known.slice(0, 12).join('、');
          throw new ToolError(
            `没有元件类型「${defId}」。可用的一共 ${known.length} 种，例如 ${sample}。` +
              `不要再猜名字：先 list_parts 看完整列表和每个元件的引脚`,
          );
        }
        const at = host.snap(numberArg(args, 'x'), numberArg(args, 'y'));
        // 关卡连接器要拿关卡绑定的那个 id。`compile` 把关卡的引脚匹配到
        // 名为 `IN_<pin>` 与 `OUT` 的实例上，所以用临时 id 放下的连接器
        // 会看起来好好地待在画板上，却永远不会被读取——这是一个无法修复的
        // 电路，测试只会报「2 个用例失败」而不给任何线索。宿主给出的是与
        // 手工放置相同的 `levelIoPlacement`，`null` 表示「你自己起名」。
        const connector = host.connectorFor(defId);
        // id 在这里铸出，而不是在 `do` 里：命令必须可重复执行（每次重做都会
        // 再跑一遍），所以它要做的一切都必须在入栈之前决定——见 `app/commands.ts`。
        const id = connector?.id ?? nextId('i', placement.graph.instances);
        const width = connector?.width;
        host.apply(
          {
            label: `agent add ${defId}`,
            do: (g) => {
              const inst = addInstance(g, defId, at.x, at.y, id);
              // 绑定的是 id 与位宽两者：关卡引脚只有关卡声明的那么宽，
              // `compile` 会拒绝位宽不一致的连接器。
              if (width !== undefined) inst.params.width = width;
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
        // 被替换的导线在这里捕获，撤销时不重新读取：命令必须把画板恢复成
        // 它运行之前的样子，而到撤销时，那个状态只存在于这个闭包里。
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
          const outs = host
            .snapshot()
            .outputs.map((candidate) => candidate.id)
            .join('、');
          throw new ToolError(
            known === ''
              ? `本关没有输入引脚（${pin} 不是）。这一关没有输入，需要驱动的是输出：${outs}——把电路接到 level_output 元件上`
              : `本关没有输入引脚 ${pin}。有：${known}`,
          );
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
   * 每个工具交给玩家看的那一句话，放在工具对象之外。
   *
   * presenter 是「工具返回了什么」与「它被要求做什么」的纯函数，所以它属于
   * 清单旁边而不是每个条目内部——把它们写成一张表，一眼就能看出哪些工具
   * 无话可说（结果一个也没有：一行只显示 `read_board · {"mode":"level",...}`
   * 的日志，是没人能用的日志）。
   */
  const nameOf = (defId: string): string =>
    host.parts().find((part) => part.id === defId)?.nameZh ?? defId;

  const presenters: Record<string, (result: unknown, args: ToolArgs) => string> = {
    read_board: () => {
      const board = host.snapshot();
      return `看了一眼电路：${board.parts.length} 个元件、${board.wires.length} 根导线`;
    },
    list_parts: () => {
      // 隐藏的管道在关卡里是噪音：关卡连接器属于关卡，玩家早就知道画板有引脚。
      // 在沙盒里，连接器就是画板的引脚（`sandboxPins`），所以把它们丢掉的一行
      // 会读成「这里没有输入或输出」，而元件托盘明明两样都提供——这正是本摘要
      // 要避免的困惑。
      const sandbox = host.snapshot().mode === 'sandbox';
      const shown = host.parts().filter((part) => sandbox || !part.hidden);
      return `列出可用元件：${shown.map((part) => part.nameZh).join('、')}`;
    },
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
    run_tests: (result) => {
      const outcome = result as {
        summary: string;
        failures: readonly {
          tick: number;
          expected: Readonly<Record<string, number>>;
          actual: Readonly<Record<string, number>>;
        }[];
      };
      const first = outcome.failures[0];
      if (first === undefined) return outcome.summary;
      const pins = Object.keys(first.expected).map(
        (pin) => `${pin} 期望 ${first.expected[pin]}、实际 ${first.actual[pin] ?? '未知'}`,
      );
      const rest = outcome.failures.length > 1 ? `，还有 ${outcome.failures.length - 1} 个用例不符` : '';
      return `第 ${first.tick} 拍 ${pins.join('，')}${rest}`;
    },
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
