/**
 * 真值表生成：把“每个输出引脚一个期望函数”展开成一张完整的真值表检查。
 *
 * 关卡数据里一条 truth-table 检查只需要给出每一行的输入与期望输出；手写
 * 2 的 n 次方行既容易错、也容易漏。本模块按引脚位宽枚举所有输入组合，再
 * 逐行调用作者给出的函数。
 *
 * 依赖下层 `core/signal` 的按位宽裁剪；产物直接进入 `levels/checks.ts` 的
 * 判定流程。关键不变量：输入引脚的顺序决定枚举时位段如何拼接，输出引脚的
 * 顺序与位宽决定期望值如何切回各引脚，任何引脚都不允许缺席。
 */

import { maskInto } from '../core/signal';
import type { PinSpec, TruthRow, TruthTableCheck } from './spec';

/**
 * 一个关卡（或沙盒）的引脚集合：判定、读数与显示都以它为准。
 *
 * `inputs` 与 `outputs` 的数组顺序就是 UI 上的顺序，也是枚举真值表时
 * 拼接位段的顺序——先列出的引脚占低位。
 */
export interface LevelIo {
  readonly inputs: readonly PinSpec[];
  readonly outputs: readonly PinSpec[];
}

/**
 * 枚举全部输入组合，返回每种组合下“输入引脚 id → 数值”的映射。
 *
 * 位段拼法：按 `io.inputs` 的顺序把各引脚的位宽依次排开，第 n 个组合就是
 * 这条二进制串的整数形式，因此第一个引脚落在最低位。组合总数是
 * 2 的（全部输入位宽之和）次方。
 */
function enumerateInputs(io: LevelIo): Array<Record<string, number>> {
  const bits = io.inputs.reduce((acc, p) => acc + p.width, 0);
  const combos: Array<Record<string, number>> = [];
  for (let n = 0; n < 2 ** bits; n += 1) {
    const row: Record<string, number> = {};
    let offset = 0;
    for (const pin of io.inputs) {
      row[pin.id] = maskInto(n >>> offset, pin.width);
      offset += pin.width;
    }
    combos.push(row);
  }
  return combos;
}

/**
 * 由“每个输出引脚一个函数”的期望表，生成一张完整的真值表检查。
 *
 * 声明了却没给函数的输出引脚会直接抛错，这样笔误不会悄悄产出一张从不
 * 检查该引脚的表；反过来，给了函数却不是本关输出引脚的键也会抛错。两种
 * 错误都会让判定“看起来通过”，所以必须在生成阶段就暴露。
 *
 * @param io 关卡的输入/输出引脚定义（顺序与位宽决定枚举与切分）。
 * @param expected 输出引脚 id 到期望值函数的映射；函数收到“输入引脚 id
 *   到数值”的一行，返回该引脚的期望输出，返回值会按引脚位宽裁剪。
 * @returns 可直接放进关卡 `checks` 的 `truth-table` 检查。
 * @throws 输出引脚缺少函数、或函数键不是本关输出引脚时抛出 Error。
 */
export function truthTable(
  io: LevelIo,
  expected: Readonly<Record<string, (inputs: Record<string, number>) => number>>,
): TruthTableCheck {
  for (const pin of io.outputs) {
    if (typeof expected[pin.id] !== 'function') {
      throw new Error(`truthTable: no expectation given for output pin "${pin.id}"`);
    }
  }
  for (const key of Object.keys(expected)) {
    if (!io.outputs.some((pin) => pin.id === key)) {
      throw new Error(`truthTable: "${key}" is not an output pin of this level`);
    }
  }
  const rows: TruthRow[] = enumerateInputs(io).map((inputs) => {
    const outputs: Record<string, number> = {};
    for (const pin of io.outputs) {
      outputs[pin.id] = maskInto(expected[pin.id]!(inputs), pin.width);
    }
    return { inputs, outputs };
  });
  return { kind: 'truth-table', rows };
}
