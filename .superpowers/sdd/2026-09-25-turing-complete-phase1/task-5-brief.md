## Task 5: `fuzz` 检查器

**Files:** `src/levels/spec.ts`, `src/levels/checks.ts`, `test/levels/checks.test.ts`

spec §5.2 要求 `fuzz` 在开始第 2 章之前实现。

- `FuzzCheck`：`{ kind: 'fuzz'; seed: number; rounds: number; inputs; outputs }`，
  `inputs` / `outputs` 是按名给出的**纯函数**：不抓网络、不读真实时间、
  不依赖 `Math.random()`。
- 随机数必须自带**确定性 PRNG**（如 xorshift32），种子写进关卡数据。
  必须有测试**跨两次运行比对向量序列**，证明同种子同向量。
- 失败报告必须给出**具体哪一轮、哪组输入、期望什么、实际什么**，
  而不是只说「模糊测试失败」。
- `rounds` 的缺省与上限必须定义并测试（防止关卡写出 10^9 轮卡死编辑器）。
  **`rounds: 0` 或 `inputs` 为空不得静默通过** —— 这是 `missing-rows` 的同类教训。

