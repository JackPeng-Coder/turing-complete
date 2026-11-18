/**
 * 向任意 OpenAI 兼容端点发一次流式 chat completion。
 *
 * 流式在这里不是锦上添花，而是功能本身。被要求搭电路的模型大部分时间在思考，
 * 如果请求要等全部完成才返回，面板会僵住半分钟、什么都看不到。
 * 有了流，面板才能先说「正在思考」，再随着参数到达把工具调用一点点填出来。
 *
 * 本文件只负责三件事：
 *
 *   1. 把碎片拼成一次工具调用。API 把参数当作 JSON 字符串，
 *      在任意字节边界切开流过来——这一帧是 {"def，下一帧是 Id":"and"}——
 *      并按 index 归组，因为 id 与 name 只在第一块里出现。
 *      重组就是按 index 做字符串拼接，拼完不在这里解析：
 *      由工具层去校验，于是一个坏碎片会变成给模型的一句话，而不是传输层的一次崩溃。
 *
 *   2. 把每一种失败翻译成玩家能照做的中文。401、路径写错、CORS 预检被拦、
 *      网络断掉，在 fetch 里看起来都一样——一个被拒绝的 Promise，
 *      里面读不出任何东西；区分它们，才是唯一能告诉玩家
 *      该改设置面板哪一栏的信息。
 *
 *   3. 不做类、不做会话、不做存储。对话保存在运行循环里；
 *      这个函数发一次请求，把收到的内容返回。
 */
import { chatUrl, type AgentConfig } from './config';
import { createSseDecoder } from './sse';
import type { ChatRequest, StreamChunk, WireMessage, WireTool, WireUsage } from './wire';

/** 本模块需要的 fetch 形状；可注入，好让测试完全不必联网。 */
export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/** 模型请求的一次工具调用，参数仍是原始 JSON 文本。 */
export interface ChatToolCall {
  readonly id: string;
  readonly name: string;
  readonly arguments: string;
}

/**
 * 一次请求的花费，把两种服务商方言归一成同一种形状。
 *
 * input 是提示词一侧的总量（缓存命中与未命中合计），
 * 所以 cacheRead / input 就是缓存命中率；output 是模型写出的量。
 * 对方什么都不报时给 null，面板于是只显示时间和速度、不显示 token 数——
 * 而不是编一个出来。
 */
export interface TokenUsage {
  readonly input: number;
  readonly output: number;
  readonly total: number;
  readonly cacheRead: number | null;
}

/** 把不可信的 usage 对象读成面板要画的那一种形状。 */
export function readUsage(raw: WireUsage | null | undefined): TokenUsage | null {
  if (raw === null || raw === undefined) return null;
  const count = (value: unknown): number | null =>
    typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
  const cacheRead =
    count(raw.prompt_cache_hit_tokens) ?? count(raw.prompt_tokens_details?.cached_tokens);
  const miss = count(raw.prompt_cache_miss_tokens);
  const prompt =
    count(raw.prompt_tokens) ??
    (cacheRead !== null || miss !== null ? (cacheRead ?? 0) + (miss ?? 0) : null);
  const output = count(raw.completion_tokens);
  const total = count(raw.total_tokens);
  if (prompt === null && output === null && total === null) return null;
  return {
    input: prompt ?? Math.max(0, (total ?? 0) - (output ?? 0)),
    output: output ?? 0,
    total: total ?? (prompt ?? 0) + (output ?? 0),
    cacheRead,
  };
}

/** 一整轮请求的结果：散文回复，加上它请求的每一次工具调用。 */
export interface ChatResult {
  /** 助手的散文回复。只调用工具时为 ''，而那才是常态。 */
  readonly content: string;
  /** 模型这一轮请求的全部工具调用，已按流中的 index 排好序。 */
  readonly toolCalls: readonly ChatToolCall[];
  /** 服务商给出的结束原因，例如 stop、tool_calls；没有就是 null。 */
  readonly finishReason: string | null;
  /** token 用量，前提是对方发来了 usage 帧。 */
  readonly usage?: TokenUsage | null;
}

/** 答案还在路上时，面板可以显示的内容。 */
export type ChatDelta =
  | { readonly kind: 'text'; readonly text: string }
  /**
   * 模型自己的推理，只有会流式输出推理的模型才有。
   *
   * 它和答案走两条不同的通道，因为二者本来就是两回事：
   * 它可能是几千字的「我再检查一遍引脚」，它先于答案到达，
   * 而且工作一旦完成，读的人希望把它折起来。
   * 若混进 content，它也会进入对话历史，而那里不该有它。
   */
  | { readonly kind: 'reasoning'; readonly text: string }
  | { readonly kind: 'tool'; readonly index: number; readonly name?: string };

/**
 * 值得给玩家看的失败。
 *
 * message 是一行中文摘要；detail 是对方或平台的原话，
 * 原样保留，这样出现新的失败方式时，不用打开浏览器控制台也能诊断。
 */
