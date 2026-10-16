/**
 * Server-sent events, decoded by hand.
 *
 * THE ONE PROTOCOL THIS PROJECT NEEDS, AND ONLY THAT ONE. `text/event-stream` is
 * a line protocol with four fields, and everything past the four is a feature of
 * a reconnecting feed -- `id`, `retry` and `Last-Event-ID` exist so a dropped
 * connection can resume mid-stream, which a single chat response never does. So
 * this decoder keeps `event` and `data`, ignores comments (which is what a
 * keep-alive is), and drops the rest rather than pretending to support it.
 *
 * INCREMENTAL, because a stream arrives in whatever pieces the network felt like
 * sending: a JSON payload split across three `feed` calls is the normal case, not
 * the edge case. The buffer is a string, not a byte array, because the caller
 * decodes bytes with a streaming `TextDecoder` first -- doing it here would mean
 * this file owned UTF-8, and a multi-byte character split across two chunks is a
 * problem the platform already solves.
 */

/** One dispatched event: a named payload, with the default name `message`. */
export interface SseEvent {
  readonly event: string;
  readonly data: string;
}

export interface SseDecoder {
  /** Completes the events `chunk` finished; a partial line stays buffered. */
  feed(chunk: string): SseEvent[];
  /**
   * Completes anything the stream left behind.
   *
   * A stream that ends without its final blank line is malformed but real, and
   * the last event of a response is exactly the one carrying the finish reason --
   * dropping it because the sender forgot a newline would lose the answer.
   */
  flush(): SseEvent[];
}

export function createSseDecoder(): SseDecoder {
  let buffer = '';
  let event = '';
  let data: string[] = [];

  const dispatch = (out: SseEvent[]): void => {
    // A blank line with nothing pending is the separator after a comment, which
    // is not an event: dispatching it would hand the caller an empty payload.
    if (data.length === 0 && event === '') return;
    out.push({ event: event === '' ? 'message' : event, data: data.join('\n') });
    event = '';
    data = [];
  };

  const take = (raw: string, out: SseEvent[]): void => {
    if (raw === '') {
      dispatch(out);
      return;
    }
    if (raw.startsWith(':')) return; // a comment, and every keep-alive is one
    const colon = raw.indexOf(':');
    const field = colon === -1 ? raw : raw.slice(0, colon);
    let value = colon === -1 ? '' : raw.slice(colon + 1);
    // One optional space after the colon belongs to the syntax, not the value --
    // the JSON payloads this app reads are indented by exactly that one space.
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'event') event = value;
    else if (field === 'data') data.push(value);
  };

  return {
    feed(chunk) {
      const out: SseEvent[] = [];
      buffer += chunk;
      for (;;) {
        const at = buffer.indexOf('\n');
        if (at === -1) break;
        let line = buffer.slice(0, at);
        buffer = buffer.slice(at + 1);
        if (line.endsWith('\r')) line = line.slice(0, -1);
        take(line, out);
      }
      return out;
    },
    flush() {
      const out: SseEvent[] = [];
      if (buffer !== '') {
        const last = buffer.endsWith('\r') ? buffer.slice(0, -1) : buffer;
        buffer = '';
        take(last, out);
      }
      dispatch(out);
      return out;
    },
  };
}
