import { describe, expect, it } from 'vitest';
import { SerialLink, serialApi, SERIAL_BAUD, type SerialPortLike } from '../../src/ui/serial';

/** Poll until `check` is true, so the test never sleeps longer than it must. */
async function until(check: () => boolean, what: string): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw new Error(`timed out waiting for ${what}`);
}

interface FakePort {
  readonly port: SerialPortLike;
  push(text: string): void;
  end(): void;
  fail(error: Error): void;
  written(): string;
  openedWith(): number | null;
  closed(): number;
}

/** A serial port backed by two in-memory streams. */
function fakePort(): FakePort {
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  const readable = new ReadableStream<Uint8Array>({
    start(stream) {
      controller = stream;
    },
  });
  const chunks: Uint8Array[] = [];
  const writable = new WritableStream<Uint8Array>({
    write(chunk) {
      chunks.push(chunk);
    },
  });
  let opened: number | null = null;
  let closes = 0;
  return {
    port: {
      open: async (options) => {
        opened = options.baudRate;
      },
      close: async () => {
        closes += 1;
      },
      readable,
      writable,
    },
    push: (text) => controller?.enqueue(new TextEncoder().encode(text)),
    end: () => controller?.close(),
    fail: (error) => controller?.error(error),
    written: () => chunks.map((chunk) => new TextDecoder().decode(chunk)).join(''),
    openedWith: () => opened,
    closed: () => closes,
  };
}

describe('SerialLink', () => {
  it('opens at the sketch baud rate and splits a stream into lines', async () => {
    const fake = fakePort();
    const lines: string[] = [];
    const link = new SerialLink({ onLine: (line) => lines.push(line) });
    await link.open(fake.port);
    expect(fake.openedWith()).toBe(SERIAL_BAUD);
    expect(link.isOpen).toBe(true);
    // Three chunks, none aligned to a line boundary: one line arrives whole,
    // the next two cross chunk edges, and the last has a `\r\n`.
    fake.push('#TC1 12ab 2 1 1 1\nF 0 1');
    fake.push(' 1\r\nE bad line\n');
    await until(() => lines.length === 3, 'three lines');
    expect(lines).toEqual(['#TC1 12ab 2 1 1 1', 'F 0 1 1', 'E bad line']);
    await link.close();
  });

  it('holds a line fragment until its newline arrives', async () => {
    const fake = fakePort();
    const lines: string[] = [];
    const link = new SerialLink({ onLine: (line) => lines.push(line) });
    await link.open(fake.port);
    fake.push('F 0');
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(lines).toEqual([]);
    fake.push(' 1 0\n');
    await until(() => lines.length === 1, 'the completed line');
    expect(lines).toEqual(['F 0 1 0']);
    await link.close();
  });

  it('writes one command per call, with the newline the protocol requires', async () => {
    const fake = fakePort();
    const link = new SerialLink({ onLine: () => undefined });
    await link.open(fake.port);
    await link.write('I 0 1');
    await link.write('T');
    expect(fake.written()).toBe('I 0 1\nT\n');
    await link.close();
  });

  it('closes the port once and reports it, whether asked or unplugged', async () => {
    const fake = fakePort();
    let closes = 0;
    const link = new SerialLink({ onLine: () => undefined, onClose: () => (closes += 1) });
    await link.open(fake.port);
    await link.close();
    expect(link.isOpen).toBe(false);
    expect(fake.closed()).toBe(1);
    expect(closes).toBe(1);
    // A second close is a no-op, not a second teardown.
    await link.close();
    expect(fake.closed()).toBe(1);
    expect(closes).toBe(1);

    const unplugged = fakePort();
    let unpluggedCloses = 0;
    const second = new SerialLink({ onLine: () => undefined, onClose: () => (unpluggedCloses += 1) });
    await second.open(unplugged.port);
    unplugged.end();
    await until(() => unpluggedCloses === 1, 'the stream ending');
    expect(second.isOpen).toBe(false);
    expect(unplugged.closed()).toBe(1);
  });

  it('turns a read failure into a message and still releases the port', async () => {
    const fake = fakePort();
    const errors: string[] = [];
    let closes = 0;
    const link = new SerialLink({
      onLine: () => undefined,
      onError: (message) => errors.push(message),
      onClose: () => (closes += 1),
    });
    await link.open(fake.port);
    fake.fail(new Error('device removed'));
    await until(() => closes === 1, 'the error teardown');
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('串口读取失败');
    expect(fake.closed()).toBe(1);
    expect(link.isOpen).toBe(false);
  });

  it('refuses to send before a port is open, and to open twice', async () => {
    const link = new SerialLink({ onLine: () => undefined });
    await expect(link.write('T')).rejects.toThrow('串口尚未连接');
    const fake = fakePort();
    await link.open(fake.port);
    await expect(link.open(fake.port)).rejects.toThrow('串口已经连接');
    await link.close();
  });
});

describe('serialApi', () => {
  it('finds only an object that really exposes requestPort', () => {
    const api = { requestPort: async () => fakePort().port };
    expect(serialApi({ serial: api })).toBe(api);
    expect(serialApi({})).toBeNull();
    expect(serialApi({ serial: {} })).toBeNull();
    expect(serialApi(null)).toBeNull();
    expect(serialApi(undefined)).toBeNull();
  });
});
