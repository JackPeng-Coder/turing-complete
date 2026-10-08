import { describe, expect, it } from 'vitest';
import { OVERTURE_ISA, assemble } from '../../src/asm';
import { BASE_DEFS } from '../../src/core/defs/index';
import { validateGraph } from '../../src/core/graph';
import { Simulation, compile, delayOf } from '../../src/core/net';
import { portValueToNumber } from '../../src/core/signal';
import { graphFromBoard } from '../../src/levels/board';
import { overtureBoard } from '../../src/levels/boards/overture';
import { gateCost } from '../../src/levels/grader';
import type { BoardInit } from '../../src/levels/spec';
import { registry } from '../fixtures/build';

/**
 * The board a level ships: a starting circuit written as level data, and the
 * reader that turns that data back into an editable graph.
 *
 * WHY THE TWO ARE SEPARATE. Level data is data -- the rule that lets a level be
 * stored, migrated and compared -- so a level cannot carry a function that
 * builds its circuit. `BoardInit` is therefore parts and wires, and
 * `graphFromBoard` is the one function that reads them. A wire names its ends by
 * PART INDEX rather than by instance id because the ids do not exist when the
 * data is written: the graph names its parts `i1`, `i2`, ... the moment it is
 * built, exactly as the editor would have named them.
 *
 * WHAT THIS FILE IS ACTUALLY GUARDING. Chapter 4's levels open on the machine
 * chapter 3 taught the player to build, and the same machine is chapter 3's
 * reference solution (`overtureMachine` in `test/fixtures/ch3-references.ts`).
 * Two copies of that circuit would be free to drift, and the drift would read as
 * a pass -- the reference would keep grading green while the board the player is
 * handed slowly stopped being it. So the fixture is built FROM the board: there
 * is one builder (`overtureBoard`) and two readers, and no second copy exists to
 * drift in the first place.
 *
 * THAT SHARING IS NOT ITSELF EVIDENCE, and this file does not pretend it is.
 * `overtureMachine()` IS `graphFromBoard('ref', overtureBoard())`, so an
 * assertion that the two are equal can only fail on non-determinism, which the
 * block above already covers. What carries the weight is the numbers and the
 * behaviour: the plain board's 42 instances and 95 wires below (a board that
 * quietly lost a part would still compile, and the level's three-star target
 * would move with it), the wired board's measured 675 gates, the input path's
 * behavioural acceptance, and -- one file over -- chapter 3's own three-star
 * targets ({643, 6, 95}) and ticked walks in `test/levels/ch3-batch3.test.ts`,
 * which grade this board's machine and would notice a wire that moved.
 *
 * WHAT THE INPUT-PORT BLOCK AT THE END ADDS. The chapter-3 machine has no path
 * from a level's input pin to anything a `move` can copy: `move|inp|dN` reads
 * code 6, which names `inp` in the ISA and is a register the six-register file
 * does not have, so the bank publishes 0. Chapter 3 never notices -- its
 * programs are straight lines and loops over the registers -- but every
 * chapter-4 level reads its input, so `overtureBoard({ inputId })` carries the
 * connector and the mux that make that read real, on both paths a `move`'s
 * source byte travels: the register file's write data and the `out` switch.
 * The acceptance is behavioural: one program, two boards, and only the wired one
 * publishes the byte the level wrote -- asserted for the register-routed
 * `move|inp|dN` / `move|sN|out` pair and for the register-free `move|inp|out`.
 */

/**
 * The image of `source`, from the project's own assembler.
 *
 * `asm/isa.ts` is the single authority on the instruction encoding, so a
 * behavioural test that hand-encoded its own words could agree with a machine
 * that had the field order wrong. A program that will not assemble is a broken
 * test rather than a failing board, so it throws here instead of running.
 */
function image(source: string): readonly number[] {
  const result = assemble(source, OVERTURE_ISA);
  const first = result.errors[0];
  if (first !== undefined) throw new Error(`the test program does not assemble: ${first.reason}`);
  return result.bytes;
}

/** `move|inp|d1` / `move|s1|out`: the level's byte routed through REG1. */
const VIA_REGISTER = image('move|inp|d1\nmove|s1|out');

