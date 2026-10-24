#!/usr/bin/env node
/**
 * A local compile-and-upload bridge for a circuit exported from the sandbox.
 *
 * The game is a browser application with no runtime dependency and no server,
 * but `arduino-cli` is a native process that has to run on the machine the board
 * is plugged into. A browser cannot start one, so this file is the smallest
 * possible daemon: one Node script, Node's standard library only, running while
 * the player wants to flash and gone afterwards.
 *
 * WHY IT IS SO PARANOID. It compiles and uploads whatever JSON arrives on its
 * port, so anything that can reach that port while the bridge is up can program
 * a microcontroller -- and every request travels through the browser, which is
 * a shared front door. Hence the whole fence: loopback bind only, a header CORS
 * cannot set on its own (`X-TC-Arduino`), an Origin allowlist, an optional token,
 * a bounded body, and whitelists for the sketch name, the FQBN, the port and the
 * board options. Nothing is shell-interpolated: arguments go to arduino-cli as
 * an argv array through `child_process.spawn` with `shell: false`, so a
 * metacharacter is an argument, not code, even before the whitelist refuses it.
 *
 * WHAT THE GAME EXPECTS. Every response is JSON; every request carries
 * `X-TC-Arduino: 1` (and `X-TC-Token` when `TC_ARDUINO_TOKEN` is set):
 *
 *   GET  /health  -> { ok, cli, core, ports }        (200 even when unhealthy)
 *   GET  /ports   -> { ports: [{ address, label }] }
 *   POST /flash   -> { ok, code, log, flashBytes, ramBytes }        uploads
 *   POST /compile -> same, plus `hex` when the log names one      no upload
 *
 * Run it with `node tools/arduino-bridge.mjs [--port 8765] [--host 127.0.0.1]`.
 * Tooling -- the tests, and anything that wants a bridge inside its own process
 * -- imports `createBridge` / `startBridge` instead of spawning the command line.
 */
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// ---------------------------------------------------------------------------
// The limits, in one place, so the help text, the tests and the handlers agree
// ---------------------------------------------------------------------------

export const DEFAULT_PORT = 8765;
export const DEFAULT_HOST = '127.0.0.1';
/** A compile that runs longer than this is a hung toolchain, not a slow sketch. */
export const DEFAULT_TIMEOUT_MS = 120_000;
/** The whole JSON request, envelope included; the sketch has its own, smaller cap. */
export const MAX_BODY_BYTES = 1024 * 1024;
/** A generated firmware table is a few kilobytes; half a megabyte is already absurd. */
export const MAX_SKETCH_BYTES = 512 * 1024;
/** How much compiler output the response keeps: enough to read the error, not the whole build. */
export const LOG_TAIL_CHARS = 8 * 1024;

/** How much output is kept *while* a process runs; the response trims it again. */
const RETAIN_TAIL_CHARS = 64 * 1024;
/** Health asks "is it usable?", so a probe must not wait as long as a build. */
const PROBE_TIMEOUT_MS = 10_000;
/** How long a killed compiler gets to exit on its own before SIGKILL. */
const KILL_GRACE_MS = 2_000;
/** The sketch name is a directory name: lowercase, short, and no way out of the temp dir. */
const MAX_PORT_LENGTH = 128;
const MAX_BOARD_OPTIONS_LENGTH = 256;

const CLI_NAME = 'arduino-cli';
const NAME_PATTERN = /^[a-z0-9_]{1,32}$/;
const COM_PORT_PATTERN = /^COM\d+$/i;
const UNIX_PORT_PATTERN = /^\/dev\/tty[\w.-]+$/;
const BOARD_OPTIONS_PATTERN = /^[\w=,]+$/;
const HEX_PATH_PATTERN = /[^\s"'<>]+\.hex\b/gi;
const SKETCH_BYTES_PATTERN = /Sketch uses (\d+) bytes/g;
const RAM_BYTES_PATTERN = /Global variables use (\d+) bytes/g;

/**
 * Only the game's own tabs may call this API.
 *
 * The allowlist is narrow on purpose: `localhost` and `127.0.0.1`, over http,
 * any port (Vite chooses one per run), and nothing else. An `https://localhost`
 * origin is *not* allowed -- the game is served over plain http in development,
 * and adding https would widen the door without a use.
 */
const ORIGIN_PATTERN = /^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d{1,5})?$/;

/**
 * `--host` picks a loopback spelling; it does not open the bridge to a network.
 * Uploading firmware is a physical act, and the fence at the top of this file
 * only works if the socket is unreachable from other machines.
 */
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);

/** The only boards the game generates firmware for; the FQBN is not a free-form string. */
const FQBNS = Object.freeze(['arduino:avr:uno', 'arduino:avr:nano', 'arduino:avr:mega']);

