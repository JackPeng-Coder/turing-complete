import type { AppState, Store } from '../app/store';
import type { GradeResult } from '../levels/grader';
import type { CheckFailure, LevelSpec, PinSpec } from '../levels/spec';
import { testCases, type TestPlan } from '../levels/checks';
import { bitsOf, bitElement } from './bit';
import { THEME } from './theme';

/**
 * The level's test cases, as the original's bottom panel: one row per pin, one
 * column per case, and one cell per pin -- a red cell for a 0, a green one for a
 * 1, olive while nothing is known.
 *
 * The panel is a matrix rather than a list of failing vectors because that is
 * what the original shows and because it answers the question a player actually
 * has -- "which bit is wrong, and for which case" -- without reading a number.
 *
 * THE PANEL PLANS; IT DOES NOT JUDGE. Three versions of this file ago it printed
 * one line of text per failing case (`用例 3 · out3: 0 ≠ 1`), which on a
 * fifteen-row level was fifteen lines of the same sentence: unreadable, and
 * unreadable in a way that got worse the more a player needed it. Then it was a
 * report on the last grade, so a player was told they were wrong while the wires
 * were still being drawn. Now the columns are the level's declared cases -- laid
 * out before the circuit is built, exactly as the original lays them out -- and
 * the numbers arrive one column at a time from the test run, which is a thing
 * the player asks for.
 *
 * WHERE THE CASES COME FROM is `levels/checks.ts`'s `testCases`, the same
 * derivation the test run plays, so what is on screen before the run is what
 * will be driven during it. A level whose cases the checker generates privately
 * (a `program`'s image, a `custom` hook) has no columns to lay out, and the note
 * beside the heading says so rather than inventing a row.
 *
 * WHICH INPUT IS WHICH. The label column carries the pin's ordinal as well as
 * its name (`输入 1 a`, not `输入 a`), because a board of identical arrows and a
 * table of identical cells give a player no way to tell the second input from
 * the first. A single output drops its ordinal: the original's own panel says
 * `预期输出`, and with one output there is nothing to disambiguate.
 */
export interface TruthTableOptions {
  /** The level's output values right now, or `null` when nothing is running. */
  live(): Readonly<Record<string, number>> | null;
  /** The case the test run is on, or `null` when it is not running. */
  active(): number | null;
  /**
   * What the run has read off the board so far, one entry per case.
   *
   * Held by the caller rather than by the grade, because the grade only records
   * the cases that FAILED: a column that passed would have no number in it, and
   * a table that goes blank wherever the circuit was right is no use to anyone.
   */
  results?(): readonly (Readonly<Record<string, number>> | null)[];
  /** True while the cases are being played. */
  testing?(): boolean;
  /** The play speed, as the button labels it (`2×`). */
  rate?(): string;
  /** Start or stop playing the cases. Absent leaves the button out. */
  onToggleTest?(): void;
  /** Step through the play speeds. Absent leaves the button out. */
  onCycleRate?(): void;
}

/** One column: the vector driven, what was expected and what came out. */
export interface Case {
  readonly inputs: Readonly<Record<string, number>>;
  readonly expected: Readonly<Record<string, number>>;
  readonly actual: Readonly<Record<string, number>> | null;
}

/**
 * How many case columns fit before the matrix stops being readable.
 *
 * A fuzz level may declare hundreds of rounds; the run plays all of them and the
 * table shows the first twenty. Truncating silently would be a lie about the
 * size of the test, so the note beside the heading carries the real count.
 */
const COLUMN_LIMIT = 20;

/**
 * How many cases the run demonstrates one at a time before it hurries.
 *
 * `ch2-37-little-box` declares 513 cases and `ch2-38-counter` 265: at the pace a
 * fifteen-row truth table wants, those are four minutes of watching a counter
 * count, and no one learns anything after the first few seconds. The run is
 * therefore a demonstration with a limit -- the first `TEST_DEMO_LIMIT` cases are
 * played at the chosen speed, and the rest are driven as fast as the browser
 * will take them so that the verdict still arrives. The panel says so, because a
 * demonstration that silently stopped demonstrating would be the same lie as a
 * truncated test.
 *
 * Exported because the run's pacing is `main.ts`'s, and a note that named a
 * different number from the one the run obeys would be worse than no note.
 */
export const TEST_DEMO_LIMIT = 32;

/** Why a level has no columns to lay out, in the panel's own words. */
const NO_CASES: Record<'program' | 'custom' | 'empty', string> = {
  program: '本关的用例是一次程序运行，无法逐列演示',
  custom: '本关的用例由本关自己的检查器生成，无法逐列演示',
  empty: '本关没有可演示的用例',
};

