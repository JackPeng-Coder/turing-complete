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
  DEFAULT_MAX_STEPS,
  clearAgentConfig,
  emptyConfig,
  isConfigured,
  saveAgentConfig,
  type AgentConfig,
} from '../agent/config';
import type { AgentHost } from '../agent/host';
import { runAgent, type AgentEvent, type RunStats } from '../agent/loop';
import type { WireMessage } from '../agent/wire';
import {
  formatCacheHitPercent,
  formatCost,
  formatDuration,
  formatElapsed,
  formatExactTokens,
  formatSpeed,
  formatTokens,
  summariseRun,
} from '../agent/format';
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
  | { readonly kind: 'notice'; readonly text: string; readonly tone: 'info' | 'error' }
  /** The step budget ran out; the row carries the button that buys another one. */
  | { readonly kind: 'cap'; readonly limit: number }
  /** One finished request's readings: time, tokens, speed, cache. */
  | { readonly kind: 'run'; readonly stats: RunStats };

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

/**
 * The tooltip of one request's row: the exact numbers the one-line reading hides.
 *
 * A PROVIDER THAT REPORTS NO USAGE SAYS SO rather than showing zeros: "没有返回
 * 用量" is information, and `0 tok` would be a measurement nobody made.
 */
function runDetail(stats: RunStats): string {
  const lines: string[] = [];
  const duration = formatDuration(stats.llmMs);
  if (duration !== null) lines.push(`模型耗时 ${duration}`);
  if (stats.ttftSteps > 0) {
    const ttft = formatDuration(stats.ttftMs / stats.ttftSteps);
    if (ttft !== null) lines.push(`首字平均 ${ttft}`);
  }
  const speed = formatSpeed(stats.decodeTokens, stats.decodeMs);
  if (speed !== null) lines.push(`输出速度 ${speed}`);
  if (stats.usage === null) {
    lines.push('提供方没有返回用量');
  } else {
    lines.push(`输入 ${formatExactTokens(stats.usage.input)} tok`);
    if (stats.usage.cacheRead !== null) {
      lines.push(`其中缓存 ${formatExactTokens(stats.usage.cacheRead)} tok`);
    }
    lines.push(`输出 ${formatExactTokens(stats.usage.output)} tok`);
    lines.push(`合计 ${formatExactTokens(stats.usage.total)} tok`);
  }
  const cost = formatCost(stats.costCny);
  if (cost !== null) lines.push(`估算费用 ${cost}（按 DeepSeek 价目表）`);
  return lines.join('\n');
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
  /**
   * The in-flight run's readings, so the totaliser is live rather than final.
   *
   * The loop emits a `progress` event at every step boundary; the panel sums
   * those with the settled runs and ticks the elapsed time between events.
   */
  let live: { readonly stats: RunStats; readonly steps: number } | null = null;
  let liveStartedAt = 0;
  let liveTimer: ReturnType<typeof setInterval> | null = null;
  /**
   * The readings, summed over this panel's lifetime.
   *
   * NOT PERSISTED, and not part of the conversation: it is a totalising counter
   * on the instrument, and a reload starts it at zero the way a real meter does.
   * The per-request rows in the log keep their own numbers, so resetting the
   * total loses nothing that was said.
   */
  const totals = {
    runs: 0,
    steps: 0,
    llmMs: 0,
    decodeMs: 0,
    decodeTokens: 0,
    input: 0,
    output: 0,
    total: 0,
    cacheRead: null as number | null,
    costCny: null as number | null,
  };

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

  // THE PANEL'S TOTALISER, under the conversation: the same readings as the
  // per-request rows, summed over this session. Hidden until there is something
  // to count, and never a substitute for the rows themselves.
  const sessionStats = document.createElement('div');
  sessionStats.className = 'agent-session-stats';
  sessionStats.hidden = true;

  card.append(head, log, sessionStats, setupHint, compose);

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
  const maxSteps = field('步数上限', '到达后停下，日志末尾会出现「继续执行」；0 表示不设上限', 'number');
  maxSteps.min = '0';
  maxSteps.step = '1';

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

  /**
   * The totaliser under the log: settled between runs, live during one.
   *
   * DURING A RUN the elapsed time comes from this panel's clock and ticks every
   * 200 ms; the tokens, speed, cache share and cost come from the loop's progress
   * events at each step boundary -- a provider sends its usage frame with the
   * answer, so per-step is the finest honest granularity for tokens.
   */
  const renderTotals = (): void => {
    const running = busy;
    const liveStats = live?.stats ?? null;
    const elapsed = running
      ? Math.max(0, (globalThis.performance?.now() ?? Date.now()) - liveStartedAt)
      : 0;
    const input = totals.input + (liveStats?.usage?.input ?? 0);
    const total = totals.total + (liveStats?.usage?.total ?? 0);
    const decodeTokens = totals.decodeTokens + (liveStats?.decodeTokens ?? 0);
    const decodeMs = totals.decodeMs + (liveStats?.decodeMs ?? 0);
    const steps = totals.steps + (live?.steps ?? 0);
    const cacheReads = [totals.cacheRead, liveStats?.usage?.cacheRead ?? null];
    const cacheRead = cacheReads.some((value) => value !== null)
      ? cacheReads.reduce<number>((sum, value) => sum + (value ?? 0), 0)
      : null;
    const costs = [totals.costCny, liveStats?.costCny ?? null];
    const cost = costs.some((value) => value !== null)
      ? costs.reduce<number>((sum, value) => sum + (value ?? 0), 0)
      : null;

    const parts: string[] = [];
    if (running) {
      parts.push('运行中', formatElapsed(elapsed) ?? '…', `${steps} 步`);
    } else {
      parts.push(`累计 ${totals.runs} 次 · ${totals.steps} 步`);
    }
    if (total > 0) parts.push(`${formatTokens(total)} tok`);
    const speed = formatSpeed(decodeTokens, decodeMs);
    if (speed !== null) parts.push(speed);
    const cache = formatCacheHitPercent(cacheRead, input);
    if (cache !== null) parts.push(`缓存 ${cache}%`);
    const costText = formatCost(cost);
    if (costText !== null) parts.push(costText);

    sessionStats.hidden = !running && totals.runs === 0;
    sessionStats.textContent = parts.join(' · ');
    sessionStats.title = [
      running ? '本次请求进行中' : `请求 ${totals.runs} 次 · 模型调用 ${totals.steps} 步`,
      `输入 ${formatExactTokens(input)} tok`,
      `输出 ${formatExactTokens(Math.max(0, total - input))} tok`,
      `合计 ${formatExactTokens(total)} tok`,
      ...(costText === null ? [] : [`估算费用 ${costText}（按 DeepSeek 价目表）`]),
    ].join('\n');
  };

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
      if (entry.kind === 'cap') {
        // The budget ran out mid-build. The button is the shortcut: one click
        // buys another budget for the same conversation instead of making the
        // player retype the request.
        const line = document.createElement('article');
        line.className = 'agent-line agent-cap';
        const note = document.createElement('span');
        note.textContent =
          entry.limit > 0 ? `达到步数上限（${entry.limit} 轮），先停下来了。` : '达到步数上限，先停下来了。';
        const again = button('继续执行', 'agent-btn agent-btn-go');
        again.addEventListener('click', () => continueRun());
        line.append(note, again);
        log.append(line);
        continue;
      }
      if (entry.kind === 'run') {
        // One finished request, measured: the same four readings DSH shows,
        // without the dialog -- the exact counts and the first-token average
        // live in the tooltip.
        const line = document.createElement('div');
        line.className = 'agent-run-stats';
        const text = summariseRun(entry.stats);
        line.textContent = text === '' ? '本次没有计时数据' : text;
        line.title = runDetail(entry.stats);
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

    renderTotals();
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
    if (event.kind === 'progress') {
      live = { stats: event.stats, steps: event.steps };
      renderTotals();
      return;
    }
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
    if (event.kind === 'cap') {
      settle();
      entries.push({ kind: 'cap', limit: event.limit });
      status = '达到步数上限，先停下来了';
      render();
      return;
    }
    entries.push({ kind: 'notice', text: event.detail === '' ? event.message : `${event.message}（${event.detail}）`, tone: 'error' });
    status = `出错：${event.message}`;
    render();
  };

  /** One run of the loop, shared by 发送 and the cap's 继续执行 button. */
  const startRun = (config: AgentConfig): void => {
    busy = true;
    live = null;
    liveStartedAt = globalThis.performance?.now() ?? Date.now();
    if (liveTimer !== null) clearInterval(liveTimer);
    // The clock is this panel's; the tokens arrive on progress events. A timer
    // only while a run is in flight is also why a settled panel costs nothing.
    liveTimer = setInterval(() => {
      if (busy) renderTotals();
    }, 200);
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
        // The request's own readings go into the log and the totaliser. They are
        // appended even for an aborted or refused run: the seconds were spent,
        // and the row is the record of what was bought for them.
        entries.push({ kind: 'run', stats: result.stats });
        totals.runs += 1;
        totals.steps += result.steps;
        totals.llmMs += result.stats.llmMs;
        totals.decodeMs += result.stats.decodeMs;
        totals.decodeTokens += result.stats.decodeTokens;
        if (result.stats.usage !== null) {
          totals.input += result.stats.usage.input;
          totals.output += result.stats.usage.output;
          totals.total += result.stats.usage.total;
          if (result.stats.usage.cacheRead !== null) {
            totals.cacheRead = (totals.cacheRead ?? 0) + result.stats.usage.cacheRead;
          }
        }
        if (result.stats.costCny !== null) {
          totals.costCny = (totals.costCny ?? 0) + result.stats.costCny;
        }
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
        if (liveTimer !== null) clearInterval(liveTimer);
        liveTimer = null;
        live = null;
        settle();
        busy = false;
        controller = null;
        current = null;
        render();
      });
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
    startRun(config);
  };

  /**
   * The cap's own button: another budget for the same conversation.
   *
   * NO SYNTHETIC USER LINE. The history already ends with the tool result the
   * last round asked for, so continuing is exactly the request the loop would
   * have made had the budget been larger. The button press is the record.
   */
  const continueRun = (): void => {
    const config = options.config();
    if (!isConfigured(config) || busy) return;
    startRun(config);
  };

  const openSettings = (): void => {
    // The settings belong to the panel, so asking for them also claims the dock.
    open();
    const config = options.config() ?? emptyConfig();
    baseUrl.value = config.baseUrl;
    apiKey.value = config.apiKey;
    model.value = config.model;
    maxSteps.value = String(config.maxSteps);
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
    const parsed = maxSteps.value.trim() === '' ? DEFAULT_MAX_STEPS : Math.floor(Number(maxSteps.value));
    const config: AgentConfig = {
      baseUrl: baseUrl.value.trim(),
      apiKey: apiKey.value.trim(),
      model: model.value.trim(),
      maxSteps: Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_MAX_STEPS,
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
