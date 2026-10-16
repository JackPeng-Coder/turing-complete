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
  testResult: { ran: boolean; passed: boolean | null; summary: string };
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

export function makeTestHost(): TestHost {
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
    host: {
      graph: () => graph,
      parts: () => PARTS,
      snapshot: (): BoardSnapshot => ({
        mode: 'level',
        dev: false,
        level: { id: 'test-level', nameZh: '测试关', nameEn: 'Test level' },
        editing: null,
        parts: graph.instances.map((inst) => ({
          id: inst.id,
          def: inst.def,
          nameZh: PARTS.find((part) => part.id === inst.def)?.nameZh ?? inst.def,
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
      }),
      // The board's real grid, so a test that checks snapping checks the number
      // the theme actually uses.
      snap: (x, y) => ({ x: Math.round(x / 8) * 8, y: Math.round(y / 8) * 8 }),
      apply: (command, ids) => {
        stack.push(command, graph);
        applied.push(command.label);
        focus.length = 0;
        if (ids) focus.push(...ids);
      },
      undo: () => stack.undo(graph),
      redo: () => stack.redo(graph),
      run: () => void calls.push('run'),
      pause: () => void calls.push('pause'),
      stepOnce: () => void calls.push('step'),
      reset: () => void calls.push('reset'),
      test: () => {
        calls.push('test');
        return Promise.resolve(fixture.testResult);
      },
      circuitText: () => JSON.stringify({ instances: graph.instances, wires: graph.wires }),
      loadCircuit: () => ({ ok: true, parts: 0, wires: 0 }),
    },
  };
  return fixture;
}
