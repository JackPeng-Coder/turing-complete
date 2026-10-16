/**
 * The tool registry: the only way the model is allowed to touch the app.
 *
 * A TOOL IS A NAME, A DESCRIPTION, A PARAMETER SCHEMA AND A FUNCTION. That is the
 * whole protocol, and it is deliberately the same four things the API expects,
 * so `toolWire` below is a rename rather than a translation. What this file adds
 * on top of the raw call is the part that decides whether a run survives a bad
 * model turn:
 *
 *   - ARGUMENTS ARE VALIDATED BEFORE THE FUNCTION RUNS. The API promises
 *     schema-shaped JSON, and models mostly keep that promise, but "mostly" is
 *     not a contract: a streamed argument can arrive truncated, a number can
 *     arrive as a string, and a hallucinated key can slip in. Every one of those
 *     is answered with a sentence the MODEL can act on ("参数 x 应该是整数"),
 *     because a thrown exception ends the run where a correcting message gets a
 *     second attempt.
 *
 *   - A REFUSAL IS A RESULT, NOT A CRASH. `ToolError` is the one exception type
 *     that means "I will not do that, and here is why" -- an unknown pin, a part
 *     that does not exist, an import that was malformed. Anything else escaping a
 *     tool is a bug in this repository, and it is reported as one so the model
 *     does not spend the rest of the run apologising for it.
 *
 *   - NOTHING HERE IS ASYNCHRONOUS-BLIND. `run` may return a promise (the test
 *     run and the import both do), and `runTool` awaits it, so a caller cannot
 *     accidentally treat a pending step as a finished one.
 */
import type { JsonSchema, WireTool } from './wire';

/** A refusal the model should read and respond to, in Chinese. */
export class ToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ToolError';
  }
}

export type ToolArgs = Readonly<Record<string, unknown>>;

/** Everything a tool is allowed to know about the run it is part of. */
export interface ToolContext {
  /** Aborted when the player presses 停止; a long tool must honour it. */
  readonly signal: AbortSignal;
}

export interface ToolSpec {
  readonly name: string;
  readonly description: string;
  readonly parameters: JsonSchema;
  run(args: ToolArgs, context: ToolContext): unknown | Promise<unknown>;
}

/** What goes back to the model: JSON text, always, success or refusal. */
export interface ToolOutcome {
  readonly ok: boolean;
  readonly text: string;
}

/** The tools as the API wants to see them; the description schema is the same one. */
export function toolWire(specs: readonly ToolSpec[]): WireTool[] {
  return specs.map((spec) => ({
    type: 'function',
    function: { name: spec.name, description: spec.description, parameters: spec.parameters },
  }));
}

export function findTool(specs: readonly ToolSpec[], name: string): ToolSpec | null {
  return specs.find((spec) => spec.name === name) ?? null;
}

/** The tools' names, for a message that tells the model what it may call. */
export function toolNames(specs: readonly ToolSpec[]): string {
  return specs.map((spec) => spec.name).join('、');
}

function checkProperty(
  key: string,
  value: unknown,
  property: JsonSchema['properties'][string],
): string | null {
  switch (property.type) {
    case 'string':
      if (typeof value === 'string') {
        return property.enum && !property.enum.includes(value)
          ? `参数 ${key} 只能是：${property.enum.join('、')}`
          : null;
      }
      return `参数 ${key} 应该是字符串`;
    case 'boolean':
      return typeof value === 'boolean' ? null : `参数 ${key} 应该是 true 或 false`;
    case 'integer':
      if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value)) {
        return `参数 ${key} 应该是整数`;
      }
      return null;
    case 'array':
      return Array.isArray(value) && value.every((item) => typeof item === 'string')
        ? null
        : `参数 ${key} 应该是字符串数组`;
    default:
      if (typeof value !== 'number' || !Number.isFinite(value)) return `参数 ${key} 应该是数字`;
      return null;
  }
}

export type ArgCheck = { readonly ok: true; readonly args: ToolArgs } | { readonly ok: false; readonly error: string };

/**
 * Turns the raw argument string into checked arguments, or into a correction.
 *
 * The string is what the model actually sent, fragments already joined, and it is
 * parsed here rather than in the transport for one reason: only this layer knows
 * what the arguments were supposed to be, so only this layer can say what is
 * wrong with them.
 */
export function checkArguments(spec: ToolSpec, raw: string): ArgCheck {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw === '' ? '{}' : raw);
  } catch {
    return { ok: false, error: `参数不是合法 JSON，请重新调用 ${spec.name}` };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, error: `${spec.name} 的参数应该是一个对象` };
  }
  const record = parsed as Record<string, unknown>;
  for (const key of spec.parameters.required ?? []) {
    if (!(key in record)) return { ok: false, error: `${spec.name} 缺少必需的参数 ${key}` };
  }
  for (const [key, value] of Object.entries(record)) {
    const property = spec.parameters.properties[key];
    if (!property) {
      const known = Object.keys(spec.parameters.properties).join('、');
      return { ok: false, error: `${spec.name} 不认识参数 ${key}；可用的参数是：${known}` };
    }
    const problem = checkProperty(key, value, property);
    if (problem !== null) return { ok: false, error: problem };
  }
  return { ok: true, args: record };
}

function describe(cause: unknown): string {
  if (cause instanceof Error) return cause.message;
  return String(cause);
}

/**
 * Checks the arguments, runs the tool, and reports whatever happened as JSON.
 *
 * THE RESULT IS ALWAYS JSON, AND ALWAYS HAS `ok`. A model reading a tool result
 * has no other way to tell "the pin does not exist" from "the wire was added":
 * both are just text, and a run that cannot tell them apart keeps building on a
 * step that never happened.
 */
export async function runTool(
  spec: ToolSpec,
  rawArguments: string,
  context: ToolContext,
): Promise<ToolOutcome> {
  const checked = checkArguments(spec, rawArguments);
  if (!checked.ok) return { ok: false, text: JSON.stringify({ ok: false, error: checked.error }) };
  try {
    const result = await spec.run(checked.args, context);
    const value = result === undefined ? {} : result;
    return { ok: true, text: JSON.stringify({ ok: true, result: value }) };
  } catch (cause) {
    if (cause instanceof ToolError) {
      return { ok: false, text: JSON.stringify({ ok: false, error: cause.message }) };
    }
    return {
      ok: false,
      text: JSON.stringify({ ok: false, error: `工具 ${spec.name} 内部出错：${describe(cause)}` }),
    };
  }
}

/** A string argument, already checked; the cast is the check's own guarantee. */
export function stringArg(args: ToolArgs, key: string): string {
  return args[key] as string;
}

export function numberArg(args: ToolArgs, key: string): number {
  return args[key] as number;
}

export function stringArrayArg(args: ToolArgs, key: string): string[] {
  return args[key] as string[];
}

export function optionalString(args: ToolArgs, key: string): string | undefined {
  const value = args[key];
  return typeof value === 'string' ? value : undefined;
}
