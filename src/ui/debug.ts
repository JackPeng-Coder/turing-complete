import { THEME } from './theme';

/**
 * 调试器：机器内部此刻存着什么，一页一页地看。
 *
 * 为什么做成面板而不是画在画板上。单步程序的内部状态在没有任何引脚能显示的地方：
 * `regfile6` 在两个读端口后面藏着六个字节；`pc8` 只保存一个地址，程序计数器对外发布的也只有它；
 * `ram_prog` 有 256 字节，同一时刻只有一个被寻址的字节可见。画板画的是信号，
 * 而这些不是信号——它们是"信号作为其函数"的状态，恰恰是单步执行程序的玩家
 * 最需要看的东西。
 *
 * 这里不运行任何东西。每个值都经 `DebugOptions` 到达，由 `main.ts` 从
 * `ProgramRun`（再往下经内核的 `Simulation.readState`）给出，所以面板只是读数器，
 * 不可能和运行结果不一致：状态只有一份，这里只是把它画出来。
 * 没有话可说的读取器返回 `null`，没有读数的字段显示短横线——绝不显示 0，
 * 因为 0 会是一个机器从未被问过的值。
 *
 * RAM 窗口分页显示，而不是滚过 256 行。八行、每行八字节是一页，
 * 屏幕上显示的是计数器所在的那一页：正在执行的字节有标记，
 * 机器走到另一页时窗口会跟随计数器。在此之前，手动翻页会被尊重，
 * 因为机器停在某个地址时去读程序的其他部分，正是这个窗口的另一个用途。
 */

/** 面板读取的五个读数；`main.ts` 用 `ProgramRun` 实现它们。 */
export interface DebugOptions {
  /** REG0..REG5 六个寄存器的值；电路里没有 `regfile6` 时为 `null`。 */
  registers(): readonly number[] | null;
  /** `pc8` 的状态；电路里没有计数器时为 `null`。 */
  pc(): number | null;
  /** 256 字节的程序映像；没有 `ram_prog` 可显示时为 `null`。 */
  ram(): readonly number[] | null;
  /** 电路的 `halt` 线：`true` 已停机、`false` 在计数、`null` 没有该元件。 */
  halt(): boolean | null;
  /** 到目前为止已打入的时钟沿数（拍数）。 */
  ticks(): number;
}

/** 每页八行、每行八字节：一页 64 字节，所以 `ram_prog` 共四页。 */
const PAGE_ROWS = 8;
const ROW_BYTES = 8;
const PAGE_BYTES = PAGE_ROWS * ROW_BYTES;

/**
 * "还没有构建过"，这与"没有东西可读"不是同一个答案。
 *
 * 读取器返回 `null` 本身就是一个读数——电路里没有寄存器文件，或程序被拒绝——
 * 第一次看到它时必须把短横线行建出来。若用普通的 `null` 当初始值，
 * 首次构建就会被误判成"内容没变、不必重画"。
 */
const UNBUILT = Symbol('unbuilt');

/** `regfile6` 保存的六个寄存器，按其状态存储的顺序排列。 */
const REGISTERS = ['REG0', 'REG1', 'REG2', 'REG3', 'REG4', 'REG5'] as const;

/**
 * 挂载调试面板，并立即渲染一次；返回的 render 由 `main.ts` 在每次 store
 * 变化时调用。面板只读不写：所有值都经 DebugOptions 取回，读数没变时
 * 对应的 DOM 不会重建（见 shownRam / shownRegisters / shownPc 的比较）。
 */
