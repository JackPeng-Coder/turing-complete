/**
 * The PC's end of the board's serial line.
 *
 * THE BOARD TALKS NEWLINE-DELIMITED ASCII (see `src/flash/protocol.ts`), so this
 * file's whole job is three things: open the Web Serial port at the sketch's
 * baud rate, split the byte stream into lines, and write one line per command.
 * It knows nothing about frames or commands -- those are the panel's and
 * `protocol.ts`'s -- which is what keeps it testable with a pair of streams and
 * no browser.
 *
 * THE TYPES ARE STRUCTURAL ON PURPOSE. TypeScript's DOM library has no Web
 * Serial declarations (they live in a package this project will not add), so the
 * three members actually used are declared here. A browser that has no
 * `navigator.serial` fails `serialApi()` rather than a `ReferenceError`, because
 * the panel has to render "this browser cannot do it" like any other state.
 */

/** The slice of `SerialPort` this file uses. */
export interface SerialPortLike {
  open(options: { readonly baudRate: number }): Promise<void>;
  close(): Promise<void>;
  readonly readable: ReadableStream<Uint8Array> | null;
  readonly writable: WritableStream<Uint8Array> | null;
}

/** The slice of `navigator.serial` this file uses. */
export interface SerialNavigatorLike {
  requestPort(options?: {
    readonly filters?: readonly { readonly usbVendorId?: number; readonly usbProductId?: number }[];
  }): Promise<SerialPortLike>;
}

/** The baud rate the emitted sketch opens (`emit.ts`'s `SKETCH_BAUD`). */
export const SERIAL_BAUD = 115_200;

/** The browser's Web Serial API, or `null` when the browser has none. */
export function serialApi(source: unknown = globalThis.navigator): SerialNavigatorLike | null {
  if (source === null || typeof source !== 'object') return null;
  const serial = (source as { serial?: unknown }).serial;
  if (serial === null || typeof serial !== 'object') return null;
  return typeof (serial as { requestPort?: unknown }).requestPort === 'function'
    ? (serial as SerialNavigatorLike)
    : null;
}

export interface SerialLinkOptions {
  /** One complete line, without its terminator and without a trailing `\r`. */
  onLine(line: string): void;
  /** Called exactly once when an open port finishes closing, for any reason. */
  onClose?(): void;
  /** A read failure worth showing; the link closes afterwards. */
  onError?(message: string): void;
}

/**
 * One open serial port.
 *
 * `open` starts a read loop that lives until `close` (or until the board is
 * unplugged). `onLine` runs from that loop, so a reader must not throw: a
 * thrown callback would take the port down for one bad line.
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

  /** True while a port is open and the read loop is running. */
  get isOpen(): boolean {
    return this.port !== null;
  }

  /** Open `port` at the sketch's baud rate and start reading. */
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

  /** Write one command; the newline is added here so callers cannot forget it. */
  async write(line: string): Promise<void> {
    const writer = this.writer;
    if (writer === null) throw new Error('串口尚未连接');
    await writer.write(this.encoder.encode(`${line}\n`));
  }

  /**
   * Stop reading and close the port.
   *
   * Cancelling the reader resolves the pending `read`, which runs the loop's
   * `finally`: that is the one place the port, the writer and the locks are
   * released, so `close` and an unplugged cable take the same path.
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
        // A writer whose stream already errored still has to be let go of; the
        // port close below is the part that matters.
      }
      this.writer = null;
      if (port !== null) await port.close().catch(() => undefined);
      this.options.onClose?.();
    }
  }
}
