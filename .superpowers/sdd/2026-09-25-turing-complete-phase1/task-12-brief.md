## Task 12: 阶段 1 收尾验证与解锁链校验

**Files:** `README.md`, `docs/superpowers/plans/2026-09-25-turing-complete-phase0.md`,
`test/levels/unlock-chain.test.ts`（新建）

- **新增 `test/levels/unlock-chain.test.ts`**，把整章的解锁链变成机器检查。
  这条测试放在最后，因为它要遍历全部 26 关，而关卡数据到 Task 11 才齐：
  1. 每一关的 `allowedComponents` 只含该关**之前**已解锁的组件（含 starter 集合
     `['level_input','level_output','const_on','const_off']` 与第 1 章已解锁的组件）。
     否则玩家卡死。
  2. 每个第 2 章组件（spec §3.3 的 26 项清单）**恰好**被一个关卡解锁。
  3. 组件在其首次**被需要**的关卡之前或同关解锁，
     且解锁点不晚于它第一次出现在某关 `allowedComponents` 里。
  4. 第 2 章恰好 26 关、`index` 为 13–38 且连续无重复。
- 全量回归：`pnpm test`、`pnpm build`、`pnpm smoke`。
- 更新 README 的进度表述（第 1 章 12 关 → 第 1–2 章 38 关）。
- 修正阶段 0 计划里那张**已知过时**的第 1 章汇总表：要么从代码块重新生成，
  要么删掉 —— 一张与代码不符的表比没有表更糟。
- 浏览器里从第 1 关连到第 38 关的冒烟确认，并截图存档。
