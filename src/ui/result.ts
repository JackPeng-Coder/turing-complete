/**
 * 通关对话框：关卡解锁了什么、电路代价多少，以及继续前进的入口。
 *
 * 它只负责渲染，是否显示由调用方决定；三星时多一枚奖杯。
 * 尾声文本来自 `ui/narrative.ts`，颜色来自 `ui/theme.ts`。
 */
import type { ComponentDef, Registry } from '../core/registry';
import type { GradeResult } from '../levels/grader';
import type { LevelSpec } from '../levels/spec';
import { narrativeFor } from './narrative';
import { THEME } from './theme';

export interface ResultOptions {
  /** 留在本关并关闭对话框。 */
  onContinue(): void;
  /** 打开下一关。 */
  onNext(): void;
  /** 最后一关为 false：此时按钮直接不画，而不是画成禁用。 */
  hasNext: boolean;
}

/**
 * 通关对话框，采用如下内容构成：本关解锁了什么、电路代价的小结，以及继续前进的方式。
 *
 * 每次访问只显示一次。它曾经是关卡的尾声，每次仍然通过的 `regrade()` 都会重放——
 * 也就是首次通关之后的每次编辑都会重放，于是对话框每点一下就重新出现。
 * 现在是否显示由调用方决定（`main.ts` 在本次访问首次通关时显示，之后不再显示），
 * 本模块只负责渲染。
 *
 * 只有三星才出现奖杯，别的什么都不出现：一星通过的关卡已经由状态栏的星数告诉玩家可以更好，
 * 而每种结果都发一枚徽章，等于给「什么都没达成」也发徽章。
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

  // -- 标题栏 ---------------------------------------------------------------
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

  // -- 左侧：解锁了什么，以及它花了多少 -------------------------------------
  const left = document.createElement('div');
  left.className = 'result-left';

  left.append(heading('解锁内容'));
  const unlocks = document.createElement('div');
  unlocks.className = 'result-unlocks';
  const rewarded = (level.rewards?.components ?? []).filter((id) => registry.has(id));
  for (const id of rewarded) unlocks.append(chip(registry.get(id)));
  if (rewarded.length === 0) {
    // 关卡可以什么都不发，仍然值得通关：压轴关卡靠跑程序来检查，而不是靠发新元件。
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
    // 唯一一个玩家会与自己较劲的数字，而且它是代价：越低越好，
    // 所以这里称它为「总开销」而不是分数。
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

  // -- 右侧：奖牌，以及继续前进的入口 ---------------------------------------
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
 * 从检查方式推导关卡类型。
 *
 * 用推导而不是声明：给每个关卡加一个 `kind` 字段，就是第二个需要与 `checks`
 * 保持同步的东西；而检查本身就是类型——它就是关卡会对玩家电路做的事。
 * 第一个检查代表整个关卡；一个既跑真值表又做随机验证的关卡，
 * 算作「也做随机验证的真值表关卡」。
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

/** 关卡发放的元件，按芯片徽章的样子绘制。 */
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
