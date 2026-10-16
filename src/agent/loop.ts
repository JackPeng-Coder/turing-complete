/**
 * The agent loop: one player request becomes as many model turns as it takes.
 *
 * A TURN IS "SEND, ACT, SEND AGAIN". Each round sends the conversation plus the
 * tool list, streams the answer back, and runs whatever tools it asked for; a
 * round that asks for none is the end of the turn. There is no separate planner,
 * no retry wrapper and no queue -- the model's own next request IS the plan.
 *
 * THERE IS A STEP CAP, AND IT IS A GAME'S CAP, NOT A HARNESS'S. A coding agent
 * can run for a hundred steps because its user is asleep; here the user is
 * watching a board that is being edited at 160 ms a step, so a model that has
 * gone into a loop is not "still working", it is visibly stuck. The cap turns
 * that into a sentence the player can act on.
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
import { AgentError, streamChat, type ChatDelta, type FetchLike } from './client';
import type { AgentConfig } from './config';
import type { AgentHost } from './host';
import { circuitTools } from './ops';
import { systemPrompt } from './prompt';
import { findTool, runTool, toolNames, toolWire, type ToolSpec } from './tools';
import type { WireMessage } from './wire';

/**
 * Model calls allowed in one player request.
 *
 * Sixteen is a budget rather than a limit: a level in this game is a handful of
 * gates, so a turn that has not finished by then has misunderstood the request,
 * and the player is better served by being told so than by watching it continue.
 */
export const MAX_STEPS = 16;

/** What the panel draws while a run is in flight. */
export type AgentEvent =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'step'; readonly index: number }
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

export type StopReason = 'done' | 'aborted' | 'error' | 'capped';

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

export interface RunResult {
  /** The conversation including everything this run said and did. */
  readonly messages: readonly WireMessage[];
  readonly stopped: StopReason;
  readonly error: AgentError | null;
  /** How many model calls the run made. */
  readonly steps: number;
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

  const stop = (stopped: StopReason, error: AgentError | null = null): RunResult => ({
    messages: history,
    stopped,
    error,
    steps,
  });

  for (let index = 0; index < MAX_STEPS; index += 1) {
    if (signal.aborted) return stop('aborted');
    // Rebuilt every step: the board has changed under the model since the last
    // one, and the level's own description belongs next to the rules it explains.
    const system: WireMessage = { role: 'system', content: systemPrompt(host.snapshot()) };
    steps += 1;
    onEvent?.({ kind: 'step', index });

    let result;
    try {
      result = await chat({
        config,
        messages: [system, ...history],
        tools: toolWire(tools),
        signal,
        ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
        onDelta: (delta: ChatDelta) => {
          if (delta.kind === 'text') onEvent?.({ kind: 'text', text: delta.text });
        },
      });
    } catch (cause) {
      if (isAbort(cause)) return stop('aborted');
      const error =
        cause instanceof AgentError ? cause : new AgentError('请求失败', String(cause));
      onEvent?.({ kind: 'error', message: error.message, detail: error.detail });
      return stop('error', error);
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
      // THE VISIBLE STEP. The command has already been applied and painted by the
      // host; this is what holds the frame long enough for a person to see which
      // part appeared (requirement A5). The pace is the player's setting, and
      // zero means "just do it".
      if (config.stepMs > 0) {
        try {
          await pause(config.stepMs, signal);
        } catch {
          return stop('aborted');
        }
      }
    }

    if (index === MAX_STEPS - 1) {
      onEvent?.({
        kind: 'error',
        message: `这一步做得太久（已经 ${MAX_STEPS} 轮），先停下来。可以把要求说得更具体一点再试`,
        detail: '',
      });
      return stop('capped');
    }
  }

  return stop('capped');
}
