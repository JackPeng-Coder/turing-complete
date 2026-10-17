/**
 * The agent's own settings: where the model lives and what it is called.
 *
 * STORED UNDER ITS OWN KEY, exactly like the save and the sandbox circuit are.
 * `tc.progress.v1` is the player's campaign and `tc.sandbox.v1` is one circuit;
 * an API key is neither, and folding it into the save would mean exporting a
 * save file hands someone your key. A third key keeps that from being possible.
 *
 * THE KEY IS IN `localStorage`, IN PLAIN TEXT, AND THE SETTINGS PANEL SAYS SO.
 * There is nowhere else to put it: this app is a static bundle with no server,
 * which is the same reason there is no credential store to defer to. A key that
 * lives only in memory would be re-typed on every reload, which is not what
 * "首次启动时自定义 API 信息" asks for. The honest trade is stated on screen
 * rather than hidden here.
 *
 * NOTHING IN THIS FILE MAY THROW. `localStorage` is absent in the node test
 * environment and can refuse writes in a private window; an agent with no
 * settings saved is a normal state (the panel says so), not a crash.
 */

/** Where the settings live. Versioned like the other two keys. */
export const AGENT_KEY = 'tc.agent.v1';

/** What a fresh install offers: the API and the model this project is built around. */
export const DEFAULT_BASE_URL = 'https://api.deepseek.com';
export const DEFAULT_MODEL = 'deepseek-flash';

export interface AgentConfig {
  /** Where the API is, e.g. `https://api.deepseek.com`. */
  readonly baseUrl: string;
  /** The bearer token. Plain text, in `localStorage`, on purpose -- see the header. */
  readonly apiKey: string;
  /** The model name to ask for, e.g. `deepseek-flash`. */
  readonly model: string;
}

/** A blank configuration, as the setup panel opens on it. */
export function emptyConfig(): AgentConfig {
  return { baseUrl: DEFAULT_BASE_URL, apiKey: '', model: DEFAULT_MODEL };
}

/**
 * Whether this configuration is complete enough to send a request.
 *
 * A PURE PREDICATE, so the panel and the send button ask the same question and
 * cannot disagree about what "configured" means.
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
 * The endpoint a base URL means.
 *
 * People paste three different things into a field like this -- the host, the
 * host with `/v1`, or the whole endpoint copied out of a curl example -- and all
 * three should work rather than one being right and the others failing at
 * request time with a 404 that says nothing useful.
 */
export function chatUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '');
  if (trimmed === '') return '';
  if (/\/chat\/completions$/.test(trimmed)) return trimmed;
  return `${trimmed}/chat/completions`;
}

/**
 * Reads an untrusted payload back into a configuration, or `null` if unusable.
 *
 * AN OLDER PAYLOAD MAY CARRY FIELDS THIS BUILD NO LONGER HAS (`stepMs`, `seen`);
 * they are ignored rather than rejected, so a browser that configured the agent
 * before a change keeps its endpoint, key and model.
 */
export function normalizeConfig(raw: unknown): AgentConfig | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  if (record.version !== 1) return null;
  const baseUrl = typeof record.baseUrl === 'string' ? record.baseUrl : '';
  const apiKey = typeof record.apiKey === 'string' ? record.apiKey : '';
  const model = typeof record.model === 'string' ? record.model : '';
  if (baseUrl === '' || model === '') return null;
  return { baseUrl, apiKey, model };
}

/** Best-effort load; absent, corrupt or unreadable all read as "not set up yet". */
export function loadAgentConfig(): AgentConfig | null {
  try {
    const raw = globalThis.localStorage?.getItem(AGENT_KEY);
    if (!raw) return null;
    return normalizeConfig(JSON.parse(raw));
  } catch {
    return null;
  }
}

/** Best-effort save; without a store the settings live for this session only. */
export function saveAgentConfig(config: AgentConfig): void {
  try {
    globalThis.localStorage?.setItem(AGENT_KEY, JSON.stringify({ version: 1, ...config }));
  } catch {
    /* storage unavailable (private mode, tests): settings stay in memory */
  }
}

/** Forgets the stored settings, key included. */
export function clearAgentConfig(): void {
  try {
    globalThis.localStorage?.removeItem(AGENT_KEY);
  } catch {
    /* nothing to forget if there is no store */
  }
}
