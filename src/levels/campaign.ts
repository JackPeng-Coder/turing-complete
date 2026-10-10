/**
 * The campaign's shape: which levels exist, in which chapter, at which global
 * index, under which name.
 *
 * This table is the 2.x baseline, transcribed from `GAME_RESEARCH_2026-10-03.md`
 * §5 ("完整关卡流程（93 关全表）", the sourced Steam-guide table). Chapters 5-7
 * (levels 57-93) are not built yet and are not listed here; this file covers the
 * 56 levels of chapters 1-4, which is what the replica ships.
 *
 * It exists as data rather than as prose so that `test/levels/campaign-shape.test.ts`
 * can hold the level specs to it: the id, the chapter, the global `index` and
 * both names have to agree exactly, in this order. Before this table, the shape
 * lived only in the plans -- and drifted: the campaign used to spend two of its
 * 47 slots on one puzzle (Binary Racer, once at chapter 1's capstone and once in
 * chapter 2) and left two parts (`decoder2`, `alu2`) with no level to hand them
 * out.
 *
 * `index` is the GLOBAL position, not the position within the chapter: chapter 2
 * starts at 14 because chapter 1 has 13 levels. The id repeats it
 * (`ch2-14-binary-racer`), so the two must be changed together.
 */
export interface CampaignEntry {
  readonly id: string;
  readonly chapter: number;
  readonly index: number;
  readonly zh: string;
  readonly en: string;
}

