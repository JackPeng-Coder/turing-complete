/**
 * 画板的 Canvas 绘制。
 *
 * 绘制是 store 当前状态的纯函数：什么时候重绘由调用方决定（状态变化、时钟边沿或窗口缩放），
 * 绝不使用 rAF 循环——静止的画板不该每秒重绘 60 次。
 * 平移、缩放和拖拽都要经过 `store.set`，所以只要这一帧里真有东西在动，就仍然会重绘。
 *
 * 图层自下而上：纸面、吸附网格、导线、元件（本体、丝印与角标、引脚）；
 * 拖拽预览、框选和手持预览由 `renderBoard` 在最后补画。
 *
 * 视觉风格参考原作：深色纸面配编织纹、直角带圆角的走线、关卡引脚做成胶囊或圆。
 * 但配色已经按本项目的“仪器化”规则重定，全部取自 `theme.ts`：
 * 绿 = 1，红 = 0，蓝 = 宽于一位，slate 灰 = 还没仿真。
 * 元件的形状表达它“是什么”（经典逻辑符号），颜色表达它“此刻在做什么”（见 `partAppearance`）。
 * 不取自原作的是几何：`view.ts` 决定元件与引脚的位置，
 * 端到端测试正是按那套几何产生的坐标去拖导线。
 */
import {
  BUS_WIDTH,
  GRID,
  INSTANCE_WIDTH,
  PART_RADIUS,
  PIN_RADIUS,
  THEME,
  WIRE_WIDTH,
  bodyColourOf,
  glowColourOf,
  partStateOf,
  type PartState,
} from '../theme';
import type { AppState, Store } from '../../app/store';
import { instanceRect, placementAt, pinPosition, worldToScreen, type Camera, type Point } from './view';
import { instanceHeight } from './geometry';
// 手持预览要显示“放下时”连接器将得到的 id 与位宽，
// 所以它直接询问放置时用的同一个函数，而不是再抄一份规则。
import { levelIoPlacement } from './interact';
import { CORNER_RADIUS, cornerRadii, longestSegment, routeWire } from './routing';
import { planRoutes } from './routes';
import { partCodeOf } from './markings';
import type { Graph, Instance } from '../../core/graph';
import type { ComponentDef, Registry } from '../../core/registry';
// 引脚位宽的规则属于编译器，这里不抄一份：若渲染器与 `core/net.ts` 理解不一致，
// 它就会把一根总线画成一位宽，或者把字节当一位来布线。
import { effectiveWidth } from '../../core/net';

/**
 * 画板要画、但 store 里并不保存的全部东西。
 *
 * 由 `signals.ts`（数值）和 `main.ts`（视图开关）生产，以参数形式传入而不是从 store 读取：
 * 测试和窗口缩放处理也会重绘画板，而它们手边并没有一份仿真。
 */
export interface BoardView {
  /** 输出引脚的值，键为 `${instanceId}.${portId}`。 */
  readonly outputs: ReadonlyMap<string, number>;
  /** 电路没有到达不动点时为 false：任何数值都不可信。 */
  readonly stable: boolean;
  /** 是否绘制吸附网格。 */
  readonly grid: boolean;
  /**
   * 指针所在的世界坐标；指针不在画板上时为 `null`。
   *
   * 属于视图状态而不是 store 状态：它应该和相机放在一起，每次鼠标移动都会变，
   * 而画板上唯一读它的东西，就是元件托盘里那个手持预览。
   */
  readonly ghost: Point | null;
}

/**
 * 元件本体的轮廓形状。
 *
 * 原作给每种门单独的轮廓，值得照抄：一整板一模一样的方框不会告诉玩家他看的是什么，
 * 而形状比标签读得更快。这些就是经典逻辑符号，原作用的也是它们。
 */
export type GateShape = 'box' | 'd' | 'or' | 'xor' | 'triangle' | 'block' | 'split' | 'make';

/** 一个元件的外观：轮廓族，以及它是否反相（输出端带气泡）。 */
export interface GateLook {
  /** 轮廓族。`box` 表示所有非布尔门的元件。 */
  readonly shape: GateShape;
  /** 为 true 时该门反相：输出端画经典的小圆圈（气泡）。 */
  readonly bubble: boolean;
}

/**
 * 一个元件的外观，按 id 查表。
 *
 * 两个反相族靠气泡区分，而不是靠本体——逻辑图就是这么画的，也是 `nand` 与 `and` 的区别：
 * 十个布尔元件、十种轮廓——NOT 是三角形，AND 及其三输入形式是 D 形，OR 是盾形，
 * XOR 是带第二道弧的盾形，四个反相门在输出端加气泡，全加器是切角方块，
 * 因为它是电路而不是门，就按电路来画。
 *
 * 有测试遍历注册表的 `logic1` 家族，任何落进 `box` 的成员都会失败，
 * 后来新增的门因此不能悄悄没有形状。
 */
export function gateLookOf(def: ComponentDef): GateLook {
  switch (def.id) {
    case 'not':
      return { shape: 'triangle', bubble: true };
    case 'and':
    case 'and3':
      return { shape: 'd', bubble: false };
    case 'nand':
      return { shape: 'd', bubble: true };
    case 'or':
    case 'or3':
      return { shape: 'or', bubble: false };
    case 'nor':
      return { shape: 'or', bubble: true };
    case 'xor':
      return { shape: 'xor', bubble: false };
    case 'xnor':
      return { shape: 'xor', bubble: true };
    case 'full_adder':
      return { shape: 'block', bubble: false };
    // 两个打包/拆包器是唯一“形状即功能”而不是“形状即家族”的元件：
    // 一个漏斗，写字的一端窄、出位的一端宽。
    // 一个字节进去、每位一个输出出来（`split`），或者同一幅图反过来（`make`）。
    // 沙盒注册的 16/32 位变体是同一个元件换了位宽，所以轮廓相同——
    // 和所有带位宽后缀的 id 一样共用基础丝印，因为位宽由引脚说明。
    case 'splitter':
    case 'splitter16':
    case 'splitter32':
      return { shape: 'split', bubble: false };
    case 'maker':
    case 'maker16':
    case 'maker32':
      return { shape: 'make', bubble: false };
    default:
      return { shape: 'box', bubble: false };
  }
}

/** 输出端为反相气泡预留的空间，单位：世界像素。 */
const BUBBLE_ROOM = 13;
/** XOR 的本体比它多出的那道弧后退多少，单位：世界像素。 */
const XOR_BACK = 9;
/** 漏斗窄端高度的一半，单位：世界像素。 */
const FLAT_END = 9;

