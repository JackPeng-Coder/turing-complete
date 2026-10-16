/**
 * One streaming chat completion against any OpenAI-compatible endpoint.
 *
 * STREAMING IS NOT A LUXURY HERE, IT IS THE FEATURE. A model asked to build a
 * circuit spends most of its time deciding, and a request that returns only when
 * it is finished leaves the panel frozen for half a minute with nothing to show.
 * The stream is what lets the panel say "正在思考" and then fill in the tool call
 * as its arguments arrive.
 *
 * THE THREE THINGS THIS FILE OWNS, AND NOTHING ELSE:
 *
 *   1. Assembling a tool call from fragments. The API streams arguments as a
 *      JSON STRING split at arbitrary byte boundaries -- `{"def` in one frame,
 *      `Id":"and"}` in the next -- keyed by `index`, because `id` and `name`
 *      arrive in the first fragment only. Reassembly is a string concatenation
 *      per index, and the result is not parsed here: the tool layer validates it,
 *      so a malformed fragment becomes a message to the model rather than a crash
 *      in the transport.
 *
 *   2. Turning every failure into Chinese a player can act on. A 401, a wrong
 *      path, a blocked CORS preflight and a dead network all look the same from
 *      inside `fetch` -- a rejected promise with nothing readable in it -- and
 *      the difference between them is the only thing that tells the player which
 *      field of the settings panel to fix.
 *
 *   3. Not being a class, a session or a store. The conversation lives in the
 *      loop; this function sends one request and returns what came back.
 */
import { chatUrl, type AgentConfig } from './config';
import { createSseDecoder } from './sse';
import type { ChatRequest, StreamChunk, WireMessage, WireTool } from './wire';

/** The `fetch` shape this module needs; injectable so the tests need no network. */
export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/** A tool call the model asked for, with its arguments still as raw JSON text. */
export interface ChatToolCall {
  readonly id: string;
  readonly name: string;
  readonly arguments: string;
}

export interface ChatResult {
  /** The assistant's prose. `''` when it only called tools, which is the norm. */
  readonly content: string;
  readonly toolCalls: readonly ChatToolCall[];
  readonly finishReason: string | null;
}

/** What the panel can show while the answer is still arriving. */
export type ChatDelta =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'tool'; readonly index: number; readonly name?: string };

/**
 * A failure worth showing the player.
 *
 * `message` is the one-line Chinese summary; `detail` is whatever the provider
 * or the platform said, kept verbatim so a new failure mode is diagnosable
 * without a browser console.
 */
export class AgentError extends Error {
  readonly detail: string;

  constructor(message: string, detail = '') {
    super(message);
    this.name = 'AgentError';
    this.detail = detail;
  }
}

export interface ChatOptions {
  readonly config: AgentConfig;
  readonly messages: readonly WireMessage[];
  readonly tools?: readonly WireTool[];
  readonly signal?: AbortSignal;
  readonly fetchImpl?: FetchLike;
  readonly onDelta?: (delta: ChatDelta) => void;
}

function isAbort(cause: unknown): boolean {
  return typeof cause === 'object' && cause !== null && (cause as { name?: string }).name === 'AbortError';
}

function abortError(): Error {
  const error = new Error('已停止');
  error.name = 'AbortError';
  return error;
}

/** The provider's own words, when it sent any. */
function providerMessage(body: string): string {
  try {
    const parsed = JSON.parse(body) as { error?: { message?: unknown } };
    const message = parsed.error?.message;
    if (typeof message === 'string' && message !== '') return message;
  } catch {
    /* not JSON: the body itself is the detail */
  }
  return body.slice(0, 300);
}

/** Maps an HTTP status to the field of the settings panel that would fix it. */
async function failure(response: Response, url: string): Promise<AgentError> {
  let body = '';
  try {
    body = await response.text();
  } catch {
    /* a body we cannot read is a detail we do without */
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

/** The non-streaming shape, for a provider that ignored `stream: true`. */
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
}

function fromCompletion(raw: string): ChatResult & { readonly ignoredStream: boolean } {
  let parsed: CompletionBody;
  try {
    parsed = JSON.parse(raw) as CompletionBody;
  } catch {
    throw new AgentError('接口返回的不是 JSON，也不像事件流：请检查地址是否为 chat/completions', raw.slice(0, 200));
  }
  if (parsed.error) {
    // A 200 carrying an error envelope is how some providers report a refusal, so
    // the provider's own sentence goes in the headline: it is the only part the
    // player can act on.
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
    ignoredStream: true,
  };
}

/**
 * Sends one request and reads the answer to the end.
 *
 * Resolves with the whole turn -- prose plus every tool call -- because the loop
 * needs all of it before it can decide what to do next, and the deltas are pushed
 * out through `onDelta` as they arrive for the panel's benefit. The two are not
 * in conflict: the same fragments go to both.
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
    // A provider that ignored `stream`, or a proxy that buffered the answer. The
    // request was valid either way, so the answer is read rather than refused.
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
      // A frame we cannot read is skipped rather than fatal: keep-alives and
      // provider-specific status frames ride this channel too.
      return;
    }
    if (chunk.error) throw new AgentError('模型接口在流中报错', chunk.error.message ?? '');
    for (const choice of chunk.choices ?? []) {
      const delta = choice.delta;
      if (delta?.content) {
        content += delta.content;
        onDelta?.({ kind: 'text', text: delta.content });
      }
      for (const fragment of delta?.tool_calls ?? []) {
        const entry = calls.get(fragment.index) ?? { id: '', name: '', args: '' };
        if (fragment.id) entry.id = fragment.id;
        if (fragment.function?.name) entry.name = fragment.function.name;
        if (fragment.function?.arguments) entry.args += fragment.function.arguments;
        calls.set(fragment.index, entry);
        // The name is absent from every fragment but the first, and the panel only
        // needs it to label a row it is already showing.
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
    // The stream ended without `[DONE]` and without anything in it. Saying so is
    // better than returning an empty turn the loop would read as "finished".
    throw new AgentError('接口没有返回任何内容：确认这个地址支持流式 chat/completions');
  }

  return { content, toolCalls, finishReason };
}
