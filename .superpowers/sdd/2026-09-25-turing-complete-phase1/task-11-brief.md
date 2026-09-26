## Task 11: 第 2 章关卡 28–38（存储与时序）

**Files:** `src/levels/content/ch2/batch4.ts`, `test/levels/ch2-batch4.test.ts`

| # | 关卡名（源资料） | io | 检查器 | 解锁 | 教学点 |
|---|---|---|---|---|---|
| 28 | Circular Dependency 循环依赖 | `set:1` `value:1` → `out:1` | script + 稳定性 | `ram8` | 反馈回路构成锁存器 |
| 29 | Delayed Lines 延迟线 | `a:8` → `out:8` | script 逐拍 | `reg8` `delay8` | 延迟一拍 |
| 30 | Odd Ticks 奇变偶不变 | `enable:1` → `out:1` | script + 周期断言 | — | 振荡器即时钟源 |
| 31 | Bit Inverter 1 位取反器 | `a:1` `inv:1` → `out:1` | truth-table 4 行 | — | XOR 做条件取反 |
| 32 | Bit Switch 1 位开关 | `a:1` `on:1` → `out:1` | truth-table 4 行 | — | 条件通断 |
| 33 | Input Selector 数据选择器 | `a:8` `b:8` `sel:1` → `out:8` | fuzz 256 轮 | `mux8` | 2-to-1 MUX |
| 34 | The bus 总线 | `a:8` `b:8` `sel:1` → `out:8` | truth-table 4 行 | — | 唯一驱动有效 |
| 35 | Saving Gracefully 优雅存储 | `d:1` `load:1` → `out:1` | script 逐拍 | — | 条件写入锁存器 |
| 36 | Saving Bytes 存储一字节 | `d:8` `load:1` → `out:8` | script 逐拍 | `counter8` | 8 位寄存器 |
| 37 | Little Box 小盒子 | `d:8` `addr:8` `load:1` → `out:8` | script 逐拍 | — | 256 字节全装满 |
| 38 | Counter 计数器 | `en:1` `reset:1` → `out:8` | script + 回绕 | — | 自增寄存器 |

要求：

- 第 28 关的「稳定性」指：`settle()` **不得**抛 `UnstableCircuitError`。
  这是本关的核心断言 —— 玩家必须用存储元件切断组合环。必须有反例：
  纯组合的 `not` 环必须抛错。
- 第 30 关必须断言**周期性**（连续多拍的高低翻转规律），
  不能只断言「某一拍为高」。`enable=0` 时输出必须保持，不得继续振荡。
- 第 34 关按 spec §3.1「不做总线协议（多驱动仲裁）」改建为选择器关：
  `out` 恰好等于被选中的那一路。这一改建（以及「本引擎禁止多驱动」这条理由）
  必须写进关卡数据注释与 `brief`。
- 第 37 关源资料只有「刚好装满存储空间的电路设计」一句：
  本作定义为「用 `ram8` 的 256 字节全部可寻址且可读回」，
  即 `addr` 0–255 每一格写入后都能读回原值。这一定义必须写进 `brief`。
- 第 38 关源资料的成就是「≤ 65 个门」，映射为 `threeStar.gate` 实测门槛，
  并在数据注释里说明。


