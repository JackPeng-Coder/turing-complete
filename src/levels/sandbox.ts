import type { LevelSpec } from './spec';

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
 *    they are ordinary parts here rather than level plumbing.
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
    zh: '左侧调色板里是你已经解锁的元件和全部基础元件；如果同一块电路要用很多次，框选它并封装成自己的元件。',
    en: 'The palette on the left holds every base part plus what you have unlocked. If you need the same circuit more than once, band-select it and wrap it into a part of your own.',
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
