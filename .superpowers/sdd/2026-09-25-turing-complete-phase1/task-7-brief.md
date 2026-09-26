## Task 7: 章节装配与解锁链校验

**Files:** `src/levels/index.ts`, `src/levels/content/index.ts`,
`src/levels/content/ch2/`（新建目录）, `src/app/progress.ts`, `src/ui/map.ts`,
`test/levels/unlock-chain.test.ts`（新建）, `test/app/progress.test.ts`

- 章节装配容纳 26 关，顺序稳定。
- 组件解锁仍然**从已通过关卡的奖励推导**，绝不存储
  （阶段 0 的 `migrate` 会丢弃 `unlockedComponents`，这条不能退化）。
- 章节地图显示 2 章。
- 第 2 章关卡文件按批次拆分（`ch2/batch1.ts` 等），`content/index.ts` 汇总。
  本任务只建目录与汇总入口，**不写关卡数据**（Task 8–11 各自拥有自己的批次文件）。
- **本任务不写解锁链测试**：它要遍历全部 26 关，而关卡数据要到 Task 11 才齐。
  Task 12 拥有那条测试（见 Task 12）。这是有意的顺序，不是遗漏。

