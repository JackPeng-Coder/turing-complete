// `maze` 检查器：第 4 章「路在脚下 / The Maze」的闭环导航判定。
// 本模块位于 levels 层，依赖 `custom/index.ts` 的注册与校验设施、`checks.ts` 的程序装载与
// LevelIo 抽象，向注册表登记 id `maze`。使用方是内容路径 `content/ch4/index.ts`（副作用 import）。
// 关键不变量：机器人状态只由关卡网格与电路发布的动作码决定；传感器位相对当前朝向计算；
// 预算单位 = 一次交换；同样的画板永远得到同样的评分。

import {
  effectiveBudget,
  invalidOutcome,
  ioIssue,
  registerCustomCheck,
  type CheckerIo,
} from './index';
import {
  describeValue,
  loadProgramImage,
  playerProgramText,
  type LevelIo,
  type PlayerProgram,
} from '../checks';
import type { CheckFailure, CheckOutcome, CustomCheck, LevelSpec } from '../spec';

/**
 * `maze` —— 路在脚下 / The Maze，第 4 章的闭环导航检查器。
 *
 * 谜题。画板是玩家自己的 AXIS CPU，一个机器人在关卡声明的网格上行走。
 * CPU 看到三位——正前方有墙、左边有墙、右边有墙，全部相对机器人当前朝向——
 * 并用一个动作码作答。检查器应用这个动作，发布机器人新状态对应的传感器字节，
 * 结算、推进时钟，然后再次询问。机器人站上终点就赢。
 *
 * 检查器自己驱动节拍的原因。传感器是机器人自身历史的函数：
 * 步进表说不出"你现在看到的字节取决于你走过的步"——而这正是谜题的全部。
 * 这里用到的全部词汇就是 `LevelIo` 的 `reset`、`readOutput`、`writeInput`、`settle`、`tick`，
 * 从不触碰 `io.sim`，所以测试里的脚本化 stub 可以驱动检查器，判定也永不依赖内核内部。
 * 玩家程序通过 `loadProgramImage` 装载——与 `program` 分支用的是同一个 helper，
 * 所以解析、目标查找、先 reset 再装载的顺序只存在一处。
 *
 * 确定性。没有时钟、没有随机数、没有隐藏状态：网格、起点、朝向全部来自关卡数据，
 * 动作序列来自电路。同一块画板永远得到同一个评分。
 *
 * 传感器位就是关卡的题目说明。bit0 = 正前方有墙，bit1 = 左边有墙，bit2 = 右边有墙，
 * 全部相对当前朝向，网格之外一律算墙。动作码为 0 原地、1 前进、2 左转、3 右转，
 * 大于 3 的码按 0 处理——这里也要写一遍，因为本文件才是检查器真正实现的东西，
 * 一份与它漂移的题目说明会教出一个永远过不了的程序。
 *
 * 一个预算单位 = 一次交换，与 `lock` 的单位相同：读电路发布的动作码，应用它，
 * 发布该动作产生的状态的传感器，结算，再走一个节拍。
 * 因此一个 `budget` 单位的运行会读 `move` `budget` 次、执行 `budget` 个节拍；
 * 它报告的最后一次到达，是算上把它送到终点的那一拍之后的到达。
 */

/** 检查没有声明预算时，`maze` 在放弃前运行的最大节拍数。 */
export const DEFAULT_MAZE_BUDGET = 4096;

/**
 * 本检查器驱动的引脚，以及能承载这些取值的最窄位宽：三位传感器输入，两位动作码输出。
 *
 * 最先校验，因为检查器按名字操作画板——见 `ioIssue`。
 * 把引脚名起得不一样的关卡应当从"关卡自己的失败"里听到这件事，
 * 而不是从一个"走在一块检查器从未接上的画板上的机器人"那里听到。
 */
const MAZE_PINS: CheckerIo = {
  inputs: [{ id: 'sensors', width: 3 }],
  outputs: [{ id: 'move', width: 2 }],
};

/** 四个朝向，按顺时针排列：右转是 `+1`，左转是 `+3`，对 4 取模。 */
const FACINGS = ['north', 'east', 'south', 'west'] as const;
type Facing = (typeof FACINGS)[number];
const STEPS: Readonly<Record<Facing, { readonly dx: number; readonly dy: number }>> = {
  north: { dx: 0, dy: -1 },
  east: { dx: 1, dy: 0 },
  south: { dx: 0, dy: 1 },
  west: { dx: -1, dy: 0 },
};

