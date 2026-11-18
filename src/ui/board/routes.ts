/**
 * 画板上每一根导线实际怎么走。
 *
 * `routing.ts` 只回答“两个引脚之间最短的正交路径是什么”，当画板上只有一根线时这就够了。
 * 但画板上还有元件和别的导线，它就不够用，而且两种失败都肉眼可见：
 *
 *   * 目标在源左边的导线会走布线器的“向后绕行”——先向右伸到两个引脚之外，再长距离笔直向左——
 *     这段直路会直接穿过挡在中间的元件。玩家看到导线钻进一个门的身体、又从另一侧冒出来，
 *     而且没法判断那是同一根线。
 *   * 相邻两行之间的两根导线都选了中点转弯，结果落在同一条网格线上、相距五像素。
 *     8 像素宽的芯再加光晕，这么近的两根线看起来就是一根粗线；一块画板里的两个网络看起来像一个，
 *     就会读成短路。
 *
 * 所以布线是一个“选择”，本模块负责做这个选择：每根导线生成若干正交候选，
 * 对每个元件和每根已放好的导线评分，最便宜者胜。权重就是全部策略——
 *
 *   * 穿过元件本体的代价高到任何绕路都更便宜；
 *   * 与另一根导线并行且间距小于 `WIRE_CLEARANCE` 的代价次之；
 *   * 长度与拐角是平局决胜项，让导线仍然大致落在玩家会画的位置。
 *
 * 交叉（十字相交）故意不计价。两根导线直角相交仍然是两根线，任何原理图都充满交叉；
 * 为它定价没有收益，而布线器也负担不起把所有交叉都找出来统计的开销（见下面的车道索引）。
 *
 * 一个信号一根线——2026-10-21 的实验。在一块由数百个门搭成的画板上，
 * 被报告的缺陷不是某根线接错，而是一幅画面：长导线穿过门体满板乱走，
 * 同一个引脚引出的扇出干线被散成几十条平行线。两个改动解决了它，都写在下面的权重里：
 *
 *   * 一个网络的一段走线只计一次，而不是每根导线计一次：扇出干线是一条画出来的线，
 *     若按五十条线计价，下一根导线宁可穿过门体也不肯贴着它走
 *     （`LaneIndex` 在加入时就按网络合并）。
 *   * 沿着“同一个网络”的走线走不要钱，也不算它被穿过：同一个引脚出来的两根线是同一个信号。
 *     正是这一点把扇出变成一条干线，而不是一把扇子。
 *
 * 在合成 900 门画板上的实测效果记在阶段记录里（`.superpowers/sdd/2026-10-21-routing/`）：
 * 穿过元件本体的走线从数百根降到零，不同网络互相叠画的导线几乎消失。
 *
 * 命中测试用的就是同一条折线：`view.ts` 调用这里，`render.ts` 也调用这里，
 * 而且备忘缓存以电路图为键，所以你点中的导线就是你看到的那根——即使它已经绕过了一个门。
 *
 * 顺序有意义，不是无关紧要：导线按玩家创建的先后规划，于是已有的导线保住自己的车道，
 * 新导线绕开它。画一根新导线永远不会挪动画板上已有的导线。
 */
import type { Graph } from '../../core/graph';
import type { Registry } from '../../core/registry';
import { GRID } from '../theme';
import { partRects, pinPosition, snap, type Rect } from './geometry';
import { WIRE_STUB, type Point } from './routing';

/**
 * 两条平行导线至少相隔多远，才会被玩家看成“两根线”。
 *
 * 1 位导线芯宽 8 世界像素，外面还有一圈更宽的半透明光晕；
 * 16 是网格的整数倍中，第一个能让两根线的“芯”和“光晕”都不相碰的距离。
 * 比这更近时，两段走线会被评分当作同一根粗线。
 */
export const WIRE_CLEARANCE = 16;

