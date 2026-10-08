import type { BoardInit, BoardPart, BoardWire } from '../spec';

/**
 * The OVERTURE machine as level data: the circuit the programming chapter opens
 * on, and the chapter-3 reference solution, from one source.
 *
 * ONE BUILDER, TWO READERS, and that is the point of this file. A chapter-4
 * level ships `board: overtureBoard()` and opens with the machine already wired;
 * `test/fixtures/ch3-references.ts` grades chapter 3's three machine levels
 * against `graphFromBoard('ref', overtureBoard())`. The wiring used to live in
 * that fixture, which meant the reference solution and the board a player is
 * handed were two copies of one circuit, free to drift -- and the drift would
 * read as a PASS, because the reference would keep grading green against a
 * machine the levels no longer ship.
 *
 * WHY THE CIRCUIT IS DATA. Level data is serialisable: no functions, no class
 * instances, nothing a save file or a `JSON.stringify` would lose (see
 * `BoardInit` in `levels/spec.ts`). A `() => Graph` builder stored on a level
 * would be a function in a level object, and a board written out as a `Graph`
 * would be a document with ids and parameters nobody can check by reading.
 * Parts and index-referenced wires are the smallest thing that is still a
 * circuit: `levels/board.ts` is the one reader.
 *
 * THE MACHINE. One program RAM addressed by the program counter, the instruction
 * decoder, the six-register file, the ALU, the write path, the conditional
 * jump's glue, and the halt line that freezes the counter once the program has
 * put its answer on `out`. It is level 49's measured machine (643 gates, 6
 * deep), which is what chapter 4's targets are measured from.
 *
 * THE INSTRUCTION IS EXECUTED BY THE EDGE THAT ADVANCES PAST IT. The program RAM
 * is combinational from `PC`, so at the start of a tick the machine is looking at
 * `ram[PC]`; every storage element samples that same decode on the edge -- the
 * register file writes, the counter takes the jump target or its successor -- and
 * the settle that follows publishes the new state. One edge, one instruction.
 *
 * THE READ PORTS. `addrA` is the `move` source, REG1 for a `calc` and REG0 for a
 * `jump` (the jump target, per the compendium's §6.4); `addrB` is REG2 for a
 * `calc` and REG3 for a `jump` (the condition value). The mux chain is what makes
 * one pair of ports serve all three modes.
 *
 * THE INPUT PORT IS CHAPTER 4'S ADDITION, AND CHAPTER 3'S MACHINE DOES NOT HAVE
 * IT. Chapter 3's programs are straight lines and loops over the register file,
 * so what `move|inp|dN` reads there is code 6 -- `inp` in the ISA's operand
 * names, and a register the six-register file does not have, which it publishes
 * as 0 (see `regfile6`). Nothing chapter 3 asserts notices. Every chapter-4 level
 * reads its input, so `inputId` adds a `level_input` instance named
 * `IN_<inputId>` and a mux that puts it on the source-VALUE path: the byte a
 * `move` copies is the register file's `a` unless the instruction's [5:3] field
 * is 6, in which case it is the level's byte. The select is the condition
 * decoder's own `b6` line -- free, and already there (see the `srcData` wires) --
 * and both readers of a move's source read that one mux, so `move|inp|dN` and
 * `move|inp|out` copy the same byte. One builder, two shapes -- the chapter-3
 * board is this one with the option absent, which is what keeps the three-star
 * targets chapter 3 measured where they were measured.
 *
 * `out` IS COMBINATIONAL AND `halt` IS WHAT MAKES THAT HONEST. `out` publishes
 * the `move` source while the instruction being looked at is `move|sX|out`;
 * without the halt the counter would walk on and `out` would fall back to zero,
 * so the halt line freezes the counter on the `out` instruction's own address and
 * the answer stays put. A player who instead registers the `out` byte passes the
 * same checks (the byte they publish is the same byte), and both are accepted:
 * what a level asserts is the value, not the spelling.
 */

/**
 * The near-misses a broken machine can be built from: the same board with exactly
 * one thing short-circuited.
 *
 * THE DEFAULTS ARE THE SHIPPED MACHINE. Every option below exists so that
 * `test/levels/ch3-batch3.test.ts` can build a machine that is wrong in one
 * named way and assert that its level's own walk catches it -- and they live
 * here, next to the wiring, because a counterexample built from a SECOND copy of
 * this circuit would not be a counterexample to this circuit. The batch test
 * names, for each one, which assertion in the level data is what catches it.
 */
