// 第 3 章第 2 批：全局第 42-44 关——指令译码器、建立在它之上的计算单元、以及跳转所需的条件测试。
// 依赖下层 `asm`（ISA 表与字段切片）、`core/signal`（掩码）与 `tables`（真值表、引脚形状）；
// 本文件只被 `content/ch3/index.ts` 拼接。导出的 `PROGRAM_43` 是第 43 关 `program` 检查运行的汇编源。
// 关键不变量：指令字段的偏移与宽度一律从 `OVERTURE_ISA` 读取，不在本文件重复声明。

import { OVERTURE_ISA } from '../../../asm/index';
import { maskInto } from '../../../core/signal';
import type { FieldRange } from '../../../asm/index';
// 这里的 `LevelIo` 是"引脚形状"，来自 `tables.ts`；`checks.ts` 也导出了一个同名但无关的
// 运行时接口（绑定后的仿真环境），两者不要混用。
import { truthTable, type LevelIo } from '../../tables';
import type { LevelSpec, ProgramStep, ScriptStep } from '../../spec';

/**
 * 第 3 章第 42-44 关：指令译码器、建立在它之上的计算单元、以及一次跳转由什么条件构成。
 *
 * 资料固定了什么、没固定什么。与前面每个批次一样：攻略资料对每一关只给三样东西——
 * 双语名字、在章节里的位置、一句话的教学概念。它没有给端口、位宽、通过条件、目标值和奖励。
 * 下面玩家能看到、测试能测到的一切都是本项目的设计；每关带一条数据注释，
 * 分成 `SOURCED`（来自资料）与 `AUTHORED`（本项目设计），与第 2 章四个批次、第 3 章第一批完全一致。
 * 若某关的设计引用了资料自己的数字（第 44 关的成就），该数字只作为成就记录，绝不当作目标——设计规格 §5.4。
 *
 * 指令编码是"读取"来的，不是"复述"来的。下面的字段偏移与宽度来自 `OVERTURE_ISA`
 * （`src/asm/isa.ts`），它是 ruling 5 布局的唯一权威：第 42 关的真值表用 ISA 自己的
 * `offset`/`width` 对切分指令字，所以改动那张表会带着关卡一起移动，而不是留下两份答案。
 * ISA 刻意不陈述的东西——一条指令到底"做什么"——是关卡自己的接线，也正是本章的全部内容
 * （全局约束 11）。
 *
 * `program` 检查器的节拍语义对第 43 关是承重的，与第 2 章的脚本一样。
 * `levels/checks.ts` 会先写入一步的输入并结算，再把时钟推进到该步的 `tick`（`driveSteps`），因此：
 *
 *  * 位于节拍 `T` 的一步，执行的是上一步节拍到 `T` 之间的那些沿，而进入 `T` 的那个沿
 *    采样的是"该步写入"的输入；
 *  * 所以 `tick` 是绝对目标，位于节拍 0 的步骤不执行任何沿——这正是第 43 关的遍历
 *    从节拍 0、以复位状态开始的原因；
 *  * 一个沿执行该步写入的那条指令，随后的比较读取执行后的状态。
 *
 * 因此第 43 关的步骤用"指令的地址"驱动 `instr`——节拍 1 写 0、节拍 2 写 1，依此类推——
 * 这就是该关的 `instr` 引脚是地址而不是指令字的全部原因（见该关注释）。
 *
 * 托盘。每一关都提供 `level_input`/`level_output`，它们始终可用、从不解锁；
 * 任何关卡都不提供"本级或更早的关卡尚未发放"的元件——这条规则由
 * `test/levels/level-buildability.test.ts` 遍历。这就是第 43 关的托盘里有 `pc8`
 * （第 42 关的奖励）却没有 `halt`（第 44 关的奖励）的原因，尽管两者都列在阶段计划为
 * 本批次准备的表格里：在 43 关，`halt` 还没挣到，在那里提供它会失败那次遍历。
 * `ram_prog` 是 43 关自己的奖励，`paletteDefsFor` 会在它所属的关卡上提供它。
 */

/** 每一关都提供、但任何关卡都不作为奖励发放的两个连接器。 */
const LEVEL_IO = ['level_input', 'level_output'] as const;

/** 第 13 关发放的两个打包器与字节常量。 */
const BYTE_WIRING = ['splitter', 'maker'] as const;

