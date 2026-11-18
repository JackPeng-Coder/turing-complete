/**
 * 导线布线：一根导线在画板上到底怎么走。
 *
 * 原作把每根导线都画成带圆角的直角折线，而不是两个引脚之间的一条曲线。
 * 这是几何决策，不是绘制决策——同一条折线要同时回答三个问题，所以在这里算一次、三处共用：
 *
 *   * `render.ts` 描边的那条线；
 *   * `view.ts` 命中测试的那条线：点击导线时点中的是玩家看得见的折线，而不是它下面的直线弦；
 *   * 数值标签可以待在哪里，即最长的那一段。
 *
 * 纯几何模块：没有 Canvas、没有 store、没有 DOM，因此不需要浏览器就能测试。
 * `Point` 是从 `app/viewport.ts` 以“仅类型”方式导入的，运行时没有成本：
 * 相机和拖拽终点属于应用状态，所以共享的值类型声明在 `app/`，由这里向下读取。
 */
import type { Point } from '../../app/viewport';

export type { Point };

/**
 * 导线离开引脚后先直行多远，才允许第一次转弯。
 *
 * 导线总是从输出引脚向右离开、从输入引脚左侧进入，因此导线永远不会斜着穿过引脚边缘。
 * 这个长度同时也是“反向布线”所需的余量：不得不绕到自己起点后方的导线，
 * 要等直行这么远之后才转弯，而不是贴着引脚就折返。
 */
export const WIRE_STUB = 16;

/** 拐角处的圆角半径；每个角实际用多少由 `cornerRadii` 按两侧线段长度夹紧。 */
export const CORNER_RADIUS = 8;

/**
 * 从输出引脚到输入引脚的折线，第一个点在前。
 *
 * 两种形状，都是正交折线：
 *
 *   * 正向（`to` 在 `from` 右边至少两个 `WIRE_STUB`）：在水平中点处转一次弯，是经典的 Z 形。
 *     用中点是为了让同一对列之间的两根导线走同一段中线，而不是各自散开。
 *   * 反向或空间不足：先向右绕到两个引脚的右侧，再从左侧进入 `to`，
 *     这样进入方向仍然是水平的。否则反馈线只能从右侧“倒着”插进引脚，看起来像线接到了引脚背面。
 *
 * 两端在同一行时就是一条直线：没有角要圆，也没有中点要造。
 *
 * @param from 输出引脚的圆心（世界坐标）
 * @param to 输入引脚的圆心
 * @returns 折线顶点序列，从 `from` 到 `to`
 */
export function routeWire(from: Point, to: Point): Point[] {
  if (from.y === to.y) return [from, to];
  const forwards = to.x - from.x >= WIRE_STUB * 2;
  const turnX = forwards
    ? from.x + (to.x - from.x) / 2
    : Math.max(from.x, to.x) + WIRE_STUB;
  return [from, { x: turnX, y: from.y }, { x: turnX, y: to.y }, to];
}

/**
 * 每个内部转角实际使用的圆角半径。
 *
 * `ctx.arcTo` 本身不做夹紧：半径一旦大于喂给它的线段长度，就会画出鼓包而不是圆角。
 * 两根导线挨得很近时经常触发这种情况，所以每个角取“两条相邻线段中较短者的一半”，
 * 再以 `max` 封顶。首尾点没有角，半径恒为 0。
 *
 * @param points 折线顶点
 * @param max 单个圆角的半径上限
 * @returns 与 `points` 等长的半径数组，端点项为 0
 */
export function cornerRadii(points: readonly Point[], max = CORNER_RADIUS): number[] {
  const radii = points.map(() => 0);
  for (let i = 1; i < points.length - 1; i += 1) {
    const before = segmentLength(points[i - 1]!, points[i]!);
    const after = segmentLength(points[i]!, points[i + 1]!);
    radii[i] = Math.max(0, Math.min(max, before / 2, after / 2));
  }
  return radii;
}

/** 两点间的直线距离。 */
function segmentLength(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** 折线的总长度：逐段累加欧氏距离。 */
export function pathLength(points: readonly Point[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) total += segmentLength(points[i - 1]!, points[i]!);
  return total;
}

/** 折线中的一段：两个端点、长度，以及中点（数值标签的落点）。 */
export interface Segment {
  readonly a: Point;
  readonly b: Point;
  readonly length: number;
  /** 线段中点：数值标签写在这里。 */
  readonly mid: Point;
}

/**
 * 折线中最长的一段；整条线没有长度时返回 `null`。
 *
 * 数值标签必须写在一根导线上，而有空间容纳标签的只有最长的那段；
 * 如果导线是引脚到引脚的一条直线，这一段就是整根导线，正是玩家会去读的那种情况。
 */
export function longestSegment(points: readonly Point[]): Segment | null {
  let best: Segment | null = null;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const length = segmentLength(a, b);
    if (best && length <= best.length) continue;
    best = { a, b, length, mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
  }
  return best;
}

/**
 * 点 `p` 到线段 `a`-`b` 的最短距离。
 *
 * 先把 `p` 投影到线段所在直线上：投影参数 t 夹紧到 [0,1]，
 * 即垂足落在线段外时退回最近的端点；再算 `p` 到投影点的距离。
 * 线段退化成一点（`lengthSq === 0`）时直接算两点距离。
 */
export function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** 点 `p` 到整条折线的最短距离：逐段取最小值；空折线返回正无穷。 */
export function distanceToPath(p: Point, points: readonly Point[]): number {
  let best = Number.POSITIVE_INFINITY;
  for (let i = 1; i < points.length; i += 1) {
    best = Math.min(best, distanceToSegment(p, points[i - 1]!, points[i]!));
  }
  return best;
}