/** The routes, as data, because both the dispatch and the 405 want to know them. */
const ROUTES = Object.freeze([
  { path: '/health', method: 'GET', handle: handleHealth },
  { path: '/ports', method: 'GET', handle: handlePorts },
  { path: '/flash', method: 'POST', handle: (req, config) => handleCompileLike(req, config, true) },
  { path: '/compile', method: 'POST', handle: (req, config) => handleCompileLike(req, config, false) },
]);

// ---------------------------------------------------------------------------
// Parsing the CLI's output
//
// These are exported because they are the part most worth testing directly: a
// log format change in arduino-cli should fail one small test, not a flash.
// ---------------------------------------------------------------------------

/** The last `number` captured by a global regex in `text`, or null. */
function lastNumber(text, pattern) {
  let found = null;
  for (const match of text.matchAll(pattern)) found = Number(match[1]);
  return found;
}

/**
 * The two numbers the game shows beside a build.
 *
 * The exact sentences arduino-cli 1.x prints are
 * `Sketch uses 924 bytes (2%) of program storage space.` and
 * `Global variables use 9 bytes (0%) of dynamic memory.` The last match wins:
 * a build that re-links (or reports a cached size twice) prints the sentences
 * more than once, and the final one describes what was produced.
 */
export function parseSizes(log) {
  const text = typeof log === 'string' ? log : '';
  return {
    flashBytes: lastNumber(text, SKETCH_BYTES_PATTERN),
    ramBytes: lastNumber(text, RAM_BYTES_PATTERN),
  };
}

/**
 * The `.hex` file the compiler named, if it named one.
 *
 * Older arduino-cli builds print the output path on a line of their own; newer
 * ones often do not, so this is best-effort and the response may carry no
 * `hex` at all. The last match wins because a `--build-path` echo can appear
 * before the actual artifact line.
 */
export function parseHexPath(log) {
  const text = typeof log === 'string' ? log : '';
  let found = null;
  for (const match of text.matchAll(HEX_PATH_PATTERN)) found = match[0];
  return found;
}

/**
 * The ports a flash may be pointed at.
 *
 * `arduino-cli board list --format json` reports more than serial ports (the
 * machine that wrote this test had Bluetooth serial sockets), and a board that
 * has not been identified yet is still flashable -- it just has no
 * `matching_boards`. So the filter is the *address shape*, not the board: every
 * port whose address looks like `COM<n>` or `/dev/tty*` is kept, identified or
 * not. A USB device that has not enumerated yet cannot appear here at all.
 */
export function parsePorts(payload) {
  const detected =
    payload !== null && typeof payload === 'object' && Array.isArray(payload.detected_ports)
      ? payload.detected_ports
      : [];
  const seen = new Set();
  const ports = [];
  for (const entry of detected) {
    if (entry === null || typeof entry !== 'object') continue;
    const port = entry.port;
    if (port === null || typeof port !== 'object' || typeof port.address !== 'string') continue;
    const address = port.address.trim();
    if (address === '' || seen.has(address)) continue;
    const looksSerial = COM_PORT_PATTERN.test(address) || UNIX_PORT_PATTERN.test(address);
    // A network or debug protocol port is not something `-p` can upload to.
    if (port.protocol !== undefined && port.protocol !== 'serial' && !looksSerial) continue;
    const boards = Array.isArray(entry.matching_boards) ? entry.matching_boards : [];
    const board = boards.find(
      (candidate) =>
        candidate !== null &&
        typeof candidate === 'object' &&
        typeof candidate.name === 'string' &&
        candidate.name.trim() !== '',
    );
    const label =
      board !== undefined && typeof board.name === 'string'
        ? board.name.trim()
        : typeof port.label === 'string' && port.label.trim() !== ''
          ? port.label.trim()
          : address;
    seen.add(address);
    ports.push({ address, label });
  }
  return ports;
}

/**
 * Whether `arduino-cli core list --format json` says the AVR core is installed.
 *
 * The CLI has reported the installed platform as either `installed_version`
 * (1.x) or `installed: true` (older), and the shape of the rest of the payload
 * has changed often enough that only these two markers are trusted.
 */
export function coreInstalled(payload) {
  const platforms =
    payload !== null && typeof payload === 'object' && Array.isArray(payload.platforms)
      ? payload.platforms
      : [];
  return platforms.some(
    (platform) =>
      platform !== null &&
      typeof platform === 'object' &&
      platform.id === 'arduino:avr' &&
      (platform.installed === true || typeof platform.installed_version === 'string'),
  );
}

/**
 * The end of a log, at most `limit` characters.
 *
 * Characters, not bytes: the log is rendered as a DOM text node, so a byte
 * boundary would cut a multi-byte character for no gain. There is deliberately
 * no truncation marker -- a marker is prose that would appear inside compiler
 * output, and the fixed cap is the behaviour the tests can assert.
 */
