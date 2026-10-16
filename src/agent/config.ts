/**
 * The agent's own settings: where the model lives, and how fast it is allowed to
 * draw.
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
 * settings saved is a normal state (the setup panel opens), not a crash.
 */

/** Where the settings live. Versioned like the other two keys. */
export const AGENT_KEY = 'tc.agent.v1';

/** What a fresh install offers: the API this project's own tests were run against. */
export const DEFAULT_BASE_URL = 'https://api.deepseek.com';
export const DEFAULT_MODEL = 'deepseek-chat';

/**
 * How long the board holds each step of the agent's work, in milliseconds.
 *
 * A5 asks for the construction to be WATCHED, so the default is slow enough to
 * follow and short enough not to feel broken. Zero is offered because a player
 * who has seen it once wants the answer, not the animation.
 */
export const DEFAULT_STEP_MS = 160;

/** The paces the settings panel offers, in milliseconds between two commands. */
export const STEP_CHOICES: readonly { label: string; ms: number }[] = [
  { label: '快', ms: 0 },
  { label: '常速', ms: DEFAULT_STEP_MS },
  { label: '慢', ms: 420 },
];

export interface AgentConfig {
  /** Where the API is, e.g. `https://api.deepseek.com`. */
  readonly baseUrl: string;
  /** The bearer token. Plain text, in `localStorage`, on purpose -- see the header. */
  readonly apiKey: string;
  /** The model name to ask for, e.g. `deepseek-chat`. */
  readonly model: string;
  /** Milliseconds between two commands while the agent builds. */
  readonly stepMs: number;
}

/** A blank configuration, as the setup panel opens on it. */
export function emptyConfig(): AgentConfig {
  return { baseUrl: DEFAULT_BASE_URL, apiKey: '', model: DEFAULT_MODEL, stepMs: DEFAULT_STEP_MS };
}

/**
 * Whether this configuration is complete enough to send a request.
 *
 * A PURE PREDICATE, so the setup panel and the send button ask the same question
 * and cannot disagree about what "configured" means.
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

/** Reads an untrusted payload back into a configuration, or `null` if unusable. */
export function normalizeConfig(raw: unknown): AgentConfig | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  if (record.version !== 1) return null;
  const baseUrl = typeof record.baseUrl === 'string' ? record.baseUrl : '';
  const apiKey = typeof record.apiKey === 'string' ? record.apiKey : '';
  const model = typeof record.model === 'string' ? record.model : '';
  if (baseUrl === '' || model === '') return null;
  const stepMs =
    typeof record.stepMs === 'number' && Number.isFinite(record.stepMs) && record.stepMs >= 0
      ? record.stepMs
      : DEFAULT_STEP_MS;
  return { baseUrl, apiKey, model, stepMs };
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
    // `seen` rides along: saving the settings is an answer to the first-run card,
    // so it must not be asked again on the next reload.
    globalThis.localStorage?.setItem(AGENT_KEY, JSON.stringify({ version: 1, seen: true, ...config }));
  } catch {
    /* storage unavailable (private mode, tests): settings stay in memory */
  }
}

/**
 * Whether the first-run card has already been answered.
 *
 * IN THE SAME PAYLOAD as the settings, because the two are one story: "we asked,
 * and this is what came of it". A player who pressed 以后再说 is not asked again
 * on the next reload -- being asked the same question every launch is how a
 * feature becomes an obstacle -- while a browser that has never seen the card
 * still gets it.
 */
export function setupSeen(): boolean {
  try {
    const raw = globalThis.localStorage?.getItem(AGENT_KEY);
    if (!raw) return false;
    return (JSON.parse(raw) as { seen?: unknown }).seen === true;
  } catch {
    return false;
  }
}

/** Records that the first-run card has been answered, keeping any settings. */
export function markSetupSeen(): void {
  try {
    const raw = globalThis.localStorage?.getItem(AGENT_KEY);
    let payload: Record<string, unknown> = { version: 1 };
    if (raw) {
      try {
        const parsed: unknown = JSON.parse(raw);
        if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
          payload = parsed as Record<string, unknown>;
        }
      } catch {
        // A corrupt payload is replaced rather than appended to.
      }
    }
    payload.version = 1;
    payload.seen = true;
    globalThis.localStorage?.setItem(AGENT_KEY, JSON.stringify(payload));
  } catch {
    /* nothing to remember if there is no store */
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