/** Chapters 1-4 of the 2.x campaign, in unlock order. */
export const CAMPAIGN: readonly CampaignEntry[] = [
  // Chapter 1 -- 布尔代数 (Boolean Logic), 13 levels
  { id: 'ch1-01-humble-beginnings', chapter: 1, index: 1, zh: '从零开始', en: 'Humble Beginnings' },
  { id: 'ch1-02-nand-gate', chapter: 1, index: 2, zh: '与非门', en: 'NAND Gate' },
  { id: 'ch1-03-not-gate', chapter: 1, index: 3, zh: '非门', en: 'NOT Gate' },
  { id: 'ch1-04-and-gate', chapter: 1, index: 4, zh: '与门', en: 'AND Gate' },
  { id: 'ch1-05-nor-gate', chapter: 1, index: 5, zh: '或非门', en: 'NOR Gate' },
  { id: 'ch1-06-or-gate', chapter: 1, index: 6, zh: '或门', en: 'OR Gate' },
  { id: 'ch1-07-always-on', chapter: 1, index: 7, zh: '长明灯', en: 'Always On' },
  { id: 'ch1-08-second-cycle', chapter: 1, index: 8, zh: '第二周期', en: 'Second Cycle' },
  { id: 'ch1-09-xor-gate', chapter: 1, index: 9, zh: '异或门', en: 'XOR Gate' },
  { id: 'ch1-10-bigger-or-gate', chapter: 1, index: 10, zh: '三路或门', en: 'Bigger OR Gate' },
  { id: 'ch1-11-bigger-and-gate', chapter: 1, index: 11, zh: '三路与门', en: 'Bigger AND Gate' },
  { id: 'ch1-12-xnor-gate', chapter: 1, index: 12, zh: '同或门', en: 'XNOR Gate' },
  { id: 'ch1-13-logic-exam', chapter: 1, index: 13, zh: '逻辑试炼', en: 'Logic Exam' },

  // Chapter 2 -- 算术运算、存储器 (Arithmetic, Memory), 26 levels
  { id: 'ch2-14-binary-racer', chapter: 2, index: 14, zh: '二进制速算', en: 'Binary Racer' },
  { id: 'ch2-15-double-detection', chapter: 2, index: 15, zh: '成双成对', en: 'Double Detection' },
  {
    id: 'ch2-16-odd-number-of-signals',
    chapter: 2,
    index: 16,
    zh: '奇数计数技术',
    en: 'Odd Number of Signals',
  },
  {
    id: 'ch2-17-circular-dependency',
    chapter: 2,
    index: 17,
    zh: '循环依赖',
    en: 'Circular Dependency',
  },
  { id: 'ch2-18-counting-signals', chapter: 2, index: 18, zh: '信号计数', en: 'Counting Signals' },
  { id: 'ch2-19-half-adder', chapter: 2, index: 19, zh: '半加器', en: 'Half Adder' },
  { id: 'ch2-20-delayed-lines', chapter: 2, index: 20, zh: '晚点到站', en: 'Delayed Lines' },
  {
    id: 'ch2-21-double-the-number',
    chapter: 2,
    index: 21,
    zh: '超级加倍',
    en: 'Double the Number',
  },
  { id: 'ch2-22-full-adder', chapter: 2, index: 22, zh: '全加器', en: 'Full Adder' },
  { id: 'ch2-23-odd-cycles', chapter: 2, index: 23, zh: '奇变偶不变', en: 'Odd Cycles' },
  { id: 'ch2-24-bit-switch', chapter: 2, index: 24, zh: '二进制开关', en: 'Bit Switch' },
  { id: 'ch2-25-byte-nand', chapter: 2, index: 25, zh: '单字节与非', en: 'Byte NAND' },
  { id: 'ch2-26-byte-not', chapter: 2, index: 26, zh: '单字节非门', en: 'Byte NOT' },
  { id: 'ch2-27-adding-bytes', chapter: 2, index: 27, zh: '单字节加法', en: 'Adding Bytes' },
  { id: 'ch2-28-bit-inverter', chapter: 2, index: 28, zh: '可控反相器', en: 'Bit Inverter' },
  { id: 'ch2-29-negative-numbers', chapter: 2, index: 29, zh: '负数', en: 'Negative Numbers' },
  { id: 'ch2-30-multiplexer', chapter: 2, index: 30, zh: '数据选择器', en: 'Multiplexer' },
  { id: 'ch2-31-signed-negator', chapter: 2, index: 31, zh: '数值反转', en: 'Signed Negator' },
  { id: 'ch2-32-the-bus', chapter: 2, index: 32, zh: '总线', en: 'The Bus' },
  {
    id: 'ch2-33-saving-gracefully',
    chapter: 2,
    index: 33,
    zh: '优雅存储',
    en: 'Saving Gracefully',
  },
  { id: 'ch2-34-saving-bytes', chapter: 2, index: 34, zh: '整存整取', en: 'Saving Bytes' },
  { id: 'ch2-35-1-bit-decoder', chapter: 2, index: 35, zh: '二进制译码', en: '1 Bit Decoder' },
  { id: 'ch2-36-2-bit-decoder', chapter: 2, index: 36, zh: '2-4 译码器', en: '2 Bit Decoder' },
  { id: 'ch2-37-3-bit-decoder', chapter: 2, index: 37, zh: '3-8 译码器', en: '3 Bit Decoder' },
  { id: 'ch2-38-little-box', chapter: 2, index: 38, zh: '方寸之间', en: 'Little Box' },
  { id: 'ch2-39-counter', chapter: 2, index: 39, zh: '计数器', en: 'Counter' },

  // Chapter 3 -- 处理器架构 (CPU Architecture, OVERTURE), 10 levels
  {
    id: 'ch3-40-alu-1',
    chapter: 3,
    index: 40,
    zh: '逻辑整合',
    en: 'Arithmetic Logic Unit (ALU) 1',
  },
  { id: 'ch3-41-registers', chapter: 3, index: 41, zh: '川流不息', en: 'Registers' },
  {
    id: 'ch3-42-alu-2',
    chapter: 3,
    index: 42,
    zh: '算术逻辑单元',
    en: 'Arithmetic Logic Unit (ALU) 2',
  },
  { id: 'ch3-43-the-foundry', chapter: 3, index: 43, zh: '元件工坊', en: 'The Foundry' },
  {
    id: 'ch3-44-instruction-decoder',
    chapter: 3,
    index: 44,
    zh: '指令译码器',
    en: 'Instruction Decoder',
  },
  { id: 'ch3-45-conditions', chapter: 3, index: 45, zh: '条件判断', en: 'Conditions' },
  { id: 'ch3-46-alu', chapter: 3, index: 46, zh: '计算核心', en: 'ALU' },
  {
    id: 'ch3-47-immediate-values',
    chapter: 3,
    index: 47,
    zh: '立即数',
    en: 'Immediate Values',
  },
  { id: 'ch3-48-program', chapter: 3, index: 48, zh: '程序', en: 'Program' },
  { id: 'ch3-49-turing-complete', chapter: 3, index: 49, zh: '图灵完备', en: 'Turing Complete' },

  // Chapter 4 -- 编程 (Programming), 7 levels
  {
    id: 'ch4-50-punchcard-programming',
    chapter: 4,
    index: 50,
    zh: '打孔编程',
    en: 'Punchcard Programming',
  },
  {
    id: 'ch4-51-assembly-programming',
    chapter: 4,
    index: 51,
    zh: '汇编程序',
    en: 'Assembly Programming',
  },
  { id: 'ch4-52-circumference', chapter: 4, index: 52, zh: '三番两次', en: 'Circumference' },
  { id: 'ch4-53-conditional-jumps', chapter: 4, index: 53, zh: '条件跳转', en: 'Conditional Jumps' },
  { id: 'ch4-54-code-breaker', chapter: 4, index: 54, zh: '道破心机', en: 'Code Breaker' },
  { id: 'ch4-55-mod-4', chapter: 4, index: 55, zh: '高速掩码', en: 'Mod 4' },
  { id: 'ch4-56-the-maze', chapter: 4, index: 56, zh: '路在脚下', en: 'The Maze' },
];
