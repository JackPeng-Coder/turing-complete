import { describe, expect, it } from 'vitest';
import { AgentError, streamChat, type ChatResult } from '../../src/agent/client';
import type { AgentConfig } from '../../src/agent/config';
import { MAX_REFUSALS, MAX_STEPS, runAgent, type AgentEvent } from '../../src/agent/loop';
import { ToolError, type ToolSpec } from '../../src/agent/tools';
import type { WireMessage } from '../../src/agent/wire';
import { makeTestHost } from './host-fixture';

const CONFIG: AgentConfig = {
  baseUrl: 'https://x.test',
  apiKey: 'sk-test',
  model: 'test-model',
  maxSteps: MAX_STEPS,
};

function callOf(name: string, args = '{}'): { id: string; name: string; arguments: string } {
  return { id: `call_${name}`, name, arguments: args };
}

/** A chat that answers with a script, one result per model call. */
function scripted(results: readonly ChatResult[]): {
  chat: typeof streamChat;
  seen: WireMessage[][];
} {
  const seen: WireMessage[][] = [];
  let at = 0;
  const chat: typeof streamChat = (options) => {
    seen.push([...options.messages]);
    const result = results[Math.min(at, results.length - 1)]!;
    at += 1;
    if (result.content !== '') options.onDelta?.({ kind: 'text', text: result.content });
    return Promise.resolve(result);
  };
  return { chat, seen };
}

/** A tool that records its calls. */
function recorder(): { spec: ToolSpec; calls: unknown[] } {
  const calls: unknown[] = [];
  return {
    calls,
    spec: {
      name: 'poke',
      description: 'records',
      parameters: {
        type: 'object',
        properties: { at: { type: 'number', description: 'where' } },
        required: ['at'],
        additionalProperties: false,
      },
      run: (args) => {
        calls.push(args);
        return { poked: args.at };
      },
    },
  };
}

function context(): { signal: AbortSignal; controller: AbortController } {
  const controller = new AbortController();
  return { controller, signal: controller.signal };
}

describe('a turn that uses a tool', () => {
  it('runs it once, feeds the result back, and finishes when no tool is asked for', async () => {
    const host = makeTestHost();
    const tool = recorder();
    const { chat, seen } = scripted([
      { content: '', toolCalls: [callOf('poke', '{"at":3}')], finishReason: 'tool_calls' },
      { content: '放好了', toolCalls: [], finishReason: 'stop' },
    ]);
    const { signal } = context();
    const events: AgentEvent[] = [];
    const result = await runAgent({
      config: CONFIG,
      host: host.host,
      messages: [{ role: 'user', content: '放一个与非门' }],
      signal,
      chat,
      tools: [tool.spec],
      onEvent: (event) => events.push(event),
    });

    expect(result.stopped).toBe('done');
    expect(result.steps).toBe(2);
    expect(tool.calls).toEqual([{ at: 3 }]);
    // The conversation is the caller's to keep: user, assistant(call), tool, assistant.
    expect(result.messages.map((message) => message.role)).toEqual([
      'user',
      'assistant',
      'tool',
      'assistant',
    ]);
    expect(result.messages[1]!.tool_calls?.[0]).toMatchObject({
      id: 'call_poke',
      function: { name: 'poke', arguments: '{"at":3}' },
    });
    expect(JSON.parse(result.messages[2]!.content!)).toEqual({ ok: true, result: { poked: 3 } });
    // Every request carried a system message, rebuilt for that step.
    expect(seen).toHaveLength(2);
    expect(seen[0]![0]!.role).toBe('system');
    expect(seen[1]!.length).toBeGreaterThan(seen[0]!.length);
    expect(events.filter((event) => event.kind === 'text')).toEqual([{ kind: 'text', text: '放好了' }]);
    expect(events.filter((event) => event.kind === 'tool')).toHaveLength(2);
  });

  it('yields one frame per step, with no pace to set', async () => {
    const host = makeTestHost();
    const tool = recorder();
    const { chat } = scripted([
      { content: '', toolCalls: [callOf('poke', '{"at":1}'), callOf('poke', '{"at":2}')], finishReason: 'tool_calls' },
      { content: '完成', toolCalls: [], finishReason: 'stop' },
    ]);
    const naps: number[] = [];
    const { signal } = context();
    const result = await runAgent({
      config: CONFIG,
      host: host.host,
      messages: [],
      signal,
      chat,
      tools: [tool.spec],
      sleep: (ms) => {
        naps.push(ms);
        return Promise.resolve();
      },
    });
    expect(result.stopped).toBe('done');
    // One macrotask per command, so the board can paint a frame and the step is
    // visible -- and nothing longer: the pace setting is gone.
    expect(naps).toEqual([0, 0]);
    expect(tool.calls).toEqual([{ at: 1 }, { at: 2 }]);
  });

  it('answers a tool it does not have with a correction, and keeps going', async () => {
    const host = makeTestHost();
    const tool = recorder();
    const { chat } = scripted([
      { content: '', toolCalls: [callOf('teleport')], finishReason: 'tool_calls' },
      { content: '换个办法', toolCalls: [], finishReason: 'stop' },
    ]);
    const { signal } = context();
    const result = await runAgent({
      config: CONFIG,
      host: host.host,
      messages: [],
      signal,
      chat,
      tools: [tool.spec],
    });
    expect(result.stopped).toBe('done');
    expect(result.messages.map((message) => message.role)).toEqual(['assistant', 'tool', 'assistant']);
    const answer = JSON.parse(result.messages[1]!.content!);
    expect(answer.ok).toBe(false);
    expect(answer.error).toContain('teleport');
    expect(answer.error).toContain('poke');
  });
});

