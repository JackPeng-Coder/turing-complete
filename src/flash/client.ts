import type { BoardId } from './boards';
import { emitSketch } from './emit';
import type { ProgramImage } from './image';

/**
 * `tools/arduino-bridge.mjs` 的浏览器侧客户端。
 *
 * 游戏本身无法启动子进程，所以负责运行 `arduino-cli` 的那一半功能放在一个本地
 * 守护进程里，本文件就是它的客户端。桥的契约（请求头、路由、JSON 形状）写在
 * `tools/arduino-bridge.mjs` 顶部；下面的类型复述面板实际读取的那部分，
 * `client.test.ts` 用假 fetch 把类型钉在契约上，而不是依赖一块真实板卡。
 *
 * 预期内的失败在这里**一律不抛异常**。"桥没在跑"、"没装 CLI"、"草图编译失败"
 * 都是面板必须渲染出来给玩家看的状态，所以每种都是一个值：`ok: false` 的健康
 * 结果，或携带编译器日志的构建结果。抛异常只保留给本文件的 bug，和 `build.ts`
 * 对待拒绝值的方式一致。
 */

/** 本地桥默认监听的地址，玩家改过才不是这个。 */
export const DEFAULT_BRIDGE_URL = 'http://127.0.0.1:8765';

/**
 * 单次请求的默认超时。
 *
 * 桥内部给 `arduino-cli compile` 的限时是 120 秒，这里留 30 秒余量覆盖进程启动、
 * 上传和清理；否则卡住的编译会让面板的按钮永远禁用。
 */
export const DEFAULT_REQUEST_TIMEOUT_MS = 150_000;

/** 一个可选择的串口，端口选择器就按这个展示。 */
export interface PortInfo {
  /** 系统串口名，例如 COM3 或 /dev/ttyACM0，桥原样透传。 */
  readonly address: string;
  /** 展示给玩家的名称；缺失时回退为 address。 */
  readonly label: string;
}

/** `/health` 的应答，或本客户端对"没有桥"的表示。 */
export interface BridgeHealth {
  /** 自检是否全部通过：CLI 能应答且 AVR core 已安装（见 `healthOf`）。 */
  readonly ok: boolean;
  /** 检测到的 arduino-cli 路径；没装时为 `null`。 */
  readonly cli: string | null;
  /** avr core 是否已安装。 */
  readonly core: boolean;
  /** 当前可见的串口列表。 */
  readonly ports: readonly PortInfo[];
  /** 桥自己给出的错误文本（若有）。 */
  readonly error?: string;
}

/** `/compile` 与 `/flash` 的应答。 */
export interface BridgeBuild {
  /** 编译（或编译并上传）是否成功。 */
  readonly ok: boolean;
  /** 进程退出码；工具没能启动、或被超时终止时为 `null`。 */
  readonly code: number | null;
  /** 编译器/上传器的输出日志尾部，面板原样展示。 */
  readonly log: string;
  /** arduino-cli 报告的 flash 占用；日志里没提到时为 `null`。 */
  readonly flashBytes: number | null;
  /** arduino-cli 报告的全局变量 RAM 占用；日志里没提到时为 `null`。 */
  readonly ramBytes: number | null;
  /** 编译日志里出现了 `.hex` 路径时，返回的 HEX 路径（供手动烧录）。 */
  readonly hex?: string;
  /** 桥层面的错误文本（CLI 缺失、参数不合法等）。 */
  readonly error?: string;
  /** 命令超时、被桥强制终止。 */
  readonly timedOut?: boolean;
}

/** 一次编译/上传请求的请求体：`name` 与 `sketch` 由 `planSketch` 生成。 */
export interface SketchRequest {
  readonly name: string;
  readonly sketch: string;
  readonly fqbn: BoardId;
  readonly port?: string;
  readonly boardOptions?: string;
}

/** 生成的草图，以及它应当被保存成的文件名。 */
export interface SketchPlan {
  readonly request: SketchRequest;
  readonly fileName: string;
}

/**
 * 本客户端用到的 `fetch` 子集。
 *
 * 用结构化类型声明而不是 `typeof fetch`，测试才能塞进一个四行的函数：真实
 * `fetch` 满足它，而写假 fetch 时不需要 `@types/node` 或 DOM 的响应内部类型。
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
  /** 默认 `DEFAULT_BRIDGE_URL`；末尾多一个斜杠也能容忍。 */
  readonly baseUrl?: string;
  /** 非空时作为 `X-TC-Token` 发送；桥配置了令牌时就要求它。 */
  readonly token?: string;
  /** `fetch` 接缝；默认用平台自带的。 */
  readonly fetch?: FetchLike;
  /** 默认 `DEFAULT_REQUEST_TIMEOUT_MS`。 */
  readonly timeoutMs?: number;
}

/**
 * 把关卡 id 变成一个桥愿意当作目录名的草图名。
 *
 * 桥的限制是 `^[a-z0-9_]{1,32}$`；关卡 id 本来就小写（如 `sandbox`），前缀和过滤
 * 保证即使 id 将来长出连字符或 Unicode 字符，也不会让一次保存变成桥返回 400。
 * 文件名是草图名加 `.ino`，因为 arduino-cli 要求目录与 `.ino` 同名——这样下载下来
 * 的文件才能直接使用。
 *
 * @param level 关卡 id。
 * @returns 最多 32 字符的合法草图名；空结果回退为 `tc_circuit`。
 */
