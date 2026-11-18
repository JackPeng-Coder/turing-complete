/**
 * OpenAI 兼容 chat completion 的线上报文格式，全部手写。
 *
 * 为什么手写类型而不用客户端库：本项目不携带任何运行时依赖
 * （一旦出现，test/conventions.test.ts 会让构建失败），
 * 而一个 SDK 会把自带的传输层、重试策略和错误类型塞进一个
 * 只想用浏览器已有 fetch 说话的程序里。
 *
 * 这里只声明本应用会发送或读取的字段。真实的 schema 大得多——
 * logprobs、tool choice、response format、音频——而每声明一个字段，
 * 代码就必须对它保持诚实。缺的字段是有意缺席的：
 * 对方多返回的字段会落进「什么都不对应」里，这正是应该发生的事。
 *
 * 唯一真正承重的地方是流式工具调用：
 * 它的参数是一个被切成多块的 JSON 字符串（StreamToolCallDelta）。
 * 碎片如何拼回去，见 client.ts。
 */

/** 函数参数用的 JSON Schema 对象，只限本应用实际用到的部分。 */
export interface JsonSchema {
  readonly type: 'object';
  readonly properties: Readonly<Record<string, JsonSchemaProperty>>;
  readonly required?: readonly string[];
  /** 始终为 false：模型若编造参数，应该被明确告知，而不是被忽略。 */
  readonly additionalProperties?: false;
}

/** 一个参数属性的声明：类型、说明，以及可选的取值范围或元素类型。 */
export interface JsonSchemaProperty {
  readonly type: 'string' | 'number' | 'integer' | 'boolean' | 'array';
  readonly description: string;
  /** 存在时，只接受其中列出的值。 */
  readonly enum?: readonly string[];
  /** 仅用于 array，且元素只能是字符串：一串实例 id，不会是对象。 */
  readonly items?: { readonly type: 'string' };
}

/** 模型看到的一个工具：名字、说明、参数。仅此三项。 */
export interface WireTool {
  readonly type: 'function';
  readonly function: {
    readonly name: string;
    readonly description: string;
    readonly parameters: JsonSchema;
  };
}

/** 模型请求的一次工具调用：调用 id、函数名，以及原始 JSON 参数文本。 */
export interface WireToolCall {
  readonly id: string;
  readonly type: 'function';
  readonly function: { readonly name: string; readonly arguments: string };
}

/** 对话历史中的一条，按 API 期望的格式回传。 */
export interface WireMessage {
  readonly role: 'system' | 'user' | 'assistant' | 'tool';
  /** 只在调用工具的助手轮里为 null，与 API 返回的形状一致。 */
  readonly content: string | null;
  /** 出现在请求工具的助手轮上。 */
  readonly tool_calls?: readonly WireToolCall[];
  /** 在 tool 消息上：它回答的是哪一次调用。 */
  readonly tool_call_id?: string;
}

/** 一次 chat completion 请求的报文体。 */
export interface ChatRequest {
  readonly model: string;
  readonly messages: readonly WireMessage[];
  readonly tools?: readonly WireTool[];
  readonly stream: true;
  /**
   * 请求对方在最后一帧带上 token 计数。
   *
   * OpenAI 兼容的流式响应默认不返回 usage；不打开它，
   * 面板能测时间却一个 token 都测不到，
   * 在任何遵循该规范的服务商上，用量那一行都会是空白。
   */
  readonly stream_options?: { readonly include_usage: true };
}

/**
 * 服务商自己的用量口径，实际存在两种方言。
 *
 * OpenAI 把缓存数字放在 prompt_tokens_details.cached_tokens 里；
 * DeepSeek（以及若干兼容端点）把 prompt_cache_hit_tokens 与
 * prompt_cache_miss_tokens 放在顶层。两种都读，且都不强求：
 * 只报 prompt_tokens 的服务商仍然能给出总数。
 */
export interface WireUsage {
  readonly prompt_tokens?: number;
  readonly completion_tokens?: number;
  readonly total_tokens?: number;
  readonly prompt_cache_hit_tokens?: number;
  readonly prompt_cache_miss_tokens?: number;
  readonly prompt_tokens_details?: { readonly cached_tokens?: number };
  readonly completion_tokens_details?: { readonly reasoning_tokens?: number };
  /** 对方完全没有报计数（或负载是 null）时，本字段的取值。 */
  readonly [field: string]: unknown;
}

/** 流中的一帧：一个信封，所有字段都可选。 */
/** 服务端流式返回的一帧。 */
export interface StreamChunk {
  readonly choices?: readonly {
    readonly delta?: {
      readonly content?: string | null;
      /** 推理模型会发它；本程序有意忽略——它不是答案。 */
      readonly reasoning_content?: string | null;
      readonly tool_calls?: readonly StreamToolCallDelta[];
    };
    readonly finish_reason?: string | null;
  }[];
  /** 请求在流中途失败时，它取代 choices 出现。 */
  readonly error?: { readonly message?: string; readonly type?: string };
  /** token 用量，出现在 stream_options.include_usage 要求的那一帧。 */
  readonly usage?: WireUsage | null;
}

/** 流式工具调用的一块碎片：同一次调用的参数会逐块追加。 */
export interface StreamToolCallDelta {
  /** 这块碎片属于哪一次调用：流式传输期间唯一稳定的键。 */
  readonly index: number;
  readonly id?: string;
  readonly type?: string;
  readonly function?: { readonly name?: string; readonly arguments?: string };
}
