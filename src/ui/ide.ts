import type { AppState, Store } from '../app/store';
import { iconSvg, type IconName } from './shell';
import { THEME } from './theme';

/**
 * The assembly editor: the text a player writes, and what it becomes.
 *
 * WHAT IT IS. A textarea with a line-number gutter, a status line, a byte view
 * and the four controls a program needs: 汇编 to read the text, 单步 to clock one
 * edge, 运行/停止 to clock them on a timer, and 测试 to hand the level its own
 * test run. Nothing here runs a circuit -- `main.ts` owns the `ProgramRun` and
 * answers through `IdeOptions`, exactly as it owns the board's own clock for the
 * toolbar -- so the panel is a view with controls, and the run it describes has
 * one owner.
 *
 * WHERE THE TEXT LIVES. In the store, keyed by level (`AppState.programs`), which
 * is also what the checker grades and what the save keeps. The panel READS it
 * there and writes every keystroke back through `onEdit`; it keeps no copy of its
 * own, so a reload, a level change or a migrated save cannot leave an editor
 * showing text the level does not have.
 *
 * THE BYTE VIEW IS ON DEMAND. Assembling on every keystroke would rebuild a hex
 * dump of a program the player is halfway through typing, so the view appears
 * when they ask for it -- 汇编, or any control that needs the program loaded --
 * and is hidden again the moment the text changes. What does NOT wait is the
 * status line's refusal: `main.ts` hands over the run's own errors, and a program
 * that will not assemble says so before anything is stepped.
 *
 * THE KEYS ARE THE EDITOR'S. The board's global handler (`ui/board/interact.ts`)
 * treats Backspace and Delete as "delete the selected parts" and Ctrl+Z as undo,
 * and it listens on `window` -- so a keystroke in a textarea would edit the
 * CIRCUIT. This is the one place that can tell the two apart, and it stops its own
 * keys before they leave the textarea.
 */
export interface IdeOptions {
  /** Which reader this level's programs are written for. */
  format(): 'asm' | 'bytes';
  /** The text changed: `main.ts` stores it and drops the run built from the old one. */
  onEdit(text: string): void;
  /** Read the text as a program now, and show what came out. */
  onAssemble(): void;
  /** Start or stop the level's own test run. */
  onTest(): void;
  /** Apply one clock edge to the program run. */
  onStep(): void;
  /** Start or stop stepping the program on a timer. */
  onToggleRun(): void;
  /** True while the program is being stepped on a timer. */
  running(): boolean;
  /** True while the level's own cases are being played. */
  testing(): boolean;
  /** The step pace, as the existing vocabulary labels it (`8×`). */
  rate(): string;
  /** Steps through the step paces. */
  onCycleRate(): void;
  /** What the current run holds, or `null` when nothing has been assembled yet. */
  result(): {
    readonly bytes: readonly number[];
    readonly errors: readonly string[];
    readonly ticks: number;
  } | null;
}

/**
 * The monospace editor's two labels, by the reader the level's programs use.
 *
 * The label is how a player learns which language to write: the punchcard level
 * speaks bytes and every other level speaks assembly, and a placeholder alone
 * would be a hint they might not look at.
 */
const LABELS: Record<'asm' | 'bytes', { editor: string; placeholder: string }> = {
  asm: { editor: '汇编程序编辑器', placeholder: 'move|inp|d1' },
  bytes: { editor: '二进制程序编辑器', placeholder: '10110001' },
};

