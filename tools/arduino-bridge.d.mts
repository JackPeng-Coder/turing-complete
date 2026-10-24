/**
 * Types for the local arduino-cli bridge (`tools/arduino-bridge.mjs`).
 *
 * The project's tsconfig lists only `vitest/globals` in `types`, so Node's
 * ambient declarations are absent on purpose (no `@types/node` dependency).
 * Every type below is therefore a hand-written structural description of what
 * the bridge returns -- enough for `test/flash/bridge.test.ts` to be checked,
 * without importing a single `node:*` type into this program.
 */

/** What one spawned process reports. */
export interface RunResult {
  /** Exit code, or null when the process could not start or was killed by the timeout. */
  code: number | null;
  stdout: string;
  stderr: string;
  /** Present when the process could not be started (for example `spawn ... ENOENT`). */
  error?: string;
  /** True when the runner killed the process for exceeding its timeout. */
  timedOut?: boolean;
}

export interface RunOptions {
  /** Hard cap in milliseconds; the bridge passes its own config down to the runner. */
  timeoutMs?: number;
}

/** The injected spawn seam. Always resolves; failure is a result, not a rejection. */
export type RunFn = (command: string, args: readonly string[], options?: RunOptions) => Promise<RunResult>;

/** One selectable serial port, as shown in the game's port picker. */
export interface PortInfo {
  address: string;
  label: string;
}

/** The dependencies `createBridge` accepts. Omitted fields default to the real CLI. */
export interface BridgeDeps {
  run?: RunFn;
  listPorts?: () => Promise<PortInfo[]>;
  cliVersion?: () => Promise<string>;
  /** Directory the per-request random sketch folders are created under. */
  tmpRoot?: string;
  /** Path or name of the arduino-cli binary; defaults to `arduino-cli`. */
  cliPath?: string;
}

/** Everything the bridge server itself is configured with. */
export interface BridgeOptions extends BridgeDeps {
  /** When non-empty, requests must also carry `X-TC-Token` with this value. */
  token?: string;
  /** Compile timeout in milliseconds; defaults to 120000. */
  timeoutMs?: number;
  /** Request body cap in bytes; defaults to 1 MiB. */
  bodyLimit?: number;
}

/** The success/failure shape of /flash and /compile. */
export interface CompileResult {
  /** True only when arduino-cli exited 0. */
  ok: boolean;
  /** The CLI's exit code, null if it never ran or was killed. */
  code: number | null;
  /** The end of the compiler output (bounded to ~8 KiB). */
  log: string;
  /** `Sketch uses N bytes`, or null when the log did not report it. */
  flashBytes: number | null;
  /** `Global variables use N bytes`, or null when the log did not report it. */
  ramBytes: number | null;
  /** The `.hex` path named in the log; only /compile looks for one. */
  hex?: string;
  /** Human-readable reason when the process did not produce a normal result. */
  error?: string;
  /** True when the CLI was killed for exceeding the bridge's timeout. */
  timedOut?: boolean;
}

/** The /health answer. `ok` means "the CLI answered and the AVR core is installed". */
export interface HealthResult {
  ok: boolean;
  cli: string | null;
  core: boolean;
  ports: PortInfo[];
  error?: string;
}

/**
 * The subset of `http.Server` this bridge hands back.
 *
 * Structural rather than imported: the declaration file cannot reference
 * `node:http` here, and these are exactly the members the tests call.
 */
export interface BridgeServer {
  listen(port: number, host: string, callback?: () => void): BridgeServer;
  close(callback?: (error?: Error) => void): BridgeServer;
  address(): { port: number } | string | null;
  once(event: string, listener: (...args: never[]) => void): BridgeServer;
  off(event: string, listener: (...args: never[]) => void): BridgeServer;
}

/** `startBridge` adds the listen address and the lifecycle. */
export interface StartOptions extends BridgeOptions {
  /** Defaults to 8765; 0 asks the OS for a free port (what tests use). */
  port?: number;
  /** Defaults to 127.0.0.1; only loopback spellings are accepted. */
  host?: string;
}

export interface StartedBridge {
  server: BridgeServer;
  host: string;
  port: number;
  /** `http://<host>:<port>`, bracketed when the host is IPv6. */
  url: string;
  tokenRequired: boolean;
  /** Close the listener and drop idle keep-alive sockets. Resolves when shut. */
  close: () => Promise<void>;
}

/** The result of parsing a `--flag value` command line. */
export interface BridgeCliOptions {
  port: number;
  host: string;
  help: boolean;
}

/** Build the HTTP server without listening on it. */
export function createBridge(options?: BridgeOptions): BridgeServer;

/** Listen on a loopback interface and return the handle used to stop it. */
export function startBridge(options?: StartOptions): Promise<StartedBridge>;

/** The command-line entry point; resolves once the server is listening. */
export function main(argv?: readonly string[]): Promise<void>;

/** The `--help` text. */
export function usage(): string;

/** Parse the bridge's own flags; throws on an unknown or malformed one. */
export function parseArgs(argv: readonly string[]): BridgeCliOptions;

/** Build the default spawn-based runner (the seam's real implementation). */
export function createProcessRunner(options?: {
  /** A `child_process.spawn`-shaped function; defaults to the real one. */
  spawn?: unknown;
  /** Milliseconds between SIGTERM and SIGKILL; defaults to 2000. */
  killGraceMs?: number;
}): RunFn;

/** The two sizes printed by arduino-cli's compiler. */
export function parseSizes(log: string): { flashBytes: number | null; ramBytes: number | null };

/** The last `.hex` path named in a log, or null. */
export function parseHexPath(log: string): string | null;

/** The serial ports described by `arduino-cli board list --format json`. */
export function parsePorts(payload: unknown): PortInfo[];

/** Whether a `core list --format json` payload says arduino:avr is installed. */
export function coreInstalled(payload: unknown): boolean;

/** The end of a log, at most `limit` characters (default 8192). */
export function tailLog(text: string, limit?: number): string;

export const DEFAULT_PORT: number;
export const DEFAULT_HOST: string;
export const DEFAULT_TIMEOUT_MS: number;
export const MAX_BODY_BYTES: number;
export const MAX_SKETCH_BYTES: number;
export const LOG_TAIL_CHARS: number;