export class AgentError extends Error {
  readonly detail: string;

  constructor(message: string, detail = '') {
    super(message);
    this.name = 'AgentError';
    this.detail = detail;
  }
}

/** 一次 streamChat 调用需要的东西。 */
export interface ChatOptions {
  readonly config: AgentConfig;
  readonly messages: readonly WireMessage[];
  readonly tools?: readonly WireTool[];
  readonly signal?: AbortSignal;
  readonly fetchImpl?: FetchLike;
  /** 每收到一个增量就回调一次；面板靠它边收边显示。 */
  readonly onDelta?: (delta: ChatDelta) => void;
}

/** 判断一个异常值是不是「被中止」。 */
function isAbort(cause: unknown): boolean {
  return typeof cause === 'object' && cause !== null && (cause as { name?: string }).name === 'AbortError';
}

/** 构造一个统一形状的中止异常：名字是 AbortError，消息是「已停止」。 */
function abortError(): Error {
  const error = new Error('已停止');
  error.name = 'AbortError';
  return error;
}

/** 服务商自己的说法，前提是它给了。 */
function providerMessage(body: string): string {
  try {
    const parsed = JSON.parse(body) as { error?: { message?: unknown } };
    const message = parsed.error?.message;
    if (typeof message === 'string' && message !== '') return message;
  } catch {
    /* 不是 JSON：响应体本身就是详情 */
  }
  return body.slice(0, 300);
}

/** 把 HTTP 状态码映射到「设置面板里该改哪一栏」。 */
async function failure(response: Response, url: string): Promise<AgentError> {
  let body = '';
  try {
    body = await response.text();
  } catch {
    /* 读不出来的响应体，就当作没有这条详情 */
  }
  const detail = providerMessage(body);
  const status = response.status;
  if (status === 401 || status === 403) {
    return new AgentError(
      `API key 被拒绝（HTTP ${status}）：请在 Agent 设置里检查 key 是否有这个模型的权限`,
      detail,
    );
  }
  if (status === 404) {
    return new AgentError(`接口地址不存在（HTTP 404）：实际请求的是 ${url}`, detail);
  }
  if (status === 429) {
    return new AgentError('请求被限流或额度不足（HTTP 429）：稍后再试', detail);
  }
  if (status >= 500) {
    return new AgentError(`对方服务端出错（HTTP ${status}）：稍后再试`, detail);
  }
  return new AgentError(`请求被拒绝（HTTP ${status}）`, detail);
}

/** 非流式的响应形状，用于忽略了 stream: true 的服务商。 */
interface CompletionBody {
  readonly choices?: readonly {
    readonly message?: {
      readonly content?: string | null;
      readonly tool_calls?: readonly {
        readonly id?: string;
        readonly function?: { readonly name?: string; readonly arguments?: string };
      }[];
    };
    readonly finish_reason?: string | null;
  }[];
  readonly error?: { readonly message?: string };
  readonly usage?: WireUsage | null;
}

/** 把一次性返回的完整 JSON 读成 ChatResult，并标记「对方没有按流式来」。 */
function fromCompletion(raw: string): ChatResult & { readonly ignoredStream: boolean } {
  let parsed: CompletionBody;
  try {
    parsed = JSON.parse(raw) as CompletionBody;
  } catch {
    throw new AgentError('接口返回的不是 JSON，也不像事件流：请检查地址是否为 chat/completions', raw.slice(0, 200));
  }
  if (parsed.error) {
    // 200 状态里装着 error 信封，是一些服务商报告拒绝的方式，
    // 所以把对方自己的那句话放进摘要：那是玩家唯一能照做的部分。
    // 玩家能照做的只有这一句，所以它必须在最显眼的位置。
    const detail = parsed.error.message ?? '';
    throw new AgentError(detail === '' ? '模型接口返回了错误' : `模型接口返回了错误：${detail}`, detail);
  }
  const choice = parsed.choices?.[0];
  const calls: ChatToolCall[] = [];
  for (const [index, call] of (choice?.message?.tool_calls ?? []).entries()) {
    calls.push({
      id: call.id ?? `call_${index}`,
      name: call.function?.name ?? '',
      arguments: call.function?.arguments ?? '{}',
    });
  }
  return {
    content: choice?.message?.content ?? '',
    toolCalls: calls.filter((call) => call.name !== ''),
    finishReason: choice?.finish_reason ?? null,
    usage: readUsage(parsed.usage),
    ignoredStream: true,
  };
}

/**
 * 发一次请求，并把答案读到结束。
 *
 * 解析时返回整轮结果——散文加全部工具调用——因为运行循环必须拿到全部，
 * 才知道下一步做什么；同时增量通过 onDelta 推给面板。
 * 二者并不冲突：同一批碎片同时去两个地方。
 */