/**
 * 画板上所有丝印与读数使用的字体。
 *
 * 与 `style.css` 给界面外壳的字体是同一套，于是门上的 `NAND` 和顶栏的 `门 4 个`
 * 看起来来自同一台仪器。中文永远到不了这里：元件丝印是拉丁字母，数字就是数字。
 */
const MONO = 'ui-monospace, "Cascadia Mono", Consolas, monospace';

/**
 * 文字在元件本体里的横向位置，取本体宽度的比例。
 *
 * 文字若居中于“轮廓”而不是“矩形”，就会落到弧线上或跑出尖端：
 * 三角形的质量在顶点之后，D 形的质量在半圆左侧，盾形的质量在尖端左侧。
 */
const LABEL_CENTRE: Record<GateShape, number> = {
  box: 0.5,
  block: 0.5,
  d: 0.42,
  or: 0.45,
  xor: 0.42,
  triangle: 0.36,
  // 漏斗的质量在它宽的一端，也就是出位的那一端。
  split: 0.58,
  make: 0.42,
};

/** 方块被切掉的角：原理图里“这是一块电路”的记号。 */
const BLOCK_CHAMFER = 14;

/**
 * 开始勾勒元件本体的路径。
 *
 * `box` 交给 `roundedRect`；其余是经典符号。每个反相门都在输出边缘让出 `BUBBLE_ROOM`，
 * 好让气泡有地方放，而不至于压在引脚上。
 */
function traceBody(
  ctx: CanvasRenderingContext2D,
  look: GateLook,
  x: number,
  y: number,
  w: number,
  h: number,
  zoom: number,
  boxRadius: number,
): void {
  if (look.shape === 'box') {
    roundedRect(ctx, x, y, w, h, boxRadius);
    return;
  }
  const right = x + w - (look.bubble ? BUBBLE_ROOM * zoom : 0);
  const cy = y + h / 2;
  const radius = h / 2;
  ctx.beginPath();
  switch (look.shape) {
    case 'block': {
      // 一个圆角矩形切掉左上角：这是“方块代表电路而不是门”的长期记号。
      const cut = BLOCK_CHAMFER * zoom;
      const r = Math.min(PART_RADIUS * zoom, h / 4);
      ctx.moveTo(x + cut, y);
      ctx.lineTo(x + w - r, y);
      ctx.arcTo(x + w, y, x + w, y + r, r);
      ctx.lineTo(x + w, y + h - r);
      ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
      ctx.lineTo(x + r, y + h);
      ctx.arcTo(x, y + h, x, y + h - r, r);
      ctx.lineTo(x, y + cut);
      ctx.closePath();
      break;
    }
    case 'triangle':
      ctx.moveTo(x, y);
      ctx.lineTo(right, cy);
      ctx.lineTo(x, y + h);
      ctx.closePath();
      break;
    case 'split': {
      // 漏斗。形状就是该元件的全部工作：一个字从左边的一点进入，
      // 每个输出从右边带一位出去。尖端这一小段平面就是那个宽引脚的落脚点。
      const flat = Math.min(FLAT_END * zoom, h / 4);
      ctx.moveTo(x + FLAT_END * 1.6 * zoom, y);
      ctx.lineTo(right, y);
      ctx.lineTo(right, y + h);
      ctx.lineTo(x + FLAT_END * 1.6 * zoom, y + h);
      ctx.lineTo(x, cy - flat);
      ctx.lineTo(x, cy + flat);
      ctx.closePath();
      break;
    }
    case 'make': {
      // 同一个漏斗反过来：左边每位一个输入，右边尖点吐出整个字。
      const flat = Math.min(FLAT_END * zoom, h / 4);
      ctx.moveTo(x, y);
      ctx.lineTo(right - FLAT_END * 1.6 * zoom, y);
      ctx.lineTo(right, cy - flat);
      ctx.lineTo(right, cy + flat);
      ctx.lineTo(right - FLAT_END * 1.6 * zoom, y + h);
      ctx.lineTo(x, y + h);
      ctx.closePath();
      break;
    }
    case 'd':
      // 输入到达的一侧是平的，输出离开的一侧是半圆——
      // 而且平直段必须比圆弧提前一个半径结束，否则接不上圆弧。
      ctx.moveTo(x, y);
      ctx.lineTo(right - radius, y);
      ctx.arc(right - radius, cy, radius, -Math.PI / 2, Math.PI / 2);
      ctx.lineTo(x, y + h);
      ctx.closePath();
      break;
    default: {
      // OR 与 XOR：凹进去的背，以及两条凸曲线在尖端汇合。
      const back = look.shape === 'xor' ? x + XOR_BACK * zoom : x;
      const belly = x + (right - x) * 0.58;
      ctx.moveTo(back, y);
      ctx.quadraticCurveTo(belly, y, right, cy);
      ctx.quadraticCurveTo(belly, y + h, back, y + h);
      ctx.quadraticCurveTo(back + (right - back) * 0.34, cy, back, y);
      ctx.closePath();
      break;
    }
  }
}

/**
 * 轮廓之外的记号：XOR 在输入边的第二道弧，以及四个反相门上的气泡。
 */
