import { describe, expect, it } from 'vitest';
import { circuitTools } from '../../src/agent/ops';
import { findTool, runTool, type ToolSpec } from '../../src/agent/tools';
import { makeTestHost, type TestHost } from './host-fixture';

const SIGNAL = new AbortController().signal;

function toolOf(fixture: TestHost, name: string): ToolSpec {
  const spec = findTool(circuitTools(fixture.host), name);
  if (spec === null) throw new Error(`no tool ${name}`);
  return spec;
}

async function call(fixture: TestHost, name: string, args: unknown): Promise<{ ok: boolean; body: any }> {
  const outcome = await runTool(toolOf(fixture, name), JSON.stringify(args), { signal: SIGNAL });
  return { ok: outcome.ok, body: JSON.parse(outcome.text) };
}

describe('placing a part', () => {
  it('puts it on the grid and hands back the id it minted', async () => {
    const fixture = makeTestHost();
    const { ok, body } = await call(fixture, 'place_part', { defId: 'nand', x: 13, y: 29 });
    expect(ok).toBe(true);
    expect(body.result).toEqual({ id: 'i1', defId: 'nand', x: 16, y: 32 });
    expect(fixture.graph.instances).toHaveLength(1);
    expect(fixture.applied).toEqual(['agent add nand']);
    // The command is on the player's own stack, so one Ctrl+Z takes it back.
    expect(fixture.stack.canUndo()).toBe(true);
    fixture.host.undo();
    expect(fixture.graph.instances).toEqual([]);
  });

  it('refuses a type that does not exist, and says what does', async () => {
    const fixture = makeTestHost();
    const { ok, body } = await call(fixture, 'place_part', { defId: 'xor', x: 0, y: 0 });
    expect(ok).toBe(false);
    expect(body.error).toContain('xor');
    expect(body.error).toContain('nand');
    expect(fixture.graph.instances).toEqual([]);
  });

  it('places a level connector under the id the level binds by', async () => {
    // A REAL LEVEL MATCHES ITS PINS BY INSTANCE NAME. A connector dropped as `i1`
    // would sit on the board looking right and never be read -- a circuit that
    // tests as "failed" with no hint why. This is the bug a real session hit.
    const fixture = makeTestHost();
    const { ok, body } = await call(fixture, 'place_part', { defId: 'level_in', x: 40, y: 40 });
    expect(ok).toBe(true);
    expect(body.result.id).toBe('IN_a');
    expect(fixture.graph.instances[0]).toMatchObject({ id: 'IN_a', def: 'level_in' });
    // The width travels with the id: the level declares it, not the caller.
    expect(fixture.graph.instances[0]!.params.width).toBe(1);
    fixture.host.undo();
    expect(fixture.graph.instances).toEqual([]);
  });

  it('names an ordinary part itself, and a spare connector too', async () => {
    const fixture = makeTestHost();
    const first = await call(fixture, 'place_part', { defId: 'level_in', x: 0, y: 0 });
    expect(first.body.result.id).toBe('IN_a');
    // Every pin of the level is placed now, so the next one is an ordinary part.
    const spare = await call(fixture, 'place_part', { defId: 'level_in', x: 160, y: 0 });
    expect(spare.body.result.id).toBe('i1');
  });

  it('mints a fresh id after an undo, rather than reusing a live one', async () => {
    const fixture = makeTestHost();
    await call(fixture, 'place_part', { defId: 'nand', x: 0, y: 0 });
    await call(fixture, 'place_part', { defId: 'not', x: 96, y: 0 });
    const third = await call(fixture, 'place_part', { defId: 'not', x: 192, y: 0 });
    expect(third.body.result.id).toBe('i3');
  });
});

describe('moving a part', () => {
  it('snaps to the grid and can be undone back to where it was', async () => {
    const fixture = makeTestHost();
    await call(fixture, 'place_part', { defId: 'nand', x: 0, y: 0 });
    const { ok, body } = await call(fixture, 'move_part', { id: 'i1', x: 100, y: 100 });
    expect(ok).toBe(true);
    expect(body.result).toEqual({ id: 'i1', x: 104, y: 104 });
    fixture.host.undo();
    expect(fixture.graph.instances[0]).toMatchObject({ x: 0, y: 0 });
  });

  it('refuses an id that is not on the board, and lists the ones that are', async () => {
    const fixture = makeTestHost();
    await call(fixture, 'place_part', { defId: 'nand', x: 0, y: 0 });
    const { ok, body } = await call(fixture, 'move_part', { id: 'i7', x: 0, y: 0 });
    expect(ok).toBe(false);
    expect(body.error).toContain('i7');
    expect(body.error).toContain('i1');
  });
});

