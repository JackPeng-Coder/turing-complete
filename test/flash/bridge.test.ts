/**
 * The local arduino-cli bridge, tested without arduino-cli.
 *
 * The bridge exists to turn one JSON request into one argv array and one
 * spawned process, so the interesting assertions are all at its edges: who may
 * ask, what an answer may look like, which argv the CLI is handed, and what the
 * game sees when the compiler fails, times out, or is not installed. All of
 * that is driven through an injected `run` fake -- no board and no real CLI,
 * except in the three tests that say so in their names (the spawn runner and
 * one optional integration test that skips cleanly when the CLI is absent).
 *
 * This file imports `node:*` without `@types/node`, like the convention tests
 * do: the project deliberately has no Node ambient types (see AGENTS.md), so
 * each such import carries one `@ts-expect-error` line.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
// @ts-expect-error -- no Node ambient types in this project's tsconfig
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
// @ts-expect-error -- no Node ambient types in this project's tsconfig
import { tmpdir } from 'node:os';
// @ts-expect-error -- no Node ambient types in this project's tsconfig
import { join } from 'node:path';
import {
  LOG_TAIL_CHARS,
  MAX_BODY_BYTES,
  MAX_SKETCH_BYTES,
  createBridge,
  createProcessRunner,
  coreInstalled,
  parseHexPath,
  parsePorts,
  parseSizes,
  startBridge,
  tailLog,
  type BridgeOptions,
  type RunFn,
  type RunResult,
  type StartedBridge,
} from '../../tools/arduino-bridge.mjs';

// ---------------------------------------------------------------------------
// Fixtures: a temp root that cleanup is observable against, and CLI answers
// ---------------------------------------------------------------------------

/**
 * The one directory every bridge under test is told to build sketches in.
 *
 * It is created once and removed in `afterAll`; a test that flashes asserts it
 * is empty afterwards, which is how "the temp dir is always cleaned" is
 * observed from the outside instead of trusted.
 */
const SANDBOX_ROOT = mkdtempSync(join(tmpdir(), 'tc-bridge-test-'));
const BLINK = 'void setup() {}\nvoid loop() {}\n';

/** The lines arduino-cli 1.x prints for an empty UNO sketch. */
const UNO_SIZES =
  'Sketch uses 924 bytes (2%) of program storage space. Maximum is 32256 bytes.\n' +
  'Global variables use 9 bytes (0%) of dynamic memory, leaving 2039 bytes for local variables. Maximum is 2048 bytes.\n';

/** `core list --format json`, reduced to the fields the bridge reads. */
const CORE_INSTALLED = JSON.stringify({
  platforms: [{ id: 'arduino:avr', installed_version: '1.8.7' }],
});

/** Node's process object, via a cast, because Node's ambient types are not in this program. */
const NODE_PROCESS = (
  globalThis as unknown as {
    process: { execPath: string; env: Record<string, string | undefined> };
  }
).process;

// ---------------------------------------------------------------------------
// Helpers: servers, requests, and an injected runner
// ---------------------------------------------------------------------------

interface Reply {
  status: number;
  body: Record<string, unknown>;
  headers: Headers;
}

interface RunCall {
  command: string;
  args: readonly string[];
  timeoutMs: number | undefined;
}

type RunAnswer = Partial<RunResult>;

/**
 * A `run` seam that records its calls and answers from a script.
 *
 * Everything the bridge does to a process other than actually spawning one goes
 * through this: it is what makes "the CLI was not reached" assertable on a
 * rejected request, and what lets a compiler failure be a fixture.
 */
function fakeRun(answer: (call: RunCall) => RunAnswer = () => ({ code: 0, stdout: '', stderr: '' })): {
  run: RunFn;
  calls: RunCall[];
} {
  const calls: RunCall[] = [];
  const run: RunFn = async (command, args, options) => {
    const call: RunCall = { command, args: [...args], timeoutMs: options?.timeoutMs };
    calls.push(call);
    return { code: 0, stdout: '', stderr: '', ...(await answer(call)) };
  };
  return { run, calls };
}

/** Dependencies good enough for /health and for the fence, with no CLI behind them. */
function healthyDeps(overrides: BridgeOptions = {}): BridgeOptions {
  const { run } = fakeRun((call) =>
    call.args[0] === 'core'
      ? { code: 0, stdout: CORE_INSTALLED, stderr: '' }
      : { code: 0, stdout: '{}', stderr: '' },
  );
  return {
    run,
    listPorts: async () => [{ address: 'COM3', label: 'Arduino Uno' }],
    cliVersion: async () => '1.5.0',
    tmpRoot: SANDBOX_ROOT,
    ...overrides,
  };
}

