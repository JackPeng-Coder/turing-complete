import type { AppState, Store } from '../app/store';
import {
  BOARD_CHOICES,
  DEFAULT_BOARD_CHOICE,
  boardChoice,
  boardProfile,
  type BoardId,
} from '../flash/boards';
import {
  DEFAULT_BRIDGE_URL,
  FlashClient,
  planSketch,
  type BridgeBuild,
  type BridgeHealth,
  type FetchLike,
} from '../flash/client';
import { buildImage } from '../flash/build';
import { isImage, type ImageRefusal, type ProgramImage } from '../flash/image';
import { boardPinChoices } from '../flash/pins';
import { parseBoardLine, type BoardBanner, type BoardFrame } from '../flash/protocol';
import { isSandbox, sandboxPins } from '../levels/sandbox';
import { circuitSignature } from '../persist/sandbox';
import { SerialLink, serialApi, type SerialPortLike } from './serial';

/**
 * 开发板: the panel that writes a sandbox circuit to a real Arduino.
 *
 * FOUR CARDS, in the order a player uses them. 映像 is what the circuit compiles
 * to on the board and what it will cost; 引脚 maps a one-bit connector onto a
 * physical board pin (`pins.ts` holds the rules) so the circuit can drive an LED
 * or read a button, not only the serial line; 本地桥 is the local daemon that runs
 * `arduino-cli` (the browser cannot); 串口 is the board itself, driven by the
 * line protocol in `flash/protocol.ts`. The panel does not own any circuit: it
 * reads the store, builds an image only when asked or when the tab is opened, and
 * caches that image by the circuit's signature so dragging a wire does not
 * rebuild 900 gates every frame. The pin assignment is remembered with the
 * bridge and board in `tc.flash.v1`, not in the circuit: it belongs to the board
 * the circuit is flashed to, and it changes only the firmware's I/O, not its
 * price.
 *
 * IT IS A SANDBOX VIEW. A level's pins are the puzzle's contract and the exporter
 * refuses a level board; the composition root hides the tab outside the sandbox,
 * and `buildImage`'s own refusal is the second fence rather than a duplicated one.
 *
 * WHY THE DOWNLOAD IS HERE AND THE UPLOAD IS NOT. A browser can save a file, but
 * it cannot start `arduino-cli`; so the sketch can always be downloaded and
 * compiled by hand, and the bridge is the optional convenience that also uploads.
 * Both paths use the same `planSketch`, so what is downloaded and what is flashed
 * are byte-identical.
 */

export interface FlashPanel {
  /** Redraw the readouts; cheap, and never builds an image. */
  render(): void;
  /** The bottom-panel tab opened: build a fresh image if the circuit changed. */
  reveal(): void;
  /** The tab is showing or not; while hidden the panel does no work. */
  setVisible(visible: boolean): void;
  destroy(): void;
}

export interface FlashPanelOptions {
  /** The `fetch` seam, for tests; defaults to the platform's. */
  fetch?: FetchLike;
  /** The object `navigator.serial` is read from, for tests; defaults to `navigator`. */
  serialSource?: unknown;
  /** Where a downloaded sketch goes, for tests; defaults to a blob download. */
  onDownload?(fileName: string, sketch: string): void;
  /** The in-page input values, for the "sync from the page" button. */
  vector?(): Readonly<Record<string, number>>;
}

/** Where the panel remembers its bridge and board between reloads. */
const PREFS_KEY = 'tc.flash.v1';

interface Prefs {
  readonly url?: string;
  /** A `BOARD_CHOICES` row id, which is why the Nano's old bootloader is one. */
  readonly board?: string;
  /** Connector id -> board pin, the 引脚 card's assignments. */
  readonly pins?: Readonly<Record<string, string>>;
}

function loadPrefs(): Prefs {
  try {
    const raw = globalThis.localStorage?.getItem(PREFS_KEY);
    if (raw === null || raw === undefined) return {};
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const record = parsed as Record<string, unknown>;
    const url = typeof record.url === 'string' && record.url.trim() !== '' ? record.url : undefined;
    const board =
      typeof record.board === 'string' && BOARD_CHOICES.some((entry) => entry.id === record.board)
        ? record.board
        : undefined;
    const pins: Record<string, string> = {};
    if (record.pins !== null && typeof record.pins === 'object' && !Array.isArray(record.pins)) {
      for (const [id, value] of Object.entries(record.pins as Record<string, unknown>)) {
        if (typeof value === 'string' && value.trim() !== '') pins[id] = value.trim();
      }
    }
    return {
      ...(url === undefined ? {} : { url }),
      ...(board === undefined ? {} : { board }),
      ...(Object.keys(pins).length === 0 ? {} : { pins }),
    };
  } catch {
    // A corrupt or unavailable save is "no prefs", never a failed boot.
    return {};
  }
}

