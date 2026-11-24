/**
 * 检查器：把一条条 `LevelCheck` 施加到电路上，产出失败记录与节拍数。
 *
 * 这是关卡系统的执行端：它先编译电路并绑定关卡引脚（`bindLevelIo`），
 * 再按检查种类驱动电路——真值表逐行、约束逐组枚举、fuzz 用种子化随机
 * 向量、script / program 按节拍序列，custom 交给注册过的关卡专用检查器。
 *
 * 依赖下层 `core/`（编译与仿真）与 `asm/`（汇编、机器码镜像），以及同层
 * `spec.ts` 的类型；被 `grader.ts`、`run.ts`（调试器与 IDE）、`main.ts`
 * 与测试使用。
 *
 * 关键不变量：判定在每次画板编辑时都会跑，所以这里从不把异常抛给调用方
 * ——坏关卡数据、坏程序文本、甚至检查器自身崩溃，都被吸收成失败记录；
 * 同时“什么都不检查”的空洞检查一律算失败，不能让任何电路蒙混过关。
 */

import { assemble, AXIS_ISA, parseImage } from '../asm/index';
import { CircuitValidationError, UnstableCircuitError } from '../core/errors';
import type { Graph } from '../core/graph';
import { Simulation, compile, type Netlist } from '../core/net';
import type { Registry } from '../core/registry';
import { assertWidth, formatPort, maskInto, portValueToNumber } from '../core/signal';
import { getCustomCheck } from './custom/index';
import type { BoardPins } from './sandbox';
import { FAILURE_REASONS } from './spec';
import type {
  CheckFailure,
  CheckOutcome,
  ConstraintRule,
  FailureReason,
  FuzzCheck,
  FuzzSample,
  FuzzVector,
  LevelCheck,
  LevelSpec,
  ProgramStep,
  ScriptStep,
} from './spec';

/**
 * 一张电路与关卡引脚之间的读写接口：检查器、程序运行与调试器都只通过它
 * 驱动电路。
 *
 * 它刻意不直接暴露 `Simulation`，而是把“写入 -> 结算 -> 时钟 -> 读出”
 * 这套协议摆在接口上（见下面的 `settle`）：检查器与调试器必须遵守同一套
 * 时序，否则同一张电路会在两处得到不同的读数。
 */
export interface LevelIo {
  reset(): void;
  writeInput(name: string, value: number): void;
  /**
   * 把电路跑到不动点，于是刚写入的值就是下一个时钟沿会采样的值。
   *
   * 它是关卡词汇表的一部分，不是通往 `io.sim` 的后门。`tick` 采样的是信号
   * 表（`Simulation.tick` 在施加沿之前先读每个存储元件的输入），而
   * `writeInput` 写入的值只有经过一次结算才能到达某个存储元件的输入端
   * ——所以写完就 tick 的调用方，锁存到的是上一次结算留下的值，也就是
   * “上一组”输入向量。在 AXIS 板上这不是边角情况：关卡的输入要经过
   * `srcData` -> `d1` -> `data` 三个组合元件才到寄存器堆，所以不结算的
   * 检查器读到的是一个节拍之前写下的字节。内核自己的两个驱动器都正因此
   * 结算（`driveSteps` 在步骤输入与该步时钟沿之间，`runRow` 在
   * `writeInput` 之后），闭环检查器也必须照做。
   *
   * 它被放在接口上，而不是让调用方去碰 `io.sim`，是为了让“写入 -> 结算
   * -> 时钟”这套协议对一个脚本化的桩可见：测试可以记录这次调用并钉住
   * 次序，而正是这一点让协议不会沦为内核的实现细节。
   */
  settle(): void;
  readOutput(name: string): number;
  tick(): void;
  readonly sim: Simulation;
  /**
   * 若有某个关卡引脚的编译位宽与 `spec.io` 不符，这里是它的描述。
   *
   * 只在该引脚确实“存在”于电路中时才设置：没有任何值能不跨越引脚边界就
   * 写进它或从它读出，所以 `createSim` 把这种电路当作未绑定处理。不存在的
   * 引脚不会在这里报告——半成品画板仍然参与判定，那些引脚照旧读 0。
   */
  readonly mismatch?: string;
}

/**
 * `fuzz` 检查没有写 `rounds` 时跑多少组随机向量。
 *
 * 64 组足以几乎立刻抓住错误的 8 位运算——任何一位模式上有分歧的电路，
 * 大约一半的向量都会暴露——同时让每次画板编辑的开销保持很低。
 */
export const DEFAULT_FUZZ_ROUNDS = 64;

/**
 * `fuzz` 检查 `rounds` 的硬上限。
 *
 * `grade()` 每次画板编辑都会跑，所以一个要求 10^9 轮的关卡不能把编辑器
 * 卡死：轮数在这里夹住；想要穷举覆盖的关卡应改用 `truth-table` /
 * `constraint`。（不是正整数的 `rounds` 不会被夹住，而是直接拒绝；
 * 详见 `fuzzIssue` 处的校验。）
 */
export const FUZZ_ROUNDS_CAP = 4096;

/**
 * `value` 是否能在一个 `width` 位的引脚上表示。
 *
 * 转调内核自己的 `assertWidth` 而不是复制它的边界，于是“关卡层会写什么”
 * 与“信号表接受什么”永远不会漂移：被这里拒绝的每个值，原本都会被它
 * 抛错。
 */
function fitsPort(value: number, width: number): boolean {
  try {
    assertWidth(value, width);
    return true;
  } catch {
    // `assertWidth` 只会抛 RangeError，别的都不抛；放不下的值属于数据
    // 问题，不是 bug。
    return false;
  }
}

/**
 * 把一张编译好的电路绑定到关卡的有名引脚上。
 *
 * 命名约定：id 为 `IN_<pinId>` 的 `level_input` 实例提供对应的关卡输入；
 * id 为 `OUT`（单输出）或 `OUT_<pinId>`（多输出）的 `level_output`
 * 实例镜像对应的关卡输出。
 *
 * 每个基址与位宽都取自“编译后的引脚”（`net.outputWidth` /
 * `net.inputWidth`），即实例设置了 `params.width` 时取它，否则取定义
 * 声明的位宽。只看定义永远不够：`level_input` 与 `level_output` 声明的
 * 都是一位引脚，关卡的 8 位引脚之所以存在于表里，完全是因为承载它的
 * 实例这么说了。
 *
 * 引脚存在、但编译位宽与 `spec.io` 不同的，会在 `mismatch` 里报告并且
 * 不绑定。按 spec 位宽写它会越过相邻的槽位，按编译位宽写它又会悄悄丢掉
 * 高位；两者都不是关卡要的值，所以检查只能大声失败（`runChecks` 把它
 * 映射成 `missing-io`）。实例缺席的引脚不算 mismatch：它保持 Phase-0 的
 * 行为，读 0、吞掉写入，于是只搭了一半的画板仍然能参与判定。
 */
export function bindLevelIo(sim: Simulation, net: Netlist, spec: LevelSpec): LevelIo {
  const inputSlots = new Map<string, { base: number; width: number }>();
  const outputSlots = new Map<string, { base: number; width: number }>();
  const mismatches: string[] = [];

  const noteMismatch = (key: string, compiled: number, declared: number): void => {
    mismatches.push(`${key} is ${compiled}-bit in the circuit but the level declares ${declared}`);
  };

  for (const pin of spec.io.inputs) {
    const key = `IN_${pin.id}.out`;
    try {
      const width = net.outputWidth(key);
      if (width !== pin.width) {
        noteMismatch(key, width, pin.width);
        continue;
      }
      inputSlots.set(pin.id, { base: net.outputBase(key), width });
    } catch {
        /* 这个引脚不在这张电路里：它将按 0 读出 */
    }
  }

  const outputPins = spec.io.outputs;
  for (const pin of outputPins) {
    const keys = outputPins.length === 1 ? ['OUT.in'] : [`OUT_${pin.id}.in`, 'OUT.in'];
    for (const key of keys) {
      try {
        const width = net.inputWidth(key);
        if (width !== pin.width) {
          // 存在但尺寸不对：这是要报告的分歧，而不是换一种命名约定再找。
          noteMismatch(key, width, pin.width);
          break;
        }
        outputSlots.set(pin.id, { base: net.inputBase(key), width });
        break;
      } catch {
        /* 试下一个候选命名 */
      }
    }
  }

  return buildIo(sim, inputSlots, outputSlots, mismatches);
}

/**
 * 把一张沙盒电路绑定到它上面放置的接插件。
 *
 * 沙盒没有 `LevelSpec.io`，没有命名约定可读：引脚 id 就是实例 id
 * （`IN_1`、`OUT_1`……），这正是 `sandboxPins` 报告、也是读数、显示与
 * 智能体共同使用的键。槽位本身与 `bindLevelIo` 一样取自编译后的电路，
 * 包括位宽校验——接插件的编译位宽与画板报告的引脚不符时算 mismatch，
 * 而不是悄悄截断着读。
 */
export function bindSandboxIo(sim: Simulation, net: Netlist, pins: BoardPins): LevelIo {
  const inputSlots = new Map<string, { base: number; width: number }>();
  const outputSlots = new Map<string, { base: number; width: number }>();
  const mismatches: string[] = [];

  for (const pin of pins.inputs) {
    const key = `${pin.id}.out`;
    try {
      const width = net.outputWidth(key);
      if (width !== pin.width) {
        mismatches.push(`${key} is ${width}-bit in the circuit but ${pin.width} on the board`);
        continue;
      }
      inputSlots.set(pin.id, { base: net.outputBase(key), width });
    } catch {
      /* 这个接插件不在编译后的电路里：它按 0 读出 */
    }
  }

  for (const pin of pins.outputs) {
    const key = `${pin.id}.in`;
    try {
      const width = net.inputWidth(key);
      if (width !== pin.width) {
        mismatches.push(`${key} is ${width}-bit in the circuit but ${pin.width} on the board`);
        continue;
      }
      outputSlots.set(pin.id, { base: net.inputBase(key), width });
    } catch {
      /* 这个接插件不在编译后的电路里：它按 0 读出 */
    }
  }

  return buildIo(sim, inputSlots, outputSlots, mismatches);
}

