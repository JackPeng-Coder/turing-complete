// 自定义检查器的注册表与契约：为"声明式检查表达不了"的关卡提供逃生舱。
// 本模块位于 levels 层，只依赖 `spec` 的类型；检查器模块（custom/lock.ts、custom/maze.ts）在求值时
// 调用 registerCustomCheck 把自己登记进来，而 `levels/checks.ts` 只按 id 查表、不认识具体检查器。
// 关键不变量：注册表由 import 填充，不由这里的清单填充；检查器只能通过 LevelIo 的五个动作操作电路；
// 预算上限防止一次画板编辑被一个巨大预算拖死。

import type { LevelIo, PlayerProgram } from '../checks';
import type { CheckOutcome, CustomCheck, LevelSpec } from '../spec';

/**
 * 关卡专属检查器：有些谜题没有任何声明式检查能表达，这是它们的逃生舱
 * （设计规格 §5.2——迷宫、跳舞机、AI 对战、太空侵略者之类）。
 *
 * 它接收内核公开的关卡接口、关卡自己的 spec、正在运行的 `custom` 检查
 * （它自己的 `params` 就放在这里），以及玩家提交的程序（如果有），
 * 返回一个完整的 `CheckOutcome`，因此节拍数与失败记录都由它自己决定。随之而来有三条契约：
 *
 *  * 只允许用 `io` / `spec` / `check` / `player`，没有别的。不许网络、不许真实时间、不许 DOM：
 *    自定义检查器必须在玩家编辑时、在同一进程内、离线运行。
 *    这四个参数就是检查器允许读取的全部世界，这也是它能够被单独评审的原因。
 *  * 只允许调用 `io.reset` / `io.writeInput` / `io.settle` / `io.readOutput` / `io.tick`。
 *    这五个动作就是关卡的全部词汇：`io.sim` 可以为了它的 `tickCount` 被读到，
 *    内核的 `loadProgramImage` 也会为了网表去读它；但检查器若自己通过它去结算或读槽位，
 *    就是在 `bindLevelIo` 背后驱动画板——同理也是在测试的脚本化 stub 背后。
 *    `io.settle` 之所以出现在接口上而不是藏在 `sim` 里，正是为了让检查器的
 *    "写入 -> 结算 -> 节拍"协议对 stub 与评审者都可见。
 *  * 失败记录必须符合 `CheckFailure` 的形状，并且用关卡自己的引脚 id 作为
 *    `inputs` / `expected` / `actual` 的键，值必须是有限数字，因为失败表格要渲染它们。
 *    不符合的记录——未知引脚 id、`NaN` 或字符串、缺字段——会被当作畸形结果，
 *    整次检查以 `invalid` 失败：玩家会看到原因，而绝不会看到坏掉的面板或无声的 0。
 *
 * `runChecks` 每次检查、在一块属于它自己的 `Simulation` 上调用一次检查器，并采纳返回的结果：
 * `ticksUsed` 用 `Math.max` 并入本次运行的节拍指标；它返回的任何失败记录都会让检查失败，
 * 即使它同时声称 `passed: true`（矛盾时偏安全地失败，绝不偏开放）。
 * 因为节拍数会进入星级评定，所以它也是检查器契约的一部分：它和判定结论一起被评审。
 */

export type CustomChecker = (
  io: LevelIo,
  spec: LevelSpec,
  check: CustomCheck,
  player?: PlayerProgram,
) => CheckOutcome;

/**
 * 实时注册表，以 `CustomCheck` 点名的 id 为键。
 *
 * 由 import 填充，而不是由这里的清单填充：每个检查器模块在首次求值时为自己的 id 调用
 * `registerCustomCheck`，需要读表的代码自行 import 它需要的模块。
 * `levels/checks.ts` 不 import 它们——它只按 id 查表——所以"没有任何模块 import 的检查器"
 * 不会被悄悄加载、也不可能参与评分；使用它的关卡集合负责写下那条 import，
 * "发布哪些检查器"就在那里决定。用 `Map` 而不是冻结的对象字面量，因为注册正是这套机制存在的目的；
 * 关卡数据只能携带 id，够不到这里的任何内容。
 */
