import { describe, expect, it, vi } from 'vitest';
import { AgentError, streamChat, type FetchLike } from '../../src/agent/client';
import type { AgentConfig } from '../../src/agent/config';

const CONFIG: AgentConfig = {
  baseUrl: 'https://x.test',
  apiKey: 'sk-test',
  model: 'test-model',
};

/** One `data:` frame of a streamed completion. */
function frame(delta: unknown, finish?: string): string {
  return `data: ${JSON.stringify({
    choices: [{ index: 0, delta, ...(finish === undefined ? {} : { finish_reason: finish }) }],
  })}\n\n`;
}

/** A response that streams `chunks` as `text/event-stream`. */
function sseResponse(chunks: readonly string[], status = 200): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(body, {
    status,
    headers: { 'content-type': 'text/event-stream' },
  });
}

/** A response whose bytes are cut at arbitrary places, as the network does. */
function byteSplitResponse(text: string, every: number): Response {
  const bytes = new TextEncoder().encode(text);
  const pieces: Uint8Array[] = [];
  for (let at = 0; at < bytes.length; at += every) pieces.push(bytes.slice(at, at + every));
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const piece of pieces) controller.enqueue(piece);
      controller.close();
    },
  });
  return new Response(body, { headers: { 'content-type': 'text/event-stream' } });
}

function fetchOf(response: Response | (() => Promise<Response>)): FetchLike {
  return () => (typeof response === 'function' ? response() : Promise.resolve(response));
}

describe('a streamed answer', () => {
  it('reports text deltas in order and returns the whole answer', async () => {
    const seen: string[] = [];
    const response = sseResponse([
      frame({ content: '先放' }),
      frame({ content: '一个与非门' }),
      frame({}, 'stop'),
      'data: [DONE]\n\n',
    ]);
    const result = await streamChat({
      config: CONFIG,
      messages: [{ role: 'user', content: 'hi' }],
      fetchImpl: fetchOf(response),
      onDelta: (delta) => {
        if (delta.kind === 'text') seen.push(delta.text);
      },
    });
    expect(seen).toEqual(['先放', '一个与非门']);
    expect(result.content).toBe('先放一个与非门');
    expect(result.toolCalls).toEqual([]);
    expect(result.finishReason).toBe('stop');
  });

  it('puts a tool call back together from fragments split mid-argument', async () => {
    const response = sseResponse([
      frame({
        tool_calls: [
          { index: 0, id: 'call_a', type: 'function', function: { name: 'place_part', arguments: '{"def' } },
        ],
      }),
      frame({ tool_calls: [{ index: 0, function: { arguments: 'Id":"and","x":0,' } }] }),
      frame({ tool_calls: [{ index: 0, function: { arguments: '"y":8}' } }] }, 'tool_calls'),
      'data: [DONE]\n\n',
    ]);
    const result = await streamChat({
      config: CONFIG,
      messages: [{ role: 'user', content: 'hi' }],
      fetchImpl: fetchOf(response),
    });
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]!.id).toBe('call_a');
    expect(result.toolCalls[0]!.name).toBe('place_part');
    expect(JSON.parse(result.toolCalls[0]!.arguments)).toEqual({ defId: 'and', x: 0, y: 8 });
  });

  it('keeps two tool calls apart by index', async () => {
    const response = sseResponse([
      frame({
        tool_calls: [
          { index: 0, id: 'a', function: { name: 'one', arguments: '{}' } },
          { index: 1, id: 'b', function: { name: 'two', arguments: '{}' } },
        ],
      }),
      'data: [DONE]\n\n',
    ]);
    const result = await streamChat({
      config: CONFIG,
      messages: [{ role: 'user', content: 'hi' }],
      fetchImpl: fetchOf(response),
    });
    expect(result.toolCalls.map((call) => call.name)).toEqual(['one', 'two']);
  });

  it('survives a payload cut into arbitrary byte pieces', async () => {
    const text =
      frame({ content: '你好，世界' }) + frame({ content: '，再见' }, 'stop') + 'data: [DONE]\n\n';
    const result = await streamChat({
      config: CONFIG,
      messages: [{ role: 'user', content: 'hi' }],
      fetchImpl: fetchOf(byteSplitResponse(text, 7)),
    });
    expect(result.content).toBe('你好，世界，再见');
  });

  it('finishes a stream that never sent the terminator, as long as it said something', async () => {
    const response = sseResponse([frame({ content: 'ok' }, 'stop')]);
    const result = await streamChat({
      config: CONFIG,
      messages: [{ role: 'user', content: 'hi' }],
      fetchImpl: fetchOf(response),
    });
    expect(result.content).toBe('ok');
  });

  it('refuses an empty stream rather than reporting an empty turn', async () => {
    const response = sseResponse([]);
    await expect(
      streamChat({
        config: CONFIG,
        messages: [{ role: 'user', content: 'hi' }],
        fetchImpl: fetchOf(response),
      }),
    ).rejects.toBeInstanceOf(AgentError);
  });

  it('skips a frame it cannot parse instead of failing the request', async () => {
    const response = sseResponse(['data: {not json\n\n', frame({ content: 'ok' }, 'stop'), 'data: [DONE]\n\n']);
    const result = await streamChat({
      config: CONFIG,
      messages: [{ role: 'user', content: 'hi' }],
      fetchImpl: fetchOf(response),
    });
    expect(result.content).toBe('ok');
  });

  it('sends the tools it was given, and omits the field when it has none', async () => {
    const bodies: string[] = [];
    const fetchImpl: FetchLike = (_url, init) => {
      bodies.push(String(init.body));
      return Promise.resolve(sseResponse([frame({ content: 'x' }, 'stop'), 'data: [DONE]\n\n']));
    };
    const tool = {
      type: 'function' as const,
      function: { name: 'place', description: 'd', parameters: { type: 'object' as const, properties: {} } },
    };
    await streamChat({ config: CONFIG, messages: [], tools: [tool], fetchImpl });
    await streamChat({ config: CONFIG, messages: [], tools: [], fetchImpl });
    expect(JSON.parse(bodies[0]!).tools).toHaveLength(1);
    expect(JSON.parse(bodies[1]!).tools).toBeUndefined();
    expect(JSON.parse(bodies[0]!).stream).toBe(true);
  });

  it('asks the endpoint the base URL means', async () => {
    const urls: string[] = [];
    const fetchImpl: FetchLike = (url) => {
      urls.push(url);
      return Promise.resolve(sseResponse([frame({ content: 'x' }, 'stop'), 'data: [DONE]\n\n']));
    };
    await streamChat({ config: { ...CONFIG, baseUrl: 'https://x.test/v1/' }, messages: [], fetchImpl });
    expect(urls).toEqual(['https://x.test/v1/chat/completions']);
  });
});