/**
 * 两个绑定函数共同的出口：槽位，加上读/写规则。
 *
 * 一个对象，两种拼法。关卡绑定按 `IN_`/`OUT` 命名约定找槽位，沙盒绑定
 * 按实例 id 找；查找之后的一切——写入时的位宽守卫、读出的掩码、结算与
 * 时钟的转发——必须是同一份代码，因为检查器与画板若在这一点上不一致，
 * 就会对“引脚上到底载着什么”不一致。
 */
function buildIo(
  sim: Simulation,
  inputSlots: ReadonlyMap<string, { base: number; width: number }>,
  outputSlots: ReadonlyMap<string, { base: number; width: number }>,
  mismatches: readonly string[],
): LevelIo {
  const io: LevelIo = {
    sim,
    reset: () => sim.reset(),
    settle: () => {
      // 经过 `io` 转发而不是让调用方去碰 `io.sim`，这样脚本化的桩可以
      // 顶替电路，同时仍能看到这套协议（见 `LevelIo`）。
      sim.settle();
    },
    tick: () => {
      sim.tick();
    },
    writeInput(name: string, value: number): void {
      const slot = inputSlots.get(name);
      if (!slot) return;
      if (!fitsPort(value, slot.width)) {
        // 关卡数据是未定型的输入：某一行可能点名义上放不进该引脚的值
        // （在 1 位引脚上写 `{ a: 2 }` 或 `{ a: 0.5 }`）。确定性地拒绝这次
        // 写入——让引脚停在 `reset()` 建立的 0 默认值，与“电路里没有这个
        // 引脚”完全一样——而不是让 `Simulation.write` 抛 RangeError、从
        // `runChecks` 一路冒出，变成每次画板编辑都炸一次 `grade()`。
        return;
      }
      sim.write(slot.base, slot.width, value);
    },
    readOutput(name: string): number {
      const slot = outputSlots.get(name);
      if (!slot) return 0;
      return portValueToNumber(sim.read(slot.base, slot.width));
    },
  };

  // `exactOptionalPropertyTypes` 不接受把一个显式的 `undefined` 交给
  // 可选属性，所以只有真的有东西要报告时，这个字段才存在。
  return mismatches.length === 0 ? io : { ...io, mismatch: mismatches.join('; ') };
}

function enumerateInputs(spec: LevelSpec): Array<Record<string, number>> {
  const bits = spec.io.inputs.reduce((acc, p) => acc + p.width, 0);
  const combos: Array<Record<string, number>> = [];
  const total = 2 ** bits;
  for (let n = 0; n < total; n += 1) {
    const row: Record<string, number> = {};
    let offset = 0;
    for (const pin of spec.io.inputs) {
      row[pin.id] = maskInto(n >>> offset, pin.width);
      offset += pin.width;
    }
    combos.push(row);
  }
  return combos;
}

/**
 * 通过枚举全部输入组合、把 `expected` 切进各输出引脚，生成纯组合关卡的
 * 完整真值表。
 *
 * `expected` 的位布局必须与 `alwaysOn.io.outputs` 的顺序一致：第一个
 * 输出引脚占最低位，依此类推。
 */
export function generateRows(
  alwaysOn: LevelSpec,
  expected: (inputs: Record<string, number>) => number,
): Array<{ inputs: Record<string, number>; outputs: Record<string, number> }> {
  return enumerateInputs(alwaysOn).map((inputs) => {
    const value = expected(inputs) >>> 0;
    const outputs: Record<string, number> = {};
    let offset = 0;
    for (const pin of alwaysOn.io.outputs) {
      outputs[pin.id] = maskInto(value >>> offset, pin.width);
      offset += pin.width;
    }
    return { inputs, outputs };
  });
}

/** 关卡输出引脚的声明位宽；未知引脚按 1 位处理。 */
function outputWidth(spec: LevelSpec, id: string): number {
  return spec.io.outputs.find((pin) => pin.id === id)?.width ?? 1;
}

/**
 * 一条规则在某个输入向量下的 `rule.output` 期望值。
 *
 * `sum-equals` 对输出引脚位宽取模，因为原始和在那个引脚里放不下。一个
 * 1 位的 `out` 就是半加器的和，若比较原始和，`(1, 1)` 这一行对任何电路
 * （包括正确的异或）都不可能成立。对宽引脚同样取模 `2 ** width`，规则
 * 依然有意义：它比较的是低 `width` 位。
 */
function evaluateRule(
  rule: ConstraintRule,
  inputs: Record<string, number>,
  width: number,
): number {
  if (rule.kind === 'sum-equals') {
    let sum = 0;
    for (const id of rule.inputs) sum += inputs[id] ?? 0;
    return sum % 2 ** width;
  }
  let count = 0;
  for (const id of rule.inputs) count += inputs[id] ?? 0;
  return count >= rule.count ? 1 : 0;
}

// ------------------------------ fuzz：种子化随机向量 ------------------------------

/**
 * `value` 是否是能放进 `width` 位引脚的整数。
 *
 * 与 `writeInput` 共用 `fitsPort`，于是“fuzz 函数可以期望的值”与
 * “信号表接受的值”不会漂移。
 */
function fitsPin(value: unknown, width: number): value is number {
  return typeof value === 'number' && fitsPort(value, width);
}

/**
 * 对一个不可信的值做安全、简短的描述，用于失败的 `detail`。
 *
 * 导出给自定义检查器使用：它们要校验自己的 `params`，并且欠玩家一句与
 * 内核校验 fuzz 向量时同样的话。这里不能直接 `String(value)`，因为对象
 * 自己的 `toString` 与它所描述的值一样不可信，一个会抛错的 `toString`
 * 会逃出检查器，变成“自定义检查抛异常”——一条点名检查器、而真正错在
 * 关卡数据的失败。
 */
export function describeValue(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return `an array of ${value.length}`;
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'function') return 'a function';
  if (typeof value === 'object' || typeof value === 'symbol') {
    // 对象自己的 `toString` 同样不可信：会抛错的那种，不能从“正在描述它”
    // 的失败里逃出去。
    try {
      return String(value);
    } catch {
      return `a ${typeof value}`;
    }
  }
  return String(value);
}

/** 抛出的 `Error` 的 `name: message`；其它东西则按值描述。 */
function describeError(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : describeValue(error);
}

/** 只保留作者给出的向量里的数值项，用于生成数值化的失败记录。 */
function numericOnly(vector: Readonly<Record<string, unknown>>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(vector)) {
    if (typeof value === 'number') out[key] = value;
  }
  return out;
}

/** 作者给出的值放不进引脚时，失败携带的那句话。 */
function unfitDetail(subject: string, id: string, value: unknown, width: number): string {
  return `${subject} "${id}" is ${describeValue(value)}, which does not fit a ${width}-bit pin`;
}

/**
 * 检查自己的确定性 PRNG：xorshift32，种子只来自检查数据。
 *
 * 写在这里而不是用库（本项目没有运行时依赖），也不用 `Math.random`
 * （关卡必须在每次画板编辑时判定得一样，同一个种子必须在每次运行中
 * 产生同一串向量）。xorshift32 只有一个不动点 0，所以全零种子会被重
 * 映射成黄金比例的那个奇数常量：否则 `seed: 0` 的关卡会连续 `rounds`
 * 次驱动同一个向量，而且从不说明。
 */
function createFuzzRandom(seed: number): () => number {
  let state = (seed >>> 0) || 0x9e37_79b9;
  return () => {
    state = (state ^ (state << 13)) >>> 0;
    state = (state ^ (state >>> 17)) >>> 0;
    state = (state ^ (state << 5)) >>> 0;
    return state;
  };
}

/** 一条校验过的输入引脚绑定：输入抽到的样本，输出要驱动的值。 */
interface FuzzInputPin {
  readonly id: string;
  readonly width: number;
  readonly fn: (sample: FuzzSample) => number;
}

/** 一条校验过的输出引脚绑定：输入实际驱动的向量，输出期望值。 */
interface FuzzOutputPin {
  readonly id: string;
  readonly width: number;
  readonly fn: (inputs: FuzzVector) => number;
}

/**
 * 一份可以跑的 fuzz 检查：定下来的轮数，以及绑定到校验过的函数上的
 * 关卡引脚。
 *
 * `inputs` / `outputs` 按关卡的引脚顺序排列（绝不是 `Object.keys` 的
 * 顺序），这正是向量序列可复现的原因。
 */
interface FuzzRun {
  readonly rounds: number;
  readonly inputs: readonly FuzzInputPin[];
  readonly outputs: readonly FuzzOutputPin[];
}

/** 一份 fuzz 检查为什么按现状跑不起来，形状是失败记录需要的样子。 */
interface FuzzIssue {
  readonly reason: 'missing-vectors' | 'invalid';
  readonly expected: Readonly<Record<string, number>>;
  readonly actual: Readonly<Record<string, number>>;
  readonly detail: string;
}

type FuzzPlan = ({ readonly kind: 'plan' } & FuzzRun) | ({ readonly kind: 'issue' } & FuzzIssue);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 结合所属关卡校验一份 fuzz 检查。
 *
 * 先报告“空洞”，这是刻意的：什么都不比较的检查正是这一类存在要防的
 * 缺陷（`rounds: 0`、没有输入引脚、没有期望——`missing-rows` 的教训），
 * 所以哪怕同一份检查同时还有拼写错误，也先按“空洞”命名。此后的一切都是
 * 普通的编写错误，以 `invalid` 返回：某引脚没有函数、给本关没有的引脚
 * 写了函数、种子不是整数。
 */
