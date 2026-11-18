import { scoreOf } from '../levels/grader';
import type { GradeResult, Metrics } from '../levels/grader';
import type { Registry } from '../core/registry';
import type { LevelSpec } from '../levels/spec';
import type { BlueprintLibrary } from '../levels/blueprints';
import { isSandbox, SANDBOX_CONNECTORS } from '../levels/sandbox';

export interface LevelRecord {
  readonly passed: boolean;
  readonly best: Metrics | null;
  readonly stars: 0 | 1 | 3;
}

export interface Progress {
  readonly version: 1;
  readonly levels: Record<string, LevelRecord>;
  /**
   * 玩家写的程序文本，以关卡 id 为键。
   *
   * 和星星一起保存，因为在编程关卡里文本就是作品：画板是预先为玩家搭好再交给
   * 他的（`LevelSpec.board`），所以一次刷新若丢掉程序，就等于丢掉了这一关。
   * 键是关卡 id，并经过与 `levels` 相同的 id 翻译（`persist/storage.ts`），
   * 因此程序不会比它所属的关卡活得更久。
   *
   * 不是每个关卡都有条目：这张表是稀疏的，从未输入过的关卡根本没有键。
   * `AppState.programs` 是读取方看到的视图，缺失的情况用空字符串表示。
   */
  readonly programs: Record<string, string>;
  /**
   * 玩家自造的元件，以元件 id 为键。
   *
   * 与程序一样和星星一起保存，理由也相同：元件是作品，而且它会比搭建它的那个
   * 电路活得更久。这里是"库"——持久的那一半——电路通过 id 引用条目
   * （`Instance.def`），所以两者在"这个元件里是什么"上永远不会互相矛盾。
   *
   * 只有一个家，不是两个。`Graph` 也有 `customComponents` 字段，而它的来源
   * 就在这里：图是文档（画板上有什么），库是记录（玩家造过什么）。电路文件把
   * 需要的条目内联带走（`persist/circuit.ts`），使导出的文件自包含；导入时再
   * 把它们合并回这里。除此之外没有别处复制它们，所以不存在会失步的第二份拷贝。
   */
  readonly blueprints: BlueprintLibrary;
}

/**
 * 无论玩家解锁了什么，都始终可用。
 *
 * 这并不只是关卡的 I/O 管道。第一关提供 `const_on`，而它的参考答案正是
 * `const_on -> level_output`，所以常量必须从第一关起就可用——它们不可能来自
 * 更早的奖励，因为没有更早的关卡。把它们排除在这个集合之外，会让第一关的托盘
 * 里没有任何能驱动输出的东西，而这正是这套推导要防止的"第一关不可玩"缺陷。
 *
 * 这里是唯一的副本：第一章的门控测试 import 它，而不是各自用一张看起来一样的
 * 清单去构造自己的遍历。
 */
export const STARTER_COMPONENTS = [
  'level_input',
  'level_output',
  'const_on',
  'const_off',
] as const;

/**
 * 评分权重：重新导出，而不是再声明一次。
 *
 * `levels/grader.ts` 拥有公式；在这里再写一份会让两处漂移，而一份漂移的副本会
 * 悄悄让每一关的三星目标失效。需要权重的使用方从任一模块 import，拿到的都是
 * 同一个对象。
 */
export { SCORE_WEIGHTS } from '../levels/grader';

export function emptyProgress(): Progress {
  return { version: 1, levels: {}, programs: {}, blueprints: {} };
}

/**
 * 关卡解锁严格线性：第一关永远可达，其余每一关都需要它的前一关已通过。
 * `order` 是权威的关卡顺序（见 `LEVEL_ORDER`）。
 *
 * `dev` 会打开全部关卡（`app/dev.ts`）。它被放在最后的参数位置，而不是另开一个
 * 函数，是为了让调用方无法伸手拿"解锁检查"却悄悄拿到被门控的那个；
 * `paletteDefsFor` 接收同一个标志，只传给一处而不传另一处，就会得到"能打开但
 * 搭不出"的关卡。
 *
 * 边界：`levelId` 不在 `order` 里时抛异常——那是调用方的数据错误（例如传入拼错
 * 的 id），静默返回 false 会让"关卡不存在"伪装成"关卡未解锁"。
 */
export function isUnlocked(
  progress: Progress,
  levelId: string,
  order: readonly string[],
  dev = false,
): boolean {
  const index = order.indexOf(levelId);
  if (index < 0) throw new Error(`unknown level: ${levelId}`);
  if (dev) return true;
  if (index === 0) return true;
  const previous = order[index - 1]!;
  return progress.levels[previous]?.passed === true;
}