/** 布线器愿意付出什么代价（单位：世界像素），以及分别为什么付。 */
export const ROUTE_COST = {
  /** 多一个拐角，等价于多绕这么远。 */
  bend: 26,
  /**
   * 走线每穿过元件本体一个像素的代价。
   *
   * 400 是刻意定高的：在密集画板上，一条穿门而过的路径最多省下两三百像素，
   * 所以哪怕某个车道很挤，也仍然比在原理图上开个洞便宜。
   */
  part: 400,
  /**
   * 与“另一个网络”的平行走线相距小于 `WIRE_CLEARANCE` 时，每像素的代价。
   *
   * 同一网络的走线免费：同一个引脚出来的线是同一个信号，扇出本来就应该并在一起走——
   * 其中两根叠在一起是正确的画法，不是短路（见 `costOf`）。
   *
   * 从 120 降到 24。旧价格让拥挤车道比穿过元件本体还贵，
   * 于是当画板上每条有用车道都拥挤时，布线器宁可选择“打个洞”。
   * 现在网络按一次计数（`LaneIndex`），价格就可以低到让“贴着它走”成为答案，
   * 同时又不至于让两个网络近到看起来像一根粗线。
   */
  parallel: 24,
  /**
   * 车道候选在元件本体边缘外多远处提供；以及本体先向外膨胀多少，走线才算穿过它。
   *
   * 两个数字都是为光晕定的，不是为线芯：一段走线的芯是 8 像素，外面还有更宽的光晕，
   * 所以离本体四像素的车道看起来仍像贴着它。向外让 12、本体膨胀 8，正好把光晕让开。
   */
  lane: 12,
  body: 8,
} as const;

/**
 * 一个方向最多提供多少条车道参与评分。
 *
 * 取 14：真正重要的车道常常不是最靠近中点的那些。一根导线要绕过挡在走廊里的元件时，
 * 需要的恰恰是紧贴该元件外侧的那条车道，而它可能离中点一百像素。
 * 这个上限太低，布线器就永远看不到绕法，只能选择硬穿——那正是本模块要修的缺陷。
 *
 * 这个上限同时也是布线器的性能旋钮：候选要对附近每个元件评分，
 * 所以开销与本数值成线性，并直接体现为“拖拽元件时大画板手感如何”（见预算测试）。
 * 14 是在被报告的那块画板上的拐点：16 几乎买不到额外收益，10 则会丢掉布线器需要的车道。
 */
const MAX_LANES = 14;

/** 元件距“两引脚连线构成的盒子”超过多远后，就不再影响这条走线。 */
const NEARBY = 128 + WIRE_STUB;

/** 拼接一条候选路径：`a`、若干内部点、`b`，并去掉连续重复的点。 */
function path(a: Point, b: Point, middle: readonly Point[]): Point[] {
  const out: Point[] = [];
  for (const p of [a, ...middle, b]) {
    const last = out[out.length - 1];
    if (last && last.x === p.x && last.y === p.y) continue;
    out.push(p);
  }
  return out;
}

/** 区间 `[lo, hi]` 与 `[rLo, rHi]` 是否重叠（端点顺序不限）。 */
function spans(lo: number, hi: number, rLo: number, rHi: number): boolean {
  return Math.max(lo, hi) >= rLo && Math.min(lo, hi) <= rHi;
}

/**
 * 一个方向上值得尝试的车道，按距中点的远近排序。
 *
 * 既有旧布线器本来就会产生的候选（两个引导段坐标、中点、两个四分点），
 * 也有“每个挡在走廊里的元件”外侧的两条车道。后一组正是让导线能从两个门之间的缝隙穿过去、
 * 而不是硬穿一个门的原因。
 *
 * 先按距中点的远近排序再截断：这样玩家会画的形状能活过截断，古怪形状则不会。
 */
function lanes(values: readonly number[], centre: number): number[] {
  const unique = [...new Set(values.map((v) => snap(v)))];
  unique.sort((a, b) => Math.abs(a - centre) - Math.abs(b - centre) || a - b);
  return unique.slice(0, MAX_LANES);
}

