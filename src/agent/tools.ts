/**
 * 工具注册表：模型能够触碰这个应用的唯一通道。
 *
 * 一个工具就是「名字 + 说明 + 参数 schema + 函数」，整套协议只有这四样，
 * 而且刻意与 API 期望的四样一致，所以下面的 toolWire 只是改名而不是翻译。
 * 本文件在「裸调用」之上补的那部分，才决定一次运行能否扛住模型的坏回合：
 *
 *   - 参数先校验、后执行。API 承诺给出符合 schema 的 JSON，模型大多遵守，
 *     但「大多」不是契约：流式参数可能被截断，数字可能以字符串到达，
 *     还可能混进一个编造的键。每一种都用模型能照做的中文句子回答
 *     （例如「参数 x 应该是整数」），
 *     因为抛出异常会结束整次运行，而一句纠正的话能换来第二次尝试。
 *
 *   - 拒绝是一种结果，不是崩溃。ToolError 是唯一一种表示
 *     「我不做这件事，原因如下」的异常——未知引脚、不存在的元件、
 *     格式错误的导入。从工具里逃出来的其他异常都是本仓库的 bug，
 *     会按 bug 报告，免得模型把余下的预算都用来道歉。
 *
 *   - 这里不会把异步当成已完成。run 可以返回 Promise（测试运行和导入都是），
 *     runTool 会 await 它，调用方就不可能把「还在跑」误当成「已跑完」。
 */
import type { JsonSchema, WireTool } from './wire';

/** 一种模型应该读懂并作出回应的拒绝，用中文写。 */
export class ToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ToolError';
  }
}

/** 一份已通过校验的工具参数。 */
export type ToolArgs = Readonly<Record<string, unknown>>;

/** 一个工具被允许知道的、关于本次运行的一切。 */
export interface ToolContext {
  /** 玩家按下「停止」时会被中止；耗时的工具必须尊重它。 */
  readonly signal: AbortSignal;
}

/** 一个工具的完整声明：给模型看的三个字段，加一个执行函数。 */
export interface ToolSpec {
  readonly name: string;
  readonly description: string;
  readonly parameters: JsonSchema;
  /** 执行这个工具；可以是异步的，runTool 会 await 它。 */
  run(args: ToolArgs, context: ToolContext): unknown | Promise<unknown>;
  /**
   * 给玩家看的一行话，依据是模型马上就要当成 JSON 去读的结果。
   *
   * 两个受众并不相同。模型需要 {"id":"i1","x":160}——
   * 它下一步得叫出这个元件的名字；而旁观的人需要
   * 「在 (160,160) 放了与非门（i1）」。
   * 把 JSON 直接渲染给玩家，会让一个能用的面板读起来像调试控制台；
   * 而把散文给模型，它就只能猜。所以结果保持 JSON，
   * 这个函数（如果工具提供了）负责用一句话说同一件事。
   */
  present?(result: unknown, args: ToolArgs): string | undefined;
}

/** 回到模型手里的东西：JSON 文本，无论成功还是拒绝。 */
export interface ToolOutcome {
  /** 这次调用是成功还是被拒绝。 */
  readonly ok: boolean;
  /** 回到模型手里的 JSON 文本。 */
  readonly text: string;
  /** 同一结果的单行中文，前提是工具知道该怎么说。 */
  readonly note: string;
}

/** 工具在 API 眼里的样子；说明用的就是同一份 schema。 */
export function toolWire(specs: readonly ToolSpec[]): WireTool[] {
  return specs.map((spec) => ({
    type: 'function',
    function: { name: spec.name, description: spec.description, parameters: spec.parameters },
  }));
}

/** 按名字找工具；没有就返回 null，调用方据此回一句「没有这个工具」。 */
export function findTool(specs: readonly ToolSpec[], name: string): ToolSpec | null {
  return specs.find((spec) => spec.name === name) ?? null;
}

/** 所有工具名连成一句，用于告诉模型它可以调用哪些工具。 */
export function toolNames(specs: readonly ToolSpec[]): string {
  return specs.map((spec) => spec.name).join('、');
}

/** 按声明逐项校验一个参数，返回第一条中文错误；没问题时返回 null。 */
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

/** 参数校验的结果：要么是已检查的参数，要么是一句给模型的纠正。 */
export type ArgCheck = { readonly ok: true; readonly args: ToolArgs } | { readonly ok: false; readonly error: string };

/**
 * 把原始参数字符串变成「已检查的参数」，或者变成一句纠正。
 *
 * 字符串就是模型实际发来的内容（碎片已经拼好），在这里解析而不是在传输层，
 * 原因只有一个：只有这一层知道参数本来应该是什么样，
 * 所以也只有这一层能说清它错在哪里。
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

/** 把任意异常值变成一句可读的说明。 */
function describe(cause: unknown): string {
  if (cause instanceof Error) return cause.message;
  return String(cause);
}

/**
 * 先校验参数，再运行工具，最后把发生的一切都写成 JSON 报告。
 *
 * 结果永远是 JSON，而且永远带 ok。
 * 模型读工具结果时没有别的办法区分「引脚不存在」和「导线已连上」：
 * 两者都只是文本；如果一次运行分不清，它就会在一个从未发生过的步骤上继续施工。
 */
export async function runTool(
  spec: ToolSpec,
  rawArguments: string,
  context: ToolContext,
): Promise<ToolOutcome> {
  const checked = checkArguments(spec, rawArguments);
  if (!checked.ok) {
    return {
      ok: false,
      text: JSON.stringify({ ok: false, error: checked.error }),
      note: checked.error,
    };
  }
  try {
    const result = await spec.run(checked.args, context);
    const value = result === undefined ? {} : result;
    let note = '';
    if (spec.present !== undefined) {
      try {
        note = spec.present(value, checked.args) ?? '';
      } catch {
        // 展示函数的 bug 绝不能让它所描述的那一步失败：
        // 电路已经改了，日志退回原始结果即可。
        note = '';
      }
    }
    return { ok: true, text: JSON.stringify({ ok: true, result: value }), note };
  } catch (cause) {
    if (cause instanceof ToolError) {
      return { ok: false, text: JSON.stringify({ ok: false, error: cause.message }), note: cause.message };
    }
    return {
      ok: false,
      text: JSON.stringify({ ok: false, error: `工具 ${spec.name} 内部出错：${describe(cause)}` }),
      note: `工具 ${spec.name} 内部出错：${describe(cause)}`,
    };
  }
}

/** 取一个字符串参数（已校验）；这里的类型断言由校验本身保证。 */
export function stringArg(args: ToolArgs, key: string): string {
  return args[key] as string;
}

/** 取一个数字参数（已校验）。 */
export function numberArg(args: ToolArgs, key: string): number {
  return args[key] as number;
}

/** 取一个字符串数组参数（已校验）。 */
export function stringArrayArg(args: ToolArgs, key: string): string[] {
  return args[key] as string[];
}

/** 取一个可选的字符串参数；不存在或类型不对都返回 undefined。 */
export function optionalString(args: ToolArgs, key: string): string | undefined {
  const value = args[key];
  return typeof value === 'string' ? value : undefined;
}