/** Every live bridge, so a failed assertion cannot leave a socket listening past this file. */
const OPEN = new Set<StartedBridge>();

async function start(options: BridgeOptions = {}): Promise<StartedBridge> {
  const bridge = await startBridge({ ...options, port: 0, host: '127.0.0.1' });
  OPEN.add(bridge);
  return bridge;
}

async function stop(bridge: StartedBridge): Promise<void> {
  OPEN.delete(bridge);
  await bridge.close();
}

afterAll(async () => {
  for (const bridge of [...OPEN]) await stop(bridge);
  rmSync(SANDBOX_ROOT, { recursive: true, force: true });
});

async function rawRequest(
  bridge: StartedBridge,
  path: string,
  init: RequestInit = {},
): Promise<Reply> {
  const response = await fetch(`${bridge.url}${path}`, init);
  const text = await response.text();
  return {
    status: response.status,
    headers: response.headers,
    body: text === '' ? {} : (JSON.parse(text) as Record<string, unknown>),
  };
}

/** A request carrying the header the bridge requires; the token only when given. */
async function request(
  bridge: StartedBridge,
  path: string,
  init: RequestInit & { token?: string } = {},
): Promise<Reply> {
  const { token, ...rest } = init;
  const headers = new Headers(rest.headers);
  headers.set('X-TC-Arduino', '1');
  if (token !== undefined) headers.set('X-TC-Token', token);
  return rawRequest(bridge, path, { ...rest, headers });
}

/** A JSON POST, the way the game sends one. */
function jsonPost(body: unknown, headers: Record<string, string> = {}): RequestInit {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  };
}

function flashBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { sketch: BLINK, name: 'blink', fqbn: 'arduino:avr:uno', port: 'COM3', ...overrides };
}

// ---------------------------------------------------------------------------
// The fence: origin, custom header, token, bind address
// ---------------------------------------------------------------------------