describe('wiring two parts together', () => {
  async function twoParts(): Promise<TestHost> {
    const fixture = makeTestHost();
    await call(fixture, 'place_part', { defId: 'nand', x: 0, y: 0 });
    await call(fixture, 'place_part', { defId: 'not', x: 160, y: 0 });
    return fixture;
  }

  it('connects an output to an input', async () => {
    const fixture = await twoParts();
    const { ok, body } = await call(fixture, 'connect_pins', {
      fromInst: 'i1',
      fromPort: 'out',
      toInst: 'i2',
      toPort: 'a',
    });
    expect(ok).toBe(true);
    expect(body.result.wireId).toBe('w1');
    expect(fixture.graph.wires).toHaveLength(1);
    expect(fixture.graph.wires[0]).toMatchObject({
      from: { inst: 'i1', port: 'out' },
      to: { inst: 'i2', port: 'a' },
    });
  });

  it('refuses a pin that does not exist and names the ones that do', async () => {
    const fixture = await twoParts();
    const { ok, body } = await call(fixture, 'connect_pins', {
      fromInst: 'i1',
      fromPort: 'q',
      toInst: 'i2',
      toPort: 'a',
    });
    expect(ok).toBe(false);
    expect(body.error).toContain('q');
    expect(body.error).toContain('out');
    expect(fixture.graph.wires).toEqual([]);
  });

  it('refuses to drive an input from an input', async () => {
    const fixture = await twoParts();
    const { ok, body } = await call(fixture, 'connect_pins', {
      fromInst: 'i1',
      fromPort: 'a',
      toInst: 'i2',
      toPort: 'a',
    });
    expect(ok).toBe(false);
    expect(body.error).toContain('输出引脚');
  });

  it('replaces the wire already driving an input, in one undoable step', async () => {
    const fixture = await twoParts();
    await call(fixture, 'connect_pins', { fromInst: 'i1', fromPort: 'out', toInst: 'i2', toPort: 'a' });
    await call(fixture, 'place_part', { defId: 'not', x: 0, y: 160 });
    await call(fixture, 'connect_pins', { fromInst: 'i3', fromPort: 'out', toInst: 'i2', toPort: 'a' });
    expect(fixture.graph.wires).toHaveLength(1);
    expect(fixture.graph.wires[0]!.from.inst).toBe('i3');
    fixture.host.undo();
    expect(fixture.graph.wires).toHaveLength(1);
    expect(fixture.graph.wires[0]!.from.inst).toBe('i1');
  });

  it('refuses a part wired to itself', async () => {
    const fixture = await twoParts();
    const { ok, body } = await call(fixture, 'connect_pins', {
      fromInst: 'i1',
      fromPort: 'out',
      toInst: 'i1',
      toPort: 'a',
    });
    expect(ok).toBe(false);
    expect(body.error).toContain('反馈');
  });
});

describe('deleting', () => {
  it('takes a part and every wire touching it, and one undo brings all of it back', async () => {
    const fixture = makeTestHost();
    await call(fixture, 'place_part', { defId: 'nand', x: 0, y: 0 });
    await call(fixture, 'place_part', { defId: 'not', x: 160, y: 0 });
    await call(fixture, 'connect_pins', { fromInst: 'i1', fromPort: 'out', toInst: 'i2', toPort: 'a' });
    const { ok, body } = await call(fixture, 'delete_part', { id: 'i2' });
    expect(ok).toBe(true);
    expect(body.result.removedWires).toBe(1);
    expect(fixture.graph.instances.map((inst) => inst.id)).toEqual(['i1']);
    expect(fixture.graph.wires).toEqual([]);
    fixture.host.undo();
    expect(fixture.graph.instances.map((inst) => inst.id).sort()).toEqual(['i1', 'i2']);
    expect(fixture.graph.wires).toHaveLength(1);
  });

  it('deletes a wire by id, and refuses one that is not there', async () => {
    const fixture = makeTestHost();
    await call(fixture, 'place_part', { defId: 'nand', x: 0, y: 0 });
    await call(fixture, 'place_part', { defId: 'not', x: 160, y: 0 });
    await call(fixture, 'connect_pins', { fromInst: 'i1', fromPort: 'out', toInst: 'i2', toPort: 'a' });
    const missing = await call(fixture, 'delete_wire', { wireId: 'w9' });
    expect(missing.ok).toBe(false);
    expect(missing.body.error).toContain('w1');
    const { ok } = await call(fixture, 'delete_wire', { wireId: 'w1' });
    expect(ok).toBe(true);
    expect(fixture.graph.wires).toEqual([]);
    fixture.host.undo();
    expect(fixture.graph.wires).toHaveLength(1);
  });
});