/**
 * 两个引脚之间所有值得评分的正交路线，包含引导段；第一个点是 `from`，最后是 `to`。
 *
 * 分两族，因为哪一族正确取决于中间挡了什么：在竖直车道上转弯的路线（按 `x` 取车道），
 * 以及在水平车道上转弯的路线（按 `y` 取车道）。
 * 普通的 L 形从这两族里免费得到——当车道取在对面引导段自己的坐标上时，两次转弯会合并成一次。
 *
 * 是“轨道”，不是“车道”。在紧凑画板上两个本体之间的缝隙宽度是 2 * `lane`，
 * 恰好等于一个 `WIRE_CLEARANCE`，所以每个元件边缘提供两个相距一个 clearance 的候选：
 * 紧贴本体外侧的车道，以及它旁边的轨道。没有第二条轨道时，
 * 两个自然车道重合的网络就没有合法的并排位置，更便宜的答案就是叠在一起画——读起来像短路。
 *
 * 竖直族还多两种形状，原因相同：它的竖直列过去是源引导段自己的 x，
 * 也就是同一列引脚上每根导线都想要的那一条线。一个变体把干线挪到它旁边
 * （`start.x + WIRE_CLEARANCE`），让上下叠放的两个输入连接器不共用一条竖线；
 * 另一个变体把“下降段”（最后进入目标引脚的那段竖线）向左挪一条轨道
 * （`end.x - WIRE_CLEARANCE`），让到达同一门列的两根导线不共用最后一小段。
 * 每种变体只多花几个像素的长度，别的什么都没有。
 *
 * @param from 输出引脚圆心
 * @param to 输入引脚圆心
 * @param parts 附近元件的矩形，用于在走廊里开出绕行车道
 * @returns 候选折线列表，每条都从 `from` 到 `to`
 */
export function candidateRoutes(from: Point, to: Point, parts: readonly Rect[]): Point[][] {
  const start = { x: from.x + WIRE_STUB, y: from.y };
  const end = { x: to.x - WIRE_STUB, y: to.y };
  const midX = (start.x + end.x) / 2;
  const midY = (start.y + end.y) / 2;
  const lane = ROUTE_COST.lane;
  // 每条缝隙两条轨道，相距一个 WIRE_CLEARANCE：
  // 近轨道上已有别的网络时，候选可以换到远轨道，仍是两条分开的线而非一根更粗的线
  // （`near` 按网络计数而不是按导线计数，所以空间上的分离靠这两条轨道提供）。
  const track = lane + WIRE_CLEARANCE;

  const xs = lanes(
    [
      start.x,
      start.x + WIRE_CLEARANCE,
      end.x,
      end.x - WIRE_CLEARANCE,
      midX,
      (start.x * 3 + end.x) / 4,
      (start.x + end.x * 3) / 4,
      Math.max(start.x, end.x) + WIRE_STUB,
      Math.min(start.x, end.x) - WIRE_STUB,
      ...parts
        .filter((r) => spans(start.y, end.y, r.y, r.y + r.h))
        .flatMap((r) => [r.x - lane, r.x + r.w + lane, r.x - track, r.x + r.w + track]),
    ],
    midX,
  );
  const ys = lanes(
    [
      start.y,
      start.y + WIRE_CLEARANCE,
      start.y - WIRE_CLEARANCE,
      end.y,
      end.y + WIRE_CLEARANCE,
      end.y - WIRE_CLEARANCE,
      midY,
      (start.y * 3 + end.y) / 4,
      (start.y + end.y * 3) / 4,
      Math.max(start.y, end.y) + WIRE_STUB,
      Math.min(start.y, end.y) - WIRE_STUB,
      ...parts
        .filter((r) => spans(start.x, end.x, r.x, r.x + r.w))
        .flatMap((r) => [r.y - lane, r.y + r.h + lane, r.y - track, r.y + r.h + track]),
    ],
    midY,
  );

  return [
    ...xs.map((x) => path(from, to, [start, { x, y: start.y }, { x, y: end.y }, end])),
    // 竖直族的两列也是“轨道”而不是固定线：两个网络的源在同一列引脚上时
    // （一排连接器、一行门），都想要那一列右侧的竖线；若没有旁边的轨道，
    // 第二根导线就会正好叠在第一根上——一条看得见的线承载两个信号。
    // 水平方向的余量不变，只有竖直列移动，所以代价只是长度多两个像素。
    ...ys.flatMap((y) => [
      path(from, to, [start, { x: start.x, y }, { x: end.x, y }, end]),
      path(from, to, [
        start,
        { x: start.x + WIRE_CLEARANCE, y: start.y },
        { x: start.x + WIRE_CLEARANCE, y },
        { x: end.x, y },
        end,
      ]),
      path(from, to, [
        start,
        { x: start.x, y },
        { x: end.x - WIRE_CLEARANCE, y },
        { x: end.x - WIRE_CLEARANCE, y: end.y },
        end,
      ]),
    ]),
  ];
}

