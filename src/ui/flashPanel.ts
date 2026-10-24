import type { AppState, Store } from '../app/store';
import { boardProfile, BOARDS, DEFAULT_BOARD, type BoardId } from '../flash/boards';
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
import { parseBoardLine, type BoardBanner, type BoardFrame } from '../flash/protocol';
import { isSandbox } from '../levels/sandbox';
import { circuitSignature } from '../persist/sandbox';
import { SerialLink, serialApi, type SerialPortLike } from './serial';

/**
 * 开发板: the panel that writes a sandbox circuit to a real Arduino.
 *
 * THREE CARDS, in the order a player uses them. 映像 is what the circuit compiles
 * to on the board and what it will cost; 本地桥 is the local daemon that runs
 * `arduino-cli` (the browser cannot); 串口 is the board itself, driven by the
 * line protocol in `flash/protocol.ts`. The panel does not own any circuit: it
 * reads the store, builds an image only when asked or when the tab is opened, and
 * caches that image by the circuit's signature so dragging a wire does not
 * rebuild 900 gates every frame.
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
  readonly board?: BoardId;
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
      typeof record.board === 'string' && BOARDS.some((entry) => entry.id === record.board)
        ? (record.board as BoardId)
        : undefined;
    return {
      ...(url === undefined ? {} : { url }),
      ...(board === undefined ? {} : { board }),
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
  for (const board of BOARDS) {
    const option = element('option', undefined, board.name);
    option.value = board.id;
    boardSelect.append(option);
  }
  boardSelect.value = prefs.board ?? DEFAULT_BOARD;
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

  wrap.append(imageCard.section, bridgeCard.section, serialCard.section);

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
  const unsubscribe = store.subscribe(() => {
    if (visible) render();
  });

  // ------------------------------------------------------------- the image --

  function boardId(): BoardId {
    const chosen = boardSelect.value;
    const found = BOARDS.find((entry) => entry.id === chosen);
    return found?.id ?? DEFAULT_BOARD;
  }

  function signatureOf(level: AppState['level'], graph: AppState['graph']): string {
    return `${level.id}@${circuitSignature(graph)}@${boardId()}`;
  }

  /**
   * The built image, built on first use and rebuilt when the circuit or the
   * board changed. A refusal is kept as a refusal: the panel shows why rather
   * than leaving the last good image on screen.
   */
  function ensureImage(): ProgramImage | null {
    const state = store.get();
    if (!isSandbox(state.level)) {
      built = null;
      refusal = null;
      message = { text: '写入开发板只在沙盒里可用：关卡板上的引脚是题目的契约。', tone: 'warn' };
      return null;
    }
    const signature = signatureOf(state.level, state.graph);
    if (built !== null && built.signature === signature) return built.image;
    const result = buildImage(state.graph, state.registry, state.level, boardId());
    if (isImage(result)) {
      built = { image: result.image, signature };
      refusal = null;
    } else {
      built = null;
      refusal = result.refusal;
    }
    return built?.image ?? null;
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
    const plan = planSketch(image, boardId());
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
    busy = upload ? '正在烧录…这一步会调用 arduino-cli，可能需要半分钟。' : '正在编译…';
    build = null;
    render();
    const client = makeClient();
    const plan = planSketch(image, boardId());
    const result = upload
      ? await client.flash({ ...plan.request, port })
      : await client.compile(plan.request);
    build = { result, action: upload ? 'flash' : 'compile' };
    busy = null;
    message = result.ok
      ? {
          text: upload
            ? `烧录完成：${result.flashBytes ?? '—'} B flash、${result.ramBytes ?? '—'} B RAM。断开串口后点「连接串口」查看板子。`
            : `编译通过：${result.flashBytes ?? '—'} B flash、${result.ramBytes ?? '—'} B RAM。`,
          tone: 'good',
        }
      : { text: result.error ?? 'arduino-cli 没有通过：日志见下方。', tone: 'bad' };
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
    const image = built?.image ?? null;
    const profile = boardProfile(boardId());
    const stale = staleNow();

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
      limits.textContent = `${profile.name} · 预算：RAM ${profile.maxRam} B · flash ${profile.maxFlash} B`;
    } else {
      const report = image.report;
      summary.textContent = `${report.instances} 元件 · ${report.expanded} 展开 · ${report.nodes} 节点 · ${report.slots} 槽位 · ${report.stateCount} 状态 · ${report.tables} 表`;
      limits.textContent = `${profile.name} · RAM ≈ ${report.ramBytes} B / ${profile.maxRam} B · flash ≈ ${report.flashBytes} B / ${profile.maxFlash} B · ${report.mode === 'dag' ? '顺序求值' : '迭代收敛'}`;
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
  savePrefs({ url: urlInput.value, board: boardId() });
  urlInput.addEventListener('change', () => {
    savePrefs({ url: urlInput.value, board: boardId() });
  });
  boardSelect.addEventListener('change', () => {
    savePrefs({ url: urlInput.value, board: boardId() });
    // The budget belongs to the board: a refusal for an Uno may be a fit for a
    // Mega, so the stale test has to see the new board, not the old build.
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