/** 第 3 章 39-41 关奖励的译码器、寄存器堆与 ALU。 */
const CPU_PARTS = ['alu8', 'regfile6', 'instr_decoder'] as const;

const IO_DECODER: LevelIo = {
  inputs: [{ id: 'instr', width: 8 }],
  outputs: [
    { id: 'mode', width: 2 },
    { id: 'op', width: 3 },
    { id: 'dst', width: 3 },
    { id: 'imm', width: 6 },
  ],
};
const IO_CALC: LevelIo = {
  inputs: [
    { id: 'clk', width: 1 },
    { id: 'instr', width: 8 },
    { id: 'inp', width: 8 },
  ],
  outputs: [{ id: 'res', width: 8 }],
};
const IO_CONDITIONS: LevelIo = {
  inputs: [
    { id: 'clk', width: 1 },
    { id: 'instr', width: 8 },
  ],
  outputs: [{ id: 'skip', width: 1 }],
};

/**
 * 按模式与字段 id 查 ISA 的一个字段，查不到就大声失败。
 *
 * 这里用 `throw` 而不是"读到 0"的默认值是正确的：这是作者数据在模块加载时失败，
 * 缺字段是关卡的 bug，不是玩家输入的东西；而一个悄悄归零的字段，
 * 会让第 42 关断言一段没有人选择过的切片。
 */
function isaField(modeId: string, fieldId: string): FieldRange {
  const mode = OVERTURE_ISA.modes.find((entry) => entry.id === modeId);
  const field = mode?.fields.find((entry) => entry.id === fieldId);
  if (!field) throw new Error(`OVERTURE_ISA has no "${fieldId}" field in mode "${modeId}"`);
  return field;
}

/** `word` 在 `field` 下的那些位，按该字段自己的宽度取值。 */
function sliceOf(field: FieldRange, word: number): number {
  return maskInto(word >>> field.offset, field.width);
}

/**
 * 第 42 关发布的四段切片，各自以"它本身就是的那个 ISA 字段"命名。
 *
 * `mode` 是 ISA 自己的共享模式字段；`op` 是 `calc` 的运算字段，`dst` 是 `move` 的目的字段，
 * `imm` 是 `immediate` 的立即数字段。译码器对每一条指令都发布这四段，不论它是什么模式——
 * 这正是本关断言的东西：四段切片存在于指令字中，而一条指令用其中哪一段，是本章后面的事。
 */
const MODE_FIELD = OVERTURE_ISA.modeField;
const OP_FIELD = isaField('calc', 'op');
const DST_FIELD = isaField('move', 'dst');
const IMM_FIELD = isaField('immediate', 'imm');

/**
 * 第 42 关的检查：全部 2^8 条指令，每条一行。
 *
 * `truthTable` 枚举唯一的 8 位输入，并逐个询问每个输出引脚的函数；
 * 四个函数都用 ISA 自己的偏移与宽度切分指令字，所以真值表不可能与 `isa.ts` 不一致，
 * 也不可能只写一半（某个声明了输出引脚却没有函数的表，会在模块加载时抛错）。
 * 256 行就是全部指令：没有抽样，也没有遗漏。
 */
const DECODER_TABLE = truthTable(IO_DECODER, {
  mode: ({ instr }) => sliceOf(MODE_FIELD, instr ?? 0),
  op: ({ instr }) => sliceOf(OP_FIELD, instr ?? 0),
  dst: ({ instr }) => sliceOf(DST_FIELD, instr ?? 0),
  imm: ({ instr }) => sliceOf(IMM_FIELD, instr ?? 0),
});

/**
 * 第 43 关的程序，写成 `program` 检查器会汇编的源文本。
 *
 * 十条指令，每拍一条，每条走机器不同的路径：`loadi`（立即数进 REG0）、
 * `move|inp|d1`（输入端口）、`move|s0|d2`（寄存器到寄存器）、`add`、
 * `move|s3|d4`（把 REG3 当源读回）、`sub`、`move|s3|out`（目的为端口的移动，
 * 寄存器堆必须忽略它）、`nor`（第三种 ALU 运算）以及 `move|s4|d3`
 * （目的"就是" REG3 的移动，检查借此看到 REG4 里存着先前写进去的字节）。
 */
