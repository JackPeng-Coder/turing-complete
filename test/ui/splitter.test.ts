// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { mountSplitter } from '../../src/ui/splitter';

/** A splitter wired to a mutable number, so a test can watch it move. */
function mounted(sign: 1 | -1 = 1) {
  const element = document.createElement('div');
  document.body.append(element);
  const changes: number[] = [];
  let commits = 0;
  let value = 100;
  mountSplitter(element, {
    axis: 'x',
    sign,
    value: () => value,
    min: () => 40,
    max: () => 200,
    onChange: (next) => {
      value = next;
      changes.push(next);
    },
    onCommit: () => {
      commits += 1;
    },
  });
  const press = (key: string, shiftKey = false): void => {
    element.dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey, bubbles: true }));
  };
  return { element, changes, press, commits: () => commits, value: () => value };
}

describe('a splitter', () => {
  it('is a focusable vertical separator between two docks', () => {
    const { element } = mounted();
    expect(element.getAttribute('role')).toBe('separator');
    expect(element.getAttribute('aria-orientation')).toBe('vertical');
    expect(element.tabIndex).toBe(0);
    expect(element.className).toContain('splitter-x');
  });

  it('nudges its pane with the arrow keys, and saves once per press', () => {
    const { changes, press, commits } = mounted();
    press('ArrowRight');
    expect(changes).toEqual([112]);
    press('ArrowLeft', true);
    expect(changes).toEqual([112, 64]);
    press('ArrowLeft');
    expect(changes).toEqual([112, 64, 52]);
    expect(commits()).toBe(3);
  });

  it('asks for the opposite direction when the pane grows to the left', () => {
    const { changes, press } = mounted(-1);
    press('ArrowRight');
    expect(changes).toEqual([88]);
    press('ArrowLeft');
    expect(changes).toEqual([88, 100]);
  });

  it('never goes past the limits it is given', () => {
    const { changes, press } = mounted();
    for (let i = 0; i < 20; i += 1) press('ArrowRight');
    expect(Math.max(...changes)).toBe(200);
    for (let i = 0; i < 40; i += 1) press('ArrowLeft');
    expect(Math.min(...changes)).toBe(40);
  });

  it('ignores keys that are not its arrows', () => {
    const { changes, press } = mounted();
    press('Enter');
    press('a');
    expect(changes).toEqual([]);
  });
});