describe('the clock and the test run', () => {
  it('drives the same controls the toolbar has', async () => {
    const fixture = makeTestHost();
    await call(fixture, 'run_circuit', {});
    await call(fixture, 'step_clock', {});
    await call(fixture, 'pause_circuit', {});
    await call(fixture, 'reset_circuit', {});
    expect(fixture.calls).toEqual(['run', 'step', 'pause', 'reset']);
  });

  it('waits for the verdict rather than reporting that a run started', async () => {
    const fixture = makeTestHost();
    fixture.testResult = { ran: true, passed: false, summary: '第 3 个用例不符' };
    const { ok, body } = await call(fixture, 'run_tests', {});
    expect(ok).toBe(true);
    expect(body.result).toEqual({
      ran: true,
      passed: false,
      summary: '第 3 个用例不符',
      failures: [],
    });
  });

  it('hands back WHICH case failed and by how much, which is the whole feedback loop', async () => {
    const fixture = makeTestHost();
    fixture.testResult = {
      ran: true,
      passed: false,
      summary: '未通过：2 个用例不符',
      failures: [
        {
          inputs: {},
          expected: { out: 1 },
          actual: { out: 0 },
          tick: 2,
        },
        {
          inputs: {},
          expected: { out: 1 },
          actual: { out: 0 },
          tick: 3,
        },
      ],
    };
    const { ok, body } = await call(fixture, 'run_tests', {});
    expect(ok).toBe(true);
    expect(body.result.failures[0]).toMatchObject({ tick: 2, expected: { out: 1 }, actual: { out: 0 } });
    // ...and the player's line says the same thing in one sentence.
    const raw = await runTool(
      toolOf(fixture, 'run_tests'),
      '{}',
      { signal: SIGNAL },
    );
    expect(raw.note).toBe('第 2 拍 out 期望 1、实际 0，还有 1 个用例不符');
  });
});

describe('undo and redo as tools', () => {
  it('refuses when there is nothing left to undo', async () => {
    const fixture = makeTestHost();
    const { ok, body } = await call(fixture, 'undo_last', {});
    expect(ok).toBe(false);
    expect(body.error).toContain('撤销');
  });

  it('undoes and redoes through the player’s own history', async () => {
    const fixture = makeTestHost();
    await call(fixture, 'place_part', { defId: 'nand', x: 0, y: 0 });
    await call(fixture, 'undo_last', {});
    expect(fixture.graph.instances).toEqual([]);
    await call(fixture, 'redo_last', {});
    expect(fixture.graph.instances).toHaveLength(1);
  });
});

describe('reading the board', () => {
  it('reports what is there and what the palette offers', async () => {
    const fixture = makeTestHost();
    await call(fixture, 'place_part', { defId: 'nand', x: 0, y: 8 });
    const board = await call(fixture, 'read_board', {});
    expect(board.ok).toBe(true);
    expect(board.body.result.mode).toBe('level');
    expect(board.body.result.parts[0]).toMatchObject({ id: 'i1', def: 'nand', nameZh: '与非门' });

    const parts = await call(fixture, 'list_parts', {});
    // THE WHOLE PALETTE, connectors included: whatever the parts tray offers is
    // what the agent may place, and the level's own connectors are ordinary parts
    // a player drops like any other.
    expect(parts.body.result.map((part: { id: string }) => part.id)).toEqual([
      'nand',
      'not',
      'level_in',
    ]);
    expect(parts.body.result[0].inputs).toEqual([
      { id: 'a', width: 1 },
      { id: 'b', width: 1 },
    ]);
  });
});

