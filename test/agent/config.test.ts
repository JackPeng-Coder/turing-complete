import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AGENT_KEY,
  DEFAULT_MODEL,
  chatUrl,
  clearAgentConfig,
  emptyConfig,
  isConfigured,
  loadAgentConfig,
  normalizeConfig,
  saveAgentConfig,
} from '../../src/agent/config';

/** A `localStorage` that only exists while a test asks for one. */
function stubStorage(initial: Record<string, string> = {}): void {
  const store = new Map(Object.entries(initial));
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the chat endpoint a base URL means', () => {
  it('takes the bare host, the host with a version, and the whole endpoint', () => {
    expect(chatUrl('https://api.deepseek.com')).toBe('https://api.deepseek.com/chat/completions');
    expect(chatUrl('https://api.deepseek.com/v1')).toBe('https://api.deepseek.com/v1/chat/completions');
    expect(chatUrl('https://x.test/v1/chat/completions')).toBe('https://x.test/v1/chat/completions');
  });

  it('forgives trailing slashes and surrounding space', () => {
    expect(chatUrl('  https://x.test/v1/  ')).toBe('https://x.test/v1/chat/completions');
  });

  it('is empty for an empty field, so the caller can refuse before fetching', () => {
    expect(chatUrl('   ')).toBe('');
  });
});

describe('a configuration read back from storage', () => {
  it('accepts a well-formed payload', () => {
    expect(
      normalizeConfig({
        version: 1,
        baseUrl: 'https://x.test',
        apiKey: 'sk-1',
        model: 'm',
      }),
    ).toEqual({ baseUrl: 'https://x.test', apiKey: 'sk-1', model: 'm' });
  });

  it('ignores fields a previous build stored and this one no longer has', () => {
    // `stepMs` and `seen` were in the payload before the pace went away and the
    // first-run card did: a browser configured then must keep its settings.
    expect(
      normalizeConfig({
        version: 1,
        baseUrl: 'https://x.test',
        apiKey: 'sk-1',
        model: 'm',
        stepMs: 420,
        seen: true,
      }),
    ).toEqual({ baseUrl: 'https://x.test', apiKey: 'sk-1', model: 'm' });
  });

  it('refuses another version, a non-object, and a payload with no address or model', () => {
    expect(normalizeConfig({ version: 2, baseUrl: 'x', model: 'm' })).toBeNull();
    expect(normalizeConfig('nope')).toBeNull();
    expect(normalizeConfig([1, 2])).toBeNull();
    expect(normalizeConfig({ version: 1, model: 'm' })).toBeNull();
    expect(normalizeConfig({ version: 1, baseUrl: 'x' })).toBeNull();
  });
});

describe('what counts as set up', () => {
  it('needs all three fields', () => {
    expect(isConfigured(emptyConfig())).toBe(false);
    expect(isConfigured({ ...emptyConfig(), apiKey: 'sk-1' })).toBe(true);
    expect(isConfigured({ ...emptyConfig(), apiKey: '   ' })).toBe(false);
    expect(isConfigured(null)).toBe(false);
  });
});

describe('storing the settings', () => {
  it('round-trips through the store under its own key', () => {
    stubStorage();
    saveAgentConfig({ baseUrl: 'https://x.test', apiKey: 'sk-1', model: 'm' });
    expect(loadAgentConfig()).toEqual({ baseUrl: 'https://x.test', apiKey: 'sk-1', model: 'm' });
    expect(globalThis.localStorage.getItem(AGENT_KEY)).toContain('sk-1');
  });

  it('reads nothing as "not set up", and clears back to that', () => {
    stubStorage();
    expect(loadAgentConfig()).toBeNull();
    saveAgentConfig({ ...emptyConfig(), apiKey: 'sk-1' });
    clearAgentConfig();
    expect(loadAgentConfig()).toBeNull();
  });

  it('survives a corrupt payload and a hostile store', () => {
    stubStorage({ [AGENT_KEY]: '{not json' });
    expect(loadAgentConfig()).toBeNull();
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
      removeItem: () => {
        throw new Error('denied');
      },
    });
    expect(loadAgentConfig()).toBeNull();
    expect(() => saveAgentConfig(emptyConfig())).not.toThrow();
    expect(() => clearAgentConfig()).not.toThrow();
  });

  it('works with no store at all, which is the node test environment', () => {
    vi.stubGlobal('localStorage', undefined);
    expect(loadAgentConfig()).toBeNull();
    expect(() => saveAgentConfig(emptyConfig())).not.toThrow();
  });
});

describe('the default configuration', () => {
  it('names the project’s own model, with no key', () => {
    const config = emptyConfig();
    expect(DEFAULT_MODEL).toBe('deepseek-flash');
    expect(config.model).toBe('deepseek-flash');
    expect(config.baseUrl).toBe('https://api.deepseek.com');
    expect(config.apiKey).toBe('');
    expect(isConfigured(config)).toBe(false);
  });
});
