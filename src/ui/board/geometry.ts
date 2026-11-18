/**
 * 元件及其引脚在画板上的实际位置。
 *
 * 这些函数是从 `view.ts` 拆出来的：导线布线器需要它们，`view.ts` 也需要布线器。
 * 布线器必须知道元件的矩形才能绕开它；`view.ts` 必须拿到布线后的折线才能做命中测试。
 * 若两者都留在 `view.ts`，`view.ts` 与布线模块就会互相 import —— 这种循环在 ESM 里能跑，
 * 却会给下一个读代码的人埋坑。于是“所有模块都认可的几何”下沉到这里，
 * 再由 `view.ts` 重新导出，保证画板的公开几何仍然只从一处获得。
 *
 * 纯函数模块：不碰 DOM、不碰 store、不碰 Canvas。
 */
import type { ComponentDef, Registry } from '../../core/registry';
import type { Graph, Instance } from '../../core/graph';
import { GRID, INSTANCE_HEIGHT, INSTANCE_WIDTH, PIN_SPACING } from '../theme';
import type { Point } from './routing';

/**
 * 元件最外侧引脚上方、下方留出的空白。
 *
 * 取 12，正是它让“三个引脚”恰好等于 72：当初登记的本体高度是按“每个元件最多三个引脚”定的；
 * 这里把同一个数字改写成它“用来干什么”（上下留白），而不是一个总高度。
 */
const PIN_MARGIN = 12;

/** 轴对齐矩形，单位是世界坐标（世界像素）：x/y 为左上角，w/h 为宽高。 */
export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/**
 * 把坐标吸附到 8 像素网格上。
 *
 * `=== 0` 这一分支的作用是把 `-0` 归一成 `0`。
 * `Math.round(-0.375)` 得到 `-0`，再乘 8 仍然是 `-0`；
 * 少了这一步，放在原点左侧一点的元件会把 `-0` 当作坐标存下来。
 * 而 `Object.is(-0, 0)` 为 false，于是编辑器（以及测试）里所有的位置比较，
 * 都会认为两个本该相同的网格单元不相等。
 */
export function snap(v: number): number {
  const snapped = Math.round(v / GRID) * GRID;
  return snapped === 0 ? 0 : snapped;
}

/** 元件本体：所有引脚都相对这个矩形排布。宽度固定，高度由引脚数量决定。 */
export function instanceRect(inst: Instance, def: ComponentDef): Rect {
  return { x: inst.x, y: inst.y, w: INSTANCE_WIDTH, h: instanceHeight(def) };
}

/**
 * 元件本体需要多高，才装得下它自己的所有引脚。
 *
 * 引脚是玩家要瞄准的目标，所以引脚间距保持不变，让“本体”长高去容纳它们：
 * 一个 8 路输出的分离器应该是一个高个子元件，而不是一个矮盒子下面挂六个悬空的小方块。
 * 画板过去画的正是后者——登记高度固定为 72，而 `pinPosition` 不管数量多少都把引脚
 * 均分在中心两侧，于是同侧超过三个引脚的元件就会在纸上拖出一列松散的小方块。
 *
 * 三个引脚恰好是 72，所以原本就放得下的元件一个都没变：关卡的输入/输出连接器、
 * 所有 1 位门，以及所有位宽运算器（它们最多三个引脚）。
 * 长高的是本来就该高的那些：分离器与合并器、全加器、多位存储器和机器。
 *
 * 公式 `(pins-1) * PIN_SPACING + PIN_MARGIN*2`：pins 个引脚占 (pins-1) 段间距，
 * 上下各留 PIN_MARGIN。三个引脚时 = 2*24 + 12*2 = 72，与旧高度一致。
 */
export function instanceHeight(def: ComponentDef): number {
  const pins = Math.max(def.inputs.length, def.outputs.length);
  return Math.max(INSTANCE_HEIGHT, (pins - 1) * PIN_SPACING + PIN_MARGIN * 2);
}

/**
 * 引脚布局：输入沿本体左边缘排，输出沿右边缘排。
 *
 * 纵坐标以本体中心为对称轴按 `PIN_SPACING` 展开：
 * 第 i 个引脚相对中心偏移 `(i - (count-1)/2) * PIN_SPACING`。
 * 因此引脚个数为奇数时，正中间那个恰好落在中心线上；为偶数时中心线落在两个引脚之间。
 * 横坐标：输入在本体左边缘（`inst.x`），输出在右边缘（`inst.x + INSTANCE_WIDTH`）。
 *
 * @param inst 元件实例，提供左上角位置
 * @param def 元件定义，决定引脚清单和本体高度
 * @param pinId 要定位的引脚 id（调用方保证它存在于输入或输出清单中）
 * @param isInput true 查输入引脚，false 查输出引脚
 * @returns 该引脚在世界坐标中的圆心
 */
export function pinPosition(
  inst: Instance,
  def: ComponentDef,
  pinId: string,
  isInput: boolean,
): Point {
  const pins = isInput ? def.inputs : def.outputs;
  const index = pins.findIndex((p) => p.id === pinId);
  const count = Math.max(1, pins.length);
  const y = inst.y + instanceHeight(def) / 2 + (index - (count - 1) / 2) * PIN_SPACING;
  const x = isInput ? inst.x : inst.x + INSTANCE_WIDTH;
  return { x, y };
}

/**
 * 画板上所有元件的外接矩形，供任何需要避让元件的代码使用。
 *
 * 定义已从注册表消失的实例会被跳过：它画不出来，也不该挡住布线。
 */
export function partRects(graph: Graph, registry: Registry): Rect[] {
  const rects: Rect[] = [];
  for (const inst of graph.instances) {
    if (!registry.has(inst.def)) continue;
    rects.push(instanceRect(inst, registry.get(inst.def)));
  }
  return rects;
}

/**
 * 在 `world` 处放下的元件最终落在哪里。
 *
 * 鼠标位置会成为元件左边缘、垂直中心——也就是它第一个输出引脚所在的那一行，
 * 这样玩家的手已经落在马上要拉出的那根导线上。
 * 只在这里写一次，因为有两个地方要用它：真正放下元件，以及显示落点的半透明手持预览。
 * 如果预览的位置和最终落点不一致，那比没有预览更糟。
 */
export function placementAt(world: Point, def: ComponentDef): Point {
  return { x: snap(world.x), y: snap(world.y - instanceHeight(def) / 2) };
}
