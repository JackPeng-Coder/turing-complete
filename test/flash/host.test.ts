// @ts-expect-error -- no Node ambient types in this project's tsconfig
import { spawnSync } from 'node:child_process';
// @ts-expect-error -- no Node ambient types in this project's tsconfig
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
// @ts-expect-error -- no Node ambient types in this project's tsconfig
import { tmpdir } from 'node:os';
// @ts-expect-error -- no Node ambient types in this project's tsconfig
import { join } from 'node:path';
// @ts-expect-error -- no Node ambient types in this project's tsconfig
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { addInstance, connect, emptyGraph, type Graph } from '../../src/core/graph';
import { createRegistry } from '../../src/core/registry';
import { BASE_DEFS } from '../../src/core/defs/index';
import { compile, Simulation } from '../../src/core/net';
import { portValueToNumber } from '../../src/core/signal';
import { SANDBOX_LEVEL } from '../../src/levels/sandbox';
import { buildImage } from '../../src/flash/build';
import { emitSketch } from '../../src/flash/emit';
import { isImage, type ProgramImage } from '../../src/flash/image';
import { parseBoardLine, type BoardFrame } from '../../src/flash/protocol';

/**
 * The firmware, run on the host and compared with the kernel.
 *
 * `test/flash/shim/` is a small Arduino facade: `Serial` is a queue, `millis()`
 * is 0 and PROGMEM is plain memory. The sketch text is byte-for-byte the one
 * `arduino-cli` compiles for the Uno -- this test compiles the SAME file with
 * g++ and drives it through commands -- so a table, an edge sample or a copy
 * that disagrees with `Simulation` fails here rather than on a board.
 *
 * It skips when no C++ compiler is on PATH. On this host and on CI's Linux
 * images `g++` is present, so the skip is a portability guard, not a habit.
 */

const SHIM_DIR = fileURLToPath(new URL('./shim/', import.meta.url));
const HARNESS = join(SHIM_DIR, 'harness.cpp');
const registry = createRegistry(BASE_DEFS);

const compiler = spawnSync('g++', ['--version'], { stdio: 'ignore' }).status === 0;

interface Frame {
  readonly tick: number;
  readonly stable: boolean;
  readonly outputs: readonly number[];
}

interface Built {
  readonly graph: Graph;
  readonly image: ProgramImage;
}

/** A sandbox board with the connectors a case needs. */
function board(inputs: readonly number[], outputs: readonly number[]): {
  graph: Graph;
  input(id: string, width: number): string;
  output(id: string, width: number): string;
} {
  const graph = emptyGraph('sandbox');
  const inputsIn = inputs.map((width, index) => {
    const inst = addInstance(graph, 'level_input', 0, index * 80, `IN_${index + 1}`);
    inst.params.width = width;
    return inst.id;
  });
  const outputsIn = outputs.map((width, index) => {
    const inst = addInstance(graph, 'level_output', 320, index * 80, `OUT_${index + 1}`);
    inst.params.width = width;
    return inst.id;
  });
  return {
    graph,
    input: (id) => {
      const found = inputsIn.find((candidate) => candidate === id);
      if (found === undefined) throw new Error(`no input ${id}`);
      return found;
    },
    output: (id) => {
      const found = outputsIn.find((candidate) => candidate === id);
      if (found === undefined) throw new Error(`no output ${id}`);
      return found;
    },
  };
}

function builtOf(graph: Graph): Built {
  const result = buildImage(graph, registry, SANDBOX_LEVEL);
  if (!isImage(result)) throw new Error(`refused: ${result.refusal.code} ${result.refusal.en}`);
  return { graph, image: result.image };
}

function passThrough(): Built {
  const place = board([8], [8]);
  connect(place.graph, { inst: 'IN_1', port: 'out' }, { inst: 'OUT_1', port: 'in' });
  return builtOf(place.graph);
}

function nandChain(): Built {
  const place = board([1], [1]);
  let previous = 'IN_1';
  for (let index = 0; index < 10; index += 1) {
    const gate = addInstance(place.graph, 'nand', 80 + index * 40, 80);
    connect(place.graph, { inst: previous, port: 'out' }, { inst: gate.id, port: 'a' });
    connect(place.graph, { inst: 'IN_1', port: 'out' }, { inst: gate.id, port: 'b' });
    previous = gate.id;
  }
  connect(place.graph, { inst: previous, port: 'out' }, { inst: 'OUT_1', port: 'in' });
  return builtOf(place.graph);
}