export interface OvertureBoardOptions {
  /**
   * What the counter's load signal does with a jump: this machine's conditional
   * glue, never (the jump path is short-circuited low), or always (a jump is
   * taken whatever the condition says).
   */
  readonly jump?: 'conditional' | 'never' | 'always';
  /**
   * How the immediate reaches the register file: the full six-bit field, a
   * five-bit slice of it (bit 5 dropped, the classic off-by-one-wire), or not at
   * all (the `loadi` select tied low, so the write data is always the move
   * source).
   */
  readonly immediate?: 'sixBits' | 'fiveBits' | 'never';
  /**
   * Whether writing `out` freezes the counter. `false` ties the halt line low,
   * which is the machine a player builds when they forget that `out` is
   * combinational: the byte is right for one edge and gone the next.
   */
  readonly halt?: boolean;
  /**
   * Level input pin id: when given, the board carries a `level_input` instance
   * `IN_<inputId>` (8 bits) and wires it into the CPU's source path, so
   * `move|inp|dN` and `move|inp|out` copy the level's input. Absent means the
   * chapter-3 machine, exactly as it is today.
   */
  readonly inputId?: string;
}

/**
 * One part of the board, with the label this file wires it up by.
 *
 * The label is a SOURCE-LEVEL device and never reaches the graph:
 * `graphFromBoard` reads coordinates, explicit ids and the part list, while
 * `BoardWire` addresses parts by index. Naming them here is what keeps the wire
 * list below readable -- `wire('RF', 'a', 'd1', 'a')` rather than a wall of
 * numbers, which is exactly where a transposed pair stops being visible by eye.
 */
interface Placed extends BoardPart {
  readonly role: string;
}

/**
 * Where a part sits, in canvas world units: one column per pipeline stage, one
 * row per part within it.
 *
 * Spacing is the UI's own part size plus room for the wires between them (72
 * wide, and up to 192 tall for an eight-pin `maker`, which is why the three
 * register makers sit three rows apart rather than one).
 */
const ORIGIN = 40;
const COLUMN = 152;
const ROW = 88;

const at = (col: number, row: number): { x: number; y: number } => ({
  x: ORIGIN + col * COLUMN,
  y: ORIGIN + row * ROW,
});

/**
 * The machine's parts, in construction order.
 *
 * The order is the order the circuit is built in, and it is what the generated
 * instance ids follow: the level's clock connector is named (a level binds it as
 * `IN_clk`), the rest come out `i1`, `i2`, ... exactly as the editor would have
 * named them.
 *
 * `inputId` is the one thing that changes the list: a board asked for a level
 * input carries the connector and the mux that put it on the source-value path,
 * and nothing else about the machine moves. When it is absent the parts below are
 * exactly the chapter-3 machine, in the same order.
 */