/**
 * 第一个可达且尚未通过的关卡；全部通过时返回最后一关。
 *
 * 刻意不是"最后一个已解锁的关卡"：那样只要玩家重开旧关卡就会跳着走——通过第
 * 3 关会解锁第 4 关，但第 5 关及以后仍然锁着，而"最后解锁"是第 4 关；从那里
 * 继续，在玩家按顺序游玩时恰好跳过第 4 关，在玩家乱序通过时则什么也跳不过。
 *
 * `order` 为空时抛异常：没有关卡序列时"从哪里继续"没有答案，返回空字符串只
 * 会让问题在更远处爆发。
 */
export function resumePointOf(progress: Progress, order: readonly string[]): string {
  if (order.length === 0) throw new Error('empty level order');
  for (const id of order) {
    if (isUnlocked(progress, id, order) && progress.levels[id]?.passed !== true) return id;
  }
  return order[order.length - 1]!;
}

/**
 * 已解锁的元件集合是推导出来的，而不是存下来的：每个已通过关卡的奖励，加上
 * 初始元件。如果把集合也存进存档，导入旧存档后两者会漂移，症状就是"关卡要求
 * 与非门，但进度里没有与非门"。
 */
export function unlockedComponents(
  progress: Progress,
  levels: readonly LevelSpec[],
): Set<string> {
  const unlocked = new Set<string>(STARTER_COMPONENTS);
  for (const level of levels) {
    if (progress.levels[level.id]?.passed !== true) continue;
    for (const component of level.rewards?.components ?? []) unlocked.add(component);
  }
  return unlocked;
}

/**
 * 本关提供、且玩家确实已解锁的元件。
 *
 * 关卡自己的托盘是上界：本关不提供的奖励不会进入这个列表，于是玩家只能搭出
 * 关卡允许的东西。
 *
 * 关卡自己的奖励在通过之前就可以拿来搭建。一个关卡发下去的元件，正是它谜题所
 * 围绕设计的元件；把奖励扣到玩家解完题之后才给是本末倒置。第 13 关是命名这条
 * 规则的案例：它的奇偶校验谜题在没有它奖励的 `splitter` 时根本搭不出来——第一
 * 章所有元件的引脚都是 1 位，而从 4 位输入引出的导线只复制第 0 位——所以一份
 * 漏掉它的首次托盘，无法搭出它就是其托盘的那一关。
 *
 * 与 `allowedComponents` 的不对称是有意的、也是承重的。关卡自己的奖励提供给
 * "搭建"，但托盘仍被这一关自己的清单限定，于是关卡不提供的元件即使已经解锁
 * 也不会进来：第 12 关奖励 `mem1` 却不列出它，它的托盘因此没有变化。另一
 * 半——一个关卡不能提供"到它为止（含它）没有任何关卡发过"的元件——这里根本
 * 不强制，也强制不了：那属于关卡数据的性质，由
 * `test/levels/level-buildability.test.ts` 遍历全部已发布关卡来检查。
 *
 * 对第一章而言这是空操作，且是验证过而不是假设的：没有第一章关卡列出自己的
 * 奖励，且第一章所有参考答案只使用更早关卡发放过的元件。
 * `test/app/progress.test.ts` 用一个合成关卡陈述这条规则，而可构建性遍历的
 * "chapter 1 palettes are unchanged" 区块把这一论断的两半都钉在已发布数据上。
 *
 * `dev` 跳过交集里"已解锁"的那一半，保留另一半：关卡自己的清单仍是上界，因为
 * 开发者模式是"打开所有闸门"，不是"发放这一关从未围绕其设计的元件"。同一个
 * 标志也打开关卡本身——见 `isUnlocked`。
 */
export function paletteDefsFor(
  progress: Progress,
  levels: readonly LevelSpec[],
  level: LevelSpec,
  dev = false,
): string[] {
  if (dev) return [...level.allowedComponents];
  const unlocked = new Set([
    ...unlockedComponents(progress, levels),
    ...(level.rewards?.components ?? []),
  ]);
  return level.allowedComponents.filter((def) => unlocked.has(def));
}