/**
 * 一段轴对齐线段有多少落在矩形内部。
 *
 * 先把矩形按 `ROUTE_COST.body` 向外膨胀。导线确实必须碰到它所连接元件的本体——
 * 最后十六像素就是从引导段走到本体边缘上的引脚——为这段收费会让所有候选付同样的钱。
 * 收费要收的是“沿着边缘走”或“带着重叠的光晕硬挤过去”。
 */
function insideRect(a: Point, b: Point, r: Rect): number {
  const inflate = ROUTE_COST.body;
  const x0 = r.x - inflate;
  const x1 = r.x + r.w + inflate;
  const y0 = r.y - inflate;
  const y1 = r.y + r.h + inflate;
  if (a.y === b.y) {
    if (a.y <= y0 || a.y >= y1) return 0;
    return Math.max(0, Math.min(Math.max(a.x, b.x), x1) - Math.max(Math.min(a.x, b.x), x0));
  }
  if (a.x === b.x) {
    if (a.x <= x0 || a.x >= x1) return 0;
    return Math.max(0, Math.min(Math.max(a.y, b.y), y1) - Math.max(Math.min(a.y, b.y), y0));
  }
  return 0;
}

/** 一段已经放好的走线：后续候选要对它评分。 */
interface Placed {
  readonly coord: number;
  readonly lo: number;
  readonly hi: number;
  readonly horizontal: boolean;
  /** 这段走线承载的输出引脚，让扇出的导线可以共用一条干线。 */
  readonly net: string;
}

/**
 * 按所占车道建立索引的已放走线，让评分保持局部。
 *
 * 一段候选线只可能和“垂直坐标相差 `WIRE_CLEARANCE` 以内”的平行走线冲突，
 * 所以按该坐标分桶——每个网格一步一个桶，左右各看三个——就把全画板扫描变成几次查表。
 * 必须局部：后期画板上有数千段走线，而这里每编辑一次、每根导线都要跑一遍。
 *
 * 每个桶里每个网络只有一条记录，加入时合并——不是每根导线一条。
 * 一条扇出干线是数百根同车道、同网络的导线，但画出来只是一条线；
 * 若逐根存储，后面每个候选都要扫完整条干线，把一条车道计价成数百条线的深度，
 * 那正是这个合并要修的缺陷。加入时就合并也让索引保持小，这是评分能负担更多候选车道的原因。
 */
export class LaneIndex {
  private readonly buckets = new Map<string, Map<string, Run>>();

  add(segments: readonly Placed[]): void {
    for (const segment of segments) {
      const key = bucketKey(segment.horizontal, bucketOf(segment.coord));
      let byNet = this.buckets.get(key);
      if (byNet === undefined) {
        byNet = new Map();
        this.buckets.set(key, byNet);
      }
      const merged = byNet.get(segment.net);
      if (merged === undefined) {
        byNet.set(segment.net, { coord: segment.coord, lo: segment.lo, hi: segment.hi });
      } else {
        merged.lo = Math.min(merged.lo, segment.lo);
        merged.hi = Math.max(merged.hi, segment.hi);
      }
    }
  }

  /**
   * 同一车道上、近到足以与这段走线合并的平行走线。
   *
   * 每个网络每个区间只读一次：`costOf` 问的是“这段走线旁边会挨着几条不同的线”，
   * 也就是玩家实际看到的条数。
   */
  near(horizontal: boolean, coord: number, lo: number, hi: number): Placed[] {
    const bucket = bucketOf(coord);
    let byNet: Map<string, Run> | null = null;
    for (let offset = -3; offset <= 3; offset += 1) {
      const runs = this.buckets.get(bucketKey(horizontal, bucket + offset));
      if (runs === undefined) continue;
      for (const [net, run] of runs) {
        if (Math.abs(run.coord - coord) >= WIRE_CLEARANCE) continue;
        if (Math.min(hi, run.hi) - Math.max(lo, run.lo) <= 0) continue;
        if (byNet === null) byNet = new Map();
        const merged = byNet.get(net);
        if (merged === undefined) byNet.set(net, { ...run });
        else {
          merged.lo = Math.min(merged.lo, run.lo);
          merged.hi = Math.max(merged.hi, run.hi);
        }
      }
    }
    if (byNet === null) return [];
    const found: Placed[] = [];
    for (const [net, run] of byNet) {
      found.push({ horizontal, coord: run.coord, lo: run.lo, hi: run.hi, net });
    }
    return found;
  }
}

