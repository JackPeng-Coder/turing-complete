/**
 * The wire format of an OpenAI-compatible chat completion, written out by hand.
 *
 * WHY HAND-WRITTEN TYPES AND NOT A CLIENT LIBRARY. This project ships no runtime
 * dependency at all (`test/conventions.test.ts` fails the build if one appears),
 * and an SDK would bring its own transport, retry policy and error type into a
 * program whose whole job is to talk to a `fetch` the browser already has.
 *
 * ONLY THE FIELDS THIS APP SENDS OR READS ARE HERE. The real schema is far
 * larger -- logprobs, tool choice, response formats, audio -- and every field
 * declared is a field the code has to be kept honest about. What is missing is
 * missing on purpose: a provider that returns extra fields returns them into
 * nothing, which is exactly what should happen.
 *
 * The one place the shapes are load-bearing is the STREAMING TOOL CALL, whose
 * arguments arrive as a string split across chunks (`StreamToolCallDelta`). See
 * `client.ts` for how the fragments are put back together.
 */

/** A function's arguments as a JSON Schema object, restricted to what is used. */
export interface JsonSchema {
  readonly type: 'object';
  readonly properties: Readonly<Record<string, JsonSchemaProperty>>;
  readonly required?: readonly string[];
  /** Always `false`: a model that invents an argument should be told, not ignored. */
  readonly additionalProperties?: false;
}

export interface JsonSchemaProperty {
  readonly type: 'string' | 'number' | 'integer' | 'boolean' | 'array';
  readonly description: string;
  /** When present, the only values accepted. */
  readonly enum?: readonly string[];
  /** For `array` only, and only strings: a list of instance ids, never objects. */
  readonly items?: { readonly type: 'string' };
}

/** A tool as the model sees it: name, description, parameters. Nothing else. */
export interface WireTool {
  readonly type: 'function';
  readonly function: {
    readonly name: string;
    readonly description: string;
    readonly parameters: JsonSchema;
  };
}

export interface WireToolCall {
  readonly id: string;
  readonly type: 'function';
  readonly function: { readonly name: string; readonly arguments: string };
}

/** One entry of the conversation, in the shape the API expects it back. */
export interface WireMessage {
  readonly role: 'system' | 'user' | 'assistant' | 'tool';
  /** `null` on an assistant turn that only called tools, as the API returns it. */
  readonly content: string | null;
  /** On an assistant turn that asked for tools. */
  readonly tool_calls?: readonly WireToolCall[];
  /** On a `tool` message: which call it answers. */
  readonly tool_call_id?: string;
}

export interface ChatRequest {
  readonly model: string;
  readonly messages: readonly WireMessage[];
  readonly tools?: readonly WireTool[];
  readonly stream: true;
  /**
   * Ask the provider for a final frame carrying the token counts.
   *
   * OpenAI-compatible streaming omits `usage` unless this is set; without it the
   * panel can measure time but not a single token, and the usage line would be
   * blank on every provider that follows the spec.
   */
  readonly stream_options?: { readonly include_usage: true };
}

/**
 * The provider's own accounting, in the two dialects that exist in the wild.
 *
 * OpenAI nests the cache figure under `prompt_tokens_details.cached_tokens`;
 * DeepSeek (and several compatible endpoints) put `prompt_cache_hit_tokens` and
 * `prompt_cache_miss_tokens` at the top level. Both are read, neither is
 * required: a provider that reports only `prompt_tokens` still gives a total.
 */
export interface WireUsage {
  readonly prompt_tokens?: number;
  readonly completion_tokens?: number;
  readonly total_tokens?: number;
  readonly prompt_cache_hit_tokens?: number;
  readonly prompt_cache_miss_tokens?: number;
  readonly prompt_tokens_details?: { readonly cached_tokens?: number };
  readonly completion_tokens_details?: { readonly reasoning_tokens?: number };
  /** A provider that omits the counts entirely (or a `null` payload). */
  readonly [field: string]: unknown;
}

/** One frame of the stream: the envelope, with everything optional. */
export interface StreamChunk {
  readonly choices?: readonly {
    readonly delta?: {
      readonly content?: string | null;
      /** Sent by reasoning models; deliberately ignored -- it is not the answer. */
      readonly reasoning_content?: string | null;
      readonly tool_calls?: readonly StreamToolCallDelta[];
    };
    readonly finish_reason?: string | null;
  }[];
  /** Present instead of `choices` when the request failed mid-stream. */
  readonly error?: { readonly message?: string; readonly type?: string };
  /** Token accounting, on the frame `stream_options.include_usage` asked for. */
  readonly usage?: WireUsage | null;
}

export interface StreamToolCallDelta {
  /** Which call this fragment belongs to: the only stable key while streaming. */
  readonly index: number;
  readonly id?: string;
  readonly type?: string;
  readonly function?: { readonly name?: string; readonly arguments?: string };
}
