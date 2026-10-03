import { truthTable } from '../../tables';
import type { LevelSpec } from '../../spec';

/**
 * Chapter 1, levels 7-13.
 *
 * Level 7 is the only level in this half that hands out a memory part: level 8's
 * puzzle cannot be built without `delay_line`, and a level may only offer parts an
 * earlier level has already rewarded, so the unlock has to happen here. The
 * chapter's LAST level is where the other memory part changes hands, for the same
 * rule one chapter later: `mem1` is what chapter 2's latch level is built from, so
 * it has to be in the player's hands before chapter 2 opens.
 *
 * THE TWO CAPSTONE LEVELS ARE NEW IN THE 2.x SHAPE, and both close a hole rather
 * than add a puzzle. `ch1-12-xnor-gate` is where `xnor` is handed out; the reward
 * used to sit on `ch1-10-bigger-or-gate`, a three-input OR level that never asked
 * the player to build an XNOR at all. `ch1-13-logic-exam` carries `mem1`, which
 * used to be the first chapter-2 level's reward -- one chapter too late for the
 * level that consumes it.
 *
 * All text is original.
 */
const IO_CONST = { inputs: [], outputs: [{ id: 'out', width: 1 }] };
const IO_AB = {
  inputs: [
    { id: 'a', width: 1 },
    { id: 'b', width: 1 },
  ],
  outputs: [{ id: 'out', width: 1 }],
};
const IO_ABC = {
  inputs: [
    { id: 'a', width: 1 },
    { id: 'b', width: 1 },
    { id: 'c', width: 1 },
  ],
  outputs: [{ id: 'out', width: 1 }],
};
export const CH1_PART2: readonly LevelSpec[] = [
  {
    id: 'ch1-07-always-on',
    chapter: 1,
    index: 7,
    name: { zh: '长明灯', en: 'Always On' },
    brief: {
      zh: '永远为高。听起来简单——但这是你和电源之间的第一次握手。',
      en: 'Always high. Trivial, except it is your first handshake with the power rail.',
    },
    hint: { zh: '一个「高电平」元件就够了。', en: 'One Constant On part is enough.' },
    allowedComponents: ['const_on', 'level_input', 'level_output'],
    io: IO_CONST,
    checks: [truthTable(IO_CONST, { out: () => 1 })],
    threeStar: { gate: 0, delay: 0, tick: 0 },
    // `delay_line` is level 8's whole lesson and this is level 8's only
    // predecessor, so the unlock has to be handed out here -- a level may not
    // offer a part that no earlier level rewarded.
    rewards: { components: ['delay_line', 'xor'] },
  },
  {
    id: 'ch1-08-second-cycle',
    chapter: 1,
    index: 8,
    name: { zh: '第二周期', en: 'Second Cycle' },
    brief: {
      zh: '输出必须在第 0 拍为低，第 1 拍为低，从第 2 拍起为高。信号需要时间。',
      en: 'The output must read low at ticks 0 and 1, and high from tick 2 onward.',
    },
    hint: {
      zh: '延迟线在时钟沿把输入存下来再输出。串两条延迟线就是两拍。',
      en: 'A Delay Line latches its input on the clock edge. Two in series is two ticks.',
    },
    allowedComponents: ['const_on', 'delay_line', 'level_input', 'level_output'],
    io: IO_CONST,
    checks: [
      {
        kind: 'script',
        steps: [
          { tick: 0, expect: { out: 0 } },
          { tick: 1, expect: { out: 0 } },
          { tick: 2, expect: { out: 1 } },
          { tick: 3, expect: { out: 1 } },
        ],
      },
    ],
    // `tick` is the highest tick the check drives, not the circuit's latency:
    // the last step asserts the output is still high at tick 3, so every graded
    // circuit reports tick 3. What pins the two-tick latency is the check
    // itself -- a single delay line is still low at tick 2 and fails it (see the
    // wrong-circuit test) -- so the target has to be 3 to stay earnable.
    threeStar: { gate: 0, delay: 0, tick: 3 },
    rewards: { components: ['and3'] },
  },
  {
    id: 'ch1-09-xor-gate',
    chapter: 1,
    index: 9,
    name: { zh: '异或门', en: 'XOR Gate' },
    brief: {
      zh: '两个输入不同时输出高。四个与非门就够了——考核者显然知道这件事。',
      en: 'High when the inputs differ. Four NANDs are enough, and the Assessor knows it.',
    },
    hint: {
      zh: 'NAND(a,b) 的结果再分别和 a、b 各与非一次，最后把两个结果与非起来。',
      en: 'Feed NAND(a,b) into two more NANDs with a and b, then NAND those two results.',
    },
    allowedComponents: [
      'nand',
      'not',
      'and',
      'or',
      'const_on',
      'delay_line',
      'and3',
      'level_input',
      'level_output',
    ],
    io: IO_AB,
    // "High when the inputs differ", spelled as the level's own brief puts it.
    // (The plan wrote this as `a ^ b`, which does not typecheck here: with
    // `noUncheckedIndexedAccess` an input record lookup is `number | undefined`
    // and bitwise operators reject it.)
    checks: [truthTable(IO_AB, { out: ({ a, b }) => (a === b ? 0 : 1) })],
    threeStar: { gate: 4, delay: 3, tick: 0 },
    rewards: { components: ['or3'] },
  },
  {
    id: 'ch1-10-bigger-or-gate',
    chapter: 1,
    index: 10,
    name: { zh: '三路或门', en: 'Bigger OR Gate' },
    brief: {
      zh: '三个输入里任意一个为高，输出就为高。',
      en: 'High when any of the three inputs is high.',
    },
    hint: {
      zh: '先用两个输入做一个或，再把结果和第三个或一次。级联是这一关的全部内容。',
      en: 'OR two of them, then OR the result with the third. Cascading is the whole lesson.',
    },
    allowedComponents: [
      'nand',
      'not',
      'and',
      'or',
      'const_on',
      'delay_line',
      'and3',
      'xor',
      'level_input',
      'level_output',
    ],
    io: IO_ABC,
    checks: [truthTable(IO_ABC, { out: ({ a, b, c }) => (a || b || c ? 1 : 0) })],
    // Three-star target = the reference solution's own metrics; the reference scores exactly it.
    // Gate = 6, not 2: the reference cascades two ORs, 3 NAND equivalents each.
    threeStar: { gate: 6, delay: 2, tick: 0 },
    // `xnor` USED TO BE HANDED OUT HERE, and that is the defect this comment now
    // records instead of repeating: a three-input OR level has no use for an XNOR,
    // so the part arrived in the player's palette without their having built one.
    // The 2.x shape gives the gate its own level (`ch1-12-xnor-gate`), which is
    // where it is handed out now, and this level rewards nothing.
  },
  {
    id: 'ch1-11-bigger-and-gate',
    chapter: 1,
    index: 11,
    name: { zh: '三路与门', en: 'Bigger AND Gate' },
    brief: {
      zh: '三个输入都为高，输出才为高。',
      en: 'High only when all three inputs are high.',
    },
    hint: { zh: '与门可以级联，就像或门一样。', en: 'AND cascades exactly like OR does.' },
    allowedComponents: [
      'nand',
      'not',
      'and',
      'or',
      'const_on',
      'delay_line',
      'and3',
      'xor',
      'or3',
      'level_input',
      'level_output',
    ],
    io: IO_ABC,
    checks: [truthTable(IO_ABC, { out: ({ a, b, c }) => (a && b && c ? 1 : 0) })],
    // Three-star target = the reference solution's own metrics; the reference scores exactly it.
    // Gate = 4, not 2: the reference cascades two ANDs, 2 NAND equivalents each.
    threeStar: { gate: 4, delay: 2, tick: 0 },
  },

  /**
   * ch1-12-xnor-gate -- XNOR Gate / 同或门
   *
   * SOURCED: the name in both languages and its position (the 12th level, the
   * chapter's penultimate one). The dossier's §5 table gives this level no concept
   * line at all, so nothing below is a translation of one.
   *
   * AUTHORED: the `a b -> out` shape; the four-row truth table; the palette; the
   * measured three-star target; and the `xnor` reward, which the 2.x realignment
   * moved here from `ch1-10-bigger-or-gate` -- that level's own lesson is a
   * three-input OR, so the reward arrived without the player ever building the
   * gate it named.
   *
   * THE PUZZLE IS THE XOR LEVEL'S COMPLEMENT, and the palette says so: it is
   * `ch1-09-xor-gate`'s list plus `xor` and `nor` and nothing else. Two spellings
   * are legitimate and both pass: an XNOR built from the NAND/AND/OR/NOT family the
   * player already holds, or `xor` followed by a NOT -- the construction the hint
   * names first and the one the target was measured from. They are not equally
   * cheap on depth, and the measurement below says which is which. `xnor` itself is
   * NOT offered: a level's own reward is what `paletteDefsFor` adds back before the
   * level is passed, and a one-drop answer to the level that teaches the gate would
   * make the lesson vacuous. `ch1-10`'s old reward comment is where that rule is
   * recorded for this chapter.
   */
  {
    id: 'ch1-12-xnor-gate',
    chapter: 1,
    index: 12,
    name: { zh: '同或门', en: 'XNOR Gate' },
    brief: {
      zh: '两个输入相同时输出高，不同时输出低。它和异或门只差一次取反。',
      en: 'High when the two inputs agree, low when they differ. It is the XOR gate with one inversion to spare.',
    },
    hint: {
      zh: '异或门的输出再取反就是同或门；也可以直接从与非门搭起：先把 a、b 各自与 NAND(a,b) 与非，再把这两个结果与非起来，最后取反。',
      en: 'Put a NOT after the XOR. Or build it from NANDs directly: NAND each input with NAND(a, b), NAND those two results together, and invert what comes out.',
    },
    allowedComponents: [
      'nand',
      'not',
      'and',
      'or',
      'nor',
      'const_on',
      'delay_line',
      'and3',
      'xor',
      'level_input',
      'level_output',
    ],
    io: IO_AB,
    // "High when the inputs agree, low when they differ", spelled the way the
    // sibling XOR level spells its own row (see the note there on `?? 0` and
    // `noUncheckedIndexedAccess`): one comparison, not a bitwise operator.
    checks: [truthTable(IO_AB, { out: ({ a, b }) => (a === b ? 1 : 0) })],
    // Measured: `xor` (the classic four-NAND cell, 4 NAND equivalents) into one
    // `not` (1) -- 5 gates on a path two components deep. The NAND-only spelling
    // measures the same 5 gates four components deep (NAND(a,b); the two NANDs that
    // fold it back into a and b; their NAND; the final inverter), so it is a correct
    // circuit that scores one star -- both are five NAND equivalents, and what the
    // target separates is depth: the cell the chapter handed the player against the
    // cell they rebuild from NANDs by hand.
    threeStar: { gate: 5, delay: 2, tick: 0 },
    rewards: { components: ['xnor'] },
  },

  /**
   * ch1-13-logic-exam -- Logic Exam / 逻辑试炼
   *
   * SOURCED: the name in both languages, its position (the 13th and last level of
   * chapter 1), and the dossier's one-line concept -- 综合测验, a comprehensive
   * quiz over the chapter. That is the whole of what the source fixes; it names no
   * function, no ports and no reward.
   *
   * AUTHORED: the function the exam asks for (the three-input MAJORITY: high when
   * at least two of `a`, `b`, `c` are high), the `a b c -> out` shape, the
   * eight-row truth table, the palette, the measured three-star target, and the
   * `mem1` reward that the 2.x realignment moved here from `ch2-14-binary-racer`.
   * The source's "quiz" is a shape, not a function: what makes this level a quiz
   * rather than another gate is that no single part in the palette is the answer.
   * AND, OR, NAND, NOR, XOR, XNOR, AND3 and OR3 each fail at least one of the
   * eight rows, so the player has to compose; the majority function is the classic
   * composition a chapter of gate-building ends on.
   *
   * THE PALETTE IS THE WHOLE CHAPTER, minus the parts that would answer it and
   * minus the part it hands out. That is deliberate and it is what makes this the
   * capstone: by level 13 the player holds every chapter-1 part, and restricting
   * the list would turn a quiz into a hint. `mem1` is left out rather than merely
   * unneeded -- chapter 1's own rule is that a level never lists its own reward
   * (`test/levels/level-buildability.test.ts` walks that), and nothing else about
   * the part would help here: no check in this level ticks a clock.
   *
   * THE TARGET IS THE SHARED-TERM CONSTRUCTION, not the smallest gate count: the
   * three pairwise ANDs feed one `or3`, which is 3 x 2 + 6 = 12 NAND equivalents on
   * a path two components deep, and the two-OR cascade of the same three terms is
   * 12 gates on a path three deep, so the shared OR3 is what the measured target
   * separates. The 10-gate/(a AND b) OR (c AND (a OR b)) spelling is smaller and
   * three deep, and scores one star: it is the documented alternative rather than a
   * hole in the target, and the target is the reference's own measurement either
   * way.
   */
  {
    id: 'ch1-13-logic-exam',
    chapter: 1,
    index: 13,
    name: { zh: '逻辑试炼', en: 'Logic Exam' },
    brief: {
      zh: '三个输入 a、b、c。其中至少两个为高时输出为高，只有一个或一个都没有时为低——这是一次覆盖整章的试炼：没有任何一颗元件能单独给出答案。',
      en: 'Three inputs, a, b and c. The output is high when at least two of them are high, and low when only one is -- or none. It is an exam over the whole chapter: no single part in the palette is the answer.',
    },
    hint: {
      zh: '先两两相与，得到 a·b、a·c、b·c 三个「有一对为高」的信号，再把三者或起来。三个与门加一个三路或门就够；用两个二路或门级联也行，只是深一层。',
      en: 'AND the inputs in pairs first -- ab, ac and bc are the three "a pair agreed" signals -- then OR all three together. Three ANDs and one 3-input OR is enough; two cascaded 2-input ORs do the same job one level deeper.',
    },
    allowedComponents: [
      'nand',
      'not',
      'and',
      'or',
      'nor',
      'xor',
      'xnor',
      'and3',
      'or3',
      'const_on',
      'const_off',
      'delay_line',
      'level_input',
      'level_output',
    ],
    io: IO_ABC,
    // The majority function, written as what it is rather than as a bit trick: at
    // least two of the three inputs high. Every row is enumerated -- 2^3 rows, so
    // nothing is sampled and the two rows that separate majority from OR (exactly
    // one input high) and from AND (exactly two) are both in the table.
    checks: [
      truthTable(IO_ABC, { out: ({ a, b, c }) => ((a ?? 0) + (b ?? 0) + (c ?? 0) >= 2 ? 1 : 0) }),
    ],
    // Measured: the three pairwise ANDs (2 each) feeding one `or3` (6) = 12 NAND
    // equivalents on a path two components deep. The two-OR cascade of the same
    // terms measures 12 and 3, so the target separates the two compositions the
    // palette invites; the three-gate/deeper alternative named above is 10 and 3.
    threeStar: { gate: 12, delay: 2, tick: 0 },
    // `mem1` is chapter 1's last hand-out because chapter 2's latch level is the
    // first circuit that needs it, and a level may only offer parts an earlier
    // level has already rewarded. Before the 2.x realignment this reward sat on
    // `ch2-14-binary-racer`, which is the FIRST level of chapter 2 -- so the part
    // reached the palette one level after the level that builds from it.
    rewards: { components: ['mem1'] },
  },
];
