/**
 * The agent loop: one player request becomes as many model turns as it takes.
 *
 * A TURN IS "SEND, ACT, SEND AGAIN". Each round sends the conversation plus the
 * tool list, streams the answer back, and runs whatever tools it asked for; a
 * round that asks for none is the end of the turn. There is no separate planner,
 * no retry wrapper and no queue -- the model's own next request IS the plan.
 *
 * THERE IS A STEP BUDGET, AND IT IS THE PLAYER'S. A coding agent can run for a
 * hundred steps because its user is asleep; here the user is watching a board
 * that is being edited a step at a time, so a model that has gone into a loop is
 * not "still working", it is visibly stuck. The budget comes from the settings
 * (`AgentConfig.maxSteps`, `0` for no cap); running out ends the run with
 * 'capped' and the panel offers 继续执行, so a long build is one click from
 * finishing rather than a retyped request.
 *
 * STOPPING IS IMMEDIATE AND TOTAL. One `AbortSignal` goes into `fetch` and into
 * every tool, the pause between two steps honours it, and an aborted stream is
 * reported as an abort rather than as an error -- a player who pressed 停止 must
 * never be told something went wrong.
 *
 * THE HISTORY IS RETURNED, NOT STORED. The caller keeps the conversation (the
 * panel owns it, and it outlives any one run); this function appends to a copy
 * and hands the whole thing back, so a stopped run still leaves behind exactly
 * what was said.
 */
import { AgentError, streamChat, type ChatDelta, type FetchLike, type TokenUsage } from './client';
import { DEFAULT_MAX_STEPS, type AgentConfig } from './config';
import type { AgentHost } from './host';
import { circuitTools } from './ops';
import { systemPrompt } from './prompt';
import { findTool, runTool, toolNames, toolWire, type ToolSpec } from './tools';
import type { WireMessage } from './wire';

/**
 * Model calls allowed in one player request when nothing else says otherwise.
 *
 * THE BUDGET IS THE PLAYER'S NOW (`AgentConfig.maxSteps`, default
 * `DEFAULT_MAX_STEPS`, and `0` for no cap); this is the value a hand-built
 * configuration falls back to, and the ceiling a fresh install starts at.
 */
export const MAX_STEPS = DEFAULT_MAX_STEPS;

/**
 * Refused tool calls in a row before the run gives up.
 *
 * THE FAILURE THIS PREVENTS IS EXPENSIVE AND PREDICTABLE. A real session spent
 * its entire budget asking for a part under twenty different guessed names --
 * `level_input`, `input`, `in`, `lv_in`, `level_io_in`… -- each answered by a
 * correct refusal, none of them read. Three is where "wrong" stops looking like a
 * mistake and starts looking like a misunderstanding, and the player is better
 * served by being told than by watching the same wall of text go by ten more
 * times.
 */
export const MAX_REFUSALS = 3;

/** What the panel draws while a run is in flight. */
export type AgentEvent =
  | { readonly kind: 'text'; readonly text: string }
  /** The model's reasoning, on the models that stream it -- folded away when done. */
  | { readonly kind: 'thinking'; readonly text: string }
  | { readonly kind: 'step'; readonly index: number }
  /** The budget ran out. The panel draws this as a line with 继续执行 beside it. */
  | { readonly kind: 'cap'; readonly limit: number }
  | {
      readonly kind: 'tool';
      readonly phase: 'start' | 'end';
      readonly callId: string;
      readonly name: string;
      readonly ok?: boolean;
      readonly text?: string;
      /** The same result as one line of Chinese, for the panel to show. */
      readonly note?: string;
    }
  | { readonly kind: 'error'; readonly message: string; readonly detail: string };

export type StopReason = 'done' | 'aborted' | 'error' | 'capped' | 'stuck';

export interface RunOptions {
  readonly config: AgentConfig;
  readonly host: AgentHost;
  /** The conversation so far, WITHOUT the system message, which is rebuilt here. */
  readonly messages: readonly WireMessage[];
  readonly signal: AbortSignal;
  readonly fetchImpl?: FetchLike;
  readonly onEvent?: (event: AgentEvent) => void;
  /** Overridden by the tests, which must not wait in real time. */
  readonly sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  /** Overridden by the tests, which supply a scripted conversation. */
  readonly tools?: readonly ToolSpec[];
  readonly chat?: typeof streamChat;
}