export function mountTruthTable(
  root: HTMLElement,
  store: Store<AppState>,
  options?: TruthTableOptions,
): { render(): void } {
  const panel = document.createElement('section');
  panel.className = 'truth-table';

  // The header is built once and the body is replaced, so the test button keeps
  // its identity across renders: a control that is recreated on every board edit
  // loses the focus and the pressed state a player is watching.
  const head = document.createElement('div');
  head.className = 'case-head';
  const heading = document.createElement('h2');
  // Not `case-note`: that class is the "—" and "???" cell of the matrix, and a
  // header sharing it would make every `td` a match for the header's selectors.
  const note = document.createElement('span');
  note.className = 'case-count';
  const spacer = document.createElement('span');
  spacer.className = 'case-gap';
  head.append(heading, note, spacer);

  const body = document.createElement('div');
  body.className = 'case-body';
  panel.append(head, body);

  const rateButton = document.createElement('button');
  rateButton.type = 'button';
  rateButton.className = 'case-rate';
  if (options?.onCycleRate) {
    rateButton.addEventListener('click', () => options.onCycleRate?.());
    head.append(rateButton);
  }

  const testButton = document.createElement('button');
  testButton.type = 'button';
  testButton.className = 'case-test';
  if (options?.onToggleTest) {
    testButton.addEventListener('click', () => options.onToggleTest?.());
    head.append(testButton);
  }

  root.append(panel);

  /** Level, grade identity and the run's position: nothing else shows. */
  let shown: {
    level: string;
    grade: GradeResult | null;
    active: number | null;
    testing: boolean;
    rate: string;
  } | null = null;
  /** The derived plan, kept until the level changes: levels are static data. */
  let plannedFor = '';
  let plan: TestPlan = { kind: 'none', reason: 'empty' };

  const planFor = (level: LevelSpec): TestPlan => {
    if (plannedFor !== level.id) {
      plannedFor = level.id;
      plan = testCases(level);
    }
    return plan;
  };

  const render = (): void => {
    const { lastGrade, level } = store.get();
    const active = options?.active() ?? null;
    const live = options?.live() ?? null;
    const results = options?.results?.() ?? null;
    const testing = options?.testing?.() ?? false;
    const rate = options?.rate?.() ?? '';
    if (
      shown &&
      shown.level === level.id &&
      shown.grade === lastGrade &&
      shown.active === active &&
      shown.testing === testing &&
      shown.rate === rate
    ) {
      return;
    }
    shown = { level: level.id, grade: lastGrade, active, testing, rate };

    const planned = planFor(level);
    const declared = planned.kind === 'cases' ? planned.cases : [];

    heading.textContent =
      active !== null && declared.length > 0
        ? `正在测试 用例 ${active + 1} / ${declared.length}`
        : !lastGrade
          ? '用例'
          : lastGrade.passed
            ? '全部用例通过'
            : '未通过';
    heading.style.color =
      active !== null
        ? THEME.label
        : !lastGrade
          ? THEME.textMuted
          : lastGrade.passed
            ? THEME.success
            : THEME.error;

    if (planned.kind === 'cases') {
      const total = planned.cases.length;
      // The heading already says 用例, so the note counts them and nothing more.
      const parts = [`共 ${total} 个`];
      if (total > TEST_DEMO_LIMIT) parts.push(`逐帧演示前 ${TEST_DEMO_LIMIT} 个`);
      if (total > COLUMN_LIMIT) parts.push(`显示前 ${COLUMN_LIMIT} 列`);
      note.textContent = parts.join(' · ');
      note.style.color = THEME.textMuted;
    } else {
      note.textContent = NO_CASES[planned.reason];
      note.style.color = THEME.textMuted;
    }

    testButton.textContent = testing ? '停止' : '测试';
    testButton.setAttribute('aria-pressed', String(testing));
    testButton.title = testing ? '停止测试' : '逐个播放本关用例，最后给出判定';
    rateButton.textContent = rate;
    rateButton.title = `测试速度 ${rate}`;

    body.replaceChildren();

    // Two kinds of failure have no column to sit in, and they are reported
    // whatever else the panel is showing. A graph-level error stops the checker
    // before it can produce a single failing row, and `unstable` is raised by
    // `settle` before any vector is driven -- `unstable` in particular is the one
    // failure the matrix can never express, because every cell of it would read
    // `???` for the same reason, which looks like "not run yet".
    const error = lastGrade?.issues.find((issue) => issue.severity === 'error');
    if (error) body.append(noteLine(error.message.zh, 'case-error'));
    for (const failure of lastGrade?.failures ?? []) {
      if (hasVector(failure)) continue;
      body.append(noteLine(`${failure.reason ?? 'failure'}: ${failure.detail ?? 'no detail'}`));
    }

    if (declared.length > 0) {
      // A grade can be rendered without the caller's run records: the failures
      // it carries name the vector they drove, which is enough to give that
      // column its number. The run's own records win when they exist, because
      // they cover the cases that PASSED as well.
      const recorded = new Map<string, CheckFailure>();
      for (const failure of lastGrade?.failures ?? []) {
        if (hasVector(failure)) recorded.set(vectorKey(failure.inputs), failure);
      }
      renderMatrix(
        body,
        level,
        declared.slice(0, COLUMN_LIMIT).map((item, index) => ({
          inputs: item.inputs,
          expected: item.expected,
          actual:
            actualOf(index, active, live, results) ??
            recorded.get(vectorKey(item.inputs))?.actual ??
            null,
        })),
        active,
      );
      return;
    }

    // No playable list: a `program` or `custom` level still has to show what its
    // checker found.
    const driven = (lastGrade?.failures ?? []).filter(hasVector).slice(0, COLUMN_LIMIT);
    renderMatrix(
      body,
      level,
      driven.map((failure) => ({
        inputs: failure.inputs,
        expected: failure.expected,
        actual: failure.actual,
      })),
      active,
    );
  };
  store.subscribe(render);
  render();
  return { render };
}

