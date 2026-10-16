import { describe, expect, it } from 'vitest';
import { createSseDecoder } from '../../src/agent/sse';

describe('the SSE decoder', () => {
  it('completes an event on a blank line and strips the one syntax space', () => {
    const decoder = createSseDecoder();
    const events = decoder.feed('data: {"a":1}\n\ndata: {"b":2}\n\n');
    expect(events).toEqual([
      { event: 'message', data: '{"a":1}' },
      { event: 'message', data: '{"b":2}' },
    ]);
  });

  it('keeps a half-written line until the rest of it arrives', () => {
    const decoder = createSseDecoder();
    expect(decoder.feed('data: {"cho')).toEqual([]);
    expect(decoder.feed('ices":[]}')).toEqual([]);
    expect(decoder.feed('\n\n')).toEqual([{ event: 'message', data: '{"choices":[]}' }]);
  });

  it('joins the data lines of one event with newlines, as the syntax says', () => {
    const decoder = createSseDecoder();
    expect(decoder.feed('data: one\ndata: two\n\n')).toEqual([{ event: 'message', data: 'one\ntwo' }]);
  });

  it('ignores comments, which is what a keep-alive is', () => {
    const decoder = createSseDecoder();
    expect(decoder.feed(': ping\n\n')).toEqual([]);
    expect(decoder.feed('data: x\n\n')).toEqual([{ event: 'message', data: 'x' }]);
  });

  it('carries a named event through', () => {
    const decoder = createSseDecoder();
    expect(decoder.feed('event: done\ndata: now\n\n')).toEqual([{ event: 'done', data: 'now' }]);
  });

  it('handles CRLF, which some proxies send', () => {
    const decoder = createSseDecoder();
    expect(decoder.feed('data: a\r\n\r\n')).toEqual([{ event: 'message', data: 'a' }]);
  });

  it('accepts a field with no colon as an empty value, and ignores id and retry', () => {
    const decoder = createSseDecoder();
    expect(decoder.feed('data\n\n')).toEqual([{ event: 'message', data: '' }]);
    expect(decoder.feed('id: 7\nretry: 100\ndata: b\n\n')).toEqual([{ event: 'message', data: 'b' }]);
  });

  it('flushes an event the stream never terminated', () => {
    const decoder = createSseDecoder();
    decoder.feed('data: [DONE]');
    expect(decoder.flush()).toEqual([{ event: 'message', data: '[DONE]' }]);
  });

  it('flushes nothing when the stream ended cleanly', () => {
    const decoder = createSseDecoder();
    decoder.feed('data: x\n\n');
    expect(decoder.flush()).toEqual([]);
  });

  it('does not drop or duplicate a payload split mid-character', () => {
    const decoder = createSseDecoder();
    const head = 'data: {"choices":[{"delta":{"content":"你';
    expect(decoder.feed(head)).toEqual([]);
    const tail = '好"}}]}\n\n';
    expect(decoder.feed(tail)).toEqual([
      { event: 'message', data: '{"choices":[{"delta":{"content":"你好"}}]}' },
    ]);
    expect(decoder.flush()).toEqual([]);
  });
});
