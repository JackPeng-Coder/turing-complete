/**
 * The assembler kernel's public surface.
 *
 * The `program` level checker (`src/levels/checks.ts`) and, in phase 3, the
 * assembly IDE are the consumers, and both import from here rather than from
 * the two files underneath, so the surface can grow without either of them
 * learning the file layout.
 *
 * Nothing in `src/asm/` touches the DOM, the clock, the network or
 * `Math.random()` (phase-2 constraint 12): the only import below the surface is
 * `src/core/fields`.
 */
export { assemble } from './assemble';
export type { AssembleError, AssembleResult } from './assemble';
export { DEST_CODES, OPERAND_NAMES, OVERTURE_ISA, SOURCE_CODES } from './isa';
export type { FieldRange, Isa, ModeDef, ModeId, OperandDef, OperandKind } from './isa';
