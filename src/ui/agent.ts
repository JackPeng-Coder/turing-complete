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
 * THE SETTINGS CARD OPENS ITSELF ON A FIRST RUN, and can be dismissed. A player
 * who only wants to build circuits by hand must not be locked out of the game by
 * a feature they have not set up; the panel says what is missing and stays out of
 * the way until 发送 is pressed.
 *
 * STREAMING TEXT IS APPENDED, NOT RE-RENDERED. The log is rebuilt whenever its
 * shape changes and a text delta is one `appendData` on a node that already
 * exists, because re-rendering on every token would throw away and rebuild the
 * whole conversation sixty times a second.
 */
import {
  STEP_CHOICES,
  clearAgentConfig,
  emptyConfig,
  isConfigured,
  markSetupSeen,
  saveAgentConfig,
  setupSeen,
  type AgentConfig,
} from '../agent/config';
import type { AgentHost } from '../agent/host';
import { runAgent, type AgentEvent } from '../agent/loop';
import type { WireMessage } from '../agent/wire';

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

export interface AgentPanelOptions {
  readonly host: AgentHost;
  /** The settings as they stand, or `null` when the player has never set them. */
  readonly config: () => AgentConfig | null;
  /** Called when the settings card is saved. */
  readonly onSave: (config: AgentConfig) => void;
  /** Called when the player asks for the key to be forgotten. */
  readonly onClear: () => void;
  /** Injectable so a test can run a scripted turn without a network. */
  readonly run?: typeof runAgent;
}

export interface AgentPanel {
  /** Redraws the log, the buttons and the status line. */
  render(): void;
  /** Opens the settings card (the boot path uses it on a first run). */
  openSettings(): void;
  /** Opens the conversation card, e.g. from a keyboard shortcut. */
  open(): void;
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

export function mountAgentPanel(stage: HTMLElement, options: AgentPanelOptions): AgentPanel {
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

  const overlay = document.createElement('div');
  overlay.className = 'overlay overlay-agent';

  const toggle = button('Agent', 'agent-toggle');
  toggle.setAttribute('aria-label', '打开或关闭 Agent');

  const card = document.createElement('section');
  card.className = 'agent-card';
  card.hidden = true;

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

  card.append(head, log, compose);

  // -- the settings card, which is a card of its own so it can stand alone -----
  // THE CARD IS NEVER HIDDEN ON ITS OWN: the overlay around it is what closes it,
  // and a card that could be hidden inside a live overlay would be a modal that
  // covers the screen while showing nothing to answer.
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
  const model = field('模型', '例如 deepseek-chat', 'text');

  const paceWrap = document.createElement('label');
  paceWrap.className = 'agent-field';
  const paceLabel = document.createElement('span');
  paceLabel.textContent = '搭建速度';
  const pace = document.createElement('select');
  for (const choice of STEP_CHOICES) {
    const option = document.createElement('option');
    option.value = String(choice.ms);
    option.textContent = choice.label;
    pace.append(option);
  }
  const paceNote = document.createElement('small');
  paceNote.textContent = '每条操作之间停顿多久，好让你看清每一步';
  paceWrap.append(paceLabel, pace, paceNote);
  setup.append(paceWrap);

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

  overlay.append(toggle, card);
  // The settings card is a MODAL in its own overlay rather than another card in
  // the column: on a first run there is nothing else to do with the panel, and a
  // card that dims the board says "this one thing first" without a dialog API.
  const setupOverlay = document.createElement('div');
  setupOverlay.className = 'overlay overlay-agent-setup';
  setupOverlay.append(setup);
  // HIDDEN ON THE OVERLAY, NOT ON THE CARD. The overlay is what covers the stage
  // and takes the pointer; a hidden card inside a live overlay is a screen that
  // looks closed and swallows every click on the board behind it.
  setupOverlay.hidden = true;
  stage.append(overlay, setupOverlay);

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

    toggle.textContent = ready ? 'Agent' : 'Agent ·未配置';
    toggle.classList.toggle('agent-toggle-warn', !ready);
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
    const config = options.config() ?? emptyConfig();
    baseUrl.value = config.baseUrl;
    apiKey.value = config.apiKey;
    model.value = config.model;
    pace.value = String(config.stepMs);
    setupOverlay.hidden = false;
    baseUrl.focus();
  };

  const open = (): void => {
    setupOverlay.hidden = true;
    card.hidden = false;
    render();
    input.focus();
  };

  toggle.addEventListener('click', () => {
    if (card.hidden) open();
    else card.hidden = true;
  });
  closeBtn.addEventListener('click', () => {
    card.hidden = true;
  });
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
      stepMs: Number(pace.value),
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
    // Remembered, so this is a first-run question rather than an every-run one.
    markSetupSeen();
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
  // A FIRST RUN ASKS FOR THE API INFORMATION, ONCE. The panel decides, not the
  // caller: "there is no configuration" is the panel's own fact (it is the same
  // `isConfigured` the send button asks), and two places deciding it is one place
  // too many. `setupSeen` is what keeps it from being asked on every reload --
  // the card takes the pointer while it is up, so an unanswered question that
  // came back forever would be an unplayable game.
  if (!isConfigured(options.config()) && !setupSeen()) openSettings();
  return { render, openSettings, open };
}