function paintMarks(
  ctx: CanvasRenderingContext2D,
  look: GateLook,
  x: number,
  y: number,
  w: number,
  h: number,
  zoom: number,
): void {
  const cy = y + h / 2;
  if (look.shape === 'xor') {
    const right = x + w - (look.bubble ? BUBBLE_ROOM * zoom : 0);
    ctx.beginPath();
    ctx.moveTo(x + 3 * zoom, y);
    ctx.quadraticCurveTo(x + (right - x) * 0.42, cy, x + 3 * zoom, y + h);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
    ctx.lineWidth = Math.max(1, 1.5 * zoom);
    ctx.stroke();
  }
  if (look.bubble) {
    const r = (BUBBLE_ROOM * zoom) / 2;
    ctx.beginPath();
    ctx.arc(x + w - r, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = THEME.board;
    ctx.fill();
    ctx.strokeStyle = THEME.idleEdge;
    ctx.lineWidth = Math.max(1, 1.5 * zoom);
    ctx.stroke();
  }
}

/**
 * 元件的本体颜色表示它自己的状态，而不是它的家族。
 *
 * 过去按 `def.category` 上色——原始门蓝色、多位元件绿色——那表达的是“元件是什么”。
 * 现在画板表达的是“元件正在做什么”：产出 1 时绿色、产出 0 时红色、
 * 处理一个字时蓝色、还没运行过时 slate 灰。
 * 家族仍然能从轮廓看出来（`gateLookOf`），所以把颜色花在状态上并没有丢信息。
 *
 * 由最宽的引脚决定，而不是第一个输出。读 `outputs[0]` 会让分离器在 bit 0 恰好为高时变成绿色——
 * 一个处理字的元件穿着一位的颜色；而合并器因为它的第一个输出是字节而被画成蓝色——
 * 一对打包器的两半对“自己是什么”各执一词。
 * 元件有多宽由最宽的引脚决定：`and8` 和 `equal8` 是字元件，分离器和合并器是字元件，
 * 而比较运算产生的答案仍然能从那根离开它的导线上读出来，那是绿色或红色。
 */
function partAppearance(
  def: ComponentDef,
  inst: Instance,
  view: BoardView | null | undefined,
  driven: ReadonlyMap<string, number>,
): { state: PartState; colour: string; glow: string | null } {
  const value = outValueOf(def, inst, view, driven);
  const state = partStateOf(partWidthOf(def, inst), value);
  return { state, colour: bodyColourOf(state), glow: glowColourOf(state) };
}

/**
 * 一个元件自称的宽度：输入与输出一起取最宽的那个。
 *
 * 单独导出是因为这条规则值得单独说明——`appearance.test.ts` 会遍历“两端宽度不一致”的元件，
 * 而那正是“读错了一端”会暴露出来的地方。
 */
export function partWidthOf(def: ComponentDef, inst: Instance): number {
  let width = 1;
  for (const pin of [...def.inputs, ...def.outputs]) {
    width = Math.max(width, effectiveWidth(inst, pin));
  }
  return width;
}

/** 一个元件该报告什么值：它自己的输出，或者它作为接收端被喂进去的值。 */
function outValueOf(
  def: ComponentDef,
  inst: Instance,
  view: BoardView | null | undefined,
  driven: ReadonlyMap<string, number>,
): number | undefined {
  const out = def.outputs[0];
  if (out) return outputValue(view, inst.id, out.id);
  const sink = def.inputs[0];
  return sink ? driven.get(`${inst.id}.${sink.id}`) : undefined;
}

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number | readonly number[],
): void {
  ctx.beginPath();
  // `roundRect` 在所有现代浏览器上都是快路径；
  // 矩形兜底让旧浏览器不至于每帧抛一次异常。
  if (typeof ctx.roundRect === 'function') ctx.roundRect(x, y, w, h, r as number);
  else ctx.rect(x, y, w, h);
}

/**
 * 非布尔门元件本体的轮廓圆角半径：关卡引脚是胶囊或圆，其余是圆角矩形。
 */
function boxRadiusOf(def: ComponentDef, h: number, zoom: number): number {
  return def.category === 'level' ? h / 2 : PART_RADIUS * zoom;
}

/**
 * 元件用哪种轮廓绘制；画板与手持预览共用同一份决定。
 *
 * 手持预览和已放置元件过去用的是不同的本体，关卡连接器正是露馅的地方：
 * 预览把 `PART_RADIUS` 传给 `traceBody`，而已放置元件问的是 `boxRadiusOf`，
 * 于是“关卡输出”预览时是圆角矩形、落下后却变成圆。
 * 关卡输入在另一条轴上有一模一样的毛病：预览按“定义 id”判断是否画箭头，
 * 画板按“实例 id 前缀”判断，于是一个多余的 `level_input`
 * （关卡引脚放完后被分配成 `i1`）预览时是箭头、画出来却是方块。
 *
 * 一个函数、两个调用方：预览再也不可能和结果在几何上意见不一。
 * 箭头是关卡输入自己的符号；关卡输出是“圆角半径等于高度一半”的本体，也就是元件尺寸下的圆。
 */
export type PartSilhouette =
  | { readonly kind: 'level-arrow' }
  | { readonly kind: 'body'; readonly look: GateLook; readonly radius: number };

export function silhouetteOf(def: ComponentDef, h: number, zoom: number): PartSilhouette {
  if (def.category === 'level' && def.id === 'level_input') return { kind: 'level-arrow' };
  return { kind: 'body', look: gateLookOf(def), radius: boxRadiusOf(def, h, zoom) };
}

/** 在指定矩形上勾勒一种轮廓；已放置元件与手持预览共用的唯一绘制路径。 */
export function traceSilhouette(
  ctx: CanvasRenderingContext2D,
  silhouette: PartSilhouette,
  p: Point,
  w: number,
  h: number,
  zoom: number,
): void {
  if (silhouette.kind === 'level-arrow') {
    traceLevelArrow(ctx, p, w, h, zoom);
    return;
  }
  traceBody(ctx, silhouette.look, p.x, p.y, w, h, zoom, silhouette.radius);
}

/**
 * 元件定义声明的位宽，在实例覆盖它之前。
 *
 * 手持预览汇报的就是这个值：普通元件放下时会采用定义自己的位宽，
 * 而关卡连接器的位宽来自引脚（见 `drawGhost`）。
 */
export function declaredWidthOf(def: ComponentDef): number {
  let width = 1;
  for (const pin of [...def.inputs, ...def.outputs]) width = Math.max(width, pin.width);
  return width;
}

/**
 * 纸面：一层平的深导航蓝，上面覆着柔和的斜向编织纹。
 *
 * 编织纹用 pattern 而不是一串 `stroke()` 调用，因为原作里的它不是一根发丝线。
 * 早期沿参考图的一行采样过：纸面在一个 24 像素周期里先升后降，
 * 较亮的高原大约覆盖四分之一面积；每个周期只画一条 1 像素线像稀疏的划痕，
 * 五条重叠描边又会高出纸面两级——两者都量过，都不对。
 *
 * 于是改成填充色带：一个 24 单位的方块覆盖区域 `3 ≤ x + y ≤ 13`
 * （斜 45 度、宽 7 单位的带），用沿法线方向渐隐的渐变填充。
 * 重复这个方块就能无缝重现 `x + y ≡ c (mod 24)`——色带跨过方块边界继续延伸，
 * 这也是它必须是多边形而不是描边线的原因。它在相机变换下绘制，
 * 所以编织纹是画板材质的一部分：平移时它跟着电路一起走，而不是在下面滑一张贴图。
 * （现行配色由 `theme.ts` 决定，编织纹与纸面的亮度差控制在三到五级。）
 */