function planFuzz(check: FuzzCheck, spec: LevelSpec): FuzzPlan {
  const rounds = check.rounds ?? DEFAULT_FUZZ_ROUNDS;
  // 一轮都不跑的检查什么都不比较——`missing-rows` 的教训——所以轮数是
  // 第一个被校验的东西，早于任何引脚绑定。
  if (!Number.isInteger(rounds) || rounds <= 0) {
    return {
      kind: 'issue',
      reason: 'missing-vectors',
      expected: { rounds: 1 },
      actual: { rounds },
      detail: `fuzz check declares rounds=${describeValue(check.rounds)}; it must be a positive integer`,
    };
  }
  if (spec.io.inputs.length === 0) {
    return {
      kind: 'issue',
      reason: 'missing-vectors',
      expected: { inputs: 1 },
      actual: { inputs: 0 },
      detail:
        'fuzz check on a level with no input pins: every round would drive the same empty vector',
    };
  }
  if (spec.io.outputs.length === 0) {
    return {
      kind: 'issue',
      reason: 'missing-vectors',
      expected: { outputs: 1 },
      actual: { outputs: 0 },
      detail: 'fuzz check on a level with no output pins: there is nothing to compare against',
    };
  }

  // 关卡数据无论怎么标注类型都不可信：`inputs` 与 `outputs` 可能缺席，
  // 也可能装着根本不是函数的东西。
  const inputs: Record<string, unknown> = isRecord(check.inputs) ? check.inputs : {};
  const outputs: Record<string, unknown> = isRecord(check.outputs) ? check.outputs : {};
  if (Object.keys(inputs).length === 0) {
    return {
      kind: 'issue',
      reason: 'missing-vectors',
      expected: { inputs: 1 },
      actual: { inputs: 0 },
      detail: 'fuzz check declares no input functions: every round would drive the same vector',
    };
  }
  if (Object.keys(outputs).length === 0) {
    return {
      kind: 'issue',
      reason: 'missing-vectors',
      expected: { outputs: 1 },
      actual: { outputs: 0 },
      detail: 'fuzz check declares no output expectations: every circuit would pass it',
    };
  }
  if (!Number.isInteger(check.seed)) {
    return {
      kind: 'issue',
      reason: 'invalid',
      expected: { seed: 1 },
      actual: { seed: check.seed },
      detail: `fuzz check declares seed=${describeValue(check.seed)}, but it must be an integer`,
    };
  }

  const boundInputs: FuzzInputPin[] = [];
  const boundOutputs: FuzzOutputPin[] = [];
  for (const pin of spec.io.inputs) {
    const fn = inputs[pin.id];
    if (typeof fn !== 'function') {
      return {
        kind: 'issue',
        reason: 'invalid',
        expected: { [pin.id]: 1 },
        actual: { [pin.id]: 0 },
        detail: `fuzz check declares no input function for pin "${pin.id}"`,
      };
    }
    boundInputs.push({ id: pin.id, width: pin.width, fn: fn as FuzzInputPin['fn'] });
  }
  for (const pin of spec.io.outputs) {
    const fn = outputs[pin.id];
    if (typeof fn !== 'function') {
      return {
        kind: 'issue',
        reason: 'invalid',
        expected: { [pin.id]: 1 },
        actual: { [pin.id]: 0 },
        detail: `fuzz check declares no output expectation for pin "${pin.id}"`,
      };
    }
    boundOutputs.push({ id: pin.id, width: pin.width, fn: fn as FuzzOutputPin['fn'] });
  }
  for (const key of Object.keys(inputs)) {
    if (!spec.io.inputs.some((pin) => pin.id === key)) {
      return {
        kind: 'issue',
        reason: 'invalid',
        expected: { [key]: 0 },
        actual: { [key]: 1 },
        detail: `fuzz check declares an input function for "${key}", which is not an input pin`,
      };
    }
  }
  for (const key of Object.keys(outputs)) {
    if (!spec.io.outputs.some((pin) => pin.id === key)) {
      return {
        kind: 'issue',
        reason: 'invalid',
        expected: { [key]: 0 },
        actual: { [key]: 1 },
        detail: `fuzz check declares an output expectation for "${key}", which is not an output pin`,
      };
    }
  }
  return {
    kind: 'plan',
    rounds: Math.min(rounds, FUZZ_ROUNDS_CAP),
    inputs: boundInputs,
    outputs: boundOutputs,
  };
}

/**
 * 一份校验过的 fuzz 检查要驱动的向量，每轮一个。
 *
 * 用生成器，是为了让调用方在第一轮失败时就能停下，不必付完整串序列的
 * 代价——错误的电路通常第 0 轮就对不上，而上限允许几千轮。
 *
 * 每个引脚抽到的值已经落在该引脚位宽内，所以最自然的输入函数
 * （`(sample) => sample.a`）永远产出引脚放得下的值。宽于 32 位的引脚
 * 只能用到随机流的 32 位；本阶段搭建的东西没有宽于八位的。
 */
function* fuzzVectors(seed: number, plan: FuzzRun): Generator<FuzzVector> {
  const random = createFuzzRandom(seed);
  for (let round = 0; round < plan.rounds; round += 1) {
    const sample: Record<string, number> = {};
    for (const pin of plan.inputs) sample[pin.id] = random() % 2 ** pin.width;
    const vector: Record<string, number> = {};
    for (const pin of plan.inputs) vector[pin.id] = pin.fn(sample);
    yield vector;
  }
}

// ------------------------------ custom：按 id 查表的关卡专用检查 ------------------------------

/**
 * 一条被采纳的失败记录为什么不能原样显示，或 `undefined`（表示没问题）。
 *
 * `spec` 让引脚名可以被核对：这三张映射会逐引脚渲染，所以不是本关引脚
 * 的键会在真实数据旁多出一行零，而不是有限数的值会渲染成面板字符串转换
 * 的任意结果。两者都在这里被拒绝，理由与 `fuzz` 拒绝放不进引脚的值相同
 * ——检查器不能悄悄交上来一行错的数据。
 */
function failureIssue(item: unknown, spec: LevelSpec): string | undefined {
  if (!isRecord(item)) return `is ${describeValue(item)}, expected an object`;
  if (typeof item.check !== 'string') {
    return `has check=${describeValue(item.check)}, expected a check kind`;
  }
  const pinIds = new Set<string>();
  for (const pin of spec.io.inputs) pinIds.add(pin.id);
  for (const pin of spec.io.outputs) pinIds.add(pin.id);
  for (const field of ['inputs', 'expected', 'actual'] as const) {
    const map = item[field];
    if (!isRecord(map)) {
      return `has ${field}=${describeValue(map)}, expected an object of pin values`;
    }
    for (const [pin, value] of Object.entries(map)) {
      if (!pinIds.has(pin)) {
        return `has ${field} key "${pin}", which is not a pin of this level`;
      }
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        return `has ${field}."${pin}"=${describeValue(value)}, expected a finite number`;
      }
    }
  }
  if (typeof item.tick !== 'number' || !Number.isFinite(item.tick)) {
    return `has tick=${describeValue(item.tick)}, expected a number`;
  }
  if (item.reason !== undefined && !FAILURE_REASONS.includes(item.reason as FailureReason)) {
    return `has reason=${describeValue(item.reason)}, which is not a known failure reason`;
  }
  return undefined;
}

/**
 * 自定义检查器的返回值为什么不能被采纳，或 `undefined`（表示可以）。
 *
 * 形状在这里校验，而不是选择相信，因为这些记录会直接进入失败面板：
 * 返回 `{ failures: 'none' }` 或裸 `null` 的检查器，必须让这次检查带着
 * 原因失败，而不是在下一次按键时把画板弄挂。每条记录除了自身形状，还要
 * 对着关卡校验——见 `failureIssue`。
 */
function outcomeIssue(outcome: unknown, spec: LevelSpec): string | undefined {
  if (!isRecord(outcome)) {
    return `it returned ${describeValue(outcome)} instead of a CheckOutcome`;
  }
  if (typeof outcome.passed !== 'boolean') {
    return `"passed" is ${describeValue(outcome.passed)}, expected a boolean`;
  }
  if (!Array.isArray(outcome.failures)) {
    return `"failures" is ${describeValue(outcome.failures)}, expected an array`;
  }
  if (!Number.isInteger(outcome.ticksUsed) || (outcome.ticksUsed as number) < 0) {
    return `"ticksUsed" is ${describeValue(outcome.ticksUsed)}, expected a non-negative integer`;
  }
  for (const [index, item] of outcome.failures.entries()) {
    const issue = failureIssue(item, spec);
    if (issue !== undefined) return `failure record ${index} ${issue}`;
  }
  return undefined;
}

/**
 * 正在判定的这一关的玩家程序文本，按 app 里的持有方式。
 *
 * 为什么包一层而不是裸 `string`。它是每个“读取程序”的检查都要经过的
 * 唯一接缝——`runChecks`、关卡自己的 `program` 步骤，以及闭环检查器
 * （`lock`、`maze`）都从这里读文本——于是“玩家的程序”这个形状可以在不
 * 新增参数、不穿透 `grade` 和每个调用方的前提下长大。今天它恰好只有
 * 一个字段：调试器通过 `ProgramRun` 读同一份文本，而断点按此前裁决暂缓，
 * 所以两者都没有加字段。
 */
export interface PlayerProgram {
  readonly text: string;
}

/**
 * 对一张电路运行关卡声明的全部检查。
 *
 * `player` 是玩家的程序文本，只有 `from` 为 `'player'` 的 `program`
 * 检查会读它。现有的每个调用方都不传它，而每个关卡自带的检查仍然读
 * 自己的 `source`，所以第四个参数对已发布的关卡是不可见的。
 */
