/**
 * The marking painted on a part's body.
 *
 * The original labels its components the way a chip is marked: `NAND`, `NOT`,
 * `MUX`, `ADD` -- a short uppercase mnemonic, never a name. The width travels
 * separately, in the corner badge, which is why `and` and `and8` carry the same
 * `AND` and are told apart by the `8` on the second one. A board of Chinese
 * component names read as a menu; a board of markings reads as a schematic, and
 * it is legible at any zoom because four capital letters survive being drawn
 * small.
 *
 * IT IS A TABLE, NOT A FIELD ON THE COMPONENT, and that is a deliberate split.
 * A marking is a DRAWING decision -- how many characters fit inside a D, a
 * shield, a 72-pixel box at the zoom the player is working at -- and `core/` has
 * no business knowing about that. The palette still shows the Chinese name, which
 * is what a player reads when choosing a part, and the tooltip carries the
 * English name and this marking, so the two vocabularies are connected at the
 * moment they need to be.
 *
 * `appearance.test.ts` walks the whole registry and fails if any part has no
 * entry here, or one that is longer than six characters or not uppercase: a part
 * added later cannot quietly ship labelled `8 位算术右移`.
 */
import type { ComponentDef } from '../../core/registry';

/** Every registered part, by its def id. */
const MARKING: Readonly<Record<string, string>> = {
  // -- sources ---------------------------------------------------------------
  const_on: 'ON',
  const_off: 'OFF',
  const8: 'CONST',

  // -- the ten one-bit parts -------------------------------------------------
  nand: 'NAND',
  not: 'NOT',
  and: 'AND',
  or: 'OR',
  nor: 'NOR',
  xor: 'XOR',
  xnor: 'XNOR',
  and3: 'AND3',
  or3: 'OR3',
  full_adder: 'FA',

  // -- level plumbing --------------------------------------------------------
  level_input: 'IN',
  level_output: 'OUT',

  // -- storage ---------------------------------------------------------------
  delay_line: 'DELAY',
  mem1: 'MEM',

  // -- the byte operators: the WIDTH is the badge, not the marking -----------
  and8: 'AND',
  or8: 'OR',
  nand8: 'NAND',
  nor8: 'NOR',
  xor8: 'XOR',
  xnor8: 'XNOR',
  not8: 'NOT',
  add8: 'ADD',
  neg8: 'NEG',
  // Signed and unsigned less-than, in the mnemonics every ISA uses for them.
  less_s: 'SLT',
  less_u: 'SLTU',
  equal8: 'EQ',
  shift_l8: 'SHL',
  shift_r8: 'SHR',
  ashr8: 'SAR',
  rot_l8: 'ROL',
  rot_r8: 'ROR',
  mul8: 'MUL',
  div8: 'DIV',
  splitter: 'SPLIT',
  maker: 'MAKE',
  switch: 'SW',
  switch8: 'SW',
  mux8: 'MUX',
  delay8: 'DELAY',
  reg8: 'REG',
  counter8: 'CNT',
  ram8: 'RAM',
  decoder1: 'DEC1',
  decoder2: 'DEC2',
  decoder3: 'DEC3',

  // -- the machine -----------------------------------------------------------
  alu8: 'ALU',
  regfile6: 'RF',
  instr_decoder: 'DECODE',
  pc8: 'PC',
  ram_prog: 'PRAM',
  halt: 'HALT',
};

/**
 * The marking for one part.
 *
 * The fallback is a guard, not a policy: it uppercases the id and cuts it to six
 * characters, and `appearance.test.ts` fails before anything can reach it -- a
 * def with no marking of its own would come out as `FULL_A`, and the test names
 * it instead.
 */
export function partCodeOf(def: ComponentDef): string {
  const marked = MARKING[def.id];
  if (marked !== undefined) return marked;
  return def.id
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 6);
}