/**
 * The value to show for one case's output pins: the live board while the run is
 * ON that case -- which is the whole point of playing them one at a time -- and
 * the run's own record otherwise. `null` before anything has been run.
 */
function actualOf(
  index: number,
  active: number | null,
  live: Readonly<Record<string, number>> | null,
  results: readonly (Readonly<Record<string, number>> | null)[] | null,
): Readonly<Record<string, number>> | null {
  if (index === active && live) return live;
  return results?.[index] ?? null;
}

/** True when a failure recorded a vector it can be rendered pin by pin. */
function hasVector(failure: CheckFailure): boolean {
  return Object.keys(failure.inputs).length > 0 || Object.keys(failure.expected).length > 0;
}

/**
 * A case's input vector as one string, so a failure record can be matched to the
 * column it came from.
 *
 * Matching on the vector rather than on the position is what makes it correct:
 * a check records only the cases that FAILED, so the third failure is usually
 * not the third case, and every pin is included in the key because two cases
 * that drove the same thing are the same case.
 */
function vectorKey(inputs: Readonly<Record<string, number>>): string {
  return Object.keys(inputs)
    .sort()
    .map((key) => `${key}=${inputs[key]}`)
    .join(',');
}

function renderMatrix(
  panel: HTMLElement,
  level: LevelSpec,
  cases: readonly Case[],
  active: number | null,
): void {
  const table = document.createElement('table');
  const inputs = level.io.inputs;
  const outputs = level.io.outputs;
  const manyOutputs = outputs.length > 1;
  // Which row is the table's first, so the active column's band can be rounded
  // at its ends: a level with no input pins starts on its expectations.
  const startsOnOutputs = inputs.length === 0;

  for (const [position, pin] of inputs.entries()) {
    const row = document.createElement('tr');
    row.append(labelCell(`输入 ${position + 1} ${pinName(pin)}`.trim()));
    for (const [index, item] of cases.entries()) {
      const cell = bitsCell(item.inputs[pin.id] ?? 0, pin.width);
      if (disagrees(item, pin)) cell.classList.add('case-bad', 'bad-cap-top', 'bad-cap-bottom');
      // While the run is on a case, that case's column is the one being driven:
      // the board is showing it and the reader's eye has to follow.
      if (index === active) {
        cell.classList.add('case-active');
        if (position === 0) cell.classList.add('cap-top');
      }
      row.append(cell);
    }
    if (cases.length === 0) row.append(noteCell(inputs.length ? '—' : ''));
    table.append(row);
  }

  for (const [position, pin] of outputs.entries()) {
    const ordinal = manyOutputs ? ` ${position + 1}` : '';
    const expected = document.createElement('tr');
    expected.append(labelCell(`预期${ordinal} ${pinName(pin)}`.trim()));
    const actual = document.createElement('tr');
    actual.append(labelCell(`当前${ordinal} ${pinName(pin)}`.trim()));

    for (const [index, item] of cases.entries()) {
      // THE PAIR IS WRONG TOGETHER, so it is boxed together: what the level asked
      // for on top, what came out below, one red block. Boxing only the `当前`
      // cell said "this is wrong" but made the reader find the expectation again
      // two rows up; the two cells are adjacent for every pin, so the box is
      // simply both of them.
      const wrong = disagrees(item, pin);

      const want = item.expected[pin.id];
      const expectedCell = want === undefined ? noteCell('—') : bitsCell(want, pin.width);
      if (wrong) expectedCell.classList.add('case-bad', 'bad-cap-top');
      if (index === active) {
        expectedCell.classList.add('case-active');
        if (position === 0 && startsOnOutputs) expectedCell.classList.add('cap-top');
      }
      expected.append(expectedCell);

      const got = item.actual?.[pin.id];
      const actualCell = got === undefined ? unknownCell(pin.width) : bitsCell(got, pin.width);
      if (wrong) actualCell.classList.add('case-bad', 'bad-cap-bottom');
      if (index === active) {
        actualCell.classList.add('case-active');
        if (position === outputs.length - 1) actualCell.classList.add('cap-bottom');
      }
      actual.append(actualCell);
    }
    if (cases.length === 0) {
      expected.append(noteCell('—'));
      actual.append(unknownCell(pin.width));
    }
    table.append(expected, actual);
  }

  panel.append(table);
}

