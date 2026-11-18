import type { BoardPins } from '../levels/sandbox';

/**
 * 点击一个输入连接器后，该引脚应被驱动成什么值；点击的不是输入连接器则为 `null`。
 *
 * 一位引脚是"翻转"；更宽的引脚是"加一并回绕"。这是画板自己的微调手势——读数
 * 面板上的逐位格子才是精确输入一个字节的地方——关卡与沙盒执行的是同一条规则。
 * 两种画板唯一的区别是引脚由什么来命名：关卡的引脚叫 `IN_<pinId>`，而沙盒
 * 连接器的 pin id 就是它的实例 id（见 `sandboxPins`）。
 *
 * 两种拼写只在一个地方处理。从前画板自己解析名字：把实例 id 里的 `IN_` 前缀
 * 切掉，再用剩下的部分去 `level.io` 里查。沙盒没有 `level.io`，于是点击 `IN_1`
 * 什么也找不到、什么也不发生——这和"沙盒根本不提供连接器"是同一个缺陷，只是
 * 高了一层。改成从 `boardPins` 读引脚（其他读取方本来就都走它），点击在两种
 * 画板上都能生效。
 *
 * 点击任何非输入连接器的东西都返回 `null`：点在门上表示选中，这条规则从未变过。
 */
export function nudgedInput(
  pins: BoardPins,
  instanceId: string,
  vector: Readonly<Record<string, number>>,
): { readonly pinId: string; readonly value: number } | null {
  const pin =
    pins.inputs.find((candidate) => candidate.id === instanceId) ??
    pins.inputs.find((candidate) => `IN_${candidate.id}` === instanceId);
  if (pin === undefined) return null;
  const max = pin.width >= 31 ? Number.MAX_SAFE_INTEGER : 2 ** pin.width - 1;
  const current = vector[pin.id] ?? 0;
  return { pinId: pin.id, value: current >= max ? 0 : current + 1 };
}