export function sketchNameFor(level: string): string {
  const cleaned = level
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return `tc_${cleaned || 'circuit'}`.slice(0, 32);
}

/**
 * 生成草图文本，以及编译它所需的请求。
 *
 * @param image 要写入开发板的程序映像。
 * @param board 目标板卡的 FQBN。
 * @param options 端口、草图名与板卡变体选项。
 * @returns 请求体与下载文件名（`<name>.ino`）。
 */
export function planSketch(
  image: ProgramImage,
  board: BoardId,
  options: {
    /** 上传目标串口；省略表示只编译。 */
    readonly port?: string;
    /** 草图名；省略时由关卡 id 生成。 */
    readonly name?: string;
    /** `arduino-cli --board-options`，同一个 FQBN 的变体（旧的 Nano bootloader）。 */
    readonly boardOptions?: string;
  } = {},
): SketchPlan {
  const name = options.name ?? sketchNameFor(image.level);
  const request: SketchRequest = {
    name,
    sketch: emitSketch(image, { name }),
    fqbn: board,
    ...(options.port === undefined ? {} : { port: options.port }),
    ...(options.boardOptions === undefined ? {} : { boardOptions: options.boardOptions }),
  };
  return { request, fileName: `${name}.ino` };
}

/** 一个 JSON 对象；值不是对象、或是数组时返回 `null`。 */
function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** 字符串值；不是字符串时返回 `undefined`。 */
function textOf(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/** 有限数字；其他任何值（含 NaN/Infinity）都返回 `null`。 */
function numberOf(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * 解析 `/ports` 的端口数组。
 *
 * 坏条目直接跳过而不是抛异常：串口列表来自外部工具，个别字段缺失不应该让整个
 * 选择器消失。`address` 为空的条目无法烧录，同样跳过。
 */
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

/**
 * 解析 `/health` 应答。
 *
 * `ok` 是本地重新合成的：桥的 `ok === true` 之外，还要求真的检测到 CLI 且 AVR
 * core 已安装；任何一个不满足都不能开始烧录。
 */
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

/** 解析 `/compile` 与 `/flash` 应答；无法识别的响应视为失败。 */
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

/** 守护进程完全不在时，玩家看到的句子。 */
export const NO_BRIDGE =
  '连不上本地桥：请先在仓库根目录运行 `node tools/arduino-bridge.mjs`，并确认地址与端口一致。';

/**
 * 本地桥的客户端。
 *
 * 每个方法都返回"值"而不是抛异常：预期内的失败（桥不在、HTTP 错误、超时）都用
 * 带 `ok: false` 的结果或 `error` 字段表达，面板可以直接渲染。
 */
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

  /** GET `/health`：有没有 CLI、AVR core 装没装、当前有哪些串口？ */
  async health(): Promise<BridgeHealth> {
    const reply = await this.send('/health', { method: 'GET' });
    if (!reply.ok) {
      return { ok: false, cli: null, core: false, ports: [], error: reply.error };
    }
    return healthOf(reply.value);
  }

  /** GET `/ports`：只取选择器要的端口列表，失败时带桥的错误文本。 */
  async ports(): Promise<{ readonly ports: readonly PortInfo[]; readonly error?: string }> {
    const reply = await this.send('/ports', { method: 'GET' });
    if (!reply.ok) return { ports: [], error: reply.error };
    const record = asRecord(reply.value);
    const error = textOf(record?.error);
    const ports = record === null ? [] : portsOf(record.ports);
    return error === undefined ? { ports } : { ports, error };
  }

  /** POST `/compile`：编译草图并回报体积，不上传。 */
  async compile(request: SketchRequest): Promise<BridgeBuild> {
    return this.post('/compile', request);
  }

  /** POST `/flash`：编译并上传；按契约端口是必填的。 */
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
   * 发一次请求，补上桥要求的两个信封（请求头）并设置超时。
   *
   * 请求失败也是值：守护进程没起来、URL 写错、浏览器拒绝了跨源请求，面板显示的
   * 都是同一句话。超时存在的原因是：卡住的编译否则会让面板的"编译"按钮永远禁用。
   *
   * @param path 路由，如 `/health`。
   * @param init 方法、额外请求头与请求体。
   * @returns 成功时 `{ ok: true, value }`（JSON 已解析），失败时 `{ ok: false, error }`。
   */
  private async send(
    path: string,
    init: { readonly method: string; readonly headers?: Record<string, string>; readonly body?: string },
  ): Promise<{ readonly ok: true; readonly value: unknown } | { readonly ok: false; readonly error: string }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      // 桥用 `X-TC-Arduino` 拒绝其他网页的跨源探测；配置了令牌时再带 `X-TC-Token`。
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
      // 网络层失败、超时中止与 CORS 拒绝都归到这里：对玩家而言都是"桥连不上"。
      return { ok: false, error: NO_BRIDGE };
    } finally {
      clearTimeout(timer);
    }
  }
}