export function runChecks(
  graph: Graph,
  registry: Registry,
  spec: LevelSpec,
  player?: PlayerProgram,
): CheckOutcome {
  const failures: CheckFailure[] = [];
  let ticksUsed = 0;

  for (const entry of spec.checks) {
    // 元素级守卫，早于任何地方读 `check.kind`：关卡数据到达内核时未定型，
    // 而一个 `null` 条目从前会从 `runChecks` 抛出 `TypeError`——包括紧跟
    // 在下面、位于 `try` 之外、会读 `kind` 的那次 `'error' in created`
    // 推送。
    if (!isRecord(entry) || typeof entry.kind !== 'string') {
      failures.push(unreadableCheckFailure(entry));
      continue;
    }
    const check: LevelCheck = entry;
    // 每个检查只编译一次、只建一个 Simulation，所有行复用。若每行都编译，
    // 单个关卡就会把 validateGraph 重跑、信号表重分配几百次。
    const created = createSim(graph, registry, spec);
    if ('error' in created) {
      failures.push(failure(check, {}, {}, {}, 0, created.error));
      continue;
    }
    const io = created.io;
    // 正在跑的那一轮 fuzz，用于下面 `catch` 在“失败的是内核而不是作者
    // 数据”时仍能点名轮次。其它检查始终为 `null`。
    let activeRound: number | null = null;

    try {
      if (check.kind === 'truth-table') {
        if (!check.rows || check.rows.length === 0) {
          // 没有任何可比较内容的真值表检查，会让任何电路通过。大声拒绝它。
          failures.push(
            failure(
              check,
              {},
              { rows: 1 },
              { rows: 0 },
              0,
              'missing-rows',
            ),
          );
          continue;
        }
        for (const row of check.rows) {
          if (Object.keys(row.outputs).length === 0) {
            // 与空 `rows` 数组同样的隐患，只是低一层：声明了却不产出任何
            // 期望输出的一行什么都不比较，于是正确电路和一堆与非门都能
            // “通过”。
            failures.push(
              failure(check, row.inputs, { outputs: 1 }, { outputs: 0 }, 0, 'missing-rows'),
            );
            continue;
          }
          const attempt = runRow(io, spec, row.inputs, 0);
          ticksUsed = Math.max(ticksUsed, attempt.ticksUsed);
          if (compare(row.outputs, attempt.outputs)) {
            failures.push(failure(check, row.inputs, row.outputs, attempt.outputs, 0, 'mismatch'));
          }
        }
        continue;
      }

      if (check.kind === 'constraint') {
        for (const inputs of enumerateInputs(spec)) {
          const attempt = runRow(io, spec, inputs, 0);
          ticksUsed = Math.max(ticksUsed, attempt.ticksUsed);
          const want = evaluateRule(check.rule, inputs, outputWidth(spec, check.rule.output));
          const got = attempt.outputs[check.rule.output] ?? 0;
          if (want !== got) {
            failures.push(
              failure(check, inputs, { [check.rule.output]: want }, attempt.outputs, 0, 'mismatch'),
            );
          }
        }
        continue;
      }

      if (check.kind === 'fuzz') {
        const plan = planFuzz(check, spec);
        if (plan.kind === 'issue') {
          failures.push(
            failure(check, {}, plan.expected, plan.actual, 0, plan.reason, null, plan.detail),
          );
          continue;
        }

        const vectors = fuzzVectors(check.seed, plan);
        for (let round = 0; ; round += 1) {
          activeRound = round;
          let step: IteratorResult<FuzzVector>;
          try {
            step = vectors.next();
          } catch (e) {
            // 作者代码，不是内核代码：抛错的输入函数是关卡数据的缺陷，
            // 不能让异常逃进画板编辑路径（见下面 `catch` 里关于
            // `RangeError` 的说明）。
            failures.push(
              failure(
                check,
                {},
                {},
                {},
                0,
                'invalid',
                round,
                `fuzz input function threw in round ${round}: ${describeError(e)}`,
              ),
            );
            break;
          }
          if (step.done) break;
          const raw: Readonly<Record<string, unknown>> = step.value;
          const unpinnable = plan.inputs.find((pin) => !fitsPin(raw[pin.id], pin.width));
          if (unpinnable !== undefined) {
            // 硬写进去会被 `writeInput` 拒绝，让引脚停在零，于是电路是在
            // 与一个它从未见过的向量比较。这里改为点明是哪个引脚、哪个
            // 值。
            failures.push(
              failure(
                check,
                numericOnly(raw),
                {},
                {},
                0,
                'invalid',
                round,
                unfitDetail(
                  'the value of fuzz input pin',
                  unpinnable.id,
                  raw[unpinnable.id],
                  unpinnable.width,
                ),
              ),
            );
            break;
          }
          const inputs: FuzzVector = step.value;

          const expected: Record<string, number> = {};
          let badExpectation: { id: string; width: number; value: unknown } | undefined;
          try {
            for (const pin of plan.outputs) {
              const value: unknown = pin.fn(inputs);
              if (!fitsPin(value, pin.width)) {
                badExpectation = { id: pin.id, width: pin.width, value };
                break;
              }
              expected[pin.id] = value;
            }
          } catch (e) {
            failures.push(
              failure(
                check,
                inputs,
                {},
                {},
                0,
                'invalid',
                round,
                `fuzz output function threw in round ${round}: ${describeError(e)}`,
              ),
            );
            break;
          }
          if (badExpectation !== undefined) {
            // 绝不按引脚位宽做掩码：把 8 位引脚上的 `a + b` 掩掉，会把
            // 作者的笔误变成一个悄悄表达别的意思的比较。这里改为报告这个
            // 期望“不可用”，并带上引脚与值。
            failures.push(
              failure(
                check,
                inputs,
                typeof badExpectation.value === 'number'
                  ? { [badExpectation.id]: badExpectation.value }
                  : {},
                {},
                0,
                'invalid',
                round,
                unfitDetail(
                  'the fuzz expectation for pin',
                  badExpectation.id,
                  badExpectation.value,
                  badExpectation.width,
                ),
              ),
            );
            break;
          }

          const attempt = runRow(io, spec, inputs, 0);
          ticksUsed = Math.max(ticksUsed, attempt.ticksUsed);
          if (compare(expected, attempt.outputs)) {
            // 第一轮失败就够了：后续轮次改变不了结论，而错误的电路通常
            // 第 0 轮就对不上，上限却允许几千轮。记录里仍然点名轮次、
            // 向量、期望，以及电路实际驱动的值。
            failures.push(
              failure(
                check,
                inputs,
                expected,
                attempt.outputs,
                0,
                'mismatch',
                round,
                `round ${round} of ${plan.rounds} (seed ${check.seed})`,
              ),
            );
            break;
          }
        }
        continue;
      }

      if (check.kind === 'custom') {
        if (typeof check.id !== 'string' || check.id === '') {
          // 裁决：内核接收 id 并到注册表里查。把函数带在关卡数据里既不可
          // 序列化也不可评审，所以直接拒绝——不调用它。
          const detail =
            typeof check.id === 'function'
              ? 'custom check inlined a function in level data; name a registered id instead'
              : `custom check id=${describeValue(check.id)}: expected a non-empty string`;
          failures.push(failure(check, {}, {}, {}, 0, 'missing-check', null, detail));
          continue;
        }

        const checker = getCustomCheck(check.id);
        if (typeof checker !== 'function') {
          failures.push(
            failure(
              check,
              {},
              { [check.id]: 1 },
              { [check.id]: 0 },
              0,
              'missing-check',
              null,
              `no custom check is registered under id "${check.id}"`,
            ),
          );
          continue;
        }

        let outcome: unknown;
        let issue: string | undefined;
        try {
          // 除了关卡，检查本身也交过去，因为检查器的 `params` 挂在检查上
          // ——这正是“谜题数据（某个秘密字节、迷宫网格）留在关卡文件里、
          // 而不是检查器代码里”的原因——而 `player` 被转发也是同一个
          // 道理：闭环检查器驱动的是玩家写的程序，不是关卡自带的。
          outcome = checker(io, spec, check, player);
          // 放在与调用同一个 `try` 里读取：返回值若在访问 `passed`、
          // `failures` 或 `ticksUsed` 时抛错，那是一个敌意的返回值，不是
          // 内核代码，外层 `catch` 会重抛所有不是内核错误的东西。在这里它
          // 是一条带解释的“格式错误的返回值”，本就该如此。
          issue = outcomeIssue(outcome, spec);
        } catch (e) {
          // 注册过的检查器也是代码，代码会有 bug。每次抛出都在这里被吸收
          // ——`grade()` 每次画板编辑都会跑，Phase 0 就曾有一个
          // `RangeError` 逃出这个循环、每次编辑都炸一次。与外层 `catch`
          // 不同，这里什么都不重抛：检查器崩溃是关卡的失败，不是内核的。
          failures.push(
            failure(
              check,
              {},
              {},
              {},
              io.sim.tickCount,
              e instanceof UnstableCircuitError ? 'unstable' : 'invalid',
              null,
              `custom check "${check.id}" threw ${describeError(e)}`,
            ),
          );
          continue;
        }

        if (issue !== undefined) {
          failures.push(
            failure(
              check,
              {},
              {},
              {},
              io.sim.tickCount,
              'invalid',
              null,
              `custom check "${check.id}" returned a malformed outcome: ${issue}`,
            ),
          );
          continue;
        }

        const result = outcome as CheckOutcome;
        // 检查器自己拥有它的节拍（只有它知道自己把电路驱动了多远）；
        // 这些节拍与其他检查一样，汇入本次运行的 TICK 指标。
        ticksUsed = Math.max(ticksUsed, result.ticksUsed);
        if (!result.passed || result.failures.length > 0) {
          if (result.failures.length > 0) {
            // 原样采纳：这些记录就是检查器自己的报告。用循环而不是展开
            // 运算符，因为检查器可能返回多到超过展开参数上限的记录。
            for (const record of result.failures) failures.push(record);
            if (result.passed) {
              // 自相矛盾时按“失败”处理更安全：记录都保留，另外补一条
              // 记录，说明既然 `passed: true`，为什么仍算失败。
              const count = result.failures.length;
              const detail = `custom check "${check.id}" reported passed=true despite ${count} failure(s)`;
              failures.push(failure(check, {}, {}, {}, io.sim.tickCount, 'invalid', null, detail));
            }
          } else {
            // 声称失败却不给记录，玩家就无据可查，于是本次运行替检查器
            // 写明一句。
            failures.push(
              failure(
                check,
                {},
                {},
                {},
                io.sim.tickCount,
                'invalid',
                null,
                `custom check "${check.id}" reported passed=false without a failure record`,
              ),
            );
          }
        }
        continue;
      }

      if (check.kind === 'script') {
        // script：按节拍顺序走完步骤，沿途驱动输入。
        io.reset();
        ticksUsed = Math.max(ticksUsed, driveSteps(io, spec, check, check.steps, failures));
        continue;
      }

      if (check.kind === 'program') {
        // program：取程序文本——关卡自己的 `source`，检查要求时则取玩家的
        // 缓冲区——编译成镜像，把字节放进电路的程序 RAM，然后用与 `script`
        // 完全相同的驱动器走步骤（`driveSteps`：写入输入并结算、`io.tick`
        // 走拍、`io.readOutput` 读输出、`compare` 比较、`failure` 记录）。
        // 两种检查唯一的差别只在第一步之前发生的事。
        //
        // 和每种检查一样，先判“空洞”：什么都不执行、或执行了却什么都不
        // 比较的检查，会让任何电路通过——`missing-rows` 的教训。
        const steps: readonly ProgramStep[] = Array.isArray(check.steps) ? check.steps : [];
        const asserting = steps.filter(stepAsserts).length;
        if (steps.length === 0) {
          failures.push(
            failure(
              check,
              {},
              { steps: 1 },
              { steps: 0 },
              0,
              'missing-program',
              null,
              'program check declares no steps: nothing would be executed and nothing compared',
            ),
          );
          continue;
        }
        if (asserting === 0) {
          failures.push(
            failure(
              check,
              {},
              { expects: 1 },
              { expects: 0 },
              0,
              'missing-program',
              null,
              `program check has ${steps.length} step(s) and not one declares an expectation: every circuit would pass it`,
            ),
          );
          continue;
        }

        // 文本走哪条通道。`from` 默认 `'level'`，所以在有这个选项之前写的
        // 每条检查都只读自己的 `source`；`'player'` 则改读第四个参数。
        // 通道由 `from` 决定，而不是由“哪份文本恰好在手”决定：判定玩家
        // 程序的关卡绝不能悄悄回退到自带程序，否则空缓冲区会被判成“对着
        // 玩家从未写过的文本通过”。
        //
        // 第三种写法会被拒绝而不是回落到默认值，这是同一条规则再往外推一步。
        // 两个字段都是按相等判断选路，于是拼错（`from: 'players'`）会一路
        // 落进默认分支——而一关若同时带了 `source` 和拼错的 `from`，就会去
        // 判关卡自己的文本，作者却以为在判玩家的程序，这恰恰是上一段要防止
        // 的静默回退。把值和字段名写进失败记录，拼写错误才有迹可循，因为
        // 这次运行的其它地方都不会保留它。
        const source = programOption(check.from, ['level', 'player']);
        if (source.kind === 'invalid') {
          failures.push(
            failure(
              check,
              {},
              {},
              {},
              0,
              'invalid',
              null,
              `program check declares from=${describeValue(source.value)}; it must be "level" or "player"`,
            ),
          );
          continue;
        }
        const reader = programOption(check.format, ['asm', 'bytes']);
        if (reader.kind === 'invalid') {
          failures.push(
            failure(
              check,
              {},
              {},
              {},
              0,
              'invalid',
              null,
              `program check declares format=${describeValue(reader.value)}; it must be "asm" or "bytes"`,
            ),
          );
          continue;
        }

        // 缺省的 `player`，或 `text` 不是字符串的 `player`，都当作空文本，
        // 而不是抛 `TypeError`：`runChecks` 每次画板编辑都会跑，而一关还在
        // 打开的过程中，app 调用它时根本没有缓冲区。`playerProgramText`
        // 就是这条规则，与驱动同一份缓冲区的闭环检查器（`lock`、`maze`）
        // 共用。
        const fromPlayer = source.value === 'player';
        const text = fromPlayer ? playerProgramText(player) : check.source;
        if (typeof text !== 'string') {
          // 关卡数据到达内核时未定型，而汇编器会直接拿到这个值：在这里
          // 拒绝它，能把 `TypeError` 挡在画板编辑路径之外，而不是留给内核
          // 自己的 `catch`。
          failures.push(
            failure(
              check,
              {},
              {},
              {},
              0,
              'invalid',
              null,
              `program check declares source=${describeValue(check.source)}; expected assembly text`,
            ),
          );
          continue;
        }
        if (text.trim() === '') {
          // 没有可运行的东西，无论来自哪条通道、用哪种格式书写——和空表格
          // 是同一个教训。说明里点明是哪份缓冲区，因为对电路而言“关卡没带
          // 程序”与“你还没写程序”是同一种缺陷，对不同的人却是不同的问题。
          failures.push(
            failure(
              check,
              {},
              { bytes: 1 },
              { bytes: 0 },
              0,
              'missing-program',
              null,
              `${fromPlayer ? "the player's program buffer" : 'the program source'} is empty: there is nothing to load, so no instruction would ever execute`,
            ),
          );
          continue;
        }

        // 文本怎么读，以及两个读取器如何报同一种形状：`format` 为
        // `'bytes'` 时是编程章节手写的机器码格式，否则是汇编。两个解析器
        // 都不抛错，所以拒绝在这里是一条失败记录，而不是编辑路径上的异常。
        //
        // 解析、选目标、装载三件事合成一个助手（`loadProgramImage`），而不是
        // 在这里展开成三步，因为自己驱动程序的闭环检查器——第 4 章的密码锁
        // 是第一个——也必须做同样这三件事；而“先复位再装载”这个次序若抄成
        // 第二份，就多了一个会写错次序的地方。它报告的内容与原分支就地拼出来
        // 的那三种句子相同：读取器带行号的拒绝、“没有 `ram_prog`”，以及内核
        // 对“镜像过大”或“netlist 里没有这个 ram id”抛出的 `RangeError`
        // ——后者会被下面的 `catch` 收成 `invalid`。两个读取器都不检查
        // `ram_prog` 的容量，所以 257 字节的程序仍会到达内核，并在那里被
        // 拒绝。
        const image = loadProgramImage(io, text, reader.value, source.value, check.ram);
        if (image.errors.length > 0) {
          // 零字节程序与“读取器拒绝”是两种不同的失败，助手会说明是哪一种。
          // 空文本或只有注释的文本对两个读取器都是合法程序——这里没有解析
          // 错误——但它一条指令都不执行，这与空的 `steps` 数组是同一种隐患：
          // 保留 `missing-program` 原因和 `bytes: 0` 记录（在这个助手存在
          // 之前，正是分支自己写这两样）。读取器的拒绝是 `invalid`，而电路
          // 没有 `ram_prog` 是 `missing-io`；两者都带原来那句话。
          const empty = image.emptyProgram;
          failures.push(
            failure(
              check,
              {},
              empty ? { bytes: 1 } : {},
              empty ? { bytes: 0 } : {},
              0,
              empty ? 'missing-program' : image.reason,
              null,
              image.errors[0]!,
            ),
          );
          continue;
        }

        ticksUsed = Math.max(ticksUsed, driveSteps(io, spec, check, steps, failures));
        continue;
      }

      // `LevelCheck` 声明的每种检查都在上面处理了；这里是给“关卡数据里
      // 写了别的东西”（过期存档、拼写错误、来自更新内核的检查）留的兜底。
      // 它大声失败，而不是顺势往下掉——这正是从前 `fuzz` 或 `custom` 检查
      // 会一路走到 `check.steps`、并在每次画板编辑时从 `runChecks` 抛出
      // `TypeError` 的原因。
      const unknown = check as { readonly kind?: unknown };
      failures.push(
        failure(
          check,
          {},
          {},
          {},
          0,
          'invalid',
          null,
          `unknown check kind ${describeValue(unknown.kind)}; this kernel cannot run it`,
        ),
      );
    } catch (e) {
      if (e instanceof UnstableCircuitError) {
        failures.push(
          failure(
            check,
            {},
            {},
            {},
            io.sim.tickCount,
            'unstable',
            activeRound,
            activeRound === null ? null : `fuzz round ${activeRound} did not settle`,
          ),
        );
      } else if (e instanceof CircuitValidationError || e instanceof RangeError) {
        // `RangeError` 是内核“这个值放不进这个端口”的信号（`assertWidth`），
        // 而关卡数据由人手编写：把它吸收成一次失败的检查，于是任何从检查
        // 内部抛出的东西都逃不出 `runChecks`、进不了画板编辑路径。
        // `'invalid'` 的含义本来就是“按声明无法评估这份电路或规格”。
        failures.push(
          failure(
            check,
            {},
            {},
            {},
            io.sim.tickCount,
            'invalid',
            activeRound,
            activeRound === null ? null : `fuzz round ${activeRound}`,
          ),
        );
      } else {
        throw e;
      }
    }
  }

  return { passed: failures.length === 0, failures, ticksUsed };
}

