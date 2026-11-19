import type { AppState, Store } from '../app/store';
import type { GradeResult } from '../levels/grader';
import type { CheckFailure, LevelSpec, PinSpec } from '../levels/spec';
import { testCases, type TestPlan } from '../levels/checks';
import { bitsOf, bitElement } from './bit';
import { THEME } from './theme';

/**
 * 关卡的测试用例，按底部面板的样子显示：每个引脚一行、每个用例一列，
 * 每个引脚占一格——0 显示红格、1 显示绿格、尚不知道时显示橄榄色。
 *
 * 面板做成矩阵而不是"失败向量列表"，既因为这样显示最直观，也因为它直接回答
 * 玩家真正关心的问题——"哪一位错了、错在哪个用例"——而不必去读数字。
 *
 * 面板只负责"排版计划"，不负责判定。三个版本之前，这个文件给每个失败用例
 * 打印一行文字（`用例 3 · out3: 0 ≠ 1`），在十五行的关卡上就是十五句同样的话：
 * 无法阅读，而且玩家越需要它越难读。之后的版本改成"上一次判定的报告"，
 * 于是玩家在导线还没画完时就被宣判错误。现在列来自关卡声明的用例——
 * 在电路建好之前就排好，保持一致——数字则在玩家主动发起测试后一列一列地到来。
 *
 * 用例从哪来：`levels/checks.ts` 的 `testCases`，与测试运行播放的是同一份推导，
 * 所以运行前屏幕上排出的列，就是运行中会被驱动的列。如果某个关卡的用例由检查器
 * 私有生成（`program` 的程序映像、`custom` 钩子），就没有列可排，
 * 标题旁的说明会如实写出这一点，而不是凭空造一行。
 *
 * 哪个输入是哪个。标签列带上引脚的序号和名字（`输入 1 a`，而不是 `输入 a`），
 * 因为画板上一串一模一样的箭头、表格里一格一模一样的格子，会让玩家分不清
 * 第二个输入和第一个输入。只有一个输出时省略序号：面板自己就写
 * `预期输出`，而且只有一个输出时也没有什么可区分的。
 */

/** 真值表面板的挂载选项：宿主之外的读数与操作都从这里注入。 */
export interface TruthTableOptions {
  /** 关卡输出此刻的值；没有在运行时为 `null`。 */
  live(): Readonly<Record<string, number>> | null;
  /** 测试运行当前所在的用例下标；未运行时为 `null`。 */
  active(): number | null;
  /**
   * 本次运行到目前为止从画板上读到的结果，每个用例一项。
   *
   * 由调用方持有而不是由判定结果持有，因为判定只记录失败的用例：
   * 通过的列会在表里留空，而一张"电路对的地方就变空白"的表对谁都没用。
   */
  results?(): readonly (Readonly<Record<string, number>> | null)[];
  /** 用例正在播放中时为 true。 */
  testing?(): boolean;
  /** 播放速度，与按钮上的标签一致（例如 `2×`）。 */
  rate?(): string;
  /** 开始或停止播放用例；不提供时按钮不出现。 */
  onToggleTest?(): void;
  /** 在几档播放速度之间切换；不提供时按钮不出现。 */
  onCycleRate?(): void;
}

/** 一列：驱动了哪个输入向量、期望什么、实际得到什么。 */
export interface Case {
  readonly inputs: Readonly<Record<string, number>>;
  readonly expected: Readonly<Record<string, number>>;
  readonly actual: Readonly<Record<string, number>> | null;
}

/**
 * 矩阵还能读得下去时最多排多少列用例。
 *
 * 模糊测试类关卡可能声明几百轮；运行会把它们全部播完，而表格只显示前 20 个。
 * 悄悄截断等于对测试规模撒谎，所以标题旁的说明会写出真实总数。
 */
const COLUMN_LIMIT = 20;

/**
 * 运行逐帧演示多少个用例之后开始加速。
 *
 * `ch2-38-little-box` 声明了 513 个用例，`ch2-39-counter` 有 265 个：
 * 按十五行真值表想要的节奏，那就是盯着计数器数四分钟，
 * 而头几秒之后没人还能学到东西。因此运行是"有上限的演示"——
 * 前 `TEST_DEMO_LIMIT` 个用例按选定速度播放，其余用例以浏览器能接受的最快速度驱动，
 * 好让判定结果仍然能出来。面板会说明这一点，因为"悄悄停止演示"的演示
 * 与"被截断的测试"是同一种谎言。
 *
 * 之所以导出，是因为运行的节奏由 `main.ts` 控制；若说明里写的数字与运行实际遵守的
 * 数字不一致，那还不如不写说明。
 */
export const TEST_DEMO_LIMIT = 32;

/** 关卡为什么没有列可排——用面板自己的说法记录。 */
const NO_CASES: Record<'program' | 'custom' | 'empty', string> = {
  program: '本关的用例是一次程序运行，无法逐列演示',
  custom: '本关的用例由本关自己的检查器生成，无法逐列演示',
  empty: '本关没有可演示的用例',
};

/**
 * 挂载真值表面板，并订阅 store：关卡改变、判定改变或测试运行推进时重绘。
 *
 * 用例列表来自 testCases(level) 的推导，只负责排版与展示；真正的判定
 * 由 levels/grader 完成，面板只读取判定结果与运行记录（见 TruthTableOptions）。
 */
