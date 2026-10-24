import type { BoardId } from './boards';
import { emitSketch } from './emit';
import type { ProgramImage } from './image';

/**
 * The browser's side of `tools/arduino-bridge.mjs`.
 *
 * THE GAME CANNOT START A PROCESS, so the half of the feature that runs
 * `arduino-cli` lives in a local daemon and this file is the client for it. The
 * bridge's contract (headers, routes, JSON shapes) is documented at the top of
 * `tools/arduino-bridge.mjs`; the types below restate the parts the panel reads,
 * and `client.test.ts` pins them against a fake fetch rather than a real board.
 *
 * NOTHING HERE THROWS FOR AN EXPECTED FAILURE. "The bridge is not running", "the
 * CLI is missing" and "the sketch did not compile" are all states the panel has
 * to render, so each is a value: a health result with `ok: false`, or a build
 * result carrying the compiler's log. A thrown error is kept for a bug in this
 * file, exactly as `build.ts` treats a refusal.
 */

/** Where the bridge listens unless the player changed it. */
export const DEFAULT_BRIDGE_URL = 'http://127.0.0.1:8765';

/** The default cap for a request; `arduino-cli compile` itself is capped at 120 s. */
export const DEFAULT_REQUEST_TIMEOUT_MS = 150_000;

/** One selectable serial port, as the port picker shows it. */
export interface PortInfo {
  readonly address: string;
  readonly label: string;
}

/** The `/health` answer, or this client's version of "there is no bridge". */
export interface BridgeHealth {
  readonly ok: boolean;
  readonly cli: string | null;
  readonly core: boolean;
  readonly ports: readonly PortInfo[];
  readonly error?: string;
}

/** The `/compile` and `/flash` answer. */
export interface BridgeBuild {
  readonly ok: boolean;
  readonly code: number | null;
  readonly log: string;
  readonly flashBytes: number | null;
  readonly ramBytes: number | null;
  readonly hex?: string;
  readonly error?: string;
  readonly timedOut?: boolean;
}

/** One request body, after `name`/`sketch` have been generated. */
export interface SketchRequest {
  readonly name: string;
  readonly sketch: string;
  readonly fqbn: BoardId;
  readonly port?: string;
  readonly boardOptions?: string;
}

/** The generated sketch and the file name it should be saved under. */
export interface SketchPlan {
  readonly request: SketchRequest;
  readonly fileName: string;
}

/**
 * The subset of `fetch` this client uses.
 *
 * Declared structurally rather than as `typeof fetch` so a test can hand in a
 * four-line function: the real `fetch` satisfies it, and no `@types/node` or DOM
 * response internals are needed to write the fake.
 */
export type FetchLike = (
  input: string,
  init?: {
    readonly method?: string;
    readonly headers?: Record<string, string>;
    readonly body?: string;
    readonly signal?: AbortSignal;
  },
) => Promise<{ readonly ok: boolean; readonly status: number; json(): Promise<unknown> }>;

export interface FlashClientOptions {
  /** Defaults to `DEFAULT_BRIDGE_URL`. A trailing slash is tolerated. */
  readonly baseUrl?: string;
  /** Sent as `X-TC-Token` when non-empty; the bridge requires it when configured. */
  readonly token?: string;
  /** The `fetch` seam; defaults to the platform's. */
  readonly fetch?: FetchLike;
  /** Defaults to `DEFAULT_REQUEST_TIMEOUT_MS`. */
  readonly timeoutMs?: number;
}

/**
 * A sketch name the bridge will accept as a directory name.
 *
 * The bridge's pattern is `^[a-z0-9_]{1,32}$`; a level id is already lowercase
 * (`sandbox`), but the prefix and the filter mean an id that ever grew a dash or
 * a unicode character cannot turn a save into a 400 from the bridge. The file
 * name is the sketch name plus `.ino`, because arduino-cli requires the folder
 * and the `.ino` to share a name -- which is what makes the downloaded file
 * directly usable.
 */
export function sketchNameFor(level: string): string {
  const cleaned = level
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return `tc_${cleaned || 'circuit'}`.slice(0, 32);
}

/** The sketch text and the request that would compile it. */
export function planSketch(
  image: ProgramImage,
  board: BoardId,
  options: { readonly port?: string; readonly name?: string } = {},
): SketchPlan {
  const name = options.name ?? sketchNameFor(image.level);
  const request: SketchRequest =
    options.port === undefined
      ? { name, sketch: emitSketch(image, { name }), fqbn: board }
      : { name, sketch: emitSketch(image, { name }), fqbn: board, port: options.port };
  return { request, fileName: `${name}.ino` };
}

