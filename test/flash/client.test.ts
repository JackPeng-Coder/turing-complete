import { describe, expect, it } from 'vitest';
import { addInstance, connect, emptyGraph } from '../../src/core/graph';
import { createRegistry } from '../../src/core/registry';
import { BASE_DEFS } from '../../src/core/defs/index';
import { SANDBOX_LEVEL } from '../../src/levels/sandbox';
import { buildImage } from '../../src/flash/build';
import { isImage } from '../../src/flash/image';
import {
  DEFAULT_BRIDGE_URL,
  FlashClient,
  NO_BRIDGE,
  planSketch,
  sketchNameFor,
  type FetchLike,
  type SketchRequest,
} from '../../src/flash/client';

/** One recorded call and the answer the fake gives it. */
interface Call {
  readonly url: string;
  readonly init?: Parameters<FetchLike>[1];
}

/** A fetch that records every call and answers from a fixed script. */
function fakeFetch(
  answer: (call: Call) => { status?: number; ok?: boolean; body: unknown } | Error,
): { fetch: FetchLike; calls: Call[] } {
  const calls: Call[] = [];
  const fetch: FetchLike = async (url, init) => {
    const call: Call = init === undefined ? { url } : { url, init };
    calls.push(call);
    const result = answer(call);
    if (result instanceof Error) throw result;
    const status = result.status ?? (result.ok === false ? 500 : 200);
    const ok = result.ok ?? status < 300;
    return { ok, status, json: async () => result.body };
  };
  return { fetch, calls };
}

/** A one-gate sandbox circuit, enough to build an image and a sketch. */
function image() {
  const graph = emptyGraph('sandbox');
  const input = addInstance(graph, 'level_input', 0, 0, 'IN_1');
  input.params.width = 1;
  const output = addInstance(graph, 'level_output', 320, 0, 'OUT_1');
  output.params.width = 1;
  const gate = addInstance(graph, 'nand', 160, 0);
  connect(graph, { inst: input.id, port: 'out' }, { inst: gate.id, port: 'a' });
  connect(graph, { inst: input.id, port: 'out' }, { inst: gate.id, port: 'b' });
  connect(graph, { inst: gate.id, port: 'out' }, { inst: output.id, port: 'in' });
  const result = buildImage(graph, createRegistry(BASE_DEFS), SANDBOX_LEVEL);
  if (!isImage(result)) throw new Error(`refused: ${result.refusal.code}`);
  return result.image;
}