/**
 * What one run cost, in the four readings the panel draws.
 *
 * MEASURED HERE, NOT IN THE PANEL, because the run is the only place that sees
 * both ends of a request: the clock before `chat` and the clock after it, the
 * first streamed delta, and the provider's own token accounting. The panel gets
 * one object and formats it.
 *
 * A PROVIDER THAT REPORTS NOTHING STILL GETS TIME. `usage` is `null` and
 * `decodeTokens` is zero rather than invented, so the panel can show `2.4s` and
 * leave the token clause out -- the same rule as the cache figure.
 */
export interface RunStats {
  /** Summed request wall time (step start to the end of the streamed answer). */
  readonly llmMs: number;
  /** Summed time to the first streamed delta, over the steps that recorded one. */
  readonly ttftMs: number;
  /** How many steps carry a first-token sample, for the average in a tooltip. */
  readonly ttftSteps: number;
  /** Summed decode window (first delta to the end of the answer). */
  readonly decodeMs: number;
  /** Summed output tokens over the steps that carry both a window and a count. */
  readonly decodeTokens: number;
  /** The provider's sums, or `null` when it never reported any. */
  readonly usage: TokenUsage | null;
}

export interface RunResult {
  /** The conversation including everything this run said and did. */
  readonly messages: readonly WireMessage[];
  readonly stopped: StopReason;
  readonly error: AgentError | null;
  /** How many model calls the run made. */
  readonly steps: number;
  /** Time, speed and token accounting for this run. */
  readonly stats: RunStats;
}

/** An abort, in the one shape the rest of the file checks for. */
function abortError(): Error {
  const error = new Error('已停止');
  error.name = 'AbortError';
  return error;
}

function isAbort(cause: unknown): boolean {
  return (
    typeof cause === 'object' && cause !== null && (cause as { name?: string }).name === 'AbortError'
  );
}

/** A pause that a stop button can cut short. */
export function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(abortError());
      return;
    }
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(abortError());
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Runs one player request to its end.
 *
 * Resolves for every outcome -- done, stopped, capped, failed -- because all four
 * are things the panel has to draw, and a rejected promise would put the failure
 * in whichever caller forgot to catch it.
 */