function fullAdder(): Built {
  const place = board([1, 1, 1], [1, 1]);
  const adder = addInstance(place.graph, 'full_adder', 160, 80);
  connect(place.graph, { inst: 'IN_1', port: 'out' }, { inst: adder.id, port: 'a' });
  connect(place.graph, { inst: 'IN_2', port: 'out' }, { inst: adder.id, port: 'b' });
  connect(place.graph, { inst: 'IN_3', port: 'out' }, { inst: adder.id, port: 'cin' });
  connect(place.graph, { inst: adder.id, port: 'sum' }, { inst: 'OUT_1', port: 'in' });
  connect(place.graph, { inst: adder.id, port: 'cout' }, { inst: 'OUT_2', port: 'in' });
  return builtOf(place.graph);
}

function delayLine(): Built {
  const place = board([1], [1]);
  const delay = addInstance(place.graph, 'delay_line', 160, 80);
  connect(place.graph, { inst: 'IN_1', port: 'out' }, { inst: delay.id, port: 'in' });
  connect(place.graph, { inst: delay.id, port: 'out' }, { inst: 'OUT_1', port: 'in' });
  return builtOf(place.graph);
}

function memory(): Built {
  const place = board([1, 1], [1]);
  const mem = addInstance(place.graph, 'mem1', 160, 80);
  connect(place.graph, { inst: 'IN_1', port: 'out' }, { inst: mem.id, port: 'set' });
  connect(place.graph, { inst: 'IN_2', port: 'out' }, { inst: mem.id, port: 'value' });
  connect(place.graph, { inst: mem.id, port: 'out' }, { inst: 'OUT_1', port: 'in' });
  return builtOf(place.graph);
}

function latch(): Built {
  const place = board([1, 1], [1]);
  const first = addInstance(place.graph, 'nand', 160, 80);
  const second = addInstance(place.graph, 'nand', 240, 80);
  connect(place.graph, { inst: 'IN_1', port: 'out' }, { inst: first.id, port: 'a' });
  connect(place.graph, { inst: 'IN_2', port: 'out' }, { inst: second.id, port: 'a' });
  connect(place.graph, { inst: second.id, port: 'out' }, { inst: first.id, port: 'b' });
  connect(place.graph, { inst: first.id, port: 'out' }, { inst: second.id, port: 'b' });
  connect(place.graph, { inst: first.id, port: 'out' }, { inst: 'OUT_1', port: 'in' });
  return builtOf(place.graph);
}

/** The frames `Simulation` would show for the same command sequence. */
function referenceFrames(built: Built, commands: readonly string[]): Frame[] {
  const net = compile(built.graph, registry);
  const sim = new Simulation(net, registry);
  const read = (): Frame => {
    const outputs: number[] = [];
    for (const pin of built.image.outputs) {
      outputs.push(portValueToNumber(sim.read(net.outputBase(`${pin.id}.mirror`), pin.width)));
    }
    return { tick: sim.tickCount, stable: true, outputs };
  };
  sim.reset();
  const frames: Frame[] = [read()];
  for (const command of commands) {
    if (command.startsWith('I ')) {
      const [, indexText, valueText] = command.split(' ');
      const pin = built.image.inputs[Number(indexText)]!;
      sim.write(net.outputBase(`${pin.id}.out`), pin.width, Number(valueText));
      sim.settle();
      frames.push(read());
    } else if (command === 'T') {
      sim.tick();
      frames.push(read());
    } else if (command === 'R') {
      sim.reset();
      frames.push(read());
    } else if (command === 'S') {
      frames.push(read());
    }
  }
  return frames;
}