let weaveTile: HTMLCanvasElement | null = null;
const weavePatterns = new WeakMap<CanvasRenderingContext2D, CanvasPattern>();

const WEAVE_TILE = 24;
const WEAVE_INNER = 3;
const WEAVE_OUTER = 13;

/** 把 `#rrggbb` 拆成 `r, g, b`，用于构造渐隐到透明的渐变端点。 */
function rgbTriplet(hex: string): string {
  const n = Number.parseInt(hex.slice(1), 16);
  return `${(n >> 16) & 0xff}, ${(n >> 8) & 0xff}, ${n & 0xff}`;
}

function weaveFor(ctx: CanvasRenderingContext2D): CanvasPattern | null {
  const cached = weavePatterns.get(ctx);
  if (cached) return cached;
  if (!weaveTile) {
    const tile = document.createElement('canvas');
    tile.width = WEAVE_TILE;
    tile.height = WEAVE_TILE;
    const tctx = tile.getContext('2d');
    if (!tctx) return null;
    // 渐变沿色带的法线 `(1, 1)` 方向，从色带一边到另一边；渐变中点就是色带中心线。
    const ramp = tctx.createLinearGradient(
      WEAVE_INNER / 2,
      WEAVE_INNER / 2,
      WEAVE_OUTER / 2,
      WEAVE_OUTER / 2,
    );
    const rgb = rgbTriplet(THEME.boardHatch);
    ramp.addColorStop(0, `rgba(${rgb}, 0)`);
    ramp.addColorStop(0.5, THEME.boardHatch);
    ramp.addColorStop(1, `rgba(${rgb}, 0)`);
    tctx.fillStyle = ramp;
    tctx.beginPath();
    tctx.moveTo(WEAVE_INNER, 0);
    tctx.lineTo(WEAVE_OUTER, 0);
    tctx.lineTo(0, WEAVE_OUTER);
    tctx.lineTo(0, WEAVE_INNER);
    tctx.closePath();
    tctx.fill();
    weaveTile = tile;
  }
  const pattern = ctx.createPattern(weaveTile, 'repeat');
  if (pattern) weavePatterns.set(ctx, pattern);
  return pattern;
}

function drawPaper(ctx: CanvasRenderingContext2D, camera: Camera, w: number, h: number): void {
  ctx.fillStyle = THEME.board;
  ctx.fillRect(0, 0, w, h);

  const pattern = weaveFor(ctx);
  if (!pattern) return;
  ctx.save();
  // 世界到屏幕的变换，这样 pattern 的单位就是世界坐标。
  ctx.translate(camera.x * camera.zoom, camera.y * camera.zoom);
  ctx.scale(camera.zoom, camera.zoom);
  ctx.fillStyle = pattern;
  ctx.fillRect(-camera.x, -camera.y, w / camera.zoom, h / camera.zoom);
  ctx.restore();
}

/**
 * 吸附网格：每 8 个世界单元一条线，也就是元件落点的格点。
 * 细网格线被刻意去掉了——编织纹已经是纹理，两套网格叠在一起会让画板读成坐标纸而不是画板。
 */
function drawGrid(ctx: CanvasRenderingContext2D, camera: Camera, w: number, h: number): void {
  const step = GRID * 8 * camera.zoom;
  if (step < 8) return;
  const worldLeft = -camera.x;
  const worldTop = -camera.y;
  const worldRight = w / camera.zoom - camera.x;
  const worldBottom = h / camera.zoom - camera.y;

  ctx.strokeStyle = THEME.boardGrid;
  ctx.lineWidth = 1;
  ctx.beginPath();
  const firstX = Math.floor(worldLeft / (GRID * 8)) * GRID * 8;
  for (let x = firstX; x <= worldRight; x += GRID * 8) {
    const sx = Math.round((x + camera.x) * camera.zoom) + 0.5;
    ctx.moveTo(sx, 0);
    ctx.lineTo(sx, h);
  }
  const firstY = Math.floor(worldTop / (GRID * 8)) * GRID * 8;
  for (let y = firstY; y <= worldBottom; y += GRID * 8) {
    const sy = Math.round((y + camera.y) * camera.zoom) + 0.5;
    ctx.moveTo(0, sy);
    ctx.lineTo(w, sy);
  }
  ctx.stroke();
}

/** 屏幕空间里带圆角的折线路径，可以直接填充或描边。 */
function tracePath(ctx: CanvasRenderingContext2D, points: readonly Point[], camera: Camera): void {
  const screen = points.map((p) => worldToScreen(camera, p));
  const radii = cornerRadii(points, CORNER_RADIUS * camera.zoom);
  ctx.beginPath();
  ctx.moveTo(screen[0]!.x, screen[0]!.y);
  for (let i = 1; i < screen.length - 1; i += 1) {
    const next = screen[i + 1]!;
    ctx.arcTo(screen[i]!.x, screen[i]!.y, next.x, next.y, radii[i]!);
  }
  const last = screen[screen.length - 1]!;
  ctx.lineTo(last.x, last.y);
}

/** 某个输出引脚的值；不知道时返回 `undefined`。 */
function outputValue(
  view: BoardView | null | undefined,
  instId: string,
  port: string,
): number | undefined {
  if (!view?.stable) return undefined;
  return view.outputs.get(`${instId}.${port}`);
}

/**
 * 按画板的值配色画一根导线：1 位为 1 时绿色，1 位为 0 时暗红色，
 * 多位总线是蓝色电缆加一条亮芯。
 *
 * 点亮的导线会发光，而光晕是实线下方第二道更宽的描边，不是 Canvas 阴影：
 * `shadowBlur` 会让每条描边都额外跑一遍模糊，而一块画板有数百条描边。
 * 两遍描边各一次绘制、读数效果一样。
 *
 * `value === undefined` 用中性色而不是红色：应用还没仿真出的值，
 * 不能被画成一个理直气壮的 0。
 */