describe('stopping', () => {
  it('sends nothing when the signal is already aborted', async () => {
    const host = makeTestHost();
    const { chat, seen } = scripted([{ content: 'x', toolCalls: [], finishReason: 'stop' }]);
    const { controller, signal } = context();
    controller.abort();
    const result = await runAgent({
      config: CONFIG,
      host: host.host,
      messages: [],
      signal,
      chat,
    });
    expect(result.stopped).toBe('aborted');
    expect(seen).toEqual([]);
  });

  it('reports an abort as an abort, not as a failure', async () => {
    const host = makeTestHost();
    const aborted = new Error('已停止');
    aborted.name = 'AbortError';
    const chat: typeof streamChat = () => Promise.reject(aborted);
    const { signal } = context();
    const events: AgentEvent[] = [];
    const result = await runAgent({
      config: CONFIG,
      host: host.host,
      messages: [],
      signal,
      chat,
      onEvent: (event) => events.push(event),
    });
    expect(result.stopped).toBe('aborted');
    expect(result.error).toBeNull();
    expect(events.some((event) => event.kind === 'error')).toBe(false);
  });

  it('stops between two tool calls when the player presses 停止', async () => {
    const host = makeTestHost();
    const tool = recorder();
    const { chat } = scripted([
      { content: '', toolCalls: [callOf('poke', '{"at":1}'), callOf('poke', '{"at":2}')], finishReason: 'tool_calls' },
      { content: '不该到这里', toolCalls: [], finishReason: 'stop' },
    ]);
    const { controller, signal } = context();
    let ran = 0;
    const interrupting: ToolSpec = {
      ...tool.spec,
      run: (args) => {
        ran += 1;
        controller.abort();
        return tool.spec.run(args, { signal });
      },
    };
    const result = await runAgent({
      config: CONFIG,
      host: host.host,
      messages: [],
      signal,
      chat,
      tools: [interrupting],
    });
    expect(ran).toBe(1);
    expect(result.stopped).toBe('aborted');
  });
});

