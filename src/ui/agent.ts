/**
 * 智能体面板：一段对话、一张设置卡，以及打开它们的入口按钮。
 *
 * 本文件不是什么：它不是第二个编辑器。电路上的每一次改动都来自一次工具调用，
 * 每一次工具调用都经 `AgentHost` 进入玩家鼠标所用的同一条命令栈（可撤销），
 * 本面板只负责把运行循环上报的内容画出来。智能体若在搭建中途被停止，
 * 画板就停在它停下的位置，撤销依然能一步步退回去。
 *
 * 一行工具记录只有三种状态，取的是玩家真正需要看到的信息：
 * 调用已被提出（准备）、正在执行（执行）、已经结束以及是否成功（完成 / 失败）。
 * 某一步执行期间，这一行是玩家唯一能看到"自己的电路正在被怎么改"的地方；
 * 执行结束之后，这一行就是这次改动的记录，所以结果行保留而不是清空。
 *
 * 面板只报告"缺少配置"，不为此打断玩家。最初的做法是首次运行时把设置卡盖在画板上，
 * 等于把玩家没问过的问题挡在他本来要做的事情前面。现在面板里只写一行"还没有配置 API"，
 * 旁边给一个打开设置的按钮，画板永远不会被遮住；不配置它，游戏照常能玩。
 *
 * 流式文本是追加，不是重渲染。日志只在结构变化时重建；每来一段文本增量，
 * 只往已存在的节点上追加文本。因为如果每来一个 token 都重渲染，
 * 整段对话每秒会被丢弃重建许多次，既慢又会打断滚动。
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

/** 一次工具调用在日志里的一行记录。 */
interface ToolRow {
  readonly name: string;
  state: 'start' | 'end';
  ok: boolean;
  summary: string;
}

/**
 * 模型的一步工作，按日志保存的样子。
 *
 * `thought`（思考过程）与 `text`（正式回答）分开保存，因为两者的阅读方式不同：
 * 思考是长文本，只在"正在写"的时候有意义；回答是短文本，写完之后才有意义。
 * 分开保存还让思考块能够折叠收起，而不会把回答一起带走。
 */
interface AgentEntry {
  readonly kind: 'agent';
  thought: string;
  text: string;
  readonly tools: ToolRow[];
  /** 是否还在到达：进行中的一步显示最后几行，已结束的一步折叠成一行。 */
  live: boolean;
  /** 玩家手动展开了折叠块；该展开状态在多次重绘之间保持。 */
  opened: boolean;
}

type Entry =
  | { readonly kind: 'user'; readonly text: string }
  | AgentEntry
  | { readonly kind: 'notice'; readonly text: string; readonly tone: 'info' | 'error' }
  /** 步数预算用尽；这一行带着"再买一段预算"的按钮。 */
  | { readonly kind: 'cap'; readonly limit: number }
  /** 一次已结束请求的读数：耗时、token 数、速度、缓存命中。 */
  | { readonly kind: 'run'; readonly stats: RunStats };

/** 面板在工作台中的两个落脚点：左侧活动栏上的按钮，以及它停靠的侧边栏。 */
export interface AgentPanelHosts {
  /** 左侧活动栏：打开面板的按钮挂在这里。 */
  readonly toggle: HTMLElement;
  /** 次级侧边栏：对话内容停靠在这里。 */
  readonly sidebar: HTMLElement;
}

/** 挂载面板所需的外部依赖：宿主接口、配置读写与可见性回调。 */
export interface AgentPanelOptions {
  readonly host: AgentHost;
  /** 当前设置；玩家从未配置过时为 `null`。 */
  readonly config: () => AgentConfig | null;
  /** 设置卡保存时调用。 */
  readonly onSave: (config: AgentConfig) => void;
  /** 玩家要求忘记 key 时调用。 */
  readonly onClear: () => void;
  /** 面板占用或交还它的停靠位时调用。 */
  readonly onVisibility?: (open: boolean) => void;
  /** 可注入，便于测试在无网络的情况下跑一轮脚本化的对话。 */
  readonly run?: typeof runAgent;
}

