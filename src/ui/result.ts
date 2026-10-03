import type { ComponentDef, Registry } from '../core/registry';
import type { GradeResult } from '../levels/grader';
import type { LevelSpec } from '../levels/spec';
import { narrativeFor } from './narrative';
import { THEME } from './theme';

export interface ResultOptions {
  /** Stay on this level and close the dialog. */
  onContinue(): void;
  /** Open the next level. */
  onNext(): void;
  /** False on the last level, where the button is left out rather than dead. */
  hasNext: boolean;
}

/**
 * The pass dialog, with the original's own contents: what the level unlocked,
 * a summary of what the circuit cost, and a way onward.
 *
 * IT IS SHOWN ONCE PER VISIT. It used to be the level's epilogue, re-shown by
 * every `regrade()` that still passed -- which is every edit after the first
 * pass, so the dialog reappeared on every click. Whether to show it is now the
 * caller's decision (`main.ts` shows it on the first pass of a visit and never
 * again), and this module only renders.
 *
 * A trophy appears for three stars and nothing else does: a level that passed
 * with one star has already been told it can do better by the star count in the
 * top bar, and a badge for every outcome would mean a badge for nothing.
 */
export function showResult(
  level: LevelSpec,
  grade: GradeResult,
  registry: Registry,
  options: ResultOptions,
): void {
  document.querySelector('.result')?.remove();

  const overlay = document.createElement('div');
  overlay.className = 'result';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-label', '关卡结果');

  const card = document.createElement('div');
  card.className = 'result-card';

  // -- title bar -----------------------------------------------------------
  const bar = document.createElement('header');
  bar.className = 'result-bar';
  const barTitle = document.createElement('span');
  barTitle.textContent = '解锁内容';
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'result-close';
  close.textContent = '✕';
  close.setAttribute('aria-label', '关闭');
  close.addEventListener('click', () => options.onContinue());
  bar.append(barTitle, close);

  // -- left: what was unlocked, and what it cost ---------------------------
  const left = document.createElement('div');
  left.className = 'result-left';

  left.append(heading('解锁内容'));
  const unlocks = document.createElement('div');
  unlocks.className = 'result-unlocks';
  const rewarded = (level.rewards?.components ?? []).filter((id) => registry.has(id));
  for (const id of rewarded) unlocks.append(chip(registry.get(id)));
  if (rewarded.length === 0) {
    // A level can hand out nothing and still be worth finishing: the capstone
    // levels are checked by running a program, not by a new part.
    unlocks.append(hint('本关不解锁新元件'));
  }
  if (grade.stars >= 3) unlocks.append(trophy());
  left.append(unlocks);

  left.append(heading('关卡小结'));
  const summary = document.createElement('dl');
  summary.className = 'result-summary';
  for (const [term, value] of [
    ['关卡', `${level.chapter}-${level.index} ${level.name.zh}`],
    ['关卡类型', levelKind(level)],
    ['门数量', String(grade.metrics.gate)],
    ['总延迟', String(grade.metrics.delay)],
    // The one number a player competes with themselves on, and a COST: lower is
    // better, which is why the original calls it 总开销 and not a score.
    ['总开销', String(grade.score)],
    ['评级', grade.stars > 0 ? '★'.repeat(grade.stars) : '未通过'],
  ] as const) {
    const dt = document.createElement('dt');
    dt.textContent = term;
    const dd = document.createElement('dd');
    dd.textContent = value;
    summary.append(dt, dd);
  }
  left.append(summary);

  const story = document.createElement('p');
  story.className = 'result-story';
  story.textContent = narrativeFor(level.id).after.zh;
  left.append(story);

  // -- right: the medal and the ways onward --------------------------------
  const right = document.createElement('div');
  right.className = 'result-right';
  const medal = document.createElement('div');
  medal.className = 'result-medal';
  medal.append(checkMark());
  const verdict = document.createElement('p');
  verdict.className = 'result-verdict';
  verdict.textContent = grade.stars >= 3 ? '关卡完成 · 三星' : '关卡完成';
  right.append(medal, verdict);

  const actions = document.createElement('div');
  actions.className = 'result-actions';
  const next = document.createElement('button');
  next.type = 'button';
  next.className = 'result-next';
  next.textContent = '下一关';
  next.disabled = !options.hasNext;
  next.addEventListener('click', () => options.onNext());
  const stay = document.createElement('button');
  stay.type = 'button';
  stay.className = 'result-continue';
  stay.textContent = '继续';
  stay.addEventListener('click', () => options.onContinue());
  actions.append(next, stay);
  right.append(actions);

  card.append(bar, left, right);
  overlay.append(card);
  document.body.append(overlay);
}

/**
 * What kind of puzzle a level is, from how it is checked.
 *
 * Derived rather than declared: a `kind` field on every level would be a second
 * thing to keep in step with `checks`, and the check IS the type -- it is what
 * the level will do to the player's circuit. The first check speaks for the
 * level; a level that both tables and fuzzes is a table level that also fuzzes.
 */
function levelKind(level: LevelSpec): string {
  switch (level.checks[0]?.kind) {
    case 'truth-table':
      return '真值表关卡';
    case 'fuzz':
      return '随机验证关卡';
    case 'script':
      return '时序关卡';
    case 'program':
      return '程序关卡';
    case 'constraint':
      return '结构关卡';
    default:
      return '综合关卡';
  }
}

function heading(text: string): HTMLElement {
  const h = document.createElement('h3');
  h.className = 'result-heading';
  h.textContent = text;
  return h;
}

function hint(text: string): HTMLElement {
  const p = document.createElement('span');
  p.className = 'result-hint';
  p.textContent = text;
  return p;
}

/** The component a level hands out, drawn as the original's chip badge. */
function chip(def: ComponentDef): HTMLElement {
  const box = document.createElement('span');
  box.className = 'result-chip';
  box.title = `${def.name.zh} — ${def.name.en}`;
  const short = document.createElement('b');
  short.textContent = def.name.en;
  const label = document.createElement('span');
  label.textContent = def.name.zh;
  box.append(short, label);
  return box;
}

function trophy(): HTMLElement {
  const box = document.createElement('span');
  box.className = 'result-trophy';
  box.title = '三星达成';
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', 'M7 4h10v5a5 5 0 0 1-10 0zM7 6H4v2a3 3 0 0 0 3 3M17 6h3v2a3 3 0 0 1-3 3M12 14v4M8 20h8');
  svg.append(path);
  box.append(svg);
  return box;
}

function checkMark(): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', THEME.text);
  svg.setAttribute('stroke-width', '3');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', 'M5 13l4 4L19 7');
  svg.append(path);
  return svg;
}