export async function runAgent(options: RunOptions): Promise<RunResult> {
  const { config, host, signal, onEvent } = options;
  const tools = options.tools ?? circuitTools(host);
  const chat = options.chat ?? streamChat;
  const pause = options.sleep ?? sleep;
  const history: WireMessage[] = [...options.messages];
  let steps = 0;
  let refusals = 0;
  /**
   * This run's budget: the player's setting, `0` meaning "no cap", and the
   * built-in default for a configuration that predates the setting.
   */
  const maxSteps = config.maxSteps === 0 ? null : (config.maxSteps ?? MAX_STEPS);

  /** Wall clock, on the clock the platform actually has. */
  const now = (): number => globalThis.performance?.now() ?? Date.now();
  let llmMs = 0;
  let ttftMs = 0;
  let ttftSteps = 0;
  let decodeMs = 0;
  let decodeTokens = 0;
  let sawUsage = false;
  let inputTokens = 0;
  let outputTokens = 0;
  let totalTokens = 0;
  let cacheRead: number | null = null;

  const stats = (): RunStats => ({
    llmMs,
    ttftMs,
    ttftSteps,
    decodeMs,
    decodeTokens,
    usage: sawUsage
      ? { input: inputTokens, output: outputTokens, total: totalTokens, cacheRead }
      : null,
  });

  const stop = (stopped: StopReason, error: AgentError | null = null): RunResult => ({
    messages: history,
    stopped,
    error,
    steps,
    stats: stats(),
  });

  for (let index = 0; maxSteps === null || index < maxSteps; index += 1) {
    if (signal.aborted) return stop('aborted');
    // Rebuilt every step: the board has changed under the model since the last
    // one, and the level's own description belongs next to the rules it explains.
    const system: WireMessage = { role: 'system', content: systemPrompt(host.snapshot()) };
    steps += 1;
    onEvent?.({ kind: 'step', index });

    let result;
    const startedAt = now();
    let firstAt: number | null = null;
    try {
      result = await chat({
        config,
        messages: [system, ...history],
        tools: toolWire(tools),
        signal,
        ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
        onDelta: (delta: ChatDelta) => {
          // The first delta of any kind is the first token: the model has started
          // answering, and the wait before it is what TTFT measures.
          if (firstAt === null) firstAt = now();
          if (delta.kind === 'text') onEvent?.({ kind: 'text', text: delta.text });
          else if (delta.kind === 'reasoning') onEvent?.({ kind: 'thinking', text: delta.text });
        },
      });
    } catch (cause) {
      if (isAbort(cause)) return stop('aborted');
      const error =
        cause instanceof AgentError ? cause : new AgentError('请求失败', String(cause));
      onEvent?.({ kind: 'error', message: error.message, detail: error.detail });
      return stop('error', error);
    }

    const endedAt = now();
    llmMs += Math.max(0, endedAt - startedAt);
    if (firstAt !== null) {
      ttftMs += Math.max(0, firstAt - startedAt);
      ttftSteps += 1;
    }
    const usage = result.usage ?? null;
    if (usage !== null) {
      sawUsage = true;
      inputTokens += usage.input;
      outputTokens += usage.output;
      totalTokens += usage.total;
      if (usage.cacheRead !== null) cacheRead = (cacheRead ?? 0) + usage.cacheRead;
      if (firstAt !== null) {
        decodeMs += Math.max(0, endedAt - firstAt);
        decodeTokens += usage.output;
      }
    }

    const calls = result.toolCalls;
    history.push({
      role: 'assistant',
      content: result.content === '' ? null : result.content,
      ...(calls.length === 0
        ? {}
        : {
            tool_calls: calls.map((call) => ({
              id: call.id,
              type: 'function' as const,
              function: { name: call.name, arguments: call.arguments },
            })),
          }),
    });

    // A round with no tool call is the model saying it is finished. That is the
    // ONLY way a run ends well -- there is no "done" tool, because a model that
    // must call a tool to stop cannot stop when it has nothing to say.
    if (calls.length === 0) return stop('done');

    for (const call of calls) {
      if (signal.aborted) return stop('aborted');
      onEvent?.({ kind: 'tool', phase: 'start', callId: call.id, name: call.name });
      const spec = findTool(tools, call.name);
      const outcome =
        spec === null
          ? {
              ok: false,
              text: JSON.stringify({
                ok: false,
                error: `没有名为 ${call.name} 的工具。可用的工具：${toolNames(tools)}`,
              }),
              note: `没有名为 ${call.name} 的工具`,
            }
          : await runTool(spec, call.arguments, { signal });
      history.push({ role: 'tool', tool_call_id: call.id, content: outcome.text });
      onEvent?.({
        kind: 'tool',
        phase: 'end',
        callId: call.id,
        name: call.name,
        ok: outcome.ok,
        text: outcome.text,
        note: outcome.note,
      });
      refusals = outcome.ok ? 0 : refusals + 1;
      if (refusals >= MAX_REFUSALS) {
        onEvent?.({
          kind: 'error',
          message: `连续 ${MAX_REFUSALS} 次操作被拒绝，先停下来。最后一次说的是：${outcome.note}。可以把要求说得更具体一点，或者先让我看清现状`,
          detail: '',
        });
        return stop('stuck');
      }
      // THE VISIBLE STEP. The command has already been applied and painted by the
      // host; one macrotask is what holds the frame long enough for a person to
      // see which part appeared (requirement A5). There is no pace setting: the
      // step yields a frame, it does not pause.
      try {
        await pause(0, signal);
      } catch {
        return stop('aborted');
      }
    }
  }

  // The for-loop bound is the budget: reaching here means the last allowed round
  // asked for tools and the next one is not ours to make. The panel turns this
  // event into a line with 继续执行 beside it, which is the one-button way to buy
  // another budget without retyping the request.
  onEvent?.({ kind: 'cap', limit: maxSteps ?? 0 });
  return stop('capped');
}
