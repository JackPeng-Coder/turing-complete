import type { AppState, Store } from '../app/store';
import type { PinSpec } from '../levels/spec';
import { bitsOf, bitElement } from './bit';

export interface IoPanelOptions {
  /** The values the level's input pins are currently driven with. */
  vector(): Readonly<Record<string, number>>;
  /** Flips one bit of one level input pin, then re-settles. */
  onToggleBit(pinId: string, bit: number): void;
  /** Settled values at the level's output pins, or `null` when nothing runs. */
  outputs(): Readonly<Record<string, number>> | null;
  /** The clock's rate, as the original labels it: `10Hz`. */
  rate(): string;
  /** Steps the clock to its next rate. */
  onCycleRate(): void;
  /** Clock edges applied since the last reset. */
  tick(): number;
}

/**
 * The left-hand readout: the clock above, the level's input and output state
 * below -- the original's own two cards, in its own order.
 *
 * IT IS ALSO THE INPUT CONTROL. Clicking a bit of a level input flips that bit
 * and re-settles the board, which is how a player drives a circuit they are
 * still building and watches it work: the original puts switches on the board,
 * this replica has no switch part yet, and a clickable bit cell is the same
 * affordance without inventing one.
 *
 * Values are shown as numbers as well as bits because that is what a level's own
 * check compares: `a = 5` is a far easier thing to reason about than five cells.
 */
export function mountIoPanel(
  root: HTMLElement,
  store: Store<AppState>,
  options: IoPanelOptions,
): { render(): void } {
  const wrap = document.createElement('div');
  wrap.className = 'overlay overlay-left';
  const clock = mountClock(options);
  wrap.append(clock.element);

  const state = document.createElement('section');
  state.className = 'card';

  clock.collapse.addEventListener('click', () => {
    state.hidden = !state.hidden;
    clock.collapse.textContent = state.hidden ? '+' : '−';
  });

  wrap.append(state);
  root.append(wrap);

  const render = (): void => {
    const { level } = store.get();
    const vector = options.vector();
    const outputs = options.outputs();

    clock.body.textContent = `${options.tick()} 拍 · ${options.rate()}`;
    clock.rate.textContent = options.rate();
    state.replaceChildren(
      group('输入状态', level.io.inputs, '尚未放置输入元件', (pin) => {
        const value = vector[pin.id] ?? 0;
        const bits = document.createElement('div');
        bits.className = 'io-bits';
        for (const [index, bit] of bitsOf(value, pin.width).entries()) {
          const position = pin.width - 1 - index;
          const cell = bitElement(bit, `翻转第 ${position + 1} 位`);
          cell.addEventListener('click', () => options.onToggleBit(pin.id, position));
          bits.append(cell);
        }
        return { bits, value };
      }),
      group('输出状态', level.io.outputs, '尚未放置输出元件', (pin) => {
        const value = outputs?.[pin.id];
        const bits = document.createElement('div');
        bits.className = 'io-bits';
        for (const bit of value === undefined ? unknownBits(pin.width) : bitsOf(value, pin.width)) {
          bits.append(bitElement(bit));
        }
        return { bits, value };
      }),
    );
  };
  store.subscribe(render);
  render();
  return { render };
}

/**
 * The clock card, handed back with the nodes that change: the button that
 * collapses the state card, the rate button and the line that reports the edge
 * count. The caller owns all three, so nothing here reads the store or the
 * options on its own.
 */
function mountClock(options: IoPanelOptions): {
  element: HTMLElement;
  collapse: HTMLButtonElement;
  rate: HTMLButtonElement;
  body: HTMLElement;
} {
  const element = document.createElement('section');
  element.className = 'card';
  const head = document.createElement('div');
  head.className = 'card-head';
  const title = document.createElement('span');
  title.textContent = '时钟';
  const rate = document.createElement('button');
  rate.type = 'button';
  rate.textContent = options.rate();
  rate.setAttribute('aria-label', '切换时钟频率');
  rate.addEventListener('click', () => options.onCycleRate());
  const collapse = document.createElement('button');
  collapse.type = 'button';
  collapse.textContent = '−';
  collapse.setAttribute('aria-label', '收起状态面板');
  const body = document.createElement('div');
  // `io-value` because it is the same kind of readout as a pin's number, and
  // `panels.test.ts` reads it as one; `io-tick` because a block of text is not a
  // column of numbers and must not be right-aligned like one.
  body.className = 'io-value io-tick';
  head.append(title, rate, collapse);
  element.append(head, body);
  return { element, collapse, rate, body };
}

function unknownBits(width: number): Array<0 | 1 | 'x'> {
  return Array.from({ length: width }, () => 'x' as const);
}

/**
 * One `输入状态` / `输出状态` block: a heading over one row per pin.
 *
 * The ordinal leads each row, because a board of two identical green arrows and
 * a panel of two rows of identical cells leave the player no way to tell the
 * second input from the first. The name follows it when there is one: `1. clk`
 * says both which pin it is and what the level calls it.
 *
 * A level that declares no pin of a kind gets a sentence instead of an empty
 * box, so "nothing here yet" and "this level has none" do not look the same.
 */
function group(
  title: string,
  pins: readonly PinSpec[],
  emptyText: string,
  renderPin: (pin: PinSpec) => { bits: HTMLElement; value: number | undefined },
): HTMLElement {
  const box = document.createElement('div');
  box.className = 'io-group';
  const heading = document.createElement('h3');
  heading.textContent = title;
  box.append(heading);

  if (pins.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'io-empty';
    empty.textContent = emptyText;
    box.append(empty);
    return box;
  }

  for (const [position, pin] of pins.entries()) {
    const { bits, value } = renderPin(pin);
    const row = document.createElement('div');
    row.className = 'io-pin';
    const name = document.createElement('div');
    name.className = 'io-pin-name';
    const pinName = pin.label?.zh ?? pin.id;
    name.textContent = pinName === String(position + 1) ? `${position + 1}` : `${position + 1}. ${pinName}`;
    const readout = document.createElement('div');
    readout.className = 'io-value';
    readout.textContent = value === undefined ? '???' : String(value);
    row.append(name, bits, readout);
    box.append(row);
  }
  return box;
}
