/**
 * 画在元件本体上的标记（丝印）。
 *
 * 元件标注得像芯片顶面的丝印：`NAND`、`NOT`、`MUX`、`ADD` ——
 * 短短的大写助记符，而不是名字。位宽单独放在角标里，所以 `and` 和 `and8` 都印 `AND`，
 * 靠后者角上的 `8` 区分。一块写满中文元件名的画板读起来像菜单；
 * 一块写满丝印缩写的画板读起来像原理图，而且四个大写字母在任何缩放下都看得清。
 *
 * 它是一张“表”，而不是元件定义上的字段，这是有意拆开的：
 * 丝印是绘制决策——几个字符能塞进一个 D 形、盾形或 72 像素的方块里，取决于玩家当前的缩放；
 * `core/` 没有理由知道这些。元件托盘仍然显示中文名（玩家挑元件时读的是它），
 * tooltip 同时给出英文名与丝印，两套词汇表在需要的时候才被对上。
 *
 * `appearance.test.ts` 会遍历整个注册表：任何元件缺条目、条目超过六个字符或不是大写都会失败。
 * 这样后来新增的元件就不能悄悄顶着 `8 位算术右移` 出厂。
 */
import type { ComponentDef } from '../../core/registry';

/** 每个已注册元件的丝印，按元件定义 id 索引。 */
const MARKING: Readonly<Record<string, string>> = {
  // -- 信号源
  const_on: 'ON',
  const_off: 'OFF',
  const8: 'CONST',

  // -- 十个 1 位元件
  nand: 'NAND',
  not: 'NOT',
  and: 'AND',
  or: 'OR',
  nor: 'NOR',
  xor: 'XOR',
  xnor: 'XNOR',
  and3: 'AND3',
  or3: 'OR3',
  full_adder: 'FA',

  // -- 关卡接线
  level_input: 'IN',
  level_output: 'OUT',

  // -- 存储
  delay_line: 'DELAY',
  mem1: 'MEM',

  // -- 字节运算器：位宽靠角标表达，不写进丝印
  and8: 'AND',
  or8: 'OR',
  nand8: 'NAND',
  nor8: 'NOR',
  xor8: 'XOR',
  xnor8: 'XNOR',
  not8: 'NOT',
  add8: 'ADD',
  neg8: 'NEG',
  // 有符号与无符号“小于”比较，沿用各指令集通用的助记符。
  less_s: 'SLT',
  less_u: 'SLTU',
  equal8: 'EQ',
  shift_l8: 'SHL',
  shift_r8: 'SHR',
  ashr8: 'SAR',
  rot_l8: 'ROL',
  rot_r8: 'ROR',
  mul8: 'MUL',
  div8: 'DIV',
  splitter: 'SPLIT',
  maker: 'MAKE',
  // 沙盒里 16 位与 32 位的打包/拆包器。每种操作只有一个丝印，和 `and` / `and8` 同理：
  // 位宽由引脚表达（在托盘里则由名字表达），不靠丝印——
  // 分离器的第一个输出只有 1 位，所以它角上的徽标不可能写着“它拆出来的那个字”。
  splitter16: 'SPLIT',
  maker16: 'MAKE',
  splitter32: 'SPLIT',
  maker32: 'MAKE',
  switch: 'SW',
  switch8: 'SW',
  mux8: 'MUX',
  delay8: 'DELAY',
  reg8: 'REG',
  counter8: 'CNT',
  ram8: 'RAM',
  decoder1: 'DEC1',
  decoder2: 'DEC2',
  decoder3: 'DEC3',

  // -- 机器
  alu8: 'ALU',
  regfile6: 'RF',
  instr_decoder: 'DECODE',
  pc8: 'PC',
  ram_prog: 'PRAM',
  halt: 'HALT',
};

/**
 * 一个元件的丝印缩写。
 *
 * 兜底分支是保险，不是策略：它把 id 转成大写、只保留字母和数字、再截到六个字符。
 * `appearance.test.ts` 会先一步失败，所以正常构建永远走不到这里；
 * 真有没有丝印的元件时，输出会是 `FULL_A` 这种东西，测试会直接点名它。
 *
 * @param def 元件定义
 * @returns 丝印：最多六个大写字母/数字
 */
export function partCodeOf(def: ComponentDef): string {
  const marked = MARKING[def.id];
  if (marked !== undefined) return marked;
  return def.id
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 6);
}