describe('an answer that was not streamed', () => {
  it('reads a plain completion, for a provider or proxy that ignored stream', async () => {
    const body = JSON.stringify({
      choices: [
        {
          message: {
            content: 'done',
            tool_calls: [{ id: 'c1', function: { name: 'step', arguments: '{}' } }],
          },
          finish_reason: 'tool_calls',
        },
      ],
    });
    const response = new Response(body, { headers: { 'content-type': 'application/json' } });
    const result = await streamChat({
      config: CONFIG,
      messages: [],
      fetchImpl: fetchOf(response),
    });
    expect(result.content).toBe('done');
    expect(result.toolCalls.map((call) => call.name)).toEqual(['step']);
  });

  it('reports an error envelope instead of pretending it was an answer', async () => {
    const response = new Response(JSON.stringify({ error: { message: '额度不足' } }), {
      headers: { 'content-type': 'application/json' },
    });
    await expect(
      streamChat({ config: CONFIG, messages: [], fetchImpl: fetchOf(response) }),
    ).rejects.toThrow(/额度不足/);
  });
});

describe('failures a player has to act on', () => {
  /** The failure a call ends in; throws if it succeeded instead. */
  async function caught(run: () => Promise<unknown>): Promise<AgentError> {
    try {
      await run();
    } catch (cause) {
      return cause as AgentError;
    }
    throw new Error('expected the call to fail');
  }

  it('blames the key on 401, and keeps the provider’s own words', async () => {
    const response = new Response(JSON.stringify({ error: { message: 'Authentication Fails' } }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    });
    const error = await caught(() =>
      streamChat({ config: CONFIG, messages: [], fetchImpl: fetchOf(response) }),
    );
    expect(error).toBeInstanceOf(AgentError);
    expect(error.message).toContain('key');
    expect(error.detail).toContain('Authentication Fails');
  });

  it('prints the URL it actually asked for on 404', async () => {
    const response = new Response('nope', { status: 404 });
    const error = await caught(() =>
      streamChat({ config: CONFIG, messages: [], fetchImpl: fetchOf(response) }),
    );
    expect(error.message).toContain('https://x.test/chat/completions');
  });

  it('turns a dead network or a blocked preflight into advice about CORS', async () => {
    const fetchImpl: FetchLike = () => Promise.reject(new TypeError('Failed to fetch'));
    const error = await caught(() => streamChat({ config: CONFIG, messages: [], fetchImpl }));
    expect(error.message).toContain('CORS');
    expect(error.detail).toBe('Failed to fetch');
  });

  it('passes an abort through as an abort, not as a transport failure', async () => {
    const aborted = new Error('aborted');
    aborted.name = 'AbortError';
    const fetchImpl: FetchLike = () => Promise.reject(aborted);
    const error = await caught(() => streamChat({ config: CONFIG, messages: [], fetchImpl }));
    expect(error.name).toBe('AbortError');
  });

  it('refuses before fetching when the address is empty', async () => {
    const fetchImpl = vi.fn<FetchLike>();
    await expect(
      streamChat({ config: { ...CONFIG, baseUrl: '  ' }, messages: [], fetchImpl }),
    ).rejects.toThrow(/地址/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