describe('FlashClient', () => {
  it('asks /health with the bridge header and reads the CLI, the core and the ports', async () => {
    const fake = fakeFetch(() => ({
      body: {
        ok: true,
        cli: 'arduino-cli  Version: 1.3.1',
        core: true,
        ports: [
          { address: 'COM3', label: 'Arduino Uno' },
          { address: 'COM4', label: 'Arduino Nano' },
        ],
      },
    }));
    const health = await new FlashClient({ fetch: fake.fetch }).health();
    expect(health).toEqual({
      ok: true,
      cli: 'arduino-cli  Version: 1.3.1',
      core: true,
      ports: [
        { address: 'COM3', label: 'Arduino Uno' },
        { address: 'COM4', label: 'Arduino Nano' },
      ],
    });
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]!.url).toBe(`${DEFAULT_BRIDGE_URL}/health`);
    expect(fake.calls[0]!.init?.method).toBe('GET');
    expect(fake.calls[0]!.init?.headers?.['X-TC-Arduino']).toBe('1');
    expect(fake.calls[0]!.init?.headers?.['X-TC-Token']).toBeUndefined();
  });

  it('turns a missing daemon into a state the panel can print, not a throw', async () => {
    const fake = fakeFetch(() => new Error('ECONNREFUSED'));
    const health = await new FlashClient({ fetch: fake.fetch }).health();
    expect(health.ok).toBe(false);
    expect(health.cli).toBeNull();
    expect(health.ports).toEqual([]);
    expect(health.error).toBe(NO_BRIDGE);
    expect(health.error).toContain('tools/arduino-bridge.mjs');
  });

  it('reports a missing toolchain as unhealthy while keeping the bridge error text', async () => {
    const fake = fakeFetch(() => ({
      body: { ok: false, cli: null, core: false, ports: [], error: 'arduino-cli is not installed' },
    }));
    const health = await new FlashClient({ fetch: fake.fetch }).health();
    expect(health.ok).toBe(false);
    expect(health.core).toBe(false);
    expect(health.error).toBe('arduino-cli is not installed');
  });

  it('reads a size report and the hex path from /compile', async () => {
    const fake = fakeFetch(() => ({
      body: {
        ok: true,
        code: 0,
        log: 'Sketch uses 924 bytes (2%) of program storage space.',
        flashBytes: 924,
        ramBytes: 9,
        hex: '/tmp/build/sketch.hex',
      },
    }));
    const request: SketchRequest = {
      name: 'tc_sandbox',
      sketch: 'void setup() {}',
      fqbn: 'arduino:avr:uno',
    };
    const build = await new FlashClient({ fetch: fake.fetch }).compile(request);
    expect(build).toEqual({
      ok: true,
      code: 0,
      log: 'Sketch uses 924 bytes (2%) of program storage space.',
      flashBytes: 924,
      ramBytes: 9,
      hex: '/tmp/build/sketch.hex',
    });
    expect(fake.calls[0]!.url).toBe(`${DEFAULT_BRIDGE_URL}/compile`);
    expect(fake.calls[0]!.init?.method).toBe('POST');
    expect(fake.calls[0]!.init?.headers?.['content-type']).toBe('application/json');
    expect(JSON.parse(fake.calls[0]!.init!.body!)).toEqual(request);
  });

  it('keeps the compiler log when the build fails, and does not invent sizes', async () => {
    const fake = fakeFetch(() => ({
      body: { ok: false, code: 1, log: 'error: expected ; before } token', flashBytes: null, ramBytes: null },
    }));
    const build = await new FlashClient({ fetch: fake.fetch }).compile({
      name: 'tc_sandbox',
      sketch: 'void setup() {',
      fqbn: 'arduino:avr:uno',
    });
    expect(build.ok).toBe(false);
    expect(build.code).toBe(1);
    expect(build.log).toContain('expected ;');
    expect(build.flashBytes).toBeNull();
    expect(build.ramBytes).toBeNull();
  });

  it('sends the port to /flash and the token when one is configured', async () => {
    const fake = fakeFetch(() => ({ body: { ok: true, code: 0, log: '', flashBytes: 10, ramBytes: 2 } }));
    const client = new FlashClient({ fetch: fake.fetch, token: 's3cret', baseUrl: 'http://localhost:9000/' });
    await client.flash({ name: 'tc_sandbox', sketch: 'sketch', fqbn: 'arduino:avr:nano', port: 'COM4' });
    expect(fake.calls[0]!.url).toBe('http://localhost:9000/flash');
    expect(fake.calls[0]!.init?.headers?.['X-TC-Token']).toBe('s3cret');
    expect(JSON.parse(fake.calls[0]!.init!.body!)).toMatchObject({ port: 'COM4', fqbn: 'arduino:avr:nano' });
  });

  it('surfaces an HTTP refusal with the bridge detail rather than a bare status', async () => {
    const fake = fakeFetch(() => ({
      status: 400,
      ok: false,
      body: { ok: false, error: 'fqbn must be one of arduino:avr:uno', field: 'fqbn' },
    }));
    const build = await new FlashClient({ fetch: fake.fetch }).flash({
      name: 'tc_sandbox',
      sketch: 'sketch',
      fqbn: 'arduino:avr:uno',
      port: 'COM3',
    });
    expect(build.ok).toBe(false);
    expect(build.error).toContain('HTTP 400');
    expect(build.error).toContain('fqbn must be one of');
  });

  it('treats a response it does not understand as an error, never a success', async () => {
    const fake = fakeFetch(() => ({ body: ['not', 'a', 'record'] }));
    const health = await new FlashClient({ fetch: fake.fetch }).health();
    expect(health.ok).toBe(false);
    expect(health.error).toContain('无法识别');
    const build = await new FlashClient({ fetch: fake.fetch }).compile({
      name: 'tc_sandbox',
      sketch: 'sketch',
      fqbn: 'arduino:avr:uno',
    });
    expect(build.ok).toBe(false);
    expect(build.error).toBeDefined();
  });
});

describe('planSketch', () => {
  it('names the sketch the way the bridge accepts and the file the way the IDE wants', () => {
    expect(sketchNameFor('sandbox')).toBe('tc_sandbox');
    expect(sketchNameFor('chapter 1/level')).toBe('tc_chapter_1_level');
    expect(sketchNameFor('')).toBe('tc_circuit');
    const plan = planSketch(image(), 'arduino:avr:mega', { port: 'COM7' });
    expect(plan.request.name).toBe('tc_sandbox');
    expect(plan.request.fqbn).toBe('arduino:avr:mega');
    expect(plan.request.port).toBe('COM7');
    expect(plan.fileName).toBe('tc_sandbox.ino');
    expect(plan.request.sketch).toContain('#define TC_HASH 0x');
    expect(plan.request.sketch).toContain('void setup()');
  });

  it('omits the port when there is none, so the same plan compiles', () => {
    const plan = planSketch(image(), 'arduino:avr:uno');
    expect(plan.request.port).toBeUndefined();
    expect('port' in plan.request).toBe(false);
    expect('boardOptions' in plan.request).toBe(false);
  });

  it('carries the board options a bootloader variant needs', () => {
    const plan = planSketch(image(), 'arduino:avr:nano', { boardOptions: 'cpu=atmega328old' });
    expect(plan.request.fqbn).toBe('arduino:avr:nano');
    expect(plan.request.boardOptions).toBe('cpu=atmega328old');
  });
});
