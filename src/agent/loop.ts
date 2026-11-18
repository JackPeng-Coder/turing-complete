/**
 * 智能体的运行循环：一次玩家请求，展开成任意多次模型回合。
 *
 * 一个回合就是「发送、行动、再发送」。每一轮把对话和历史与工具清单发给模型，
 * 流式读回答案，再执行它请求的工具；某一轮没有请求任何工具，本次运行就结束。
 * 这里没有单独的规划器、没有重试包装、也没有队列——模型自己的下一次请求就是计划。
 *
 * 有步数预算，而且这个预算属于玩家。编程智能体可以跑一百步，因为它的用户在睡觉；
 * 这里的用户正盯着一块一步一步被改动的画板，
 * 所以一个陷入循环的模型不是「还在工作」，而是肉眼可见地卡住了。
 * 预算来自设置（AgentConfig.maxSteps，0 表示不设上限）；
 * 用完就以 'capped' 结束，面板给出「继续执行」，
 * 于是长任务离完成只差一次点击，而不需要重新输入请求。
 *
 * 停止是立即且彻底的。同一个 AbortSignal 进入 fetch 和每一个工具，
 * 两步之间的停顿也尊重它；被中止的流按「中止」上报而不是按「错误」——
 * 按过「停止」的玩家绝不应该被告知「出错了」。
 *
 * 历史是返回的，不是保存的。调用方持有对话（面板拥有它，它比任何一次运行都活得久）；
 * 本函数往副本上追加，再把整份交回去，于是一次被停止的运行也恰好留下它说过的话。
 */
import { AgentError, streamChat, type ChatDelta, type FetchLike, type TokenUsage } from './client';
import { DEFAULT_MAX_STEPS, type AgentConfig } from './config';
import type { AgentHost } from './host';
import { circuitTools } from './ops';
import { costOf } from './pricing';
import { systemPrompt } from './prompt';
import { findTool, runTool, toolNames, toolWire, type ToolSpec } from './tools';
import type { WireMessage } from './wire';

/**
 * 没有别的配置时，一次玩家请求允许调用模型多少次。
 *
 * 预算现在是玩家可调的（AgentConfig.maxSteps，默认取 DEFAULT_MAX_STEPS，
 * 0 表示不设上限）；这个值既是手写配置的兜底，
 * 也是全新安装时起步的上限。
 */
export const MAX_STEPS = DEFAULT_MAX_STEPS;

/**
 * 连续多少次工具调用被拒绝后，本次运行放弃。
 *
 * 要防的失败昂贵且可预料。一次真实会话把整个预算都花在
 * 用二十个猜出来的名字索要同一个元件上——level_input、input、in、lv_in、level_io_in……
 * 每一次都换来一句正确的拒绝，却没有一句被读进去。
 * 三次，是「弄错了」开始看起来像「理解错了」的临界点；
 * 此时告诉玩家，比看他再刷十遍同样的墙好。
 */
export const MAX_REFUSALS = 3;

/** 一次运行进行中，面板需要画出来的事件。 */
export type AgentEvent =
  /** 模型正在输出的文字增量。 */
  | { readonly kind: 'text'; readonly text: string }
  /** 模型自己的推理，只有会流式输出推理的模型才有——结束后折起。 */
  | { readonly kind: 'thinking'; readonly text: string }
  /** 第 index 步（从 0 计）开始了。 */
  | { readonly kind: 'step'; readonly index: number }
    /** 到目前为止的读数，每到一个步骤边界就发一次，
   * 让面板在请求还没结束时就能显示时间和 token。 */
  | { readonly kind: 'progress'; readonly stats: RunStats; readonly steps: number }
  /** 预算用完了。面板把它画成一行，旁边放「继续执行」。 */
  | { readonly kind: 'cap'; readonly limit: number }
  | {
      readonly kind: 'tool';
      /** start 表示开始执行，end 表示已经有结果。 */
      readonly phase: 'start' | 'end';
      readonly callId: string;
      readonly name: string;
      /** phase 为 end 时：这一步是成功还是被拒绝。 */
      readonly ok?: boolean;
      /** phase 为 end 时：回到模型手里的 JSON 文本。 */
      readonly text?: string;
            /** 同一结果的单行中文，给面板显示。 */
      readonly note?: string;
    }
  /** 这一轮失败：message 是给玩家的一行中文，detail 是对方原话。 */
  | { readonly kind: 'error'; readonly message: string; readonly detail: string };

/** 一次运行以什么方式结束。done 是正常完成，aborted 是玩家停止，error 是请求失败，capped 是预算用完，stuck 是连续被拒。 */
export type StopReason = 'done' | 'aborted' | 'error' | 'capped' | 'stuck';

/** runAgent 的输入。 */
export interface RunOptions {
  readonly config: AgentConfig;
  readonly host: AgentHost;
  /** 到目前为止的对话，不含 system 消息——那条在每一步重新生成。 */
  readonly messages: readonly WireMessage[];
  readonly signal: AbortSignal;
  readonly fetchImpl?: FetchLike;
  readonly onEvent?: (event: AgentEvent) => void;
  /** 由测试覆盖：测试不能真的等时间。 */
  readonly sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  /** 由测试覆盖：测试提供脚本化的工具清单。 */
  readonly tools?: readonly ToolSpec[];
  readonly chat?: typeof streamChat;
}

