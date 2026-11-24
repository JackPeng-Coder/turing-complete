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

/**
 * The independent firmware, run on the host and compared with the kernel.
 *
 * `test/flash/shim/` is a small Arduino facade: pins hold what the harness
 * writes or the sketch drives, `millis()` is 0, and PROGMEM is plain memory.
 * The sketch text is byte-for-byte the one `arduino-cli` compiles -- this test
 * compiles the SAME file with g++ -- so a table, an edge sample or a copy that
 * disagrees with `Simulation` fails here rather than on a board.
 *
 * There is no serial protocol any more: inputs are driven through `= <pin>
 * <0|1>`, outputs are read through `SNAP` lines, and `T` / `R` call the sketch's
 * own clock edge and reset. This is also why only one-bit connectors appear:
 * a wide connector has no channel in standalone mode and is refused by the
 * builder.
 *
 * It skips when no C++ compiler is on PATH. On this host and on CI's Linux
 * images `g++` is present, so the skip is a portability guard, not a habit.
 */

const SHIM_DIR = fileURLToPath(new URL('./shim/', import.meta.url));
const HARNESS = join(SHIM_DIR, 'harness.cpp');
const registry = createRegistry(BASE_DEFS);

const compiler = spawnSync('g++', ['--version'], { stdio: 'ignore' }).status === 0;

interface Built {
  readonly graph: Graph;
  readonly image: ProgramImage;
}

interface Place {
  readonly graph: Graph;
  readonly pinMap: Readonly<Record<string, string>>;
}

/** A sandbox board with one-bit connectors on the given pins. */
function board(inputPins: readonly string[], outputPins: readonly string[]): Place {
  const graph = emptyGraph('sandbox');
  const pinMap: Record<string, string> = {};
  inputPins.forEach((pin, index) => {
    const inst = addInstance(graph, 'level_input', 0, index * 80, `IN_${index + 1}`);
    inst.params.width = 1;
    pinMap[inst.id] = pin;
  });
  outputPins.forEach((pin, index) => {
    const inst = addInstance(graph, 'level_output', 320, index * 80, `OUT_${index + 1}`);
    inst.params.width = 1;
    pinMap[inst.id] = pin;
  });
  return { graph, pinMap };
}

function builtOf(place: Place): Built {
  const result = buildImage(
    place.graph,
    registry,
    SANDBOX_LEVEL,
    'arduino:avr:uno',
    place.pinMap,
  );
  if (!isImage(result)) throw new Error(`refused: ${result.refusal.code} ${result.refusal.en}`);
  return { graph: place.graph, image: result.image };
}

function passThrough(): Built {
  const place = board(['2'], ['13']);
  connect(place.graph, { inst: 'IN_1', port: 'out' }, { inst: 'OUT_1', port: 'in' });
  return builtOf(place);
}

function nandChain(): Built {
  const place = board(['2'], ['13']);
  let previous = 'IN_1';
  for (let index = 0; index < 10; index += 1) {
    const gate = addInstance(place.graph, 'nand', 80 + index * 40, 80);
    connect(place.graph, { inst: previous, port: 'out' }, { inst: gate.id, port: 'a' });
    connect(place.graph, { inst: 'IN_1', port: 'out' }, { inst: gate.id, port: 'b' });
    previous = gate.id;
  }
  connect(place.graph, { inst: previous, port: 'out' }, { inst: 'OUT_1', port: 'in' });
  return builtOf(place);
}

function fullAdder(): Built {
  const place = board(['2', '3', '4'], ['12', '13']);
  const adder = addInstance(place.graph, 'full_adder', 160, 80);
  connect(place.graph, { inst: 'IN_1', port: 'out' }, { inst: adder.id, port: 'a' });
  connect(place.graph, { inst: 'IN_2', port: 'out' }, { inst: adder.id, port: 'b' });
  connect(place.graph, { inst: 'IN_3', port: 'out' }, { inst: adder.id, port: 'cin' });
  connect(place.graph, { inst: adder.id, port: 'sum' }, { inst: 'OUT_1', port: 'in' });
  connect(place.graph, { inst: adder.id, port: 'cout' }, { inst: 'OUT_2', port: 'in' });
  return builtOf(place);
}

function delayLine(): Built {
  const place = board(['2'], ['13']);
  const delay = addInstance(place.graph, 'delay_line', 160, 80);
  connect(place.graph, { inst: 'IN_1', port: 'out' }, { inst: delay.id, port: 'in' });
  connect(place.graph, { inst: delay.id, port: 'out' }, { inst: 'OUT_1', port: 'in' });
  return builtOf(place);
}

function memory(): Built {
  const place = board(['2', '3'], ['13']);
  const mem = addInstance(place.graph, 'mem1', 160, 80);
  connect(place.graph, { inst: 'IN_1', port: 'out' }, { inst: mem.id, port: 'set' });
  connect(place.graph, { inst: 'IN_2', port: 'out' }, { inst: mem.id, port: 'value' });
  connect(place.graph, { inst: mem.id, port: 'out' }, { inst: 'OUT_1', port: 'in' });
  return builtOf(place);
}