function drawWire(
  ctx: CanvasRenderingContext2D,
  points: readonly Point[],
  width: number,
  value: number | undefined,
  camera: Camera,
): void {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const zoom = camera.zoom;

  if (width > 1) {
    const body = BUS_WIDTH * zoom;
    tracePath(ctx, points, camera);
    ctx.strokeStyle = THEME.bus;
    ctx.globalAlpha = 0.16;
    ctx.lineWidth = body * 2;
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.lineWidth = body;
    ctx.stroke();
    ctx.strokeStyle = THEME.busCore;
    ctx.lineWidth = Math.max(1, body * 0.34);
    ctx.stroke();
    ctx.restore();
    return;
  }

  const body = WIRE_WIDTH * zoom;
  tracePath(ctx, points, camera);
  if (value === 1) {
    ctx.strokeStyle = THEME.on;
    ctx.globalAlpha = 0.18;
    ctx.lineWidth = body * 2.4;
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.lineWidth = body;
    ctx.stroke();
  } else {
    ctx.strokeStyle = value === 0 ? THEME.offWire : THEME.idle;
    ctx.lineWidth = body;
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * 总线的数值写在哪儿：最长那一段的“屏幕”中点；标签放不下时返回 `null`。
 *
 * 单独成一个函数，因为这里相机不是可选的，而过去的 bug 恰恰出在这。
 * 画笔曾经调用 `worldToScreen({ x: 0, y: 0, zoom }, segment.mid)`——一个没有平移的相机——
 * 于是标签被画到离导线 `camera.x * zoom` 像素远的地方：缩放 4 倍时能差出五分之一屏，
 * 而且每点一次缩放按钮就偏得更远，玩家注意到并且报告的正是这个。
 * 数字应该在线上，任何缩放和平移下都是。
 */
export function valueLabelAt(
  points: readonly Point[],
  camera: Camera,
): { text: Point; length: number } | null {
  const segment = longestSegment(points);
  if (!segment) return null;
  return { text: worldToScreen(camera, segment.mid), length: segment.length * camera.zoom };
}

/**
 * 一根总线的数值，写在它最长的那一段上。
 *
 * 约束是空间而不是数字：比导线还长的标签读不出来，所以从高位开始丢数字直到放得下——
 * 这就是为什么原作在宽线上会显示 `5`、`25` 而不是 `255`。
 * 标签先用纸面自身的深色描边、再填充，这样压在深色总线体和亮芯上都清楚。
 */
function drawValueLabel(
  ctx: CanvasRenderingContext2D,
  points: readonly Point[],
  value: number,
  camera: Camera,
): void {
  const anchor = valueLabelAt(points, camera);
  if (!anchor) return;
  const { text: at, length } = anchor;
  if (length < 24) return;

  const zoom = camera.zoom;
  const size = Math.max(9, Math.min(15, 13 * zoom));
  ctx.font = `bold ${size}px ui-monospace, "Cascadia Mono", Consolas, monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  let text = String(value);
  while (text.length > 1 && ctx.measureText(text).width > length - 6 * zoom) {
    text = text.slice(1);
  }
  if (ctx.measureText(text).width > length) return;

  ctx.lineWidth = Math.max(2, 3 * zoom);
  ctx.strokeStyle = THEME.board;
  ctx.strokeText(text, at.x, at.y);
  ctx.fillStyle = THEME.text;
  ctx.fillText(text, at.x, at.y);
}

/**
 * 深色描边的白色粗体：在任何本体颜色上都可读。
 *
 * `maxWidth` 会不断缩小字号直到标签放得下。Canvas 会把过长的字符串横向压扁，
 * 而一个被压扁的 `8 位非门` 比小一号的更难读。
 *
 * `family` 默认用界面的等宽字体：元件丝印是芯片顶面的字，关卡连接器里的数字是读数——
 * 两者都是“测量值”，而仪器面板的字体就是界面其余部分用的那套。
 * 需要画散文的调用方传入 `THEME` 的阅读字体。
 */
function outlinedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  size: number,
  zoom: number,
  maxWidth: number,
  fill = THEME.text,
  family = MONO,
): void {
  let px = size;
  ctx.font = `600 ${px}px ${family}`;
  while (px > 8 && ctx.measureText(text).width > maxWidth) {
    px -= 1;
    ctx.font = `600 ${px}px ${family}`;
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = Math.max(1.5, 3 * zoom);
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.45)';
  ctx.strokeText(text, x, y);
  ctx.fillStyle = fill;
  ctx.fillText(text, x, y);
}

/**
 * 引脚的名字，印在元件左上角的角标里。
 *
 * 关卡的箭头和圆告诉你它们运送什么，却不告诉你是“哪一个”引脚；
 * 一个有四个外观相同的输出的关卡（或两个相同输入）会让玩家只能猜。
 * 角标是画板给出的那一半答案；另一半是测试面板标签列里的序号。
 *
 * 名字来自实例 id，而实例 id 正是把元件绑定到关卡的东西（`IN_a`、`OUT`、`OUT_out3`），
 * 所以它就是 `bindLevelIo` 用来匹配的字符串，不会和它漂移。
 */
function levelPinName(inst: Instance): string {
  return pinNameOf(inst.id);
}

/** 关卡连接器角标显示的名字，由绑定它的实例 id 得出。 */
function pinNameOf(id: string): string {
  const name = id.replace(/^IN_/, '').replace(/^OUT_?/, '');
  return name.length > 0 ? name : 'out';
}

/** 元件左上角的引脚名角标：深色半透明底、浅色字，尺寸跟着缩放。 */
function drawNameBadge(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  text: string,
  zoom: number,
): void {
  const size = Math.max(7, 9 * zoom);
  ctx.font = `600 ${size}px ui-monospace, "Cascadia Mono", Consolas, monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const padX = 4 * zoom;
  const boxW = ctx.measureText(text).width + padX * 2;
  const boxH = size + 4 * zoom;
  ctx.fillStyle = THEME.backdrop;
  ctx.globalAlpha = 0.85;
  roundedRect(ctx, x - boxW / 2, y - boxH / 2, boxW, boxH, 3 * zoom);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.fillStyle = THEME.label;
  ctx.fillText(text, x, y + 0.5 * zoom);
}

/**
 * 元件引脚的位宽，印在角标里。
 *
 * 用青色而不是三种数值色：位宽不是数值，若画成绿或红会被读成一个值。
 */
function drawWidthBadge(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  zoom: number,
): void {
  const size = Math.max(7, 9 * zoom);
  ctx.font = `600 ${size}px ui-monospace, "Cascadia Mono", Consolas, monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const text = String(width);
  const padX = 3 * zoom;
  const boxW = ctx.measureText(text).width + padX * 2;
  const boxH = size + 3 * zoom;
  ctx.fillStyle = THEME.accent;
  roundedRect(ctx, x - boxW / 2, y - boxH / 2, boxW, boxH, 2 * zoom);
  ctx.fill();
  ctx.fillStyle = THEME.backdrop;
  ctx.fillText(text, x, y + 0.5 * zoom);
}

function drawWires(
  ctx: CanvasRenderingContext2D,
  graph: Graph,
  camera: Camera,
  registry: Registry,
  view: BoardView | null | undefined,
): void {
  const byId = new Map(graph.instances.map((i) => [i.id, i]));
  // 整块画板共用一份规划，于是每根导线都是对着“已经放好的导线”绕行的，而不是对着空无一物：
  // 见 `routes.ts`。
  const plan = planRoutes(graph, registry);
  for (const wire of graph.wires) {
    const from = byId.get(wire.from.inst);
    const to = byId.get(wire.to.inst);
    if (!from || !to || !registry.has(from.def) || !registry.has(to.def)) continue;
    const fromDef = registry.get(from.def);
    const toDef = registry.get(to.def);
    const outPin = fromDef.outputs.find((p) => p.id === wire.from.port);
    if (!outPin) continue;
    const points =
      plan.get(wire.id) ??
      routeWire(
        pinPosition(from, fromDef, wire.from.port, false),
        pinPosition(to, toDef, wire.to.port, true),
      );
    const width = effectiveWidth(from, outPin);
    const value = outputValue(view, from.id, wire.from.port);
    drawWire(ctx, points, width, value, camera);
    if (width > 1 && value !== undefined && value !== 0) {
      drawValueLabel(ctx, points, value, camera);
    }
  }
}

/**
 * 一个引脚的标记。
 *
 * 形状表达位宽：单位是方块，总线是带环的圆——这是原作自己的划分，
 * 也让宽引脚在一堆细引脚里一眼可辨。
 *
 * 颜色表达数值，用画板的三种颜色：绿是活的 1 位，红是 0，蓝是一个字，
 * slate 灰是没有任何东西驱动的引脚。点亮的引脚还会得到与点亮导线相同的光晕，
 * 于是一个信号从产生它的元件到接收它的引脚，读起来是一整条连续的东西。
 */
function drawPin(
  ctx: CanvasRenderingContext2D,
  pos: Point,
  width: number,
  value: number | undefined,
  armed: boolean,
  zoom: number,
): void {
  const r = Math.max(2, PIN_RADIUS * zoom);
  const wide = width > 1;
  const fill =
    value === undefined
      ? THEME.idle
      : wide
        ? THEME.bus
        : value === 1
          ? THEME.on
          : THEME.off;
  const lit = value === 1 || wide;

  const shape = (radius: number): void => {
    ctx.beginPath();
    if (wide) ctx.arc(pos.x, pos.y, radius, 0, Math.PI * 2);
    else ctx.rect(pos.x - radius, pos.y - radius, radius * 2, radius * 2);
  };

  if (lit) {
    shape(r + 4 * zoom);
    ctx.fillStyle = wide ? THEME.bus : THEME.on;
    ctx.globalAlpha = 0.22;
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  shape(r + 1 * zoom);
  ctx.fillStyle = wide ? THEME.text : THEME.backdrop;
  ctx.fill();

  shape(r - 0.5 * zoom);
  ctx.fillStyle = fill;
  ctx.fill();

  if (armed) {
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, r + 5 * zoom, 0, Math.PI * 2);
    ctx.strokeStyle = THEME.armed;
    ctx.lineWidth = 2 * zoom;
    ctx.stroke();
  }
}

/**
 * 每个输入引脚的值，键为 `${instanceId}.${portId}`。
 *
 * 输入引脚的值就是它驱动源的值——网表按位从 `drive` 收集它，而 `drive` 指向产生它的输出引脚——
 * 所以画板也用同样的办法读取，而不是自己再推导一遍：沿着导线走，查源输出。
 * 没有这一步，每个输入引脚都会显示成“未驱动”的中性色；而原作里导线远端那些点亮的绿色引脚，
 * 正是“电路工作正常”的一半可读性。
 */
function drivenInputs(
  graph: Graph,
  view: BoardView | null | undefined,
): ReadonlyMap<string, number> {
  const driven = new Map<string, number>();
  for (const wire of graph.wires) {
    const value = view?.outputs.get(`${wire.from.inst}.${wire.from.port}`);
    if (value !== undefined) driven.set(`${wire.to.inst}.${wire.to.port}`, value);
  }
  return driven;
}

/**
 * 关卡输入的轮廓：原作的那支箭头——信号到达的一根竖条，以及一个顶点正好落在输出引脚上的三角形，
 * 于是导线从箭头的尖离开，而不是从方块中间离开。
 *
 * 只画一条路径，这正是“路径”而不是“两次填充”的全部意义。过去它是一个圆角条加一个三角形，
 * 先后填充，接缝处留下两处瑕疵：一条极细的缝——两条仅仅相接的抗锯齿边缘永远盖不满中间那个像素；
 * 以及肩部的一个缺口——竖条的右角是圆的，而三角形那条边从角上斜着离开。
 * 现在只把左边做圆、闭合在同一条子路径里，并在这里勾勒：
 * 这样本体也能像其他元件一样，用同一份轮廓去填充、描边、加光晕和做顶部高光。
 *
 * 导出给 `appearance.test.ts`：它会记录本函数发出的调用，因为这里修的缺陷是结构性的
 * （一个形状被画成两条子路径），而结构正是测试能抓住的东西——截图抓不住。
 */
export function traceLevelArrow(
  ctx: CanvasRenderingContext2D,
  p: Point,
  w: number,
  h: number,
  zoom: number,
): void {  const bar = 12 * zoom;
  const inset = 10 * zoom;
  const top = p.y + inset;
  const bottom = p.y + h - inset;
  const base = p.x + bar;
  const radius = Math.max(0, Math.min(4 * zoom, bar / 2, (bottom - top) / 2));
  ctx.beginPath();
  ctx.moveTo(base, top);
  ctx.lineTo(p.x + w, p.y + h / 2);
  ctx.lineTo(base, bottom);
  ctx.lineTo(p.x + radius, bottom);
  ctx.arcTo(p.x, bottom, p.x, bottom - radius, radius);
  ctx.lineTo(p.x, top + radius);
  ctx.arcTo(p.x, top, p.x + radius, top, radius);
  ctx.closePath();
}

/**
 * Ctrl 拖拽时的选择框。
 *
 * 用操作者的颜色填充并描边，与选中元件的描边同色，因为它们是同一个陈述：
 * “这些是我要的”。它和其他东西一样通过相机变换用世界坐标绘制，
 * 所以拖拽中途平移画板时，框仍然粘在它扫过的元件上。
 */
function drawMarquee(ctx: CanvasRenderingContext2D, state: AppState, camera: Camera): void {
  const drag = state.dragging;
  if (drag?.kind !== 'marquee') return;
  const a = worldToScreen(camera, { x: Math.min(drag.x0, drag.x1), y: Math.min(drag.y0, drag.y1) });
  const b = worldToScreen(camera, { x: Math.max(drag.x0, drag.x1), y: Math.max(drag.y0, drag.y1) });
  const w = b.x - a.x;
  const h = b.y - a.y;
  ctx.save();
  ctx.fillStyle = 'rgba(255, 45, 120, 0.14)';
  ctx.fillRect(a.x, a.y, w, h);
  ctx.strokeStyle = THEME.armed;
  ctx.lineWidth = 1.5 * camera.zoom;
  ctx.setLineDash([6 * camera.zoom, 4 * camera.zoom]);
  ctx.strokeRect(a.x, a.y, w, h);
  ctx.restore();
}

/**
 * 正从引脚里拉出来的导线，从那个引脚画到指针。
 *
 * 用虚线、用“手持”色，读起来是一个提议而不是一条连接：
 * 直到在某个输入引脚上松开，电路图里才真正出现这根线。
 */
function drawDragPreview(
  ctx: CanvasRenderingContext2D,
  state: AppState,
  camera: Camera,
): void {
  const drag = state.dragging;
  if (drag?.kind !== 'wire' || !drag.to) return;
  const from = state.graph.instances.find((inst) => inst.id === drag.fromInst);
  if (!from || !state.registry.has(from.def)) return;
  const a = pinPosition(from, state.registry.get(from.def), drag.fromPort, false);
  ctx.save();
  ctx.setLineDash([6 * camera.zoom, 5 * camera.zoom]);
  ctx.lineCap = 'round';
  tracePath(ctx, routeWire(a, drag.to), camera);
  ctx.strokeStyle = THEME.armed;
  ctx.lineWidth = WIRE_WIDTH * camera.zoom * 0.8;
  ctx.stroke();
  ctx.restore();
}

function drawInstance(
  ctx: CanvasRenderingContext2D,
  state: AppState,
  inst: Instance,
  camera: Camera,
  view: BoardView | null | undefined,
  driven: ReadonlyMap<string, number>,
): void {
  const { registry, selected, dragging } = state;
  if (!registry.has(inst.def)) return;
  const def = registry.get(inst.def);
  const rect = instanceRect(inst, def);
  const p = worldToScreen(camera, { x: rect.x, y: rect.y });
  const w = rect.w * camera.zoom;
  const h = rect.h * camera.zoom;
  const isSelected = selected.includes(inst.id);
  // 和手持预览画的是同一种轮廓：按定义判断，绝不按实例 id
  // （否则一个多余的 level_input 会预览成箭头、落下后却是方块）。
  const silhouette = silhouetteOf(def, h, camera.zoom);
  const arrowInput = silhouette.kind === 'level-arrow';
  const gate = gateLookOf(def);
  const { colour, glow } = partAppearance(def, inst, view, driven);

  // 无论这个元件是哪种轮廓，画法都一样：一条路径、点亮时加光晕、填充、描边，
  // 再沿顶部做高光。关卡输入过去是例外——只有两层平面填充——所以它在一排门旁边
  // 看起来像一张贴纸。
  const trace = (): void => {
    traceSilhouette(ctx, silhouette, p, w, h, camera.zoom);
  };

  // 点亮的元件用一道宽而半透明的自身轮廓描边做光晕，
  // 与点亮的导线是同一种两遍画法：全板读数一致。
  if (glow) {
    ctx.save();
    ctx.globalAlpha = 0.28;
    ctx.strokeStyle = glow;
    ctx.lineWidth = 7 * camera.zoom;
    trace();
    ctx.stroke();
    ctx.restore();
  }
  ctx.fillStyle = colour;
  ctx.strokeStyle = isSelected ? THEME.selection : THEME.idleEdge;
  ctx.lineWidth = isSelected ? 3 : 1.5 * camera.zoom;
  trace();
  ctx.fill();
  ctx.stroke();
  // 顶部一道浅色高光：原作的元件受光于上方，正是它让平面填充不至于读成占位符。
  ctx.save();
  trace();
  ctx.clip();
  ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
  ctx.fillRect(p.x, p.y, w, h * 0.45);
  ctx.restore();
  if (!arrowInput) paintMarks(ctx, gate, p.x, p.y, w, h, camera.zoom);

  const outputWidth = def.outputs[0] ? effectiveWidth(inst, def.outputs[0]) : 1;
  const value = def.outputs[0] ? outputValue(view, inst.id, def.outputs[0].id) : undefined;

  // 关卡连接器靠角标“报名字”、身上“带数值”，并不写标签。
  // 它的本体过去印的是实例 id（`IN_b3`、`OUT_out3`），那是把元件绑定到关卡的字符串——
  // 是应用自己的簿记，画在画板上给玩家看，而且和上面的角标重复。
  //
  // 两端都显示数字，输入不是特例：一个说自己装什么的圆盘，和一个什么都不说的箭头，
  // 是同一个连接器被画成了两种样子。输入“装”的是它正在驱动的东西，
  // 这与左侧面板的读法完全一致——`level_input` 也有一个输出引脚，所以它的值就和输出一样读取。
  const bound = def.category === 'level' && /^(IN_|OUT)/.test(inst.id);
  if (bound) {
    if (value !== undefined) {
      outlinedText(
        ctx,
        String(value),
        // 箭头的质量在顶点之后，所以它的数字比圆盘上的更靠左：
        // 若居中，`255` 的最后一位会跑到斜边外面去。
        p.x + w * (arrowInput ? 0.42 : 0.5),
        p.y + h / 2,
        Math.max(12, 20 * camera.zoom),
        camera.zoom,
        w - 10 * camera.zoom,
      );
    }
  } else {
    // 写丝印而不是名字：元件托盘里叫“与非门”的东西，画板上印 `NAND`。
    // 两套词汇表为何分开，见 `markings.ts`。
    const label = partCodeOf(def);
    const size = Math.max(10, Math.min(16, 15 * camera.zoom));
    const centre = LABEL_CENTRE[gate.shape];
    outlinedText(
      ctx,
      label,
      p.x + w * centre,
      p.y + h / 2,
      size,
      camera.zoom,
      // 轮廓不是矩形：三角形能容纳的宽度大约只有方框的一半，而盾形的尖端还要占掉剩下的部分。
      w * (gate.shape === 'triangle' ? 0.46 : gate.shape === 'box' ? 0.84 : 0.66),
      THEME.text,
      MONO,
    );
  }

  if (outputWidth > 1) {
    drawWidthBadge(ctx, p.x + w - 8 * camera.zoom, p.y + 3 * camera.zoom, outputWidth, camera.zoom);
  }
  // 引脚自己的名字，印在位宽角标的对面。只给关卡元件：普通门在本体中间已经有丝印了。
  if (def.category === 'level') {
    const width = 22 * camera.zoom;
    drawNameBadge(
      ctx,
      p.x + (inst.id.startsWith('IN_') ? width : 20 * camera.zoom),
      p.y + 3 * camera.zoom,
      levelPinName(inst),
      camera.zoom,
    );
  }

  const armed =
    dragging?.kind === 'wire' && dragging.fromInst === inst.id ? dragging.fromPort : null;

  for (const pin of def.inputs) {
    drawPin(
      ctx,
      worldToScreen(camera, pinPosition(inst, def, pin.id, true)),
      effectiveWidth(inst, pin),
      driven.get(`${inst.id}.${pin.id}`),
      armed === pin.id,
      camera.zoom,
    );
  }
  for (const pin of def.outputs) {
    drawPin(
      ctx,
      worldToScreen(camera, pinPosition(inst, def, pin.id, false)),
      effectiveWidth(inst, pin),
      outputValue(view, inst.id, pin.id),
      armed === pin.id,
      camera.zoom,
    );
  }
}

/**
 * 元件托盘里手持的元件，以 45% 不透明度跟着指针。
 *
 * 它画在“放下后会是哪里”的位置（`placementAt`，与真正放下用的是同一个函数），
 * 所以预览不是对结果的近似：光标下面看到的就是落点，在网格上、有它将会有的轮廓
 * （两个状态共用一次 `traceSilhouette` 调用，预览和已放置元件不可能对本体意见不一），
 * 有普通元件会带的丝印，也有将会带的位宽与引脚名角标——
 * 那些是“身份”而不是“读数”：一个 8 位元件的预览在放下之前就必须看起来是 8 位。
 *
 * 没有数值、也没有画引脚：这是一个尚不存在的元件，上面任何报告信号的东西都是在无中生有。
 */
function drawGhost(
  ctx: CanvasRenderingContext2D,
  state: AppState,
  camera: Camera,
  at: Point | null,
): void {
  const defId = state.armed;
  if (!defId || !at || !state.registry.has(defId)) return;
  const def = state.registry.get(defId);
  const corner = worldToScreen(camera, placementAt(at, def));
  const w = INSTANCE_WIDTH * camera.zoom;
  const h = instanceHeight(def) * camera.zoom;
  const silhouette = silhouetteOf(def, h, camera.zoom);
  const placement = levelIoPlacement(state.level, state.graph, defId);

  ctx.save();
  ctx.globalAlpha = 0.45;
  traceSilhouette(ctx, silhouette, corner, w, h, camera.zoom);
  ctx.fillStyle = THEME.idleBody;
  ctx.fill();
  ctx.strokeStyle = THEME.armed;
  ctx.lineWidth = Math.max(1, 1.5 * camera.zoom);
  ctx.stroke();
  if (def.category === 'level') {
    // 关卡连接器把数值写在身上、把引脚名写在角上；它还不存在时没有数值可写，
    // 所以手持预览只画形状和它将会得到的名字。
    if (placement !== undefined) {
      drawNameBadge(
        ctx,
        corner.x + (placement.id.startsWith('IN_') ? 22 : 20) * camera.zoom,
        corner.y + 3 * camera.zoom,
        pinNameOf(placement.id),
        camera.zoom,
      );
    }
  } else {
    const look = silhouette.kind === 'body' ? silhouette.look : gateLookOf(def);
    outlinedText(
      ctx,
      partCodeOf(def),
      corner.x + w * LABEL_CENTRE[look.shape],
      corner.y + h / 2,
      Math.max(10, Math.min(16, 15 * camera.zoom)),
      camera.zoom,
      w * (look.shape === 'triangle' ? 0.46 : look.shape === 'box' ? 0.84 : 0.66),
    );
  }
  const width = placement?.width ?? declaredWidthOf(def);
  if (width > 1) {
    drawWidthBadge(ctx, corner.x + w - 8 * camera.zoom, corner.y + 3 * camera.zoom, width, camera.zoom);
  }
  ctx.restore();
}

/**
 * 把整块画板画到画布上。
 *
 * 这是画面唯一的入口：每次调用都先按设备像素比调整后备缓冲，
 * 再依次绘制纸面、网格、导线、拖拽预览、元件、选择框和手持预览。
 * 调用方决定何时重绘（store 变化、时钟边沿、窗口缩放），这里从不自己安排帧。
 *
 * @param canvas 目标画布
 * @param store 应用状态：电路图、注册表、相机、选区、拖拽状态
 * @param camera 本帧使用的相机（由调用方传入，便于测试固定视口）
 * @param view 仿真数值与视图开关；没有仿真时传 null/undefined，画板只画结构
 */
export function renderBoard(
  canvas: HTMLCanvasElement,
  store: Store<AppState>,
  camera: Camera,
  view?: BoardView | null,
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  // 后备缓冲 = CSS 尺寸 × 设备像素比；给 `width`/`height` 赋值会重新分配缓冲并清空它，
  // 所以只在尺寸真的变化时才赋值。
  const dpr = globalThis.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  const bw = Math.max(1, Math.round(w * dpr));
  const bh = Math.max(1, Math.round(h * dpr));
  if (canvas.width !== bw || canvas.height !== bh) {
    canvas.width = bw;
    canvas.height = bh;
  }

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawPaper(ctx, camera, w, h);
  if (view?.grid ?? true) drawGrid(ctx, camera, w, h);

  const state = store.get();
  const { graph, registry } = state;
  const driven = drivenInputs(graph, view);
  // 导线画在元件下面：导线接进元件的地方，元件本体必须保持可读。
  drawWires(ctx, graph, camera, registry, view);
  drawDragPreview(ctx, state, camera);
  for (const inst of graph.instances) drawInstance(ctx, state, inst, camera, view, driven);
  drawMarquee(ctx, state, camera);
  // 手持预览最后画：它是玩家正拿着的东西，画板上不该有东西盖在它上面。
  drawGhost(ctx, state, camera, view?.ghost ?? null);
}