/** 电路可以发布的动作码。大于 `TURN_RIGHT` 的一律表示原地。 */
const STAY = 0;
const FORWARD = 1;
const TURN_LEFT = 2;
const TURN_RIGHT = 3;

/** 三个传感器位，先起好名字，好让下面的掩码读起来就是题目说明里的词。 */
const AHEAD_BIT = 1;
const LEFT_BIT = 2;
const RIGHT_BIT = 4;

/** 检查器行走的网格，以字符行表示。 */
interface MazeGrid {
  readonly rows: readonly string[];
  readonly start: { readonly x: number; readonly y: number };
}

/**
 * 程序装不进去时产生的失败：不挂任何引脚键，因为一个引脚也没有被驱动，
 * 并带上装载器自己的句子。
 *
 * `emptyProgram` 是唯一完全不算拒绝的情况——两个读取器都接受它为零字节文本——
 * 它得到的措辞与 `program` 分支给玩家缓冲区的完全一样，
 * 因为对电路而言，"什么都没输入"和"只写了一条注释"是同一个"什么都没有"。
 */
function programFailure(error: string, reason: NonNullable<CheckFailure['reason']>): CheckOutcome {
  const failure: CheckFailure = {
    check: 'custom',
    inputs: {},
    expected: {},
    actual: {},
    tick: 0,
    reason,
    detail: error,
  };
  return { passed: false, failures: [failure], ticksUsed: 0 };
}

/**
 * 读一个网格；不是网格则返回 `null`。
 *
 * 机器人在能走之前，网格必须满足这些规则：每一行都是字符串，所有行等长
 * （参差不齐的网格没有"列"，"东边一格"在不同行上会指不同的东西），网格非空，
 * 并且恰好有一个起点和一个终点。要求恰好一个 `S` 和一个 `G`，而不是"各取第一个"：
 * 有两个起点的网格对"机器人在哪"有两个答案，检查器挑一个就等于评一个关卡从未描述过的谜题。
 */
function parseGrid(value: unknown): MazeGrid | null {
  const rows = Array.isArray(value) ? value : null;
  if (rows === null || rows.length === 0 || !rows.every((row) => typeof row === 'string')) {
    return null;
  }
  const width = (rows[0] as string).length;
  if (width === 0 || !rows.every((row) => (row as string).length === width)) return null;
  const lines = rows as readonly string[];

  let start: { x: number; y: number } | null = null;
  let starts = 0;
  let goals = 0;
  for (let y = 0; y < lines.length; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const cell = lines[y]![x];
      if (cell === 'S') {
        starts += 1;
        start = { x, y };
      } else if (cell === 'G') {
        goals += 1;
      }
    }
  }
  if (starts !== 1 || goals !== 1 || start === null) return null;
  return { rows: lines, start };
}

/** 说明 `value` 为什么不是可走的网格，供拒绝它的失败记录使用。 */
function gridIssue(value: unknown): string {
  if (!Array.isArray(value)) return `maze check declares grid=${describeValue(value)}, expected an array of row strings`;
  if (value.length === 0) return 'maze check declares an empty grid: there is no S to start on';
  if (!value.every((row) => typeof row === 'string')) {
    return 'maze check declares a grid with a row that is not a string';
  }
  const rows = value as readonly string[];
  const width = rows[0]!.length;
  if (width === 0) return 'maze check declares a grid whose first row is empty';
  const ragged = rows.findIndex((row) => row.length !== width);
  if (ragged >= 0) {
    return `maze check declares a ragged grid: row ${ragged} is ${rows[ragged]!.length} wide where row 0 is ${width}`;
  }
  const count = (cell: string): number =>
    rows.reduce((total, row) => total + [...row].filter((c) => c === cell).length, 0);
  const starts = count('S');
  const goals = count('G');
  if (starts !== 1 || goals !== 1) {
    return `maze check declares a grid with ${starts} S and ${goals} G; it must have exactly one of each`;
  }
  return 'maze check declares a grid the checker cannot read';
}

/** 取某格的字符；网格之外算墙，所以调用方不需要做边界判断。 */
function cellAt(grid: MazeGrid, x: number, y: number): string {
  if (y < 0 || y >= grid.rows.length) return '#';
  const row = grid.rows[y]!;
  if (x < 0 || x >= row.length) return '#';
  return row[x] ?? '#';
}

/** 当机器人无法进入某格时为真：`#`，或网格之外的任何地方。 */
function isWall(grid: MazeGrid, x: number, y: number): boolean {
  return cellAt(grid, x, y) === '#';
}

