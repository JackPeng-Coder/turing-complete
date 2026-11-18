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
 * 开发板：把沙盒里的电路写进真实 Arduino 的面板。
 *
 * 四张卡，按玩家实际使用的顺序排列。「映像」是电路在板子上编译成的样子与代价；
 * 「引脚」把一位连接器映射到板子的物理引脚（规则在 `pins.ts`），
 * 让电路能驱动 LED 或读取按钮，而不只是走串口；「本地桥」是运行 `arduino-cli`
 * 的本地守护进程（浏览器自己做不到）；「串口」是板子本身，由 `flash/protocol.ts`
 * 里的行协议驱动。面板不拥有任何电路：它读 store，只在被要求或标签页打开时构建映像，
 * 并按电路签名缓存该映像，这样拖动一根导线不会每帧重建 900 个门。
 * 引脚分配与桥、开发板一起记在 `tc.flash.v1` 里，而不是记在电路里：
 * 它属于"电路被烧到哪块板子上"，只改变固件的 I/O，不改变它的代价。
 *
 * 它只是沙盒视图。关卡的引脚是题目的契约，导出器会拒绝关卡板；
 * 组合根在沙盒之外隐藏这个标签页，而 `buildImage` 自己的拒绝是第二道栅栏，
 * 不是重复的一道。
 *
 * 为什么下载在这里而上传不在。浏览器能保存文件，但启动不了 `arduino-cli`；
 * 所以固件草图永远可以手动下载再编译，本地桥只是"顺带上传"的可选便利。
 * 两条路径都用同一个 `planSketch`，因此下载到的和烧进去的字节完全一致。
 */

/** 开发板面板对外的操作句柄。 */
export interface FlashPanel {
  /** 重绘各个读数区；开销很小，并且绝不构建映像。 */
  render(): void;
  /** 底部面板标签被打开：若电路已改动就构建一份新映像。 */
  reveal(): void;
  /** 标签页是否显示；隐藏时面板不做任何工作。 */
  setVisible(visible: boolean): void;
  destroy(): void;
}

/** 挂载选项：测试用的注入缝，以及下载草图的回调。 */
export interface FlashPanelOptions {
  /** `fetch` 的注入缝，供测试使用；默认用平台自带的。 */
  fetch?: FetchLike;
  /** 从中读取 `navigator.serial` 的对象，供测试使用；默认为 `navigator`。 */
  serialSource?: unknown;
  /** 下载的草图去向，供测试使用；默认用 Blob 触发浏览器下载。 */
  onDownload?(fileName: string, sketch: string): void;
  /** 页面上的输入值，供「同步面板输入」按钮使用。 */
  vector?(): Readonly<Record<string, number>>;
}

/** 面板在两次刷新之间记住桥与开发板的 localStorage 键。 */
const PREFS_KEY = 'tc.flash.v1';

interface Prefs {
  readonly url?: string;
  /** `BOARD_CHOICES` 里某一行的 id；Nano 的旧 bootloader 之所以也单独成行，就是为了能把这一选择记住。 */
  readonly board?: string;
  /** 连接器 id 到板子引脚的映射，即「引脚」卡里的分配。 */
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
    // 存档损坏或不可读就当作"没有偏好"，绝不让启动因此失败。
    return {};
  }
}

