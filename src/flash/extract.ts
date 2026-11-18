import type { ComponentDef } from '../core/registry';
import { portValueToNumber, type PortValue } from '../core/signal';

/**
 * 把元件自身的 JavaScript 行为抽取成表。
 *
 * 本文件的关键点是：它**不移植任何逻辑**。对每个受支持的元件，用页面内核调用的
 * 同一个 `evaluate`/`clockEdge`，把它在所有可能输入下的输出问一遍。所以 NAND 的
 * 表就是游戏里实际使用的四个数字；元件的 JavaScript 改了，重新生成的就是另一张
 * 表，而不会与手写的 C++ 副本逐渐分叉。
 *
 * 这样做之所以可靠，只因为受支持集合很小：组合元件最多 3 个输入位（2 的 3 次方
 * 等于 8 次调用），存储元件只有 1 个状态字节、可达状态为 2（`delay_line`、`mem1`）。
 * 宽位元件（如加法器）需要 2 的 16 次方次调用，在进入本文件之前就被 `build.ts`
 * 拒绝了。
 */

/** 元件不符合"表模型"时抛出；`build.ts` 会把它变成一次拒绝。 */
export class ExtractionError extends Error {}

/** 存储表允许的最大可达状态数。 */
export const MAX_STATES = 64;

/** 组合元件编译后的样子：每个输出引脚一张真值表。 */
export interface ExtractedCombination {
  /** 输入位总数，等于所有输入引脚位宽之和。 */
  readonly inputBits: number;
  /** 每个输出引脚一张表，各 `2 ** inputBits` 项，取值 0 或 1。 */
  readonly tables: readonly Uint8Array[];
}

/** 存储元件编译后的样子：一张发布表加一张时钟沿表。 */
export interface ExtractedStorage {
  /** 输入位总数，等于所有输入引脚位宽之和。 */
  readonly inputBits: number;
  /** 可达状态数；状态 0 是 `reset` 留下的全零状态。 */
  readonly stateCount: number;
  /** 每个输出引脚一张发布表，各 `stateCount` 项。 */
  readonly publish: readonly Uint8Array[];
  /** `stateCount * 2 ** inputBits` 项，每项是一个状态下标。 */
  readonly transitions: Uint8Array;
}

/**
 * 把一个向量下标拆成每个输入引脚上的值。
 *
 * 约定是"低位在前"：第 0 个输入引脚占最低的 `width` 位，第 1 个引脚接在它上面，
 * 以此类推。固件里 `tcSweep`/`tcTick` 用同样的约定拼回下标，两边必须一致。
 */
function inputsFor(widths: readonly number[], vector: number): PortValue[] {
  const values: PortValue[] = [];
  let shift = 0;
  for (const width of widths) {
    const mask = 2 ** width;
    values.push(Math.floor(vector / 2 ** shift) % mask);
    shift += width;
  }
  return values;
}

/** 把端口值收成小的非负整数；收不下时给出明确的抽取错误。 */
function asSmall(value: PortValue, def: ComponentDef, pin: string): number {
  const number = portValueToNumber(value);
  if (!Number.isSafeInteger(number) || number < 0 || number > 0xffff_ffff) {
    throw new ExtractionError(`${def.id}.${pin} produced a value a table cannot hold: ${number}`);
  }
  return number;
}

/**
 * 抽取一个组合元件的真值表。
 *
 * 枚举全部输入向量（每个向量一次 `evaluate` 调用），把每个输出引脚的结果收成
 * 0/1 后填表。输入位上限 10（最多 1024 个向量）是为了让构建时间可预期。
 *
 * @param def 元件定义，必须实现 `evaluate()`。
 * @param inputWidths 每个输入引脚的位宽，按引脚顺序。
 * @param outputPins 每个输出引脚的 id，按引脚顺序。
 * @returns 输入位总数，以及每个输出引脚一张表。
 * @throws {ExtractionError} 元件没有 `evaluate`、输入位超过 10、或输出不是一位时。
 */
export function extractCombination(
  def: ComponentDef,
  inputWidths: readonly number[],
  outputPins: readonly string[],
): ExtractedCombination {
  const evaluate = def.evaluate;
  if (evaluate === undefined) throw new ExtractionError(`${def.id} has no evaluate()`);
  const inputBits = inputWidths.reduce((sum, width) => sum + width, 0);
  if (inputBits > 10) throw new ExtractionError(`${def.id} has ${inputBits} input bits; the table cap is 10`);
  const vectors = 2 ** inputBits;
  const tables = outputPins.map(() => new Uint8Array(vectors));

  for (let vector = 0; vector < vectors; vector += 1) {
    const outputs: PortValue[] = [];
    // 第三个参数传 `undefined`：组合元件没有状态字节，`evaluate` 会忽略它。
    evaluate(inputsFor(inputWidths, vector), outputs, undefined, { tick: 0 });
    for (let pin = 0; pin < outputPins.length; pin += 1) {
      const value = outputs[pin];
      if (value === undefined) {
        throw new ExtractionError(`${def.id}.${outputPins[pin]!} published nothing`);
      }
      const bit = asSmall(value, def, outputPins[pin]!);
      if (bit !== 0 && bit !== 1) {
        throw new ExtractionError(`${def.id}.${outputPins[pin]!} is not one bit (${bit})`);
      }
      tables[pin]![vector] = bit;
    }
  }
  return { inputBits, tables };
}