describe('components of your own', () => {
  it('selects parts -- which is what puts the ring around them and what a wrap needs', async () => {
    const fixture = makeTestHost();
    await call(fixture, 'place_part', { defId: 'nand', x: 0, y: 0 });
    await call(fixture, 'place_part', { defId: 'not', x: 160, y: 0 });
    const { ok, body } = await call(fixture, 'select_parts', { ids: ['i1', 'i2'] });
    expect(ok).toBe(true);
    expect(body.result.selected).toEqual(['i1', 'i2']);
    expect(fixture.focus).toEqual(['i1', 'i2']);
  });

  it('refuses to select an id that is not on the board', async () => {
    const fixture = makeTestHost();
    const { ok, body } = await call(fixture, 'select_parts', { ids: ['i9'] });
    expect(ok).toBe(false);
    expect(body.error).toContain('i9');
  });

  it('wraps the selection under a name and reports the new component', async () => {
    const fixture = makeTestHost();
    const { ok, body } = await call(fixture, 'wrap_selection', { nameZh: '半加器', nameEn: 'Half adder' });
    expect(ok).toBe(true);
    expect(body.result).toEqual({ id: 'bp2', name: '半加器' });
    expect(fixture.calls).toContain('wrap');
  });

  it('explains a wrap that cannot happen instead of doing nothing', async () => {
    const fixture = makeTestHost();
    fixture.wrapResult = null;
    await call(fixture, 'place_part', { defId: 'nand', x: 0, y: 0 });
    await call(fixture, 'select_parts', { ids: ['i1'] });
    const { ok, body } = await call(fixture, 'wrap_selection', { nameZh: '半加器' });
    expect(ok).toBe(false);
    expect(body.error).toContain('边界');
    expect(body.error).toContain('select_parts');
  });

  it('enters a component, renames it, and leaves again', async () => {
    const fixture = makeTestHost();
    expect((await call(fixture, 'enter_component', { id: 'bp1' })).ok).toBe(true);
    expect((await call(fixture, 'enter_component', { id: 'nope' })).ok).toBe(false);
    expect((await call(fixture, 'rename_component', { id: 'bp1', nameZh: '全加器' })).ok).toBe(true);
    expect((await call(fixture, 'leave_component', {})).ok).toBe(true);
    expect(fixture.calls).toEqual(['enter:bp1', 'enter:nope', 'rename:bp1', 'leave']);
  });

  it('deletes a component, and passes the refusal through when the board uses it', async () => {
    const fixture = makeTestHost();
    expect((await call(fixture, 'delete_component', { id: 'bp1' })).ok).toBe(true);
    fixture.deleteRefused = true;
    const refused = await call(fixture, 'delete_component', { id: 'bp1' });
    expect(refused.ok).toBe(false);
    expect(refused.body.error).toContain('实例');
  });
});

describe('driving the level and the editor', () => {
  it('sets an input pin within its width', async () => {
    const fixture = makeTestHost();
    const one = await call(fixture, 'set_input', { pin: 'a', value: 1 });
    expect(one.ok).toBe(true);
    expect(fixture.driven.a).toBe(1);
    // `b` is four bits wide, so fifteen fits and sixteen does not.
    expect((await call(fixture, 'set_input', { pin: 'b', value: 15 })).ok).toBe(true);
    const tooBig = await call(fixture, 'set_input', { pin: 'b', value: 16 });
    expect(tooBig.ok).toBe(false);
    expect(tooBig.body.error).toContain('4 位');
    const missing = await call(fixture, 'set_input', { pin: 'z', value: 0 });
    expect(missing.ok).toBe(false);
    expect(missing.body.error).toContain('没有输入引脚');
  });

  it('writes the program text on a level that grades one', async () => {
    const fixture = makeTestHost();
    const { ok, body } = await call(fixture, 'set_program', { text: 'LDI 1\nOUT' });
    expect(ok).toBe(true);
    expect(body.result.lines).toBe(2);
    expect(fixture.program).toBe('LDI 1\nOUT');
  });

  it('refuses to write a program where the editor is not mounted', async () => {
    const fixture = makeTestHost();
    fixture.expectsProgram = false;
    const { ok, body } = await call(fixture, 'set_program', { text: 'LDI 1' });
    expect(ok).toBe(false);
    expect(body.error).toContain('不给程序判分');
  });

  it('reports what the board holds: components, inputs, program', async () => {
    const fixture = makeTestHost();
    await call(fixture, 'place_part', { defId: 'nand', x: 0, y: 0 });
    await call(fixture, 'set_input', { pin: 'a', value: 1 });
    await call(fixture, 'set_program', { text: 'NOP' });
    const board = await call(fixture, 'read_board', {});
    expect(board.body.result.components[0]).toMatchObject({ id: 'bp1', instances: 0 });
    expect(board.body.result.inputs).toEqual([
      { id: 'a', width: 1, value: 1 },
      { id: 'b', width: 4, value: 0 },
    ]);
    // What the circuit has to DRIVE: a session that could only see its inputs
    // went looking for the level's output in the wrong place.
    expect(board.body.result.outputs).toEqual([{ id: 'out', width: 1, value: null }]);
    expect(board.body.result.program).toBe('NOP');
    expect(board.body.result.expectsProgram).toBe(true);
  });
});

