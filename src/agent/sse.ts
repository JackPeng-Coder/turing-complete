/**
 * 手写的服务器发送事件（server-sent events）解码器。
 *
 * 本项目只需要这一个协议，因此也只实现这一个。
 * text/event-stream 是一个只有四种字段的行协议；
 * 其余能力都属于「可重连的持续推送」——id、retry、Last-Event-ID
 * 是为了断线后能从流中间续传，而一次问答式的回复永远不需要续传。
 * 所以这个解码器只保留 event 与 data，忽略注释行（心跳保活就是注释），
 * 其余字段直接丢弃，而不是假装支持。
 *
 * 必须是增量的：流会按网络当时的高兴切成任意小块到达，
 * 一个 JSON 负载被拆进三次 feed 调用是常态而不是边界情况。
 * 缓冲区用字符串而不是字节数组，因为调用方会先用流式 TextDecoder 解码；
 * 若在这里处理字节，本文件就得自己管 UTF-8，
 * 而「一个多字节字符被拆在两个数据块里」是平台已经解决了的问题。
 */

/** 一个已派发的事件：带名字的负载；没有名字时默认是 message。 */
export interface SseEvent {
  readonly event: string;
  readonly data: string;
}

export interface SseDecoder {
  /** 消化 chunk 中已经完整的事件；尚未结束的半行留在缓冲区里。 */
  feed(chunk: string): SseEvent[];
  /**
   * 把流结束时剩下的内容补完。
   *
   * 没有以最后一个空行结尾的流虽然不合规，但确实存在；
   * 而一次回复的最后一个事件恰好携带结束原因——
   * 如果因为发送方漏了一个换行就把它丢掉，等于丢了答案。
   */
  flush(): SseEvent[];
}

/** 创建一个增量式解码器：feed 喂入文本块，flush 收尾。 */
export function createSseDecoder(): SseDecoder {
  let buffer = '';
  let event = '';
  let data: string[] = [];

  const dispatch = (out: SseEvent[]): void => {
    // 没有待派发内容的空行只是某条注释之后的隔行，不是事件：
    // 派发出去会给调用方一个空负载。
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
    if (raw.startsWith(':')) return; // 注释行；所有心跳保活都是这种
    const colon = raw.indexOf(':');
    const field = colon === -1 ? raw : raw.slice(0, colon);
    let value = colon === -1 ? '' : raw.slice(colon + 1);
    // 冒号后面的一个空格属于语法，不属于值——
    // 本应用要读的 JSON 负载恰好就是用一个空格缩进的。
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