/**
 * 把一个存储元件整理成两张表：保持某状态时发布什么，以及一个时钟沿把状态移到哪。
 *
 * 状态空间不是全部 256 个字节值，而是**从零状态出发、经过任意时钟沿序列可达**
 * 的那些状态。对两个受支持元件来说只有两个状态，所以一个 `mem1` 只花 2 字节
 * 发布表加 8 字节转移表，而不是 256 加 1024——这在 Uno 上很关键，一个寄存器
 * 每一位放一个存储器时更关键。
 *
 * @param def 元件定义，必须同时实现 `evaluate()` 与 `clockEdge()`。
 * @param inputWidths 每个输入引脚的位宽。
 * @param outputPins 每个输出引脚的 id。
 * @returns 可达状态数、每个输出引脚的发布表与扁平化的转移表。
 * @throws {ExtractionError} 接口缺失、状态字节数不为 1、输入位超过 10，或可达
 *   状态数超过 `MAX_STATES` 时。
 */
export function extractStorage(
  def: ComponentDef,
  inputWidths: readonly number[],
  outputPins: readonly string[],
): ExtractedStorage {
  const evaluate = def.evaluate;
  const clockEdge = def.clockEdge;
  if (evaluate === undefined || clockEdge === undefined) {
    throw new ExtractionError(`${def.id} is sequential but has no evaluate()/clockEdge()`);
  }
  if (def.stateBytes !== 1) {
    throw new ExtractionError(`${def.id} keeps ${def.stateBytes} state bytes; the first version supports one`);
  }
  const inputBits = inputWidths.reduce((sum, width) => sum + width, 0);
  if (inputBits > 10) throw new ExtractionError(`${def.id} has ${inputBits} input bits; the table cap is 10`);
  const vectors = 2 ** inputBits;

  // 从全零状态开始做可达性搜索：states[i] 是第 i 个可达状态的原始字节内容。
  const states: Uint8Array[] = [new Uint8Array(def.stateBytes)];
  // 状态字节内容 -> 状态下标；状态只有一两个字节，用逗号串做键的开销可以忽略。
  const indexByKey = new Map<string, number>([['0', 0]]);
  // edgeTargets[状态][输入向量] = 下一个状态的下标。
  const edgeTargets: number[][] = [];

  for (let index = 0; index < states.length; index += 1) {
    const held = states[index]!;
    const targets: number[] = [];
    for (let vector = 0; vector < vectors; vector += 1) {
      // 传状态的副本：clockEdge 允许原地改写 next，不能让它动到 held。
      const next = new Uint8Array(held);
      clockEdge(inputsFor(inputWidths, vector), [], next, { tick: 1 });
      const key = Array.from(next).join(',');
      let target = indexByKey.get(key);
      if (target === undefined) {
        if (states.length >= MAX_STATES) {
          throw new ExtractionError(`${def.id} reaches more than ${MAX_STATES} states`);
        }
        target = states.length;
        indexByKey.set(key, target);
        states.push(next);
      }
      targets.push(target);
    }
    edgeTargets.push(targets);
  }

  // 发布表只看状态、不看输入：evaluate 在输入为空时报告该状态下的输出位。
  const publish = outputPins.map(() => new Uint8Array(states.length));
  for (let index = 0; index < states.length; index += 1) {
    const outputs: PortValue[] = [];
    evaluate([], outputs, new Uint8Array(states[index]!), { tick: 0 });
    for (let pin = 0; pin < outputPins.length; pin += 1) {
      const value = outputs[pin];
      if (value === undefined) {
        throw new ExtractionError(`${def.id}.${outputPins[pin]!} published nothing`);
      }
      const bit = asSmall(value, def, outputPins[pin]!);
      if (bit !== 0 && bit !== 1) {
        throw new ExtractionError(`${def.id}.${outputPins[pin]!} is not one bit (${bit})`);
      }
      publish[pin]![index] = bit;
    }
  }

  // 拉平成一个扁平数组，固件按 state * 2 ** inputBits + vector 索引。
  const transitions = new Uint8Array(states.length * vectors);
  for (let index = 0; index < states.length; index += 1) {
    for (let vector = 0; vector < vectors; vector += 1) {
      transitions[index * vectors + vector] = edgeTargets[index]![vector]!;
    }
  }

  return { inputBits, stateCount: states.length, publish, transitions };
}