export const PROGRAM_43 = [
  '# the calculation unit, one instruction per tick',
  'loadi|5', // 0：REG0 = 5
  'move|inp|d1', // 1：REG1 = inp
  'move|s0|d2', // 2：REG2 = REG0 = 5
  'add', // 3：REG3 = REG1 + REG2
  'move|s3|d4', // 4：REG4 = REG3
  'sub', // 5：REG3 = REG1 - REG2
  'move|s3|out', // 6：输出端口；本关没有输出端口，因此没有寄存器被写入
  'nor', // 7：REG3 = ~(REG1 | REG2)
  'move|s3|d5', // 8：REG5 = REG3
  'move|s4|d3', // 9：REG3 = REG4，也就是第 3 条指令算出的字节
].join('\n');

/**
 * 第 43 关的遍历：十一步，每步一条指令，以及机器在该指令的沿之后必须发布的 `res` 字节。
 *
 * 前两条指令期间 `inp` 驱动 10，此后驱动 40，而第 3 条指令仍然必须发布 15（`10 + 5`）。
 * 一个把关卡输入引脚直接接进 ALU、而不是经过 REG1 的电路，在这里会发布 45——
 * 这是本遍历第一个"有牙齿"的断言。地址来自程序自身：位于节拍 `T` 的步骤驱动地址 `T - 1`，
 * 因为那正是它的沿所执行的指令。
 */
const STEPS_43: readonly ProgramStep[] = [
  { tick: 0, inputs: { instr: 0, inp: 10 }, expect: { res: 0 } },
  { tick: 1, inputs: { instr: 0, inp: 10 }, expect: { res: 0 } },
  { tick: 2, inputs: { instr: 1, inp: 10 }, expect: { res: 0 } },
  { tick: 3, inputs: { instr: 2, inp: 40 }, expect: { res: 0 } },
  { tick: 4, inputs: { instr: 3, inp: 40 }, expect: { res: 15 } },
  { tick: 5, inputs: { instr: 4, inp: 40 }, expect: { res: 15 } },
  { tick: 6, inputs: { instr: 5, inp: 40 }, expect: { res: 5 } },
  { tick: 7, inputs: { instr: 6, inp: 40 }, expect: { res: 5 } },
  { tick: 8, inputs: { instr: 7, inp: 40 }, expect: { res: 240 } },
  { tick: 9, inputs: { instr: 8, inp: 40 }, expect: { res: 240 } },
  { tick: 10, inputs: { instr: 9, inp: 40 }, expect: { res: 15 } },
];

/**
 * 第 44 关遍历要驱动的指令字节，按 ruling 5 手工编码。
 *
 * 它们写成字面量而不是汇编出来，是因为本关的检查是 `script`：译码"就是"本关的内容，
 * 所以一个模式或条件字段被切错的字节，正是要被测试的东西。`MOVE_S0_D1` 与 `SUB`
 * 被刻意放进遍历：它们的 `[5:3]` 字段是 000 和 001，
 * 一个不看模式就译码条件的电路会把它们当成 `j` 和 `jz`。
 */
const LOADI_5 = 0x05; // 00 000101：loadi|5
const LOADI_0 = 0x00; // 00 000000：loadi|0
const MOVE_S0_D1 = 0x81; // 10 000 001：move|s0|d1 —— [5:3] = 000
const SUB = 0x48; // 01 001 000：sub —— [5:3] = 001
const J = 0xc0; // 11 000 000：j
const JZ = 0xc8; // 11 001 000：jz
const JNZ = 0xd0; // 11 010 000：jnz
const INVALID_COND = 0xd8; // 11 011 000：条件码 3，不是分支

/**
 * 第 44 关的遍历：先装入一个保持值，再把每种条件都对着它问一遍。
 *
 * 该值用 `loadi` 装入（本关唯一的寄存器）；在它保持期间驱动一次 `move`、一次 `calc`，
 * 证明它们不是分支；然后分别对着 5、对着 0、再对着 5 询问三种条件。
 * 最后两步驱动 `INVALID_COND`，它的条件码不是 ISA 定义的三种之一：
 * 关卡在这里把 `skip` 定义为 0，所以契约是完备的。
 */