function savePrefs(prefs: Prefs): void {
  try {
    globalThis.localStorage?.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Private mode and a full quota both make this a no-op; the fields still work.
  }
}

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className !== undefined) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(label: string, onClick: () => void, primary = false): HTMLButtonElement {
  const node = element('button', primary ? 'flash-button flash-primary' : 'flash-button', label);
  node.type = 'button';
  node.addEventListener('click', onClick);
  return node;
}

function field(label: string, control: HTMLElement, hint?: string): HTMLElement {
  const wrap = element('label', 'flash-field');
  wrap.append(element('span', 'flash-field-label', label), control);
  if (hint !== undefined) wrap.append(element('small', undefined, hint));
  return wrap;
}

function card(title: string): { section: HTMLElement; body: HTMLElement } {
  const section = element('section', 'card flash-card');
  const head = element('div', 'card-head');
  head.append(element('span', undefined, title));
  const body = element('div', 'flash-body');
  section.append(head, body);
  return { section, body };
}

/** A note whose colour says what kind of thing it is reporting. */
function note(className = 'flash-note'): HTMLElement {
  const node = element('div', className);
  node.dataset.tone = 'info';
  return node;
}

function toneOf(node: HTMLElement, tone: 'info' | 'good' | 'bad' | 'warn'): void {
  node.dataset.tone = tone;
}

/**
 * The sentence a failed compile or upload ends on.
 *
 * The two failures a player is most likely to meet have nothing to do with the
 * circuit: the serial port is still held open (by this card before an upload, or
 * by another serial tool), or an ATmega-class board does not answer because the
 * wrong bootloader was picked. Naming which one it is saves reading an avrdude
 * log, which is otherwise the only place the difference shows.
 */
function failureText(result: BridgeBuild): string {
  const log = `${result.log}\n${result.error ?? ''}`;
  if (/cannot open (?:the )?port|access is denied|permission denied|拒绝访问|被占用/i.test(log)) {
    return '串口被占用或不允许访问：先在「串口」卡点「断开」，并关掉其他占用它的程序（Arduino IDE、串口监视器、别的标签页）再烧录。';
  }
  if (/programmer is not responding|not in sync|stk500|wrong microcontroller|invalid device signature/i.test(log)) {
    return '板子的 bootloader 没有应答：确认「开发板」选的是板子上的型号；Nano 克隆板若是旧 bootloader，改选「Arduino Nano（旧 bootloader）」。';
  }
  return result.error ?? 'arduino-cli 没有通过：日志见下方。';
}

