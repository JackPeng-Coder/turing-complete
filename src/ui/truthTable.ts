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
 */
export function mountTruthTable(root: HTMLElement, store: Store<AppState>): { render(): void } {
  const panel = document.createElement('section');
  panel.className = 'truth-table';
  root.append(panel);

  const rowLimit = 20;
  /** Level id plus grade identity: the panel shows nothing else. */
  let shown: { level: string; grade: GradeResult | null } | null = null;

  const render = (): void => {
    const { lastGrade, level } = store.get();
    if (shown && shown.level === level.id && shown.grade === lastGrade) return;
    shown = { level: level.id, grade: lastGrade };

    panel.replaceChildren();
    const heading = document.createElement('h2');
    heading.textContent = lastGrade?.passed ? '全部用例通过' : '用例';
    heading.style.color = !lastGrade
      ? THEME.textMuted
      : lastGrade.passed
        ? THEME.success
        : THEME.error;
    panel.append(heading);

    if (!lastGrade) {
      renderMatrix(panel, level, staticCases(level), []);
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
    renderMatrix(panel, level, driven.slice(0, rowLimit), driven.slice(0, rowLimit));
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
interface Case {
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
 */
function staticCases(level: LevelSpec): Case[] {
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
): void {
  const table = document.createElement('table');
  const inputs = level.io.inputs;
  const outputs = level.io.outputs;

  for (const pin of inputs) {
    const row = document.createElement('tr');
    row.append(labelCell(`输入 ${pinName(pin)}`));
    for (const [index, item] of cases.entries()) {
      row.append(bitsCell(item.inputs[pin.id] ?? 0, pin.width, isWrong(represented[index], pin)));
    }
    if (cases.length === 0) row.append(noteCell(inputs.length ? '—' : ''));
    table.append(row);
  }

  for (const pin of outputs) {
    const expected = document.createElement('tr');
    expected.append(labelCell(`预期 ${pinName(pin)}`));
    const actual = document.createElement('tr');
    actual.append(labelCell(`当前 ${pinName(pin)}`));

    for (const [index, item] of cases.entries()) {
      const want = item.expected[pin.id];
      expected.append(
        want === undefined ? noteCell('—') : bitsCell(want, pin.width, false),
      );
      const got = item.actual?.[pin.id];
      const bad = represented[index] !== undefined && got !== want;
      actual.append(
        got === undefined ? noteCell('???') : bitsCell(got, pin.width, bad),
      );
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
