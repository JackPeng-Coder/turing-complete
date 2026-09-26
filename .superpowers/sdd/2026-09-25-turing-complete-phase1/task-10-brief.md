## Task 10: 第 2 章关卡 23–27（补码、解码器与逻辑引擎）

**Files:** `src/levels/content/ch2/batch3.ts`, `test/levels/ch2-batch3.test.ts`

| # | 关卡名（源资料） | io | 检查器 | 解锁 | 教学点 |
|---|---|---|---|---|---|
| 23 | Negative Numbers 负数 | `a:8` → `out:8` | fuzz 256 轮 | `div8` | 二进制补码表示 |
| 24 | Signed Negator 相反数 | `a:8` → `out:8` | fuzz 256 轮 | `less_s` `shift_l8` `shift_r8` | 取反 + 1 |
| 25 | 1 Bit Decoder 1 位解码器 | `sel:1` → `out:2` | truth-table 2 行 | `decoder1` | 1-to-2 解码 |
| 26 | 3 Bit Decoder 3 位解码器 | `sel:3` → `out:8` | truth-table 8 行 | `decoder3` | 3-to-8 解码 |
| 27 | Logic Engine 逻辑引擎 | `a:8` `b:8` `op:8` → `out:8` | fuzz 256 轮 | `ashr8` `rot_l8` `rot_r8` | 8 位算术逻辑单元 |

要求：

- 第 23 关源资料是「限时小游戏」，本作改建为补码运算电路；
  这一改建写进关卡数据注释。
- 第 27 关的 `op` 语义**源资料没有枚举**，因此必须由本计划钉死并在
  关卡 `brief` 里对玩家说清楚。采用 `op` 的低 3 位选择运算：
  `0=and 1=or 2=xor 3=not a 4=add 5=sub 6=shift_l(a, b 低 3 位) 7=ashr(a, b 低 3 位)`，
  `out` 为 8 位结果（`add`/`sub` 丢弃高位进位）。`brief` 必须逐条列出这 8 个操作码。
- 第 25 关解锁的解码器是**宽度参数化**的：`decoder1` 与 `decoder2` 是同一个
  组件定义在不同 `params.width` 下的形态，不各占一个解锁点。
  第 25 关的 `brief` 必须说明玩家可以用 `params.width` 得到 2 位解码器。
- 第 24 关的 `threeStar` 与第 23 关一样由参考解实测。

