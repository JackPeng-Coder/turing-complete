// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { createStore, type AppState, type Store } from '../../src/app/store';
import { emptyProgress } from '../../src/app/progress';
import { CommandStack } from '../../src/app/commands';
import { createRegistry } from '../../src/core/registry';
import { BASE_DEFS } from '../../src/core/defs/index';
import { emptyGraph } from '../../src/core/graph';
import { getLevel, LEVELS } from '../../src/levels/index';
import { graphFromBoard } from '../../src/levels/board';
import { overtureBoard } from '../../src/levels/boards/overture';
import { levelExpectsProgram, playerProgramFormat } from '../../src/levels/checks';
import { createProgramRun, type ProgramRun } from '../../src/levels/run';
import type { LevelCheck, LevelSpec } from '../../src/levels/spec';
import { mountIde, type IdeOptions } from '../../src/ui/ide';
import { mountDebug } from '../../src/ui/debug';
import { attachBoardInput } from '../../src/ui/board/interact';

const registry = createRegistry(BASE_DEFS);

/**
 * The assembly editor, on the level screen.
 *
 * WHERE IT LIVES AND WHEN. Only a level that grades a program the PLAYER wrote
 * gets an editor -- a `program` check with `from: 'player'`, or a `custom` check,
 * whose closed-loop checkers drive the player's program too -- and on every level
 * of chapters 1 to 3 it must not appear at all, which is what
 * `levelExpectsProgram` decides. The tests below pin both halves: the walk over
 * the shipped levels, and the editor's own behaviour on a chapter-4-shaped one.
 *
 * THE RUN IS REAL. The harness builds a `ProgramRun` on the actual chapter-4
 * board, which is what makes "单步 advances the PC readout" a statement about the
 * machine rather than about a fixture: the readout it advances is the debug
 * panel's, fed by `Simulation.readState`, and the byte count in the status line
 * is the assembler's output for the text that was typed.
 */

/** A chapter-4 level: one byte in, one byte out, graded on the player's program. */
function playerLevel(overrides: Partial<LevelSpec> = {}): LevelSpec {
  const checks: readonly LevelCheck[] = [
    { kind: 'program', from: 'player', steps: [{ tick: 0, expect: { out: 1 } }] },
  ];
  return {
    id: 'test-ide',
    chapter: 4,
    index: 1,
    name: { zh: '测试汇编', en: 'Test Assembly' },
    brief: { zh: '', en: '' },
    hint: { zh: '', en: '' },
    allowedComponents: ['level_input', 'level_output'],
    io: {
      inputs: [{ id: 'in', width: 8 }],
      outputs: [{ id: 'out', width: 8 }],
    },
    checks,
    board: overtureBoard({ inputId: 'in' }),
    ...overrides,
  };
}

function makeStore(level: LevelSpec, text = ''): Store<AppState> {
  return createStore<AppState>({
    level,
    graph: level.board ? graphFromBoard(level.id, level.board) : emptyGraph(level.id),
    registry,
    progress: emptyProgress(),
    camera: { x: 0, y: 0, zoom: 1 },
    selected: [],
    dragging: null,
    armed: null,
    dev: false,
    programs: text === '' ? {} : { [level.id]: text },
    metrics: null,
    lastGrade: null,
    status: null,
  });
}

/** The two-instruction echo program: the level's byte into REG1, REG1 onto `out`. */
const ECHO = ['move|inp|d1', 'move|s1|out'].join('\n');

/**
 * The IDE wired the way `main.ts` wires it: the text lives in the store, the run
 * is rebuilt from whatever is stored when a control asks for one, and the panels
 * are re-rendered after every action.
 */
