import type { AppState, Store } from '../app/store';
import type { GradeResult } from '../levels/grader';
import type { CheckFailure, LevelSpec, PinSpec } from '../levels/spec';
import { bitsOf, bitElement } from './bit';
import { THEME } from './theme';

/**
 * The level's test cases, as the original's bottom panel: one row per pin, one
 * column per test case, and one cell per pin -- a red cell for a 0, a green one
 * for a 1, olive while nothing is known.
 *
 * The panel is a matrix rather than a list of failing vectors because that is
 * what the original shows and because it answers the question a player actually
 * has -- "which bit is wrong" -- without reading a number. The precise numeric
 * comparison is not lost: a mismatching output gets a `1 ≠ 0` line under the
 * matrix, which is also the report `panels.test.ts` pins.
 *
 * WHERE THE CASES COME FROM depends on how far the player has got:
 *
 *   * graded and failed: the failures themselves, which carry the vector driven,
 *     what was expected and what came out. This is the only state with all three.
 *   * not graded yet, on a `truth-table` level: the level's own declared rows.
 *     The expectations are known before the circuit is built -- which is exactly
 *     the original's screenshot, expectations filled in and the current output
 *     blank -- and nothing is invented for the output side.
 *   * not graded, on any other kind of level: no columns at all, and `???` where
 *     the output would be. A level whose check drives a program or a script has
 *     no static rows to preview, and a fabricated row would be a lie.
 *
 * Reporting is capped: a failing 16-row level must not turn the panel into a
 * wall of text, and the first wrong rows are the ones that explain the bug.
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
  /** The case the auto-test is on, or `null` when it is not running. */
  active(): number | null;
}

export function mountTruthTable(
  root: HTMLElement,
  store: Store<AppState>,
  options?: TruthTableOptions,
): { render(): void } {
  const panel = document.createElement('section');
  panel.className = 'truth-table';
  root.append(panel);

  const rowLimit = 20;
  /** Level id, grade identity and the auto-test's position: nothing else shows. */
  let shown: { level: string; grade: GradeResult | null; active: number | null } | null = null;

  const render = (): void => {
    const { lastGrade, level } = store.get();
    const active = options?.active() ?? null;
    const live = options?.live() ?? null;
    if (shown && shown.level === level.id && shown.grade === lastGrade && shown.active === active) {
      return;
    }
    shown = { level: level.id, grade: lastGrade, active };

    panel.replaceChildren();
    const heading = document.createElement('h2');
    heading.textContent = active !== null ? `正在测试 用例 ${active + 1}` : lastGrade?.passed ? '全部用例通过' : '用例';
    heading.style.color =
      active !== null
        ? THEME.label
        : !lastGrade
          ? THEME.textMuted
          : lastGrade.passed
            ? THEME.success
            : THEME.error;
    panel.append(heading);

    if (!lastGrade) {
      renderMatrix(panel, level, staticCases(level), [], active, live);
      return;
    }

    if (lastGrade.passed) {
      const p = document.createElement('p');
      p.className = 'case-pass';
      p.textContent = `门 ${lastGrade.metrics.gate} 个 · 延迟 ${lastGrade.metrics.delay} · 拍 ${lastGrade.metrics.tick}`;
      panel.append(p);
      return;
    }

    // A graph-level error stops the checker before it can produce a single
    // failing row, so say what the error was instead of showing an empty panel.
    const error = lastGrade.issues.find((issue) => issue.severity === 'error');
    if (error) {
      const p = document.createElement('p');
      p.className = 'case-error';
      p.textContent = error.message.zh;
      panel.append(p);
    }

    const driven = lastGrade.failures.filter((f) => hasVector(f));
    const undriven = lastGrade.failures.filter((f) => !hasVector(f));
    renderMatrix(panel, level, driven.slice(0, rowLimit), driven.slice(0, rowLimit), active, live);
    renderDetails(panel, driven.slice(0, rowLimit), undriven);
  };
  store.subscribe(render);
  render();
  return { render };
}

/**
 * One column of the matrix: the vector driven, what was expected and what came
 * out. `actual` is absent when the circuit has not been run against this case.
 */
export interface Case {
  readonly inputs: Readonly<Record<string, number>>;
  readonly expected: Readonly<Record<string, number>>;
  readonly actual: Readonly<Record<string, number>> | null;
}

/**
 * The level's own declared rows, before anything has been graded.
 *
 * Only a `truth-table` check has rows to show. A `fuzz`, `script` or `program`
 * check drives vectors that are computed from a seed or from step data, so there
 * is nothing static to put in a column.
 *
 * Exported because the auto-test plays exactly these: a second derivation of
 * "the cases this level declares" would be a second thing to keep in step with
 * the checker, and the checker's rows are the ones that count.
 */
