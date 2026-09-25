import type { AppState, Store } from '../app/store';
import type { GradeResult } from '../levels/grader';
import { THEME } from './theme';

/**
 * The level's test cases: a pass banner with the three metrics, or the rows the
 * circuit got wrong, each showing the input vector and `actual ≠ expected`.
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

    if (!lastGrade) return;

    if (lastGrade.passed) {
      const p = document.createElement('p');
      p.textContent = `门 ${lastGrade.metrics.gate} · 延迟 ${lastGrade.metrics.delay} · 拍 ${lastGrade.metrics.tick}`;
      panel.append(p);
      return;
    }

    // A graph-level error stops the checker before it can produce a single
    // failing row, so say what the error was instead of showing an empty panel.
    const error = lastGrade.issues.find((issue) => issue.severity === 'error');
    if (error) {
      const p = document.createElement('p');
      p.textContent = error.message.zh;
      p.style.color = THEME.error;
      panel.append(p);
    }

    if (lastGrade.failures.length === 0) return;

    const table = document.createElement('table');
    const header = document.createElement('tr');
    for (const pin of level.io.inputs) header.append(cell('th', pin.id));
    for (const pin of level.io.outputs) header.append(cell('th', pin.id));
    table.append(header);

    for (const failure of lastGrade.failures.slice(0, rowLimit)) {
      const row = document.createElement('tr');
      for (const pin of level.io.inputs) row.append(cell('td', String(failure.inputs[pin.id] ?? 0)));
      for (const pin of level.io.outputs) {
        const want = failure.expected[pin.id];
        const got = failure.actual[pin.id];
        const c = cell('td', want === undefined ? String(got ?? 0) : `${got ?? 0} ≠ ${want}`);
        if (want !== undefined && got !== want) c.style.color = THEME.error;
        row.append(c);
      }
      table.append(row);
    }
    panel.append(table);
  };
  store.subscribe(render);
  render();
  return { render };
}

function cell(tag: 'td' | 'th', text: string): HTMLTableCellElement {
  const el = document.createElement(tag);
  el.textContent = text;
  return el;
}