export function mountIde(
  root: HTMLElement,
  store: Store<AppState>,
  options: IdeOptions,
): { render(): void } {
  const panel = document.createElement('section');
  panel.className = 'ide';

  const head = document.createElement('div');
  head.className = 'card-head';
  const title = document.createElement('span');
  title.textContent = '程序';
  const gap = document.createElement('span');
  gap.className = 'ide-gap';
  const rate = document.createElement('button');
  rate.type = 'button';
  rate.className = 'ide-rate';
  rate.setAttribute('aria-label', '切换汇编速度');
  const assemble = document.createElement('button');
  assemble.type = 'button';
  assemble.className = 'ide-assemble';
  assemble.textContent = '汇编';
  assemble.setAttribute('aria-label', '汇编');
  assemble.title = '汇编：把当前文本读成程序映像';
  head.append(title, gap, rate, assemble);

  // The gutter is a second column of the same text: `main.ts`'s textarea scrolls,
  // and the numbers follow it in its own `scroll` handler below.
  const editor = document.createElement('div');
  editor.className = 'ide-editor';
  const gutter = document.createElement('div');
  gutter.className = 'ide-gutter';
  // Decorative: every number it holds is also a line of the text beside it, and a
  // screen reader reading 1, 2, 3 before the program would be reading punctuation.
  gutter.setAttribute('aria-hidden', 'true');
  const code = document.createElement('textarea');
  code.className = 'ide-code';
  code.spellcheck = false;
  code.wrap = 'off';
  editor.append(gutter, code);

  const status = document.createElement('div');
  status.className = 'ide-status';
  status.setAttribute('role', 'status');
  const bytes = document.createElement('div');
  bytes.className = 'ide-bytes';
  bytes.hidden = true;

  const test = iconButton('测试', 'test', 'ide-test', () => {
    options.onTest();
    render();
  });
  const step = iconButton('单步', 'step', 'ide-step', () => {
    options.onStep();
    render();
  });
  const run = iconButton('运行', 'play', 'ide-run', () => {
    options.onToggleRun();
    render();
  });
  const actions = document.createElement('div');
  actions.className = 'ide-actions';
  actions.append(test, step, run);

  panel.append(head, editor, status, bytes, actions);
  root.append(panel);

  rate.addEventListener('click', () => {
    options.onCycleRate();
    render();
  });
  assemble.addEventListener('click', () => {
    // Assembling is what makes the run current, so the panel renders AFTER the
    // callback: the byte count and the hex it shows are the ones just produced.
    options.onAssemble();
    render();
  });
  code.addEventListener('input', () => {
    options.onEdit(code.value);
    render();
  });
  code.addEventListener('scroll', () => {
    gutter.scrollTop = code.scrollTop;
  });
  // The board's handler is on `window`: stopping the event here is what keeps a
  // Backspace in the editor from deleting the selected parts of the circuit.
  code.addEventListener('keydown', (event) => {
    event.stopPropagation();
  });

  /** The level's text, as the app holds it: the store is the one copy. */
  const text = (): string => {
    const { level, programs } = store.get();
    return programs[level.id] ?? '';
  };

  /**
   * What the two expensive halves of the panel were last built from.
   *
   * A PANEL RE-RENDER IS NOT A PROGRAM EDIT: `main.ts` re-renders on every store
   * change, and panning, zooming or clicking a part all go through the store -- so
   * without these the gutter and the hex view would be rebuilt from scratch dozens
   * of times a second for a program that has not moved. The text (a string) and
   * the image (an array the run owns, so identity is the honest test) are the two
   * things that actually say whether there is anything new to draw.
   */
  let shownText: string | null = null;
  let shownBytes: readonly number[] | null = null;

  const render = (): void => {
    const current = text();
    const labels = LABELS[options.format()];
    code.setAttribute('aria-label', labels.editor);
    code.placeholder = labels.placeholder;
    // Only when the player is not in it: replacing the value of a focused
    // textarea would put the caret at the end on the next keystroke.
    if (document.activeElement !== code && code.value !== current) code.value = current;
    if (shownText !== current) {
      shownText = current;
      renderGutter(gutter, current);
    }
    gutter.scrollTop = code.scrollTop;

    rate.textContent = options.rate();
    rate.title = `汇编速度 ${options.rate()}`;

    test.setAttribute('aria-pressed', String(options.testing()));
    test.setAttribute('aria-label', options.testing() ? '停止测试' : '测试');
    test.title = options.testing() ? '停止测试' : '测试：逐个播放本关用例，最后给出判定';
    run.setAttribute('aria-pressed', String(options.running()));
    run.replaceChildren(iconSvg(options.running() ? 'stop' : 'play'));
    run.setAttribute('aria-label', options.running() ? '停止' : '运行');
    run.title = options.running() ? '停止：不再单步' : `运行：每 ${options.rate()} 单步一次`;

    const result = options.result();
    const error = result?.errors[0];
    // A REFUSED PROGRAM CANNOT BE STEPPED, and the buttons say so rather than
    // doing nothing: the status line right above them is the reader's own
    // sentence about which line is wrong. While the text is merely unassembled
    // the controls stay live, because asking for a step assembles it first.
    const refused = result !== null && result.errors.length > 0;
    step.disabled = refused;
    run.disabled = refused;
    if (result === null) {
      status.textContent = '尚未汇编';
      status.style.color = THEME.textMuted;
    } else if (error !== undefined) {
      // The reader's own sentence, which names the line: a refusal is not a
      // program, so there is no byte count to show beside it.
      status.textContent = error;
      status.style.color = THEME.error;
    } else {
      status.textContent = `${result.bytes.length} 字节 · ${result.ticks} 拍`;
      status.style.color = THEME.textMuted;
    }

    const showBytes = result !== null && error === undefined && result.bytes.length > 0;
    bytes.hidden = !showBytes;
    if (!showBytes) {
      // Nothing to show: the cells go with the view, so a later program cannot be
      // drawn beside the previous one's.
      if (shownBytes !== null) {
        bytes.replaceChildren();
        shownBytes = null;
      }
    } else if (result.bytes !== shownBytes) {
      shownBytes = result.bytes;
      bytes.replaceChildren(...result.bytes.map(byteCell));
    }
  };

  render();
  return { render };
}

/** One byte of the image view, as two hex digits. */
function byteCell(value: number): HTMLElement {
  const cell = document.createElement('span');
  cell.className = 'ide-byte';
  cell.textContent = value.toString(16).toUpperCase().padStart(2, '0');
  return cell;
}

/**
 * One number per line of the text, in the same order.
 *
 * The gutter is rebuilt rather than diffed: a program is a few hundred lines at
 * most, and a diff would be a second place for the two columns to disagree.
 */
function renderGutter(gutter: HTMLElement, text: string): void {
  const count = text.split('\n').length;
  gutter.replaceChildren(
    ...Array.from({ length: count }, (_, index) => {
      const line = document.createElement('div');
      line.className = 'ide-line';
      line.textContent = String(index + 1);
      return line;
    }),
  );
}

/**
 * One of the transport controls, as an icon-only button.
 *
 * The same vocabulary as the board's toolbar: the icons are the shell's own
 * (`测试`, `单步`, `运行`/`停止`), and a player who has run the board's clock
 * already knows what they mean. The label is on `aria-label` and `title`, which
 * is what the toolbar does for the same reason -- a panel button whose text was a
 * glyph would leak that glyph into anything reading the panel's text.
 */
function iconButton(
  label: string,
  icon: IconName,
  className: string,
  onClick: () => void,
): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  // `tool-btn` rather than a copy of it: these are the same transport controls
  // the toolbar draws, one panel over, and a second set of sizes and states would
  // be a second thing to keep in step with them.
  button.className = `tool-btn ${className}`;
  button.setAttribute('aria-label', label);
  button.title = label;
  button.append(iconSvg(icon));
  button.addEventListener('click', onClick);
  return button;
}
