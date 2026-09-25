import { truthTable } from '../../tables';
import type { LevelSpec } from '../../spec';

/**
 * Chapter 1, levels 1-6.
 *
 * Ordering note: the source material lists NOR (5) before OR (6), but NOR's
 * standard solutions need OR, or they need NOT+NAND which arrives even later.
 * To keep the "a level only uses already-unlocked parts" rule absolute, OR and
 * NOR are swapped here. All text is original.
 */
const IO_1 = { inputs: [], outputs: [{ id: 'out', width: 1 }] };
const IO_2 = {
  inputs: [
    { id: 'a', width: 1 },
    { id: 'b', width: 1 },
  ],
  outputs: [{ id: 'out', width: 1 }],
};
const IO_1IN = { inputs: [{ id: 'a', width: 1 }], outputs: [{ id: 'out', width: 1 }] };

export const CH1_PART1: readonly LevelSpec[] = [
  {
    id: 'ch1-01-crude-awakening',
    chapter: 1,
    index: 1,
    name: { zh: '原力觉醒', en: 'Crude Awakening' },
    brief: {
      zh: '飞船的舱门认电不认人。给输出一个恒定的高电平，门就会开。',
      en: 'The airlock only understands voltage. Hold the output high and it opens.',
    },
    hint: {
      zh: '调色板里有「高电平」和「关卡输出」，把它们连起来。',
      en: 'The palette has Constant On and Level Output. Wire them together.',
    },
    allowedComponents: ['const_on', 'const_off', 'level_input', 'level_output'],
    io: IO_1,
    checks: [truthTable(IO_1, { out: () => 1 })],
    threeStar: { gate: 0, delay: 0, tick: 0 },
    rewards: { components: ['nand'] },
  },
  {
    id: 'ch1-02-nand-gate',
    chapter: 1,
    index: 2,
    name: { zh: '与非门', en: 'NAND Gate' },
    brief: {
      zh: '考核者给了你一块芯片：只有两个输入同时为高时，输出才是低。它叫与非门。',
      en: 'The Assessor hands you one chip: its output drops low only when both inputs are high.',
    },
    hint: {
      zh: '关卡输入要用「关卡输入」元件接出来，实例名必须是 IN_a 和 IN_b；输出实例名是 OUT。',
      en: 'Drive the level inputs from Level Input parts named IN_a and IN_b; the output is OUT.',
    },
    allowedComponents: ['nand', 'level_input', 'level_output'],
    io: IO_2,
    checks: [truthTable(IO_2, { out: ({ a, b }) => (a && b ? 0 : 1) })],
    threeStar: { gate: 1, delay: 1, tick: 0 },
    rewards: { components: ['not'] },
  },
  {
    id: 'ch1-03-not-gate',
    chapter: 1,
    index: 3,
    name: { zh: '非门', en: 'NOT Gate' },
    brief: {
      zh: '把输入翻转过来。只有一个输入引脚 a 的时候，与非门会变成什么？',
      en: 'Invert the input. What does a NAND become when it has only one input to look at?',
    },
    hint: {
      zh: '把同一个信号接到与非门的两个输入上。',
      en: 'Feed the same signal into both NAND inputs.',
    },
    allowedComponents: ['nand', 'level_input', 'level_output'],
    io: IO_1IN,
    checks: [truthTable(IO_1IN, { out: ({ a }) => (a ? 0 : 1) })],
    threeStar: { gate: 1, delay: 1, tick: 0 },
    rewards: { components: ['and'] },
  },
  {
    id: 'ch1-04-and-gate',
    chapter: 1,
    index: 4,
    name: { zh: '与门', en: 'AND Gate' },
    brief: {
      zh: '与门就是与非门再翻一次。两个输入都为高时输出才为高。',
      en: 'An AND is a NAND flipped back. High only when both inputs are high.',
    },
    hint: { zh: '与非门的输出接一个非门。', en: 'Put a NOT after the NAND.' },
    allowedComponents: ['nand', 'not', 'level_input', 'level_output'],
    io: IO_2,
    checks: [truthTable(IO_2, { out: ({ a, b }) => (a && b ? 1 : 0) })],
    threeStar: { gate: 2, delay: 2, tick: 0 },
    rewards: { components: ['or'] },
  },
  {
    id: 'ch1-05-or-gate',
    chapter: 1,
    index: 5,
    name: { zh: '或门', en: 'OR Gate' },
    brief: {
      zh: '任意一个输入为高，输出就为高。德摩根说：先把两个输入都翻过来，再用与非门。',
      en: 'High when either input is high. De Morgan says: invert both inputs, then NAND.',
    },
    hint: { zh: 'NOT(a) NAND NOT(b) 就是 a OR b。', en: 'NOT(a) NAND NOT(b) is exactly a OR b.' },
    allowedComponents: ['nand', 'not', 'and', 'level_input', 'level_output'],
    io: IO_2,
    checks: [truthTable(IO_2, { out: ({ a, b }) => (a || b ? 1 : 0) })],
    threeStar: { gate: 3, delay: 2, tick: 0 },
    rewards: { components: ['nor'] },
  },
  {
    id: 'ch1-06-nor-gate',
    chapter: 1,
    index: 6,
    name: { zh: '或非门', en: 'NOR Gate' },
    brief: {
      zh: '或门之后再翻一次。两个输入都为低时输出才为高。',
      en: 'An OR flipped. High only when both inputs are low.',
    },
    hint: { zh: '或门的输出接一个非门。', en: 'Put a NOT after the OR.' },
    allowedComponents: ['nand', 'not', 'and', 'or', 'level_input', 'level_output'],
    io: IO_2,
    checks: [truthTable(IO_2, { out: ({ a, b }) => (a || b ? 0 : 1) })],
    // Three-star target = the reference solution's own metrics; the reference scores exactly it.
    // Gate = 4, not 2: the reference is OR + NOT, and OR is 3 NAND equivalents
    // (see the basis in `core/defs/index.ts`), not one.
    threeStar: { gate: 4, delay: 2, tick: 0 },
    rewards: { components: ['const_on', 'const_off'] },
  },
];