export function mountFlashPanel(
  root: HTMLElement,
  store: Store<AppState>,
  options: FlashPanelOptions = {},
): FlashPanel {
  const prefs = loadPrefs();
  const wrap = element('div', 'flash-panel');
  root.append(wrap);

  // ------------------------------------------------------------------ image --
  const imageCard = card('映像');
  const summary = element('div', 'flash-summary');
  const limits = element('div', 'flash-limits');
  const staleNote = note('flash-note flash-stale');
  const refusalNote = note('flash-note flash-refusal');
  const messageNote = note('flash-note flash-message');
  const imageButtons = element('div', 'flash-row');
  const buildButton = button('构建映像', () => buildNow(), true);
  const downloadButton = button('下载 .ino', () => download());
  imageButtons.append(buildButton, downloadButton);
  imageCard.body.append(summary, limits, staleNote, refusalNote, messageNote, imageButtons);

  // ------------------------------------------------------------------- pins --
  const pinCard = card('引脚');
  const pinHint = note('flash-note flash-pin-hint');
  pinHint.textContent =
    '1 位连接器可以接板子引脚：输出用 digitalWrite，输入用内部上拉读取（按钮接 GND，未接线读 1）。「不接」的连接器只走串口。D0/D1 是串口线，不在列表里。';
  const pinList = element('div', 'flash-pin-list');
  pinCard.body.append(pinHint, pinList);

  // ----------------------------------------------------------------- bridge --
  const bridgeCard = card('本地桥');
  const urlInput = element('input', 'flash-input');
  urlInput.type = 'text';
  urlInput.value = prefs.url ?? DEFAULT_BRIDGE_URL;
  urlInput.placeholder = DEFAULT_BRIDGE_URL;
  urlInput.spellcheck = false;
  const tokenInput = element('input', 'flash-input');
  tokenInput.type = 'password';
  tokenInput.placeholder = '令牌（桥未设置时可留空）';
  tokenInput.autocomplete = 'off';
  const boardSelect = element('select', 'flash-input');
  for (const choice of BOARD_CHOICES) {
    const option = element('option', undefined, choice.name);
    option.value = choice.id;
    boardSelect.append(option);
  }
  boardSelect.value = prefs.board ?? DEFAULT_BOARD_CHOICE;
  const portSelect = element('select', 'flash-input');
  portSelect.disabled = true;
  const bridgeFields = element('div', 'flash-fields');
  bridgeFields.append(
    field('桥地址', urlInput),
    field('令牌', tokenInput),
    field('开发板', boardSelect),
    field('串口', portSelect),
  );
  const bridgeStatus = note('flash-note flash-bridge-status');
  const bridgeLog = element('pre', 'flash-log flash-bridge-log');
  bridgeLog.hidden = true;
  const bridgeButtons = element('div', 'flash-row');
  const healthButton = button('检查连接', () => void checkBridge());
  const compileButton = button('编译', () => void runCompile(false));
  const flashButton = button('烧录', () => void runCompile(true), true);
  bridgeButtons.append(healthButton, compileButton, flashButton);
  bridgeCard.body.append(bridgeFields, bridgeStatus, bridgeButtons, bridgeLog);

  // ----------------------------------------------------------------- serial --
  const serialCard = card('串口');
  const bannerLine = note('flash-note flash-banner');
  const frameLine = note('flash-note flash-frame');
  const serialNote = note('flash-note flash-serial-note');
  const serialButtons = element('div', 'flash-row');
  const connectButton = button('连接串口', () => void connectSerial(), true);
  const disconnectButton = button('断开', () => void disconnectSerial());
  serialButtons.append(connectButton, disconnectButton);
  const inputsBox = element('div', 'flash-inputs');
  const outputsBox = element('div', 'flash-outputs');
  const commandInput = element('input', 'flash-input flash-command');
  commandInput.type = 'text';
  commandInput.placeholder = '命令：I 0 1 · T · R · S · C 2';
  commandInput.spellcheck = false;
  const serialCommandRow = element('div', 'flash-command-row');
  serialCommandRow.append(
    commandInput,
    button('发送', () => sendCommand()),
  );
  const serialActions = element('div', 'flash-row');
  const tickButton = button('单步 T', () => void sendLine('T'));
  const resetButton = button('复位 R', () => void sendLine('R'));
  const pollButton = button('读取 S', () => void sendLine('S'));
  const syncButton = button('同步面板输入', () => void syncFromPage());
  serialActions.append(tickButton, resetButton, pollButton, syncButton);
  const serialLog = element('pre', 'flash-log flash-serial-log');
  serialCard.body.append(serialButtons, bannerLine, frameLine, serialNote, inputsBox, outputsBox, serialActions, serialCommandRow, serialLog);

  wrap.append(imageCard.section, pinCard.section, bridgeCard.section, serialCard.section);

  // ------------------------------------------------------------------ state --
  let built: { readonly image: ProgramImage; readonly signature: string } | null = null;
  let refusal: ImageRefusal | null = null;
  let message: { readonly text: string; readonly tone: 'info' | 'good' | 'bad' | 'warn' } | null = null;
  let health: BridgeHealth | null = null;
  let build: { readonly result: BridgeBuild; readonly action: 'compile' | 'flash' } | null = null;
  let busy: string | null = null;
  let banner: BoardBanner | null = null;
  let frame: BoardFrame | null = null;
  let serial: SerialLink | null = null;
  let connecting = false;
  let serialMessage = '';
  let visible = false;
  let lastInputsFor: ProgramImage | null = null;
  let inputFields = new Map<string, HTMLInputElement>();
  let serialLines: string[] = [];
  /** Connector id -> board pin; mutated by the 引脚 card, persisted in prefs. */
  const pinMap: Record<string, string> = { ...(prefs.pins ?? {}) };
  const unsubscribe = store.subscribe(() => {
    if (visible) render();
  });

  // ------------------------------------------------------------- the image --

  function boardId(): BoardId {
    return boardChoice(boardSelect.value).board;
  }

  /** The picker's row, for the budget line and the bridge request. */
  function selectedBoard() {
    return boardChoice(boardSelect.value);
  }

  /** The plan both the download and the bridge request are built from. */
  function planFor(image: ProgramImage, port?: string) {
    const choice = selectedBoard();
    return planSketch(image, choice.board, {
      ...(port === undefined ? {} : { port }),
      ...(choice.boardOptions === undefined ? {} : { boardOptions: choice.boardOptions }),
    });
  }

  /** The assignments in a stable spelling, for the image's cache key. */
  function pinSignature(): string {
    return Object.keys(pinMap)
      .sort()
      .map((id) => `${id}=${pinMap[id] ?? ''}`)
      .join(',');
  }

  function signatureOf(level: AppState['level'], graph: AppState['graph']): string {
    return `${level.id}@${circuitSignature(graph)}@${boardId()}@${pinSignature()}`;
  }

  /** Remember everything the panel owns in one save; the fields call it. */
  function rememberPrefs(): void {
    savePrefs({ url: urlInput.value, board: boardSelect.value, pins: pinMap });
  }

  /**
   * The built image, built on first use and rebuilt when the circuit, the board
   * or a pin assignment changed. A refusal is kept as a refusal: the panel shows
   * why rather than leaving the last good image on screen.
   */
  function ensureImage(): ProgramImage | null {
    const state = store.get();
    if (!isSandbox(state.level)) {
      built = null;
      refusal = null;
      message = { text: '写入开发板只在沙盒里可用：关卡板上的引脚是题目的契约。', tone: 'warn' };
      return null;
    }
    prunePins();
    const signature = signatureOf(state.level, state.graph);
    if (built !== null && built.signature === signature) return built.image;
    const result = buildImage(state.graph, state.registry, state.level, boardId(), pinMap);
    if (isImage(result)) {
      built = { image: result.image, signature };
      refusal = null;
    } else {
      built = null;
      refusal = result.refusal;
    }
    return built?.image ?? null;
  }

  // -------------------------------------------------------------- the pins --

  interface ConnectorRow {
    readonly id: string;
    readonly width: number;
    readonly direction: '输入' | '输出';
  }

  /** The connectors the circuit has now, in the order the cards list them. */
  function connectorRows(): readonly ConnectorRow[] {
    const state = store.get();
    if (!isSandbox(state.level)) return [];
    const pins = sandboxPins(state.graph, state.registry);
    return [
      ...pins.inputs.map((pin) => ({ id: pin.id, width: pin.width, direction: '输入' as const })),
      ...pins.outputs.map((pin) => ({ id: pin.id, width: pin.width, direction: '输出' as const })),
    ];
  }

  /**
   * Drop assignments that cannot be used any more: a deleted connector, a
   * connector that became wide, a pin that board does not have (after a board
   * switch) and a second connector on a pin already taken. The image builder
   * refuses the same states, but pruning here is what keeps the pickers usable
   * instead of leaving the player to repair a crossing that the UI created.
   */
  function prunePins(): void {
    const allowed = new Set(boardPinChoices(boardId()));
    const held = new Set<string>();
    const kept: Record<string, string> = {};
    for (const row of connectorRows()) {
      const pin = pinMap[row.id];
      if (pin === undefined) continue;
      if (row.width !== 1 || !allowed.has(pin) || held.has(pin)) continue;
      held.add(pin);
      kept[row.id] = pin;
    }
    const before = Object.keys(pinMap).length;
    const after = Object.keys(kept).length;
    if (before === after && Object.keys(kept).every((id) => pinMap[id] === kept[id])) return;
    for (const id of Object.keys(pinMap)) delete pinMap[id];
    Object.assign(pinMap, kept);
    rememberPrefs();
  }

  /** Rebuild the connector rows and their pin pickers. */
  function renderPins(): void {
    prunePins();
    const rows = connectorRows();
    pinList.replaceChildren();
    if (rows.length === 0) {
      pinList.append(element('div', 'flash-empty', '沙盒里还没有连接器：放一个「关卡输入」或「关卡输出」再选引脚。'));
      return;
    }
    const choices = boardPinChoices(boardId());
    const holder = new Map<string, string>();
    for (const row of rows) {
      const pin = pinMap[row.id];
      if (pin !== undefined) holder.set(pin, row.id);
    }
    for (const row of rows) {
      const line = element('div', 'flash-pin-row');
      line.append(element('span', 'flash-pin-name', `${row.direction} ${row.id}`));
      if (row.width !== 1) {
        line.append(element('span', 'flash-empty', `${row.width} 位：只走串口`));
        pinList.append(line);
        continue;
      }
      const select = element('select', 'flash-input');
      const none = element('option', undefined, '不接');
      none.value = '';
      select.append(none);
      for (const pin of choices) {
        const option = element('option', undefined, `引脚 ${pin}`);
        option.value = pin;
        const takenBy = holder.get(pin);
        option.disabled = takenBy !== undefined && takenBy !== row.id;
        select.append(option);
      }
      select.value = pinMap[row.id] ?? '';
      select.addEventListener('change', () => {
        if (select.value === '') delete pinMap[row.id];
        else pinMap[row.id] = select.value;
        rememberPrefs();
        if (visible) render();
      });
      line.append(select);
      pinList.append(line);
    }
  }

  function buildNow(): void {
    message = null;
    const image = ensureImage();
    if (image !== null) {
      message = {
        text: `映像已构建：${image.report.nodes} 个节点，预计 ${image.report.flashBytes} B flash、${image.report.ramBytes} B RAM。`,
        tone: 'good',
      };
    }
    render();
  }

  function download(): void {
    const image = ensureImage();
    if (image === null) {
      render();
      return;
    }
    const plan = planFor(image);
    if (options.onDownload !== undefined) {
      options.onDownload(plan.fileName, plan.request.sketch);
      message = { text: `已生成 ${plan.fileName}（${plan.request.sketch.length} 字符）。`, tone: 'good' };
      render();
      return;
    }
    try {
      const url = URL.createObjectURL(new Blob([plan.request.sketch], { type: 'text/plain' }));
      const link = element('a');
      link.href = url;
      link.download = plan.fileName;
      link.click();
      URL.revokeObjectURL(url);
      message = { text: `已下载 ${plan.fileName}：把它放进同名文件夹，用 Arduino IDE 打开即可。`, tone: 'good' };
    } catch {
      message = { text: '浏览器拒绝下载文件：请检查下载设置。', tone: 'bad' };
    }
    render();
  }

  // ------------------------------------------------------------ the bridge --

  function makeClient(): FlashClient {
    const url = urlInput.value.trim();
    const token = tokenInput.value.trim();
    return new FlashClient({
      baseUrl: url === '' ? DEFAULT_BRIDGE_URL : url,
      ...(token === '' ? {} : { token }),
      ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    });
  }

  function syncPorts(): void {
    const ports = health?.ports ?? [];
    const wanted = portSelect.value;
    portSelect.replaceChildren();
    const placeholder = element(
      'option',
      undefined,
      ports.length === 0 ? '未发现串口（点「检查连接」）' : '选择串口',
    );
    placeholder.value = '';
    portSelect.append(placeholder);
    for (const port of ports) {
      const option = element('option', undefined, `${port.address} · ${port.label}`);
      option.value = port.address;
      portSelect.append(option);
    }
    portSelect.disabled = ports.length === 0;
    if (wanted !== '' && ports.some((port) => port.address === wanted)) portSelect.value = wanted;
    else if (ports.length === 1) portSelect.value = ports[0]!.address;
  }

  async function checkBridge(): Promise<void> {
    if (busy !== null) return;
    busy = '正在检查本地桥…';
    render();
    health = await makeClient().health();
    busy = null;
    syncPorts();
    render();
  }

  async function runCompile(upload: boolean): Promise<void> {
    if (busy !== null) return;
    const image = ensureImage();
    if (image === null) {
      render();
      return;
    }
    const port = portSelect.value;
    if (upload && port === '') {
      message = { text: '先选择一个串口（或点「检查连接」刷新列表）再烧录。', tone: 'warn' };
      render();
      return;
    }
    // `arduino-cli` cannot open a port Web Serial is holding, so an upload owns
    // the port: close it through the same teardown path 「断开」 uses, then let
    // the player reconnect after the flash.
    if (upload) await disconnectSerial();
    busy = upload ? '正在烧录…这一步会调用 arduino-cli，可能需要半分钟。' : '正在编译…';
    build = null;
    render();
    const client = makeClient();
    const plan = planFor(image);
    const result = upload
      ? await client.flash({ ...plan.request, port })
      : await client.compile(plan.request);
    build = { result, action: upload ? 'flash' : 'compile' };
    busy = null;
    message = result.ok
      ? {
          text: upload
            ? `烧录完成：${result.flashBytes ?? '—'} B flash、${result.ramBytes ?? '—'} B RAM。点「连接串口」读板子的横幅。`
            : `编译通过：${result.flashBytes ?? '—'} B flash、${result.ramBytes ?? '—'} B RAM。`,
          tone: 'good',
        }
      : { text: failureText(result), tone: 'bad' };
    render();
  }

  // ------------------------------------------------------------ the serial --

  function appendSerial(text: string): void {
    serialLines.push(text);
    if (serialLines.length > 200) serialLines = serialLines.slice(-200);
    serialLog.textContent = serialLines.join('\n');
    serialLog.scrollTop = serialLog.scrollHeight;
  }

  function handleLine(raw: string): void {
    const line = parseBoardLine(raw);
    if (line === null) return;
    appendSerial(`< ${raw}`);
    if (line.kind === 'banner') banner = line;
    else if (line.kind === 'frame') frame = line;
    else if (line.kind === 'error') serialMessage = line.message;
    render();
  }

  async function connectSerial(): Promise<void> {
    if (serial !== null || connecting) return;
    const api = serialApi(options.serialSource ?? globalThis.navigator);
    if (api === null) {
      serialMessage = '此浏览器没有 Web Serial：请用 Chrome 或 Edge，并从 localhost 打开本页。';
      render();
      return;
    }
    connecting = true;
    serialMessage = '';
    render();
    try {
      const port: SerialPortLike = await api.requestPort();
      const link = new SerialLink({
        onLine: (line) => handleLine(line),
        onClose: () => {
          serial = null;
          appendSerial('— 串口已关闭 —');
          render();
        },
        onError: (text) => {
          serialMessage = text;
          render();
        },
      });
      await link.open(port);
      serial = link;
      appendSerial('— 串口已连接 —');
      // Ask for the banner: the board printed one at boot, which was before this
      // tab opened the port, so the first useful thing a fresh connection sees is
      // the answer to `B`.
      await link.write('B').catch(() => undefined);
    } catch (error) {
      const name = error instanceof Error ? error.name : '';
      serialMessage =
        name === 'NotFoundError'
          ? '没有选择串口。'
          : name === 'SecurityError'
            ? '浏览器拒绝了串口权限。'
            : '无法打开串口：它可能被 Arduino IDE 或另一个标签页占用。';
    } finally {
      connecting = false;
      render();
    }
  }

  async function disconnectSerial(): Promise<void> {
    const link = serial;
    serial = null;
    try {
      await link?.close();
    } catch {
      // The link's own teardown path reports anything that matters.
    }
    render();
  }

  async function sendLine(line: string): Promise<void> {
    const link = serial;
    if (link === null) {
      serialMessage = '尚未连接串口。';
      render();
      return;
    }
    try {
      await link.write(line);
      appendSerial(`> ${line}`);
      serialMessage = '';
    } catch {
      serialMessage = '发送失败：串口可能已断开。';
    }
    render();
  }

  function sendCommand(): void {
    const text = commandInput.value.trim();
    if (text === '') return;
    commandInput.value = '';
    void sendLine(text);
  }

  async function syncFromPage(): Promise<void> {
    if (built === null) {
      serialMessage = '先构建映像，才能知道要同步哪几个输入连接器。';
      render();
      return;
    }
    const vector = options.vector?.() ?? {};
    for (const pin of built.image.inputs) {
      const value = Math.max(0, Math.floor(vector[pin.id] ?? 0));
      const max = pin.width >= 32 ? 0xffff_ffff : 2 ** pin.width - 1;
      const clamped = Math.min(max, value);
      const fieldElement = inputFields.get(pin.id);
      if (fieldElement !== undefined) fieldElement.value = String(clamped);
      await sendLine(`I ${pin.index} ${clamped}`);
    }
  }

  // --------------------------------------------------------------- drawing --

  function staleNow(): boolean {
    if (built === null) return false;
    return built.signature !== signatureOf(store.get().level, store.get().graph);
  }

  function renderIo(): void {
    const image = built?.image ?? null;
    if (image !== lastInputsFor) {
      lastInputsFor = image;
      inputFields = new Map();
      inputsBox.replaceChildren();
      if (image === null) {
        inputsBox.append(element('div', 'flash-empty', '构建映像后这里列出输入连接器。'));
      } else if (image.inputs.length === 0) {
        inputsBox.append(element('div', 'flash-empty', '这块电路没有输入连接器。'));
      } else {
        for (const pin of image.inputs) {
          const row = element('div', 'flash-pin-row');
          row.append(element('span', 'flash-pin-name', pin.id));
          const input = element('input', 'flash-input flash-pin-value');
          input.type = 'number';
          input.min = '0';
          input.max = String(pin.width >= 32 ? 0xffff_ffff : 2 ** pin.width - 1);
          input.value = '0';
          input.disabled = serial === null;
          inputFields.set(pin.id, input);
          const max = Number(input.max);
          const send = button('发送', () => {
            const value = Math.max(0, Math.min(max, Math.floor(Number(input.value) || 0)));
            input.value = String(value);
            void sendLine(`I ${pin.index} ${value}`);
          });
          row.append(input, send);
          inputsBox.append(row);
        }
      }
    }

    // The fields are built once per image, so their enabled state is refreshed
    // on every render instead: a port connected after the build must make them
    // typeable, and an upload (which closes the port) must grey them again.
    for (const field of inputFields.values()) field.disabled = serial === null;

    outputsBox.replaceChildren();
    if (built === null) {
      outputsBox.append(element('div', 'flash-empty', '构建映像后这里列出输出连接器。'));
    } else {
      for (const pin of built.image.outputs) {
        const row = element('div', 'flash-pin-row');
        row.append(element('span', 'flash-pin-name', pin.id));
        const value = frame?.outputs[pin.index];
        row.append(element('span', 'flash-pin-value flash-readout', value === undefined ? '—' : String(value)));
        outputsBox.append(row);
      }
    }
  }

  function renderBanner(): void {
    if (banner === null) {
      bannerLine.textContent = '尚未收到板子的横幅：连接串口后它会自己报出来。';
      toneOf(bannerLine, 'info');
      return;
    }
    bannerLine.textContent = `板子：${banner.nodes} 节点 · ${banner.slotBytes} B/槽 · 输入 ${banner.inputCount} · 输出 ${banner.outputCount} · hash ${banner.hash.toString(16)}`;
    if (built === null) {
      toneOf(bannerLine, 'warn');
      return;
    }
    if (banner.hash === built.image.hash) {
      bannerLine.textContent += ' · 与屏幕上的电路一致';
      toneOf(bannerLine, 'good');
    } else {
      bannerLine.textContent += ' · 板子跑的是另一块电路';
      toneOf(bannerLine, 'bad');
    }
  }

  function renderFrame(): void {
    if (frame === null) {
      frameLine.textContent = '尚未收到帧：连接后点「单步 T」或「读取 S」。';
      toneOf(frameLine, 'info');
      return;
    }
    const values =
      built === null
        ? frame.outputs.map((value, index) => `#${index}=${value}`).join(' ')
        : built.image.outputs.map((pin) => `${pin.id}=${frame?.outputs[pin.index] ?? '—'}`).join(' ');
    frameLine.textContent = `第 ${frame.tick} 拍 · ${frame.stable ? '已稳定' : '未稳定'}${values === '' ? '' : ` · ${values}`}`;
    toneOf(frameLine, frame.stable || built !== null ? 'good' : 'warn');
  }

  function render(): void {
    if (!visible) return;
    renderPins();
    const image = built?.image ?? null;
    const profile = boardProfile(boardId());
    const choice = selectedBoard();
    const stale = staleNow();
    const pinCount =
      image === null ? 0 : image.pinInputs.length + image.pinOutputs.length;

    buildButton.disabled = busy !== null;
    downloadButton.disabled = image === null;
    healthButton.disabled = busy !== null;
    compileButton.disabled = busy !== null || image === null;
    flashButton.disabled = busy !== null || image === null || portSelect.value === '';
    connectButton.disabled = serial !== null || connecting;
    disconnectButton.disabled = serial === null;
    commandInput.disabled = serial === null;
    for (const control of [tickButton, resetButton, pollButton, syncButton]) control.disabled = serial === null;

    if (image === null) {
      summary.textContent = isSandbox(store.get().level) ? '尚未构建映像。' : '开发板只在沙盒里可用。';
      limits.textContent = `${choice.name} · 预算：RAM ${profile.maxRam} B · flash ${profile.maxFlash} B`;
    } else {
      const report = image.report;
      summary.textContent = `${report.instances} 元件 · ${report.expanded} 展开 · ${report.nodes} 节点 · ${report.slots} 槽位 · ${report.stateCount} 状态 · ${report.tables} 表${pinCount === 0 ? '' : ` · ${pinCount} 个引脚`}`;
      limits.textContent = `${choice.name} · RAM ≈ ${report.ramBytes} B / ${profile.maxRam} B · flash ≈ ${report.flashBytes} B / ${profile.maxFlash} B · ${report.mode === 'dag' ? '顺序求值' : '迭代收敛'}`;
    }
    staleNote.hidden = !stale;
    staleNote.textContent = stale ? '电路已改动：重新构建后才会把新的电路写进板子。' : '';
    refusalNote.hidden = refusal === null;
    if (refusal !== null) refusalNote.textContent = refusal.zh;
    messageNote.hidden = message === null;
    if (message !== null) {
      messageNote.textContent = message.text;
      toneOf(messageNote, message.tone);
    }

    if (busy !== null) {
      bridgeStatus.textContent = busy;
      toneOf(bridgeStatus, 'info');
    } else if (health === null) {
      bridgeStatus.textContent = '尚未检查本地桥：在仓库根目录运行 `node tools/arduino-bridge.mjs`，然后点「检查连接」。';
      toneOf(bridgeStatus, 'info');
    } else if (health.ok) {
      bridgeStatus.textContent = `${health.cli ?? 'arduino-cli'} · arduino:avr 已安装 · ${health.ports.length} 个串口`;
      toneOf(bridgeStatus, 'good');
    } else {
      bridgeStatus.textContent = `本地桥未就绪：${health.error ?? '未知原因'}`;
      toneOf(bridgeStatus, 'bad');
    }

    if (build === null) {
      bridgeLog.hidden = true;
      bridgeLog.textContent = '';
    } else {
      bridgeLog.hidden = false;
      const title = build.action === 'flash' ? '烧录' : '编译';
      const verdict = build.result.ok ? '成功' : '失败';
      const sizes =
        build.result.flashBytes === null
          ? ''
          : ` · ${build.result.flashBytes} B flash / ${build.result.ramBytes ?? '—'} B RAM`;
      bridgeLog.textContent = `${title}${verdict}（退出码 ${build.result.code ?? '—'}）${sizes}\n${build.result.log}${build.result.error === undefined ? '' : `\n${build.result.error}`}`.trim();
    }

    renderBanner();
    renderFrame();
    serialNote.textContent = serialMessage;
    serialNote.hidden = serialMessage === '';
    toneOf(serialNote, 'bad');
    serialLog.hidden = serialLines.length === 0;
    renderIo();
  }

  // ------------------------------------------------------------------ boot --
  // The remembered board is the picker's row, not the FQBN: two rows share the
  // Nano's chip and only one of them carries the old bootloader's options. The
  // pin assignments ride along in the same record.
  rememberPrefs();
  urlInput.addEventListener('change', () => {
    rememberPrefs();
  });
  boardSelect.addEventListener('change', () => {
    rememberPrefs();
    // The pin list belongs to the board too: a Mega pin is not an Uno pin, so a
    // switch prunes the assignments that the new board cannot make (render does
    // it through the pin card) before the next build.
    if (visible) render();
  });
  // 烧录 is enabled by the port picker, and nothing in the store changes when a
  // port is chosen: without this the button stayed grey after selecting COM3
  // (found by driving the real board from a browser, not by the unit tests,
  // which called render() by hand until this listener made that unnecessary).
  portSelect.addEventListener('change', () => {
    if (visible) render();
  });
  commandInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') sendCommand();
  });

  return {
    render,
    reveal() {
      visible = true;
      if (built === null || staleNow()) ensureImage();
      render();
    },
    setVisible(next) {
      visible = next;
      if (next) render();
    },
    destroy() {
      unsubscribe();
      void serial?.close();
      wrap.remove();
    },
  };
}