/** A record, or `null` when the value is not a JSON object. */
function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function textOf(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function numberOf(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function portsOf(value: unknown): PortInfo[] {
  if (!Array.isArray(value)) return [];
  const ports: PortInfo[] = [];
  for (const entry of value) {
    const record = asRecord(entry);
    if (record === null) continue;
    const address = textOf(record.address);
    if (address === undefined || address === '') continue;
    ports.push({ address, label: textOf(record.label) ?? address });
  }
  return ports;
}

function healthOf(value: unknown): BridgeHealth {
  const record = asRecord(value);
  if (record === null) {
    return { ok: false, cli: null, core: false, ports: [], error: '本地桥返回了无法识别的响应' };
  }
  const cli = typeof record.cli === 'string' ? record.cli : null;
  const core = record.core === true;
  const health: BridgeHealth = {
    ok: record.ok === true && cli !== null && core,
    cli,
    core,
    ports: portsOf(record.ports),
  };
  const error = textOf(record.error);
  return error === undefined ? health : { ...health, error };
}

function buildOf(value: unknown): BridgeBuild {
  const record = asRecord(value);
  if (record === null) {
    return {
      ok: false,
      code: null,
      log: '',
      flashBytes: null,
      ramBytes: null,
      error: '本地桥返回了无法识别的响应',
    };
  }
  const build: BridgeBuild = {
    ok: record.ok === true,
    code: numberOf(record.code),
    log: textOf(record.log) ?? '',
    flashBytes: numberOf(record.flashBytes),
    ramBytes: numberOf(record.ramBytes),
  };
  const error = textOf(record.error);
  const hex = textOf(record.hex);
  const timedOut = record.timedOut === true;
  return {
    ...build,
    ...(error === undefined ? {} : { error }),
    ...(hex === undefined ? {} : { hex }),
    ...(timedOut ? { timedOut } : {}),
  };
}

/** The sentence a player sees when the daemon is not there at all. */
export const NO_BRIDGE =
  '连不上本地桥：请先在仓库根目录运行 `node tools/arduino-bridge.mjs`，并确认地址与端口一致。';

export class FlashClient {
  readonly baseUrl: string;
  private readonly token: string;
  private readonly fetcher: FetchLike;
  private readonly timeoutMs: number;

  constructor(options: FlashClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? DEFAULT_BRIDGE_URL).replace(/\/+$/, '');
    this.token = options.token ?? '';
    this.fetcher = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
    this.timeoutMs = options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  }

  /** GET `/health`: is there a CLI, is the AVR core installed, what ports? */
  async health(): Promise<BridgeHealth> {
    const reply = await this.send('/health', { method: 'GET' });
    if (!reply.ok) {
      return { ok: false, cli: null, core: false, ports: [], error: reply.error };
    }
    return healthOf(reply.value);
  }

  /** GET `/ports`: just the picker's list, with the bridge's error text on failure. */
  async ports(): Promise<{ readonly ports: readonly PortInfo[]; readonly error?: string }> {
    const reply = await this.send('/ports', { method: 'GET' });
    if (!reply.ok) return { ports: [], error: reply.error };
    const record = asRecord(reply.value);
    const error = textOf(record?.error);
    const ports = record === null ? [] : portsOf(record.ports);
    return error === undefined ? { ports } : { ports, error };
  }

  /** POST `/compile`: build the sketch and report its sizes, upload nothing. */
  async compile(request: SketchRequest): Promise<BridgeBuild> {
    return this.post('/compile', request);
  }

  /** POST `/flash`: compile and upload. The port is required by the contract. */
  async flash(request: SketchRequest & { readonly port: string }): Promise<BridgeBuild> {
    return this.post('/flash', request);
  }

  private async post(path: string, request: SketchRequest): Promise<BridgeBuild> {
    const reply = await this.send(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request),
    });
    if (!reply.ok) {
      return {
        ok: false,
        code: null,
        log: '',
        flashBytes: null,
        ramBytes: null,
        error: reply.error,
      };
    }
    return buildOf(reply.value);
  }

  /**
   * One request, with the bridge's two mandatory envelopes and a timeout.
   *
   * A failed request is a value: the panel shows the same sentence whether the
   * daemon is down, the URL is wrong, or the browser refused the cross-origin
   * call. The timeout is there because a compile that hangs would otherwise
   * leave the panel's 编译 button disabled forever.
   */
  private async send(
    path: string,
    init: { readonly method: string; readonly headers?: Record<string, string>; readonly body?: string },
  ): Promise<{ readonly ok: true; readonly value: unknown } | { readonly ok: false; readonly error: string }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const headers: Record<string, string> = { 'X-TC-Arduino': '1', ...init.headers };
      if (this.token !== '') headers['X-TC-Token'] = this.token;
      const response = await this.fetcher(`${this.baseUrl}${path}`, { ...init, headers, signal: controller.signal });
      let body: unknown = null;
      try {
        body = await response.json();
      } catch {
        body = null;
      }
      if (!response.ok) {
        const record = asRecord(body);
        const detail = record === null ? '' : textOf(record.error) ?? '';
        return {
          ok: false,
          error: detail === '' ? `本地桥返回 HTTP ${response.status}` : `本地桥返回 HTTP ${response.status}：${detail}`,
        };
      }
      return { ok: true, value: body };
    } catch {
      return { ok: false, error: NO_BRIDGE };
    } finally {
      clearTimeout(timer);
    }
  }
}