export function tailLog(text, limit = LOG_TAIL_CHARS) {
  if (typeof text !== 'string' || text === '' || limit <= 0) return '';
  return text.length <= limit ? text : text.slice(text.length - limit);
}

// ---------------------------------------------------------------------------
// Running a process without a shell
// ---------------------------------------------------------------------------

/** Keep only the tail of a stream as it arrives, so a chatty tool cannot exhaust memory. */
function appendTail(current, chunk) {
  const next = current + chunk;
  return next.length <= RETAIN_TAIL_CHARS ? next : next.slice(next.length - RETAIN_TAIL_CHARS);
}

/**
 * Build the `run(command, args, options)` seam the bridge depends on.
 *
 * The bridge never touches `child_process` itself, which is what lets the tests
 * drive every compile outcome -- success, failure, timeout, missing binary --
 * without arduino-cli installed. The real implementation is the one below:
 * `spawn` with an argv array and `shell: false`, a hard timeout that escalates
 * from SIGTERM to SIGKILL, and a running tail of stdout+stderr.
 *
 * The returned promise always resolves; a process that could not start reports
 * `code: null` with `error`, and a process that had to be killed reports
 * `timedOut: true`, so no caller has to tell the two apart with a try/catch.
 */
export function createProcessRunner(options = {}) {
  const spawnProcess = options.spawn ?? spawn;
  const killGraceMs = options.killGraceMs ?? KILL_GRACE_MS;

  return function run(command, args, runOptions = {}) {
    const timeoutMs = runOptions.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    return new Promise((resolveRun) => {
      let stdout = '';
      let stderr = '';
      let timedOut = false;
      let settled = false;
      let timer = null;
      let killTimer = null;
      let child = null;

      const finish = (result) => {
        if (settled) return;
        settled = true;
        if (timer !== null) clearTimeout(timer);
        if (killTimer !== null) clearTimeout(killTimer);
        resolveRun(result);
      };

      try {
        child = spawnProcess(command, args, {
          // Never a shell: the sketch path and board options are arguments, not
          // fragments of a command line, so they cannot become shell syntax.
          shell: false,
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
      } catch (failure) {
        finish({ code: null, stdout: '', stderr: '', error: messageOf(failure) });
        return;
      }

      child.stdout?.setEncoding('utf8');
      child.stderr?.setEncoding('utf8');
      child.stdout?.on('data', (chunk) => {
        stdout = appendTail(stdout, chunk);
      });
      child.stderr?.on('data', (chunk) => {
        stderr = appendTail(stderr, chunk);
      });

      // `error` and `close` are both terminal and may both fire (ENOENT fires
      // `error`, then `close`); `settled` makes whichever arrives first the answer.
      child.on('error', (failure) => {
        finish({ code: null, stdout, stderr, error: messageOf(failure) });
      });
      child.on('close', (code) => {
        finish(timedOut ? { code: null, stdout, stderr, timedOut: true } : { code, stdout, stderr });
      });

      timer = setTimeout(() => {
        timedOut = true;
        try {
          child.kill();
        } catch {
          // The process may already be gone; the close handler still fires.
        }
        killTimer = setTimeout(() => {
          try {
            child.kill('SIGKILL');
          } catch {
            // Same: nothing is left to kill, or the platform refused it.
          }
        }, killGraceMs);
        // Do not let the escalation timer be the reason a finished bridge stays alive.
        killTimer.unref?.();
      }, timeoutMs);
    });
  };
}

// ---------------------------------------------------------------------------
// Default dependencies
// ---------------------------------------------------------------------------

/** Parse JSON without throwing; a CLI that prints a banner before its JSON is a failed probe. */
function parseJson(text) {
  if (typeof text !== 'string') return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** stdout then stderr; arduino-cli writes diagnostics to stderr, and the reader wants both. */
function combineOutput(result) {
  const parts = [];
  if (typeof result.stdout === 'string' && result.stdout !== '') parts.push(result.stdout);
  if (typeof result.stderr === 'string' && result.stderr !== '') parts.push(result.stderr);
  return parts.join(parts.length > 1 ? '\n' : '');
}

function messageOf(failure) {
  return failure instanceof Error ? failure.message : String(failure);
}

/**
 * The real dependencies, wrapping the real CLI.
 *
 * Every one of them is replaceable through `createBridge({ run, listPorts,
 * cliVersion, tmpRoot })`; the replacements are what the unit tests use. On a
 * machine without arduino-cli, `cliVersion` rejects (spawn ENOENT) and /health
 * says so instead of throwing -- the game should explain, not fail.
 */
function resolveDeps(options) {
  const cliPath = options.cliPath ?? process.env.TC_ARDUINO_CLI ?? CLI_NAME;
  const run = options.run ?? createProcessRunner();

  /** One short probe of the CLI; a failing probe becomes a readable Error. */
  const probe = async (args) => {
    const result = await run(cliPath, args, { timeoutMs: PROBE_TIMEOUT_MS });
    if (result.timedOut) throw new Error(`\`${CLI_NAME} ${args[0]}\` timed out`);
    if (result.code !== 0) {
      const detail = tailLog(combineOutput(result), 500);
      throw new Error(detail !== '' ? detail : (result.error ?? `\`${CLI_NAME} ${args[0]}\` exited with ${result.code}`));
    }
    return result.stdout;
  };

  return {
    run,
    cliPath,
    tmpRoot: options.tmpRoot ?? tmpdir(),
    listPorts:
      options.listPorts ??
      (async () => parsePorts(parseJson(await probe(['board', 'list', '--format', 'json'])))),
    cliVersion:
      options.cliVersion ??
      (async () => {
        const payload = parseJson(await probe(['version', '--format', 'json']));
        const version =
          payload !== null && typeof payload === 'object' ? payload.VersionString : undefined;
        if (typeof version !== 'string' || version === '') {
          throw new Error('`arduino-cli version --format json` did not report a VersionString');
        }
        return version;
      }),
  };
}

/**
 * The optional shared secret, read once when the bridge is created.
 *
 * It is not a security boundary against a malicious local process -- such a
 * process can set any header -- but it does keep *other tabs* and accidental
 * curl invocations from flashing a board, which is the kind of accident worth
 * preventing. An empty string means "no token", not "an empty token": an
 * exported variable left blank must not silently authenticate everything.
 */
function resolveToken(explicit) {
  if (typeof explicit === 'string' && explicit !== '') return explicit;
  const fromEnvironment = process.env.TC_ARDUINO_TOKEN;
  if (typeof fromEnvironment === 'string' && fromEnvironment.trim() !== '') {
    return fromEnvironment.trim();
  }
  return null;
}

/** Everything a request handler needs, resolved once per server. */
function resolveConfig(options) {
  return {
    deps: resolveDeps(options),
    token: resolveToken(options.token),
    timeoutMs:
      typeof options.timeoutMs === 'number' && options.timeoutMs > 0
        ? options.timeoutMs
        : DEFAULT_TIMEOUT_MS,
    bodyLimit:
      typeof options.bodyLimit === 'number' && options.bodyLimit > 0
        ? options.bodyLimit
        : MAX_BODY_BYTES,
  };
}

// ---------------------------------------------------------------------------
// HTTP plumbing
// ---------------------------------------------------------------------------

function isAllowedOrigin(origin) {
  return typeof origin === 'string' && ORIGIN_PATTERN.test(origin);
}

/**
 * Send one JSON answer, with the CORS headers the game's tab needs to read it.
 *
 * The allowed Origin is echoed rather than replaced with `*`, because `*` plus
 * the custom `X-TC-Arduino` header would require `Access-Control-Allow-Headers`
 * on every response and would let any web page read the answer. A refusal from
 * a foreign origin is sent without CORS headers at all, so the page that tried
 * it cannot distinguish the JSON from a network error.
 */
function sendJson(req, res, status, body, extraHeaders = {}) {
  if (res.headersSent || res.writableEnded) return;
  const headers = {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    ...extraHeaders,
  };
  const origin = req.headers.origin;
  if (isAllowedOrigin(origin)) {
    headers['access-control-allow-origin'] = origin;
    headers.vary = 'Origin';
  }
  res.writeHead(status, headers);
  res.end(JSON.stringify(body));
}

/** Answer a CORS preflight; no custom headers exist on a preflight, so no auth is possible. */
function handlePreflight(req, res) {
  req.resume();
  const origin = req.headers.origin;
  if (!isAllowedOrigin(origin)) {
    sendJson(req, res, 403, { ok: false, error: 'origin not allowed' });
    return;
  }
  res.writeHead(204, {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'Content-Type, X-TC-Arduino, X-TC-Token',
    'access-control-max-age': '600',
    vary: 'Origin',
    'cache-control': 'no-store',
  });
  res.end();
}

/**
 * Read a JSON request body that is at most `limit` bytes.
 *
 * A body over the limit is drained and then refused, rather than having its
 * socket reset mid-upload: the browser can then read the 413, and a keep-alive
 * connection stays usable. The received chunks are dropped the moment the limit
 * is crossed, so memory stays bounded even for a body that is far too large.
 */
function readJsonBody(req, limit) {
  const mediaType = String(req.headers['content-type'] ?? '')
    .split(';')[0]
    ?.trim()
    .toLowerCase();
  if (mediaType !== 'application/json') {
    req.resume();
    return Promise.resolve({ ok: false, status: 415, error: 'content-type must be application/json' });
  }
  const declared = Number(req.headers['content-length']);
  if (Number.isFinite(declared) && declared > limit) {
    req.resume();
    return Promise.resolve({ ok: false, status: 413, error: `body larger than ${limit} bytes` });
  }
  return new Promise((resolveBody) => {
    let settled = false;
    const chunks = [];
    let size = 0;
    let tooLarge = false;
    const settle = (result) => {
      if (settled) return;
      settled = true;
      resolveBody(result);
    };
    req.on('data', (chunk) => {
      if (tooLarge) return;
      size += chunk.length;
      if (size > limit) {
        tooLarge = true;
        chunks.length = 0;
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (tooLarge) {
        settle({ ok: false, status: 413, error: `body larger than ${limit} bytes` });
        return;
      }
      const text = Buffer.concat(chunks).toString('utf8');
      try {
        settle({ ok: true, value: JSON.parse(text) });
      } catch {
        settle({ ok: false, status: 400, error: 'body is not valid JSON' });
      }
    });
    req.on('error', () => settle({ ok: false, status: 400, error: 'request body could not be read' }));
    req.on('close', () => {
      if (!req.complete) settle({ ok: false, status: 400, error: 'request body was cut short' });
    });
  });
}

// ---------------------------------------------------------------------------
// Request validation
// ---------------------------------------------------------------------------

function refuse(field, error) {
  return { ok: false, field, error };
}

/**
 * Check a compile request before anything is written or spawned.
 *
 * The name becomes a directory name under the OS temp root and the FQBN, port
 * and board options become arguments; this is where all four are held to a
 * shape that cannot escape the temp directory, cannot inject an argument, and
 * names a board the game actually has a backend for. The string caps on port
 * and board options are there for Windows' argv length limit as much as for
 * sanity.
 */
function validateCompileRequest(value, upload) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, error: 'body must be a JSON object' };
  }
  if (typeof value.name !== 'string' || !NAME_PATTERN.test(value.name)) {
    return refuse('name', 'name must match /^[a-z0-9_]{1,32}$/');
  }
  if (typeof value.sketch !== 'string' || value.sketch.trim() === '') {
    return refuse('sketch', 'sketch must be a non-empty string');
  }
  if (Buffer.byteLength(value.sketch, 'utf8') > MAX_SKETCH_BYTES) {
    return refuse('sketch', `sketch is larger than ${MAX_SKETCH_BYTES} bytes`);
  }
  if (typeof value.fqbn !== 'string' || !FQBNS.includes(value.fqbn)) {
    return refuse('fqbn', `fqbn must be one of ${FQBNS.join(', ')}`);
  }
  const checked = { name: value.name, sketch: value.sketch, fqbn: value.fqbn };
  if (upload) {
    if (
      typeof value.port !== 'string' ||
      value.port.length > MAX_PORT_LENGTH ||
      !(COM_PORT_PATTERN.test(value.port) || UNIX_PORT_PATTERN.test(value.port))
    ) {
      return refuse('port', 'port must be COM<number> or /dev/tty<name>');
    }
    checked.port = value.port;
  }
  if (value.boardOptions !== undefined) {
    if (
      typeof value.boardOptions !== 'string' ||
      value.boardOptions.length > MAX_BOARD_OPTIONS_LENGTH ||
      !BOARD_OPTIONS_PATTERN.test(value.boardOptions)
    ) {
      return refuse(
        'boardOptions',
        'boardOptions may contain only letters, digits, underscore, comma and equals',
      );
    }
    checked.boardOptions = value.boardOptions;
  }
  return { ok: true, value: checked };
}

/** The arduino-cli argv for a validated request; the only place the flags are written. */
function compileArgs(request, sketchDir, upload) {
  const args = ['compile', '--fqbn', request.fqbn];
  if (upload) args.push('-u', '-p', request.port);
  if (request.boardOptions !== undefined) args.push('--board-options', request.boardOptions);
  args.push('--warnings', 'none', sketchDir);
  return args;
}

// ---------------------------------------------------------------------------
// Compiling and flashing
// ---------------------------------------------------------------------------

/**
 * Write the sketch, run the CLI, read its result, and always remove the sketch.
 *
 * The sketch lands at `<tmpRoot>/<random>/<name>/<name>.ino` because arduino-cli
 * insists that the sketch folder and the `.ino` file share a name. The random
 * parent keeps two requests from colliding, and the `finally` removes it
 * whether the CLI succeeded, failed, timed out, or could not start -- one
 * generated table's worth of files should not outlive the request that made it.
 *
 * A CLI failure is a *result*, not an exception: the panel needs to show the
 * compiler's log, so every outcome below `validateCompileRequest` answers 200
 * with `ok: false`. Only a bug in the bridge itself becomes a 500.
 */
async function runCompile(config, request, upload) {
  let root = null;
  try {
    await mkdir(config.deps.tmpRoot, { recursive: true });
    root = await mkdtemp(join(config.deps.tmpRoot, 'tc-arduino-'));
    const sketchDir = join(root, request.name);
    await mkdir(sketchDir, { recursive: true });
    await writeFile(join(sketchDir, `${request.name}.ino`), request.sketch, 'utf8');

    const args = compileArgs(request, sketchDir, upload);
    let execution;
    try {
      execution = await config.deps.run(config.deps.cliPath, args, { timeoutMs: config.timeoutMs });
    } catch (failure) {
      // The seam is allowed to throw; a runner that does still becomes a result.
      return {
        ok: false,
        code: null,
        log: '',
        flashBytes: null,
        ramBytes: null,
        error: messageOf(failure),
      };
    }

    const log = combineOutput(execution);
    const sizes = parseSizes(log);
    const result = {
      ok: execution.code === 0,
      code: execution.code,
      log: tailLog(log),
      flashBytes: sizes.flashBytes,
      ramBytes: sizes.ramBytes,
    };
    if (!upload) {
      const hex = parseHexPath(log);
      if (hex !== null) result.hex = hex;
    }
    if (execution.error !== undefined) result.error = execution.error;
    if (execution.timedOut === true) {
      result.timedOut = true;
      result.error ??= `arduino-cli timed out after ${config.timeoutMs} ms`;
    }
    if (result.code === null && result.error === undefined && result.timedOut !== true) {
      result.error = 'arduino-cli could not be started';
    }
    return result;
  } catch (failure) {
    return {
      ok: false,
      code: null,
      log: '',
      flashBytes: null,
      ramBytes: null,
      error: `could not prepare the sketch: ${messageOf(failure)}`,
    };
  } finally {
    if (root !== null) {
      try {
        await rm(root, { recursive: true, force: true });
      } catch {
        // Best effort: the OS temp cleaner will take it, and a failed request
        // must not also become an unhandled rejection.
      }
    }
  }
}

async function handleCompileLike(req, config, upload) {
  const body = await readJsonBody(req, config.bodyLimit);
  if (!body.ok) return { status: body.status, body: { ok: false, error: body.error } };
  const checked = validateCompileRequest(body.value, upload);
  if (!checked.ok) {
    return { status: 400, body: { ok: false, error: checked.error, field: checked.field } };
  }
  const result = await runCompile(config, checked.value, upload);
  return { status: 200, body: result };
}

// ---------------------------------------------------------------------------
// The read-only endpoints
// ---------------------------------------------------------------------------

/** One short CLI probe for /health; throws so the caller can report it as text. */
async function runProbe(config, args) {
  const result = await config.deps.run(config.deps.cliPath, args, { timeoutMs: PROBE_TIMEOUT_MS });
  if (result.timedOut) throw new Error(`\`${CLI_NAME} ${args[0]}\` timed out`);
  if (result.code !== 0) {
    const detail = tailLog(combineOutput(result), 500);
    throw new Error(detail !== '' ? detail : (result.error ?? `\`${CLI_NAME} ${args[0]}\` exited with ${result.code}`));
  }
  return result.stdout;
}

/**
 * The one endpoint the game calls before offering the flash panel.
 *
 * It answers 200 in every case -- "the CLI is missing" is a state the UI has to
 * render, not a transport failure -- and `ok` means "a flash could plausibly
 * work": the CLI answered *and* the AVR core is installed. `ports` is always
 * present (possibly empty) so the UI does not need a second round trip for it.
 */
async function handleHealth(_request, config) {
  let cli = null;
  let error = null;
  try {
    const reported = await config.deps.cliVersion();
    if (typeof reported === 'string' && reported !== '') cli = reported;
    else error = 'arduino-cli did not report a version';
  } catch (failure) {
    error = messageOf(failure);
  }

  let core = false;
  if (cli !== null) {
    try {
      core = coreInstalled(parseJson(await runProbe(config, ['core', 'list', '--format', 'json'])));
    } catch (failure) {
      error ??= messageOf(failure);
    }
  }

  let ports = [];
  try {
    ports = await config.deps.listPorts();
  } catch (failure) {
    error ??= messageOf(failure);
  }

  const ok = cli !== null && core;
  const body = { ok, cli, core, ports };
  if (!ok) {
    body.error =
      error ??
      (cli === null ? 'arduino-cli is not installed' : 'the arduino:avr core is not installed');
  }
  return { status: 200, body };
}

/**
 * The list a flash panel shows in its port picker.
 *
 * A failing `board list` answers 200 with an empty list and the error text: the
 * game then offers no port instead of an exception, which is what a player with
 * an unplugged board should see either way.
 */
async function handlePorts(_request, config) {
  try {
    return { status: 200, body: { ports: await config.deps.listPorts() } };
  } catch (failure) {
    return { status: 200, body: { ports: [], error: messageOf(failure) } };
  }
}

// ---------------------------------------------------------------------------
// Dispatch and the security gate
// ---------------------------------------------------------------------------

/**
 * Refuse a request that did not come from the game's own tab.
 *
 * Order matters for the diagnostics: a foreign Origin is refused even when it
 * also guesses the header, then the header (which a cross-origin page cannot
 * set without a preflight this server would have to approve), then the token.
 */
function authorize(req, config) {
  const origin = req.headers.origin;
  if (origin !== undefined && !isAllowedOrigin(origin)) {
    return { status: 403, error: 'origin not allowed' };
  }
  if (req.headers['x-tc-arduino'] !== '1') {
    return { status: 403, error: 'missing X-TC-Arduino: 1 header' };
  }
  if (config.token !== null && !tokenMatches(req.headers['x-tc-token'], config.token)) {
    return { status: 401, error: 'missing or wrong X-TC-Token' };
  }
  return null;
}

/**
 * Compare the token without revealing where it first differs.
 *
 * Length is not hidden (it is not worth the ceremony on a loopback daemon that
 * already refuses foreign origins); the point is only that a wrong token costs
 * a full scan, the same as a right one.
 */
function tokenMatches(given, expected) {
  if (typeof given !== 'string' || given.length !== expected.length) return false;
  let difference = 0;
  for (let index = 0; index < expected.length; index += 1) {
    difference |= given.charCodeAt(index) ^ expected.charCodeAt(index);
  }
  return difference === 0;
}

async function handleRequest(req, res, config) {
  const url = new URL(req.url ?? '/', `http://${DEFAULT_HOST}`);
  const method = req.method ?? 'GET';

  // A preflight cannot carry the custom header it is asking about, so it is
  // answered before the gate below; it is still protected by the Origin check.
  if (method === 'OPTIONS') {
    handlePreflight(req, res);
    return;
  }

  const route = ROUTES.find((candidate) => candidate.path === url.pathname);
  if (route === undefined) {
    req.resume();
    sendJson(req, res, 404, { ok: false, error: 'not found' });
    return;
  }
  if (route.method !== method) {
    req.resume();
    sendJson(req, res, 405, { ok: false, error: 'method not allowed' }, { allow: route.method });
    return;
  }

  const refusal = authorize(req, config);
  if (refusal !== null) {
    req.resume();
    sendJson(req, res, refusal.status, { ok: false, error: refusal.error });
    return;
  }

  const reply = await route.handle(req, config);
  sendJson(req, res, reply.status, reply.body);
}

// ---------------------------------------------------------------------------
// The seams the tests and the command line both use
// ---------------------------------------------------------------------------

/**
 * Build an `http.Server` for the bridge without listening on it.
 *
 * This is the seam the tests take: they hand in fake dependencies, listen on
 * port 0, and never touch arduino-cli. `startBridge` below is the same server
 * plus flags and lifecycle; `main` is `startBridge` plus a command line.
 */
export function createBridge(options = {}) {
  const config = resolveConfig(options);
  const server = createServer((req, res) => {
    handleRequest(req, res, config).catch((failure) => {
      // A bug in a handler must not become an unhandled rejection or a socket the
      // browser waits on forever; the game can read JSON, so it gets JSON.
      try {
        if (!res.headersSent) sendJson(req, res, 500, { ok: false, error: 'internal bridge error' });
        else res.destroy();
      } catch {
        // The socket is already gone; there is nowhere to report this.
      }
      console.error('[arduino-bridge] request failed:', failure);
    });
  });
  server.on('clientError', (_failure, socket) => {
    // A malformed request line deserves a clean close, not a stack trace.
    if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
  });
  return server;
}

/** Resolve `server.close()` and drop idle keep-alive sockets that would delay it. */
function closeServer(server) {
  return new Promise((resolveClose) => {
    server.close(() => resolveClose());
    // `close()` waits for existing keep-alive connections; a bridge that has
    // been asked to stop should not be kept alive by one idle browser tab.
    server.closeAllConnections?.();
  });
}

/**
 * Listen on a loopback interface and return the handle the process needs.
 *
 * A non-loopback `host` is refused outright: the fence around this bridge is
 * the bind address, and a compiler daemon reachable over the network is a way
 * to flash someone else's board. `--host` therefore chooses a loopback spelling
 * (`localhost` may resolve to ::1), not an interface.
 */
export async function startBridge(options = {}) {
  const host = options.host ?? DEFAULT_HOST;
  if (!LOOPBACK_HOSTS.has(host)) {
    throw new Error(
      `refusing to bind ${host}: the bridge can compile and flash hardware, so it stays on loopback (use 127.0.0.1, localhost or ::1)`,
    );
  }
  const port = options.port ?? DEFAULT_PORT;
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`invalid port: ${String(port)}`);
  }

  const server = createBridge(options);
  await new Promise((resolveListen, rejectListen) => {
    const onError = (failure) => {
      server.off('error', onError);
      rejectListen(failure);
    };
    server.once('error', onError);
    server.listen(port, host, () => {
      server.off('error', onError);
      resolveListen();
    });
  });

  const address = server.address();
  const boundPort = address !== null && typeof address === 'object' ? address.port : port;
  const authority = host.includes(':') ? `[${host}]` : host;
  return {
    server,
    host,
    port: boundPort,
    url: `http://${authority}:${boundPort}`,
    tokenRequired: resolveToken(options.token) !== null,
    close: () => closeServer(server),
  };
}