/**
 * 一步是否至少带了一条期望。
 *
 * `expect: {}` 什么都不比较，所以它不算断言：一个 `program` 检查若每一步
 * 都长这样，就会让任何电路通过，因此它在这里与“根本没有 `expect`”同等
 * 看待。按防御式读取，因为关卡数据到达内核时是未定型的，`null` 步骤不能
 * 让这里抛错。
 */
function stepAsserts(step: unknown): boolean {
  return isRecord(step) && isRecord(step.expect) && Object.keys(step.expect).length > 0;
}

/**
 * `program` 检查两个枚举选项之一：要用的值，或要拒绝的值。
 *
 * 为什么未知值不能当默认值。`from` 与 `format` 各自用来在两个读取器之间
 * 选路，而读取它们的代码是相等判断，于是 `'players'` 或 `'byte'` 会悄悄
 * 选中默认值——即关卡自己的文本、按汇编来读——而带了 `source` 的关卡会
 * 去判那份文本，作者却以为在判玩家的。所以这里改为报告拼写错误，并带上
 * 值与字段名，因为失败记录是它唯一能留下痕迹的地方。
 *
 * 缺省不是未知：省略字段就沿用文档里的默认值，这是所有在选项出现之前写
 * 的关卡所依赖的。关卡数据到达内核时未定型，所以 `null` 也按缺省处理，
 * 而不是报成一个没人可能敲出来的拼写错误。
 */