function savePrefs(prefs: Prefs): void {
  try {
    globalThis.localStorage?.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // 隐私模式或配额已满都会让保存变成空操作；输入框本身仍然照常工作。
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

/** 一条提示；它的颜色表示正在报告的是哪一类信息。 */
function note(className = 'flash-note'): HTMLElement {
  const node = element('div', className);
  node.dataset.tone = 'info';
  return node;
}

function toneOf(node: HTMLElement, tone: 'info' | 'good' | 'bad' | 'warn'): void {
  node.dataset.tone = tone;
}

/**
 * 编译或上传失败时，最后落在面板上的那句话。
 *
 * 玩家最常遇到的两种失败都与电路无关：串口仍被占用（上传前被本卡占着，
 * 或被别的串口工具占着），或者 ATmega 系板子因为选错 bootloader 而不应答。
 * 直接把是哪一种说出来，省得玩家去读 avrdude 日志——
 * 否则只有那份日志才能看出区别。
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

/**
 * 把四张卡（映像、引脚、本地桥、串口）挂到 root 上，返回面板句柄。
 *
 * 订阅 store 以便在可见时重绘；映像按电路签名缓存，切换开发板或引脚分配
 * 都会让缓存失效。面板不拥有电路，也不在隐藏时做任何工作（见 setVisible）。
 */
export function mountFlashPanel(
  root: HTMLElement,
  store: Store<AppState>,
  options: FlashPanelOptions = {},
): FlashPanel {
  const prefs = loadPrefs();
  const wrap = element('div', 'flash-panel');
  root.append(wrap);

  // ------------------------------------------------------------------ 映像 --
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

  // ------------------------------------------------------------------- 引脚 --
  const pinCard = card('引脚');
  const pinHint = note('flash-note flash-pin-hint');
  pinHint.textContent =
    '1 位连接器可以接板子引脚：输出用 digitalWrite，输入用内部上拉读取（按钮接 GND，未接线读 1）。「不接」的连接器只走串口。D0/D1 是串口线，不在列表里。';
  const pinList = element('div', 'flash-pin-list');
  pinCard.body.append(pinHint, pinList);

  // ----------------------------------------------------------------- 本地桥 --
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

  // ----------------------------------------------------------------- 串口 --
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

  // ------------------------------------------------------------------ 状态 --
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
  /** 连接器 id 到板子引脚；由「引脚」卡修改，并持久化到偏好设置里。 */
  const pinMap: Record<string, string> = { ...(prefs.pins ?? {}) };
  const unsubscribe = store.subscribe(() => {
    if (visible) render();
  });

  // ------------------------------------------------------------- 映像构建 --

  function boardId(): BoardId {
    return boardChoice(boardSelect.value).board;
  }

  /** 下拉框选中的那一行，供预算行和发给本地桥的请求使用。 */
  function selectedBoard() {
    return boardChoice(boardSelect.value);
  }

  /** 下载与本地桥请求共同依据的草图方案。 */
  function planFor(image: ProgramImage, port?: string) {
    const choice = selectedBoard();
    return planSketch(image, choice.board, {
      ...(port === undefined ? {} : { port }),
      ...(choice.boardOptions === undefined ? {} : { boardOptions: choice.boardOptions }),
    });
  }

  /** 把引脚分配写成稳定顺序的字符串，作为映像缓存键的一部分。 */
  function pinSignature(): string {
    return Object.keys(pinMap)
      .sort()
      .map((id) => `${id}=${pinMap[id] ?? ''}`)
      .join(',');
  }

  function signatureOf(level: AppState['level'], graph: AppState['graph']): string {
    return `${level.id}@${circuitSignature(graph)}@${boardId()}@${pinSignature()}`;
  }

  /** 把面板自己拥有的全部设置一次存下；各处输入框在变化时调用。 */
  function rememberPrefs(): void {
    savePrefs({ url: urlInput.value, board: boardSelect.value, pins: pinMap });
  }

  /**
   * 已构建的映像：首次使用时构建，并只在电路、开发板或引脚分配变化后重建。
   * 被拒绝就保留"被拒绝"这个结果：面板显示原因，
   * 而不是继续把上一次成功的映像留在屏幕上误导玩家。
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

  // -------------------------------------------------------------- 引脚分配 --

  interface ConnectorRow {
    readonly id: string;
    readonly width: number;
    readonly direction: '输入' | '输出';
  }

  /** 电路当前的连接器，按卡片中的排列顺序。 */
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
   * 丢掉已经不能用的分配：已删除的连接器、变成多位宽的连接器、
   * 当前开发板没有的引脚（切换开发板之后），以及同一个引脚上的第二个连接器。
   * 映像构建器也会拒绝同样的状态，但在这里清理能让下拉框保持可用，
   * 而不是留一个 UI 自己造成的冲突让玩家去修。
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

  /** 重建连接器行以及各自的引脚选择框。 */
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

  // ------------------------------------------------------------ 本地桥 --

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
    // `arduino-cli` 打不开被 Web Serial 占着的串口，所以上传要独占该串口：
    // 走和「断开」相同的收尾路径先关掉它，烧录完成后再让玩家重新连接。
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

  // ------------------------------------------------------------ 串口 --

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
      // 主动索要横幅：板子在启动时打印过一次，而那时本标签页还没打开串口，
      // 所以新连接能看到的第一个有用信息，就是对 `B` 命令的回答。
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
      // 链路的收尾路径会自己报告任何真正重要的问题。
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

  // --------------------------------------------------------------- 绘制 --

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

    // 输入框是按映像一次性建好的，所以它们的可用状态要在每次渲染时刷新：
    // 构建之后才连接上的串口必须让它们可输入，而上传（会关闭串口）
    // 必须把它们重新变灰。
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

  // ------------------------------------------------------------------ 启动 --
  // 记住的"开发板"是下拉框里的一行，而不是 FQBN：Nano 的芯片对应两行，
  // 只有其中一行带有旧 bootloader 的选项。引脚分配也放在同一条记录里。
  rememberPrefs();
  urlInput.addEventListener('change', () => {
    rememberPrefs();
  });
  boardSelect.addEventListener('change', () => {
    rememberPrefs();
    // 引脚列表同样属于开发板：Mega 的引脚不是 Uno 的引脚，
    // 所以切换开发板会在下一次构建之前清掉新板子做不到的分配
    // （由 render 经引脚卡完成）。
    if (visible) render();
  });
  // 「烧录」按钮是否可用由串口下拉框决定，而选串口不会改变 store 里的任何东西：
  // 没有这个监听器时，选中 COM3 之后按钮仍然是灰的（这个问题是在浏览器里
  // 实际操作真实板子时发现的，不是单元测试发现的——那些测试此前一直手动调
  // render()，直到这个监听器让手动调用变得不必要）。
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
