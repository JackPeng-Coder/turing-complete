## Task 6: `custom` 检查器

**Files:** `src/levels/spec.ts`, `src/levels/checks.ts`, `src/levels/custom/index.ts`（新建）,
`test/levels/checks.test.ts`

spec §5.2：`custom` 是逃生舱，但必须只依赖内核公开接口，且能离线跑通。

- `CustomCheck`：`{ kind: 'custom'; id: string }`，`id` 在注册表里查一个
  实现 `(io: LevelIo, spec: LevelSpec) => CheckOutcome` 的函数。
  内核**不**接受关卡数据里内联的函数 —— 那既不能序列化也不能审查。
- 注册表里未注册的 `id` 必须是硬失败（`missing-check`），不得静默通过。
- checker 抛异常必须被转成失败结果，而不是把 `grade()` 打穿（阶段 0 的 `RangeError` 教训）。
- 测试：注册假 checker 断言被调用、返回值被采纳；未注册 id 失败；抛异常转失败。
- 本阶段**不**添加真实 `custom` 关卡（第 2 章用不到），但机制必须先存在。

