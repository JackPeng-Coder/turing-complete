import { describe, expect, it } from 'vitest';
import { BASE_DEFS } from '../../src/core/defs/index';
import { validateGraph } from '../../src/core/graph';
import { compile } from '../../src/core/net';
import { graphFromBoard } from '../../src/levels/board';
import { overtureBoard } from '../../src/levels/boards/overture';
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
 */

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
