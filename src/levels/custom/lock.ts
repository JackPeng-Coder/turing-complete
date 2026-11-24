// `lock` 检查器：第 4 章「道破心机 / Code Breaker」的闭环判定。
// 本模块位于 levels 层，依赖 `custom/index.ts` 的注册与校验设施、`checks.ts` 的程序装载与
// LevelIo 抽象，向注册表登记 id `lock`。使用方是内容路径 `content/ch4/index.ts`（副作用 import）。
// 关键不变量：只通过 LevelIo 的五个动作驱动电路；程序由玩家缓冲区装载；预算单位 = 一次交换；
// 失败记录里绝不出现秘密值。

import {
  effectiveBudget,
  invalidOutcome,
  ioIssue,
  registerCustomCheck,
  type CheckerIo,
} from './index';
import {
  describeValue,
  loadProgramImage,
  playerProgramText,
  type LevelIo,
  type PlayerProgram,
} from '../checks';
import type { CheckFailure, CheckOutcome, CustomCheck, LevelSpec } from '../spec';

/**
 * `lock` —— 道破心机 / Code Breaker，第 4 章的第一个闭环检查器。
 *
 * 谜题。画板是玩家自己的 AXIS CPU，检查器扮演"知道密码的机器"：
 * 它读 CPU 在 `try` 上提出的字节，用 1 或 0 在 `match` 上作答，
 * 一直进行到 CPU 提出的正好是关卡选定的秘密值为止。这件事无法用步进表表达：
 * `program` 或 `script` 检查在步边界写输入、再读它产生的输出，
 * 电路眼里的 `match` 只会是一个常数——只猜一次、只评一次——而谜题的全部内容就是"搜索"：
 * 程序必须记住自己试过什么，并一拍一拍地数完 256 个码。
 *
 * 检查器自己驱动节拍的原因。它使用的全部词汇就是 `LevelIo` 的
 * `reset`、`readOutput`、`writeInput`、`settle`、`tick`，从不通过 `io.sim` 去结算或读槽位：
 * 一个绕过 `bindLevelIo` 驱动画板的检查器无法被脚本化的 stub 驱动，而它的测试正是那样的 stub，
 * 它的判定也会依赖内核内部而不是关卡的引脚。装载程序是它唯一用到的内核机械，
 * 而且是通过 `loadProgramImage` 使用——与 `program` 分支装载用的是同一个 helper，
 * 所以解析、目标查找、先 reset 再装载的顺序只存在一处。
 *
 * 程序是玩家的，而且必须真的送达。一个 `custom` 检查跑在自己的 `Simulation` 上，
 * 所以本次运行中不可能有别的东西装载过镜像：检查器自己在第一次读之前
 * 调用 `playerProgramText(player)` 装载；空缓冲区或解析器拒绝会被报成 `missing-program`
 * 或 `invalid`，绝不会当成一块安静读零的画板来评分。画板里没有 `ram_prog` 同样报 `missing-io`。
 *
 * 一个预算单位 = 一次交换：读 `try` 上的字节，在 `match` 上回答它，
 * 结算让回答到达电路，再走一个节拍。读到秘密的那次交换直接通过、不消耗节拍，
 * 所以 `lock` 的单位就是玩家程序的一拍，和 `maze` 的单位是一步完全对应——
 * 一个 `budget` 单位的运行会读 `try` `budget` 次、执行 `budget` 个节拍。
 *
 * 这块画板上"回答"到底意味着什么，是实测过的。检查器在同一次交换里回答它刚读到的字节，
 * 于是 CPU 在每个节拍采样到的是"该节拍的指令执行期间 `try` 所保持的值"的比较结果。
 * 在 AXIS 画板上，程序用 `move|sN|out` 发布 `try`、用 `move|inp|dN` 读 `match`——
 * 两条不同的指令——所以在读指令被译码的那一拍，`out` 已经回落到 0，CPU 采样到的 `match == 0`。
 * 参考搜索仍然通过（本检查器在"读到"秘密的那一拍判通过，而计数程序会发布每一个候选值），
 * 参考程序自己的"找到了"分支则根本不会被走到：在参考画板上实测，
 * 该指令执行时寄存器堆的数据输入在每一次交换里都是 0。
 * 如果某个关卡希望 CPU 真的对 `match` 作出反应，它需要一个带一拍延迟的 codekeeper
 * （用上一拍的字节作回答）——那是另一份契约，本检查器不会自作主张改成那样。
 *
 * 确定性。没有时钟、没有随机数：秘密是关卡数据，读取序列来自电路本身，
 * 同一块画板永远得到同一个评分。它报告的节拍数是自己的最高水位，会进入星级评定，
 * 与 `script` 的节拍数完全一样。
 */

/** 检查没有声明预算时，`lock` 在放弃前运行的最大节拍数。 */
export const DEFAULT_LOCK_BUDGET = 4096;

/**
 * 本检查器驱动的引脚，以及能承载这些取值的最窄位宽：`try` 上是一个字节，
 * `match` 上是一位回答。
 *
 * 最先校验，因为检查器按名字操作画板——见 `ioIssue`。
 * 声明了别的引脚的关卡应当从"关卡数据自己的失败"里听到这件事，
 * 而不是从一次"跑在一块检查器从未接上的画板上的搜索"里听到。
 */
const LOCK_PINS: CheckerIo = {
  inputs: [{ id: 'match', width: 1 }],
  outputs: [{ id: 'try', width: 8 }],
};