const checkers = new Map<string, CustomChecker>();

/**
 * 把一个检查器加入注册表。
 *
 * 会校验参数，因为注册就是代码：这里的笔误应当让它所在的模块立刻失败，
 * 而不是悄悄留下一关将来无法评分。重复注册会替换旧条目而不是抛错：
 * 自己注册自己的模块会被 Vite 的 HMR 在每次编辑时重新求值，
 * 第二次求值抛错会破坏开发服务器，而不是帮我们抓到问题。
 */
export function registerCustomCheck(id: string, checker: CustomChecker): void {
  if (typeof id !== 'string' || id === '') {
    throw new TypeError('registerCustomCheck: id must be a non-empty string');
  }
  if (typeof checker !== 'function') {
    throw new TypeError(`registerCustomCheck(${id}): checker must be a function`);
  }
  checkers.set(id, checker);
}

/** 移除一个检查器；该 id 未注册时返回 false。 */
export function unregisterCustomCheck(id: string): boolean {
  return checkers.delete(id);
}

/** 取回 `id` 名下的检查器；没有则返回 `undefined`——`runChecks` 会因此判失败。 */
export function getCustomCheck(id: string): CustomChecker | undefined {
  return checkers.get(id);
}

/** 全部已注册的 id，按注册顺序。供测试与将来的工具使用。 */
export function customCheckIds(): readonly string[] {
  return [...checkers.keys()];
}

/**
 * 检查器驱动的一个引脚：它的 id，以及能承载检查器所有取值的"最窄"位宽。
 *
 * 位宽是下限而不是关卡声明的值，因为更宽的引脚总是可玩的——
 * 一个字节经过 8 位引脚和经过 32 位引脚的行为完全一样——而更窄的引脚会悄悄改变谜题：
 * 4 位的 `try` 发布不了 42 这个秘密值，于是关卡会因为一个提示里从没提过的原因判所有程序失败。
 */
export interface CheckerPin {
  readonly id: string;
  readonly width: number;
}

/**
 * 一个检查器需要的关卡 io，逐引脚对应。
 *
 * 必须严格一致，双向都算：缺一个引脚，检查器会把它读成常数 0（或写进虚空）；
 * 多一个引脚，说明关卡以为自己在玩的引脚检查器根本不会碰。
 * 两种情况都会让玩家看到"检查器针对一个它从未拿到过的谜题"产生的失败，
 * 所以 `ioIssue` 把责任归到关卡数据上。
 */
export interface CheckerIo {
  readonly inputs: readonly CheckerPin[];
  readonly outputs: readonly CheckerPin[];
}

/** 把一组引脚写成失败 `detail` 里的可读形式。 */
function pinList(pins: readonly CheckerPin[]): string {
  if (pins.length === 0) return 'none';
  return pins.map((pin) => `"${pin.id}" (${pin.width}-bit)`).join(', ');
}

/**
 * 关卡的 `io` 为什么承载不了这个检查器；能承载时返回 `undefined`。
 *
 * 闭环检查器校验的第一件事，早于它自己的 `params`，更早于驱动任何东西。
 * 这类检查器按引脚名操作画板：写 `match`、读 `try`，或写 `sensors`、读 `move`。
 * 如果某关的 `io` 用别的名字命名这些引脚——或多声明了一个检查器从不使用的引脚——
 * 检查器给出的每一句失败（"预算用尽时最后尝试的编号是 0"）都会指向一个从未接好的谜题，
 * 玩家无法把它和"程序写错了"区分开。在这里校验，责任就落回关卡数据，也就是缺陷真正所在。
 *
 * `spec` 是被交给检查器的关卡，`checker` 是它在注册表里的 id，
 * 所以报错句子能同时点出错的引脚和需要它的检查——修数据时必需的两个事实。
 */
