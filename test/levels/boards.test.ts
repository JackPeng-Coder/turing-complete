import { describe, expect, it } from 'vitest';
import { BASE_DEFS } from '../../src/core/defs/index';
import { validateGraph } from '../../src/core/graph';
import { Simulation, compile } from '../../src/core/net';
import { portValueToNumber } from '../../src/core/signal';
import { graphFromBoard } from '../../src/levels/board';
import { overtureBoard } from '../../src/levels/boards/overture';
import type { BoardInit } from '../../src/levels/spec';
import { registry } from '../fixtures/build';
import { overtureMachine } from '../fixtures/ch3-references';

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
 * handed slowly stopped being it. So the fixture is built FROM the board, and
 * the comparison at the end of this file states that in one line.
 *
 * WHAT THE INPUT-PORT BLOCK AT THE END ADDS. The chapter-3 machine has no path
 * from a level's input pin to anything a `move` can copy: `move|inp|dN` reads
 * code 6, which names `inp` in the ISA and is a register the six-register file
 * does not have, so the bank publishes 0. Chapter 3 never notices -- its
 * programs are straight lines and loops over the registers -- but every
 * chapter-4 level reads its input, so `overtureBoard({ inputId })` carries the
 * connector and the select that make that read real. The acceptance for it is
 * behavioural: one program, two boards, and only the wired one publishes the
 * byte the level wrote.
 */

/**
 * Runs `move|inp|d1` / `move|s1|out` against a board and returns the byte `OUT`
 * presents once the machine has halted.
 *
 * IT DRIVES THE BOARD THE WAY A CHECK DOES (`bindLevelIo` in
 * `levels/checks.ts`): a level input is written at its own OUTPUT pin
 * (`net.outputBase('IN_in.out')`) and a level output is read at its INPUT pin
 * (`net.inputBase('OUT.in')`), both through the signal table. The program image
 * is loaded AFTER `reset()` because the image is kernel state and `reset()`
 * clears it -- the ordering `runChecks` documents at its own program branch.
 *
 * The plain board has no `IN_in` pin to drive, so that write is skipped: the two
 * runs then differ in exactly one thing, which is what the pair of tests below
 * claims.
 */
function publishThroughOut(board: BoardInit, input: number): number {
  const graph = graphFromBoard('x', board);
  const net = compile(graph, registry);
  const sim = new Simulation(net, registry);
  const ram = graph.instances.find((inst) => inst.def === 'ram_prog');
  if (ram === undefined) {
    throw new Error('the OVERTURE board has no ram_prog to load a program into');
  }
  sim.reset();
  // 0xB1 is `move|inp|d1` and 0x8F is `move|s1|out`, hand-encoded from ruling 5's
  // `10 sss ddd`: 0b10_110_001 and 0b10_001_111.
  sim.loadImage(ram.id, [0xb1, 0x8f]);
  if (net.outputKeys().includes('IN_in.out')) sim.write(net.outputBase('IN_in.out'), 8, input);
  sim.settle();
  // Two edges are enough -- the first writes REG1, the second publishes it and
  // halts the counter -- and four leave the answer visibly HELD rather than
  // caught on the edge that produced it.
  for (let tick = 0; tick < 4; tick += 1) sim.tick();
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

  it('is the very circuit the chapter-3 fixture grades', () => {
    // The anti-drift claim, and the reason the fixture no longer builds its own
    // machine: both readers now go through `overtureBoard()`.
    expect(overtureMachine()).toEqual(graphFromBoard('ref', overtureBoard()));
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

  it('carries the level input pin, and the three parts that put it on the source path', () => {
    const plain = overtureBoard();
    const wired = overtureBoard({ inputId: 'in' });
    // FOUR more parts, and each one is named, because "the board gained a part"
    // is only checkable if the count and the reason are stated together: the
    // level's own connector (`IN_in`), the `maker` holding the byte 6, the
    // `equal8` asking whether the instruction's [5:3] field is that byte, and
    // the `mux8` that chooses between the register file and the input. The
    // connector is the part a level author sees; the other three are what make
    // it reach the register file at all.
    expect(wired.parts).toHaveLength(plain.parts.length + 4);
    // THIRTEEN MORE WIRES, and the arithmetic is the point: fourteen join the
    // four new parts -- eight for the byte constant, two into the comparator, and
    // four for the value mux and its select -- and one is REPLACED, because
    // `d1`'s `a` now reads the mux instead of the register file. Pinned so a part
    // added without a wire, or a wire that landed on the wrong pin, is visible
    // here and not only in the behaviour at the end of this block.
    expect(wired.wires).toHaveLength(plain.wires.length + 13);

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
    // And the select is a field test: an `equal8`, whose answer is 1 exactly when
    // the source field is the constant the board holds.
    const select = graph.wires.find(
      (wire) => wire.to.inst === inputMux?.id && wire.to.port === 'sel',
    );
    expect(graph.instances.find((inst) => inst.id === select?.from.inst)?.def).toBe('equal8');
  });

  it('reports no structural error and compiles', () => {
    const graph = graphFromBoard('x', overtureBoard({ inputId: 'in' }));
    expect(validateGraph(graph, registry).filter((issue) => issue.severity === 'error')).toEqual([]);
    expect(() => compile(graph, registry)).not.toThrow();
  });

  it('publishes the level input through the machine', () => {
    // THE ACCEPTANCE. `move|inp|d1` copies the level's byte into REG1 and
    // `move|s1|out` publishes it, so a chapter-4 level's `program` check sees the
    // value it wrote on its own `in` pin.
    expect(publishThroughOut(overtureBoard({ inputId: 'in' }), 0x2a)).toBe(0x2a);
  });

  it('publishes zero for the same program on the plain board', () => {
    // The negative control, and the reason the test above is evidence: without
    // the input path the same two instructions read code 6 out of the register
    // file, which publishes 0 for a register it does not have. A machine that
    // always answered 0x2a -- or one whose `out` never rose -- would fail here.
    expect(publishThroughOut(overtureBoard(), 0x2a)).toBe(0);
  });
});
