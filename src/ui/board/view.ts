/**
 * 画板的视口变换：相机平移量（世界单位，缩放为 1 时即屏幕像素）与缩放倍率。
 *
 * 本模块负责画板视口和命中测试。命中测试与导线布线共用的几何——元件矩形、引脚布局、
 * 网格吸附——定义在 `geometry.ts`，在这里重新导出，保证画板的公开几何仍然只从一处获得。
 * 这里所有函数都是参数的纯函数：不碰 DOM、不碰 store，因此视口与命中测试
 * 可以脱离浏览器直接做单元测试。
 */
import type { Registry } from '../../core/registry';
import type { Graph } from '../../core/graph';
import type { Camera } from '../../app/viewport';
import { PIN_RADIUS } from '../theme';
import { distanceToPath, type Point } from './routing';
import { instanceRect, pinPosition, placementAt, snap } from './geometry';
import { planRoutes } from './routes';

// 相机与点类型声明在 `app/viewport.ts`，因为持有它们的是应用状态；
// `instanceRect` / `pinPosition` / `snap` / `placementAt` 定义在 `geometry.ts`。
// 这些全部在这里重新导出，调用方只需认识一个模块就能拿到画板的公开几何。
export type { Point, Camera };
export { instanceRect, pinPosition, placementAt, snap };

/**
 * 世界坐标 → 屏幕坐标。
 *
 * 先加相机平移再乘缩放：`(p + camera) * zoom`。
 * 相机平移量存的是世界单位（不是屏幕像素），所以缩放时不必再除以 zoom。
 */
export function worldToScreen(camera: Camera, p: Point): Point {
  return { x: (p.x + camera.x) * camera.zoom, y: (p.y + camera.y) * camera.zoom };
}

/**
 * 屏幕坐标 → 世界坐标，`worldToScreen` 的逆运算。
 *
 * 先除以缩放、再减去相机平移。滚轮缩放时用它求出光标所指的世界点，
 * 再反向修正平移量，让光标下的世界点保持不动。
 */
export function screenToWorld(camera: Camera, p: Point): Point {
  return { x: p.x / camera.zoom - camera.x, y: p.y / camera.zoom - camera.y };
}

/**
 * 一次命中测试的结果：点到了元件、引脚、导线，或者什么都没点到（null）。
 *
 * 引脚用 `inst` + `port` 定位而不是元件 id，因为同一个引脚还带着方向 `isInput`：
 * 连接只允许“输出 → 输入”，命中结果必须能区分两者。
 */
export type Hit =
  | { kind: 'instance'; id: string }
  | { kind: 'pin'; inst: string; port: string; isInput: boolean }
  | { kind: 'wire'; id: string }
  | null;

/** 两点间直线距离。 */
function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** 点是否落在矩形内（边界算命中）。 */
function pointInRect(p: Point, r: { x: number; y: number; w: number; h: number }): boolean {
  return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
}

/**
 * 世界坐标 `world` 处最“贴身”的东西。
 *
 * 顺序是刻意的：先引脚，再导线，最后元件本体——目标越小优先级越高。
 * 一个点同时落在元件本体和引脚上时，玩家想点的显然是引脚。
 * 本体从后往前遍历：后画的元件盖在先画的上面，重叠时应选中视觉上最上面那个。
 *
 * 引脚容差是 `PIN_RADIUS + 3`：引脚本身才 6 像素半径，加 3 像素是对玩家手抖的宽容。
 *
 * 导线必须按“实际画出来的折线”判断：布线器会为了避让元件而绕路，
 * 若改用最短路径判断，玩家会点中一条并不存在的线，却点不中眼前这条。
 *
 * @param graph 当前电路图
 * @param registry 元件定义注册表
 * @param world 待查询的世界坐标点
 * @returns 命中的对象；空白处返回 null
 */
export function hitTest(graph: Graph, registry: Registry, world: Point): Hit {
  const tolerance = PIN_RADIUS + 3;
  // 先引脚，再导线，最后本体：目标越小优先级越高
  for (const inst of graph.instances) {
    if (!registry.has(inst.def)) continue;
    const def = registry.get(inst.def);
    for (const pin of def.inputs) {
      if (distance(pinPosition(inst, def, pin.id, true), world) <= tolerance) {
        return { kind: 'pin', inst: inst.id, port: pin.id, isInput: true };
      }
    }
    for (const pin of def.outputs) {
      if (distance(pinPosition(inst, def, pin.id, false), world) <= tolerance) {
        return { kind: 'pin', inst: inst.id, port: pin.id, isInput: false };
      }
    }
  }

  // 用与画笔完全相同的规划器取得“真正画出来”的折线：
  // 布线器会让导线绕开挡路的元件；若改按最短路径做命中测试，
  // 玩家就会点中一条并不存在的线，反而点不中眼前这条。
  const plan = planRoutes(graph, registry);
  for (const wire of graph.wires) {
    const points = plan.get(wire.id);
    if (points && distanceToPath(world, points) <= 4) return { kind: 'wire', id: wire.id };
  }

  for (let i = graph.instances.length - 1; i >= 0; i -= 1) {
    const inst = graph.instances[i]!;
    if (!registry.has(inst.def)) continue;
    if (pointInRect(world, instanceRect(inst, registry.get(inst.def)))) {
      return { kind: 'instance', id: inst.id };
    }
  }
  return null;
}