export function mountDebug(root: HTMLElement, options: DebugOptions): { render(): void } {
  const panel = document.createElement('section');
  panel.className = 'debug';

  const head = document.createElement('div');
  head.className = 'card-head';
  const title = document.createElement('span');
  title.textContent = '调试';
  const ticks = document.createElement('span');
  ticks.className = 'debug-ticks';
  const gap = document.createElement('span');
  gap.className = 'debug-gap';
  const halt = document.createElement('span');
  halt.className = 'debug-halt';
  head.append(title, ticks, gap, halt);

  const regs = document.createElement('div');
  regs.className = 'debug-regs';
  const pcRow = document.createElement('div');
  pcRow.className = 'debug-pc';

  const ramHead = document.createElement('div');
  ramHead.className = 'debug-ram-head';
  const range = document.createElement('span');
  range.className = 'debug-range';
  const ramGap = document.createElement('span');
  ramGap.className = 'debug-gap';
  const prev = document.createElement('button');
  prev.type = 'button';
  prev.className = 'debug-page-prev';
  prev.textContent = '‹';
  prev.setAttribute('aria-label', '上一页');
  prev.title = '上一页';
  const pageLabel = document.createElement('span');
  pageLabel.className = 'debug-page';
  const next = document.createElement('button');
  next.type = 'button';
  next.className = 'debug-page-next';
  next.textContent = '›';
  next.setAttribute('aria-label', '下一页');
  next.title = '下一页';
  ramHead.append(range, ramGap, prev, pageLabel, next);

  const ram = document.createElement('div');
  ram.className = 'debug-ram';

  panel.append(head, regs, pcRow, ramHead, ram);
  root.append(panel);

  /** 屏幕上显示的页；计数器自己所在的页另行跟随。 */
  let page = 0;
  /**
   * 窗口上一次跟随到的计数器页。
   *
   * 在读到任何东西之前是 `-1`，这样第一次渲染就会采用计数器所在的页。
   * 只有计数器的页真的改变时窗口才移动，这也正是"玩家手动翻页离开后，
   * 机器不动时就能停在那里"的原因。
   */
  let followed = -1;
  /**
   * 面板上一次构建 RAM 窗口所依据的内容，避免平移画板也重建它。
   *
   * `main.ts` 在每次 store 变化时都重绘本面板，而平移或点击与单步一样频繁。
   * 窗口是 64 个格子、寄存器块是七行，为一次相机移动重建其中任何一个都是白做功。
   *
   * 用引用相等判断行不通。`ProgramRun.readRam` 与 `readRegisters` 每次调用都会从
   * `Simulation.readState`（它自己也会复制）新建一个数组，所以哪怕一个字节都没变，
   * 数组也是新的；用引用比较会导致每次重绘都重建。因此这里比较的是字节内容、页码
   * 和当前寻址的字节——这些才是真正决定"某一格看起来会不会不同"的东西。
   */
  let shownRam: { image: readonly number[]; first: number; counter: number | null } | null = null;
  /**
   * 寄存器块和程序计数器上一次构建所依据的值。
   *
   * 初始值用 `UNBUILT` 而不是 `null`，这个区别正是该哨兵存在的全部理由：
   * `null` 是一个读数——运行环境里没有寄存器文件可读——若从它开始，
   * 第一次渲染就会被当成"没有变化"，面板会一直空着。
   */
  let shownRegisters: readonly number[] | null | typeof UNBUILT = UNBUILT;
  let shownPc: number | null | typeof UNBUILT = UNBUILT;

  const pageOf = (address: number): number => Math.floor(address / PAGE_BYTES);

  prev.addEventListener('click', () => {
    page -= 1;
    render();
  });
  next.addEventListener('click', () => {
    page += 1;
    render();
  });

  const render = (): void => {
    const image = options.ram();
    const counter = options.pc();
    const tick = options.ticks();
    const halted = options.halt();
    // 只有读数真的变化时才写文本：每次渲染都写会丢掉旧文本节点、新建一个，
    // 而 `main.ts` 在每次 store 变化时都会重绘本面板，包括平移。
    const tickText = `${tick} 拍`;
    if (ticks.textContent !== tickText) ticks.textContent = tickText;

    const haltText = halted === null ? '—' : halted ? '停机' : '运行';
    if (halt.textContent !== haltText) halt.textContent = haltText;
    // 用仪表自己的语气色，绝不用画板上的取值颜色：状态不是信号，
    // 这里的绿色会被误读成 halt 引脚正携带 1。
    halt.style.color = halted === true ? THEME.title : THEME.textMuted;
    halt.title =
      halted === null
        ? '本电路没有停机元件'
        : halted
          ? '停机：程序已写入 out，计数器被冻结'
          : '运行：计数器每拍前进';

    const registers = options.registers();
    if (shownRegisters === UNBUILT || !sameBytes(registers, shownRegisters)) {
      shownRegisters = registers;
      regs.replaceChildren(
        ...REGISTERS.map((name, index) => registerRow(name, registers?.[index] ?? null)),
      );
    }
    if (shownPc === UNBUILT || counter !== shownPc) {
      shownPc = counter;
      pcRow.replaceChildren(named('PC'), hexCell(counter), decimalCell(counter));
    }

    // 跟随计数器，但只在它移动到另一页时跟随：机器不动时，手动翻页必须能停住。
    if (image !== null && counter !== null) {
      const counterPage = pageOf(counter);
      if (counterPage !== followed) {
        followed = counterPage;
        page = counterPage;
      }
    }
    const pages = image === null ? 0 : Math.max(1, Math.ceil(image.length / PAGE_BYTES));
    page = Math.min(Math.max(page, 0), Math.max(pages - 1, 0));

    ramHead.hidden = image === null;
    prev.disabled = page <= 0;
    next.disabled = page >= pages - 1;
    pageLabel.textContent = `${page + 1} / ${pages}`;
    const first = page * PAGE_BYTES;
    range.textContent =
      image === null ? '' : `${hexText(first)}–${hexText(Math.min(first + PAGE_BYTES, image.length) - 1)}`;

    if (
      shownRam === null ||
      shownRam.first !== first ||
      shownRam.counter !== counter ||
      !sameBytes(image, shownRam.image)
    ) {
      shownRam = { image: image ?? [], first, counter };
      ram.replaceChildren(...(image === null ? [emptyRam()] : ramRows(image, first, counter)));
    }
  };

  render();
  return { render };
}

