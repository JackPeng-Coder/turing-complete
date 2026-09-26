## Task 4: 宽位存储与序列组件

**Files:** `src/core/defs/wide.ts`, `src/core/net.ts`,
`test/core/registry.test.ts`, `test/core/net.test.ts`

落地 `reg8` `counter8` `mux8` `delay8` `ram8`，引脚名：

| id | 输入 | 输出 | 语义 |
|---|---|---|---|
| `mux8` | `a:8` `b:8` `sel:1` | `out:8` | `sel=0 → a`，`sel=1 → b` |
| `delay8` | `a:8` | `out:8` | 延迟恰好一个时钟拍 |
| `reg8` | `d:8` `load:1` `reset:1` | `out:8` | 时钟沿且 `load=1` 时采样；`reset=1` 时清零 |
| `counter8` | `en:1` `reset:1` | `out:8` | 时钟沿且 `en=1` 时 `+1`，溢出回绕到 0；`reset=1` 时清零 |
| `ram8` | `d:8` `addr:8` `load:1` | `out:8` | 256 字节存储；`load=1` 时写入 `addr`，否则读 |

- 存储契约（Global Constraint 5）是**硬约束**。
- `Simulation.#publishState` 目前假设「每个状态字节对应一条 1 位输出引脚」
  （见 `net.ts` 该函数注释）—— **必须扩展**，否则 `reg8` 只发布低 1 位。
- 同时给出 `reset=1` 与 `load=1` / `en=1` 时谁优先，并在**注释与测试**里钉死。
- 测试必须包含 spec §12 点名的三类：
  - **锁存**：`reg8` 在输入翻转后、下一个时钟沿之前保持旧值
    （阶段 0 `delay_line` 正是在这里栽过：镜像输入 = 退化成导线）。
  - **振荡**：`nand` + `delay_line`（或 `not` + `delay8`）构成的环形振荡器
    在 `settle()` 下**必须稳定**（存储元件切断组合环），每个 `tick()` 翻转一次。
  - **计数器**：连续 `tick` 计数正确、`en=0` 时不计、溢出正确回绕到 0。