const STEPS_44: readonly ScriptStep[] = [
  { tick: 0, inputs: { instr: LOADI_5 }, expect: { skip: 0 } },
  { tick: 1, inputs: { instr: LOADI_5 }, expect: { skip: 0 } },
  { tick: 2, inputs: { instr: MOVE_S0_D1 }, expect: { skip: 0 } },
  { tick: 3, inputs: { instr: SUB }, expect: { skip: 0 } },
  { tick: 4, inputs: { instr: JZ }, expect: { skip: 0 } },
  { tick: 5, inputs: { instr: JNZ }, expect: { skip: 1 } },
  { tick: 6, inputs: { instr: J }, expect: { skip: 1 } },
  { tick: 7, inputs: { instr: LOADI_0 }, expect: { skip: 0 } },
  { tick: 8, inputs: { instr: JZ }, expect: { skip: 1 } },
  { tick: 9, inputs: { instr: JNZ }, expect: { skip: 0 } },
  { tick: 10, inputs: { instr: J }, expect: { skip: 1 } },
  { tick: 11, inputs: { instr: LOADI_5 }, expect: { skip: 0 } },
  { tick: 12, inputs: { instr: JZ }, expect: { skip: 0 } },
  { tick: 13, inputs: { instr: JNZ }, expect: { skip: 1 } },
  { tick: 14, inputs: { instr: INVALID_COND }, expect: { skip: 0 } },
];

