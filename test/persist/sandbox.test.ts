import { beforeEach, describe, expect, it, vi } from 'vitest';
import { addInstance, connect } from '../../src/core/graph';
import { circuitSignature, emptySandbox, loadSandbox, saveSandbox, SANDBOX_KEY } from '../../src/persist/sandbox';

/**
 * The sandbox circuit between sessions.
 *
 * NOTHING HERE MAY THROW, which is most of what these tests are about: storage
 * can be absent (the unit tests), refused (a private window) or corrupt (a
 * half-written entry), and the answer to all three is an empty board rather than a
 * screen that will not open.
 */
function sample() {
  const graph = emptySandbox();
  const rail = addInstance(graph, 'const_on', 0, 0);
  const gate = addInstance(graph, 'nand', 160, 0);
  connect(graph, { inst: rail.id, port: 'out' }, { inst: gate.id, port: 'a' });
  return graph;
}

/** A `localStorage` stand-in, since node has none. */
function fakeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key: string) => map.get(key) ?? null,
    key: (index: number) => [...map.keys()][index] ?? null,
    removeItem: (key: string) => void map.delete(key),
    setItem: (key: string, value: string) => void map.set(key, value),
  };
}

describe('the sandbox circuit', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it('round trips a circuit through storage', () => {
    vi.stubGlobal('localStorage', fakeStorage());
    const graph = sample();
    saveSandbox(graph);
    const back = loadSandbox();
    expect(back).not.toBeNull();
    expect(circuitSignature(back!)).toBe(circuitSignature(graph));
    // A COPY, not the live document: the store keeps mutating the graph it has,
    // and a load that aliased the writer's objects would be a second editor.
    expect(back).not.toBe(graph);
    expect(back!.instances[0]).not.toBe(graph.instances[0]);
  });

  it('reads a missing key as an empty board', () => {
    vi.stubGlobal('localStorage', fakeStorage());
    expect(loadSandbox()).toBeNull();
  });

  it('reads a corrupt entry as an empty board', () => {
    const storage = fakeStorage();
    vi.stubGlobal('localStorage', storage);
    for (const payload of ['{', 'null', '[]', '{"version":2,"graph":{}}', '{"version":1,"graph":{"instances":1}}']) {
      storage.setItem(SANDBOX_KEY, payload);
      expect(loadSandbox(), `payload ${payload}`).toBeNull();
      // The key is left alone: a later save overwrites it, and clearing it here
      // would be this reader deciding the player's data is gone.
      expect(storage.getItem(SANDBOX_KEY)).toBe(payload);
    }
  });

  it('does not throw when storage is unavailable or refuses writes', () => {
    // No `localStorage` at all is the unit-test case, and a full or refused store
    // is the private-window one. Both have the same answer: keep the circuit in
    // memory and carry on.
    expect(() => saveSandbox(sample())).not.toThrow();
    expect(loadSandbox()).toBeNull();

    vi.stubGlobal('localStorage', {
      ...fakeStorage(),
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
      getItem: () => {
        throw new Error('SecurityError');
      },
    });
    expect(() => saveSandbox(sample())).not.toThrow();
    expect(loadSandbox()).toBeNull();
  });

  it('changes its signature when the circuit changes', () => {
    // The signature is what keeps a pan (a store change) from writing storage.
    const graph = sample();
    const before = circuitSignature(graph);
    expect(circuitSignature(graph)).toBe(before);
    addInstance(graph, 'not', 320, 0);
    expect(circuitSignature(graph)).not.toBe(before);
  });

  it('gives an empty board the sandbox level id', () => {
    expect(emptySandbox().level).toBe('sandbox');
    expect(emptySandbox().instances).toEqual([]);
  });
});