/**
 * 沙盒提供的全部元件，按注册表顺序排列。
 *
 * 沙盒不是关卡，所以它的托盘不是关卡的托盘：没有 `allowedComponents` 可以求
 * 交集，因为没有谜题要围绕设计。它改为提供：
 *
 *  * 所有基础元件——注册表自己的定义，去掉 `hidden` 的管道件，于是托盘不可能
 *    与真正存在的元件发生漂移；游戏里新增一个元件，这里不需要第二张清单就会
 *    提供它。宽元件也包含在内：它们是普通的注册表定义，"16 位"是第五阶段关于
 *    位宽的问题，不是"沙盒能否用 `add8`"的问题。
 *  * 再加上两个连接器。它们是"去掉 hidden 管道件"的唯一例外，因为沙盒没有关卡
 *    规格来声明引脚：玩家放置的 `level_input` / `level_output` 就是沙盒画板的
 *    引脚（`sandboxPins`），没有它们就无法驱动沙盒电路、也读不到它的输出。而
 *    关卡只有在自己的 `allowedComponents` 列出它们时才会得到它们。
 *  * 再加上战役已经发给玩家的一切；对基础元件来说这本来就已成立，所以并集实际
 *    只会"增加"玩家自己的元件——它们作为 `extra` 传入，因为元件是数据
 *    （`Progress.blueprints`），而不是注册表条目。
 *
 * `dev` 在这里不额外放宽（基础集合本来就已经完整），但仍然接受该参数，好让两个
 * 托盘的参数一致：调用方若把标志传给 `paletteDefsFor` 而忘了这里，两个本该平行
 * 的界面就会产生一个静默的差异。
 */
export function sandboxPaletteDefs(
  registry: Registry,
  extra: readonly string[] = [],
): string[] {
  const connectors = new Set<string>(SANDBOX_CONNECTORS);
  const offered = registry
    .all()
    .filter(
      (def) =>
        (def.hidden !== true && def.category !== 'level') || connectors.has(def.id),
    )
    .map((def) => def.id);
  const seen = new Set(offered);
  for (const id of extra) {
    if (seen.has(id)) continue;
    seen.add(id);
    offered.push(id);
  }
  return offered;
}

/**
 * 一块画板提供哪些元件，无论是哪种画板。
 *
 * 一条规则，三处调用。元件托盘绘制这份清单，助手的 `list_parts` 报告它，
 * `place_part` 拒绝清单之外的一切。两份"提供什么"的副本，正是托盘和助手漂移
 * 的方式——所以三处都调用这里，改这里就是到处都改。
 *
 * 开发者模式只放宽"解锁"过滤，不增加元件。关卡的 `allowedComponents` 就是那个
 * 谜题，`?dev=1` 只是不再隐藏"清单里列出、但战役还没发下去"的元件（即
 * `paletteDefsFor` 的 `dev` 参数）。关卡自己的连接器就在那张清单上，所以一个
 * 四位关卡在 `?dev=1` 下仍然提供 `level_input`/`level_output`；而第 1 关不会
 * 提供 8 位加法器，对玩家和对助手都不会。沙盒是例外，因为它不是谜题：没有清单
 * 可以求交集，所以它提供全部基础元件（见 `sandboxPaletteDefs`）。
 */
export function offeredDefsFor(
  progress: Progress,
  levels: readonly LevelSpec[],
  level: LevelSpec,
  dev: boolean,
  registry: Registry,
  extra: readonly string[] = [],
): string[] {
  if (isSandbox(level)) return sandboxPaletteDefs(registry, extra);
  return paletteDefsFor(progress, levels, level, dev);
}

/**
 * 记录一次通过：保留最好成绩与最高星级。纯函数。
 *
 * `grade()` 会给任何合法图电路打分，包括没能通过检查的电路，所以未通过的尝试
 * 在写入任何东西之前就被拒绝了。比较用的是判定器自己的 `scoreOf`，而不是本地
 * 另算一遍：一条公式，一处修改的地方。
 *
 * `programs` 会原样带过去，且是同一个引用。本函数返回一个只含它所知字段的新
 * 记录，于是它忘记的字段会被删除而不是留下陈旧值——而"关卡通过的那一刻"恰恰
 * 是最不能丢玩家程序的时刻，因为证明程序能跑的那一次运行，正是会抹掉它的那
 * 一次。这里不编辑程序，所以共享映射而不是复制。
 *
 * 两个比较方向都容易看反：`scoreOf` 是成本，越小越好，所以只有新成绩的分数
 * 小于旧的最好成绩时才替换；星级取两者较大值，避免重玩时发挥失常把已经拿到的
 * 星降下去。
 */
export function applyGrade(
  progress: Progress,
  level: LevelSpec,
  result: GradeResult,
): Progress {
  if (!result.passed) return progress;

  const previous = progress.levels[level.id];
  const best = previous?.best ?? null;
  const improved = best === null || result.score < scoreOf(best);

  return {
    version: 1,
    levels: {
      ...progress.levels,
      [level.id]: {
        passed: true,
        best: improved ? { ...result.metrics } : best,
        stars: Math.max(previous?.stars ?? 0, result.stars) as 0 | 1 | 3,
      },
    },
    programs: progress.programs,
    blueprints: progress.blueprints,
  };
}