function placedParts(fiveBits: boolean, inputId: string | undefined): readonly Placed[] {
  return [
    { role: 'clk', def: 'level_input', id: 'IN_clk', ...at(0, 0) },
    // The level's input pin, next to the clock: both are pins the LEVEL owns
    // rather than parts of the machine, and `levels/checks.ts` binds them by the
    // ids `IN_<pin>` / `OUT`.
    ...(inputId === undefined
      ? []
      : [{ role: 'IN', def: 'level_input', id: `IN_${inputId}`, width: 8, ...at(0, 1) }]),
    { role: 'on', def: 'const_on', ...at(0, 2) },
    { role: 'off', def: 'const_off', ...at(0, 3) },

    // Fetch: the counter addresses the program RAM, and the RAM's byte is what
    // the decoder slices. The counter's own two pins are part of that loop --
    // what drives them is the far end of the machine.
    { role: 'RAM', def: 'ram_prog', ...at(1, 2) },
    { role: 'PC', def: 'pc8', ...at(1, 5) },
    { role: 'DEC', def: 'instr_decoder', ...at(2, 3) },

    // Mode: 00 loadi, 01 calc, 10 move, 11 jump. `we` is "not 11" and
    // `is_loadi` is "neither bit high", which together make the four modes total.
    { role: 'MODE', def: 'splitter', ...at(3, 0) },
    { role: 'n_m1', def: 'not', ...at(4, 0) },
    { role: 'n_m0', def: 'not', ...at(4, 1) },
    { role: 'is_loadi', def: 'nor', ...at(5, 0) },
    { role: 'is_calc', def: 'and', ...at(5, 1) },
    { role: 'is_move', def: 'and', ...at(5, 2) },
    { role: 'is_jump', def: 'and', ...at(5, 3) },
    { role: 'we', def: 'nand', ...at(5, 4) },

    // One three-bit decoder per register field. The condition field is bits
    // [5:3], the same slice the decoder calls `op`.
    { role: 'DST', def: 'decoder3', ...at(3, 2) },
    { role: 'DST_BITS', def: 'splitter', ...at(4, 2) },
    { role: 'COND', def: 'decoder3', ...at(3, 4) },
    { role: 'COND_BITS', def: 'splitter', ...at(4, 4) },

    // REG1 / REG2 / REG3 as 8-bit makers: only the low three bits reach
    // `addrA`/`addrB`.
    { role: 'ONE', def: 'maker', ...at(4, 6) },
    { role: 'TWO', def: 'maker', ...at(4, 9) },
    { role: 'THREE', def: 'maker', ...at(4, 12) },

    // The two read addresses, the write address, and the register file they
    // address.
    { role: 'addrA1', def: 'mux8', ...at(6, 2) },
    { role: 'addrA', def: 'switch8', ...at(7, 2) },
    { role: 'addrB', def: 'mux8', ...at(6, 3) },
    { role: 'RF', def: 'regfile6', ...at(8, 2) },

    // The ALU and the write data: d1 is "the ALU's byte for a calc, the move
    // source for a move", and `data` is that byte or the immediate.
    { role: 'ALU', def: 'alu8', ...at(9, 2) },
    // The source byte a `move` copies, and the mux that makes it "the register
    // file's byte, or the level's input when the instruction says so". The mux
    // sits between `RF` and the two pins that publish a move's source -- `d1`'s
    // `a` on the write path and `out_pin`'s `a` on the `out` path -- which is the
    // path it interrupts. Its select is a line of the machine's own field decode,
    // so it costs no part of its own (see the `srcData` wires).
    ...(inputId === undefined ? [] : [{ role: 'srcData', def: 'mux8', ...at(9, 3) }]),
    { role: 'd1', def: 'mux8', ...at(10, 2) },
    // The five-bit variant slices the immediate before it reaches the mux: the
    // counterexample for level 47, where 63 would arrive as 31.
    ...(fiveBits
      ? [
          { role: 'SPIMM', def: 'splitter', ...at(10, 4) },
          { role: 'IMM5', def: 'maker', ...at(11, 4) },
        ]
      : []),
    { role: 'data', def: 'mux8', ...at(11, 2) },

    // WHERE AN INSTRUCTION WRITES, which is not one field: `loadi` writes REG0
    // (its six bits ARE the value), `calc` writes REG3 -- its [2:0] slice is
    // RESERVED and the assembler leaves it zero -- and `move` writes the
    // destination field it carries.
    { role: 'waddr', def: 'switch8', ...at(6, 4) },
    { role: 'waddr_final', def: 'mux8', ...at(7, 4) },

    // The jump's conditions: j (000) is taken, jz (001) when REG3 is zero, jnz
    // (010) when it is not.
    { role: 'ZERO', def: 'equal8', ...at(6, 6) },
    { role: 'g_jz', def: 'and', ...at(6, 8) },
    { role: 'n_zero', def: 'not', ...at(6, 9) },
    { role: 'g_jnz', def: 'and', ...at(6, 10) },
    { role: 'inner', def: 'or3', ...at(7, 9) },
    { role: 'taken', def: 'and', ...at(7, 11) },

    // The halt line, and the two muxes it drives: the counter's next value and
    // its load signal.
    { role: 'out_load', def: 'and', ...at(6, 12) },
    { role: 'HALT', def: 'halt', ...at(8, 11) },
    { role: 'pc_in', def: 'mux8', ...at(8, 13) },
    { role: 'pc_load', def: 'or', ...at(9, 12) },

    // The answer, published combinationally while the counter is held.
    { role: 'out_pin', def: 'switch8', ...at(12, 2) },
    { role: 'OUT', def: 'level_output', id: 'OUT', width: 8, ...at(13, 2) },
  ];
}

/**
 * The OVERTURE machine, ready to be read into a graph.
 *
 * Pure and deterministic: no clock, no counter, no randomness, so two calls are
 * the same circuit and a level that ships it grades the same way on every open.
 */