/**
 * True when this case's recorded output disagreed with what the level expected.
 *
 * Only a pin the case states an expectation for can be wrong, which is what
 * keeps an input cell from being outlined red because the OUTPUT was wrong: the
 * driver of a failing case is not a mistake.
 */
function disagrees(item: Case, pin: PinSpec): boolean {
  if (!item.actual) return false;
  const want = item.expected[pin.id];
  const got = item.actual[pin.id];
  return want !== undefined && got !== undefined && got !== want;
}

function noteLine(text: string, className = 'case-detail'): HTMLParagraphElement {
  const p = document.createElement('p');
  p.className = className;
  p.textContent = text;
  return p;
}

function labelCell(text: string): HTMLTableCellElement {
  const cell = document.createElement('th');
  cell.className = 'case-label';
  cell.textContent = text;
  return cell;
}

function noteCell(text: string): HTMLTableCellElement {
  const cell = document.createElement('td');
  cell.className = 'case-note';
  cell.textContent = text;
  return cell;
}

/**
 * One pin's bits for one case, most significant first.
 *
 * No text: the cell is the bits. `panels.test.ts` reads every `td` in the panel
 * to prove a failure that drove no vector fabricates no `0`, and a bit cell that
 * also spelled its value out would defeat that reading.
 *
 * The cell is also the BOX. A highlight is a translucent fill on the `td` itself
 * rather than a ring around the bits inside it, so a column's cells stack into
 * one continuous band instead of a ladder of little outlines -- see `.case-active`
 * and `.case-bad` in `style.css`, and the `cap-top`/`cap-bottom` classes the
 * caller adds to round the two ends.
 */
function bitsCell(value: number, width: number): HTMLTableCellElement {
  const cell = document.createElement('td');
  const box = document.createElement('span');
  box.className = 'case-cell';
  for (const bit of bitsOf(value, width)) box.append(bitElement(bit));
  cell.append(box);
  return cell;
}

/**
 * A cell for a value that has not been read yet: one NEUTRAL dot per bit.
 *
 * It used to be the literal text `???`, which was three problems at once. It said
 * the same thing in every column of a sixteen-case table, so a row of them was a
 * wall of punctuation where a row of dots is a row of "nothing here yet". It was
 * the wrong KIND of thing -- these cells hold bits, and the readout panel beside
 * the board had already settled what an unknown bit looks like: a plain grey dot,
 * no point, which is the honest shape for "no direction known yet". And it was
 * the only place in the game that spelled a state out in words instead of drawing
 * it.
 *
 * The third bit state is not invented here: `bit.ts` has carried `'x'` since the
 * input readout needed it. This is the test matrix learning the same vocabulary.
 */
function unknownCell(width: number): HTMLTableCellElement {
  const cell = document.createElement('td');
  const box = document.createElement('span');
  box.className = 'case-cell';
  for (let i = 0; i < width; i += 1) box.append(bitElement('x'));
  cell.append(box);
  return cell;
}

function pinName(pin: PinSpec): string {
  return pin.label?.zh ?? pin.id;
}