/** 面板对外暴露的四个操作，供组合根与测试调用。 */
export interface AgentPanel {
  /** 重绘日志、按钮与状态行。 */
  render(): void;
  /** 打开设置卡；「设置」按钮和"缺少配置"的提示都用它。 */
  openSettings(): void;
  /** 打开对话卡，例如从活动栏点进来。 */
  open(): void;
  /** 把停靠位交还给画板。 */
  close(): void;
}

/** 把工具结果压成一行可读文字，而不是直接显示原始 JSON 外壳。 */
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
 * 一次请求那一行的悬浮提示：显示被单行摘要藏起来的具体数字。
 *
 * 提供方没有返回用量时，这里明说，而不是显示 0：「没有返回用量」是一条信息，
 * 而 `0 tok` 会假装做过一次没人做过的测量。
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

/**
 * 流式输出的一步在实时窗口里保留多少字符（放在 DOM 中的尾部长度）。
 *
 * 推理模型一步可能写下几万个字符，而实时框只显示最后六行。若每个 token 都把
 * 整段流重新填进框里，每次增量都要复制全文、重新排版并滚动——工作量随思考长度增长，
 * 模型想得越久面板越卡。这里改为只保留一个有上限的尾部：几千字符已比六行多一个数量级，
 * 于是把滚动条设到底部（scrollTop = scrollHeight）仍会落在最新一行，
 * 而第 10 个 token 和第 10000 个 token 的增量开销相同。
 * 完整文本仍会累积在条目上，步骤结束后折叠块就是从那里渲染的。
 */
const LIVE_TAIL_CHARS = 4096;

/**
 * 挂载智能体面板：在活动栏放开关按钮、在侧边栏放对话卡，返回控制句柄。
 *
 * 本函数只做 DOM 组装与事件接线，并立即完成第一次渲染（不会自动展开面板）。
 * 所有电路改动都经 options.host 进入玩家的命令栈，面板自己从不直接改电路；
 * 返回的 render 可被外部再次调用以刷新读数与按钮状态。
 */