function harness(level: LevelSpec, text = ''): {
  store: Store<AppState>;
  root: HTMLElement;
  code: HTMLTextAreaElement;
  status: () => string;
  ide: { render(): void };
  debug: { render(): void };
  fired: string[];
  run(): ProgramRun | null;
  renderDebug(): void;
} {
  const store = makeStore(level, text);
  const root = document.createElement('div');
  document.body.append(root);
  const fired: string[] = [];
  let run: ProgramRun | null = null;
  let running = false;
  let debug: { render(): void } = { render: () => {} };
  let ide: { render(): void } = { render: () => {} };

  const build = (): ProgramRun => {
    if (run === null) {
      run = createProgramRun(
        store.get().graph,
        registry,
        store.get().level,
        store.get().programs[store.get().level.id] ?? '',
        playerProgramFormat(store.get().level),
      );
    }
    return run;
  };
  const refresh = (): void => {
    ide.render();
    debug.render();
  };

  const options: IdeOptions = {
    format: () => playerProgramFormat(store.get().level),
    onEdit: (next) => {
      // What `main.ts` does with an edit: both copies of the text move together
      // and the run is dropped, because it was built from the old one.
      store.set({ programs: { ...store.get().programs, [store.get().level.id]: next } });
      run = null;
    },
    onAssemble: () => {
      build();
      // `main.ts` re-renders both panels after an assemble: the debugger's
      // readouts come from the run the assemble just built.
      refresh();
    },
    onTest: () => fired.push('test'),
    onStep: () => {
      build().step();
      fired.push('step');
      refresh();
    },
    onToggleRun: () => {
      running = !running;
      fired.push(running ? 'run' : 'stop');
    },
    running: () => running,
    testing: () => false,
    rate: () => '8×',
    onCycleRate: () => fired.push('rate'),
    result: () =>
      run === null
        ? null
        : { bytes: run.bytes, errors: run.errors, ticks: run.ticks },
  };

  ide = mountIde(root, store, options);
  debug = mountDebug(root, {
    registers: () => run?.readRegisters() ?? null,
    pc: () => run?.readPc() ?? null,
    ram: () => run?.readRam() ?? null,
    halt: () => run?.readHalt() ?? null,
    ticks: () => run?.ticks ?? 0,
  });
  const code = root.querySelector('.ide-code') as HTMLTextAreaElement;
  const status = (): string => root.querySelector('.ide-status')?.textContent ?? '';
  return {
    store,
    root,
    code,
    status,
    get ide() {
      return ide;
    },
    get debug() {
      return debug;
    },
    fired,
    run: () => run,
    renderDebug: () => debug.render(),
  };
}

