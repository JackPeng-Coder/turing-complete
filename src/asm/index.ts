/**
 * 汇编器内核对外的公共出口。
 *
 * 消费方是 `program` 关卡检查器（`src/levels/checks.ts`），以及第三阶段的汇编
 * IDE；它们都从这里 import，而不是从下面的两个文件 import，这样以后调整文件
 * 布局时，两边都不必知道 `src/asm/` 内部是怎么分文件的。
 *
 * `src/asm/` 里没有任何东西接触 DOM、时钟、网络或 `Math.random()`（第二阶段
 * 约束 12）：这一层之下唯一的 import 是 `src/core/fields`。
 */
export { assemble } from './assemble';
export type { AssembleError, AssembleResult } from './assemble';
export { parseImage } from './image';
export type { ImageParseError, ImageParseResult } from './image';
export { DEST_CODES, OPERAND_NAMES, AXIS_ISA, SOURCE_CODES } from './isa';
export type { FieldRange, Isa, ModeDef, ModeId, OperandDef, OperandKind } from './isa';