export function ioIssue(spec: LevelSpec, checker: string, io: CheckerIo): string | undefined {
  const sides = [
    { side: 'input', declared: spec.io.inputs, needed: io.inputs },
    { side: 'output', declared: spec.io.outputs, needed: io.outputs },
  ] as const;
  for (const { side, declared, needed } of sides) {
    for (const pin of needed) {
      const found = declared.find((candidate) => candidate.id === pin.id);
      if (found === undefined) {
        return `the ${checker} check needs a level ${side} pin named "${pin.id}" and the level declares ${pinList(declared)}`;
      }
      if (found.width < pin.width) {
        return `the ${checker} check needs the level ${side} pin "${pin.id}" to be at least ${pin.width} bits wide and the level declares ${found.width}`;
      }
    }
    for (const pin of declared) {
      if (!needed.some((candidate) => candidate.id === pin.id)) {
        return `the ${checker} check drives the level's pins itself and does not use the ${side} pin "${pin.id}"; it needs exactly ${pinList(needed)}`;
      }
    }
  }
  return undefined;
}

/**
 * 当检查自己的数据无法成为谜题时，用来判失败的 outcome：一条 `invalid` 记录，
 * 不挂任何引脚键，句子里点明哪里不对。
 *
 * 两个闭环检查器共用同一种形状，因为失败记录是面板要渲染、评审者要读的东西：
 * `inputs` / `expected` / `actual` 为空，是因为被拒绝的检查一个引脚也没有驱动，
 * 空映射就是这一事实的诚实陈述——关卡的引脚 id 由 `runChecks` 校验，
 * 所以一条挂了"本检查从未碰过的引脚"的键的记录，是内核抓不到的谎言。
 */
export function invalidOutcome(detail: string): CheckOutcome {
  return {
    passed: false,
    failures: [
      { check: 'custom', inputs: {}, expected: {}, actual: {}, tick: 0, reason: 'invalid', detail },
    ],
    ticksUsed: 0,
  };
}

/**
 * 闭环 `custom` 检查 `budget` 的硬上限，单位是检查器自己的单位。
 *
 * 与 `FUZZ_ROUNDS_CAP` 同一条规则、同一个理由：`grade()` 在每次画板编辑时运行，
 * 而一个预算单位就是电路的一次完整结算（`lock` 每猜错一个码花一个，`maze` 每走一步花一个），
 * 所以一个要 10^9 个单位的关卡绝不能把编辑器卡死。这个数字与两个检查器各自的默认值一致
 * （`DEFAULT_LOCK_BUDGET`、`DEFAULT_MAZE_BUDGET`），因为那些默认值本来就是
 * "一次按键时画板愿意付出的最长运行"：要得更多的检查会被夹到这个上限而不是被拒绝，
 * 与超限的 `rounds` 处理相同——值本身可用，只是负担不起。
 * 不是正整数的预算属于另一回事（关卡缺陷），会被 `invalid` 拒绝，绝不夹取。
 *
 * 它住在这里，是因为本模块拥有自定义检查的契约，也因为 `effectiveBudget`——
 * 这个上限存在的唯一理由——是它唯一的读者。放在原来写的 `checks.ts` 里，
 * 会让本模块反过来从调用它的模块 import 一个值（`checks.ts` 从这里 import `getCustomCheck`），
 * 两个文件围绕一个数字形成运行时循环。`checks.ts` 的 custom 分支仍然会报告检查声明的一切，
 * 但"检查器最多能花多少"应当待在检查器词汇表旁边，紧挨着与它一致的两个默认值。
 */
export const CUSTOM_BUDGET_CAP = 4096;

/**
 * 闭环检查实际运行的预算；声明的值不可用时返回 `null`。
 *
 * 超上限的预算会被夹取而不是拒绝，遵循 `FUZZ_ROUNDS_CAP`：这是"可用但超出
 * `grade()` 在一次编辑中负担得起的工作量"的请求（一个单位就是电路的一次完整结算），
 * 于是检查尽可能多拿一点。不是正整数的预算属于另一回事——关卡缺陷，没有合理解释——
 * 调用方会像对待其他坏字段一样以 `invalid` 拒绝。`fallback` 是检查器自己的默认值，
 * 而默认值正是同一个上限，所以什么都没声明的检查已经处于上限。
 */
export function effectiveBudget(declared: unknown, fallback: number): number | null {
  if (declared === undefined) return fallback;
  if (typeof declared !== 'number' || !Number.isInteger(declared) || declared <= 0) return null;
  return Math.min(declared, CUSTOM_BUDGET_CAP);
}