/** Types `text` into the editor the way a player does: value, then an input event. */
function type(code: HTMLTextAreaElement, text: string): void {
  code.value = text;
  code.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('the editor’s mount decision', () => {
  it('is mounted only where the level grades a program the player wrote', () => {
    // Both shapes count. A `program` check with `from: 'player'` reads the
    // player's buffer directly; a `custom` check drives it through one of the
    // closed-loop checkers (`lock`, `maze`), which is the same work from the
    // player's side.
    expect(levelExpectsProgram(playerLevel())).toBe(true);
    expect(
      levelExpectsProgram(playerLevel({ checks: [{ kind: 'custom', id: 'lock' }] })),
    ).toBe(true);
    // ...while the LEVEL's own program is not the player's to edit: chapter 3's
    // machine levels grade a program the level ships.
    expect(levelExpectsProgram(getLevel('ch3-49-turing-complete'))).toBe(false);
    expect(levelExpectsProgram(getLevel('ch1-04-and-gate'))).toBe(false);
  });

  /**
   * THE GUARANTEE THE OTHER PANELS DEPEND ON, now stated as the two-sided rule it
   * always was. Chapters 1 to 3 are built and tested against the board screen as
   * it stands; a panel that appeared on one of their levels would change that DOM.
   * Chapter 4 is the programming chapter, and EVERY one of its seven levels grades
   * a program the player wrote, so the editor appearing there is the feature
   * rather than a regression. Both directions are walked over `LEVELS` rather than
   * spot-checked, so the day a chapter-1-to-3 level grows a `custom` check -- or a
   * chapter-4 level loses its player channel -- this fails here instead of in the
   * smoke suite.
   */
  it('leaves chapters 1 to 3 without an editor, and mounts one on every chapter-4 level', () => {
    expect(LEVELS.length).toBeGreaterThan(40);
    for (const level of LEVELS) {
      // Chapter 4 is the programming chapter; chapters 5 to 7 are not shipped.
      const programming = level.chapter > 3;
      expect(levelExpectsProgram(level), level.id).toBe(programming);
    }
  });

  it('reads the format the level’s own check reads', () => {
    // The punchcard level's programs are hand-written bytes and every other
    // level's are assembly: the editor has to read the same format its checker
    // will, or a player would type a program that runs in the panel and fails in
    // the grade.
    expect(playerProgramFormat(playerLevel())).toBe('asm');
    expect(
      playerProgramFormat(
        playerLevel({
          checks: [{ kind: 'program', from: 'player', format: 'bytes', steps: [] }],
        }),
      ),
    ).toBe('bytes');
    // A level with no player channel at all still answers, because the editor's
    // placeholder and its run are built before anything checks the predicate.
    expect(playerProgramFormat(getLevel('ch1-04-and-gate'))).toBe('asm');
  });
});

describe('ide panel', () => {
  it('mounts an editor with a line-number gutter and Chinese labels', () => {
    const { root, code, status } = harness(playerLevel());
    expect(root.querySelector('.ide')).not.toBeNull();
    expect(code.tagName).toBe('TEXTAREA');
    expect(code.getAttribute('aria-label')).toBe('汇编程序编辑器');
    // Monospace is the stylesheet's job, but the class is what carries it.
    expect(code.classList.contains('ide-code')).toBe(true);
    // The gutter is beside the editor and one number per line, starting at 1.
    const gutter = root.querySelector('.ide-gutter');
    expect(gutter?.nextElementSibling).toBe(code);
    expect(gutterLabels(root)).toEqual(['1']);
    // Nothing has been assembled yet, and the status says so rather than showing
    // a byte count for a run that does not exist.
    expect(status()).toBe('尚未汇编');
    expect(root.querySelector('.ide-bytes')?.hasAttribute('hidden')).toBe(true);
  });

  it('keeps the gutter in step with the text and with the editor’s scroll', () => {
    const { root, code } = harness(playerLevel());
    // The trailing newline is a fourth, empty line -- a textarea's own reading of
    // the text, and the gutter has to number what the editor shows.
    type(code, `# one\n${ECHO}\n`);
    expect(gutterLabels(root)).toEqual(['1', '2', '3', '4']);
    // The gutter is a second column of the same text, so it scrolls WITH the
    // textarea: without this the numbers drift off their lines as soon as a
    // program is longer than the box.
    code.scrollTop = 64;
    code.dispatchEvent(new Event('scroll'));
    expect((root.querySelector('.ide-gutter') as HTMLElement).scrollTop).toBe(64);
  });

  it('writes every edit back to the app', () => {
    const { store, code } = harness(playerLevel());
    type(code, ECHO);
    expect(store.get().programs['test-ide']).toBe(ECHO);
  });

  it('shows the byte count and the hex when the player assembles', () => {
    const { root, code, status } = harness(playerLevel());
    type(code, ECHO);
    // Typing alone assembles nothing: the byte view is a thing the player asks
    // for, not something rebuilt on every keystroke.
    expect(status()).toBe('尚未汇编');

    (root.querySelector('.ide-assemble') as HTMLButtonElement).click();
    expect(status()).toContain('2 字节');
    const hex = root.querySelector('.ide-bytes');
    expect(hex?.hasAttribute('hidden')).toBe(false);
    expect(
      [...root.querySelectorAll('.ide-byte')].map((cell) => cell.textContent),
    ).toEqual(['B1', '8F']);
  });

  it('reports a refused line by its number', () => {
    const { root, code, status } = harness(playerLevel());
    // The second line is the bad one, so a constant number cannot pass this.
    type(code, ['move|inp|d1', 'bogus'].join('\n'));
    (root.querySelector('.ide-assemble') as HTMLButtonElement).click();
    expect(status()).toContain('line 2');
    // A refusal is not a program: there are no bytes to draw.
    expect(root.querySelector('.ide-bytes')?.hasAttribute('hidden')).toBe(true);
  });

  it('will not offer to step a program the reader refused', () => {
    // A control that looks live and does nothing is worse than one that is off:
    // the run refuses to load a program it could not read, so the two step
    // buttons go with it -- while 测试 stays live, because the level's own run
    // must still be able to say what is wrong.
    const { root, code } = harness(playerLevel());
    const step = (): HTMLButtonElement => root.querySelector('.ide-step') as HTMLButtonElement;
    const run = (): HTMLButtonElement => root.querySelector('.ide-run') as HTMLButtonElement;
    const test = (): HTMLButtonElement => root.querySelector('.ide-test') as HTMLButtonElement;

    type(code, 'bogus');
    // Unassembled is not refused: asking for a step assembles first.
    expect(step().disabled).toBe(false);
    (root.querySelector('.ide-assemble') as HTMLButtonElement).click();
    expect(step().disabled).toBe(true);
    expect(run().disabled).toBe(true);
    expect(test().disabled).toBe(false);

    // ...and a program that assembles turns them back on.
    type(code, ECHO);
    (root.querySelector('.ide-assemble') as HTMLButtonElement).click();
    expect(step().disabled).toBe(false);
    expect(run().disabled).toBe(false);
  });

  it('steps the program and advances the counter it shows', () => {
    // THE TWO PANELS TOGETHER, because that is the only reason the editor has a
    // step button: the debug readout is where a step is visible. The counter
    // starts at the first instruction and the echo program's first edge executes
    // it, so one step is one address.
    const app = harness(playerLevel(), ECHO);
    (app.root.querySelector('.ide-assemble') as HTMLButtonElement).click();
    expect(app.root.querySelector('.debug-pc')?.textContent).toContain('0x00');

    (app.root.querySelector('.ide-step') as HTMLButtonElement).click();
    expect(app.fired).toContain('step');
    expect(app.root.querySelector('.debug-pc')?.textContent).toContain('0x01');
    // ...and the status line counts the edge, so the panel says how far in the
    // program the player is.
    expect(app.status()).toContain('1 拍');
  });

  it('turns the run button into a stop button while it is running', () => {
    const { root } = harness(playerLevel(), ECHO);
    const run = (): HTMLButtonElement => root.querySelector('.ide-run') as HTMLButtonElement;
    expect(run().getAttribute('aria-label')).toBe('运行');
    expect(run().getAttribute('aria-pressed')).toBe('false');

    run().click();
    expect(root.querySelector('.ide-run')?.getAttribute('aria-label')).toBe('停止');
    expect(root.querySelector('.ide-run')?.getAttribute('aria-pressed')).toBe('true');

    (root.querySelector('.ide-run') as HTMLButtonElement).click();
    expect(root.querySelector('.ide-run')?.getAttribute('aria-label')).toBe('运行');
  });

  it('hands the test button to the level’s own run, and steps the speed', () => {
    const { root, fired } = harness(playerLevel(), ECHO);
    expect(root.querySelector('.ide-rate')?.textContent).toBe('8×');
    (root.querySelector('.ide-test') as HTMLButtonElement).click();
    (root.querySelector('.ide-rate') as HTMLButtonElement).click();
    expect(fired).toEqual(['test', 'rate']);
  });

  /**
   * THE EDITOR IS NOT THE BOARD'S KEYBOARD.
   *
   * The board's global handler is on `window` (`ui/board/interact.ts`) and it
   * treats Delete and Backspace as "delete the selected parts" and Ctrl+Z as
   * undo -- so a keystroke inside a textarea would delete the circuit being
   * described instead of a character. The editor stops its own keys at the
   * textarea, which is the only place the two vocabularies can be told apart.
   */
  it('keeps the editor’s keys away from the board’s global handler', () => {
    const level = playerLevel();
    const store = makeStore(level, ECHO);
    const canvas = document.createElement('canvas');
    // jsdom 28 has PointerEvent but no pointer capture; the board's handler
    // captures the pointer as its first act (see `panels.test.ts`).
    canvas.setPointerCapture = () => {};
    const detach = attachBoardInput(canvas, store, new CommandStack(), { onChange: () => {} });
    const root = document.createElement('div');
    document.body.append(root);
    let programRunning = false;
    mountIde(root, store, {
      format: () => 'asm',
      onEdit: () => {},
      onAssemble: () => {},
      onTest: () => {},
      onStep: () => {},
      onToggleRun: () => {
        programRunning = !programRunning;
      },
      running: () => programRunning,
      testing: () => false,
      rate: () => '8×',
      onCycleRate: () => {},
      result: () => null,
    });
    const code = root.querySelector('.ide-code') as HTMLTextAreaElement;

    try {
      // One part selected, and the Backspace that would take it away.
      const victim = store.get().graph.instances[0]!;
      store.set({ selected: [victim.id] });
      code.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true }));
      expect(store.get().graph.instances.map((inst) => inst.id)).toContain(victim.id);

      // ...and the same key on the board itself still deletes, so the test is
      // about where the key came from rather than about a dead handler.
      globalThis.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace' }));
      expect(store.get().graph.instances.map((inst) => inst.id)).not.toContain(victim.id);
    } finally {
      detach();
    }
  });
});

/** The gutter's numbers, in order. */
function gutterLabels(root: HTMLElement): string[] {
  return [...root.querySelectorAll('.ide-gutter > *')].map((cell) => cell.textContent ?? '');
}
