# Task 10 brief — 阶段收尾

逐字摘自 `docs/superpowers/plans/2026-10-08-turing-complete-phase3.md` 的「Task 10」，
并补入本账本的根级待办与控制器裁决。

## Task 10: 阶段收尾

- `pnpm build`、`pnpm test`、`pnpm smoke` 三条全绿（在干净 shell 里跑，记录真实输出）。
- smoke 增加一条：打开第 50 关、写入参考二进制、点测试、断言通过。
- 账本 `progress.md` 收尾：每个任务的实现者报告、评审结论、全部裁决与延后项。
- 最终整分支评审（独立子代理），CI 口径的完整回归。
- Conventional Commits 拆分提交；尝试推送（本机代理若再次挡住，如实在报告里说明）。

**写范围**：`.superpowers/sdd/2026-10-08-turing-complete-phase3/**`、文档收尾

## 本账本「根级待办」（必须在 T10 处理）

1. `2468d61` 的提交信息缺 scope（AGENTS.md 规则 4 要求 `type(scope): summary`，应为
   `fix(test): …`）。
2. `9c92d0c` 的 body 在第 77 字节处有一个字面退格符（`\x08`）。
   两条都在本地历史上，收尾时一并修正并记录。

## 控制器裁决（2026-10-10 续跑）

1. **`cd6a280` 的保留内容**：该临时提交已被用户要求撤销；其中两段阶段记录必须在本任务写回：
   (a) `progress.md` 的「T5 + T6」「T6b」两节与任务表里 T5/T6 的完成行；
   (b) `reference-programs.md` 的「板子的指标（`grade()` 实测，供 threeStar 用）」一节。
   逐字内容可由 `git show cd6a280 -- <file>` 取回（对象仍在库里）。9.5MB 会话压缩包按 AGENTS.md
   约定**不入库**。
2. **历史修正与推送**：修提交信息需要改写已推送的历史 ⇒ 推送必须 `--force`。
   **未经用户同意不强推**；本地改写照做、推送留待用户裁决，报告里如实说明。
3. 账本收尾要汇总：全部裁决（含预检 R1–R6）、全部延后项（断点与反汇编、关卡 54 的 match 不可观测
   等）、全部评审结论与修复环记录。