export function mountTruthTable(
  root: HTMLElement,
  store: Store<AppState>,
  options?: TruthTableOptions,
): { render(): void } {
  const panel = document.createElement('section');
  panel.className = 'truth-table';

  // 表头只建一次，表体每次替换，这样测试按钮在多次重绘之间保持同一个节点：
  // 若控件在每次画板编辑时重建，就会丢掉焦点和玩家正在看的按下状态。
  const head = document.createElement('div');
  head.className = 'case-head';
  const heading = document.createElement('h2');
  // 不用 `case-note`：那个类是矩阵里 "—" 和 "???" 单元格的类名，
  // 表头若也用它，所有 `td` 都会命中表头的选择器。
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

  /** 上次绘制依据的关卡、判定身份和运行位置：除此之外的变化不触发重绘。 */
  let shown: {
    level: string;
    grade: GradeResult | null;
    active: number | null;
    testing: boolean;
    rate: string;
  } | null = null;
  /** 推导出的测试计划，缓存到关卡改变为止：关卡是静态数据。 */
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
      // 标题已经写了「用例」，所以说明里只数个数，不再重复别的。
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

    // 有两类失败没有列可以安放，而且无论面板正在显示什么都要报出来。
    // 图级错误会让检查器在产出第一行失败记录之前就停下；`unstable` 则由
    // `settle` 在驱动任何向量之前抛出——尤其 `unstable` 是矩阵永远无法表达的失败：
    // 它的每一格都会因为同一个原因显示 `???`，看起来像"还没运行"。
    const error = lastGrade?.issues.find((issue) => issue.severity === 'error');
    if (error) body.append(noteLine(error.message.zh, 'case-error'));
    for (const failure of lastGrade?.failures ?? []) {
      if (hasVector(failure)) continue;
      body.append(noteLine(`${failure.reason ?? 'failure'}: ${failure.detail ?? 'no detail'}`));
    }

    if (declared.length > 0) {
      // 即使调用方没提供运行记录，判定结果也能画出来：它携带的失败记录带着
      // 所驱动的向量，足以给那一列填上数字。运行自身的记录存在时优先用它，
      // 因为那些记录也覆盖通过的用例。
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

    // 没有可播放的用例列表：`program` 或 `custom` 关卡仍然要显示它的检查器发现了什么。
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
 * 一个用例的输出引脚该显示什么：运行"正停在该用例上"时用实时画板的值——
 * 这正是逐个播放用例的意义——其余情况用运行自己的记录。
 * 任何东西都还没跑过时为 `null`。
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

/** 失败记录里带了向量、因而能逐引脚渲染时为 true。 */
function hasVector(failure: CheckFailure): boolean {
  return Object.keys(failure.inputs).length > 0 || Object.keys(failure.expected).length > 0;
}

/**
 * 把一个用例的输入向量写成一个字符串，好让失败记录能匹配回它来自哪一列。
 *
 * 按向量匹配而不是按位置匹配，才是正确的做法：一次检查只记录失败的用例，
 * 所以第三条失败记录通常并不是第三个用例；键里要包含每一个引脚，
 * 因为驱动了同样输入的两次用例就是同一个用例。
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
  // 表格的第一行是哪一行，用来给活动列的色带两端做圆角：
  // 没有输入引脚的关卡，第一行就是"预期"行。
  const startsOnOutputs = inputs.length === 0;

  for (const [position, pin] of inputs.entries()) {
    const row = document.createElement('tr');
    row.append(labelCell(`输入 ${position + 1} ${pinName(pin)}`.trim()));
    for (const [index, item] of cases.entries()) {
      const cell = bitsCell(item.inputs[pin.id] ?? 0, pin.width);
      if (disagrees(item, pin)) cell.classList.add('case-bad', 'bad-cap-top', 'bad-cap-bottom');
      // 运行停在一个用例上时，那一列就是正在被驱动的列：
      // 画板正在显示它，读者的视线也要跟过去。
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
      // 这一对是"一起错的"，所以框在一起：上面是关卡要求的值，下面是实际得到值，
      // 合成一个红块。只框住 `当前` 那一格虽然也说了"错了"，却要读者再往上两行
      // 去找预期；而每个引脚的两格本来就相邻，所以框就是它们两个。
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
 * 该用例记录的实际输出与关卡预期不一致时为 true。
 *
 * 只有用例明确给出预期的引脚才可能"错"，这也正是输入格不会因为输出错了而被描红的原因：
 * 失败用例的驱动向量本身并不是错误。
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
 * 某个引脚在某个用例里的各位，最高位在前。
 *
 * 不含文字：格子本身就是位。`panels.test.ts` 会读取面板里的每个 `td`，
 * 以证明"没有驱动向量的失败不会凭空造出 0"；如果位格还额外写出数值，
 * 这个检查就失效了。
 *
 * 格子同时也是"框"。高亮是画在 `td` 自身上的半透明填充，而不是给里面的位套一个圆圈，
 * 这样一列的格子会连成一条连续的色带，而不是一截截小轮廓组成的梯子——
 * 见 `style.css` 里的 `.case-active` 与 `.case-bad`，以及调用方为两端加圆角
 * 而添加的 `cap-top`/`cap-bottom` 类。
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
 * 尚未读到的值所用的格子：每一位一个中性的点。
 *
 * 以前这里写的是字面文本 `???`，那同时是三个问题。第一，十六个用例的表格里
 * 每一列都写同样的东西，一整行就是一面标点墙，而一排点才像"这里还没有值"。
 * 第二，事物的"种类"不对——这些格子装的是位，而画板旁的读数面板早就确定了未知位
 * 长什么样：一个普通的灰点、不发光，那才是"方向未知"的诚实形状。
 * 第三，这是整个游戏里唯一一处用文字拼出状态、而不是把它画出来的地方。
 *
 * 第三种位状态不是这里发明的：自从输入读数需要它以来，`bit.ts` 就一直带着 `'x'`。
 * 这里只是测试矩阵学会了同一套词汇。
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