/** `move|inp|out`: the level's byte published with no register in between. */
const STRAIGHT_OUT = image('move|inp|out');

/** `loadi|42` / `move|s0|out`: a byte loaded into REG0 and published from there. */
const FROM_REGISTER = image('loadi|42\nmove|s0|out');

/**
 * Chapter 3's countdown program, as the bytes `test/levels/ch3-batch3.test.ts`
 * already pins.
 *
 * Copied rather than assembled, because the point of the test that drives it is
 * that a WIRED board runs the level's own program to the level's own answer: an
 * assembler change would have to move both files together, and the bytes are the
 * encoding the machine is graded against today. It is the do-while loop that
 * counts down from 6 and accumulates, so its answer is 21 = 6 + 5 + 4 + 3 + 2 + 1
 * -- a byte no single instruction in it writes.
 */
const COUNTDOWN = [
  0x06, 0x81, 0x8d, 0xa1, 0xaa, 0x40, 0x9c, 0xa9, 0x01, 0x82, 0x48, 0x99, 0x10, 0xc8, 0x02, 0xc0,
  0xa7,
] as const;

/**
 * Runs `program` against a board, with `input` driven onto the board's level
 * input pin where it has one, and returns the byte `OUT` presents once the
 * machine has halted.
 *
 * IT DRIVES THE BOARD THE WAY A CHECK DOES (`bindLevelIo` in
 * `levels/checks.ts`): a level input is written at its own OUTPUT pin
 * (`net.outputBase('IN_in.out')`) and a level output is read at its INPUT pin
 * (`net.inputBase('OUT.in')`), both through the signal table. The program image
 * is loaded AFTER `reset()` because the image is kernel state and `reset()`
 * clears it -- the ordering `runChecks` documents at its own program branch.
 *
 * The plain board has no `IN_in` pin to drive, so that write is skipped: the two
 * runs then differ in exactly one thing, which is what each pair of tests below
 * claims.
 *
 * `ticks` DEFAULTS TO THE TWO-INSTRUCTION CASE. Two edges are enough for such a
 * program -- the first executes the instruction that produces the byte, the
 * second publishes it and halts the counter -- and four leave the answer visibly
 * HELD rather than caught on the edge that produced it. A longer program states
 * its own count, copied from the walk that already fixes it, because only that
 * program's own level knows where its exit lands.
 */
function publishThroughOut(
  board: BoardInit,
  program: readonly number[],
  input: number,
  ticks = 4,
): number {
  const graph = graphFromBoard('x', board);
  const net = compile(graph, registry);
  const sim = new Simulation(net, registry);
  const ram = graph.instances.find((inst) => inst.def === 'ram_prog');
  if (ram === undefined) {
    throw new Error('the OVERTURE board has no ram_prog to load a program into');
  }
  sim.reset();
  sim.loadImage(ram.id, program);
  if (net.outputKeys().includes('IN_in.out')) sim.write(net.outputBase('IN_in.out'), 8, input);
  sim.settle();
  for (let tick = 0; tick < ticks; tick += 1) sim.tick();
  return portValueToNumber(sim.read(net.inputBase('OUT.in'), 8));
}

