# 第 4 章参考程序（控制器预先验证，2026-10-08）

验证方式：把 `src/asm/index.ts` 用 bundled tsc 编到临时目录，再用 bundled node 调用
`assemble(source, OVERTURE_ISA)`。**六个程序全部 0 错误**，字节与手工编码一致。
第 50 关用机器码（不走汇编器），字节由 `parseImage` 解析，编码规则同 ISA 表。

ISA 编码速查（`src/asm/isa.ts:162-214`）：

| 模式 | op[7:6] | 低 6 位 |
|---|---|---|
| `loadi` | `00` | 6 位立即数 → REG0 |
| calc | `01` | `[5:3]` 运算（add 0 / sub 1 / and 2 / or 3 / nand 4 / nor 5），`[2:0]`=0 |
| `move` | `10` | `[5:3]` 源（s0–s5=0–5, inp=6）、`[2:0]` 目的（d0–d5=0–5, out=7） |
| jump | `11` | `[5:3]` 条件（j 0 / jz 1 / jnz 2），目标取 REG0，条件取 REG3，`[2:0]`=0 |

## ch4-50 打孔编程 — `out = (in + 5) & 0xff`

机器码（每行 8 位，`parseImage` 解析）：

```
10110001    # move inp -> r1
00000101    # loadi 5
10000010    # move r0  -> r2
01000000    # add        r3 = r1 + r2
10011111    # move r3  -> out
```

## ch4-51 汇编程序 — `out = (in + 3) & 0xff`

```
move|inp|d1
loadi|3
move|s0|d2
add
move|s3|out
```
字节：`B1 03 82 40 9F`（5 字节）

## ch4-52 三番两次 — `out = (6 * r) & 0xff`

```
move|inp|d1     # r1 = r
move|inp|d2     # r2 = r
add             # r3 = 2r
move|s3|d1      # r1 = 2r
add             # r3 = 3r
move|s3|d2      # r2 = 3r
add             # r3 = 6r
move|s3|out
```
字节：`B1 B2 40 99 40 9A 40 9F`（8 字节）

## ch4-53 条件跳转 — `out = (n + (n-1) + … + 1) & 0xff`

r5 = 计数器，r4 = 累加器；循环以「计数器减 1 后 r3 == 0」为出口。

```
 0: move|inp|d5   # r5 = n
 1: move|s5|d1    # <- 循环
 2: move|s4|d2
 3: add           # r3 = 计数 + 累加
 4: move|s3|d4    # 累加 = r3
 5: move|s5|d1
 6: loadi|1
 7: move|s0|d2
 8: sub           # r3 = 计数 - 1
 9: move|s3|d5    # 计数 = r3
10: loadi|14      # r0 = 14（出口）
11: jz            # r3 == 0 → 14
12: loadi|1       # r0 = 1（循环）
13: j             # → 1
14: move|s4|out
```
字节：`B5 A9 A2 40 9C A9 01 82 48 9D 0E C8 01 C0 A7`（15 字节）

## ch4-54 道破心机 — 逐值试探直到 `match` 读到 1

r5 = 候选值；循环体：输出候选 → 读 `match` → `r3 = match` → 非 0 则跳到 16（自旋，输出保持）。

```
 0: loadi|0
 1: move|s0|d5    # r5 = 0
 2: move|s5|out   # <- 循环：try = r5
 3: move|inp|d1   # r1 = match
 4: loadi|0
 5: move|s0|d2
 6: add           # r3 = match
 7: loadi|16      # r0 = 16
 8: jnz           # match != 0 → 16
 9: move|s5|d1
10: loadi|1
11: move|s0|d2
12: add           # r3 = 候选 + 1
13: move|s3|d5   # 候选++
14: loadi|2
15: j             # → 2
16: loadi|16
17: j             # 自旋
```
字节：`00 85 AF B1 00 82 40 10 D0 A9 01 82 40 9D 02 C0 10 C0`（18 字节）

## ch4-55 高速掩码 — `out = in & 3`

```
move|inp|d1
loadi|3
move|s0|d2
and
move|s3|out
```
字节：`B1 03 82 50 9F`（5 字节）

## ch4-56 路在脚下 — 沿墙走

`maze` 检查器的传感器位序：bit0 前方有墙、bit1 左侧有墙、bit2 右侧有墙；
`move` 输出：0 原地、1 前进、2 左转、3 右转。规则：左空则左转，否则前方空则前进，否则右转。

```
 0: move|inp|d4   # r4 = sensors
 1: move|s4|d1    # <- 循环
 2: loadi|2
 3: move|s0|d2
 4: and           # r3 = sensors & 2（左墙）
 5: loadi|19      # r0 = 19（左转）
 6: jz            # 左空 → 19
 7: move|s4|d1
 8: loadi|1
 9: move|s0|d2
10: and           # r3 = sensors & 1（前墙）
11: loadi|23      # r0 = 23（前进）
12: jz            # 前空 → 23
13: loadi|3
14: move|s0|out   # move = 3（右转）
15: loadi|1
16: j             # → 1
17: loadi|1       # 填充（不可达）
18: j
19: loadi|2
20: move|s0|out   # move = 2（左转）
21: loadi|1
22: j             # → 1
23: loadi|1
24: move|s0|out   # move = 1（前进）
25: loadi|1
26: j             # → 1
```
字节：`B4 A1 02 82 50 13 C8 A1 01 82 50 17 C8 03 87 01 C0 01 C0 02 87 01 C0 01 87 01 C0`（27 字节）

## 给 T7/T8 的口径

- 这些字节是**参考解**，不是关卡数据里的 `source`：第 4 章的关卡是 `from: 'player'`，
  参考程序只出现在 `test/fixtures/ch4-references.ts` 与逐批测试里。
- 第 54/56 关的参考程序必须与 `lock`/`maze` 检查器的语义**对齐**：
  `lock` 在第一次读到 `match === 1` 的那一拍停止并判定通过；
  `maze` 每拍读一次 `move` 并推进世界。若实现者改了语义，必须先改这里并说明。
- `maze` 的迷宫必须让上面的「左空左转 → 前空前进 → 否则右转」策略能在预算内到达终点，
  且**不能**让「一直前进」的平凡程序也通过（反例测试要覆盖这一点）。