/** Compile the sketch with g++, run the commands, return parsed board lines. */
function runFirmware(image: ProgramImage, commands: readonly string[]): ReturnType<typeof parseBoardLine>[] {
  const root = mkdtempSync(join(tmpdir(), 'tc-arduino-host-'));
  try {
    const sketchDir = join(root, 'sketch');
    mkdirSync(sketchDir);
    writeFileSync(join(sketchDir, 'sketch.ino'), emitSketch(image, { name: 'sketch' }), 'utf8');
    const commandsFile = join(root, 'commands.txt');
    writeFileSync(commandsFile, `${commands.join('\n')}\n`, 'utf8');
    // `harness.exe` on every platform: MinGW adds `.exe` to a suffixless `-o`
    // itself, and on Linux the suffix is just part of the filename, so one
    // name keeps this test free of a `process.platform` branch (this project
    // deliberately has no Node ambient types).
    const exe = join(root, 'harness.exe');
    const compiled = spawnSync(
      'g++',
      [
        '-std=c++17',
        '-O1',
        '-I',
        SHIM_DIR,
        '-I',
        sketchDir,
        HARNESS,
        '-o',
        exe,
      ],
      { encoding: 'utf8' },
    );
    if (compiled.status !== 0) {
      throw new Error(`g++ failed:\n${compiled.stdout ?? ''}\n${compiled.stderr ?? ''}`);
    }
    const ran = spawnSync(exe, [commandsFile], { encoding: 'utf8' });
    if (ran.status !== 0) {
      throw new Error(`harness failed:\n${ran.stdout ?? ''}\n${ran.stderr ?? ''}`);
    }
    // `spawnSync` is untyped in this program (no Node ambient types), so the
    // buffer is spelled out here rather than inferred from an `any` chain.
    const stdout: string = ran.stdout ?? '';
    return stdout
      .split('\n')
      .map((line: string) => parseBoardLine(line))
      .filter((line): line is NonNullable<typeof line> => line !== null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/** One case: build, run both sides, compare every frame and the banner. */
function checkCase(name: string, built: Built, commands: readonly string[]): void {
  const lines = runFirmware(built.image, commands);
  const banner = lines.find((line) => line?.kind === 'banner');
  expect(banner, `${name}: no banner`).toBeDefined();
  if (banner?.kind !== 'banner') throw new Error(`${name}: not a banner`);
  expect(banner.hash, `${name}: banner hash`).toBe(built.image.hash);

  const frames = lines.filter((line): line is BoardFrame => line?.kind === 'frame');
  const expected = referenceFrames(built, commands);
  expect(frames.length, `${name}: frame count`).toBe(expected.length);
  for (let at = 0; at < expected.length; at += 1) {
    expect(frames[at]!.outputs, `${name}: outputs at frame ${at}`).toEqual(expected[at]!.outputs);
    expect(frames[at]!.tick, `${name}: tick at frame ${at}`).toBe(expected[at]!.tick);
    expect(frames[at]!.stable, `${name}: stable at frame ${at}`).toBe(true);
  }
}

describe.skipIf(!compiler)('generated firmware on the host', () => {
  it('copies an eight-bit connector through unchanged', () => {
    checkCase('pass-through', passThrough(), ['I 0 0', 'I 0 85', 'I 0 255', 'S', 'R', 'I 0 170']);
  });

  it('settles a NAND chain the same way as the kernel', () => {
    checkCase('nand-chain', nandChain(), ['I 0 0', 'T', 'I 0 1', 'T', 'T', 'S', 'R']);
  });

  it('computes every full-adder vector', () => {
    const commands: string[] = [];
    for (const [a, b, cin] of [
      [0, 0, 0],
      [1, 0, 0],
      [0, 1, 0],
      [1, 1, 0],
      [0, 0, 1],
      [1, 0, 1],
      [0, 1, 1],
      [1, 1, 1],
    ] as const) {
      commands.push(`I 0 ${a}`, `I 1 ${b}`, `I 2 ${cin}`, 'S');
    }
    checkCase('full-adder', fullAdder(), commands);
  });

  it('holds a delay line for a full tick', () => {
    checkCase('delay-line', delayLine(), ['I 0 1', 'S', 'T', 'I 0 0', 'T', 'T', 'S', 'R']);
  });

  it('samples mem1 only on an edge, and clears on reset', () => {
    checkCase('mem1', memory(), [
      'I 0 1',
      'I 1 1',
      'S',
      'T',
      'I 0 0',
      'T',
      'S',
      'R',
      'S',
    ]);
  });

  it('reproduces a combinational latch with Jacobi sweeps', () => {
    checkCase('latch', latch(), [
      'I 0 0',
      'I 1 0',
      'S',
      'I 0 1',
      'I 1 0',
      'S',
      'I 0 0',
      'I 1 1',
      'S',
      'I 1 0',
      'S',
      'R',
    ]);
  });

  it('reports the image hash in the banner', () => {
    const built = passThrough();
    const lines = runFirmware(built.image, []);
    const banner = lines.find((line) => line?.kind === 'banner');
    expect(banner).toMatchObject({ kind: 'banner', hash: built.image.hash });
  });
});
