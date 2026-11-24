# 课程与解锁表

本文件是本项目课程结构的唯一权威：各章有哪些关卡、每章发放哪些元件，
都由这里和 `src/levels/campaign.ts` 共同约束。关卡只能使用已经解锁的元件；
`test/levels/unlock-chain.test.ts` 会读取下表的 §3.3，并在两个方向上检查
“章节解锁表”和“关卡奖励”是否一致。

## 3. 课程结构

### 3.3 各章解锁元件

| 章节 | 本章发放的元件 |
|---|---|
| Ch1 基础逻辑 | `const_on` `const_off` `nand` `not` `and` `or` `nor` `xor` `xnor` `and3` `or3` `delay_line` `mem1` |
| Ch2 算术与存储 | `switch` `full_adder` `decoder1` `decoder2` `decoder3` `ram8` `reg8` `counter8` `mux8` `switch8` `splitter` `maker` `const8` `add8` `neg8` `and8` `or8` `not8` `nand8` `nor8` `xor8` `xnor8` `less_s` `less_u` `equal8` `shift_l8` `shift_r8` `mul8` `div8` `delay8` |
| Ch3 CPU | `alu8` `regfile6` `instr_decoder` `pc8` `ram_prog` `halt` `ashr8` `rot_l8` `rot_r8` |
| Ch4 编程 | 无新元件；解锁汇编 IDE 与调试器 |
| Ch5 进阶 CPU | 未实现 |
| Ch6 函数 | 未实现 |
| Ch7 汇编挑战与外设 | 未实现 |
| 沙盒专用 | `program` `rom` `network` `keyboard` `file_loader` `time` `wire_probe` `wire_probe_bit` `mem_probe` `mem_probe_bit` |

第 1 章 13 关，第 2 章 26 关，第 3 章 10 关，第 4 章 7 关，共 56 关。