/** Compile the sketch with g++, run the commands, return every `SNAP` line. */
function runFirmware(image: ProgramImage, commands: readonly string[]): Map<number, number>[] {
  const root = mkdtempSync(join(tmpdir(), 'tc-arduino-host-'));
  try {
    const sketchDir = join(root, 'sketch');
    mkdirSync(sketchDir);
    writeFileSync(join(sketchDir, 'sketch.ino'), emitSketch(image, { name: 'sketch' }), 'utf8');
    const commandsFile = join(root, 'commands.txt');
    writeFileSync(commandsFile, `${commands.join('\n')}\n`, 'utf8');
    const exe = join(root, 'harness.exe');
    const compiled = spawnSync(
      'g++',
      ['-std=c++17', '-O1', '-I', SHIM_DIR, '-I', sketchDir, HARNESS, '-o', exe],
      { encoding: 'utf8' },
    );
    if (compiled.status !== 0) {
      throw new Error(`g++ failed:\n${compiled.stdout ?? ''}\n${compiled.stderr ?? ''}`);
    }
    const ran = spawnSync(exe, [commandsFile], { encoding: 'utf8', timeout: 20_000 });
    if (ran.status !== 0) {
      throw new Error(`harness failed:\n${ran.stdout ?? ''}\n${ran.stderr ?? ''}`);
    }
    const stdout: string = ran.stdout ?? '';
    return stdout
      .split('\n')
      .filter((line: string) => line.startsWith('SNAP'))
      .map((line: string) => {
        const values = new Map<number, number>();
        for (const token of line.slice(5).trim().split(/\s+/)) {
          if (token === '') continue;
          const [pin, value] = token.split('=');
          values.set(Number(pin), Number(value));
        }
        return values;
      });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/** The same commands, through `Simulation`, snapped at every `S`. */
function referenceSnapshots(built: Built, commands: readonly string[]): Map<number, number>[] {
  const net = compile(built.graph, registry);
  const sim = new Simulation(net, registry);
  const inputByPin = new Map(
    built.image.pinInputs.map((pin) => [pin.pin, built.image.inputs[pin.ext]!] as const),
  );
  const pinLevels = new Map<number, number>();
  for (const pin of inputByPin.keys()) pinLevels.set(pin, 1); // INPUT_PULLUP
  const snap = (): Map<number, number> =>
    new Map(
      built.image.pinOutputs.map((pin) => [
        pin.pin,
        portValueToNumber(sim.read(pin.base, 1)),
      ] as const),
    );

  const applyInputs = (): void => {
    for (const [pin, input] of inputByPin) {
      sim.write(net.outputBase(`${input.id}.out`), 1, pinLevels.get(pin) ?? 1);
    }
    sim.settle();
  };

  sim.reset();
  applyInputs();
  const snapshots: Map<number, number>[] = [];
  for (const command of commands) {
    if (command === 'S') snapshots.push(snap());
    else if (command === 'T') sim.tick();
    else if (command === 'R') {
      sim.reset();
      applyInputs();
    } else if (command.startsWith('= ')) {
      const [, pinText, valueText] = command.split(' ');
      pinLevels.set(Number(pinText), Number(valueText));
      applyInputs();
    }
  }
  return snapshots;
}

function checkCase(name: string, built: Built, commands: readonly string[]): void {
  const actual = runFirmware(built.image, commands);
  const expected = referenceSnapshots(built, commands);
  expect(actual.length, `${name}: snapshot count`).toBe(expected.length);
  for (let at = 0; at < expected.length; at += 1) {
    expect([...actual[at]!.entries()].sort(), `${name}: pins at snapshot ${at}`).toEqual(
      [...expected[at]!.entries()].sort(),
    );
  }
}

describe.skipIf(!compiler)('generated standalone firmware on the host', () => {
  it('copies a one-bit signal through a mapped input and output pin', () => {
    checkCase('pass-through', passThrough(), ['S', '= 2 0', 'S', '= 2 1', 'S']);
  });

  it('settles a NAND chain the same way as the kernel', () => {
    checkCase('nand-chain', nandChain(), ['S', '= 2 0', 'S', '= 2 1', 'S']);
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
      commands.push(`= 2 ${a}`, `= 3 ${b}`, `= 4 ${cin}`, 'S');
    }
    checkCase('full-adder', fullAdder(), commands);
  });

  it('holds a delay line for a full tick', () => {
    checkCase('delay-line', delayLine(), [
      '= 2 1',
      'S',
      'T',
      'S',
      '= 2 0',
      'T',
      'T',
      'S',
      'R',
      'S',
    ]);
  });

  it('samples mem1 only on an edge, and clears on reset', () => {
    checkCase('mem1', memory(), [
      '= 2 0',
      '= 3 0',
      'S',
      '= 2 1',
      '= 3 1',
      'S',
      'T',
      'S',
      '= 2 0',
      'T',
      'S',
      'R',
      'S',
    ]);
  });

  it('compiles the standalone clock into the sketch and leaves serial out', () => {
    const place = board(['2'], ['13']);
    connect(place.graph, { inst: 'IN_1', port: 'out' }, { inst: 'OUT_1', port: 'in' });
    const result = buildImage(place.graph, registry, SANDBOX_LEVEL, 'arduino:avr:uno', {
      IN_1: '2',
      OUT_1: '13',
    }, 2);
    if (!isImage(result)) throw new Error(`refused: ${result.refusal.code}`);
    const sketch = emitSketch(result.image);
    expect(sketch).toContain('#define TC_CLOCK_HZ 2');
    expect(sketch).toContain('#define TC_CLOCK_MS 500');
    expect(sketch).not.toContain('Serial.begin');
    expect(sketch).not.toContain('Serial.print');
  });
});
