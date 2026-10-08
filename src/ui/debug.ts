import { THEME } from './theme';

/**
 * The debugger: what the machine is holding, one page at a time.
 *
 * WHY A PANEL AND NOT THE BOARD. A stepped program's state lives where no pin can
 * show it: `regfile6` keeps six bytes behind its two read ports, `pc8` one address
 * the program counter publishes only as itself, and `ram_prog` 256 bytes of which
 * a single addressed byte is visible at a time. The board paints signals, and
 * these are not signals -- they are the state a signal is a function of, which is
 * exactly the thing a player stepping a program needs to watch.
 *
 * NOTHING HERE RUNS ANYTHING. Every value arrives through `DebugOptions`, which
 * `main.ts` answers from `ProgramRun` (over the kernel's `Simulation.readState`),
 * so the panel is a readout and cannot disagree with the run: there is one copy of
 * the state and this draws it. A reader that has nothing to say answers `null`,
 * and a field with no reading shows a dash -- never a zero, which would be a value
 * the machine has not been asked about.
 *
 * THE RAM WINDOW PAGES RATHER THAN SCROLLS THROUGH 256 ROWS. Eight rows of eight
 * bytes is a page, and the counter's page is what is on screen: the byte being
 * executed is marked, and the window FOLLOWS the counter when the machine moves to
 * another page. Paging by hand is honoured until then, because reading the rest of
 * a program while the machine sits on one address is the other thing this window
 * is for.
 */
export interface DebugOptions {
  /** REG0..REG5, or `null` when the circuit has no `regfile6`. */
  registers(): readonly number[] | null;
  /** The `pc8` state, or `null` when the circuit has no counter. */
  pc(): number | null;
  /** The 256-byte program image, or `null` when there is no `ram_prog` to show. */
  ram(): readonly number[] | null;
  /** The circuit's `halt` line: `true` halted, `false` counting, `null` no part. */
  halt(): boolean | null;
  /** Edges clocked so far. */
  ticks(): number;
}

/** Rows of eight bytes per page: 64 bytes, so `ram_prog` is four pages. */
const PAGE_ROWS = 8;
const ROW_BYTES = 8;
const PAGE_BYTES = PAGE_ROWS * ROW_BYTES;

/**
 * "Nothing has been built yet", which is not the same answer as "there is
 * nothing to read".
 *
 * A reader answering `null` is a READING -- the circuit has no register file, or
 * the program was refused -- and it has to build the dash rows the first time it
 * is seen. A plain `null` starting value would make that first build look like an
 * unchanged re-render.
 */
const UNBUILT = Symbol('unbuilt');

/** The six registers `regfile6` keeps, in the order its state stores them. */
const REGISTERS = ['REG0', 'REG1', 'REG2', 'REG3', 'REG4', 'REG5'] as const;

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

  /** The page on screen; the counter's own page is followed separately. */
  let page = 0;
  /**
   * The counter's page the window last followed.
   *
   * `-1` before anything has been read, so the first render takes the counter's
   * page. Only a CHANGE of the counter's page moves the window, which is what
   * lets a player page away and stay there while the machine sits still.
   */
  let followed = -1;
  /**
   * What the panel was last built from, so a pan does not rebuild it.
   *
   * `main.ts` re-renders this panel on EVERY store change, and a pan or a click
   * costs the same as a step. The window is 64 cells and the register block seven
   * rows, and rebuilding either for a camera move is work done for nothing.
   *
   * IDENTITY CANNOT DECIDE THAT. `ProgramRun.readRam` and `readRegisters` build a
   * fresh array out of `Simulation.readState` -- which itself copies -- on every
   * call, so the array is new even when not one byte has moved, and an identity
   * test would rebuild every time. What is compared here is therefore the BYTES,
   * the page, and the addressed byte: what actually decides whether a cell would
   * look different.
   */
  let shownRam: { image: readonly number[]; first: number; counter: number | null } | null = null;
  /**
   * The registers and the counter the block was last built from.
   *
   * `UNBUILT` rather than `null` as the starting value, and that distinction is
   * the whole reason the sentinel exists: `null` is a READING -- the run had no
   * register file to read -- so starting there would make the first render look
   * like an unchanged one and leave the panel empty.
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
    // The text is assigned only when the reading actually moved: writing it every
    // render throws the text node away and builds a new one, and `main.ts` renders
    // this panel on every store change, pans included.
    const tickText = `${tick} 拍`;
    if (ticks.textContent !== tickText) ticks.textContent = tickText;

    const haltText = halted === null ? '—' : halted ? '停机' : '运行';
    if (halt.textContent !== haltText) halt.textContent = haltText;
    // The instrument's own voice, and never one of the board's value colours: a
    // state is not a signal, and green here would read as the halt pin carrying 1.
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

    // Follow the counter, but only when it moves to another page: paging by hand
    // while the machine sits still has to stick.
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
 * Whether two readings render as the same thing.
 *
 * `null` means the run had nothing to say -- no such part, or a program that was
 * refused -- and is equal only to itself, because the empty state is a different
 * panel from a page of zeros. Two arrays are compared byte by byte: the readers in
 * `levels/run.ts` copy out of `Simulation.readState` on every call, so identity
 * says "changed" every time and only the contents can answer the question the
 * guard is asking.
 */
function sameBytes(a: readonly number[] | null, b: readonly number[] | null): boolean {
  if (a === null || b === null) return a === b;
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

/** One `REGn 0xNN NN` row: the name, the byte in hex, and the same byte in decimal. */
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
 * A byte as two hex digits, or a dash.
 *
 * Upper case with the `0x` prefix, which is what the assembler's own listing and
 * every datasheet use; a dash for no reading at all, which is the same convention
 * the input readout panel uses for a pin nothing has driven.
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

/** The page's rows: eight addresses each, and the counter's byte marked. */
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
      // Past the end of a short image: the byte is not there, and printing 00
      // would say it is zero.
      cell.textContent = at < image.length ? hexText(image[at]!) : '  ';
      if (at === counter) cell.classList.add('debug-byte-pc');
      row.append(cell);
    }
    rows.push(row);
  }
  return rows;
}

/** The whole window's stand-in when the circuit has no program memory to show. */
function emptyRam(): HTMLElement {
  const empty = document.createElement('div');
  empty.className = 'debug-ram-empty';
  empty.textContent = '尚未放置程序存储器';
  return empty;
}
