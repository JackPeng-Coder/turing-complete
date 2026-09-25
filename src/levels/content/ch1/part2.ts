import { truthTable } from '../../tables';
import type { LevelSpec } from '../../spec';

/**
 * Chapter 1, levels 7-12.
 *
 * Level 7 is the only level in the chapter that hands out a memory part: level 8's
 * puzzle cannot be built without `delay_line`, and a level may only offer parts an
 * earlier level has already rewarded, so the unlock has to happen here.
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
const IO_NIBBLE = {
  inputs: [
    { id: 'b3', width: 1 },
    { id: 'b2', width: 1 },
    { id: 'b1', width: 1 },
    { id: 'b0', width: 1 },
  ],
  outputs: [
    { id: 'out3', width: 1 },
    { id: 'out2', width: 1 },
    { id: 'out1', width: 1 },
    { id: 'out0', width: 1 },
  ],
};

export const CH1_PART2: readonly LevelSpec[] = [
  {
    id: 'ch1-07-always-on',
    chapter: 1,
    index: 7,
    name: { zh: '高电平', en: 'Always On' },
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
    id: 'ch1-08-second-tick',
    chapter: 1,
    index: 8,
    name: { zh: '第二刻', en: 'Second Tick' },
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
      zh: '两个输入不同时输出高。四个与非门就够了——监督者显然知道这件事。',
      en: 'High when the inputs differ. Four NANDs are enough, and the Overseer knows it.',
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
    threeStar: { gate: 2, delay: 2, tick: 0 },
    rewards: { components: ['xnor'] },
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
    threeStar: { gate: 2, delay: 2, tick: 0 },
  },
  {
    id: 'ch1-12-binary-racer',
    chapter: 1,
    index: 12,
    name: { zh: '二进制速算', en: 'Binary Racer' },
    brief: {
      zh: '四个输入位 b3 b2 b1 b0 组成一个数。一眼读出它——然后原样送到四个输出位。',
      en: 'Bits b3..b0 form one number. Read it at a glance, then forward it to the four outputs.',
    },
    hint: {
      zh: 'b3 是最高位（权 8），b0 是最低位（权 1）。把每一位直连到同名输出。',
      en: 'b3 is the most significant bit (weight 8), b0 the least (weight 1). Wire each straight through.',
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
      'or3',
      'xnor',
      'level_input',
      'level_output',
    ],
    io: IO_NIBBLE,
    checks: [
      truthTable(IO_NIBBLE, {
        // `?? 0` is dead weight at runtime -- the enumerator always fills every
        // declared input -- but a record lookup is `number | undefined` under
        // `noUncheckedIndexedAccess`, and "an absent bit reads low" is the
        // honest reading of it.
        out3: ({ b3 }) => b3 ?? 0,
        out2: ({ b2 }) => b2 ?? 0,
        out1: ({ b1 }) => b1 ?? 0,
        out0: ({ b0 }) => b0 ?? 0,
      }),
    ],
    threeStar: { gate: 0, delay: 0, tick: 0 },
  },
];