/**
 * 两个读数是否会渲染成同一样东西。
 *
 * `null` 表示运行环境无话可说——没有这个元件，或程序被拒绝——它只等于它自己，
 * 因为"空状态"与"一页零"是两个不同的面板。两个数组按字节比较：
 * `levels/run.ts` 的读取器每次调用都从 `Simulation.readState` 复制出来，
 * 引用永远显示"变了"，只有内容才能回答这个守卫真正要问的问题。
 */
function sameBytes(a: readonly number[] | null, b: readonly number[] | null): boolean {
  if (a === null || b === null) return a === b;
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

/** 一行 `REGn 0xNN NN`：名称、十六进制字节，以及同一个字节的十进制值。 */
function registerRow(name: string, value: number | null): HTMLElement {
  const row = document.createElement('div');
  row.className = 'debug-reg';
  row.append(named(name), hexCell(value), decimalCell(value));
  return row;
}

function named(text: string): HTMLElement {
  const cell = document.createElement('span');
  cell.className = 'debug-name';
  cell.textContent = text;
  return cell;
}

/**
 * 一个字节显示为两位十六进制，或一根短横线。
 *
 * 大写并带 `0x` 前缀，与汇编器自己的列表和所有数据手册的写法一致；
 * 完全没有读数时显示短横线，与输入读数面板对"没有东西驱动过的引脚"的约定相同。
 */
function hexCell(value: number | null): HTMLElement {
  const cell = document.createElement('span');
  cell.className = 'debug-hex';
  cell.textContent = value === null ? '—' : `0x${hexText(value)}`;
  return cell;
}

function decimalCell(value: number | null): HTMLElement {
  const cell = document.createElement('span');
  cell.className = 'debug-dec';
  cell.textContent = value === null ? '' : String(value);
  return cell;
}

function hexText(value: number): string {
  return value.toString(16).toUpperCase().padStart(2, '0');
}

/** 本页的每一行：每行八个地址，并标出计数器所指的那个字节。 */
function ramRows(image: readonly number[], first: number, counter: number | null): HTMLElement[] {
  const rows: HTMLElement[] = [];
  for (let line = 0; line < PAGE_ROWS; line += 1) {
    const start = first + line * ROW_BYTES;
    const row = document.createElement('div');
    row.className = 'debug-row';
    const address = document.createElement('span');
    address.className = 'debug-addr';
    address.textContent = hexText(start);
    row.append(address);
    for (let offset = 0; offset < ROW_BYTES; offset += 1) {
      const at = start + offset;
      const cell = document.createElement('span');
      cell.className = 'debug-byte';
      // 超过程序映像末尾的位置：那里没有字节，打印 00 会声称它是 0。
      cell.textContent = at < image.length ? hexText(image[at]!) : '  ';
      if (at === counter) cell.classList.add('debug-byte-pc');
      row.append(cell);
    }
    rows.push(row);
  }
  return rows;
}

/** 电路没有程序存储器可显示时，替代整个窗口的占位提示。 */
function emptyRam(): HTMLElement {
  const empty = document.createElement('div');
  empty.className = 'debug-ram-empty';
  empty.textContent = '尚未放置程序存储器';
  return empty;
}