describe('graphFromBoard', () => {
  it('turns the OVERTURE board into the machine chapter 3 measured', () => {
    // 42 instances is 40 parts plus the level's clock input and its output
    // connector; 95 wires is the same count the reference machine has always
    // had. Both are pinned because a board that quietly lost a part would still
    // compile, and the level's three-star target would move with it.
    const graph = graphFromBoard('x', overtureBoard());
    expect(graph.instances).toHaveLength(42);
    expect(graph.wires).toHaveLength(95);
    expect(graph.level).toBe('x');
  });

  it('names the level connectors the way bindLevelIo looks for them', () => {
    // `IN_<pin>` and `OUT` are not decoration: `levels/checks.ts` binds a level's
    // pins by instance id, so a board whose connectors were left unnamed --
    // `i1` and `i42` -- would grade as `missing-io` however correct its wiring
    // was.
    const graph = graphFromBoard('x', overtureBoard());
    const clk = graph.instances.find((inst) => inst.id === 'IN_clk');
    expect(clk?.def).toBe('level_input');
    const out = graph.instances.find((inst) => inst.id === 'OUT');
    expect(out?.def).toBe('level_output');
    // The machine publishes a byte, and `bindLevelIo` refuses a connector
    // compiled at a width other than the level's, so the width is part of the
    // board rather than something the level can fix from outside.
    expect(out?.params.width).toBe(8);
  });

  it('uses only component defs the kernel registers', () => {
    const known = new Set(BASE_DEFS.map((def) => def.id));
    for (const inst of graphFromBoard('x', overtureBoard()).instances) {
      expect(known.has(inst.def), `${inst.id} is a ${inst.def}, which BASE_DEFS does not register`).toBe(
        true,
      );
    }
  });

  it('reports no structural error', () => {
    const issues = validateGraph(graphFromBoard('x', overtureBoard()), registry);
    // Errors only. The counter's own loop -- PC -> RAM -> decoder -> the jump
    // glue -> pc_in -> PC -- is a `feedback-loop` WARNING, which is what
    // `validateGraph` says about every loop: it is legal exactly when a storage
    // element is in it, so only the simulator can settle that, and the machine
    // has a `pc8` in the loop by construction.
    expect(issues.filter((issue) => issue.severity === 'error')).toEqual([]);
  });

  it('compiles', () => {
    expect(() => compile(graphFromBoard('x', overtureBoard()), registry)).not.toThrow();
  });

  it('refuses a wire that names a part the board does not have', () => {
    // A wire is resolved through the part list, and level data is hand-authored:
    // a pair of indices off by one is the ordinary typo, and the alternative to
    // refusing it is a wire to `undefined` that `validateGraph` reports as a
    // missing instance with no clue which board was wrong. The message names the
    // index so the typo is findable, and it is a THROW rather than a returned
    // issue because a malformed board is not a circuit a player can grade.
    const board: BoardInit = {
      parts: [{ def: 'const_on', x: 0, y: 0 }],
      wires: [
        { from: { part: 0, port: 'out' }, to: { part: 1, port: 'a' } },
      ],
    };
    expect(() => graphFromBoard('x', board)).toThrow(/part 1/);
  });
});

describe('the OVERTURE board is plain, deterministic data', () => {
  it('is the same board on every call', () => {
    // Determinism, stated the way the grader needs it: no clock, no counter, no
    // `Math.random()` -- two opens of the same level are the same circuit.
    expect(overtureBoard()).toEqual(overtureBoard());
  });

  it('survives a round trip through JSON', () => {
    // `BoardInit` may hold numbers, strings and arrays and nothing else. A
    // function or a class instance smuggled in as a part would not survive this,
    // and could not be stored in level data at all.
    const board = overtureBoard();
    expect(JSON.parse(JSON.stringify(board))).toEqual(board);
  });
});

