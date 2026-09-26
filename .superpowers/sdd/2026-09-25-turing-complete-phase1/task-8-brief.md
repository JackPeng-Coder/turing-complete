## Task 8: 第 2 章关卡 13–17（标量逻辑与计数）

**Files:** `src/levels/content/ch2/batch1.ts`, `test/levels/ch2-batch1.test.ts`

逐关定义（`id` 形如 `ch2-13-odd-number-of-signals`）：

| # | 关卡名（源资料） | io | 检查器 | 解锁 | 教学点 |
|---|---|---|---|---|---|
| 13 | ODD Number of Signals 奇数个信号 | `a:4` → `out:1` | truth-table 16 行 | `splitter` `maker` `const8` | 异或链判奇偶；宽端口拆成位 |
| 14 | Double Trouble 成对的麻烦 | `a,b,c,d:1` → `out:1` | constraint `at-least` 2 | — | 至少 2 个为高 |
| 15 | Binary Racer 二进制速算 | `a:4` → `out:3` | truth-table 16 行 | `less_u` | 4 位量化成 3 位计数 |
| 16 | Counting Signals 信号计数 | `a,b,c,d:1` → `out:3` | truth-table 16 行 | `equal8` | 4 个 1 位信号相加（半加器思想） |
| 17 | Double the Number 加倍 | `a:8` → `out:8` | truth-table 256 行（生成） | `add8` `mul8` | 左移一位即加倍 |

每关必须提供完整 `LevelSpec`：`id` `chapter: 2` `index` `name`(中英)
`brief`(原创) `hint`(原创) `allowedComponents` `io` `checks` `threeStar` `rewards`。

要求：

- 第 15、16 关输出是 3 位计数，用 `generateRows` 生成真值表行，
  **不得**留空 `rows`（空 `rows` 是硬失败 `missing-rows`）。
- 第 13 关的 4 位输入是**有意的**：源资料没说宽度，4 位既够教学又让
  16 行真值表可穷举。这一选择在关卡数据注释里标为「本复刻版设计」。
- 第 15 关源资料是「限时二进制转换小游戏」，本作改建为 4 位 → 3 位计数电路。
  这一改建必须写进关卡 `brief` 的数据注释。
- `threeStar` 三项都必须由参考解**实测**得出，且参考解本身就满足。
- 每关一条参考解测试 + 一条**必须真的失败**的反例测试。