function programOption<T extends string>(
  value: unknown,
  allowed: readonly T[],
): { readonly kind: 'value'; readonly value: T } | { readonly kind: 'invalid'; readonly value: unknown } {
  if (value === undefined || value === null) {
    return { kind: 'value', value: allowed[0]! };
  }
  if (typeof value === 'string' && allowed.includes(value as T)) {
    return { kind: 'value', value: value as T };
  }
  return { kind: 'invalid', value };
}

/**
 * 正在判定的这一关的玩家程序文本；什么都没输入时为 `''`。
 *
 * 玩家通道：到处都按同一方式读取。`program` 分支在 `from: 'player'` 时
 * 读它，自己驱动程序的 `custom` 检查器也出于同一理由读它：第 4 章的密码
 * 锁与迷宫在开始驱动之前，要把玩家的程序交给 CPU，所以两边必须对“玩家
 * 的程序”含义一致——包括两种“根本不是文本”的情况。缺省的 `player`、或
 * `text` 不是字符串的 `player`，都当作空文本而不是 `TypeError`，因为
 * `runChecks` 每次画板编辑都会跑，而一关还在打开时 app 调用它并没有
 * 缓冲区；同时，判定玩家程序的关卡永远不会回退到自己带的程序，因为
 * 通道由调用方选择，而不是由哪份文本恰好在手决定。
 *
 * 关卡自己的 `source` 刻意不在这里读：那条通道属于 `program` 的 `from`
 * 选项，检查器若拿了它，就会去判玩家从未写过的文本。
 */
export function playerProgramText(player?: PlayerProgram): string {
  return typeof player?.text === 'string' ? player.text : '';
}

/**
 * 一关是否把键盘交给玩家：它判定玩家“写的”程序，或通过闭环检查器驱动
 * 一段玩家程序。
 *
 * 这是汇编编辑器（`ui/ide.ts`）的挂载判断，而它其实是关卡数据的问题、
 * 不是 UI 的问题，所以答案在这里。两种形态都算，理由相同：
 * `from: 'player'` 的 `program` 检查直接读玩家的缓冲区；`custom` 检查
 * ——第 4 章的密码锁与迷宫——拿到同一份缓冲区并驱动 CPU 跑它。
 * `from: 'level'` 的 `program` 检查不算：第 3 章的机器关判定的是关卡
 * 自带的程序，玩家没有东西可输入。
 *
 * 遍历刻意写成防御式的，和 `testCases` 一样：关卡数据到达内核时未定型，
 * `null` 条目或读不到 `kind` 的检查，应当让编辑器保持关闭，而不是在挂载
 * 路径上抛错。
 */
export function levelExpectsProgram(spec: LevelSpec): boolean {
  const checks: readonly LevelCheck[] = Array.isArray(spec.checks) ? spec.checks : [];
  for (const entry of checks) {
    if (!isRecord(entry) || typeof entry.kind !== 'string') continue;
    if (entry.kind === 'custom') return true;
    if (entry.kind === 'program' && entry.from === 'player') return true;
  }
  return false;
}

/**
 * 这一关的玩家程序用哪种读取器：`'asm'`，或编程章节手写机器码格式的
 * `'bytes'`。
 *
 * 与关卡自己的检查所做的选择相同，问一次，好让编辑器与检查器不会把同一
 * 份文本读成两种东西：打孔卡关的程序是字节，若编辑器假定是汇编，它显示
 * 的字节数就会与随后判定的结果不符。第一个 `program from: 'player'`
 * 检查胜出（原则上关卡可以为两份缓冲区声明两种读取器，但 app 只有一份
 * 缓冲区）；通道是 `custom` 检查器、或根本没有玩家通道的关卡，回答
 * `'asm'`——两个闭环检查器读的就是它。
 */
export function playerProgramFormat(spec: LevelSpec): 'asm' | 'bytes' {
  const checks: readonly LevelCheck[] = Array.isArray(spec.checks) ? spec.checks : [];
  for (const entry of checks) {
    if (!isRecord(entry) || entry.kind !== 'program' || entry.from !== 'player') continue;
    const reader = programOption(entry.format, ['asm', 'bytes']);
    if (reader.kind === 'value') return reader.value;
  }
  return 'asm';
}

/**
 * 解析后的程序文本：它表示的字节，或说明它为什么不表示任何字节的句子。
 *
 * 两种读取器、两条通道共用一种形状。汇编与手写字节格式拒绝的东西不同，
 * 但报告方式是同一形状——行号、文本、原因——于是调用方用同一种方式为
 * 任一种记录失败，只有措辞不同。行号来自读取器自己，两个解析器都不抛错：
 * 拒绝是数据，不是异常。
 *
 * `errors` 携带与 `program` 分支转成 `detail` 的同样带行号的句子；
 * `reason` 说明它们属于哪种失败：读取器的拒绝是 `invalid`，而“没有
 * `ram_prog` 实例可装载”是 `missing-io`。`emptyProgram` 标记的是唯一
 * 一种并非拒绝的情况——两个读取器都接受它为零字节文本，调用方把它报成
 * `missing-program`，因为它一条指令都不会执行。
 *
 * 零字节那句话怎么措辞由调用方通过 `channel` 决定。“玩家的程序编译出
 * 零字节”和“关卡源码编译出零字节”对电路是同一种缺陷，对不同的人却是
 * 不同的问题：一个是玩家什么都没输入可运行的东西，另一个是关卡什么都没
 * 提供。这个区分从前由手里有 `from` 的分支来做，现在住在这里，因为
 * 自定义检查器通过同一次解析驱动玩家的缓冲区，也欠玩家同样一句话。
 *
 * `bytes` 只在成功时填充；`errors` 非空时什么都没解析出来。两者一起
 * 返回而不是做成可辨识联合，是因为调用方要一起报告它们：解析出零字节的
 * 镜像是一次 `missing-program` 失败，其记录写着 `bytes: 0`，所以它需要
 * 计数与原因在同一处。
 */
export interface ProgramImage {
  readonly bytes: readonly number[];
  readonly errors: readonly string[];
  /** `errors` 属于哪种失败原因；见接口上方的说明。 */
  readonly reason: 'invalid' | 'missing-io';
  /** 文本是合法的零字节程序（而不是被拒绝）时为 true。 */
  readonly emptyProgram: boolean;
}

/**
 * `text` 在 `format` 下表示的镜像，或失败应当携带的那句话。
 *
 * 是纯函数、不碰电路，因此 IDE 与调试器不必有画板就能显示拒绝和字节数，
 * 而 `loadProgramImage` 可以用与面板相同的读取器解析。这里没有关卡数据：
 * 格式来自检查自己的 `format`，通道只决定零字节程序怎么措辞。
 */
export function programImageOf(
  text: string,
  format: 'asm' | 'bytes',
  channel: 'level' | 'player' = 'level',
): ProgramImage {
  const image = format === 'bytes' ? imageOfBytes(text) : imageOfAssembly(text);
  if ('detail' in image) {
    return { bytes: [], errors: [image.detail], reason: 'invalid', emptyProgram: false };
  }
  if (image.bytes.length === 0) {
    // 空文本或只有注释的文本，对两个读取器都是合法的零字节程序；装载它
    // 一条指令都不会执行，这与空的 `steps` 数组是同一种隐患。
    // `emptyProgram` 让调用方可以说 `missing-program` 并打印 `bytes: 0`，
    // 而不是报告一次它从未见到过的解析拒绝。
    return {
      bytes: [],
      errors: [
        `${channel === 'player' ? 'the player' : 'the program source'} compiles to zero bytes: no instruction would ever execute`,
      ],
      reason: 'invalid',
      emptyProgram: true,
    };
  }
  return { bytes: image.bytes, errors: [], reason: 'invalid', emptyProgram: false };
}

