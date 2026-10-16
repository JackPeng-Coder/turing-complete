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

  it('refuses level plumbing, which the level places itself', async () => {
    const fixture = makeTestHost();
    const { ok, body } = await call(fixture, 'place_part', { defId: 'level_in', x: 0, y: 0 });
    expect(ok).toBe(false);
    expect(body.error).toContain('关卡');
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
    expect(body.result).toEqual({ ran: true, passed: false, summary: '第 3 个用例不符' });
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
    expect(parts.body.result.map((part: { id: string }) => part.id)).toEqual(['nand', 'not']);
    expect(parts.body.result[0].inputs).toEqual([
      { id: 'a', width: 1 },
      { id: 'b', width: 1 },
    ]);
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
