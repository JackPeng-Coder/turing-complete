/**
 * A host built out of real parts, for the agent tests.
 *
 * `apply` runs the command against a real `Graph` through a real `CommandStack`,
 * so a test asserting "the agent's edit can be undone" is asserting it about the
 * same undo the player has, not about a stub that happens to return true. The
 * rest of the host is deliberately plain: the clock, the test run and the file
 * are the app's business, and a test that wanted them would be a test of
 * `main.ts`.
 */
import { CommandStack } from '../../src/app/commands';
import { emptyGraph, type Graph } from '../../src/core/graph';
import type { AgentHost, BoardSnapshot, PartInfo } from '../../src/agent/host';

export interface TestHost {
  readonly host: AgentHost;
  readonly graph: Graph;
  readonly stack: CommandStack;
  /** Command labels applied through `apply`, in order. */
  readonly applied: string[];
  /** Whatever `apply` was told to select last. */
  readonly focus: string[];
  readonly calls: string[];
  /** Overrides the test run's answer. */
  testResult: { ran: boolean; passed: boolean | null; summary: string; failures?: readonly { inputs: Record<string, number>; expected: Record<string, number>; actual: Record<string, number>; tick: number }[] };
  /**
   * The connector ids the fixture hands out, by def id.
   *
   * A real level binds `IN_a` and `OUT` by name, so the fixture can too -- which
   * is what makes "a connector placed through the agent binds to the level" a
   * testable claim rather than a comment.
   */
  connectors: Record<string, { id: string; width: number }>;
  /** The components the fixture pretends the player has built. */
  componentIds: string[];
  /** What `wrapSelection` returns; `null` is the refusal `planWrap` would give. */
  wrapResult: string | null;
  /** When true, `deleteComponent` refuses the way a referenced component does. */
  deleteRefused: boolean;
  /** The values `setInput` has driven, by pin id. */
  readonly driven: Record<string, number>;
  /** The last text `setProgram` was given. */
  program: string;
  /** Whether the level grades a program, i.e. whether the editor is mounted. */
  expectsProgram: boolean;
}

const PARTS: readonly PartInfo[] = [
  {
    id: 'nand',
    nameZh: '与非门',
    nameEn: 'NAND',
    category: 'logic1',
    hidden: false,
    inputs: [
      { id: 'a', width: 1 },
      { id: 'b', width: 1 },
    ],
    outputs: [{ id: 'out', width: 1 }],
  },
  {
    id: 'not',
    nameZh: '非门',
    nameEn: 'NOT',
    category: 'logic1',
    hidden: false,
    inputs: [{ id: 'a', width: 1 }],
    outputs: [{ id: 'out', width: 1 }],
  },
  {
    id: 'level_in',
    nameZh: '关卡输入',
    nameEn: 'Level input',
    category: 'level',
    hidden: true,
    inputs: [],
    outputs: [{ id: 'out', width: 1 }],
  },
];

/**
 * What the fixture lets a test change about the host.
 *
 * `parts` is the palette the assistant may place. It defaults to the three-part
 * stub above; a test about a SHIPPED level's palette passes the level's own list,
 * which is how `test/agent/palette.test.ts` asserts that a withheld answer is
 * withheld from the model too.
 */
export interface HostOptions {
  readonly parts?: readonly PartInfo[];
}

export function makeTestHost(options: HostOptions = {}): TestHost {
  const palette: readonly PartInfo[] = options.parts ?? PARTS;
  const graph = emptyGraph('test-level');
  const stack = new CommandStack();
  const applied: string[] = [];
  const focus: string[] = [];
  const calls: string[] = [];
  const fixture: TestHost = {
    graph,
    stack,
    applied,
    focus,
    calls,
    testResult: { ran: true, passed: true, summary: '全部用例通过' },
    connectors: { level_output: { id: 'OUT', width: 1 }, level_in: { id: 'IN_a', width: 1 } },
    componentIds: ['bp1'],
    wrapResult: 'bp2',
    deleteRefused: false,
    driven: {},
    program: '',
    expectsProgram: true,
    host: {
      graph: () => graph,
      parts: () => palette,
      snapshot: (): BoardSnapshot => ({
        mode: 'level',
        dev: false,
        level: { id: 'test-level', nameZh: '测试关', nameEn: 'Test level' },
        editing: null,
        parts: graph.instances.map((inst) => ({
          id: inst.id,
          def: inst.def,
          nameZh: palette.find((part) => part.id === inst.def)?.nameZh ?? inst.def,
          x: inst.x,
          y: inst.y,
          params: inst.params,
        })),
        wires: graph.wires.map((wire) => ({ id: wire.id, from: wire.from, to: wire.to })),
        selected: focus,
        running: calls.includes('run'),
        testing: false,
        metrics: null,
        grade: null,
        issues: [],
        status: null,
        briefZh: null,
        components: fixture.componentIds.map((id) => ({
          id,
          nameZh: `元件${id}`,
          nameEn: id,
          inputs: ['a'],
          outputs: ['out'],
          instances: graph.instances.filter((inst) => inst.def === id).length,
        })),
        inputs: [
          { id: 'a', width: 1, value: fixture.driven.a ?? 0 },
          { id: 'b', width: 4, value: fixture.driven.b ?? 0 },
        ],
        program: fixture.program,
        expectsProgram: fixture.expectsProgram,
        outputs: [{ id: 'out', width: 1, value: null }],
      }),
      // The board's real grid, so a test that checks snapping checks the number
      // the theme actually uses.
      snap: (x, y) => ({ x: Math.round(x / 8) * 8, y: Math.round(y / 8) * 8 }),
      connectorFor: (defId) => {
        const connector = fixture.connectors[defId];
        if (connector === undefined) return null;
        // Once placed, the level has no more of that pin -- the same `undefined`
        // the real `levelIoPlacement` gives a hand.
        return graph.instances.some((inst) => inst.id === connector.id) ? null : connector;
      },
      apply: (command, ids) => {
        stack.push(command, graph);
        applied.push(command.label);
        focus.length = 0;
        if (ids) focus.push(...ids);
      },
      undo: () => stack.undo(graph),
      redo: () => stack.redo(graph),
      select: (ids) => {
        focus.length = 0;
        focus.push(...ids);
        calls.push('select');
      },
      wrapSelection: () => {
        calls.push('wrap');
        return fixture.wrapResult;
      },
      enterComponent: (id) => {
        calls.push(`enter:${id}`);
        return fixture.componentIds.includes(id);
      },
      leaveComponent: () => void calls.push('leave'),
      renameComponent: (id) => {
        calls.push(`rename:${id}`);
        return fixture.componentIds.includes(id);
      },
      deleteComponent: (id) => {
        calls.push(`delete:${id}`);
        return !fixture.deleteRefused && fixture.componentIds.includes(id);
      },
      setInput: (pin, value) => {
        calls.push(`input:${pin}`);
        fixture.driven[pin] = value;
      },
      setProgram: (text) => {
        calls.push('program');
        fixture.program = text;
      },
      run: () => void calls.push('run'),
      pause: () => void calls.push('pause'),
      stepOnce: () => void calls.push('step'),
      reset: () => void calls.push('reset'),
      test: () => {
        calls.push('test');
        return Promise.resolve({ ...fixture.testResult, failures: fixture.testResult.failures ?? [] });
      },
      circuitText: () => JSON.stringify({ instances: graph.instances, wires: graph.wires }),
      loadCircuit: () => ({ ok: true, parts: 0, wires: 0 }),
    },
  };
  return fixture;
}