/**
 * 一个机器人状态的传感器字节：bit0 前方、bit1 左方、bit2 右方。
 *
 * 相对当前朝向计算，这正是为什么这些位在这里算、而不是按格存储：
 * "左边有墙"在每次转身之后都指向不同的格子；
 * 一个发布绝对墙壁的检查器会把谜题变成看图题，而不是一道编程题。
 */
function sensorsFor(grid: MazeGrid, x: number, y: number, facing: Facing): number {
  const index = FACINGS.indexOf(facing);
  const ahead = STEPS[FACINGS[index]!]!;
  const left = STEPS[FACINGS[(index + 3) % 4]!]!;
  const right = STEPS[FACINGS[(index + 1) % 4]!]!;
  let sensors = 0;
  if (isWall(grid, x + ahead.dx, y + ahead.dy)) sensors |= AHEAD_BIT;
  if (isWall(grid, x + left.dx, y + left.dy)) sensors |= LEFT_BIT;
  if (isWall(grid, x + right.dx, y + right.dy)) sensors |= RIGHT_BIT;
  return sensors;
}

/**
 * 在 `io` 驱动的画板上走 `check.params` 描述的迷宫。
 *
 * 一拍一步，顺序如此：读电路发布的动作码，应用它，发布该动作产生的状态的传感器，
 * 结算让字节到达电路，再推进时钟。因此电路在第 N 拍读到的传感器字节，
 * 描述的是机器人走完 N 步之后所在的位置；据它做规划的程序回答的是"现在"的问题，
 * 而不是"一步之前"的问题。
 *
 * 一局会以三种方式之一结束。机器人站在 `G` 上——通过，附上实际花掉的节拍。
 * 它朝墙前进——立即 `mismatch`，点明格子与朝向：穿过墙的机器人不是在解迷宫，
 * 继续走下去会报告一个网格从未允许过的成功。或者预算耗尽——另一种 `mismatch`，
 * 点明它放弃时所在的格子与最后应用的动作，这是"永远到不了的机器人"唯一的终止方式。
 *
 * `spec` 会被读取，为了引脚；`player` 为了程序：某关的 `io` 若没有声明 `sensors` 与 `move`，
 * 这局根本无法开始；机器人的动作必须来自玩家写下的文本——空缓冲区是拒绝，
 * 绝不是一块安静读零的画板。
 */
