/**
 * 板子串口连线在 PC 这一端。
 *
 * 板子说的是以换行分隔的 ASCII（见 `src/flash/protocol.ts`），所以本文件的全部职责只有三件事：
 * 以草图使用的波特率打开 Web Serial 端口、把字节流切成一行一行、每条命令写一行。
 * 它不认识帧，也不认识命令——那是面板与 `protocol.ts` 的事——正因如此，
 * 只要给一对流就能测试它，不需要浏览器。
 *
 * 类型是结构化声明，这是有意的。TypeScript 的 DOM 库没有 Web Serial 的声明
 * （它们在项目不打算引入的第三方包里），所以这里只声明实际用到的三个成员。
 * 没有 `navigator.serial` 的浏览器会让 `serialApi()` 返回 `null`，而不是抛 `ReferenceError`，
 * 因为面板需要像渲染其它状态一样渲染「这个浏览器做不了」。
 */

/** 本文件用到的 `SerialPort` 的那一小部分。 */
export interface SerialPortLike {
  open(options: { readonly baudRate: number }): Promise<void>;
  close(): Promise<void>;
  readonly readable: ReadableStream<Uint8Array> | null;
  readonly writable: WritableStream<Uint8Array> | null;
}

/** 本文件用到的 `navigator.serial` 的那一小部分。 */
export interface SerialNavigatorLike {
  requestPort(options?: {
    readonly filters?: readonly { readonly usbVendorId?: number; readonly usbProductId?: number }[];
  }): Promise<SerialPortLike>;
}

/** 生成的草图打开的波特率（即 `emit.ts` 里的 `SKETCH_BAUD`）。 */
export const SERIAL_BAUD = 115_200;

/** 浏览器的 Web Serial API；浏览器没有该能力时返回 `null`。 */
export function serialApi(source: unknown = globalThis.navigator): SerialNavigatorLike | null {
  if (source === null || typeof source !== 'object') return null;
  const serial = (source as { serial?: unknown }).serial;
  if (serial === null || typeof serial !== 'object') return null;
  return typeof (serial as { requestPort?: unknown }).requestPort === 'function'
    ? (serial as SerialNavigatorLike)
    : null;
}

export interface SerialLinkOptions {
  /** 一整行，不含行结束符，也不含结尾的 `\r`。 */
  onLine(line: string): void;
  /** 已打开的端口无论因何关闭，关闭完成时恰好调用一次。 */
  onClose?(): void;
  /** 值得展示的读取失败；之后连线会关闭。 */
  onError?(message: string): void;
}

/**
 * 一个已打开的串口。
 *
 * `open` 启动一个读循环，它一直活到 `close`（或板子被拔掉）。
 * `onLine` 是从那个循环里调用的，所以读取方绝不能抛异常：
 * 回调抛一次，就会因为一行坏数据把整个端口带下来。
 */
export class SerialLink {
  private readonly options: SerialLinkOptions;
  private readonly encoder = new TextEncoder();
  private reading = false;
  private port: SerialPortLike | null = null;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
  private done: Promise<void> | null = null;

  constructor(options: SerialLinkOptions) {
    this.options = options;
  }

  /** 端口已打开且读循环正在运行时为真。 */
  get isOpen(): boolean {
    return this.port !== null;
  }

  /** 以草图使用的波特率打开 `port`，并开始读取。 */
  async open(port: SerialPortLike): Promise<void> {
    if (this.port !== null) throw new Error('串口已经连接');
    await port.open({ baudRate: SERIAL_BAUD });
    const readable = port.readable;
    const writable = port.writable;
    if (readable === null || writable === null) {
      await port.close().catch(() => undefined);
      throw new Error('串口没有可读或可写的通道');
    }
    this.port = port;
    this.reader = readable.getReader();
    this.writer = writable.getWriter();
    this.reading = true;
    this.done = this.readLoop(this.reader);
  }

  /** 写一条命令；换行在这里补上，调用方不可能忘记。 */
  async write(line: string): Promise<void> {
    const writer = this.writer;
    if (writer === null) throw new Error('串口尚未连接');
    await writer.write(this.encoder.encode(`${line}\n`));
  }

  /**
   * 停止读取并关闭端口。
   *
   * 取消 reader 会让挂起的 `read` 解决，从而执行循环的 `finally`：
   * 端口、writer 和锁只在那一个地方释放，所以主动 `close` 与被拔线走的是同一条路。
   */
  async close(): Promise<void> {
    if (this.port === null) return;
    this.reading = false;
    await this.reader?.cancel().catch(() => undefined);
    await this.done;
  }

  private async readLoop(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<void> {
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      while (this.reading) {
        const { value, done } = await reader.read();
        if (done === true) break;
        buffer += decoder.decode(value, { stream: true });
        for (;;) {
          const at = buffer.indexOf('\n');
          if (at < 0) break;
          const line = buffer.slice(0, at).replace(/\r$/, '');
          buffer = buffer.slice(at + 1);
          if (line !== '') this.options.onLine(line);
        }
      }
    } catch {
      if (this.reading) this.options.onError?.('串口读取失败：板子可能已被拔出。');
    } finally {
      reader.releaseLock();
      const port = this.port;
      this.port = null;
      this.reader = null;
      try {
        this.writer?.releaseLock();
      } catch {
        // 流已经出错的 writer 仍然必须放掉；真正重要的是下面的关闭端口。
      }
      this.writer = null;
      if (port !== null) await port.close().catch(() => undefined);
      this.options.onClose?.();
    }
  }
}
