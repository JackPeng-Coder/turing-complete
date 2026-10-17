import type { Graph } from '../core/graph';
import type { Registry } from '../core/registry';
import type { LevelSpec, PinSpec } from './spec';

/**
 * The sandbox screen, as a `LevelSpec`.
 *
 * IT IS A SPEC BECAUSE THE BOARD ALREADY SPEAKS SPEC. Everything the app does to
 * a circuit -- `openLevel`, `rebuild`, `measure`, `createDisplay`, the palette,
 * the camera framing -- takes a `LevelSpec` and reads `io`, `checks`,
 * `allowedComponents` and `board` off it. A sandbox that were a second kind of
 * screen would need a second copy of all of it, and the two copies would drift
 * the first time either changed. So the sandbox is a spec whose every challenge
 * field is empty:
 *
 *  * `checks: []` -- nothing grades it. The readout still measures gate, delay
 *    and tick, because measuring is not judging (`AppState.metrics`).
 *  * `io` empty -- there is no level to bind pins to. The player's own
 *    `level_input` / `level_output` parts are what drive a sandbox circuit, and
 *    they are ordinary parts here rather than level plumbing: `sandboxPins` reads
 *    the placed connectors as the board's pins, and `boardPins` hands the same
 *    list to the readout, the display and the assistant.
 *  * `allowedComponents: []` -- deliberately NOT the sandbox's palette. The
 *    palette is derived from the registry instead (`sandboxPaletteDefs`), which
 *    is the whole point of the screen: every part the base registry has, plus
 *    whatever the player has unlocked, plus their own components.
 *  * `sandbox: true` -- so a panel can tell "the sandbox has no cases" from "a
 *    level is missing its cases" without guessing from an id.
 *
 * `chapter` 0 and `index` 0 are placeholders: the sandbox is not a chapter and
 * has no address. It is NOT in `ALL_LEVELS` or `LEVEL_ORDER`, so the chapter
 * map, the unlock chain and every walk over the shipped levels are untouched by
 * its existence.
 */
export const SANDBOX_ID = 'sandbox';

export const SANDBOX_LEVEL: LevelSpec = {
  id: SANDBOX_ID,
  chapter: 0,
  index: 0,
  name: { zh: '沙盒', en: 'Sandbox' },
  brief: {
    zh: '自由建造：这里没有题目、没有测试用例，也没有对错。元件随你取用，电路一直在跑——顶栏的门数与延迟是你自己的读数。做完的东西可以导出成电路文件，也可以随时导入回来。',
    en: 'Free build: no puzzle, no test cases, no verdict. Take any part, watch the circuit run, and read the gate and delay counters as your own measurements. What you build can be exported to a circuit file and imported back at any time.',
  },
  hint: {
    zh: '左侧调色板里是你已经解锁的元件和全部基础元件。把「关卡输入」和「关卡输出」放到板上，左下角的面板就能翻转输入、读出结果；如果同一块电路要用很多次，框选它并封装成自己的元件。',
    en: 'The palette on the left holds every base part plus what you have unlocked. Put a Level Input and a Level Output on the board and the sidebar can flip the input and read the answer; if you need the same circuit more than once, band-select it and wrap it into a part of your own.',
  },
  allowedComponents: [],
  io: { inputs: [], outputs: [] },
  checks: [],
  sandbox: true,
};

/** True when this spec is the sandbox rather than a level of the campaign. */
export function isSandbox(level: LevelSpec): boolean {
  return level.sandbox === true;
}

/**
 * The two connectors a sandbox palette offers, as ordinary parts.
 *
 * They are the SAME registry defs a level uses (`level_input` / `level_output`)
 * and they keep their `hidden` flag, which is what keeps them out of every level's
 * palette except the one that lists them. The sandbox is the exception because it
 * has no level spec to declare pins, so the connectors ARE its pins: without them
 * a sandbox circuit has nowhere to be driven and no number to report, which is
 * what a player found the hard way ("怎么没有输出").
 */
export const SANDBOX_CONNECTORS = ['level_input', 'level_output'] as const;

/** The pins a board has: what it is driven from and what it publishes. */
export interface BoardPins {
  readonly inputs: readonly PinSpec[];
  readonly outputs: readonly PinSpec[];
}

/**
 * A SANDBOX BOARD'S PINS ARE THE CONNECTORS ON IT.
 *
 * `SANDBOX_LEVEL.io` is empty on purpose: a sandbox has no puzzle to fix a pin
 * list, so the list is whatever the player placed. Each connector instance becomes
 * one pin named by its instance id (`IN_1`, `OUT_1`, ...); its width is the
 * instance's `params.width` when it sets one and the def's declared width (one
 * bit) otherwise -- the same rule `compile` uses, so a pin here always agrees with
 * the compiled slot it names.
 *
 * ORDER IS THE BOARD'S OWN. Instances come back in the graph's order, which is
 * creation order, so the panel lists `IN_1` before `IN_2` and does not renumber
 * them when one is deleted.
 */
export function sandboxPins(graph: Graph, registry: Registry): BoardPins {
  const inputs: PinSpec[] = [];
  const outputs: PinSpec[] = [];
  for (const inst of graph.instances) {
    if (!registry.has(inst.def)) continue;
    const def = registry.get(inst.def);
    if (inst.def === 'level_input') {
      inputs.push({ id: inst.id, width: widthOf(inst.params.width, def.outputs[0]?.width) });
    } else if (inst.def === 'level_output') {
      outputs.push({ id: inst.id, width: widthOf(inst.params.width, def.inputs[0]?.width) });
    }
  }
  return { inputs, outputs };
}

function widthOf(override: number | undefined, declared: number | undefined): number {
  if (override !== undefined && Number.isSafeInteger(override) && override > 0) return override;
  return declared ?? 1;
}

/**
 * The pins of whatever board is open: a level's own for a level, the placed
 * connectors for the sandbox.
 *
 * Every reader of a board's pins goes through this -- the sidebar's readout, the
 * live display, the assistant's `read_board` -- so "what the pins are" has one
 * answer for all three. A second list would be a second thing to keep in step.
 */
export function boardPins(level: LevelSpec, graph: Graph, registry: Registry): BoardPins {
  return isSandbox(level) ? sandboxPins(graph, registry) : level.io;
}