/**
 * 解析或汇编 `text`，并把它装载进电路的程序 RAM。从不抛错。
 *
 * 这是每个“要跑程序”的检查都需要的三步，且只有一种次序可行：把文本
 * 读成字节、决定这些字节进哪些 `ram_prog` 实例、并在装载之前复位电路
 * ——`reset()` 会清掉每个存储字节，所以先写镜像再复位，镜像会在被读到
 * 之前就消失。`runChecks` 在调用它之前已经编译好电路，因此复位是镜像
 * 落地之前，状态上发生的最后一件事。
 *
 * 解析用的是 `programImageOf`，所以同一句拒绝的措辞只写一次，供检查器、
 * IDE 与调试器共用。`channel` 说明这是谁的文本，因此它是签名的一部分，
 * 而不是调用方自己改写的说法：关卡分支传它解析出的 `from`，每个驱动
 * “玩家”缓冲区的检查器都说 `'player'`。
 *
 * netlist 里没有的 `ram` id，或比该实例状态更长的镜像，会触发
 * `Simulation.loadImage` 自己的 `RangeError`，这里刻意不接：
 * `runChecks` 把它吸收成一条 `invalid` 失败（与该分支任何其他地方得到
 * 的形状相同），而调用它的自定义检查器会由外层循环得到同样处理。
 *
 * 未命名的 `ram` 情况不需要额外参数：每个 `ram_prog` 实例的 id 都从
 * “已编译的 netlist”（`io.sim.net`）读出，`compile` 用文档里的实例 id
 * 设置这些 id——所以“电路里每一块 `ram_prog`”的含义和从前一样，助手
 * 不需要自己拿到一份文档。为什么未命名的 `ram` 会装载全部、为什么
 * “存在但不是字符串”的 `ram` 会被拒绝而不是当作未命名、为什么空列表
 * 算错误而不是安静地什么都不做，见 `programTargets`。
 *
 * `spec` 不作为参数，这是“装载真正需要什么”的事实，而不是把说明里的
 * 签名收窄：从文本到镜像之间没有任何关卡数据。唯一与关卡形状有关的东西，
 * 是调用方透传的可选 `ram`，而它是检查里的名字、不是关卡里的——所以
 * `spec` 会变成一个每个调用方都要先查、却没有一行能读的参数。
 */
export function loadProgramImage(
  io: LevelIo,
  text: string,
  format: 'asm' | 'bytes',
  channel: 'level' | 'player' = 'level',
  ram?: unknown,
): ProgramImage {
  const image = programImageOf(text, format, channel);
  if (image.errors.length > 0) return image;

  const targets = programTargets(ram, io.sim.net);
  if ('detail' in targets) {
    return { bytes: [], errors: [targets.detail], reason: targets.reason, emptyProgram: false };
  }

  io.reset();
  for (const id of targets.ids) io.sim.loadImage(id, image.bytes);
  io.sim.settle();
  return image;
}

/**
 * 一段汇编文本表示的镜像，或失败应当携带的那句话。
 *
 * 两种读取器共用一种形状。汇编与手写字节格式拒绝的东西不同，但报告方式
 * 是同一形状——行号、文本、原因——于是使用它们的代码为任一种记录
 * `invalid` 失败的方式相同，只有下面这句措辞不同。行号来自读取器自己，
 * 解析器从不抛错：拒绝是数据，不是异常。
 */
function imageOfAssembly(text: string): { readonly bytes: readonly number[] } | { readonly detail: string } {
  const assembled = assemble(text, AXIS_ISA);
  const first = assembled.errors[0];
  if (first !== undefined) {
    return { detail: `program assembly failed at line ${first.line}: ${first.reason}` };
  }
  return { bytes: assembled.bytes };
}

/** `parseImage` 从手写机器码文本里读出的字节。 */
function imageOfBytes(text: string): { readonly bytes: readonly number[] } | { readonly detail: string } {
  const parsed = parseImage(text);
  const first = parsed.errors[0];
  if (first !== undefined) {
    return { detail: `program image failed at line ${first.line}: ${first.reason}` };
  }
  return { bytes: parsed.bytes };
}

/**
 * 一次 `program` 检查必须把镜像装进哪些 `ram_prog` 实例；或者解释为什么
 * 没有地方可装。
 *
 * 缺省（或空）的 `ram` 装载电路里“每一块” `ram_prog` 实例：只有一块
 * 程序 RAM 的关卡不必点名，有好几块的关卡则全部装载，这使检查与实例在
 * 文档里的排列顺序无关。命名了 `ram` 就原样使用——netlist 里没有的 id
 * 是 `Simulation.loadImage` 的 `RangeError`，由 `runChecks` 报成
 * `invalid`，所以这里不去二次猜测这个名字。
 *
 * “存在但不是字符串”的 `ram` 会被拒绝，规则与隔壁的 `from`、`format`
 * 相同：缺省不是未知。`null` 按缺省处理（关卡数据到达内核时未定型，而
 * `null` 是 JSON 存档里“没有这个键”的常见写法），但数字、对象或布尔值
 * 若放过去，就会落进“装载每一块 `ram_prog`”——于是作者本想选一块 RAM、
 * 却把 id 拼错时，会悄悄装载全部，并对着一个检查从未描述过的电路做判定。
 * 这句话会点名字段与值，因为失败记录是错误拼写唯一能留下痕迹的地方。
 *
 * 列表从“已编译的 netlist”读出，它的 `instanceIds()` 与
 * `instanceDefs()` 是按求值顺序排列的平行数组：一个 id 与它的 def 在
 * 同一处，这正是“每一块 `ram_prog` 实例”需要的形式。`compile` 用文档里
 * 的实例 id 设置每个 `CompiledInstance.key`，所以这里返回的 id 就是
 * `Simulation.loadImage` 会解析的 id——与文档给出的一致，而助手不必
 * 拿到它本不读取的 `Graph`。
 *
 * 返回空列表不是一个选项：无处安放程序的检查是 `missing-io` 失败，而
 * 不是悄悄什么都不跑。
 *
 * 导出给 IDE 与调试器（阶段计划的 Task 6）：它们把同一份镜像装进同样
 * 的 `ram_prog` 实例，好在画板上展示程序运行；“哪些实例持有程序”这条
 * 规则，它们绝不能与检查器给出不同答案：抄第二份会漂移，而且漂移在两边
 * 都看不见——检查可能判进调试器不读的 RAM，或者反过来。
 */
export function programTargets(
  ram: unknown,
  net: Netlist,
): { readonly ids: readonly string[] } | { readonly detail: string; readonly reason: 'invalid' | 'missing-io' } {
  if (ram !== undefined && ram !== null && typeof ram !== 'string') {
    return {
      detail: `program check declares ram=${describeValue(ram)}; it must be the id of a ram_prog instance`,
      reason: 'invalid',
    };
  }
  const named = typeof ram === 'string' && ram !== '' ? ram : undefined;
  if (named !== undefined) return { ids: [named] };
  const ids = net.instanceIds().filter((_, index) => net.instanceDefs()[index] === 'ram_prog');
  if (ids.length === 0) {
    return {
      detail:
        'program check names no "ram" and the circuit has no ram_prog instance to load the program into',
      reason: 'missing-io',
    };
  }
  return { ids };
}

/**
 * 对一张已经复位的电路，驱动一串按节拍排序的步骤；每有一个步骤的期望
 * 没有被满足，就追加一条 `mismatch` 失败；返回节拍的高水位。
 *
 * 由 `script` 与 `program` 共用，这是有意的。两种检查只在第一步之前
 * 不同——`program` 会汇编它的源码并把字节装进电路的程序 RAM，
 * `script` 不会——此后每一步对两者含义相同：写入该步输入、结算、时钟到
 * 该步的节拍，然后用 `compare` 比较每个声明的输出，不同就记一条
 * `failure`。若给 `program` 另写一个驱动器，就多了一套要时刻保持一致
 * 的节拍语义。
 *
 * 调用方负责先复位。`settle` 与 `tick` 从不清理状态，所以复位与本次调用
 * 之间装好的程序镜像能活过每一步。
 */
function driveSteps(
  io: LevelIo,
  spec: LevelSpec,
  check: LevelCheck,
  steps: readonly (ScriptStep | ProgramStep)[],
  failures: CheckFailure[],
): number {
  let ticksUsed = io.sim.tickCount;
  const ordered = [...steps].sort((a, b) => a.tick - b.tick);
  for (const step of ordered) {
    for (const pin of spec.io.inputs) {
      io.writeInput(pin.id, step.inputs?.[pin.id] ?? 0);
    }
    io.sim.settle();
    while (io.sim.tickCount < step.tick) io.tick();
    ticksUsed = Math.max(ticksUsed, io.sim.tickCount);
    if (step.expect) {
      const actual: Record<string, number> = {};
      for (const pin of spec.io.outputs) actual[pin.id] = io.readOutput(pin.id);
      if (compare(step.expect, actual)) {
        failures.push(failure(check, step.inputs ?? {}, step.expect, actual, step.tick, 'mismatch'));
      }
    }
  }
  return ticksUsed;
}

/** 把一个输入向量驱动进已编译电路的一次新复位里，走 ticks 拍后再读输出。 */
function runRow(
  io: LevelIo,
  spec: LevelSpec,
  inputs: Readonly<Record<string, number>>,
  ticks: number,
): AttemptOk {
  io.reset();
  for (const pin of spec.io.inputs) io.writeInput(pin.id, inputs[pin.id] ?? 0);
  io.sim.settle();
  for (let i = 0; i < ticks; i += 1) io.tick();
  const outputs: Record<string, number> = {};
  for (const pin of spec.io.outputs) outputs[pin.id] = io.readOutput(pin.id);
  return { outputs, ticksUsed: io.sim.tickCount };
}

/** `actual` 是否在 `expected` 声明的任一键上与期望不同（未声明的键不比较）。 */
function compare(
  expected: Readonly<Record<string, number>>,
  actual: Readonly<Record<string, number>>,
): boolean {
  for (const [key, want] of Object.entries(expected)) {
    if ((actual[key] ?? 0) !== want) return true;
  }
  return false;
}

/**
 * 为一个“根本不是检查”的 `spec.checks` 元素生成失败记录。
 *
 * `failure()` 造不出这一条：它要读 `check.kind`，而这条记录的重点恰恰
 * 是没有可读的 kind。记录的 `check` 字段类型是本内核认识的 kind 的联合，
 * 所以这里写 `'(none)'`——这是唯一一处“可以确定关卡数据没写出任何内核
 * 能运行的东西”的地方。
 */