describe('failing', () => {
  it('reports a transport failure with its detail and stops', async () => {
    const host = makeTestHost();
    const chat: typeof streamChat = () =>
      Promise.reject(new AgentError('API key 被拒绝（HTTP 401）', 'Authentication Fails'));
    const { signal } = context();
    const events: AgentEvent[] = [];
    const result = await runAgent({
      config: CONFIG,
      host: host.host,
      messages: [],
      signal,
      chat,
      onEvent: (event) => events.push(event),
    });
    expect(result.stopped).toBe('error');
    expect(result.error?.message).toContain('401');
    expect(events).toContainEqual({
      kind: 'error',
      message: 'API key 被拒绝（HTTP 401）',
      detail: 'Authentication Fails',
    });
  });

  it('stops after three refusals in a row, instead of watching the same wall ten more times', async () => {
    const host = makeTestHost();
    const refusing: ToolSpec = {
      name: 'poke',
      description: 'always refuses',
      parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
      run: () => {
        throw new ToolError('没有元件类型「lv_in」');
      },
    };
    const { chat } = scripted([
      { content: '', toolCalls: [callOf('poke')], finishReason: 'tool_calls' },
    ]);
    const { signal } = context();
    const events: AgentEvent[] = [];
    const result = await runAgent({
      config: CONFIG,
      host: host.host,
      messages: [],
      signal,
      chat,
      tools: [refusing],
      onEvent: (event) => events.push(event),
    });
    expect(result.stopped).toBe('stuck');
    expect(result.steps).toBe(MAX_REFUSALS);
    expect(events.some((event) => event.kind === 'error' && event.message.includes('连续 3 次'))).toBe(
      true,
    );
  });

  it('does not count a refusal that a later success clears', async () => {
    const host = makeTestHost();
    const tool = recorder();
    let n = 0;
    const flaky: ToolSpec = {
      ...tool.spec,
      run: (args, ctx) => {
        n += 1;
        if (n === 1) throw new ToolError('第一次不行');
        return tool.spec.run(args, ctx);
      },
    };
    const { chat } = scripted([
      {
        content: '',
        toolCalls: [callOf('poke', '{"at":1}'), callOf('poke', '{"at":2}'), callOf('poke', '{"at":3}')],
        finishReason: 'tool_calls',
      },
      { content: '好了', toolCalls: [], finishReason: 'stop' },
    ]);
    const { signal } = context();
    const result = await runAgent({
      config: CONFIG,
      host: host.host,
      messages: [],
      signal,
      chat,
      tools: [flaky],
    });
    expect(result.stopped).toBe('done');
  });

  it('caps a run that never stops asking for tools, and says what the budget was', async () => {
    const host = makeTestHost();
    const tool = recorder();
    const { chat } = scripted([
      { content: '', toolCalls: [callOf('poke', '{"at":1}')], finishReason: 'tool_calls' },
    ]);
    const { signal } = context();
    const events: AgentEvent[] = [];
    const result = await runAgent({
      config: CONFIG,
      host: host.host,
      messages: [],
      signal,
      chat,
      tools: [tool.spec],
      onEvent: (event) => events.push(event),
    });
    expect(result.stopped).toBe('capped');
    expect(result.steps).toBe(MAX_STEPS);
    expect(tool.calls).toHaveLength(MAX_STEPS);
    // The cap is an event of its own now: the panel turns it into a row with
    // 继续执行 beside it, so the player is not left with only a complaint.
    expect(events.filter((event) => event.kind === 'cap')).toEqual([{ kind: 'cap', limit: MAX_STEPS }]);
    expect(events.some((event) => event.kind === 'error')).toBe(false);
  });

  it('caps at the budget the settings asked for', async () => {
    const host = makeTestHost();
    const tool = recorder();
    const { chat } = scripted([
      { content: '', toolCalls: [callOf('poke', '{"at":1}')], finishReason: 'tool_calls' },
    ]);
    const { signal } = context();
    const events: AgentEvent[] = [];
    const result = await runAgent({
      config: { ...CONFIG, maxSteps: 3 },
      host: host.host,
      messages: [],
      signal,
      chat,
      tools: [tool.spec],
      onEvent: (event) => events.push(event),
    });
    expect(result.stopped).toBe('capped');
    expect(result.steps).toBe(3);
    expect(tool.calls).toHaveLength(3);
    expect(events.filter((event) => event.kind === 'cap')).toEqual([{ kind: 'cap', limit: 3 }]);
  });

  it('sums the provider’s token accounting over the run, and times it', async () => {
    const host = makeTestHost();
    const tool = recorder();
    const { chat } = scripted([
      {
        content: '',
        toolCalls: [callOf('poke', '{"at":1}')],
        finishReason: 'tool_calls',
        usage: { input: 100, output: 10, total: 110, cacheRead: 60 },
      },
      {
        content: '完成',
        toolCalls: [],
        finishReason: 'stop',
        usage: { input: 200, output: 20, total: 220, cacheRead: 0 },
      },
    ]);
    const { signal } = context();
    const result = await runAgent({
      config: CONFIG,
      host: host.host,
      messages: [],
      signal,
      chat,
      tools: [tool.spec],
    });
    expect(result.stopped).toBe('done');
    // One usage object per step, summed: the panel gets one row per request.
    expect(result.stats.usage).toEqual({ input: 300, output: 30, total: 330, cacheRead: 60 });
    expect(result.stats.llmMs).toBeGreaterThanOrEqual(0);
    // Only the second step streamed prose, so only it has a decode window.
    expect(result.stats.ttftSteps).toBe(1);
    expect(result.stats.decodeTokens).toBe(20);
    expect(result.stats.decodeMs).toBeGreaterThanOrEqual(0);
  });

  it('reports no usage rather than zeros when the provider sends none', async () => {
    const host = makeTestHost();
    const tool = recorder();
    const { chat } = scripted([
      { content: '', toolCalls: [callOf('poke', '{"at":1}')], finishReason: 'tool_calls' },
      { content: '完成', toolCalls: [], finishReason: 'stop' },
    ]);
    const { signal } = context();
    const result = await runAgent({
      config: CONFIG,
      host: host.host,
      messages: [],
      signal,
      chat,
      tools: [tool.spec],
    });
    expect(result.stats.usage).toBeNull();
    expect(result.stats.decodeTokens).toBe(0);
  });
});