// ---------------------------------------------------------------------------
// The command line
// ---------------------------------------------------------------------------

export function usage() {
  return `Usage: node tools/arduino-bridge.mjs [--port <port>] [--host <loopback>]

Compile the sandbox's exported sketch and upload it to an Arduino board.
Starts an HTTP server on http://127.0.0.1:8765 (port 0 picks a free one).

Options:
  --port <port>    Port to listen on (default ${DEFAULT_PORT}; 0 picks a free one).
  --host <host>    Loopback interface to bind (default ${DEFAULT_HOST};
                   also accepts localhost and ::1 -- never a public interface).
  --help, -h       Show this help and exit.

Security:
  Bind address is loopback only. Every request must carry the header
  \`X-TC-Arduino: 1\` and, when TC_ARDUINO_TOKEN is set in the environment,
  the matching \`X-TC-Token\` header (the X-TC-Token header is required when
  a token is configured, regardless of how the token was provided).
  Origins are restricted to http://localhost:* and http://127.0.0.1:*.
  Request bodies are limited to ${MAX_BODY_BYTES} bytes and sketches to
  ${MAX_SKETCH_BYTES} bytes.

Endpoints:
  GET  /health   -> { ok, cli, core, ports } (200 even if arduino-cli is missing)
  GET  /ports    -> { ports: [{ address, label }] }
  POST /flash    -> { ok, code, log, flashBytes, ramBytes } -- compiles and uploads
  POST /compile  -> same, plus \`hex\` when the log names one -- compiles only

Requires arduino-cli on PATH (or TC_ARDUINO_CLI to point at it).`;
}

