// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { createStore, type AppState, type Store } from '../../src/app/store';
import { emptyProgress } from '../../src/app/progress';
import { createRegistry } from '../../src/core/registry';
import { BASE_DEFS } from '../../src/core/defs/index';
import { addInstance, connect, emptyGraph, type Graph } from '../../src/core/graph';
import { SANDBOX_LEVEL } from '../../src/levels/sandbox';
import { buildImage } from '../../src/flash/build';
import { isImage, type ProgramImage } from '../../src/flash/image';
import type { FetchLike } from '../../src/flash/client';
import { mountFlashPanel, type FlashPanel, type FlashPanelOptions } from '../../src/ui/flashPanel';

const registry = createRegistry(BASE_DEFS);

async function until(check: () => boolean, what: string): Promise<void> {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw new Error(`timed out waiting for ${what}`);
}

/** A sandbox board with a NAND driven by one input and read by one output. */
function sandboxStore(): { store: Store<AppState>; graph: Graph } {
  const graph = emptyGraph('sandbox');
  const input = addInstance(graph, 'level_input', 0, 0, 'IN_1');
  input.params.width = 1;
  const output = addInstance(graph, 'level_output', 400, 0, 'OUT_1');
  output.params.width = 1;
  const gate = addInstance(graph, 'nand', 200, 0);
  connect(graph, { inst: input.id, port: 'out' }, { inst: gate.id, port: 'a' });
  connect(graph, { inst: input.id, port: 'out' }, { inst: gate.id, port: 'b' });
  connect(graph, { inst: gate.id, port: 'out' }, { inst: output.id, port: 'in' });
  const store = createStore<AppState>({
    level: SANDBOX_LEVEL,
    graph,
    registry,
    progress: emptyProgress(),
    camera: { x: 0, y: 0, zoom: 1 },
    selected: [],
    dragging: null,
    armed: null,
    dev: false,
    programs: {},
    blueprints: {},
    editing: null,
    metrics: null,
    lastGrade: null,
    status: null,
  });
  return { store, graph };
}

function imageOf(graph: Graph): ProgramImage {
  const result = buildImage(graph, registry, SANDBOX_LEVEL);
  if (!isImage(result)) throw new Error(`refused: ${result.refusal.code} ${result.refusal.en}`);
  return result.image;
}

/** Mount the panel and open its tab, the way the workbench does. */
function mount(
  store: Store<AppState>,
  options: FlashPanelOptions = {},
): { root: HTMLElement; panel: FlashPanel } {
  const root = document.createElement('div');
  const panel = mountFlashPanel(root, store, options);
  panel.reveal();
  return { root, panel };
}

function buttonByText(root: HTMLElement, text: string): HTMLButtonElement {
  const found = [...root.querySelectorAll('button')].find((entry) => entry.textContent === text);
  if (found === undefined) throw new Error(`no button ${text}`);
  return found;
}

function part(root: HTMLElement, selector: string): HTMLElement {
  const found = root.querySelector(selector);
  if (found === null) throw new Error(`no ${selector}`);
  return found as HTMLElement;
}

function text(root: HTMLElement, selector: string): string {
  return root.querySelector(selector)?.textContent ?? '';
}

interface FetchCall {
  readonly url: string;
  readonly body?: string;
}

function bridgeFetch(answer: (url: string) => unknown): { fetch: FetchLike; calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push(init?.body === undefined ? { url } : { url, body: init.body });
    const body = answer(url);
    return { ok: true, status: 200, json: async () => body };
  };
  return { fetch, calls };
}

/** A serial port backed by streams, plus the navigator the panel reads. */
function fakeSerial(): {
  serialSource: unknown;
  push(text: string): void;
  written(): string;
  closes(): number;
} {
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  const readable = new ReadableStream<Uint8Array>({
    start(stream) {
      controller = stream;
    },
  });
  const chunks: string[] = [];
  const writable = new WritableStream<Uint8Array>({
    write(chunk) {
      chunks.push(new TextDecoder().decode(chunk));
    },
  });
  let closes = 0;
  const port = {
    open: async () => undefined,
    close: async () => {
      closes += 1;
    },
    readable,
    writable,
  };
  return {
    serialSource: { serial: { requestPort: async () => port } },
    push: (text) => controller?.enqueue(new TextEncoder().encode(text)),
    written: () => chunks.join(''),
    closes: () => closes,
  };
}

