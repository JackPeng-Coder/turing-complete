// @ts-expect-error -- no Node ambient types in this project's tsconfig
import { spawnSync } from 'node:child_process';
// @ts-expect-error -- no Node ambient types in this project's tsconfig
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
// @ts-expect-error -- no Node ambient types in this project's tsconfig
import { tmpdir } from 'node:os';
// @ts-expect-error -- no Node ambient types in this project's tsconfig
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { addInstance, connect, emptyGraph } from '../../src/core/graph';
import { createRegistry } from '../../src/core/registry';
import { BASE_DEFS } from '../../src/core/defs/index';
import { SANDBOX_LEVEL } from '../../src/levels/sandbox';
import { boardProfile, type BoardId } from '../../src/flash/boards';
import { buildImage } from '../../src/flash/build';
import { emitSketch } from '../../src/flash/emit';
import { isImage, type ProgramImage } from '../../src/flash/image';

/**
 * The emitted sketch through the REAL Arduino toolchain.
 *
 * The host test proves the firmware's behaviour; this one proves the other half:
 * that `arduino-cli` for an Uno accepts the text at all (the host shim is not an
 * AVR compiler and would not catch a PROGMEM or `Print` overload mistake, nor
 * the `static_assert`s that pin the descriptor sizes the cost estimate uses) and
 * that a board the size of the one that prompted the feature fits the chip. The
 * Mega case is the same text for the other board the panel offers: one image, two
 * chips, and a real size report against each one's budget.
 *
 * The benchmark is 896 gates, matching the sandbox board in the request: a
 * fan-in tree (`i` reads `i/2` and `i/3`) so the kernel settles it in ~10 sweeps
 * rather than tripping the 512-sweep cap a 896-deep chain would. Its cost is
 * dominated by the per-node descriptors, which is what the Uno has to hold.
 */

const registry = createRegistry(BASE_DEFS);
const name = 'tc_bench';

const hasCli =
  spawnSync('arduino-cli', ['version'], { stdio: 'ignore' }).status === 0 &&
  spawnSync('arduino-cli', ['core', 'list'], { encoding: 'utf8' }).stdout?.includes(
    'arduino:avr',
  ) === true;

/** A 896-gate fan-in DAG behind one eight-bit input and one sixteen-bit output. */
function benchmark() {
  const graph = emptyGraph('sandbox');
  const input = addInstance(graph, 'level_input', 0, 0, 'IN_1');
  input.params.width = 8;
  const output = addInstance(graph, 'level_output', 0, 640, 'OUT_1');
  output.params.width = 16;

  const gates: string[] = [];
  for (let index = 0; index < 896; index += 1) {
    const gate = addInstance(graph, 'nand', (index % 40) * 40, Math.floor(index / 40) * 40);
    const first = index < 2 ? 'IN_1' : gates[Math.floor(index / 2)]!;
    const second = index < 3 ? 'IN_1' : gates[Math.floor(index / 3)]!;
    connect(graph, { inst: first, port: 'out' }, { inst: gate.id, port: 'a' });
    connect(graph, { inst: second, port: 'out' }, { inst: gate.id, port: 'b' });
    gates.push(gate.id);
  }
  connect(graph, { inst: gates[gates.length - 1]!, port: 'out' }, { inst: 'OUT_1', port: 'in' });
  return graph;
}

interface Built {
  readonly status: number | null;
  readonly log: string;
  readonly flashBytes: number | null;
  readonly ramBytes: number | null;
}

