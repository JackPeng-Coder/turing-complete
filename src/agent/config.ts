/**
 * 智能体自身的设置：模型接口在哪里、用哪个模型名。
 *
 * 用一个单独的 localStorage 键保存，和进度、沙盒电路分开。
 * tc.progress.v1 是玩家的战役进度，tc.sandbox.v1 是一块电路；
 * API key 两者都不是——如果混进存档，玩家把存档发给别人，就等于把 key 也发出去了。
 * 因此这里用第三个键，从结构上避免这件事发生。
 *
 * key 以明文放在 localStorage 里，设置面板上也如实写明。
 * 没有别的地方可放：本应用是一个纯静态包、没有自己的服务器，
 * 也就没有可托付的凭据存储。只放内存的话每次刷新都要重新输入，
 * 这不满足「首次启动时自定义 API 信息」的要求；
 * 与其把权衡藏起来，不如在界面上讲清楚。
 *
 * 本文件里的函数一律不抛异常。
 * node 测试环境没有 localStorage，隐私模式也可能拒绝写入；
 * 「还没配置」是一种正常状态（面板会提示），不是崩溃。
 */

/** 设置保存的位置。与另外两个键一样带版本号。 */
export const AGENT_KEY = 'tc.agent.v1';

/** 全新安装时的默认值：本项目开发时使用的接口地址与模型。 */
export const DEFAULT_BASE_URL = 'https://api.deepseek.com';
export const DEFAULT_MODEL = 'deepseek-flash';

/**
 * 一次请求里最多调用几次模型；用完就以 'capped' 结束本次运行。
 *
 * 这是预算，不是能力上限。本游戏一关只有几个门，
 * 十六轮还没做完，通常说明这次请求被误解了；
 * 玩家按一个按钮就能继续，也可以在设置里调大预算。
 * 0 表示「不设上限」——沙盒里确实可能需要摆四十个元件，那是合理需求。
 */
export const DEFAULT_MAX_STEPS = 16;

/** 智能体的完整设置：接口地址、key、模型名与步数预算。 */
export interface AgentConfig {
  /** API 地址，例如 https://api.deepseek.com。 */
  readonly baseUrl: string;
  /** Bearer token。明文存在 localStorage 里，原因见文件头。 */
  readonly apiKey: string;
  /** 请求的模型名，例如 deepseek-flash。 */
  readonly model: string;
  /** 一次请求最多调用几次模型；0 表示不设上限，见 DEFAULT_MAX_STEPS。 */
  readonly maxSteps: number;
}

/** 空白配置：设置面板刚打开时看到的就是它。 */
export function emptyConfig(): AgentConfig {
  return {
    baseUrl: DEFAULT_BASE_URL,
    apiKey: '',
    model: DEFAULT_MODEL,
    maxSteps: DEFAULT_MAX_STEPS,
  };
}

/**
 * 这份配置是否完整到足以发一次请求。
 *
 * 写成纯谓词，是为了让设置面板和发送按钮问同一个问题，
 * 不会出现「面板说能发、按钮说不能」的分歧。
 */
export function isConfigured(config: AgentConfig | null): config is AgentConfig {
  return (
    config !== null &&
    config.baseUrl.trim() !== '' &&
    config.apiKey.trim() !== '' &&
    config.model.trim() !== ''
  );
}

/**
 * 由一个 base URL 推出实际请求的端点。
 *
 * 用户往这种输入框里贴的东西通常有三种：主机名、主机名加 /v1、
 * 或者从 curl 例子里整段复制的端点。三种都应该能用，
 * 而不是只有一种「正确」、其余在请求时收到一个说不清问题的 404。
 */
export function chatUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '');
  if (trimmed === '') return '';
  if (/\/chat\/completions$/.test(trimmed)) return trimmed;
  return `${trimmed}/chat/completions`;
}

/**
 * 把不可信的存档数据读回配置；无法使用时返回 null。
 *
 * 旧版本的存档可能带着本版本已经删除的字段（stepMs、seen）：
 * 这里选择忽略它们而不是整份拒绝，
 * 这样在改版前配置过智能体的浏览器仍能保留它的地址、key 和模型。
 */
export function normalizeConfig(raw: unknown): AgentConfig | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  if (record.version !== 1) return null;
  const baseUrl = typeof record.baseUrl === 'string' ? record.baseUrl : '';
  const apiKey = typeof record.apiKey === 'string' ? record.apiKey : '';
  const model = typeof record.model === 'string' ? record.model : '';
  if (baseUrl === '' || model === '') return null;
  const maxSteps =
    typeof record.maxSteps === 'number' && Number.isInteger(record.maxSteps) && record.maxSteps >= 0
      ? record.maxSteps
      : DEFAULT_MAX_STEPS;
  return { baseUrl, apiKey, model, maxSteps };
}

/** 尽力读取；不存在、损坏、读不了都等同于「还没配置」。 */
export function loadAgentConfig(): AgentConfig | null {
  try {
    const raw = globalThis.localStorage?.getItem(AGENT_KEY);
    if (!raw) return null;
    return normalizeConfig(JSON.parse(raw));
  } catch {
    return null;
  }
}

/** 尽力保存；没有可用存储时，设置只活在本会话里。 */
export function saveAgentConfig(config: AgentConfig): void {
  try {
    globalThis.localStorage?.setItem(AGENT_KEY, JSON.stringify({ version: 1, ...config }));
  } catch {
    /* 没有可用存储（隐私模式、测试环境）：设置只保留在内存里 */
  }
}

/** 忘掉已保存的设置，key 也一起忘掉。 */
export function clearAgentConfig(): void {
  try {
    globalThis.localStorage?.removeItem(AGENT_KEY);
  } catch {
    /* 本来就没有存储，也就没什么可忘的 */
  }
}
