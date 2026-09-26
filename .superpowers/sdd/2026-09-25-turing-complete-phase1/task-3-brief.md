## Task 3: 宽位纯组合组件

**Files:** `src/core/defs/wide.ts`（新建）, `src/core/defs/index.ts`,
`src/core/registry.ts`, `test/core/registry.test.ts`

按 spec §3.3「同一套算子的宽度参数化」做成生成器，宽度本阶段只放开 8，
生成器签名接受宽度，为阶段 5 的 16/32/64 留口。
id 与引脚名必须**逐字**如下（关卡数据依赖它们）：

| id | 输入 | 输出 |
|---|---|---|
| `and8` `or8` `nand8` `nor8` `xor8` `xnor8` | `a:8` `b:8` | `out:8` |
| `not8` | `a:8` | `out:8` |
| `add8` | `a:8` `b:8` `cin:1` | `out:8` `cout:1` |
| `neg8` | `a:8` | `out:8` |
| `less_s` `less_u` `equal8` | `a:8` `b:8` | `out:1` |
| `shift_l8` `shift_r8` `ashr8` | `a:8` `amount:8` | `out:8` |
| `rot_l8` `rot_r8` | `a:8` `amount:8` | `out:8` |
| `mul8` `div8` | `a:8` `b:8` | `out:8` |
| `const8` | — | `out:8` |
| `splitter` | `in:8` | `b0..b7:1`（8 条） |
| `maker` | `b0..b7:1`（8 条） | `out:8` |
| `switch` | `a:1` `on:1` | `out:1` |
| `switch8` | `a:8` `on:1` | `out:8` |

要求：

- 溢出与边界语义必须**定义并测试**：`add8.cout` 是第 8 位进位；
  `mul8` 只保留低 8 位；**`div8` 除零的行为必须定义**（取 `0xff`），不能是未定义行为；
  `ashr8` 符号位扩展；`shift_*` 的 `amount >= 8` 定义为 0（`rot_*` 则为 `amount % 8`）。
  负数读数一律按无符号位模式处理，不引入 `number` 负数。
- 宽位值用 `number` 承载（8 位远在安全整数内）。`assertWidth` 在 >32 位时报错，
  这是**有意的**：64 位值是 `Uint8Array`，属于阶段 5。本阶段不得出现
  把 64 位值塞进 `number` 的路径。
- `splitter` / `maker` 的引脚数量与宽度**必须可配置**（`params`），
  这是它们在后续章节唯一的用法。`params` 缺省即 8。
- 测试：每个运算符至少一组边界向量（0、1、最大值、进位/借位、符号边界）
  加一组性质检查；`div8` 被测到除零；`maker(splitter(x)) === x` 往返若干 `x`。

