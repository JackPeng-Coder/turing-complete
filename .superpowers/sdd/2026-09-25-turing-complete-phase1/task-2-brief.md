## Task 2: 引脚宽度按实例解析

**Files:** `src/core/net.ts`, `src/core/graph.ts`, `src/levels/checks.ts`,
`src/ui/board/interact.ts`, `test/core/net.test.ts`, `test/levels/checks.test.ts`,
`test/ui/panels.test.ts`

修「核心难度」第 3 条。spec §3.3：「多比特引脚由实例 `params.width` 覆盖」。

- `compile()` 必须把**有效引脚宽度**解析为 `inst.params.width ?? def.pin.width`，
  并在**所有**用到宽度的地方使用它：槽位分配、`drive` 长度、`#readInputs`、写回。
  `params.width` 缺省时行为必须与阶段 0 完全一致（回归测试钉死）。
- `level_input` / `level_output` 的引脚宽度因此随实例变化，不再恒为 1。
- `interact.ts` 的 `place()` 在实例 id 是 `IN_<pin>` / `OUT` / `OUT_<pin>` 时，
  必须把该引脚的宽度写进 `params.width`。否则玩家从调色板拖出的 8 位关卡输入
  只有 1 位宽，而 `bindLevelIo` 会按 8 位连续写 —— 又是静默损坏。
- `bindLevelIo` 的宽度必须以**编译后的引脚定义**为准；
  当它与 `spec.io` 不一致时**报错**，而不是静默按其中一个写。
  电路里根本没有该实例时保持阶段 0 行为（读作 0）。
- 测试：8 位关卡输入 → 8 位组件的往返；缺省 1 位（回归）；
  宽度不一致时报错；`place()` 写出正确的 `params.width`。