export function overtureBoard(options: OvertureBoardOptions = {}): BoardInit {
  const fiveBits = options.immediate === 'fiveBits';
  /** The level's own input pin, when the board was asked to carry one. */
  const inputId = options.inputId;
  /** What carries the immediate into the write data: the field, or its five-bit slice. */
  const immediate = fiveBits ? { part: 'IMM5', port: 'out' } : { part: 'DEC', port: 'imm' };
  /**
   * Where a `move`'s source byte comes from: the register file's `a` port, or the
   * mux that puts the level's input in its place on a board that carries one.
   *
   * ONE CONSTANT FOR BOTH READERS OF IT -- `d1`'s `a` on the write path and
   * `out_pin`'s `a` on the `out` path -- because `move|inp|dN` and `move|inp|out`
   * are the same copy with and without a register in between, and a level's
   * answer must not depend on which spelling the player chose.
   */
  const moveSource =
    inputId === undefined ? { part: 'RF', port: 'a' } : { part: 'srcData', port: 'out' };
  /** What the counter's load pin listens to besides the halt line: the jump glue. */
  const jumpSignal =
    options.jump === 'never' ? 'off' : options.jump === 'always' ? 'is_jump' : 'taken';
  const layout = placedParts(fiveBits, inputId);
  const index = new Map(layout.map((part, position) => [part.role, position]));

  const part = (role: string): number => {
    const position = index.get(role);
    if (position === undefined) {
      // A wire naming a part that is not in the layout is a bug in THIS file,
      // not in a level: the role labels are private to it. Better to say so than
      // to hand `graphFromBoard` an index it would have to guess at.
      throw new Error(`overture: no part named ${role}`);
    }
    return position;
  };
  const wire = (from: string, fromPort: string, to: string, toPort: string): BoardWire => ({
    from: { part: part(from), port: fromPort },
    to: { part: part(to), port: toPort },
  });
  /**
   * The eight pins of a `maker`, least significant bit first: the constant bytes
   * this machine needs -- REG1 / REG2 / REG3, whose low three bits address the
   * register file. Every pin is wired either way: an unwired input reads 0 just
   * the same, and wiring it says on the page which bits of the constant are zero.
   */
  const byte = (role: string, value: number): readonly BoardWire[] =>
    Array.from({ length: 8 }, (_, bit) =>
      wire((value >> bit) & 1 ? 'on' : 'off', 'out', role, `b${bit}`),
    );

  const parts: readonly BoardPart[] = layout.map((placed) => ({
    def: placed.def,
    x: placed.x,
    y: placed.y,
    ...(placed.id === undefined ? {} : { id: placed.id }),
    ...(placed.width === undefined ? {} : { width: placed.width }),
  }));

  const wires: readonly BoardWire[] = [
    // Fetch. `pc_load` and `pc_in` are wired here with the rest of the counter
    // even though what drives them is the far end of the machine -- they are the
    // loop this whole circuit exists to close.
    wire('PC', 'out', 'RAM', 'addr'),
    wire('pc_load', 'out', 'PC', 'load'),
    wire('pc_in', 'out', 'PC', 'in'),
    wire('RAM', 'out', 'DEC', 'instr'),

    // Mode, then every signal derived from it.
    wire('DEC', 'mode', 'MODE', 'in'),
    wire('MODE', 'b1', 'n_m1', 'a'),
    wire('MODE', 'b0', 'n_m0', 'a'),
    wire('MODE', 'b1', 'is_loadi', 'a'),
    wire('MODE', 'b0', 'is_loadi', 'b'),
    wire('n_m1', 'out', 'is_calc', 'a'),
    wire('MODE', 'b0', 'is_calc', 'b'),
    wire('MODE', 'b1', 'is_move', 'a'),
    wire('n_m0', 'out', 'is_move', 'b'),
    wire('MODE', 'b1', 'is_jump', 'a'),
    wire('MODE', 'b0', 'is_jump', 'b'),
    wire('MODE', 'b1', 'we', 'a'),
    wire('MODE', 'b0', 'we', 'b'),

    // The two register fields, split into the one-hot lines the jump glue reads.
    wire('DEC', 'dst', 'DST', 'sel'),
    wire('DST', 'out', 'DST_BITS', 'in'),
    wire('DEC', 'op', 'COND', 'sel'),
    wire('COND', 'out', 'COND_BITS', 'in'),

    // The three constant register numbers, and the read addresses they make.
    ...byte('ONE', 1),
    ...byte('TWO', 2),
    ...byte('THREE', 3),
    // addrA = move ? src : REG1; a jump reads REG0, because `we` is low then and
    // the switch zeroes the one-hot REG1 selection.
    wire('ONE', 'out', 'addrA1', 'a'),
    wire('DEC', 'src', 'addrA1', 'b'),
    wire('is_move', 'out', 'addrA1', 'sel'),
    wire('addrA1', 'out', 'addrA', 'a'),
    wire('we', 'out', 'addrA', 'on'),
    // addrB = jump ? REG3 : REG2: the condition value, or the ALU's operand.
    wire('TWO', 'out', 'addrB', 'a'),
    wire('THREE', 'out', 'addrB', 'b'),
    wire('is_jump', 'out', 'addrB', 'sel'),

    // The register file, the ALU, and the move/calc write path.
    wire('addrA', 'out', 'RF', 'addrA'),
    wire('addrB', 'out', 'RF', 'addrB'),
    wire('waddr_final', 'out', 'RF', 'waddr'),
    wire('data', 'out', 'RF', 'data'),
    wire('we', 'out', 'RF', 'we'),
    wire('RF', 'a', 'ALU', 'a'),
    wire('RF', 'b', 'ALU', 'b'),
    wire('DEC', 'op', 'ALU', 'op'),
    // THE SOURCE-VALUE PATH, AND WHY THE LEVEL INPUT GOES IN HERE RATHER THAN
    // INTO `addrA`. A `move` copies a VALUE: the byte the register file's `a`
    // port publishes, which `d1` and the `out` switch pass on. A level input
    // wired into `addrA` instead would be read as a REGISTER NUMBER -- the
    // level's data spent as an address -- and `move|inp|dN` would copy whichever
    // register that number happened to name. So the mux stands in front of `d1`,
    // where the byte is a byte, and the register file keeps its two read ports.
    //
    // THE SELECT IS THE MACHINE'S OWN FIELD DECODE, AND IT COSTS NOTHING.
    // `COND_BITS.b6` is the one-hot line for field value 6 of the decoder the
    // jump's glue already reads: `COND` decodes `DEC.op`, and `DEC.op` is the very
    // [5:3] slice `DEC.src` names -- `instr_decoder` publishes one field under two
    // names -- so that line IS "the instruction's source field is 6". It is
    // computed already, and it arrives through pins that are wires: 0 gates from
    // this option and 0 delay. A comparator against a constant byte would say the
    // same thing for 54 NAND equivalents -- eight XNORs and a seven-AND tree --
    // and that is the whole gate cost of the option, measured: the wired board's
    // gate metric is 675 with this line and was 729 with the comparator. (Its
    // delay metric is 6 either way, because the comparator stood at the same depth
    // as the decode it duplicated.) The machine should not spend 54 gates
    // repeating a line it holds.
    //
    // AND THE SELECT IS SAFE IN EVERY MODE BECAUSE EACH MODE ALREADY DECIDES THE
    // BYTE. A `calc`'s [5:3] is its OPERATION, where codes 6 and 7 are reserved
    // and `alu8` publishes 0 -- and `d1` passes that byte whatever the field says.
    // A `loadi`'s [5:3] bits are part of its immediate, and the immediate is
    // selected downstream at `data`, past this mux. A `jump`'s [5:3] is a
    // condition code, and the ISA defines only 0, 1 and 2 for it, so the line is
    // low for every branch that exists -- and a jump writes nothing anyway, with
    // `we` low. So the only instruction whose written or published byte this
    // select can change is a `move`, which is the instruction it is for.
    ...(inputId === undefined
      ? []
      : [
          // The value path itself: the register file's byte, or the level's.
          wire('RF', 'a', 'srcData', 'a'),
          wire('IN', 'out', 'srcData', 'b'),
          wire('COND_BITS', 'b6', 'srcData', 'sel'),
        ]),
    // The move source reaches both of the machine's readers of it from the one
    // `moveSource` constant: `d1`'s `a` on the write path (the next wire) and
    // `out_pin`'s `a` on the `out` path (the end of this list). A board without a
    // level input has no mux, and both of those wires are the register file's `a`
    // port exactly as they always were.
    wire(moveSource.part, moveSource.port, 'd1', 'a'),
    wire('ALU', 'out', 'd1', 'b'),
    wire('is_calc', 'out', 'd1', 'sel'),

    // The write data: d1's byte, or the immediate for a loadi. The five-bit
    // variant is the same path with bit 5 of the field thrown away.
    wire('d1', 'out', 'data', 'a'),
    ...(fiveBits
      ? [
          wire('DEC', 'imm', 'SPIMM', 'in'),
          wire('SPIMM', 'b0', 'IMM5', 'b0'),
          wire('SPIMM', 'b1', 'IMM5', 'b1'),
          wire('SPIMM', 'b2', 'IMM5', 'b2'),
          wire('SPIMM', 'b3', 'IMM5', 'b3'),
          wire('SPIMM', 'b4', 'IMM5', 'b4'),
          wire('off', 'out', 'IMM5', 'b5'),
          wire('off', 'out', 'IMM5', 'b6'),
          wire('off', 'out', 'IMM5', 'b7'),
        ]
      : []),
    wire(immediate.part, immediate.port, 'data', 'b'),
    // `never` ties the `loadi` select low, so the write data is always the move
    // source: the machine whose immediate path was never wired at all.
    wire(options.immediate === 'never' ? 'off' : 'is_loadi', 'out', 'data', 'sel'),

    // The write address: the destination field for a move, REG3 for a calc, and
    // REG0 for a loadi (whose switch passes the field's zeroes).
    wire('DEC', 'dst', 'waddr', 'a'),
    wire('is_move', 'out', 'waddr', 'on'),
    wire('waddr', 'out', 'waddr_final', 'a'),
    wire('THREE', 'out', 'waddr_final', 'b'),
    wire('is_calc', 'out', 'waddr_final', 'sel'),

    // The condition value is REG3, which `addrB` publishes during a jump.
    wire('RF', 'b', 'ZERO', 'a'),
    wire('off', 'out', 'ZERO', 'b'),
    wire('COND_BITS', 'b1', 'g_jz', 'a'),
    wire('ZERO', 'out', 'g_jz', 'b'),
    wire('ZERO', 'out', 'n_zero', 'a'),
    wire('COND_BITS', 'b2', 'g_jnz', 'a'),
    wire('n_zero', 'out', 'g_jnz', 'b'),
    wire('COND_BITS', 'b0', 'inner', 'a'),
    wire('g_jz', 'out', 'inner', 'b'),
    wire('g_jnz', 'out', 'inner', 'c'),
    wire('is_jump', 'out', 'taken', 'a'),
    wire('inner', 'out', 'taken', 'b'),

    // Writing `out` is what ends the program: the halt line freezes the counter
    // on that instruction, `pc_in` feeds the counter its own value while it is
    // held, and the answer stays on `out` through the switch.
    wire('is_move', 'out', 'out_load', 'a'),
    wire('DST_BITS', 'b7', 'out_load', 'b'),
    wire(options.halt === false ? 'off' : 'out_load', 'out', 'HALT', 'in'),
    // `pc_in` READS THE REGISTER FILE DIRECTLY, and deliberately not `moveSource`.
    // A jump's target comes from REG0, which the field 6 cannot name -- the jump's
    // [5:3] is a condition code 0-2, so the mux would pass the register byte
    // anyway -- but a jump's target is a different question from a move's source,
    // and a board that answered one of them with the level's input pin would be
    // conflating two things the ISA keeps apart.
    wire('RF', 'a', 'pc_in', 'a'),
    wire('PC', 'out', 'pc_in', 'b'),
    wire('HALT', 'out', 'pc_in', 'sel'),
    wire(jumpSignal, 'out', 'pc_load', 'a'),
    wire('HALT', 'out', 'pc_load', 'b'),
    // `out` publishes the move source, and it reads the same `moveSource` the
    // write path does. `out_load` already says the instruction is `move|…|out`,
    // so this switch never publishes for a calc, a loadi or a jump; the question
    // it answers is only WHICH byte a move copies, and the answer must not depend
    // on whether the player routed it through a register -- `move|inp|out` is the
    // first thing a player writes on a level whose job is to echo its input, and
    // reading `RF.a` here made that correct-looking program publish 0.
    wire(moveSource.part, moveSource.port, 'out_pin', 'a'),
    wire('out_load', 'out', 'out_pin', 'on'),
    wire('out_pin', 'out', 'OUT', 'in'),
  ];

  return { parts, wires };
}