function unreadableCheckFailure(entry: unknown): CheckFailure {
  const detail = isRecord(entry)
    ? `check entry has kind=${describeValue(entry.kind)}, expected a string kind`
    : `check entry is ${describeValue(entry)}, expected an object with a kind`;
  return {
    check: '(none)' as CheckFailure['check'],
    inputs: {},
    expected: {},
    actual: {},
    tick: 0,
    reason: 'invalid',
    detail,
  };
}

/**
 * 构造一条失败记录。
 *
 * `reason` 用 `NonNullable<...>` 而不是 `CheckFailure['reason']`：该字段
 * 是可选的，所以索引类型包含 `undefined`，而
 * `exactOptionalPropertyTypes` 不允许把可能为 `undefined` 的值赋给可选
 * 属性。何况本模块构造的每条失败都会给出原因。
 *
 * `round` 与 `detail` 同样是“没话说就不出现”：只有 `fuzz` 有轮次，
 * 也只有细节塞不进数值记录的失败才带一句话。
 */
function failure(
  check: LevelCheck,
  inputs: Readonly<Record<string, number>>,
  expected: Readonly<Record<string, number>>,
  actual: Readonly<Record<string, number>>,
  tick: number,
  reason: NonNullable<CheckFailure['reason']>,
  round: number | null = null,
  detail: string | null = null,
): CheckFailure {
  // `round` 与 `detail` 只在存在时附加：`exactOptionalPropertyTypes`
  // 不允许把显式的 `undefined` 交给可选属性，而这里的调用方即使给 `null`
  // 也没有内容可说。
  return {
    check: check.kind,
    inputs,
    expected,
    actual,
    tick,
    reason,
    ...(round === null ? {} : { round }),
    ...(detail === null ? {} : { detail }),
  };
}

/**
 * 一次检查为什么没有可评估的电路：结算循环跑飞了（`unstable`）、
 * `compile` 拒绝了这张图（`invalid`），或图的关卡 I/O 与关卡声明的
 * 引脚不符（`missing-io`，见 `bindLevelIo`）。三者在 `CheckFailure` 里
 * 映射为同名的失败原因。
 */
interface AttemptFail {
  error: 'unstable' | 'invalid' | 'missing-io';
}

interface AttemptOk {
  outputs: Record<string, number>;
  ticksUsed: number;
}

function createSim(
  graph: Graph,
  registry: Registry,
  spec: LevelSpec,
): { io: LevelIo } | AttemptFail {
  try {
    const net = compile(graph, registry);
    const sim = new Simulation(net, registry);
    const io = bindLevelIo(sim, net, spec);
    // 电路的关卡 I/O 存在、但位宽与关卡声明不符：没有任何值能完整穿过这样
    // 的引脚，所以这份电路按“未绑定”处理，而不是按两种位宽里看起来顺眼的
    // 那种去跑。
    if (io.mismatch !== undefined) return { error: 'missing-io' };
    return { io };
  } catch (e) {
    if (e instanceof UnstableCircuitError) return { error: 'unstable' };
    if (e instanceof CircuitValidationError) return { error: 'invalid' };
    throw e;
  }
}

/**
 * 只取本关全部检查用掉的节拍数（TICK 指标），不关心通过与否。
 *
 * 它是 `runChecks` 的一层薄封装，供需要显示“这张电路要跑多少拍”的
 * 地方使用，不产生失败清单。
 *
 * @param graph 要测量的电路。
 * @param registry 元件定义表。
 * @param spec 关卡规格。
 * @returns 各检查用例节拍数的最大值。
 */
export function countTicksUsed(graph: Graph, registry: Registry, spec: LevelSpec): number {
  return runChecks(graph, registry, spec).ticksUsed;
}

// ------------------------------ 画板逐条演示用的用例表 ------------------------------

/** 关卡检查驱动的一个用例：输入向量，以及关卡期望的输出。 */
export interface TestCase {
  readonly inputs: Readonly<Record<string, number>>;
  /** 这个用例断言的输出；不断言任何输出的用例为空。 */
  readonly expected: Readonly<Record<string, number>>;
  /**
   * 驱动输入后、读输出前要施加的时钟沿数。组合逻辑关卡永远是 0；
   * `script` 的步骤则声明自己属于哪个节拍。
   */
  readonly tick: number;
  /**
   * 驱动这个用例之前，是否先清空电路。
   *
   * 这是让“用例列表”可播放的唯一要素，而且它按用例而不是按关卡存在，
   * 因为一关可能同时声明两种形状的检查——`ch2-23-odd-cycles` 声明了两段
   * script，而同时有真值表和 script 的关卡会各声明一条。真值表、约束与
   * fuzz 检查各自把一条向量驱动进刚复位的电路，所以它们的用例都是 `true`。
   * 一段 script 的步骤属于同一次运行——第 3 步读到的寄存器是第 2 步时钟
   * 出来的——所以只有它的第一步为 `true`，其余步骤接着上一次留下的状态
   * 继续走时钟。
   */
  readonly reset: boolean;
}

/** 一关将要测试什么，或为什么无法拆成一条条用例。 */
export type TestPlan =
  | { readonly kind: 'cases'; readonly cases: readonly TestCase[] }
  | { readonly kind: 'none'; readonly reason: 'program' | 'custom' | 'empty' };

/**
 * 这一关的检查会驱动的用例，顺序与检查器驱动的顺序一致。
 *
 * 为什么要它。底部面板从前只是一份“报告”而不是“计划”：它显示上一次
 * 判定碰巧记下的失败，于是玩家在已经被判完之后才知道这一关会测什么，
 * 而通过的电路则什么都看不到。用例本来就是声明好的数据——真值表的
 * `rows`、约束枚举出的输入、fuzz 检查自己的种子化向量、script 的步骤
 * ——所以它们可以在电路造好之前先排出来，再逐条播放。
 *
 * 它是从检查器“自己用的原语”推导出来的：约束用 `enumerateInputs` 与
 * `evaluateRule`，fuzz 检查用 `planFuzz` 与 `fuzzVectors`，其余用检查
 * 自己的 `rows` 与 `steps`。一份与 `runChecks` 实际驱动内容漂移的列表，
 * 会动画演示一个关卡从不运行的测试，那比没有动画更糟；
 * `test/levels/testcases.test.ts` 把这份一致性钉住了：让一张已知错误的
 * 电路走真实检查器，再把它的失败记录与这份列表逐向量比对。
 *
 * `program` 与 `custom` 没有用例列表，这不是疏忽。程序的向量只有在
 * 汇编好的镜像装进电路 RAM 之后才有意义，而那是检查自己的事；custom
 * 检查的用例活在本模块看不到的代码里。两者都会报告原因，测试按钮仍然
 * 判定它们——只是无法逐条播放。
 *
 * 从不抛错。它被面板的渲染路径在每次画板编辑时调用，而关卡数据到达内核
 * 时是未定型的。格式错误的检查、抛错的输入函数、枚举无法表达的取值：
 * 每一种都只是丢掉那些用例，而不是把画板一起拖垮——这正是 `runChecks`
 * 在上层遵循的规则。
 */
export function testCases(spec: LevelSpec): TestPlan {
  const cases: TestCase[] = [];
  let blocked: 'program' | 'custom' | null = null;
  const checks: readonly LevelCheck[] = Array.isArray(spec.checks) ? spec.checks : [];

  for (const entry of checks) {
    if (!isRecord(entry) || typeof entry.kind !== 'string') continue;
    const check: LevelCheck = entry;
    try {
      if (check.kind === 'truth-table') {
        for (const row of check.rows ?? []) {
          cases.push({
            inputs: numericOnly(row.inputs ?? {}),
            expected: numericOnly(row.outputs ?? {}),
            tick: 0,
            reset: true,
          });
        }
        continue;
      }
      if (check.kind === 'constraint') {
        for (const inputs of enumerateInputs(spec)) {
          const want = evaluateRule(check.rule, inputs, outputWidth(spec, check.rule.output));
          cases.push({
            inputs,
            expected: { [check.rule.output]: want },
            tick: 0,
            reset: true,
          });
        }
        continue;
      }
      if (check.kind === 'fuzz') {
        const plan = planFuzz(check, spec);
        if (plan.kind !== 'plan') continue;
        // `fuzzVectors` 给出的是写入引脚“实际驱动”的值，与 `runChecks`
        // 写进失败记录的是同一份记录，而不是原始抽样的值。
        for (const inputs of fuzzVectors(check.seed, plan)) {
          const expected: Record<string, number> = {};
          for (const pin of plan.outputs) {
            const value: unknown = pin.fn(inputs);
            if (typeof value === 'number') expected[pin.id] = value;
          }
          cases.push({ inputs, expected, tick: 0, reset: true });
        }
        continue;
      }
      if (check.kind === 'script') {
        const steps = check.steps ?? [];
        for (const [index, step] of steps.entries()) {
          cases.push({
            inputs: numericOnly(step.inputs ?? {}),
            expected: numericOnly(step.expect ?? {}),
            tick: step.tick,
            // 只有 script 的第一步从清空的电路开始：`runChecks` 对每个检查
            // 复位一次，然后走完所有步骤。声明两段 script 的关卡
            // （`ch2-23-odd-cycles`）会复位两次，每段 script 开头一次。
            reset: index === 0,
          });
        }
        continue;
      }
      if (check.kind === 'program') blocked ??= 'program';
      else if (check.kind === 'custom') blocked ??= 'custom';
    } catch {
      // 刻意保持安静：见上面的“从不抛错”。真正运行检查器时，它会把同一种
      // 缺陷连原因带说明一起正确报告出来。
    }
  }

  if (cases.length === 0) {
    return blocked === null ? { kind: 'none', reason: 'empty' } : { kind: 'none', reason: blocked };
  }
  return { kind: 'cases', cases };
}

export { formatPort };