/** 一个网络在某个桶里合并后的一段走线区间。 */
interface Run {
  coord: number;
  lo: number;
  hi: number;
}

/** 把垂直坐标换算成桶编号（每 8 个世界像素一个桶）。 */
function bucketOf(coord: number): number {
  return Math.round(coord / GRID);
}

/** 桶键：`h`/`v` 区分水平与竖直走线，后接桶编号。 */
function bucketKey(horizontal: boolean, bucket: number): string {
  return `${horizontal ? 'h' : 'v'}${bucket}`;
}

/** 把一条折线拆成可参与评分的水平/竖直线段，并标注它属于哪个网络。 */
function segmentsOf(points: readonly Point[], net: string): Placed[] {
  const out: Placed[] = [];
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1]!;
    const b = points[i]!;
    if (a.x === b.x && a.y === b.y) continue;
    const horizontal = a.y === b.y;
    out.push({
      horizontal,
      coord: horizontal ? a.y : a.x,
      lo: Math.min(horizontal ? a.x : a.y, horizontal ? b.x : b.y),
      hi: Math.max(horizontal ? a.x : a.y, horizontal ? b.x : b.y),
      net,
    });
  }
  return out;
}

/** 真正的拐角数：数方向变化，而不是数顶点（共线的点不算转弯）。 */
function cornersOf(points: readonly Point[]): number {
  let corners = 0;
  for (let i = 1; i < points.length - 1; i += 1) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const c = points[i + 1]!;
    const abHorizontal = a.y === b.y;
    const bcHorizontal = b.y === c.y;
    if (abHorizontal !== bcHorizontal) corners += 1;
  }
  return corners;
}

/** 一条候选的代价：长度、拐角，以及它撞上的一切。 */
function costOf(
  points: readonly Point[],
  parts: readonly Rect[],
  lanes: LaneIndex,
  net: string,
): number {
  let cost = ROUTE_COST.bend * cornersOf(points);
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const horizontal = a.y === b.y;
    const lo = Math.min(horizontal ? a.x : a.y, horizontal ? b.x : b.y);
    const hi = Math.max(horizontal ? a.x : a.y, horizontal ? b.x : b.y);
    const coord = horizontal ? a.y : a.x;
    cost += hi - lo;

    // 先做便宜的排除：一段线只可能碰到它自己包围盒够得着的东西。
    const x0 = Math.min(a.x, b.x);
    const x1 = Math.max(a.x, b.x);
    const y0 = Math.min(a.y, b.y);
    const y1 = Math.max(a.y, b.y);
    for (const r of parts) {
      if (r.x > x1 || r.x + r.w < x0 || r.y > y1 || r.y + r.h < y0) continue;
      cost += ROUTE_COST.part * insideRect(a, b, r);
    }

    for (const p of lanes.near(horizontal, coord, lo, hi)) {
      // 一个信号一根线。扇出导线挨着同网络的走线，画的就是它本来就有的信号——
      // 一条线，画法正确——所以代价为零。那个距离上的其他任何网络，才是“两根粗线”缺陷。
      if (p.net === net) continue;
      cost += ROUTE_COST.parallel * (Math.min(hi, p.hi) - Math.max(lo, p.lo));
    }
  }
  return cost;
}

/** 一根导线所有候选里最便宜的那条。 */
export function chooseRoute(
  from: Point,
  to: Point,
  parts: readonly Rect[],
  lanes: LaneIndex,
  net: string,
): Point[] {
  let best: Point[] | null = null;
  let bestCost = Number.POSITIVE_INFINITY;
  for (const points of candidateRoutes(from, to, parts)) {
    const cost = costOf(points, parts, lanes, net);
    if (cost >= bestCost) continue;
    best = points;
    bestCost = cost;
  }
  // `candidateRoutes` 至少会给出两个引导段坐标，所以候选必然存在；
  // 末尾的兜底是为了类型完整，不是为了应付这种情况。
  return best ?? [from, to];
}