/**
 * Parse the bridge's own flags.
 *
 * Kept separate from `main` so a bad flag is a usage error with exit code 2,
 * while a server that cannot start is an operational error with exit code 1 --
 * the distinction a script wrapping this needs to see.
 */
export function parseArgs(argv) {
  const options = { port: DEFAULT_PORT, host: DEFAULT_HOST, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--help' || argument === '-h') {
      options.help = true;
    } else if (argument === '--port') {
      const raw = argv[index + 1];
      if (raw === undefined) throw new Error('--port needs a value');
      index += 1;
      const port = Number(raw);
      if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error(`invalid port: ${raw}`);
      options.port = port;
    } else if (argument === '--host') {
      const raw = argv[index + 1];
      if (raw === undefined) throw new Error('--host needs a value');
      index += 1;
      options.host = raw;
    } else {
      throw new Error(`unknown argument: ${String(argument)}`);
    }
  }
  return options;
}

/**
 * The command-line entry point.
 *
 * Resolves when the server is listening; the process then stays alive because
 * the server handle does. SIGINT/SIGTERM close it and let the event loop drain,
 * so a Ctrl+C in the terminal is a clean stop rather than a killed port.
 */
export async function main(argv = process.argv.slice(2)) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (failure) {
    console.error(`arduino-bridge: ${messageOf(failure)}`);
    console.error(usage());
    process.exitCode = 2;
    return;
  }
  if (options.help) {
    console.log(usage());
    return;
  }

  let bridge;
  try {
    bridge = await startBridge(options);
  } catch (failure) {
    console.error(`arduino-bridge: could not start: ${messageOf(failure)}`);
    process.exitCode = 1;
    return;
  }

  console.log(
    `arduino-bridge listening on ${bridge.url}${bridge.tokenRequired ? ' (X-TC-Token required)' : ''}`,
  );
  console.log('Every request needs the header `X-TC-Arduino: 1`. Press Ctrl+C to stop.');

  const shutdown = () => {
    bridge.close().then(
      () => {
        process.exitCode = 0;
      },
      () => {
        process.exitCode = 0;
      },
    );
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

// Run only when executed, not when imported by the tests (or by a future UI
// harness): `import.meta.url` and `process.argv[1]` are the same file exactly
// when this module is the entry point.
const invokedPath = process.argv[1];
if (
  invokedPath !== undefined &&
  typeof import.meta.url === 'string' &&
  pathToFileURL(resolve(invokedPath)).href === import.meta.url
) {
  main().catch((failure) => {
    console.error('arduino-bridge: fatal:', failure);
    process.exitCode = 1;
  });
}