describe('the OVERTURE board with a level input', () => {
  it('leaves the chapter-3 machine alone when no input is asked for', () => {
    // The option must be the ONLY difference between the two boards: chapter 3's
    // three machine levels -- and every three-star target measured from them --
    // read this board with no options at all, so a select that was wired in
    // unconditionally would move the machine under them.
    const graph = graphFromBoard('x', overtureBoard());
    expect(graph.instances).toHaveLength(42);
    expect(graph.wires).toHaveLength(95);
    expect(graph.instances.map((inst) => inst.id)).not.toContain('IN_in');
  });

  it('measures 675 gates, against the plain board the chapter-3 targets were taken from', () => {
    // THE NUMBER CHAPTER 4'S TARGETS COME FROM, and the one metric this board
    // owns rather than inherits. The plain machine is level 49's measured 643
    // gates and 6 deep, which is what chapter 3's three-star targets quote; the
    // option adds exactly one part that costs anything, the `mux8` at 32 NAND
    // equivalents (`level_input` is a connector, 0 gates), so the wired board
    // measures 675. Pinned here because a board whose mux were doubled, or whose
    // select had been built from a comparator instead of the decode line, would
    // still compile and still pass every behavioural test below while moving
    // every chapter-4 three-star target with it -- and it is exactly the number
    // `boards/overture.ts` quotes when it explains why the comparator was
    // reverted.
    expect(gateCost(graphFromBoard('x', overtureBoard()), registry)).toBe(643);
    expect(gateCost(graphFromBoard('x', overtureBoard({ inputId: 'in' })), registry)).toBe(675);
    // The delay metric does not move, in either shape: the mux stands in the
    // source path at the depth the register-file read already had, and where the
    // comparator would have stood too.
    expect(delayOf(graphFromBoard('x', overtureBoard()), registry)).toBe(6);
    expect(delayOf(graphFromBoard('x', overtureBoard({ inputId: 'in' })), registry)).toBe(6);
  });

  it('carries the level input pin, and the one part that puts it on the source path', () => {
    const wired = overtureBoard({ inputId: 'in' });
    // TWO more parts than the plain board's 42, and each one is named, because
    // "the board gained a part" is only checkable if the count and the reason are
    // stated together: the level's own connector (`IN_in`) and the `mux8` that
    // chooses between the register file's byte and the level's. The connector is
    // the part a level author sees; the mux is what makes it reach the register
    // file's write path (and the `out` switch) at all. Nothing else is bought:
    // the select is the machine's own condition decode, which the board already
    // carries.
    expect(wired.parts).toHaveLength(44);
    // THREE MORE WIRES than the plain board's 95, and the arithmetic is the
    // point: of the five wires that join the two new parts -- the two data inputs
    // into the value mux (`RF.a` and `IN.out`), its select from the condition
    // decoder's `b6` line, and its output into both `d1` and the `out` switch --
    // two REPLACE a wire each, because `d1`'s `a` and `out_pin`'s `a` now read
    // that mux instead of the register file directly. Pinned so a part added
    // without a wire, or a wire that landed on the wrong pin, is visible here and
    // not only in the behaviour at the end of this block.
    expect(wired.wires).toHaveLength(98);

    const graph = graphFromBoard('x', wired);
    // The clock connector survives the option, and the input joins it: both are
    // pins the LEVEL owns, and `bindLevelIo` finds them by these ids.
    expect(
      graph.instances.filter((inst) => inst.def === 'level_input').map((inst) => inst.id),
    ).toEqual(['IN_clk', 'IN_in']);
    const pin = graph.instances.find((inst) => inst.id === 'IN_in');
    expect(pin?.params.width).toBe(8);
    // The width is a claim about the COMPILED pin, not about the board data:
    // `bindLevelIo` compares `net.outputWidth('IN_in.out')` against the level's
    // own `io.inputs` and refuses to bind a pin that disagrees, so a level
    // declaring an 8-bit input needs the instance to say 8.
    expect(compile(graph, registry).outputWidth('IN_in.out')).toBe(8);
  });

  it('makes the level input an alternative VALUE for a move, never a register index', () => {
    const graph = graphFromBoard('x', overtureBoard({ inputId: 'in' }));
    // One consumer, and it is a mux: the input byte is one of the two things
    // `d1` can be handed, so it can only ever be a byte a `move` copies -- not
    // an address the register file would read. `b` is that mux's sel = 1 input.
    const consumers = graph.wires.filter((wire) => wire.from.inst === 'IN_in');
    expect(consumers).toHaveLength(1);
    expect(consumers[0]?.to.port).toBe('b');
    const inputMux = graph.instances.find((inst) => inst.id === consumers[0]?.to.inst);
    expect(inputMux?.def).toBe('mux8');
    // The other data input is the register file's `a` port -- the byte a `move`
    // copies today -- so the mux is inserted IN that path rather than beside it.
    const rf = graph.instances.find((inst) => inst.def === 'regfile6');
    const fedByRegisterFile = (wire: (typeof graph.wires)[number]): boolean =>
      wire.from.inst === rf?.id &&
      wire.from.port === 'a' &&
      wire.to.inst === inputMux?.id &&
      wire.to.port === 'a';
    expect(graph.wires.some(fedByRegisterFile)).toBe(true);
    // And the select is the machine's own field decode, not a second reading of
    // the instruction word: the wire into the mux's `sel` is the `b6` line of the
    // splitter on the CONDITION decoder. That decoder is the `decoder3` the
    // jump's `jz`/`jnz` lines come from, and it decodes `DEC.op` -- the very
    // [5:3] slice `DEC.src` names -- so its `b6` line IS "the source field is 6",
    // computed for the jump glue already. A comparator here would say the same
    // thing for 54 NAND equivalents more: the wired board's whole gate metric is
    // 675 with this line and was 729 with a comparator. The delay metric does not
    // move either way, because the comparator stood at the same depth as the
    // decode it duplicated.
    const select = graph.wires.find(
      (wire) => wire.to.inst === inputMux?.id && wire.to.port === 'sel',
    );
    expect(select?.from.port).toBe('b6');
    const conditionBits = graph.instances.find((inst) => inst.id === select?.from.inst);
    expect(conditionBits?.def).toBe('splitter');
    const decoded = graph.wires.find(
      (wire) => wire.to.inst === conditionBits?.id && wire.to.port === 'in',
    );
    expect(graph.instances.find((inst) => inst.id === decoded?.from.inst)?.def).toBe('decoder3');
    const field = graph.wires.find(
      (wire) => wire.to.inst === decoded?.from.inst && wire.to.port === 'sel',
    );
    expect(field?.from.port).toBe('op');
    expect(graph.instances.find((inst) => inst.id === field?.from.inst)?.def).toBe('instr_decoder');
    // And nothing was bought to say it: the wired board holds exactly the one
    // `equal8` the plain board's jump glue already had, so the option adds no
    // comparator anywhere.
    expect(graph.instances.filter((inst) => inst.def === 'equal8')).toHaveLength(1);
  });

  it('reports no structural error and compiles', () => {
    const graph = graphFromBoard('x', overtureBoard({ inputId: 'in' }));
    expect(validateGraph(graph, registry).filter((issue) => issue.severity === 'error')).toEqual([]);
    expect(() => compile(graph, registry)).not.toThrow();
  });

  it('publishes the level input through the machine', () => {
    // THE ACCEPTANCE FOR THE WRITE PATH. `move|inp|d1` copies the level's byte
    // into REG1 and `move|s1|out` publishes it, so a chapter-4 level's `program`
    // check sees the value it wrote on its own `in` pin.
    expect(publishThroughOut(overtureBoard({ inputId: 'in' }), VIA_REGISTER, 0x2a)).toBe(0x2a);
  });

  it('publishes zero for the same program on the plain board', () => {
    // The negative control, and the reason the tests above are evidence: without
    // the input path these instructions read code 6 out of the register file,
    // which publishes 0 for a register it does not have. A machine that always
    // answered 0x2a -- or one whose `out` never rose -- would fail here.
    expect(publishThroughOut(overtureBoard(), VIA_REGISTER, 0x2a)).toBe(0);
  });

  it('encodes the programs this block drives the way the machine reads them', () => {
    // The three images, pinned as bytes as well as through the assembler above:
    // `move` is mode 10, `inp` is source code 6, `out` is destination code 7 and
    // `d1` is destination code 1, so `move|inp|out` is 0b10_110_111 = 0xB7,
    // `move|inp|d1` is 0xB1 and `move|s1|out` is 0x8F. `loadi|42` is its
    // immediate (0x2A, mode 00) and `move|s0|out` is 0x87.
    expect(STRAIGHT_OUT).toEqual([0xb7]);
    expect(VIA_REGISTER).toEqual([0xb1, 0x8f]);
    expect(FROM_REGISTER).toEqual([0x2a, 0x87]);
  });

  it('publishes the level input with no register in between', () => {
    // THE ACCEPTANCE FOR THE `out` PATH, and the first instruction a player is
    // likely to write on a level whose job is to echo its input: `move|inp|out`
    // copies the level's byte straight to the port, through no register at all.
    // A board whose `out` switch read the register file directly published 0 for
    // that correct-looking program, which is the trap this test keeps shut.
    expect(publishThroughOut(overtureBoard({ inputId: 'in' }), STRAIGHT_OUT, 0x5c)).toBe(0x5c);
  });

  it('publishes zero for `move|inp|out` on the plain board', () => {
    // The same negative control, and it is not redundant with the register-routed
    // pair: this program never touches a register, so the only thing that can put
    // 0x5c on `out` is a board that carries the input path.
    expect(publishThroughOut(overtureBoard(), STRAIGHT_OUT, 0x5c)).toBe(0);
  });

  it('still publishes a register through `move|sX|out`', () => {
    // The other direction, and what keeps the `out` path honest: this instruction
    // names REG0 in its source field, so the byte that reaches the port is the
    // one `loadi|42` wrote -- the level's input pin holds something else, and a
    // board whose `out` switch had been wired to the input rather than to the
    // source mux, or whose select ignored the field, would answer 0x5c.
    expect(publishThroughOut(overtureBoard({ inputId: 'in' }), FROM_REGISTER, 0x5c)).toBe(42);
  });

  it('leaves a `loadi` alone even when its immediate looks like the source field 6', () => {
    // THE SELECT CANNOT REACH AN IMMEDIATE, which is the reserved reading the
    // source path's comment depends on. `loadi|50` is 0x32: mode 00, and an
    // immediate whose [5:3] bits are 110 -- field 6 -- so the mux really does
    // pass the level's byte while this instruction is being looked at. The write
    // data is chosen downstream at `data`, where `is_loadi` takes the immediate,
    // so REG0 gets 50 and `move|s0|out` publishes 50 rather than the input pin's
    // 0x5c.
    const immediate = image('loadi|50\nmove|s0|out');
    expect(immediate).toEqual([0x32, 0x87]);
    expect(publishThroughOut(overtureBoard({ inputId: 'in' }), immediate, 0x5c)).toBe(50);
  });

  it('publishes zero for a `calc` whose op field is the reserved code 6', () => {
    // THE SAFETY ARGUMENT FOR THE SELECT, SPELLED AS BYTES. The mux passes the
    // level's input whenever the instruction's [5:3] field is 6 -- and for a
    // `calc` that field is the OPERATION, not a source. Codes 6 and 7 are
    // reserved and `alu8` publishes 0 for them, so a `calc` with op 6 is the one
    // instruction whose write path sees the input byte at `d1`'s `a` and still
    // must not publish it: `d1`'s select is `is_calc`, so the ALU's byte wins,
    // and the `data` mux passes it because `is_loadi` is low. The assembler
    // cannot write this word -- there is no mnemonic for op 6 -- which is why the
    // helper takes raw bytes: 0x70 is mode 01 with op 110 and reserved 000, and
    // 0x9F is `move|s3|out`, so a board that let the input reach the write data,
    // or an ALU that answered a reserved op with anything but 0, would publish
    // 0x2a here.
    expect(publishThroughOut(overtureBoard({ inputId: 'in' }), [0x70, 0x9f], 0x2a)).toBe(0);
  });

  it('still runs chapter 3\'s countdown program to 21 on the wired board', () => {
    // THE REGRESSION THE MUX COULD HAVE CAUSED, on the program chapter 3 is
    // graded by. `pc_in` and `pc_load` are the jump plumbing, and the mux was
    // deliberately kept out of them: a jump takes its target from REG0 and its
    // condition from REG3, and `moveSource` answers only the question "which byte
    // does a move copy". A board that had routed the counter's load or its next
    // value through the mux would take a different branch here -- and the level's
    // own walk pins the answer to 21 = 6 + 5 + 4 + 3 + 2 + 1, which no single
    // instruction in the program writes and no constant produces. Tick 95 is that
    // walk's last step, one edge past the loop's exit, so the byte is asserted
    // after the machine has stopped as well as when it lands.
    expect(publishThroughOut(overtureBoard({ inputId: 'in' }), COUNTDOWN, 0x5c, 95)).toBe(21);
    // The plain board is not a control here -- chapter 3's machine runs this
    // program today -- so the same run is stated once, on the wired board, which
    // is the shape chapter 4 ships.
  });
});