describe('what the player reads while it works', () => {
  it('says each step in one line, not in JSON', async () => {
    const fixture = makeTestHost();
    const raw = (name: string, args: unknown) =>
      runTool(toolOf(fixture, name), JSON.stringify(args), { signal: SIGNAL });

    expect((await raw('place_part', { defId: 'nand', x: 16, y: 32 })).note).toBe(
      '在 (16, 32) 放了 与非门（i1）',
    );
    await raw('place_part', { defId: 'not', x: 160, y: 32 });
    expect((await raw('connect_pins', { fromInst: 'i1', fromPort: 'out', toInst: 'i2', toPort: 'a' })).note).toBe(
      '把 i1.out 接到 i2.a',
    );
    expect((await raw('delete_part', { id: 'i2' })).note).toBe('删掉 i2，连带 1 根导线');
    expect((await raw('undo_last', {})).note).toBe('撤销一步');
    expect((await raw('select_parts', { ids: ['i1'] })).note).toBe('选中 i1');
    expect((await raw('select_parts', { ids: [] })).note).toBe('清空选择');
    expect((await raw('set_input', { pin: 'b', value: 15 })).note).toBe('把输入 b 设为 15');
  });

  it('says a refusal the same way, so a failure is not a paragraph of braces', async () => {
    const fixture = makeTestHost();
    const outcome = await runTool(
      toolOf(fixture, 'place_part'),
      JSON.stringify({ defId: 'xor', x: 0, y: 0 }),
      { signal: SIGNAL },
    );
    expect(outcome.ok).toBe(false);
    expect(outcome.note).toContain('没有元件类型');
    expect(outcome.note).not.toContain('{');
  });

  it('has a line for every tool, so none of them prints its raw result', () => {
    const fixture = makeTestHost();
    const missing = circuitTools(fixture.host)
      .filter((spec) => spec.present === undefined)
      .map((spec) => spec.name);
    expect(missing).toEqual([]);
  });
});

describe('arguments the model got wrong', () => {
  it('answers a missing required argument with a correction', async () => {
    const fixture = makeTestHost();
    const { ok, body } = await call(fixture, 'place_part', { defId: 'nand', x: 0 });
    expect(ok).toBe(false);
    expect(body.error).toContain('y');
  });

  it('answers a wrong type, an unknown key and broken JSON', async () => {
    const fixture = makeTestHost();
    const spec = toolOf(fixture, 'place_part');
    const wrongType = await runTool(spec, JSON.stringify({ defId: 'nand', x: '0', y: 0 }), { signal: SIGNAL });
    expect(JSON.parse(wrongType.text).error).toContain('数字');
    const unknown = await runTool(spec, JSON.stringify({ defId: 'nand', x: 0, y: 0, z: 1 }), {
      signal: SIGNAL,
    });
    expect(JSON.parse(unknown.text).error).toContain('不认识参数 z');
    const broken = await runTool(spec, '{"defId":', { signal: SIGNAL });
    expect(JSON.parse(broken.text).error).toContain('JSON');
    expect(fixture.graph.instances).toEqual([]);
  });

  it('treats an empty argument string as no arguments', async () => {
    const fixture = makeTestHost();
    const spec = toolOf(fixture, 'read_board');
    const outcome = await runTool(spec, '', { signal: SIGNAL });
    expect(outcome.ok).toBe(true);
  });
});