/** Write the sketch into a fresh folder and run the real compiler for `fqbn`. */
function compileFor(image: ProgramImage, fqbn: BoardId): Built {
  const root = mkdtempSync(join(tmpdir(), 'tc-arduino-cli-'));
  try {
    const sketchDir = join(root, name);
    mkdirSync(sketchDir);
    writeFileSync(join(sketchDir, `${name}.ino`), emitSketch(image, { name }), 'utf8');
    const built = spawnSync(
      'arduino-cli',
      [
        'compile',
        '--fqbn',
        fqbn,
        '--build-path',
        join(root, 'build'),
        '--warnings',
        'none',
        sketchDir,
      ],
      { encoding: 'utf8' },
    );
    const log = `${built.stdout ?? ''}\n${built.stderr ?? ''}`;
    const flash = /Sketch uses (\d+) bytes/.exec(log);
    const ram = /Global variables use (\d+) bytes/.exec(log);
    return {
      status: built.status,
      log,
      flashBytes: flash === null ? null : Number(flash[1]),
      ramBytes: ram === null ? null : Number(ram[1]),
    };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function benchImage() {
  const result = buildImage(benchmark(), registry, SANDBOX_LEVEL);
  if (!isImage(result)) {
    throw new Error(`refused: ${result.refusal.code} ${result.refusal.en}`);
  }
  const { image } = result;
  expect(image.report.instances).toBe(898);
  expect(image.mode).toBe('dag');
  return image;
}

/** A one-bit pass-through with both connectors on pins: IN_1 → D2, OUT_1 → D13. */
function pinnedImage() {
  const graph = emptyGraph('sandbox');
  const input = addInstance(graph, 'level_input', 0, 0, 'IN_1');
  input.params.width = 1;
  const output = addInstance(graph, 'level_output', 0, 240, 'OUT_1');
  output.params.width = 1;
  connect(graph, { inst: input.id, port: 'out' }, { inst: output.id, port: 'in' });
  const result = buildImage(graph, registry, SANDBOX_LEVEL, 'arduino:avr:uno', {
    IN_1: '2',
    OUT_1: '13',
  });
  if (!isImage(result)) throw new Error(`refused: ${result.refusal.code} ${result.refusal.en}`);
  return result.image;
}

// A real AVR compile is seconds, not milliseconds: the first one on a cold cache
// (or behind a scanner) has been seen at 5.5 s here, and the default 5 s timeout
// turned "the compiler works" into a red gate on a machine that has arduino-cli.
// The budget is the bridge's own compile ceiling.
describe.skipIf(!hasCli)('the sketch through arduino-cli', () => {
  it(
    'compiles a 896-gate board for an Uno inside its flash and RAM',
    () => {
      const image = benchImage();
      const built = compileFor(image, 'arduino:avr:uno');
      expect(built.status, built.log).toBe(0);
      expect(built.flashBytes, built.log).not.toBeNull();
      expect(built.ramBytes, built.log).not.toBeNull();
      const limits = boardProfile('arduino:avr:uno');
      expect(built.flashBytes!, built.log).toBeLessThanOrEqual(limits.chipFlash);
      expect(built.ramBytes!, built.log).toBeLessThanOrEqual(limits.chipRam);
      // A sanity floor as well as a ceiling: a sketch that compiled to almost
      // nothing would mean the image, not the board, was empty.
      expect(built.flashBytes!).toBeGreaterThan(5_000);
      expect(built.ramBytes!).toBeGreaterThan(200);
    },
    120_000,
  );

  it(
    'compiles the same sketch for the Mega the panel offers',
    () => {
      const built = compileFor(benchImage(), 'arduino:avr:mega');
      expect(built.status, built.log).toBe(0);
      const limits = boardProfile('arduino:avr:mega');
      // The image is board-independent; the budget is not. The same circuit that
      // uses half an Uno's flash is a rounding error on a Mega, and its compile
      // is what proves the panel's second board is a real fallback.
      expect(built.flashBytes!, built.log).toBeLessThanOrEqual(limits.chipFlash);
      expect(built.ramBytes!, built.log).toBeLessThanOrEqual(limits.chipRam);
    },
    120_000,
  );

  it(
    'compiles a sketch that reads an input pin and drives an output pin',
    () => {
      const image = pinnedImage();
      const sketch = emitSketch(image, { name });
      // The pin tables are real C++ with `static_assert`s on their sizes; only the
      // AVR compiler can prove `digitalRead`/`digitalWrite`/`INPUT_PULLUP` land.
      expect(sketch).toContain('digitalRead');
      expect(sketch).toContain('digitalWrite');
      expect(sketch).toContain('INPUT_PULLUP');
      const built = compileFor(image, 'arduino:avr:uno');
      expect(built.status, built.log).toBe(0);
      expect(built.flashBytes, built.log).not.toBeNull();
      expect(built.ramBytes!, built.log).toBeLessThanOrEqual(
        boardProfile('arduino:avr:uno').chipRam,
      );
    },
    120_000,
  );
});