/**
 * 一次运行花了多少，用面板要显示的四项读数表示。
 *
 * 在这里测量，而不是在面板里，因为只有运行本身同时看得见一次请求的两端：
 * 调用 chat 之前的钟、之后的钟、第一个流式增量，
 * 以及服务商自己的 token 记账。面板拿到一个对象，只负责格式化。
 *
 * 服务商什么都不报，也仍然有时间。usage 是 null、decodeTokens 是 0，
 * 而不是编一个数，于是面板可以显示 2.4s、省略 token 那几项——
 * 与缓存数字遵循同一条规则。
 */
export interface RunStats {
  /** 各步请求耗时之和（从步骤开始到流式答案结束）。 */
  readonly llmMs: number;
  /** 各步「到第一个流式增量」的耗时之和，只统计记录了首 token 的步。 */
  readonly ttftMs: number;
  /** 有多少步带了首 token 采样，供悬浮提示里算平均值。 */
  readonly ttftSteps: number;
  /** 各步解码窗口之和（从第一个增量到答案结束）。 */
  readonly decodeMs: number;
  /** 各步输出 token 之和，只统计同时有窗口与计数的步。 */
  readonly decodeTokens: number;
  /** 服务商给的总计；它一次都没报过就是 null。 */
  readonly usage: TokenUsage | null;
  /** 按服务商公布的价格，这些 token 折合多少人民币。 */
  readonly costCny: number | null;
}

/** 一次运行结束后的全部结果。 */
export interface RunResult {
  /** 包含这次运行说过、做过的全部内容的对话。 */
  readonly messages: readonly WireMessage[];
  /** 为什么停下。 */
  readonly stopped: StopReason;
  /** 以 error 结束时是那个错误，否则为 null。 */
  readonly error: AgentError | null;
  /** 这次运行调用了几次模型。 */
  readonly steps: number;
  /** 本次运行的时间、速度与 token 记账。 */
  readonly stats: RunStats;
}

/** 一次中止，形状是文件其余部分唯一会检查的那一种。 */
function abortError(): Error {
  const error = new Error('已停止');
  error.name = 'AbortError';
  return error;
}

/** 判断一个异常值是否为一次中止。 */
function isAbort(cause: unknown): boolean {
  return (
    typeof cause === 'object' && cause !== null && (cause as { name?: string }).name === 'AbortError'
  );
}

/** 一次可以被「停止」按钮提前切断的等待。 */
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
 * 把一次玩家请求一路跑到结束。
 *
 * 每一种结局都 resolve——完成、被停止、预算用完、失败——
 * 因为这四种都是面板必须画出来的东西；
 * 若用被拒绝的 Promise，失败就会落进某个忘了 catch 的调用方手里。
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
   * 本次运行的预算：玩家设置的值（0 表示不设上限），
   * 以及配置早于该设置出现时使用的内置默认值。
   */
  const maxSteps = config.maxSteps === 0 ? null : (config.maxSteps ?? MAX_STEPS);

  /** 墙钟时间，使用平台真实提供的计时源。 */
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
  let costCny: number | null = null;

  const stats = (): RunStats => ({
    llmMs,
    ttftMs,
    ttftSteps,
    decodeMs,
    decodeTokens,
    usage: sawUsage
      ? { input: inputTokens, output: outputTokens, total: totalTokens, cacheRead }
      : null,
    costCny,
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
    // 每一步都重建：从上一步到现在，模型脚下的画板已经变了，
    // 关卡自己的说明也应该紧挨着它解释的规则出现。
    const system: WireMessage = { role: 'system', content: systemPrompt(host.snapshot()) };
    steps += 1;
    onEvent?.({ kind: 'step', index });
    // 步骤数在一步开始的瞬间就更新；token 那几项要等答案的 usage 帧
    // 到达之后（见下）再更新一次。
    onEvent?.({ kind: 'progress', stats: stats(), steps });

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
          // 任何类型的第一个增量就是「第一个 token」：模型已经开始作答，
          // 在它之前的等待时间，正是 TTFT 要量的东西。
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
      // 按步计价，且按这一步实际花费的那个钟点算：高峰与空闲价格不同。
      const stepCost = costOf(config.model, usage, new Date());
      if (stepCost !== null) costCny = (costCny ?? 0) + stepCost;
    }
    // 读数刚刚变了：token、速度、缓存与费用现在就在请求进行中可见，
    // 而不是等整次请求结束才出现。
    onEvent?.({ kind: 'progress', stats: stats(), steps });

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

    // 一轮里没有任何工具调用，就是模型在说它做完了。
    // 这是运行正常结束的唯一方式——不存在 done 工具，
    // 因为一个必须调用工具才能停下的模型，在没话可说时就停不下来。
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
      // 看得见的那一步。命令此时已经由宿主执行并重绘完毕；
      // 让出一个宏任务，就是把这一帧留够时间，让人看清出现了哪个元件（需求 A5）。
      // 没有「节奏」设置：这一步只是让出一帧，不是暂停。
      // 暂停由上面的 abort 检查负责；这里的等待永远只等一帧。
      try {
        await pause(0, signal);
      } catch {
        return stop('aborted');
      }
    }
  }

  // for 循环的上界就是预算：能走到这里，说明最后一个允许的轮次请求了工具，
  // 而下一轮已经不属于我们。面板把这个事件变成一行字，旁边放「继续执行」，
  // 这就是「不重打一遍请求、按一个按钮再买一段预算」的方式。
  // 玩家不需要知道预算数字才明白发生了什么，所以这句话点到为止。
  onEvent?.({ kind: 'cap', limit: maxSteps ?? 0 });
  return stop('capped');
}
