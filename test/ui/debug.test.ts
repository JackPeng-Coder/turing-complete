// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { mountDebug, type DebugOptions } from '../../src/ui/debug';
import { THEME } from '../../src/ui/theme';

/**
 * The debug view: the registers, the counter and a window onto the program RAM.
 *
 * WHAT IT IS FOR. A stepped program's whole state lives where no pin can show it
 * -- `regfile6` keeps six bytes behind two read ports, `pc8` one address,
 * `ram_prog` 256 bytes that no output publishes in full -- so this panel is the
 * only place a player can see what the machine is holding. It reads through
 * `DebugOptions`, which `main.ts` answers from `ProgramRun` (the kernel's
 * `Simulation.readState`), so every test here hands the panel a value and checks
 * what a player would read.
 *
 * THE RAM WINDOW IS A PAGE, NOT 256 ROWS. `ram_prog` is 256 bytes and a page is 8
 * rows of 8; the window follows the counter to whichever page it is on, and the
 * byte the counter points at is marked. Anything else is either a wall of numbers
 * or a view that stops telling you where the program IS.
 */
describe('debug panel', () => {
  /** A byte per address, distinct enough that a row proves which addresses it shows. */
  const image = (): number[] => Array.from({ length: 256 }, (_, addr) => (addr * 7 + 1) & 0xff);

  function mount(overrides: Partial<DebugOptions> = {}): {
    root: HTMLElement;
    render(): void;
  } {
    const root = document.createElement('div');
    const panel = mountDebug(root, {
      registers: () => null,
      pc: () => null,
      ram: () => null,
      halt: () => null,
      ticks: () => 0,
      ...overrides,
    });
    return { root, render: panel.render };
  }

  /** Every register row as a player reads it. */
  const rows = (root: HTMLElement): string[] =>
    [...root.querySelectorAll('.debug-reg')].map((row) => row.textContent ?? '');

  /** One RAM row's eight bytes, as two-digit hex. */
  const bytes = (row: Element): string[] =>
    [...row.querySelectorAll('.debug-byte')].map((cell) => cell.textContent ?? '');

  it('reads every register in hex and in decimal', () => {
    // Both, because both are read: a program's byte is easier to check in hex and
    // easier to reason about in decimal, and a panel that picked one would make
    // the other a mental conversion on every line.
    const { root } = mount({ registers: () => [0, 0x2a, 0, 0, 0, 0] });
    expect(rows(root)).toHaveLength(6);
    expect(rows(root)[0]).toContain('REG0');
    expect(rows(root)[0]).toContain('0x00');
    expect(rows(root)[1]).toContain('REG1');
    expect(rows(root)[1]).toContain('0x2A');
    expect(rows(root)[1]).toContain('42');
    expect(rows(root)[5]).toContain('REG5');
  });

  it('reads the counter, in the same two forms', () => {
    const { root } = mount({ pc: () => 0x1f });
    const pc = root.querySelector('.debug-pc');
    expect(pc?.textContent).toContain('PC');
    expect(pc?.textContent).toContain('0x1F');
    expect(pc?.textContent).toContain('31');
  });

  /**
   * A HALTED COUNTER HAS TO LOOK HALTED. Writing `out` freezes the counter by
   * design (chapter 3's halt line holds it so the answer stays published), and a
   * player stepping a program that has stopped moving needs to be told that the
   * machine is not stuck but finished. `null` is the third answer: this board has
   * no halt part at all, so the panel claims nothing.
   */
  it('says whether the counter is halted, running, or neither', () => {
    const halted = mount({ halt: () => true });
    const flag = halted.root.querySelector('.debug-halt') as HTMLElement;
    expect(flag.textContent).toBe('停机');
    // The instrument's own colour, not the board's: a state is not a value, and
    // green here would read as "the halt pin is carrying 1".
    expect(flag.style.color).toBe(rgbOf(THEME.title));

    const running = mount({ halt: () => false });
    expect(running.root.querySelector('.debug-halt')?.textContent).toBe('运行');
    expect((running.root.querySelector('.debug-halt') as HTMLElement).style.color).toBe(
      rgbOf(THEME.textMuted),
    );

    const { root } = mount({ halt: () => null });
    expect(root.querySelector('.debug-halt')?.textContent).toBe('—');
  });

  it('shows one page of the program RAM, not all 256 bytes', () => {
    const { root } = mount({ ram: image, pc: () => 0x00 });
    const shown = [...root.querySelectorAll('.debug-row')];
    expect(shown).toHaveLength(8);
    expect(root.querySelectorAll('.debug-byte')).toHaveLength(64);
    // Row 0 is addresses 0..7 of `addr * 7 + 1`: eight two-digit numbers would
    // also be produced by a row that read the wrong offsets, so the values are
    // spelled out.
    expect(shown[0]!.querySelector('.debug-addr')?.textContent).toBe('00');
    expect(bytes(shown[0]!)).toEqual(['01', '08', '0F', '16', '1D', '24', '2B', '32']);
    expect(shown[7]!.querySelector('.debug-addr')?.textContent).toBe('38');
  });

  it('marks the byte the counter points at', () => {
    // 0x23 is row 0x20's fourth byte, and `0x23 * 7 + 1` is 0xF6.
    const { root } = mount({ ram: image, pc: () => 0x23 });
    const marked = root.querySelector('.debug-byte-pc');
    expect(marked?.textContent).toBe('F6');
    expect(root.querySelectorAll('.debug-byte-pc')).toHaveLength(1);
    // The row the mark sits in says which addresses it shows, so the mark is
    // locatable without counting cells.
    expect(marked?.closest('.debug-row')?.querySelector('.debug-addr')?.textContent).toBe('20');
  });

  it('follows the counter to its page, and pages where the player asks', () => {
    // The window starts on the counter's page, and the buttons move it: a player
    // reading the rest of the program while the machine sits on one address must
    // not be dragged back on every render, and the machine moving to another page
    // must not leave the highlight off screen.
    let pc = 0x00;
    const { root, render } = mount({ ram: image, pc: () => pc });
    const range = (): string => root.querySelector('.debug-range')?.textContent ?? '';
    const page = (): string => root.querySelector('.debug-page')?.textContent ?? '';
    expect(range()).toBe('00–3F');
    expect(page()).toBe('1 / 4');

    // A counter still on page 0 leaves a manual page alone.
    (root.querySelector('.debug-page-next') as HTMLButtonElement).click();
    expect(range()).toBe('40–7F');
    render();
    expect(range()).toBe('40–7F');

    // The machine walks onto page 1: the window follows it, mark and all.
    pc = 0x44; // 0x44 * 7 + 1 = 0xDD
    render();
    expect(range()).toBe('40–7F');
    expect(root.querySelector('.debug-byte-pc')?.textContent).toBe('DD');

    // ...and again when the counter leaves that page.
    pc = 0x90;
    render();
    expect(range()).toBe('80–BF');
    (root.querySelector('.debug-page-prev') as HTMLButtonElement).click();
    expect(range()).toBe('40–7F');
    expect(page()).toBe('2 / 4');
  });

  it('is neutral while there is nothing to read', () => {
    // No run yet, or a board with none of these parts: a dash per field, not a
    // zero. A register panel that printed 0 for "not read" would be claiming the
    // machine holds a zero it has never been asked about.
    const { root } = mount();
    for (const row of rows(root)) expect(row).toContain('—');
    expect(root.querySelector('.debug-pc')?.textContent).toContain('—');
    expect(root.querySelectorAll('.debug-row')).toHaveLength(0);
    expect(root.textContent).toContain('尚未放置程序存储器');
  });

  it('counts the clock edges it is showing', () => {
    const { root } = mount({ ticks: () => 7 });
    expect(root.querySelector('.debug-ticks')?.textContent).toContain('7');
  });

  /**
   * A RE-RENDER THAT CHANGES NOTHING REBUILDS NOTHING.
   *
   * `main.ts` renders this panel on every store change, and a pan or a zoom is a
   * store change: the window is 64 cells and the register block seven rows, so
   * rebuilding either for a camera move is work done for nothing. The readers in
   * `levels/run.ts` hand back a FRESH array every call -- `Simulation.readState`
   * copies -- so the panel cannot ask whether the array is the same one; it has to
   * ask whether the bytes are.
   */
  it('leaves the window and the registers standing when nothing has moved', () => {
    const image = ramImage();
    const registers = [0, 0x2a, 0, 0, 0, 0];
    const { root, render } = mount({
      ram: () => image.slice(),
      pc: () => 1,
      registers: () => registers.slice(),
      ticks: () => 3,
      halt: () => false,
    });
    // Every reading is a new array with the same contents -- what `ProgramRun`
    // does -- and nothing else has moved.
    const before = {
      bytes: [...root.querySelectorAll('.debug-byte')],
      regs: [...root.querySelectorAll('.debug-reg')],
      pc: root.querySelector('.debug-pc'),
      ticks: node(root.querySelector('.debug-ticks')!.firstChild),
      halt: node(root.querySelector('.debug-halt')!.firstChild),
    };
    render();
    render();
    expect([...root.querySelectorAll('.debug-byte')].every((cell, i) => cell === before.bytes[i])).toBe(
      true,
    );
    expect([...root.querySelectorAll('.debug-reg')].every((row, i) => row === before.regs[i])).toBe(
      true,
    );
    expect(root.querySelector('.debug-pc')).toBe(before.pc);
    // The two text readouts count too: assigning `textContent` replaces the text
    // node even when the string is identical.
    expect(node(root.querySelector('.debug-ticks')!.firstChild)).toBe(before.ticks);
    expect(node(root.querySelector('.debug-halt')!.firstChild)).toBe(before.halt);
  });

  it('rebuilds the window when the bytes under it actually change', () => {
    // The guard above must not be a cache that never lets go: the program image
    // changes when the player edits their program, and the page has to follow.
    const image = ramImage();
    const registers = [0, 0x2a, 0, 0, 0, 0];
    const { root, render } = mount({
      ram: () => image.slice(),
      pc: () => 1,
      registers: () => registers.slice(),
    });
    const bytesOf = (): string[] =>
      [...root.querySelectorAll('.debug-byte')].map((cell) => cell.textContent ?? '');
    const before = bytesOf();
    image[1] = 0x99;
    registers[1] = 0x07;
    render();
    const after = bytesOf();
    expect(after[1]).toBe('99');
    expect(after).not.toEqual(before);
    // The registers are rebuilt on the same rule.
    expect(rows(root)[1]).toContain('0x07');
  });
});

/**
 * A byte per address, distinct enough that a row proves which addresses it shows.
 *
 * A FUNCTION rather than one shared array, because the tests that compare two
 * renders need each mount to own its bytes.
 */
function ramImage(): number[] {
  return Array.from({ length: 256 }, (_, addr) => (addr * 7 + 1) & 0xff);
}

/** The node itself: identity is what the rebuild guard is about. */
function node(value: ChildNode | null): ChildNode | null {
  return value;
}

/** jsdom reports an inline colour normalised, so a theme colour is compared in kind. */
function rgbOf(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgb(${r}, ${g}, ${b})`;
}
