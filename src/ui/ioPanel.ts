import type { AppState, Store } from '../app/store';
import { isSandbox, type BoardPins } from '../levels/sandbox';
import type { PinSpec } from '../levels/spec';
import { bitsOf, bitElement } from './bit';

export interface IoPanelOptions {
  /**
   * 屏幕上画板的引脚。
   *
   * 关卡会声明引脚，沙盒不会。沙盒的引脚就是玩家放下的连接器，
   * 所以每次渲染都要重新询问，而不是从关卡规格里读一次：
   * 增删一个「关卡输入」/「关卡输出」会改变这个列表，
   * 而本面板正是必须与它保持一致的三处读者之一。
   */
  pins(): BoardPins;
  /** 画板输入引脚当前被驱动的值。 */
  vector(): Readonly<Record<string, number>>;
  /** 翻转某个输入引脚的一位，然后重新结算。 */
  onToggleBit(pinId: string, bit: number): void;
  /** 输出引脚结算后的值；没有任何东西在运行时为 `null`。 */
  outputs(): Readonly<Record<string, number>> | null;
  /**
   * 仅沙盒：改变某个连接器的引脚位宽。
   *
   * 关卡里的位宽是关卡的契约——检查会拿它作比较，
   * 所以一个能改位宽的按钮就是「能改题」的按钮。沙盒里没有契约：
   * 连接器本身就是引脚，而用 8 位家族搭出的电路没法按 1 位驱动。
   * 关卡上不提供这个回调，位宽小标签也就不画。
   */
  onCycleWidth?(pinId: string): void;
  /** 时钟频率，按通常写法：10Hz。 */
  rate(): string;
  /** 把时钟切到下一档频率。 */
  onCycleRate(): void;
  /** 自上次复位以来走过的时钟沿数。 */
  tick(): number;
}

/**
 * 侧栏的读数：上面是时钟，下面是关卡输入与输出的状态——同样的两张卡片、同样的顺序。
 *
 * 它同时也是输入控件。点一个关卡输入的比特格，就翻转那一位并重新结算画板，
 * 玩家因此能在电路还没搭完时驱动它、看它工作：界面把开关放在画板上，
 * 本项目还没有开关元件，可点击的比特格提供了同样的操作可能，而不必凭空造一个元件。
 *
 * 值既用数字也用比特格显示，因为关卡检查比较的就是数字：`a = 5` 比五格比特容易推理得多。
 */
export function mountIoPanel(
  root: HTMLElement,
  store: Store<AppState>,
  options: IoPanelOptions,
): { render(): void } {
  const wrap = document.createElement('div');
  wrap.className = 'io-panel';
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
    const pins = options.pins();
    const vector = options.vector();
    const outputs = options.outputs();
    // 沙盒在放下东西之前没有引脚，此时「尚未放置输入元件」是错的说法：
    // 关卡什么也没缺，只是玩家还没放下连接器。改为说明怎样才能多出一行。
    const sandbox = isSandbox(level);
    const emptyIn = sandbox ? '放一个「关卡输入」元件来驱动电路' : '尚未放置输入元件';
    const emptyOut = sandbox ? '放一个「关卡输出」元件来读数' : '尚未放置输出元件';

    clock.body.textContent = `${options.tick()} 拍 · ${options.rate()}`;
    clock.rate.textContent = options.rate();
    // 沙盒连接器的位宽是它自己的（`sandboxPins` 从实例上读），
    // 所以只有调用方提供了修改能力时，才画出这个位宽小标签。
    const widthChip = (pin: PinSpec): HTMLElement | undefined => {
      if (!sandbox || options.onCycleWidth === undefined) return undefined;
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'io-width';
      chip.textContent = `${pin.width} 位`;
      chip.title = '点击切换位宽：1 → 8 → 16 → 32 → 2 → 3 → 4 → 6';
      chip.addEventListener('click', () => options.onCycleWidth?.(pin.id));
      return chip;
    };

    state.replaceChildren(
      group('输入状态', pins.inputs, emptyIn, (pin) => {
        const value = vector[pin.id] ?? 0;
        const bits = document.createElement('div');
        bits.className = 'io-bits';
        for (const [index, bit] of bitsOf(value, pin.width).entries()) {
          const position = pin.width - 1 - index;
          const cell = bitElement(bit, `翻转第 ${position + 1} 位`);
          cell.addEventListener('click', () => options.onToggleBit(pin.id, position));
          bits.append(cell);
        }
        const extra = widthChip(pin);
        return extra === undefined ? { bits, value } : { bits, value, extra };
      }),
      group('输出状态', pins.outputs, emptyOut, (pin) => {
        const value = outputs?.[pin.id];
        const bits = document.createElement('div');
        bits.className = 'io-bits';
        for (const bit of value === undefined ? unknownBits(pin.width) : bitsOf(value, pin.width)) {
          bits.append(bitElement(bit));
        }
        const extra = widthChip(pin);
        return extra === undefined ? { bits, value } : { bits, value, extra };
      }),
    );
  };
  store.subscribe(render);
  render();
  return { render };
}

/**
 * 时钟卡片，连同会变化的几个节点一起交回：收起状态卡片的按钮、频率按钮，
 * 以及报告时钟沿计数的那一行文字。三者的更新都由调用方负责，
 * 这里不自行读 store，也不自行读 options。
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
  // `io-value`：它与引脚的数值读数是同一类读数，`panels.test.ts` 也按读数来读它；
  // `io-tick`：一整行文本不是一列数字，不能像数字那样右对齐。
  body.className = 'io-value io-tick';
  head.append(title, rate, collapse);
  element.append(head, body);
  return { element, collapse, rate, body };
}

function unknownBits(width: number): Array<0 | 1 | 'x'> {
  return Array.from({ length: width }, () => 'x' as const);
}

/**
 * 一块 `输入状态` / `输出状态`：标题下面每个引脚一行。
 *
 * 序号放在每行最前，因为画板上两个一模一样的绿色箭头、面板里两行一模一样的格子，
 * 会让玩家分不清第二个输入和第一个输入。有名字时名字跟在序号后：`1. clk`
 * 同时说明这是第几个引脚、关卡管它叫什么。
 *
 * 关卡没有声明某一类引脚时给一句话而不是空框，
 * 这样「这里暂时没有」和「本关压根没有」看起来才不会一样。
 */
function group(
  title: string,
  pins: readonly PinSpec[],
  emptyText: string,
  renderPin: (pin: PinSpec) => { bits: HTMLElement; value: number | undefined; extra?: HTMLElement },
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
    const { bits, value, extra } = renderPin(pin);
    const row = document.createElement('div');
    row.className = 'io-pin';
    const name = document.createElement('div');
    name.className = 'io-pin-name';
    const pinName = pin.label?.zh ?? pin.id;
    name.textContent = pinName === String(position + 1) ? `${position + 1}` : `${position + 1}. ${pinName}`;
    const readout = document.createElement('div');
    readout.className = 'io-value';
    // 用一个破折号，而不是 `???`：上面的点阵已经说明比特未知，
    // 而仪器没有读数时显示的本来就是空白。
    readout.textContent = value === undefined ? '—' : String(value);
    row.append(name);
    if (extra !== undefined) row.append(extra);
    row.append(bits, readout);
    box.append(row);
  }
  return box;
}
