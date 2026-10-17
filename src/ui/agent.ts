/**
 * The agent panel: a conversation, a settings card, and the button that opens it.
 *
 * WHAT THIS FILE IS NOT. It is not a second editor. Every circuit change comes
 * from a tool call, every tool call goes through `AgentHost` into the same
 * command stack the player's mouse uses, and this panel only ever draws what the
 * loop reports. If the agent is stopped mid-build, the board is exactly where it
 * stopped and 撤销 still walks back through it.
 *
 * THE THREE STATES A TOOL ROW HAS come from what a person actually needs to see:
 * the call has been asked for (`准备`), it is running (`执行`), it is done and
 * whether it worked (`完成` / `失败`). While a step is running the row is the
 * only place the player can see what is being done to their circuit, and after it
 * has finished the row is the record of it -- so the result line is kept, not
 * cleared.
 *
 * THE PANEL REPORTS A MISSING CONFIGURATION; IT DOES NOT INTERRUPT FOR ONE. A
 * first run used to open the settings over the board, which put a question the
 * player had not asked for in front of the thing they came to do. Now the panel
 * carries one line -- 还没有配置 API -- with a button to the settings, and the
 * board is never covered. The game plays fine without any of it.
 *
 * STREAMING TEXT IS APPENDED, NOT RE-RENDERED. The log is rebuilt whenever its
 * shape changes and a text delta is one `appendData` on a node that already
 * exists, because re-rendering on every token would throw away and rebuild the
 * whole conversation sixty times a second.
 */
import {
  clearAgentConfig,
  emptyConfig,
  isConfigured,
  saveAgentConfig,
  type AgentConfig,
} from '../agent/config';
import type { AgentHost } from '../agent/host';
import { runAgent, type AgentEvent } from '../agent/loop';
import type { WireMessage } from '../agent/wire';
import { iconSvg } from './shell';

/** One tool call, as a row in the log. */
interface ToolRow {
  readonly name: string;
  state: 'start' | 'end';
  ok: boolean;
  summary: string;
}

/**
 * One step of the model's work, as the log holds it.
 *
 * `thought` and `text` are kept apart because they are read differently: the
 * reasoning is the long part that only matters WHILE it is being written, and the
 * answer is the short part that matters after. Keeping them apart is also what
 * lets the block fold away without taking the answer with it.
 */
interface AgentEntry {
  readonly kind: 'agent';
  thought: string;
  text: string;
  readonly tools: ToolRow[];
  /** Still arriving. A live step shows a few lines; a finished one folds. */
  live: boolean;
  /** The player opened the folded block, and it stays open across renders. */
  opened: boolean;
}

type Entry =
  | { readonly kind: 'user'; readonly text: string }
  | AgentEntry
  | { readonly kind: 'notice'; readonly text: string; readonly tone: 'info' | 'error' };

/** The two places a panel lives in the workbench: its rail button and its dock. */
export interface AgentPanelHosts {
  /** The activity rail, where the button that opens the panel goes. */
  readonly toggle: HTMLElement;
  /** The secondary sidebar, where the conversation is docked. */
  readonly sidebar: HTMLElement;
}

export interface AgentPanelOptions {
  readonly host: AgentHost;
  /** The settings as they stand, or `null` when the player has never set them. */
  readonly config: () => AgentConfig | null;
  /** Called when the settings card is saved. */
  readonly onSave: (config: AgentConfig) => void;
  /** Called when the player asks for the key to be forgotten. */
  readonly onClear: () => void;
  /** Called when the panel claims or gives back its dock. */
  readonly onVisibility?: (open: boolean) => void;
  /** Injectable so a test can run a scripted turn without a network. */
  readonly run?: typeof runAgent;
}

export interface AgentPanel {
  /** Redraws the log, the buttons and the status line. */
  render(): void;
  /** Opens the settings card (the 设置 button and a missing configuration use it). */
  openSettings(): void;
  /** Opens the conversation card, e.g. from the rail. */
  open(): void;
  /** Gives the dock back to the board. */
  close(): void;
}