export async function streamChat(options: ChatOptions): Promise<ChatResult> {
  const { config, messages, tools, signal, onDelta } = options;
  const url = chatUrl(config.baseUrl);
  if (url === '') throw new AgentError('还没有填写 API 地址');
  const doFetch = options.fetchImpl ?? globalThis.fetch;
  if (typeof doFetch !== 'function') throw new AgentError('这个浏览器没有 fetch，无法直连模型接口');

  const body: ChatRequest = {
    model: config.model,
    messages,
    ...(tools && tools.length > 0 ? { tools } : {}),
    stream: true,
    stream_options: { include_usage: true },
  };

  let response: Response;
  try {
    response = await doFetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${config.apiKey}`,
        accept: 'text/event-stream',
      },
      body: JSON.stringify(body),
      ...(signal === undefined ? {} : { signal }),
    });
  } catch (cause) {
    if (isAbort(cause)) throw abortError();
    const detail = cause instanceof Error ? cause.message : String(cause);
    throw new AgentError(
      '连不上这个地址：可能是网络不通，或对方不允许浏览器直连（CORS）。可以先在浏览器里打开该地址确认，或换一个允许跨域的接口',
      detail,
    );
  }

  if (!response.ok) throw await failure(response, url);

  const type = response.headers.get('content-type') ?? '';
  if (!type.includes('text/event-stream')) {
    // 服务商忽略了 stream，或者中间代理把答案缓冲成了一个整体。
    // 两种情况下请求本身都合法，于是直接读答案，而不是拒绝它。
    const raw = await response.text();
    return fromCompletion(raw);
  }

  const stream = response.body;
  if (stream === null) {
    throw new AgentError('响应没有内容：这个地址可能不是流式的 chat/completions 端点');
  }

  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const sse = createSseDecoder();
  let content = '';
  let finishReason: string | null = null;
  let usage: TokenUsage | null = null;
  const calls = new Map<number, { id: string; name: string; args: string }>();
  let done = false;

  const handle = (data: string): void => {
    if (data === '[DONE]') {
      done = true;
      return;
    }
    let chunk: StreamChunk;
    try {
      chunk = JSON.parse(data) as StreamChunk;
    } catch {
      // 读不懂的帧跳过而不是致命：心跳保活和一些服务商自定义的状态帧
      // 也走这条通道。
      return;
    }
    if (chunk.error) throw new AgentError('模型接口在流中报错', chunk.error.message ?? '');
    // usage 帧是最后一帧，且不带 choices；先于 choices 循环读取它，
    // 这样「两者都发」的服务商与「只发 usage」的服务商走同一条路径。
    const counted = readUsage(chunk.usage);
    if (counted !== null) usage = counted;
    for (const choice of chunk.choices ?? []) {
      const delta = choice.delta;
      if (delta?.content) {
        content += delta.content;
        onDelta?.({ kind: 'text', text: delta.content });
      }
      // 有意不加入 content：推理会显示然后折起，
      // 而回传给模型的对话历史里不能带着它。
      if (delta?.reasoning_content) {
        onDelta?.({ kind: 'reasoning', text: delta.reasoning_content });
      }
      for (const fragment of delta?.tool_calls ?? []) {
        const entry = calls.get(fragment.index) ?? { id: '', name: '', args: '' };
        if (fragment.id) entry.id = fragment.id;
        if (fragment.function?.name) entry.name = fragment.function.name;
        if (fragment.function?.arguments) entry.args += fragment.function.arguments;
        calls.set(fragment.index, entry);
        // 名字除了第一块之外都不会出现；面板只需要它来给
        // 已经在显示的那一行加标签。
        onDelta?.(
          entry.name === ''
            ? { kind: 'tool', index: fragment.index }
            : { kind: 'tool', index: fragment.index, name: entry.name },
        );
      }
      if (choice.finish_reason) finishReason = choice.finish_reason;
    }
  };

  try {
    while (!done) {
      const { value, done: ended } = await reader.read();
      if (ended) break;
      for (const event of sse.feed(decoder.decode(value, { stream: true }))) {
        handle(event.data);
        if (done) break;
      }
    }
    if (!done) {
      for (const event of sse.flush()) {
        handle(event.data);
        if (done) break;
      }
    }
  } catch (cause) {
    if (isAbort(cause)) throw abortError();
    throw cause;
  } finally {
    reader.releaseLock();
  }

  const toolCalls: ChatToolCall[] = [...calls.entries()]
    .sort(([a], [b]) => a - b)
    .map(([index, entry]) => ({
      id: entry.id === '' ? `call_${index}` : entry.id,
      name: entry.name,
      arguments: entry.args === '' ? '{}' : entry.args,
    }))
    .filter((call) => call.name !== '');

  if (content === '' && toolCalls.length === 0 && !done) {
    // 流结束时既没有 [DONE]、里面也什么都没有。
    // 明说比返回一个空轮更好——运行循环会把空轮读成「做完了」。
    throw new AgentError('接口没有返回任何内容：确认这个地址支持流式 chat/completions');
  }

  return { content, toolCalls, finishReason, usage };
}