describe('the 开发板 panel', () => {
  it('builds an image when its tab opens and reports the cost against the board', () => {
    const { store } = sandboxStore();
    const { root } = mount(store);
    expect(text(root, '.flash-summary')).toContain('元件');
    expect(text(root, '.flash-summary')).toContain('节点');
    expect(text(root, '.flash-limits')).toContain('RAM');
    expect(text(root, '.flash-limits')).toContain('Arduino Uno');
    expect(text(root, '.flash-bridge-status')).toContain('tools/arduino-bridge.mjs');
    expect(buttonByText(root, '下载 .ino').disabled).toBe(false);
    expect(part(root, '.flash-refusal').hidden).toBe(true);
  });

  it('marks a built image stale after an edit, and rebuilds on demand', () => {
    const { store, graph } = sandboxStore();
    const { root, panel } = mount(store);
    expect(part(root, '.flash-stale').hidden).toBe(true);
    addInstance(graph, 'not', 600, 0);
    store.set({ graph });
    panel.render();
    expect(part(root, '.flash-stale').hidden).toBe(false);
    expect(part(root, '.flash-stale').textContent).toContain('电路已改动');
    buttonByText(root, '构建映像').click();
    expect(part(root, '.flash-stale').hidden).toBe(true);
  });

  it('shows why a circuit cannot be written to a board', () => {
    const { store, graph } = sandboxStore();
    addInstance(graph, 'and8', 600, 0);
    const { root, panel } = mount(store);
    panel.reveal();
    expect(part(root, '.flash-refusal').hidden).toBe(false);
    expect(text(root, '.flash-refusal')).toContain('and8');
    expect(buttonByText(root, '下载 .ino').disabled).toBe(true);
  });

  it('checks the bridge, shows its version and fills the port picker', async () => {
    const { store } = sandboxStore();
    const fake = bridgeFetch(() => ({
      ok: true,
      cli: 'arduino-cli  Version: 1.3.1',
      core: true,
      ports: [
        { address: 'COM3', label: 'Arduino Uno' },
        { address: 'COM4', label: 'Arduino Nano' },
      ],
    }));
    const { root } = mount(store, { fetch: fake.fetch });
    buttonByText(root, '检查连接').click();
    await until(() => text(root, '.flash-bridge-status').includes('已安装'), 'the health answer');
    expect(text(root, '.flash-bridge-status')).toContain('arduino-cli');
    expect(text(root, '.flash-bridge-status')).toContain('2 个串口');
    const selects = root.querySelectorAll<HTMLSelectElement>('.flash-fields select');
    expect([...selects[1]!.options].map((option) => option.textContent)).toEqual([
      '选择串口',
      'COM3 · Arduino Uno',
      'COM4 · Arduino Nano',
    ]);
    // Two ports means no automatic choice: 烧录 stays off until a player picks one.
    expect(buttonByText(root, '烧录').disabled).toBe(true);
    // The browser fires `change` on a picker choice; the button has to follow it
    // without any store update, which is why this dispatches rather than calling
    // panel.render() (that call is what once hid the missing listener).
    selects[1]!.value = 'COM3';
    selects[1]!.dispatchEvent(new Event('change'));
    expect(buttonByText(root, '烧录').disabled).toBe(false);
  });

  it('compiles through the bridge and prints the sizes and the log', async () => {
    const { store } = sandboxStore();
    const fake = bridgeFetch((url) =>
      url.endsWith('/compile')
        ? {
            ok: true,
            code: 0,
            log: 'Sketch uses 924 bytes (2%) of program storage space.',
            flashBytes: 924,
            ramBytes: 9,
          }
        : { ok: true, cli: 'arduino-cli', core: true, ports: [] },
    );
    const { root } = mount(store, { fetch: fake.fetch });
    buttonByText(root, '编译').click();
    await until(() => text(root, '.flash-bridge-log').includes('编译成功'), 'the compile answer');
    expect(text(root, '.flash-bridge-log')).toContain('Sketch uses 924 bytes');
    expect(text(root, '.flash-bridge-log')).toContain('924 B flash');
    const posted = fake.calls.find((call) => call.url.endsWith('/compile'));
    expect(posted).toBeDefined();
    const body = JSON.parse(posted!.body ?? '{}') as Record<string, unknown>;
    expect(body.name).toBe('tc_sandbox');
    expect(body.fqbn).toBe('arduino:avr:uno');
    expect(body.sketch).toContain('#define TC_HASH 0x');
    expect(body.port).toBeUndefined();
  });

  it('flashes to the chosen port when the bridge is asked to upload', async () => {
    const { store } = sandboxStore();
    const fake = bridgeFetch((url) =>
      url.endsWith('/flash')
        ? { ok: true, code: 0, log: 'avrdude done.', flashBytes: 924, ramBytes: 9 }
        : {
            ok: true,
            cli: 'arduino-cli',
            core: true,
            ports: [{ address: 'COM3', label: 'Arduino Uno' }],
          },
    );
    const { root, panel } = mount(store, { fetch: fake.fetch });
    buttonByText(root, '检查连接').click();
    await until(() => root.querySelectorAll('.flash-fields select')[1]!.querySelectorAll('option').length > 1, 'the port list');
    panel.render();
    expect(buttonByText(root, '烧录').disabled).toBe(false);
    buttonByText(root, '烧录').click();
    await until(() => text(root, '.flash-bridge-log').includes('烧录成功'), 'the flash answer');
    const posted = fake.calls.find((call) => call.url.endsWith('/flash'));
    expect(posted).toBeDefined();
    expect((JSON.parse(posted!.body ?? '{}') as Record<string, unknown>).port).toBe('COM3');
  });

  it('names a held serial port instead of leaving only the avrdude log', async () => {
    const { store } = sandboxStore();
    const fake = bridgeFetch((url) =>
      url.endsWith('/flash')
        ? {
            ok: false,
            code: 1,
            log: 'avrdude: ser_open(): cannot open port COM3: Access is denied.\nError during Upload: uploading error: exit status 1',
            flashBytes: 924,
            ramBytes: 9,
          }
        : {
            ok: true,
            cli: 'arduino-cli',
            core: true,
            ports: [{ address: 'COM3', label: 'WCH CH340 (1a86:7523)' }],
          },
    );
    const { root, panel } = mount(store, { fetch: fake.fetch });
    buttonByText(root, '检查连接').click();
    await until(
      () => root.querySelectorAll('.flash-fields select')[1]!.querySelectorAll('option').length > 1,
      'the port list',
    );
    panel.render();
    buttonByText(root, '烧录').click();
    await until(() => text(root, '.flash-message').includes('占用'), 'the busy-port sentence');
    expect(text(root, '.flash-message')).toContain('断开');
    expect(text(root, '.flash-bridge-log')).toContain('Access is denied');
  });

  it('asks for the old bootloader options when that board row is chosen', async () => {
    const { store } = sandboxStore();
    const fake = bridgeFetch((url) =>
      url.endsWith('/flash')
        ? { ok: true, code: 0, log: 'avrdude done.', flashBytes: 924, ramBytes: 9 }
        : {
            ok: true,
            cli: 'arduino-cli',
            core: true,
            ports: [{ address: 'COM9', label: 'Arduino Nano' }],
          },
    );
    const { root, panel } = mount(store, { fetch: fake.fetch });
    // The Nano's old bootloader shares the chip with the plain Nano; the row is
    // what makes the bridge add `--board-options cpu=atmega328old`.
    const board = root.querySelectorAll<HTMLSelectElement>('.flash-fields select')[0]!;
    board.value = 'arduino:avr:nano:old';
    board.dispatchEvent(new Event('change'));
    buttonByText(root, '检查连接').click();
    await until(
      () => root.querySelectorAll('.flash-fields select')[1]!.querySelectorAll('option').length > 1,
      'the port list',
    );
    panel.render();
    expect(text(root, '.flash-limits')).toContain('旧 bootloader');
    buttonByText(root, '烧录').click();
    await until(() => text(root, '.flash-bridge-log').includes('烧录成功'), 'the flash answer');
    const posted = fake.calls.find((call) => call.url.endsWith('/flash'));
    expect(posted).toBeDefined();
    const body = JSON.parse(posted!.body ?? '{}') as Record<string, unknown>;
    expect(body.fqbn).toBe('arduino:avr:nano');
    expect(body.boardOptions).toBe('cpu=atmega328old');
    expect(body.port).toBe('COM9');
  });

  it('closes the port before uploading and leaves it closed for the linker', async () => {
    const { store } = sandboxStore();
    const serial = fakeSerial();
    const bridge = bridgeFetch((url) =>
      url.endsWith('/flash')
        ? { ok: true, code: 0, log: 'avrdude done.', flashBytes: 924, ramBytes: 9 }
        : {
            ok: true,
            cli: 'arduino-cli',
            core: true,
            ports: [{ address: 'COM3', label: 'Arduino Uno' }],
          },
    );
    const { root, panel } = mount(store, { fetch: bridge.fetch, serialSource: serial.serialSource });
    buttonByText(root, '检查连接').click();
    await until(
      () => root.querySelectorAll('.flash-fields select')[1]!.querySelectorAll('option').length > 1,
      'the port list',
    );
    buttonByText(root, '连接串口').click();
    await until(() => !buttonByText(root, '断开').disabled, 'the serial connection');
    expect(serial.closes()).toBe(0);
    panel.render();
    buttonByText(root, '烧录').click();
    await until(() => text(root, '.flash-bridge-log').includes('烧录成功'), 'the flash answer');
    // `arduino-cli` cannot open a port Web Serial holds: the upload closes it.
    expect(serial.closes()).toBe(1);
    expect(buttonByText(root, '断开').disabled).toBe(true);
    expect(buttonByText(root, '连接串口').disabled).toBe(false);
  });

  it('hands the sketch to the downloader under a folder-matching name', () => {
    const { store } = sandboxStore();
    const downloads: Array<{ name: string; text: string }> = [];
    const { root } = mount(store, {
      onDownload: (name, sketch) => downloads.push({ name, text: sketch }),
    });
    buttonByText(root, '下载 .ino').click();
    expect(downloads).toHaveLength(1);
    expect(downloads[0]!.name).toBe('tc_sandbox.ino');
    expect(downloads[0]!.text).toContain('#define TC_HASH 0x');
  });

  it('drives a connected board and reads its banner and frames', async () => {
    const { store, graph } = sandboxStore();
    const image = imageOf(graph);
    const fake = fakeSerial();
    const { root } = mount(store, { serialSource: fake.serialSource });
    buttonByText(root, '连接串口').click();
    await until(() => !buttonByText(root, '断开').disabled, 'the serial connection');
    expect(fake.written()).toContain('B\n');
    // A field built before the port existed becomes typeable with it.
    expect((root.querySelector('.flash-pin-row input') as HTMLInputElement).disabled).toBe(false);
    fake.push(`#TC1 ${image.hash.toString(16)} ${image.report.nodes} 1 1 1\n`);
    await until(() => text(root, '.flash-banner').includes('一致'), 'the banner');
    expect(text(root, '.flash-banner')).toContain('与屏幕上的电路一致');
    fake.push('F 7 1 1\n');
    await until(() => text(root, '.flash-frame').includes('第 7 拍'), 'the frame');
    expect(text(root, '.flash-frame')).toContain('OUT_1=1');
    const command = part(root, '.flash-command') as HTMLInputElement;
    command.value = 'I 0 1';
    command.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    await until(() => fake.written().includes('I 0 1\n'), 'the typed command');
    buttonByText(root, '单步 T').click();
    await until(() => fake.written().includes('T\n'), 'the tick command');
  });

  it('says the board is running another circuit when the hashes differ', async () => {
    const { store } = sandboxStore();
    const fake = fakeSerial();
    const { root } = mount(store, { serialSource: fake.serialSource });
    buttonByText(root, '连接串口').click();
    await until(() => !buttonByText(root, '断开').disabled, 'the serial connection');
    fake.push('#TC1 deadbeef 3 1 1 1\n');
    await until(() => text(root, '.flash-banner').includes('另一块电路'), 'the mismatch note');
  });

  it('explains a browser without Web Serial instead of failing silently', async () => {
    const { store } = sandboxStore();
    const { root } = mount(store, { serialSource: {} });
    buttonByText(root, '连接串口').click();
    await until(() => text(root, '.flash-serial-note').includes('Web Serial'), 'the no-serial note');
  });
});