/** 每根导线的折线，按导线 id 索引。 */
export type RoutePlan = ReadonlyMap<string, readonly Point[]>;

/**
 * 一整块画板的布线方案。
 *
 * 以“布线所依赖的一切”的哈希做备忘：每个元件的 id、定义和位置，以及每根导线的两个端点。
 * 因为它既被画笔调用（每次 store 变化都会跑，包括平移的每一帧），也被命中测试调用：
 * 平移不应该让整块画板重新布线。
 */
let cache: { registry: Registry; key: number; plan: RoutePlan } | null = null;

export function planRoutes(graph: Graph, registry: Registry): RoutePlan {
  const key = fingerprint(graph);
  if (cache && cache.registry === registry && cache.key === key) return cache.plan;
  const plan = compute(graph, registry);
  cache = { registry, key, plan };
  return plan;
}

/** 丢弃备忘缓存；给想观察布线器思考过程的测试用。 */
export function forgetRoutes(): void {
  cache = null;
}

/** 真正计算布线方案：按玩家创建顺序逐根规划，并把已放好的走线加入车道索引。 */
function compute(graph: Graph, registry: Registry): RoutePlan {
  const all = partRects(graph, registry);
  const byId = new Map(graph.instances.map((i) => [i.id, i]));
  const lanes = new LaneIndex();
  const plan = new Map<string, readonly Point[]>();

  for (const wire of graph.wires) {
    const from = byId.get(wire.from.inst);
    const to = byId.get(wire.to.inst);
    if (!from || !to) continue;
    if (!registry.has(from.def) || !registry.has(to.def)) continue;
    const fromDef = registry.get(from.def);
    const toDef = registry.get(to.def);
    if (!fromDef.outputs.some((pin) => pin.id === wire.from.port)) continue;
    if (!toDef.inputs.some((pin) => pin.id === wire.to.port)) continue;

    const a = pinPosition(from, fromDef, wire.from.port, false);
    const b = pinPosition(to, toDef, wire.to.port, true);
    const nearby = all.filter(
      (r) =>
        r.x - NEARBY <= Math.max(a.x, b.x) &&
        r.x + r.w + NEARBY >= Math.min(a.x, b.x) &&
        r.y - NEARBY <= Math.max(a.y, b.y) &&
        r.y + r.h + NEARBY >= Math.min(a.y, b.y),
    );
    const points = chooseRoute(a, b, nearby, lanes, netOf(wire));
    plan.set(wire.id, points);
    lanes.add(segmentsOf(points, netOf(wire)));
  }
  return plan;
}

/**
 * 一根导线承载的网络：它来自哪个输出引脚。
 *
 * 同一个引脚出来的两根导线是同一个信号，因此允许、甚至鼓励共用一条干线
 * （见 `ROUTE_COST.parallel` 的说明：同网络免费）。其他任意两根导线都是两个信号，必须分开。
 */
function netOf(wire: Graph['wires'][number]): string {
  return `${wire.from.inst}.${wire.from.port}`;
}

/**
 * 决定布线的全部输入的哈希。
 *
 * 用哈希而不是它代表的那串键：这段代码每次重绘都跑，每帧拼几 KB 文本再扔掉，
 * 是画板不需要的工作。哈希碰撞最多只会把一根导线放进错误的车道。
 */
function fingerprint(graph: Graph): number {
  let hash = 0x811c9dc5;
  const mix = (value: number): void => {
    hash = Math.imul(hash ^ (value | 0), 0x01000193) >>> 0;
  };
  const text = (value: string): void => {
    for (let i = 0; i < value.length; i += 1) mix(value.charCodeAt(i));
    mix(0);
  };
  for (const inst of graph.instances) {
    text(inst.id);
    text(inst.def);
    mix(inst.x);
    mix(inst.y);
  }
  mix(graph.instances.length);
  for (const wire of graph.wires) {
    text(wire.from.inst);
    text(wire.from.port);
    text(wire.to.inst);
    text(wire.to.port);
  }
  mix(graph.wires.length);
  return hash;
}