export function mountAgentPanel(hosts: AgentPanelHosts, options: AgentPanelOptions): AgentPanel {
  const run = options.run ?? runAgent;
  const entries: Entry[] = [];
  /** 按 API 视角保存的对话历史：不含系统提示词，循环会自己补上。 */
  const history: WireMessage[] = [];
  let current: AgentEntry | null = null;
  /**
   * 当前正在写入的那一步的正文节点。
   *
   * 持有引用而不是每个 token 重渲染：可见的只是流的尾部，
   * 所以每次增量只需要扩展文本并把框滚到底部。
   */
  let liveBody: HTMLElement | null = null;
  /**
   * 流中最后 `LIVE_TAIL_CHARS` 个字符，以及这个尾部当前结束在哪个字段上。
   *
   * 框只显示六行；只保留有界尾部意味着单次增量的工作量不随模型思考时长增长。
   * 完整文本仍累积在条目上——尾部是它的一扇窗，不是记录的第二份拷贝。
   */
  let liveTail = '';
  let liveField: 'thought' | 'text' | null = null;
  let controller: AbortController | null = null;
  let busy = false;
  let status = '';
  /**
   * 进行中那一轮请求的读数，让累计器在运行期间就"活着"，而不是只显示最终值。
   *
   * 运行循环在每个步骤边界发出 `progress` 事件；面板把这些与已结束的轮次相加，
   * 并在事件之间自己跳动已用时间。
   */
  let live: { readonly stats: RunStats; readonly steps: number } | null = null;
  let liveStartedAt = 0;
  let liveTimer: ReturnType<typeof setInterval> | null = null;
  /**
   * 读数，按本面板的整个生命期累加。
   *
   * 不持久化，也不属于对话内容：它是这台"仪表"上的累计计数器，刷新页面后从零开始，
   * 就像真实的电表一样。日志里每一行请求记录各自保留数字，
   * 因此清零总计不会丢失任何已经写下的信息。
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

  // 活动栏按钮只有图标，因为活动栏宽 48px：它靠无障碍名称和警告样式来表达
  // "还没配置"，而具体解释放在面板内部。
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

  // 面板对"尚未配置"的自家回答：一行文字，而不是弹窗。
  // 它放在输入框上方，因为玩家即将在这里发现"发送不出去"；
  // 旁边一个按钮直接指出去处。
  const setupHint = document.createElement('div');
  setupHint.className = 'agent-setup-hint';
  const setupHintText = document.createElement('span');
  setupHintText.textContent = '还没有配置 API：填好地址、key 和模型才能发送。';
  const setupHintOpen = button('打开设置', 'agent-btn agent-btn-quiet');
  setupHintOpen.addEventListener('click', () => openSettings());
  setupHint.append(setupHintText, setupHintOpen);
  setupHint.hidden = true;

  // 面板的累计器，放在对话下方：与每行请求记录同样的读数，但按本次会话求和。
  // 没有可统计的数字时隐藏；它永远不能替代那些逐行记录。
  const sessionStats = document.createElement('div');
  sessionStats.className = 'agent-session-stats';
  sessionStats.hidden = true;

  card.append(head, log, sessionStats, setupHint, compose);

  // -- 设置卡：它是一张独立的卡，因此可以单独存在 ---------------------------
  // 设置卡是一个独立的模态层。对话卡自己的 `hidden` 现在表示"停靠位已关闭"，
  // 设置不能再挂在它上面；它有自己的遮罩、自己的 `hidden`，并以 <body> 为父节点——
  // 放在已折叠侧边栏里的固定定位遮罩根本不可能被看到。
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
  // 隐藏的是遮罩本身，不是卡。遮罩才是盖住舞台、接管指针的东西；
  // 若只把卡藏起来而遮罩仍在，屏幕看起来是关闭的，却会吞掉画板上的每一次点击。
  setupOverlay.hidden = true;
  document.body.append(setupOverlay);

  // ------------------------------------------------------------------ 渲染 --

  /** 新建一个还没有任何内容的一步。 */
  const newAgentEntry = (): AgentEntry => ({
    kind: 'agent',
    thought: '',
    text: '',
    tools: [],
    live: true,
    opened: false,
  });

  /** 这一步里模型说过的全部内容，思考在前。 */
  const streamOf = (entry: AgentEntry): string =>
    [entry.thought, entry.text].filter((part) => part !== '').join('\n');

  /**
   * 承载一步文字内容的可折叠块。
   *
   * 正在写入时，它是固定高度、只显示最后几行的窗口：模型"边想边说"产生的文字
   * 远多于面板能显示的量，值得看的只有最新部分。步骤结束后它折叠成一行——
   * 它描述的工作一旦落到画板上，推理本身也就完成了使命——玩家点标题即可重新展开。
   * 否则一篇没人要求保留的千字长文会把日志变得无法阅读。
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
    if (live) {
      liveBody = bodyEl;
      liveTail = text.length <= LIVE_TAIL_CHARS ? text : text.slice(-LIVE_TAIL_CHARS);
      // 流的内容顺序是先 `thought` 后 `text`（见 `streamOf`），
      // 所以它结束在哪个字段，下一次增量就接着写到哪个字段。
      liveField = entry.text !== '' ? 'text' : entry.thought !== '' ? 'thought' : null;
    }
    return wrap;
  }

  /**
   * 日志下方的累计器：空闲时显示已结算的值，运行中显示实时值。
   *
   * 运行期间，已用时间来自本面板的时钟，每 200ms 跳一次；token 数、速度、
   * 缓存占比和费用来自运行循环在每个步骤边界的 progress 事件——
   * 提供方是随回答一起发送用量帧的，所以"每步"是 token 数最细的诚实粒度。
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
    liveTail = '';
    liveField = null;
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
        // 预算在搭建中途用尽。这个按钮是捷径：点一下就给同一段对话再买一段预算，
        // 免得玩家重新打一遍请求。
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
        // 一次已结束请求的度量：四个读数与 DSH 显示的一致，
        // 但不弹对话框——精确计数和首字平均耗时放在悬浮提示里。
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
        // 这一步动过画板，所以它的文字是"工作过程"：无论写了什么都折叠起来，
        // 因为下面的工具记录行说得更多。
        if (stream !== '') line.append(thinkBlock(stream, entry, false));
      } else {
        // 这一步没有调用任何工具，所以它就是"回答"。上面的推理折叠起来，
        // 回答正文留在可直接阅读的位置。
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
   * 延长正在写入的这一步，不重建日志。
   *
   * 一次增量是往框里已有尾部的追加，而不是重渲染整步：框是六行高的窗口，
   * 滚出窗口的部分是有意从 DOM 里丢掉的（见 `LIVE_TAIL_CHARS`），
   * 完整文本存在条目上。思考与回答是同一个窗口的两个字段，
   * 切换字段时补一个换行，恰好对应 `streamOf` 在折叠正文中把两者拼起来的方式。
   */
  const appendStream = (text: string, field: 'thought' | 'text'): void => {
    if (current === null) {
      current = newAgentEntry();
      entries.push(current);
      render();
    }
    current[field] += text;
    current.live = true;
    if (liveBody === null) {
      render();
      return;
    }
    const newLine = liveField !== null && liveField !== field && liveTail !== '';
    liveField = field;
    liveTail = (liveTail + (newLine ? `\n${text}` : text)).slice(-LIVE_TAIL_CHARS);
    liveBody.textContent = liveTail;
    liveBody.scrollTop = liveBody.scrollHeight;
    log.scrollTop = log.scrollHeight;
  };

  /** 把正在执行的一步标记为结束：它的文字从此刻起折叠。 */
  const settle = (): void => {
    if (current !== null) current.live = false;
  };

  // ------------------------------------------------------------------ 事件 --

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
        // 这段文字是这个调用之前的铺垫，所以现在就折叠，
        // 由下面的工具记录行接替成为"发生了什么"的记录。
        settle();
        current.tools.push({ name: event.name, state: 'start', ok: true, summary: '' });
        status = `正在执行 ${event.name}…`;
      } else {
        const row = current.tools.find((candidate) => candidate.state === 'start' && candidate.name === event.name);
        const target = row ?? { name: event.name, state: 'end' as const, ok: true, summary: '' };
        target.state = 'end';
        target.ok = event.ok ?? true;
        // 工具有自己的说明文字就用它；原始结果是给模型看的，
        // 不是给盯着画板的人看的。
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

  /** 运行一次智能体循环；「发送」和步数上限处的「继续执行」共用它。 */
  const startRun = (config: AgentConfig): void => {
    busy = true;
    live = null;
    liveStartedAt = globalThis.performance?.now() ?? Date.now();
    if (liveTimer !== null) clearInterval(liveTimer);
    // 时钟由本面板负责，token 数随 progress 事件到达。
    // 定时器只在运行期间存在，这也是空闲面板不消耗任何资源的原因。
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
        // 这次请求自己的读数进入日志和累计器。即使这一轮被中止或被拒绝也要追加：
        // 时间已经花掉了，这一行就是"花时间买到了什么"的记录。
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
   * 步数上限处的按钮：给同一段对话再来一段预算。
   *
   * 不伪造用户消息。历史已经以最后一轮所请求的工具结果结尾，所以继续执行
   * 恰好就是"如果预算更大、循环本来会发出的那次请求"。按下按钮本身就是记录。
   */
  const continueRun = (): void => {
    const config = options.config();
    if (!isConfigured(config) || busy) return;
    startRun(config);
  };

  const openSettings = (): void => {
    // 设置属于面板，所以请求打开设置时也顺带占用停靠位。
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
    // Enter 发送，Shift+Enter 换行：与 IDE 自带编辑器相同的约定，
    // 让在这里写过程序的玩家不必学第二套习惯。
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
    // 不保存直接关闭：面板仍保留自己那一行"缺少什么"的提示，游戏继续能玩。
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
  // 面板不会自己弹出来。设置只隔一个按钮，缺少配置也在面板内部报告，
  // 所以第一次运行时玩家落在画板上——他本来要做的事——
  // 而不是被一个关于可选功能的问题拦住。
  return { render, openSettings, open, close };
}
