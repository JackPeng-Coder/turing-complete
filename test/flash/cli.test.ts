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
import { buildImage } from '../../src/flash/build';
import { emitSketch } from '../../src/flash/emit';
import { isImage } from '../../src/flash/image';

/**
 * The emitted sketch through the REAL Arduino toolchain.
 *
 * The host test proves the firmware's behaviour; this one proves the other half:
 * that `arduino-cli` for an Uno accepts the text at all (the host shim is not an
 * AVR compiler and would not catch a PROGMEM or `Print` overload mistake) and
 * that a board the size of the one that prompted the feature fits the chip.
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

describe.skipIf(!hasCli)('the sketch through arduino-cli', () => {
  it('compiles a 896-gate board for an Uno inside its flash and RAM', () => {
    const result = buildImage(benchmark(), registry, SANDBOX_LEVEL);
    if (!isImage(result)) {
      throw new Error(`refused: ${result.refusal.code} ${result.refusal.en}`);
    }
    const { image } = result;
    expect(image.report.instances).toBe(898);
    expect(image.mode).toBe('dag');

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
          'arduino:avr:uno',
          '--build-path',
          join(root, 'build'),
          '--warnings',
          'none',
          sketchDir,
        ],
        { encoding: 'utf8' },
      );
      const log = `${built.stdout ?? ''}\n${built.stderr ?? ''}`;
      expect(built.status, log).toBe(0);
      const flash = /Sketch uses (\d+) bytes/.exec(log);
      const ram = /Global variables use (\d+) bytes/.exec(log);
      expect(flash, log).not.toBeNull();
      expect(ram, log).not.toBeNull();
      const flashBytes = Number(flash![1]);
      const ramBytes = Number(ram![1]);
      expect(flashBytes, log).toBeLessThanOrEqual(32_256);
      expect(ramBytes, log).toBeLessThanOrEqual(2_048);
      // A sanity floor as well as a ceiling: a sketch that compiled to almost
      // nothing would mean the image, not the board, was empty.
      expect(flashBytes).toBeGreaterThan(5_000);
      expect(ramBytes).toBeGreaterThan(200);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