export const CH3_BATCH2: readonly LevelSpec[] = [
  /**
   * ch3-44-instruction-decoder —— 指令解码器 / Instruction Decoder
   *
   * SOURCED：双语名字、位置（第 42 关，本章第四关）、资料的一句话概念——
   * 解析指令字节并选出运算。资料 §6.3 固定了本关要译码的形状：
   * 高两位是模式、低六位是参数，其中 `move` 把六位拆成三位源与三位目的；§6.1 固定了一字节指令字。
   * 低六位内部的字段顺序是本项目计划的 ruling 5，不是资料的，
   * 而且是从 `src/asm/isa.ts` 读来的，不在这里复述。
   *
   * AUTHORED：引脚形状（一根 8 位 `instr` 进；`mode` 2、`op` 3、`dst` 3、`imm` 6 出——
   * 本关不发布 `src` 引脚，因为 `src` 与 `op` 是同样的三位，有其中一个就够教这段切片了）、
   * 256 行真值表、托盘、`pc8` 奖励与实测目标。
   *
   * 表是从 ISA "生成"的，不是从它"抄"的。`truthTable` 枚举全部 256 个字节，
   * 四个函数各自用 ISA 自己的 `offset` 与 `width` 切分指令字，
   * 所以关卡不可能与 `isa.ts` 漂移，也不可能只写一半：某个声明了输出引脚却没有函数的表，
   * 在这个模块加载时就会抛错。这里没有抽样，也没有"代表性行"——
   * 指令译码器恰恰是"整个输入空间都负担得起"的电路。
   *
   * 托盘同时提供两种写法，而且它们打平。`instr_decoder` 是第 41 关的奖励，它"就是"这五段切片；
   * `splitter` 加四个 `maker` 是同样的接线手搭出来。两者都实测 0 个与非门当量、0 级延迟
   * （打包器与导线切片在两个指标上都免费，设计规格 §3.2），所以关卡区分不了它们，也不去区分：
   * 它评的是"哪些位属于哪个字段"，而无论玩家是知道布局还是伸手去拿元件，
   * 表达的都是同一份知识。因此实测的 `gate` 为 0 是"预期如此"，不是一个缺失的数字——
   * 本关的成本是它的 `delay`，而那也是 0。
   */
  {
    id: 'ch3-44-instruction-decoder',
    chapter: 3,
    index: 44,
    name: { zh: '指令译码器', en: 'Instruction Decoder' },
    brief: {
      zh: '一条指令是一个字节：高 2 位是模式，低 6 位是这一模式的参数。把 instr 拆成四个字段输出——mode = instr[7:6]、op = instr[5:3]、dst = instr[2:0]、imm = instr[5:0]。256 种输入组合全部都要对。',
      en: 'An instruction is one byte: the top two bits are the mode and the low six are that mode\u2019s argument. Publish four slices of instr -- mode = instr[7:6], op = instr[5:3], dst = instr[2:0], imm = instr[5:0]. All 256 input combinations have to be right.',
    },
    hint: {
      zh: '位拆分器把 instr 拆成八根线，再用四个位合并器把每个字段需要的位按低位在前的顺序拼回去：mode 用第 6、7 位，op 用第 3、4、5 位，dst 用第 0、1、2 位，imm 用第 0 到第 5 位。奖励的指令解码器（instr_decoder）就是这五条切片，直接放上去也一样。',
      en: 'Split instr into its eight bits and pack each field back with four Makers, least significant bit first: mode takes bits 6 and 7, op bits 3-5, dst bits 0-2 and imm bits 0-5. The Instruction Decoder this level rewards is those same five slices, so dropping it in works too.',
    },
    allowedComponents: [...BYTE_WIRING, 'instr_decoder', 'const_on', 'const_off', ...LEVEL_IO],
    io: IO_DECODER,
    checks: [DECODER_TABLE],
    // 实测：手接切片的参考电路（一个 Splitter 加四个 Maker）是 0 个与非门当量、0 级延迟，
    // 而纯组合关卡不跑节拍。`instr_decoder` 测出的也是同样三个数——见上面的注释。
    threeStar: { gate: 0, delay: 0, tick: 0 },
    rewards: { components: ['pc8'] },
  },

  /**
   * ch3-45-conditions —— 条件判断 / Conditions
   *
   * SOURCED：双语名字、位置（第 44 关）、资料的一句话概念——判断一个值小于、等于还是大于零——
   * 以及 §6.4 的跳转表，也就是本关要评的东西：`j` 总是成立；`jz` 在被比较的值为零时成立；
   * `jnz` 在不为零时成立；被比较的值来自机器保存的某个寄存器。
   * 资料还为本关记录了一个成就"只用了 10 个蓝色元件"；按设计规格 §5.4，
   * 成就只被"记录"，绝不用作三星目标，所以它出现在本注释里，别处不再出现。
   *
   * AUTHORED，以及本关做的一处化简。本关的机器只有一个寄存器：`loadi` 把 6 位立即数写进去，
   * 跳转再把它读回来当条件值。完整的 OVERTURE 里这是两个寄存器——
   * REG0 存跳转目标，REG3 存被比较的值——而 45-47 关才把它们搭出来；
   * 这里关卡只关心条件逻辑本身，所以 brief 用两种语言都说明了这处化简，
   * 遍历用 `loadi` 设置那个值。其余都来自 ISA：模式字段决定这条指令到底是不是跳转，
   * 条件字段三个已定义码在"总成立 / 为零成立 / 非零成立"之间选择，其它码一律发布 0。
   *
   * AUTHORED（其余部分）：引脚形状；由十二个元件构成的条件单元（译码、那一个寄存器、
   * 与零比较的 `equal8`、给条件字段用的 `decoder3`，以及与/或/非胶水）；
   * 十五步遍历；托盘；`halt` 奖励；以及实测目标。
   *
   * 遍历的构造让两种"看似合理但错误"的单元都失败，批次测试把两者都搭了出来。
   * 一个只看条件字段、不看模式的单元会把 `move|s0|d1` 当成 `j`（它的 `[5:3]` 是 000），
   * 把 `sub` 当成 `jz`（001），而遍历在保持值非零时驱动两者，关卡在那里要求 0。
   * 一个从不装载保持值的单元会把它卡在零，于是对着 5 的 `jnz` 发布 0，而遍历要求 1。
   * 条件码 3 的那一步，则会让一个"把条件位或起来"而不是译码的单元失败。
   */
  {
    id: 'ch3-45-conditions',
    chapter: 3,
    index: 45,
    name: { zh: '条件判断', en: 'Conditions' },
    brief: {
      zh: '条件判断：跳转指令从寄存器里读条件值（完整机器里是 REG3）。本关的机器只有一个寄存器——loadi 把 6 位立即数写进去，跳转指令读它。skip 在分支成立时为 1：j（条件 000）永远成立；jz（001）在值为 0 时成立；jnz（010）在值不为 0 时成立；其它条件码不是分支，skip 为 0，而 move 或 calc 这类不是跳转的指令，skip 也必须是 0。',
      en: 'Conditions: a jump reads its condition value from a register (REG3 in the full machine). This level\u2019s machine has exactly one register -- loadi writes the 6-bit immediate into it, and a jump reads it back. skip is 1 when the branch is taken: j (condition 000) always, jz (001) when the value is zero, jnz (010) when it is not. Any other condition code is not a branch and publishes 0, and an instruction that is not a jump -- a move or a calc -- must publish 0 as well.',
    },
    hint: {
      zh: '先用 instr_decoder 拆出 mode 与条件字段：mode 等于 11 才是跳转。条件字段（3 位）送进 3 位译码器，得到「条件 0 / 1 / 2」三根线；寄存器的值用 equal8 与 0 比较得到「是否为零」。jz 与「是零」相与、jnz 与「不是零」相与，再和 j 或起来，最后与「这是跳转」相与。寄存器由 loadi（mode 00）写入，数据就是 imm 字段。',
      en: 'Decode mode and the condition field first: only mode 11 is a jump. Feed the 3-bit condition field to a 3-Bit Decoder for the "condition 0 / 1 / 2" lines, and compare the register against zero with an Equal part. AND jz with "is zero", AND jnz with "is not zero", OR those with j, and finally AND the result with "this is a jump". The register is written by loadi (mode 00) from the imm field.',
    },
    allowedComponents: [
      ...BYTE_WIRING,
      ...CPU_PARTS,
      'reg8',
      'equal8',
      'decoder3',
      'const_on',
      'const_off',
      'not',
      'and',
      'or',
      'nor',
      'nand',
      'xor',
      'and3',
      'or3',
      'switch',
      'switch8',
      'mux8',
      ...LEVEL_IO,
    ],
    io: IO_CONDITIONS,
    checks: [{ kind: 'script', steps: STEPS_44 }],
    // 实测：上面的参考电路——`equal8`（54 个与非门当量）与 `decoder3`（27）主导门指标，
    // 与/或胶水补上其余部分；最长的组合路径从保持寄存器出发，穿过零测试、
    // jnz 门控与两个与门，到达 `skip`。资料那个"10 个蓝色元件"的成就记录在注释里，
    // 刻意"不"作为本目标：设计规格 §5.4。
    threeStar: { gate: 100, delay: 5, tick: 14 },
    rewards: { components: ['halt'] },
  },

  /**
   * ch3-46-alu —— 计算核心 / Calculations
   *
   * SOURCED：双语名字、位置（第 43 关）、资料的一句话概念——把 ALU 与寄存器整合起来，
   * 实现计算类指令。机器接线的寄存器角色来自资料自己的 §6.2 表：
   * `loadi` 目标为 REG0，一次计算读 REG1 与 REG2、把结果留在 REG3，
   * `move` 携带源字段与目的字段。本关程序运行的指令来自 §6.4。
   *
   * AUTHORED，以及 brief 必须解决的一件事。本关是 `program` 检查，而
   * `programTargets`（`levels/checks.ts`）要求电路里有 `ram_prog` 实例来装载汇编后的镜像——
   * 一个"没有地方放程序"的 `program` 检查是 `missing-io` 失败。
   * 所以本关的 `instr` 引脚携带"要取的指令的地址"，而镜像就是机器要执行的东西：
   * 被测试的是关卡自己的程序，不是第二次写进关卡数据的字节列表。
   * 第 45 关用 `pc8` 取代了那根引脚，这是两台机器唯一的区别。
   *
   * AUTHORED（其余部分）：引脚形状；字段到引脚的接线，包括 `addrA` 在 `move` 时携带源、
   * 在 `calc` 时携带 REG1，而 `addrB` 保持 REG2；写路径（`loadi` 写 REG0、
   * `calc` 写 REG3、`move` 写目的字段、跳转时 `we` 为低）；
   * 十指令程序及其十一步遍历；托盘；`ram_prog` 奖励；以及实测目标。
   *
   * "一条指令写到哪里"不是一个字段，机器用两个选择器说明了这一点：
   * `loadi` 的六位"就是"它的值，所以它写 REG0；`calc` 写 REG3，
   * 因为资料 §6.2 把结果放在那里，而 ruling 5 把 `calc` 的 [2:0] 切片保留
   * （汇编器往里面写零）；只有 `move` 写它携带的目的字段。
   *
   * `res` 发布 REG3，代价是一个影子寄存器。`regfile6` 有两个读端口，而且都用满了——
   * 一个给 `move` 的源、一个给 ALU 的第二个操作数——所以 REG3 由一个 8 位寄存器发布：
   * 它在"寄存器堆正在写 REG3"的那些沿上锁存同一个 `data` 字节（每次 `calc`，
   * 以及目的字段为 3 的 `move`）。两者不可能不一致：REG3 只在这些沿改变，两者都从零开始，
   * 影子寄存器不读任何其它引脚。按本章的裁决，存储在两个指标上都免费，
   * 所以影子寄存器不花三星目标的成本，同时让关卡的引脚诚实地说明这个字节来自哪里。
   *
   * 遍历才是让检查有牙齿的东西，它的形状由模块说明里的节拍语义决定。
   * `inp` 在第 1 条指令之后变化，而第 3 条指令仍必须发布 15，
   * 所以一个把输入引脚直接接进 ALU、而不是经过 REG1 的机器会失败；
   * `sub` 与 `nor` 两步会让一个硬接 `add` 的机器失败；
   * 最后一步（`move|s4|d3`）发布第 3 条指令算出的字节，
   * 所以它会让"move 的源或目的译码错误"的机器失败。批次测试把这三台机器都搭了出来，
   * 并断言它们失败。
   */
  {
    id: 'ch3-46-alu',
    chapter: 3,
    index: 46,
    name: { zh: '计算核心', en: 'ALU' },
    brief: {
      zh: '计算单元：一个时钟沿执行一条指令。程序存放在 ram_prog 里，instr 引脚给出要取哪一条指令（地址）。loadi 把 6 位立即数写进 REG0；calc 按 op 计算 REG1 与 REG2，结果写进 REG3；move 把源字段指定的寄存器（源为 6 时是 inp）复制到目标字段指定的寄存器，目标为 out 时寄存器堆不写入。写使能在跳转模式（11）下为低。res 始终输出 REG3。',
      en: 'The calculation unit: one instruction per clock edge. The program lives in the ram_prog and the instr pin carries the ADDRESS of the instruction to fetch. loadi writes its 6-bit immediate into REG0; calc computes REG1 op REG2 into REG3; move copies the register its source field names (inp when the source is 6) into the register its destination field names, and a destination of out writes no register. The write enable is low in jump mode (11). res always publishes REG3.',
    },
    hint: {
      zh: '指令先经 instr_decoder 拆成字段。寄存器堆的两个读地址必须随模式切换：计算时读 REG1/REG2，复制时读源字段。写地址有三个来源，不是字段照抄：loadi 写 REG0、calc 写 REG3（它的低 3 位是保留位，汇编器写 0）、只有 move 写目标字段——用两次选择把这三条规则拼出来即可。寄存器堆只有两个读端口，res 却要输出 REG3：再加一个 8 位寄存器，让它在「寄存器堆正在写 REG3」的那些时钟沿上（每次 calc，以及目标字段为 3 的 move）锁下同一个字节；存储元件不花门也不花延迟。',
      en: 'Decode the instruction first. The register file\u2019s two read addresses follow the mode: REG1/REG2 for a calc, the source field for a move. The write address has three sources rather than one copied field: loadi writes REG0, calc writes REG3 (its low three bits are RESERVED and the assembler leaves them zero), and only move writes its destination field -- two selects express all three rules. The register file has only two read ports while res publishes REG3, so add one 8-bit register and let it latch the same byte on the edges where the register file is writing REG3 (every calc, and a move whose destination field is 3); storage costs nothing on either metric.',
    },
    allowedComponents: [
      ...BYTE_WIRING,
      ...CPU_PARTS,
      'ram_prog',
      'pc8',
      'const_on',
      'const_off',
      'decoder3',
      'mem1',
      'delay_line',
      'delay8',
      'reg8',
      'mux8',
      'switch',
      'switch8',
      'and',
      'or',
      'nor',
      'nand',
      'not',
      'xor',
      'and3',
      'or3',
      ...LEVEL_IO,
    ],
    io: IO_CALC,
    checks: [
      {
        kind: 'program',
        source: PROGRAM_43,
        steps: STEPS_43,
      },
    ],
    // 实测：上面的机器——见注释。`ram_prog`、`regfile6` 与 `reg8` 是存储，对两个指标都没有贡献；
    // 两个 `decoder3`（各 27）、五个 `mux8`（各 32）、一个 `switch8`（16）与 ALU（264）
    // 组成了这个 510。
    threeStar: { gate: 510, delay: 4, tick: 10 },
    rewards: { components: ['ram_prog'] },
  },
];