/**
 * 程序装不进去时产生的失败：不挂任何引脚键，因为一个引脚也没有被驱动，
 * 并带上装载器自己的句子。
 *
 * `emptyProgram` 是唯一不算"拒绝"的情况：两个读取器都接受它为零字节文本。
 * 它得到的理由与措辞和 `program` 分支给玩家缓冲区的完全一样，
 * 因为对电路来说，"你还没输入程序"和"你只输入了注释"是同一个"什么都没有"。
 */
function programFailure(error: string, reason: NonNullable<CheckFailure['reason']>): CheckOutcome {
  const failure: CheckFailure = {
    check: 'custom',
    inputs: {},
    expected: {},
    actual: {},
    tick: 0,
    reason,
    detail: error,
  };
  return { passed: false, failures: [failure], ticksUsed: 0 };
}

/** 当 `value` 是 `[0, 255]` 内的整数（一个 8 位码的取值范围）时返回真。 */
function isSecret(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 255;
}

/**
 * 对着 `io` 驱动的画板玩一局 Code Breaker。
 *
 * 检查器是"密码保管者"，不是"密码破解者"：它只回答 `try` 上的字节是不是秘密，
 * 真正要逐个码试出来的是电路里的程序。因此它在第一次命中时停下并判通过；
 * 预算用尽时放弃，并给出一条记录，写明它最后看到的字节——这就是一局游戏的两种结局。
 *
 * `spec` 会被读取，而且是为了引脚：某关的 `io` 若没有声明 `match` 与 `try`，这局游戏根本没法开始，
 * 而那是关卡的缺陷，不是玩家的。
 */
export const callLock = (
  io: LevelIo,
  spec: LevelSpec,
  check: CustomCheck,
  player?: PlayerProgram,
): CheckOutcome => {
  const pins = ioIssue(spec, 'lock', LOCK_PINS);
  if (pins !== undefined) return invalidOutcome(pins);

  const params: Record<string, unknown> = isRecord(check.params) ? check.params : {};
  if (!isSecret(params.secret)) {
    return invalidOutcome(
      `lock check declares secret=${describeValue(params.secret)}, which is not a byte (an integer from 0 to 255)`,
    );
  }
  const budget = effectiveBudget(params.budget, DEFAULT_LOCK_BUDGET);
  if (budget === null) {
    return invalidOutcome(
      `lock check declares budget=${describeValue(params.budget)}, which is not a positive integer`,
    );
  }
  const secret = params.secret;

  // 先 RESET，再装载玩家程序。这个 reset 是检查器自己做的——`runChecks` 只为本次检查
  // 编译了电路，却没有结算它；在第一次结算之前读数，报告的是引脚上"还没被求值"的伪造 0。
  // 装载过程自己也会 reset（装载必须发生在 reset 之后，见 `loadProgramImage`），
  // 这是无害的，也不是本检查器所依赖的：真正让第一次读变得诚实的是上面这个 reset。
  //
  // `'player'` 是通道名，而且必须显式写出：文本来自玩家的缓冲区，
  // 所以拒绝信息里必须说清这是"谁的"程序。
  io.reset();
  const image = loadProgramImage(io, playerProgramText(player), 'asm', 'player');
  if (image.errors.length > 0) {
    if (image.emptyProgram) {
      return programFailure(
        "the player's program buffer is empty: there is nothing to load, so no instruction would ever execute",
        'missing-program',
      );
    }
    return programFailure(image.errors[0]!, image.reason);
  }

  let tried = 0;
  for (let tick = 0; tick < budget; tick += 1) {
    // 先读。画板发布的字节就是本次受测的猜测，本次迭代写回去的是画板对它的回答。
    tried = io.readOutput('try');
    const matched = tried === secret;
    io.writeInput('match', matched ? 1 : 0);
    if (matched) {
      // 玩家的机器实际花掉的节拍数，也就是节拍指标与星级评定的来源。
      // 第一次读就命中的情况花费为零，所以"找到秘密的那次读"不计到程序头上。
      return { passed: true, failures: [], ticksUsed: tick };
    }
    // 写入、结算、再走节拍，顺序如此，结算不可省：节拍会从信号表里采样存储元件的输入，
    // 而上面写入的字节要经过关卡引脚与 CPU 寄存器堆之间的组合元件才能到达那里——
    // AXIS 画板上是 `srcData` -> `d1` -> `data` 这条路径。
    // 不结算就走节拍，机器会采样到上一次的回答，那是一个没人搭过的电路、一个无解的谜题。
    io.settle();
    io.tick();
  }

  // 只产生一条失败记录，用关卡自己的引脚作键：最后一次尝试时 `match` 上的回答，
  // 以及画板程序已经跑到的字节。秘密值不在记录里。
  // 失败记录是面板要渲染的东西，而 `truthTable.ts` 会把任何带非空向量的记录画成矩阵列——
  // 所以 `expected` 里放一个字节，就等于在玩家第一次失败时就印出答案，
  // 把这个关卡赖以存在的闭环搜索彻底瓦解。detail 用文字重复程序到达的字节，
  // 因为失败表格渲染数字，而玩家读的是句子。
  const failure: CheckFailure = {
    check: 'custom',
    inputs: { match: 0 },
    expected: {},
    actual: { try: tried },
    tick: budget,
    reason: 'mismatch',
    detail: `the budget of ${budget} tick(s) ran out with the last code tried being ${tried}`,
  };
  return { passed: false, failures: [failure], ticksUsed: budget };
};

/** `params` 是关卡数据：要么是对象，要么什么都没有，绝不能抛 `TypeError`。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 把本检查器登记到 `custom` 检查点名的 id 下。 */
registerCustomCheck('lock', callLock);