/** A tool result as one readable line, rather than the raw JSON envelope. */
function summarise(text: string): string {
  try {
    const parsed = JSON.parse(text) as { ok?: boolean; error?: string; result?: unknown };
    if (parsed.ok === false) return parsed.error ?? '失败';
    if (parsed.result === undefined) return '完成';
    const value = JSON.stringify(parsed.result);
    return value.length > 160 ? `${value.slice(0, 157)}…` : value;
  } catch {
    return text.slice(0, 160);
  }
}

function button(label: string, className: string): HTMLButtonElement {
  const element = document.createElement('button');
  element.type = 'button';
  element.className = className;
  element.textContent = label;
  return element;
}

export function mountAgentPanel(hosts: AgentPanelHosts, options: AgentPanelOptions): AgentPanel {
  const run = options.run ?? runAgent;
  const entries: Entry[] = [];
  /** The conversation as the API sees it: no system message, which the loop adds. */
  const history: WireMessage[] = [];
  let current: AgentEntry | null = null;
  /**
   * The body of the step that is being written right now.
   *
   * A reference rather than a re-render per token: the tail of the stream is what
   * is visible, so each delta only has to extend the text and keep the box
   * scrolled to the bottom.
   */
  let liveBody: HTMLElement | null = null;
  let controller: AbortController | null = null;
  let busy = false;
  let status = '';

  // THE RAIL BUTTON IS ICON-ONLY, because the rail is 48px wide: its accessible
  // name and its warning class are what say "not configured yet", and the panel
  // itself is where that fact is explained.
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'activity-btn agent-toggle';
  toggle.setAttribute('aria-label', 'Agent');
  toggle.title = 'Agent';
  toggle.append(iconSvg('agent'));
  hosts.toggle.append(toggle);

  const card = document.createElement('section');
  card.className = 'agent-card';
  card.hidden = true;
  hosts.sidebar.append(card);

  const head = document.createElement('header');
  head.className = 'agent-head';
  const title = document.createElement('span');
  title.className = 'agent-title';
  title.textContent = 'Agent';
  const settingsBtn = button('设置', 'agent-btn agent-btn-quiet');
  const closeBtn = button('✕', 'agent-btn agent-btn-quiet');
  closeBtn.setAttribute('aria-label', '关闭 Agent 面板');
  head.append(title, settingsBtn, closeBtn);

  const log = document.createElement('div');
  log.className = 'agent-log';

  const compose = document.createElement('div');
  compose.className = 'agent-compose';
  const input = document.createElement('textarea');
  input.className = 'agent-input';
  input.rows = 2;
  input.placeholder = '用中文说要做什么，例如：把两个输入接到一个与非门，输出接出去';
  const actions = document.createElement('div');
  actions.className = 'agent-actions';
  const sendBtn = button('发送', 'agent-btn agent-btn-go');
  const stopBtn = button('停止', 'agent-btn');
  const statusLine = document.createElement('span');
  statusLine.className = 'agent-status';
  actions.append(sendBtn, stopBtn, statusLine);
  compose.append(input, actions);

  // THE PANEL'S OWN ANSWER TO "NOTHING IS CONFIGURED": a line, not a dialog.
  // It sits above the composer, because that is where the player is about to
  // find out that sending cannot work, and it says what to do with one button.
  const setupHint = document.createElement('div');
  setupHint.className = 'agent-setup-hint';
  const setupHintText = document.createElement('span');
  setupHintText.textContent = '还没有配置 API：填好地址、key 和模型才能发送。';
  const setupHintOpen = button('打开设置', 'agent-btn agent-btn-quiet');
  setupHintOpen.addEventListener('click', () => openSettings());
  setupHint.append(setupHintText, setupHintOpen);
  setupHint.hidden = true;

  card.append(head, log, setupHint, compose);

  // -- the settings card, which is a card of its own so it can stand alone -----
  // THE SETTINGS CARD IS A MODAL OF ITS OWN. The conversation card's own `hidden`
  // now means "the dock is closed", so the settings cannot ride on it; they get
  // their own overlay, their own `hidden`, and the body as their parent -- a
  // fixed overlay inside a collapsed sidebar could never be seen.
  const setup = document.createElement('section');
  setup.className = 'agent-card agent-setup';

  const setupHead = document.createElement('header');
  setupHead.className = 'agent-head';
  const setupTitle = document.createElement('span');
  setupTitle.className = 'agent-title';
  setupTitle.textContent = 'Agent 设置';
  setupHead.append(setupTitle);

  const field = (labelText: string, hint: string, type: string): HTMLInputElement => {
    const wrap = document.createElement('label');
    wrap.className = 'agent-field';
    const span = document.createElement('span');
    span.textContent = labelText;
    const control = document.createElement('input');
    control.type = type;
    control.autocomplete = 'off';
    control.spellcheck = false;
    const note = document.createElement('small');
    note.textContent = hint;
    wrap.append(span, control, note);
    setup.append(wrap);
    return control;
  };

  const baseUrl = field('API 地址', '例如 https://api.deepseek.com，也可以直接填完整的 chat/completions 地址', 'text');
  const apiKey = field('API key', '只保存在这台浏览器的 localStorage 里，同源的脚本读得到；换机器要重填', 'password');
  const model = field('模型', '例如 deepseek-flash', 'text');

  const setupActions = document.createElement('div');
  setupActions.className = 'agent-actions';
  const saveBtn = button('保存', 'agent-btn agent-btn-go');
  const laterBtn = button('以后再说', 'agent-btn');
  const forgetBtn = button('清除已保存的 key', 'agent-btn agent-btn-quiet');
  setupActions.append(saveBtn, laterBtn, forgetBtn);
  const setupNote = document.createElement('p');
  setupNote.className = 'agent-note';
  setupNote.textContent =
    '这个游戏没有服务器：请求由浏览器直接发给上面这个地址。对方必须允许跨域，否则会连不上（DeepSeek、Moonshot、智谱都允许）。';
  setup.append(setupActions, setupNote);

  const setupOverlay = document.createElement('div');
  setupOverlay.className = 'overlay overlay-agent-setup';
  setupOverlay.append(setup);
  // HIDDEN ON THE OVERLAY, NOT ON THE CARD. The overlay is what covers the stage
  // and takes the pointer; a hidden card inside a live overlay is a screen that
  // looks closed and swallows every click on the board behind it.
  setupOverlay.hidden = true;
  document.body.append(setupOverlay);

  // ------------------------------------------------------------------ render --

  /** A step with nothing in it yet. */
  const newAgentEntry = (): AgentEntry => ({
    kind: 'agent',
    thought: '',
    text: '',
    tools: [],
    live: true,
    opened: false,
  });

  /** Everything the model has said in this step, reasoning first. */
  const streamOf = (entry: AgentEntry): string =>
    [entry.thought, entry.text].filter((part) => part !== '').join('\n');

  /**
   * The foldable block a step's prose lives in.
   *
   * WHILE IT IS BEING WRITTEN it is a fixed-height window onto the last few
   * lines: a model thinking out loud produces far more text than a panel can
   * show, and the only part worth watching is the newest. ONCE THE STEP IS DONE
   * it folds to one line -- the reasoning has served its purpose the moment the
   * work it describes is on the board -- and the player can open it again by
   * clicking the header. An `article` of a thousand words that nobody asked to
   * keep is what makes a log unreadable.
   */
  function thinkBlock(text: string, entry: AgentEntry, live: boolean): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = live ? 'agent-think agent-think-live' : 'agent-think';
    const head = document.createElement('button');
    head.type = 'button';
    head.className = 'agent-think-head';
    const lines = text === '' ? 0 : text.split('\n').length;
    head.textContent = live ? '思考中…' : `${entry.opened ? '▾' : '▸'} 思考 · ${lines} 行`;
    const bodyEl = document.createElement('p');
    bodyEl.className = 'agent-think-body';
    bodyEl.textContent = text;
    if (!live) {
      bodyEl.hidden = !entry.opened;
      head.addEventListener('click', () => {
        entry.opened = !entry.opened;
        render();
      });
    }
    wrap.append(head, bodyEl);
    if (live) liveBody = bodyEl;
    return wrap;
  }

  const render = (): void => {
    const config = options.config();
    const ready = isConfigured(config);

    log.textContent = '';
    liveBody = null;
    for (const entry of entries) {
      if (entry.kind === 'user') {
        const line = document.createElement('article');
        line.className = 'agent-line agent-user';
        line.textContent = entry.text;
        log.append(line);
        continue;
      }
      if (entry.kind === 'notice') {
        const line = document.createElement('article');
        line.className = `agent-line agent-notice agent-${entry.tone}`;
        line.textContent = entry.text;
        log.append(line);
        continue;
      }
      const line = document.createElement('article');
      line.className = 'agent-line agent-reply';
      const stream = streamOf(entry);
      const worked = entry.tools.length > 0;
      if (entry.live) {
        line.append(thinkBlock(stream, entry, true));
      } else if (worked) {
        // The step touched the board, so its prose was working talk: folded,
        // whatever it said, because the tool rows underneath now say more.
        if (stream !== '') line.append(thinkBlock(stream, entry, false));
      } else {
        // The step called no tool, so this is the ANSWER. Its reasoning folds
        // above it and the sentence itself stays where it can be read.
        if (entry.thought !== '') line.append(thinkBlock(entry.thought, entry, false));
        if (entry.text !== '') {
          const text = document.createElement('p');
          text.className = 'agent-text';
          text.textContent = entry.text;
          line.append(text);
        }
      }
      for (const tool of entry.tools) {
        const row = document.createElement('div');
        row.className = `agent-tool agent-tool-${tool.state}${tool.ok ? '' : ' agent-tool-bad'}`;
        row.textContent = tool.state === 'start' ? `${tool.name}…` : `${tool.name} · ${tool.summary}`;
        line.append(row);
      }
      log.append(line);
    }
    log.scrollTop = log.scrollHeight;

    const name = ready ? 'Agent' : 'Agent · 未配置';
    toggle.setAttribute('aria-label', name);
    toggle.title = name;
    toggle.classList.toggle('agent-toggle-warn', !ready);
    setupHint.hidden = ready;
    sendBtn.disabled = busy;
    stopBtn.disabled = !busy;
    input.disabled = busy;
    statusLine.textContent = status;
    statusLine.classList.toggle('agent-status-bad', status.startsWith('出错'));
  };

  /**
   * Extends the step being written, without rebuilding the log.
   *
   * The box is re-filled rather than appended to because reasoning and answer are
   * two fields of one window: whichever arrives second has to appear under the
   * first, and recomputing a few kilobytes of text is cheaper than tracking which
   * end of the stream the cursor is on.
   */
  const appendStream = (text: string, field: 'thought' | 'text'): void => {
    if (current === null) {
      current = newAgentEntry();
      entries.push(current);
      render();
    }
    current[field] += text;
    current.live = true;
    if (liveBody === null) render();
    else {
      liveBody.textContent = streamOf(current);
      liveBody.scrollTop = liveBody.scrollHeight;
    }
    log.scrollTop = log.scrollHeight;
  };

  /** Marks the step in flight as finished: its prose folds from here on. */
  const settle = (): void => {
    if (current !== null) current.live = false;
  };

  // ------------------------------------------------------------------ events --

  const handleEvent = (event: AgentEvent): void => {
    if (event.kind === 'step') {
      settle();
      current = newAgentEntry();
      entries.push(current);
      status = '正在请求模型…';
      render();
      return;
    }
    if (event.kind === 'text') {
      appendStream(event.text, 'text');
      return;
    }
    if (event.kind === 'thinking') {
      appendStream(event.text, 'thought');
      return;
    }
    if (event.kind === 'tool') {
      if (current === null) {
        current = newAgentEntry();
        entries.push(current);
      }
      if (event.phase === 'start') {
        // The prose was the run-up to this call, so it folds now and the row
        // below it takes over as the record of what happened.
        settle();
        current.tools.push({ name: event.name, state: 'start', ok: true, summary: '' });
        status = `正在执行 ${event.name}…`;
      } else {
        const row = current.tools.find((candidate) => candidate.state === 'start' && candidate.name === event.name);
        const target = row ?? { name: event.name, state: 'end' as const, ok: true, summary: '' };
        target.state = 'end';
        target.ok = event.ok ?? true;
        // The tool's own sentence when it has one; the raw result is for the
        // model, not for the person watching the board.
        target.summary = event.note ?? summarise(event.text ?? '');
        if (row === undefined) current.tools.push(target);
        status = target.ok ? `已完成 ${event.name}` : `${event.name} 失败：${target.summary}`;
      }
      render();
      return;
    }
    entries.push({ kind: 'notice', text: event.detail === '' ? event.message : `${event.message}（${event.detail}）`, tone: 'error' });
    status = `出错：${event.message}`;
    render();
  };

  const send = (): void => {
    const config = options.config();
    if (!isConfigured(config)) {
      openSettings();
      status = '先填好 API 信息';
      render();
      return;
    }
    const text = input.value.trim();
    if (text === '' || busy) return;
    input.value = '';
    entries.push({ kind: 'user', text });
    history.push({ role: 'user', content: text });
    current = null;
    busy = true;
    status = '正在请求模型…';
    render();
    controller = new AbortController();
    void run({
      config,
      host: options.host,
      messages: history,
      signal: controller.signal,
      onEvent: handleEvent,
    })
      .then((result) => {
        history.length = 0;
        history.push(...result.messages);
        if (result.stopped === 'aborted') status = '已停止';
        else if (result.stopped === 'error') status = '出错，见上面的提示';
        else if (result.stopped === 'stuck') status = '连着被拒绝了，先停下来了';
        else if (result.stopped === 'capped') status = '达到步数上限，先停下来了';
        else status = '完成';
      })
      .catch((cause: unknown) => {
        const message = cause instanceof Error ? cause.message : String(cause);
        entries.push({ kind: 'notice', text: message, tone: 'error' });
        status = `出错：${message}`;
      })
      .finally(() => {
        settle();
        busy = false;
        controller = null;
        current = null;
        render();
      });
  };

  const openSettings = (): void => {
    // The settings belong to the panel, so asking for them also claims the dock.
    open();
    const config = options.config() ?? emptyConfig();
    baseUrl.value = config.baseUrl;
    apiKey.value = config.apiKey;
    model.value = config.model;
    setupOverlay.hidden = false;
    baseUrl.focus();
  };

  const setVisible = (visible: boolean): void => {
    card.hidden = !visible;
    options.onVisibility?.(visible);
  };

  const open = (): void => {
    setupOverlay.hidden = true;
    setVisible(true);
    render();
    input.focus();
  };

  const close = (): void => {
    setVisible(false);
  };

  toggle.addEventListener('click', () => {
    if (card.hidden) open();
    else close();
  });
  closeBtn.addEventListener('click', close);
  settingsBtn.addEventListener('click', openSettings);
  sendBtn.addEventListener('click', send);
  stopBtn.addEventListener('click', () => {
    controller?.abort();
  });
  input.addEventListener('keydown', (event) => {
    // Enter sends, Shift+Enter is a newline: the same contract as the IDE's own
    // editor, so a player who writes programs here does not have to learn twice.
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      send();
    }
    event.stopPropagation();
  });
  saveBtn.addEventListener('click', () => {
    const config: AgentConfig = {
      baseUrl: baseUrl.value.trim(),
      apiKey: apiKey.value.trim(),
      model: model.value.trim(),
    };
    if (!isConfigured(config)) {
      setupNote.textContent = '地址、key、模型都要填。';
      return;
    }
    saveAgentConfig(config);
    options.onSave(config);
    setupOverlay.hidden = true;
    open();
    status = '已保存';
    render();
  });
  laterBtn.addEventListener('click', () => {
    // Closing without saving: the panel keeps its own line about what is
    // missing, and the game keeps playing.
    setupOverlay.hidden = true;
    render();
  });
  forgetBtn.addEventListener('click', () => {
    clearAgentConfig();
    options.onClear();
    apiKey.value = '';
    setupNote.textContent = '已清除。key 已经不在这个浏览器里了。';
  });

  render();
  // NOTHING OPENS ITSELF. The settings are one button away, and a missing
  // configuration is reported inside the panel, so a first run lands on the
  // board -- the thing the player came for -- rather than on a question about an
  // optional feature.
  return { render, openSettings, open, close };
}