describe('the origin and header fence', () => {
  it("answers the game origin's preflight and echoes it", async () => {
    const bridge = await start(healthyDeps());
    try {
      const reply = await rawRequest(bridge, '/flash', {
        method: 'OPTIONS',
        headers: {
          Origin: 'http://localhost:5173',
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'content-type,x-tc-arduino',
        },
      });
      expect(reply.status).toBe(204);
      expect(reply.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');
      expect(reply.headers.get('access-control-allow-headers')).toContain('X-TC-Arduino');
      expect(reply.headers.get('access-control-allow-methods')).toContain('POST');
    } finally {
      await stop(bridge);
    }
  });

  it('refuses a preflight from another origin', async () => {
    const bridge = await start(healthyDeps());
    try {
      const reply = await rawRequest(bridge, '/flash', {
        method: 'OPTIONS',
        headers: { Origin: 'https://evil.example' },
      });
      expect(reply.status).toBe(403);
      // No CORS headers at all: the page that tried it learns nothing.
      expect(reply.headers.get('access-control-allow-origin')).toBeNull();
    } finally {
      await stop(bridge);
    }
  });

  it('refuses a request from another origin even when it carries the header', async () => {
    const bridge = await start(healthyDeps());
    try {
      const reply = await request(bridge, '/flash', {
        method: 'POST',
        headers: { 'content-type': 'application/json', Origin: 'https://evil.example' },
        body: JSON.stringify(flashBody()),
      });
      expect(reply.status).toBe(403);
      expect(reply.headers.get('access-control-allow-origin')).toBeNull();
    } finally {
      await stop(bridge);
    }
  });

  it('refuses a request without X-TC-Arduino: 1', async () => {
    const bridge = await start(healthyDeps());
    try {
      const reply = await rawRequest(bridge, '/flash', jsonPost(flashBody()));
      expect(reply.status).toBe(403);
      expect(String(reply.body.error)).toContain('X-TC-Arduino');
    } finally {
      await stop(bridge);
    }
  });

  it('allows a header-authenticated request with no Origin, as curl sends', async () => {
    const bridge = await start(healthyDeps());
    try {
      const reply = await request(bridge, '/health');
      expect(reply.status).toBe(200);
      expect(reply.body.ok).toBe(true);
    } finally {
      await stop(bridge);
    }
  });

  it('requires the token when one is configured', async () => {
    const bridge = await start({ ...healthyDeps(), token: 's3cret' });
    try {
      expect((await request(bridge, '/health')).status).toBe(401);
      expect((await request(bridge, '/health', { token: 'nope' })).status).toBe(401);
      expect((await request(bridge, '/health', { token: 's3cret' })).status).toBe(200);
    } finally {
      await stop(bridge);
    }
  });

  it('takes the token from TC_ARDUINO_TOKEN', async () => {
    NODE_PROCESS.env.TC_ARDUINO_TOKEN = 'from-environment';
    const bridge = await start(healthyDeps());
    try {
      expect(bridge.tokenRequired).toBe(true);
      expect((await request(bridge, '/health')).status).toBe(401);
      expect((await request(bridge, '/health', { token: 'from-environment' })).status).toBe(200);
    } finally {
      delete NODE_PROCESS.env.TC_ARDUINO_TOKEN;
      await stop(bridge);
    }
  });

  it('refuses to listen on a non-loopback interface', async () => {
    await expect(startBridge({ port: 0, host: '0.0.0.0' })).rejects.toThrow(/loopback/);
  });
});

// ---------------------------------------------------------------------------
// The body gate and the routing table
// ---------------------------------------------------------------------------

describe('the request gate', () => {
  let bridge: StartedBridge;

  beforeAll(async () => {
    bridge = await start(healthyDeps());
  });

  afterAll(async () => {
    await stop(bridge);
  });

  it('rejects a non-JSON content type with 415', async () => {
    const reply = await request(bridge, '/flash', {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: 'hello',
    });
    expect(reply.status).toBe(415);
    expect(reply.body.ok).toBe(false);
  });

  it('rejects malformed JSON with 400', async () => {
    const reply = await request(bridge, '/flash', {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: '{ not json',
    });
    expect(reply.status).toBe(400);
    expect(reply.body.ok).toBe(false);
  });

  it('rejects a body over 1 MiB with 413', async () => {
    const reply = await request(
      bridge,
      '/flash',
      jsonPost(flashBody({ sketch: 'x'.repeat(MAX_BODY_BYTES) })),
    );
    expect(reply.status).toBe(413);
    expect(reply.body.ok).toBe(false);
  });

  it('answers 404 for an unknown path and 405 for the wrong method', async () => {
    expect((await request(bridge, '/nope')).status).toBe(404);

    const wrong = await request(bridge, '/flash');
    expect(wrong.status).toBe(405);
    expect(wrong.headers.get('allow')).toBe('POST');

    expect((await request(bridge, '/health', jsonPost({}))).status).toBe(405);
  });
});

// ---------------------------------------------------------------------------
// Validation: every refusal happens before the CLI could be reached
// ---------------------------------------------------------------------------

describe('the request shape', () => {
  let bridge: StartedBridge;
  let calls: RunCall[];

  beforeAll(async () => {
    const fake = fakeRun();
    calls = fake.calls;
    bridge = await start({
      run: fake.run,
      listPorts: async () => [],
      cliVersion: async () => '1.5.0',
      tmpRoot: SANDBOX_ROOT,
    });
  });

  afterAll(async () => {
    await stop(bridge);
  });

  beforeEach(() => {
    calls.length = 0;
  });

  it('rejects a name that is not a safe directory name', async () => {
    for (const name of ['Blink', 'blink-1', '../blink', 'a'.repeat(33), '']) {
      const reply = await request(bridge, '/flash', jsonPost(flashBody({ name })));
      expect(reply.status).toBe(400);
      expect(reply.body.field).toBe('name');
    }
    expect(calls).toEqual([]);
  });

  it('rejects a sketch that is empty, not a string, or over 512 KiB', async () => {
    for (const sketch of ['', '   ', 42, 'x'.repeat(MAX_SKETCH_BYTES + 1)]) {
      const reply = await request(bridge, '/flash', jsonPost(flashBody({ sketch })));
      expect(reply.status).toBe(400);
      expect(reply.body.field).toBe('sketch');
    }
    expect(calls).toEqual([]);
  });

  it('rejects a board the game does not build for', async () => {
    for (const fqbn of ['arduino:avr:leonardo', 'arduino:avr:', 'nope', 3]) {
      const reply = await request(bridge, '/flash', jsonPost(flashBody({ fqbn })));
      expect(reply.status).toBe(400);
      expect(reply.body.field).toBe('fqbn');
    }
    expect(calls).toEqual([]);
  });

  it('rejects a port that is not a serial device', async () => {
    const ports: unknown[] = ['COM', 'ttyUSB0', 'COM3; rm -rf /', '../../etc', undefined, 3];
    for (const port of ports) {
      const reply = await request(bridge, '/flash', jsonPost(flashBody({ port })));
      expect(reply.status).toBe(400);
      expect(reply.body.field).toBe('port');
    }
    expect(calls).toEqual([]);
  });

  it('rejects board options that are not a comma-separated key=value list', async () => {
    for (const boardOptions of ['cpu=old_bootloader;drop', 'cpu="x"', 'cpu=$(id)', 7, '']) {
      const reply = await request(bridge, '/flash', jsonPost(flashBody({ boardOptions })));
      expect(reply.status).toBe(400);
      expect(reply.body.field).toBe('boardOptions');
    }
    expect(calls).toEqual([]);
  });

  it('rejects a body that is not an object', async () => {
    for (const body of [[], 'hello', 42, null]) {
      const reply = await request(bridge, '/flash', jsonPost(body));
      expect(reply.status).toBe(400);
    }
    expect(calls).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Flashing: the argv, the sizes, and the temp directory
// ---------------------------------------------------------------------------

describe('flashing', () => {
  it('writes the sketch, compiles it, uploads it, and reports the sizes', async () => {
    let onDisk: string | null = null;
    const { run, calls } = fakeRun((call) => {
      const sketchDir = call.args[call.args.length - 1]!;
      // arduino-cli requires the sketch folder and the .ino file to share a name.
      onDisk = readFileSync(join(sketchDir, 'blink.ino'), 'utf8');
      return { code: 0, stdout: UNO_SIZES, stderr: '' };
    });
    const bridge = await start({
      run,
      listPorts: async () => [],
      cliVersion: async () => '1.5.0',
      tmpRoot: SANDBOX_ROOT,
    });
    try {
      const reply = await request(bridge, '/flash', jsonPost(flashBody()));
      expect(reply.status).toBe(200);
      expect(reply.body).toMatchObject({ ok: true, code: 0, flashBytes: 924, ramBytes: 9 });
      expect(String(reply.body.log)).toContain('Sketch uses 924 bytes');
      expect(onDisk).toBe(BLINK);

      expect(calls).toHaveLength(1);
      expect(calls[0]?.command).toBe('arduino-cli');
      expect(calls[0]?.args.slice(0, -1)).toEqual([
        'compile',
        '--fqbn',
        'arduino:avr:uno',
        '-u',
        '-p',
        'COM3',
        '--warnings',
        'none',
      ]);
      expect(calls[0]?.args.at(-1)?.endsWith('blink')).toBe(true);
      expect(calls[0]?.timeoutMs).toBe(120_000);

      // The whole point of the random parent: nothing survives the request.
      expect(readdirSync(SANDBOX_ROOT)).toEqual([]);
    } finally {
      await stop(bridge);
    }
  });

  it('accepts a sketch at exactly the 512 KiB cap', async () => {
    const { run } = fakeRun(() => ({ code: 0, stdout: UNO_SIZES, stderr: '' }));
    const bridge = await start({
      run,
      listPorts: async () => [],
      cliVersion: async () => '1.5.0',
      tmpRoot: SANDBOX_ROOT,
    });
    try {
      const reply = await request(
        bridge,
        '/flash',
        jsonPost(flashBody({ sketch: 'x'.repeat(MAX_SKETCH_BYTES) })),
      );
      expect(reply.status).toBe(200);
      expect(reply.body.ok).toBe(true);
    } finally {
      await stop(bridge);
    }
  });

  it('accepts a unix serial port', async () => {
    const { run, calls } = fakeRun(() => ({ code: 0, stdout: UNO_SIZES, stderr: '' }));
    const bridge = await start({
      run,
      listPorts: async () => [],
      cliVersion: async () => '1.5.0',
      tmpRoot: SANDBOX_ROOT,
    });
    try {
      const reply = await request(
        bridge,
        '/flash',
        jsonPost(flashBody({ port: '/dev/ttyUSB0' })),
      );
      expect(reply.status).toBe(200);
      expect(calls[0]?.args).toContain('/dev/ttyUSB0');
    } finally {
      await stop(bridge);
    }
  });

  it('passes validated board options through as one argument', async () => {
    const { run, calls } = fakeRun(() => ({ code: 0, stdout: UNO_SIZES, stderr: '' }));
    const bridge = await start({
      run,
      listPorts: async () => [],
      cliVersion: async () => '1.5.0',
      tmpRoot: SANDBOX_ROOT,
    });
    try {
      const reply = await request(
        bridge,
        '/flash',
        jsonPost(flashBody({ boardOptions: 'cpu=old_bootloader' })),
      );
      expect(reply.status).toBe(200);
      expect(calls[0]?.args.slice(0, -1)).toEqual([
        'compile',
        '--fqbn',
        'arduino:avr:uno',
        '-u',
        '-p',
        'COM3',
        '--board-options',
        'cpu=old_bootloader',
        '--warnings',
        'none',
      ]);
    } finally {
      await stop(bridge);
    }
  });

  it('returns a compiler failure with its log and still cleans up', async () => {
    const { run } = fakeRun(() => ({
      code: 1,
      stdout: '',
      stderr: 'blink.ino:1:1: error: expected initializer before void\n',
    }));
    const bridge = await start({
      run,
      listPorts: async () => [],
      cliVersion: async () => '1.5.0',
      tmpRoot: SANDBOX_ROOT,
    });
    try {
      const reply = await request(bridge, '/flash', jsonPost(flashBody()));
      expect(reply.status).toBe(200);
      expect(reply.body).toMatchObject({ ok: false, code: 1, flashBytes: null, ramBytes: null });
      expect(String(reply.body.log)).toContain('expected initializer');
      expect(readdirSync(SANDBOX_ROOT)).toEqual([]);
    } finally {
      await stop(bridge);
    }
  });

  it('treats an arduino-cli that cannot start as a result, not a crash', async () => {
    const { run } = fakeRun(() => ({
      code: null,
      stdout: '',
      stderr: '',
      error: 'spawn arduino-cli ENOENT',
    }));
    const bridge = await start({
      run,
      listPorts: async () => [],
      cliVersion: async () => '1.5.0',
      tmpRoot: SANDBOX_ROOT,
    });
    try {
      const reply = await request(bridge, '/flash', jsonPost(flashBody()));
      expect(reply.status).toBe(200);
      expect(reply.body).toMatchObject({ ok: false, code: null });
      expect(String(reply.body.error)).toContain('ENOENT');
      expect(readdirSync(SANDBOX_ROOT)).toEqual([]);
    } finally {
      await stop(bridge);
    }
  });

  it('reports a timeout as ok: false with the partial output kept', async () => {
    const { run, calls } = fakeRun(() => ({
      code: null,
      stdout: 'avr-gcc is taking its time',
      stderr: '',
      timedOut: true,
    }));
    const bridge = await start({
      run,
      listPorts: async () => [],
      cliVersion: async () => '1.5.0',
      tmpRoot: SANDBOX_ROOT,
      timeoutMs: 4_321,
    });
    try {
      const reply = await request(bridge, '/flash', jsonPost(flashBody()));
      expect(reply.body.ok).toBe(false);
      expect(reply.body.timedOut).toBe(true);
      expect(String(reply.body.error)).toContain('timed out');
      expect(String(reply.body.log)).toContain('avr-gcc is taking its time');
      expect(calls[0]?.timeoutMs).toBe(4_321);
      expect(readdirSync(SANDBOX_ROOT)).toEqual([]);
    } finally {
      await stop(bridge);
    }
  });

  it('cleans up when the runner itself throws', async () => {
    const bridge = await start({
      run: async () => {
        throw new Error('runner exploded');
      },
      listPorts: async () => [],
      cliVersion: async () => '1.5.0',
      tmpRoot: SANDBOX_ROOT,
    });
    try {
      const reply = await request(bridge, '/flash', jsonPost(flashBody()));
      expect(reply.status).toBe(200);
      expect(reply.body.ok).toBe(false);
      expect(String(reply.body.error)).toContain('runner exploded');
      expect(readdirSync(SANDBOX_ROOT)).toEqual([]);
    } finally {
      await stop(bridge);
    }
  });

  it('keeps only the tail of a long log but reads the whole log for sizes', async () => {
    const longLog = `${UNO_SIZES}${'noise\n'.repeat(4_000)}`;
    const { run } = fakeRun(() => ({ code: 0, stdout: longLog, stderr: '' }));
    const bridge = await start({
      run,
      listPorts: async () => [],
      cliVersion: async () => '1.5.0',
      tmpRoot: SANDBOX_ROOT,
    });
    try {
      const reply = await request(bridge, '/compile', jsonPost(flashBody()));
      const log = String(reply.body.log);
      expect(log.length).toBeLessThanOrEqual(LOG_TAIL_CHARS);
      // The sizes were printed before the noise, so parsing the tail alone would
      // have missed them: the response keeps the tail but reads the whole log.
      expect(reply.body.flashBytes).toBe(924);
      expect(log).not.toContain('Sketch uses');
    } finally {
      await stop(bridge);
    }
  });
});

// ---------------------------------------------------------------------------
// Compiling: the same path without -u/-p, plus the hex artifact
// ---------------------------------------------------------------------------

describe('compiling', () => {
  it('does not upload and reports the hex path named in the log', async () => {
    const hex = 'C:\\Users\\me\\AppData\\Local\\arduino\\sketches\\abc123\\blink.ino.hex';
    const { run, calls } = fakeRun(() => ({
      code: 0,
      stdout: `${UNO_SIZES}Used compiled file: ${hex}\n`,
      stderr: '',
    }));
    const bridge = await start({
      run,
      listPorts: async () => [],
      cliVersion: async () => '1.5.0',
      tmpRoot: SANDBOX_ROOT,
    });
    try {
      const reply = await request(bridge, '/compile', jsonPost(flashBody()));
      expect(reply.status).toBe(200);
      expect(reply.body).toMatchObject({
        ok: true,
        code: 0,
        flashBytes: 924,
        ramBytes: 9,
        hex,
      });

      const args = calls[0]?.args ?? [];
      expect(args).not.toContain('-u');
      expect(args).not.toContain('-p');
      expect(args.slice(0, -1)).toEqual([
        'compile',
        '--fqbn',
        'arduino:avr:uno',
        '--warnings',
        'none',
      ]);
      expect(readdirSync(SANDBOX_ROOT)).toEqual([]);
    } finally {
      await stop(bridge);
    }
  });

  it('puts board options in front of --warnings, as arduino-cli expects', async () => {
    const { run, calls } = fakeRun(() => ({ code: 0, stdout: UNO_SIZES, stderr: '' }));
    const bridge = await start({
      run,
      listPorts: async () => [],
      cliVersion: async () => '1.5.0',
      tmpRoot: SANDBOX_ROOT,
    });
    try {
      const reply = await request(
        bridge,
        '/compile',
        jsonPost(flashBody({ fqbn: 'arduino:avr:nano', boardOptions: 'cpu=old_bootloader' })),
      );
      expect(reply.status).toBe(200);
      expect(calls[0]?.args.slice(0, -1)).toEqual([
        'compile',
        '--fqbn',
        'arduino:avr:nano',
        '--board-options',
        'cpu=old_bootloader',
        '--warnings',
        'none',
      ]);
    } finally {
      await stop(bridge);
    }
  });
});

// ---------------------------------------------------------------------------
// /health and /ports
// ---------------------------------------------------------------------------

describe('health and ports', () => {
  it('reports the CLI, the AVR core and the ports when all three answer', async () => {
    const fake = fakeRun((call) =>
      call.args[0] === 'core'
        ? { code: 0, stdout: CORE_INSTALLED, stderr: '' }
        : { code: 0, stdout: '{}', stderr: '' },
    );
    const bridge = await start({
      run: fake.run,
      listPorts: async () => [
        { address: 'COM11', label: 'COM11' },
        { address: 'COM3', label: 'Arduino Uno' },
      ],
      cliVersion: async () => '1.5.0',
      tmpRoot: SANDBOX_ROOT,
    });
    try {
      const reply = await request(bridge, '/health');
      expect(reply.status).toBe(200);
      expect(reply.body).toEqual({
        ok: true,
        cli: '1.5.0',
        core: true,
        ports: [
          { address: 'COM11', label: 'COM11' },
          { address: 'COM3', label: 'Arduino Uno' },
        ],
      });
      expect(fake.calls[0]?.args).toEqual(['core', 'list', '--format', 'json']);
    } finally {
      await stop(bridge);
    }
  });

  it('answers 200 with ok: false when arduino-cli is missing', async () => {
    const bridge = await start({
      run: async () => ({ code: null, stdout: '', stderr: '', error: 'spawn arduino-cli ENOENT' }),
      listPorts: async () => [],
      cliVersion: async () => {
        throw new Error('spawn arduino-cli ENOENT');
      },
      tmpRoot: SANDBOX_ROOT,
    });
    try {
      const reply = await request(bridge, '/health');
      expect(reply.status).toBe(200);
      expect(reply.body).toMatchObject({ ok: false, cli: null, core: false, ports: [] });
      expect(String(reply.body.error)).toContain('ENOENT');
    } finally {
      await stop(bridge);
    }
  });

  it('answers ok: false when the AVR core is not installed', async () => {
    const { run } = fakeRun(() => ({
      code: 0,
      stdout: JSON.stringify({ platforms: [{ id: 'arduino:avr' }] }),
      stderr: '',
    }));
    const bridge = await start({
      run,
      listPorts: async () => [],
      cliVersion: async () => '1.5.0',
      tmpRoot: SANDBOX_ROOT,
    });
    try {
      const reply = await request(bridge, '/health');
      expect(reply.status).toBe(200);
      expect(reply.body).toMatchObject({ ok: false, cli: '1.5.0', core: false });
      expect(String(reply.body.error)).toContain('core');
    } finally {
      await stop(bridge);
    }
  });

  it('lists the serial ports it was given, including unidentified ones', async () => {
    const bridge = await start({
      ...healthyDeps(),
      listPorts: async () => [
        { address: 'COM11', label: 'COM11' },
        { address: 'COM4', label: 'Arduino Nano' },
      ],
    });
    try {
      const reply = await request(bridge, '/ports');
      expect(reply.status).toBe(200);
      expect(reply.body).toEqual({
        ports: [
          { address: 'COM11', label: 'COM11' },
          { address: 'COM4', label: 'Arduino Nano' },
        ],
      });
    } finally {
      await stop(bridge);
    }
  });

  it('answers an empty list rather than an exception when the CLI probe fails', async () => {
    const bridge = await start({
      ...healthyDeps(),
      listPorts: async () => {
        throw new Error('board list failed');
      },
    });
    try {
      const reply = await request(bridge, '/ports');
      expect(reply.status).toBe(200);
      expect(reply.body.ports).toEqual([]);
      expect(String(reply.body.error)).toContain('board list failed');
    } finally {
      await stop(bridge);
    }
  });
});

// ---------------------------------------------------------------------------
// Parse seams, exported because a log-format change should fail one small test
// ---------------------------------------------------------------------------

describe('parsing what the CLI says', () => {
  it('reads the two sizes and lets the last report win', () => {
    expect(parseSizes(UNO_SIZES)).toEqual({ flashBytes: 924, ramBytes: 9 });
    expect(parseSizes('nothing useful here')).toEqual({ flashBytes: null, ramBytes: null });
    expect(parseSizes('Sketch uses 10 bytes\nSketch uses 20 bytes')).toEqual({
      flashBytes: 20,
      ramBytes: null,
    });
  });

  it('reads only the last hex path', () => {
    expect(parseHexPath('/tmp/stale.hex then C:\\build\\fresh\\b.hex done')).toBe(
      'C:\\build\\fresh\\b.hex',
    );
    expect(parseHexPath('no artifact named')).toBeNull();
  });

  it('keeps the end of a long log and the whole of a short one', () => {
    expect(tailLog('abc')).toBe('abc');
    expect(tailLog('')).toBe('');
    const long = `${'x'.repeat(LOG_TAIL_CHARS)}TAIL`;
    const tail = tailLog(long);
    expect(tail.length).toBe(LOG_TAIL_CHARS);
    expect(tail.endsWith('TAIL')).toBe(true);
  });

  it('turns board list JSON into serial ports, identified or not', () => {
    const ports = parsePorts({
      detected_ports: [
        { port: { address: 'COM11', label: 'COM11', protocol: 'serial' } },
        {
          port: { address: 'COM3', label: 'COM3', protocol: 'serial' },
          matching_boards: [{ name: 'Arduino Uno' }],
        },
        // A network port is not something `-p` can upload to.
        { port: { address: '192.168.1.5', label: 'wifi', protocol: 'network' } },
        // The same address twice is one selectable port.
        { port: { address: 'COM3', label: 'duplicate', protocol: 'serial' } },
        { port: { address: '' } },
        'not a port',
      ],
    });
    expect(ports).toEqual([
      { address: 'COM11', label: 'COM11' },
      { address: 'COM3', label: 'Arduino Uno' },
    ]);
  });

  it('names an unidentified USB-serial adapter by the vid:pid it reports', () => {
    // A CH340 clone carries no Arduino USB descriptor, so `board list` cannot
    // name the board; without this the picker showed "COM3 · COM3", which was
    // indistinguishable from a Bluetooth socket on the same machine.
    const ports = parsePorts({
      detected_ports: [
        {
          port: {
            address: 'COM3',
            label: 'COM3',
            protocol: 'serial',
            protocol_label: 'Serial Port (USB)',
            properties: { vid: '0x1A86', pid: '0x7523' },
          },
        },
        { port: { address: 'COM9', label: 'COM9', protocol: 'serial', properties: {} } },
        {
          port: {
            address: 'COM5',
            label: 'COM5',
            protocol: 'serial',
            properties: { vid: '0x1234', pid: '0x0001' },
          },
        },
        {
          port: {
            address: 'COM6',
            label: 'COM6',
            protocol: 'serial',
            properties: { vid: 'not-a-vid' },
          },
        },
      ],
    });
    expect(ports).toEqual([
      { address: 'COM3', label: 'WCH CH340 (1a86:7523)' },
      { address: 'COM9', label: 'COM9' },
      { address: 'COM5', label: 'USB serial (1234:0001)' },
      { address: 'COM6', label: 'COM6' },
    ]);
  });

  it('recognises the installed core in the two shapes the CLI has used', () => {
    expect(coreInstalled({ platforms: [{ id: 'arduino:avr', installed_version: '1.8.7' }] })).toBe(
      true,
    );
    expect(coreInstalled({ platforms: [{ id: 'arduino:avr', installed: true }] })).toBe(true);
    expect(coreInstalled({ platforms: [{ id: 'arduino:avr' }] })).toBe(false);
    expect(coreInstalled({ platforms: [{ id: 'esp32:esp32', installed_version: '1.0.0' }] })).toBe(
      false,
    );
    expect(coreInstalled(null)).toBe(false);
    expect(coreInstalled({})).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The server seam itself
// ---------------------------------------------------------------------------

describe('the createBridge seam', () => {
  it('returns an unlistened server that can be started on an ephemeral port', async () => {
    const server = createBridge({
      listPorts: async () => [],
      cliVersion: async () => '1.5.0',
    });
    const port = await new Promise<number>((resolvePort, rejectPort) => {
      server.once('error', rejectPort);
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        resolvePort(typeof address === 'object' && address !== null ? address.port : 0);
      });
    });
    expect(port).toBeGreaterThan(0);
    await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
  });
});

// ---------------------------------------------------------------------------
// The real spawn seam: no arduino-cli, but real process control
// ---------------------------------------------------------------------------

describe('the spawn runner', () => {
  it('collects stdout and the exit code of a real process', async () => {
    const result = await createProcessRunner()(
      NODE_PROCESS.execPath,
      ['-e', 'process.stdout.write("hi")'],
      { timeoutMs: 10_000 },
    );
    expect(result.code).toBe(0);
    expect(result.stdout).toBe('hi');
    expect(result.timedOut).toBeUndefined();
  });

  it(
    'kills a process that outlives its timeout',
    async () => {
      const run = createProcessRunner();
      const started = Date.now();
      const result = await run(NODE_PROCESS.execPath, ['-e', 'setTimeout(() => {}, 30000)'], {
        timeoutMs: 200,
      });
      expect(result.timedOut).toBe(true);
      expect(result.code).toBeNull();
      // It must not have waited for the child's own 30 s exit to resolve.
      expect(Date.now() - started).toBeLessThan(10_000);
    },
    20_000,
  );

  it('reports a command it cannot start instead of rejecting', async () => {
    const result = await createProcessRunner()(
      'tc-arduino-bridge-cli-that-does-not-exist',
      ['version'],
      { timeoutMs: 5_000 },
    );
    expect(result.code).toBeNull();
    expect(result.error ?? '').toMatch(/ENOENT/i);
  });
});

// ---------------------------------------------------------------------------
// One optional test against the real CLI; it skips cleanly where it is absent
// ---------------------------------------------------------------------------

describe('the real arduino-cli', () => {
  it(
    'reports a usable install and compiles a blink sketch without a board',
    async (context) => {
      const bridge = await start();
      try {
        const health = await request(bridge, '/health');
        expect(health.status).toBe(200);
        if (health.body.cli === null) context.skip('arduino-cli is not installed on this host');
        if (health.body.core !== true) context.skip('the arduino:avr core is not installed here');
        expect(health.body.ok).toBe(true);
        expect(typeof health.body.cli).toBe('string');
        expect(Array.isArray(health.body.ports)).toBe(true);

        const compiled = await request(bridge, '/compile', jsonPost(flashBody()));
        expect(compiled.status).toBe(200);
        expect(compiled.body.ok).toBe(true);
        expect(compiled.body.flashBytes).toBeGreaterThan(0);
        expect(compiled.body.ramBytes).toBeGreaterThan(0);
      } finally {
        await stop(bridge);
      }
    },
    120_000,
  );
});