export const callMaze = (
  io: LevelIo,
  spec: LevelSpec,
  check: CustomCheck,
  player?: PlayerProgram,
): CheckOutcome => {
  const pins = ioIssue(spec, 'maze', MAZE_PINS);
  if (pins !== undefined) return invalidOutcome(pins);

  const params: Record<string, unknown> = isRecord(check.params) ? check.params : {};
  const grid = parseGrid(params.grid);
  if (grid === null) return invalidOutcome(gridIssue(params.grid));

  const facing = params.facing === undefined ? 'east' : params.facing;
  if (typeof facing !== 'string' || !FACINGS.includes(facing as Facing)) {
    return invalidOutcome(
      `maze check declares facing=${describeValue(params.facing)}, expected one of ${FACINGS.join(', ')}`,
    );
  }
  const budget = effectiveBudget(params.budget, DEFAULT_MAZE_BUDGET);
  if (budget === null) {
    return invalidOutcome(
      `maze check declares budget=${describeValue(params.budget)}, which is not a positive integer`,
    );
  }

  // 先 RESET，再装载玩家程序，理由与 `lock` 所述相同：`runChecks` 只为本次检查编译了电路，
  // 却从未结算过它，所以 reset 之前的读数是一个伪造的 0；而动作来源的程序必须在读到第一个动作之前
  // 就装进电路。helper 自己进入时还会再 reset 一次，这是无害的，也不是本检查器所依赖的。
  //
  // `'player'` 是通道名，同样必须显式写出：只有注释的缓冲区必须被报告成
  // "玩家什么都没编译出来"，而不是"关卡什么都没发布"。
  io.reset();
  const image = loadProgramImage(io, playerProgramText(player), 'asm', 'player');
  if (image.errors.length > 0) {
    if (image.emptyProgram) {
      return programFailure(
        "the player's program buffer is empty: there is nothing to load, so no instruction would ever execute",
        'missing-program',
      );
    }
    return programFailure(image.errors[0]!, image.reason);
  }

  let x = grid.start.x;
  let y = grid.start.y;
  let heading = facing as Facing;
  // 刚读到并应用的动作，跨循环保留，好让失败记录能点出它：电路自己的码就是失败记录的 `actual`。
  let pending = STAY;

  // 终点在每一动作之后判定，而不是第一步之前。`parseGrid` 保证 `G` 与机器人起步的 `S` 不是同一格，
  // 所以循环前的判定永远不可能为真；而每一步之后的判定，才让"到达终点"而不是"到达某一步"
  // 对最后动作是转身或原地的程序也成立：它按该动作产生的状态判通过，无论那一步有没有移动。
  for (let tick = 0; tick < budget; tick += 1) {
    pending = io.readOutput('move');
    // 大于文档所述三种的码就是文档所述的原地。它不是失败：题目说明了越界码的含义，
    // 一个因此判失败的关卡，会因为一个从未声明过的理由判程序失败。
    const move = pending === FORWARD || pending === TURN_LEFT || pending === TURN_RIGHT ? pending : STAY;
    if (move === FORWARD) {
      const step = STEPS[heading];
      const nextX = x + step.dx;
      const nextY = y + step.dy;
      if (isWall(grid, nextX, nextY)) {
        return {
          passed: false,
          failures: [
            driveFailure(sensorsFor(grid, x, y, heading), move, tick, x, y, heading, 'wall'),
          ],
          ticksUsed: tick,
        };
      }
      x = nextX;
      y = nextY;
    } else if (move === TURN_LEFT || move === TURN_RIGHT) {
      const index = FACINGS.indexOf(heading);
      heading = FACINGS[(index + (move === TURN_RIGHT ? 1 : 3)) % 4]!;
    }

    // 传感器描述的是动作产生的状态；它们要在节拍之前发布并结算，理由与 `lock` 的回答相同：
    // 节拍会从信号表里采样存储元件的输入，而这个字节要经过关卡引脚与 CPU 寄存器堆之间的
    // 组合元件才能到达那里。不结算就走节拍，机器会按"一步之前"的传感器转向。
    io.writeInput('sensors', sensorsFor(grid, x, y, heading));
    io.settle();
    io.tick();

    // 到达与停留：两者都是节拍之后机器人所处的状态，所以都在这里判通过——
    // 在向电路索要下一个动作之前，先检查"转了个身、没走到任何地方（或正好停在终点）"的这步。
    if (cellAt(grid, x, y) === 'G') {
      return { passed: true, failures: [], ticksUsed: tick + 1 };
    }
  }

  // 预算耗尽，机器人还在走。只有一条记录，用关卡自己的引脚作键：
  // 电路最后看到的传感器、它回答的动作，以及一句点明放弃时格子与朝向的 detail。
  // 终点在最后一步之后已经判过，所以能走到这一行说明机器人确实还在迷宫里。
  return {
    passed: false,
    failures: [
      driveFailure(sensorsFor(grid, x, y, heading), pending, budget, x, y, heading, 'budget'),
    ],
    ticksUsed: budget,
  };
};

/**
 * 输掉一局迷宫的两种方式共用的失败形状。
 *
 * `sensors` 是电路当时读到的字节，`move` 是它回答的动作码，detail 点明格子、朝向和出了什么问题——
 * 玩家定位到自己程序里撞墙那一行所需的三个事实，它们都塞不进数字记录。
 */
function driveFailure(
  sensors: number,
  move: number,
  tick: number,
  x: number,
  y: number,
  facing: Facing,
  why: 'wall' | 'budget',
): CheckFailure {
  const at = `(${x},${y}) facing ${facing}`;
  return {
    check: 'custom',
    inputs: { sensors },
    expected: {},
    actual: { move },
    tick,
    reason: 'mismatch',
    detail:
      why === 'wall'
        ? `the robot drove forward into a wall at ${at}`
        : // 最后一个动作确实被应用了，句子也如实这么说。它被读取、应用、发布、走完节拍，
          // 之后才判定终点——这就是循环——所以把它说成"未应用"，描述的是一个从未发生过的运行，
          // 并且会把机器人真正做过的转身从玩家读到的失败里藏起来。
          // 结束这次运行的是预算，不是那个动作。
          `the budget of ${tick} tick(s) ran out with the robot still at ${at} after applying move ${move}`,
  };
}

/** `params` 是关卡数据：要么是对象，要么什么都没有，绝不能抛 `TypeError`。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 把本检查器登记到 `custom` 检查点名的 id 下。 */
registerCustomCheck('maze', callMaze);