export function staticCases(level: LevelSpec): Case[] {
  for (const check of level.checks) {
    if (check.kind !== 'truth-table') continue;
    return (check.rows ?? []).map((row) => ({
      inputs: row.inputs,
      expected: row.outputs,
      actual: null,
    }));
  }
  return [];
}

/** True when a failure recorded a vector it can be rendered pin by pin. */
function hasVector(failure: CheckFailure): boolean {
  return Object.keys(failure.inputs).length > 0 || Object.keys(failure.expected).length > 0;
}

function renderMatrix(
  panel: HTMLElement,
  level: LevelSpec,
  cases: readonly Case[],
  represented: readonly CheckFailure[],
  active: number | null,
  live: Readonly<Record<string, number>> | null,
): void {
  const table = document.createElement('table');
  const inputs = level.io.inputs;
  const outputs = level.io.outputs;
  const manyOutputs = outputs.length > 1;

  for (const [position, pin] of inputs.entries()) {
    const row = document.createElement('tr');
    row.append(labelCell(`输入 ${position + 1} ${pinName(pin)}`.trim()));
    for (const [index, item] of cases.entries()) {
      // While the auto-test is on a case, that case's column is the one being
      // driven: the board is showing it and the reader's eye has to follow.
      const cell = bitsCell(item.inputs[pin.id] ?? 0, pin.width, isWrong(represented[index], pin));
      if (index === active) cell.classList.add('case-active');
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
      const want = item.expected[pin.id];
      const expectedCell =
        want === undefined ? noteCell('—') : bitsCell(want, pin.width, false);
      if (index === active) expectedCell.classList.add('case-active');
      expected.append(expectedCell);

      // While the auto-test is ON THIS CASE, `当前` is what the circuit is
      // producing for it right now, read off the live board -- which is the
      // whole point of playing the cases one at a time. Otherwise it is the
      // last grade's own record, and unknown when there has not been one.
      const got = index === active && live ? live[pin.id] : item.actual?.[pin.id];
      const bad =
        index === active && live
          ? want !== undefined && got !== want
          : represented[index] !== undefined && got !== want;
      const actualCell = got === undefined ? noteCell('???') : bitsCell(got, pin.width, bad);
      if (index === active) actualCell.classList.add('case-active');
      actual.append(actualCell);
    }
    if (cases.length === 0) {
      expected.append(noteCell('???'));
      actual.append(noteCell('???'));
    }
    table.append(expected, actual);
  }

  panel.append(table);
}

/** True when this failure's `actual` disagreed with its `expected` for a pin. */
function isWrong(failure: CheckFailure | undefined, pin: PinSpec): boolean {
  if (!failure) return false;
  const got = failure.actual[pin.id];
  const want = failure.expected[pin.id];
  return want !== undefined && got !== want;
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
 */
function bitsCell(value: number, width: number, wrong: boolean): HTMLTableCellElement {
  const cell = document.createElement('td');
  const box = document.createElement('span');
  box.className = wrong ? 'case-cell case-bad' : 'case-cell';
  for (const bit of bitsOf(value, width)) box.append(bitElement(bit));
  cell.append(box);
  return cell;
}

function pinName(pin: PinSpec): string {
  return pin.label?.zh ?? pin.id;
}
/**
 * The numeric record under the matrix: one line per failing case naming every
 * output pin that disagreed, and one line per failure that never drove a vector.
 *
 * The second kind is why this exists. `unstable` is raised by `settle` before any
 * vector is driven, so all three maps are empty; the matrix has nothing to show
 * and the reason has to be said in words.
 */
function renderDetails(
  panel: HTMLElement,
  cases: readonly Case[],
  undriven: readonly CheckFailure[],
): void {
  for (const [index, item] of cases.entries()) {
    const wrong: string[] = [];
    for (const [pin, want] of Object.entries(item.expected)) {
      const got = item.actual?.[pin];
      if (got !== undefined && got !== want) wrong.push(`${pin}: ${got} ≠ ${want}`);
    }
    if (wrong.length === 0) continue;
    const p = document.createElement('p');
    p.className = 'case-detail';
    p.textContent = `用例 ${index + 1} · ${wrong.join(' · ')}`;
    panel.append(p);
  }

  for (const failure of undriven) {
    const p = document.createElement('p');
    p.className = 'case-detail';
    p.textContent = `${failure.reason ?? 'failure'}: ${failure.detail ?? 'no detail'}`;
    panel.append(p);
  }
}
