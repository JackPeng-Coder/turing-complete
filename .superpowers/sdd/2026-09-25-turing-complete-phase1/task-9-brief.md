## Task 9: 第 2 章关卡 18–22（8 位逻辑与加法）

**Files:** `src/levels/content/ch2/batch2.ts`, `test/levels/ch2-batch2.test.ts`

| # | 关卡名（源资料） | io | 检查器 | 解锁 | 教学点 |
|---|---|---|---|---|---|
| 18 | Byte OR 8 位或 | `a:8` `b:8` → `out:8` | fuzz 256 轮 | `and8` `or8` `nand8` `nor8` | 8 位按位或 |
| 19 | Byte NOT 8 位非 | `a:8` → `out:8` | fuzz 256 轮 | `xor8` `xnor8` `not8` | 8 位按位非 |
| 20 | Half Adder 半加器 | `a:1` `b:1` → `sum:1` `carry:1` | truth-table 4 行 | `full_adder` | 和与进位 |
| 21 | Full Adder 全加器 | `a:1` `b:1` `cin:1` → `sum:1` `cout:1` | truth-table 8 行 | `neg8` | 带进位的 1 位加法器 |
| 22 | Adding Bytes 8 位加法器 | `a:8` `b:8` `cin:1` → `out:8` `cout:1` | fuzz 256 轮 | `switch` `switch8` | 级联全加器 |

要求：

- **`fuzz` 从本批开始使用**（第 18、19、22 关），必须用 `seed` + `rounds: 256`，
  期望函数是纯函数。
- 第 20 关的 id 是 `ch2-20-half-adder`，但**不**产出 `half_adder` 组件
  （spec §3.3 的第 2 章清单里没有它）；奖励是 `full_adder`，玩家下一关就要用。
- 第 22 关的 `threeStar.delay` 必须**由参考解实测**得出。源资料给的
  「延迟 ≤ 35」是**成就**而非通关条件：把它作为注释里的参考值记下来，
  但 `threeStar` 用实测值。若实测值大于 35，照实写实测值。
- 第 21 关源资料的成就是「仅用 5 个蓝色元件」；本作没有「蓝色元件」体系
  （那是自定义组件，阶段 3 才有），因此改为 `threeStar.gate` 实测门槛，
  并在数据注释里说明这一映射。

