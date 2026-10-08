# Phase 3 — 第 4 章「编程」+ 汇编 IDE 与调试器：决策账本

Plan: `docs/superpowers/plans/2026-10-08-turing-complete-phase3.md`
Spec: `docs/superpowers/specs/2026-09-25-turing-complete-replica-design.md`
Started: 2026-10-08（Asia/Shanghai），基线 `pnpm test` 37 文件 / 1227 用例全绿。

本文件是本阶段的**证据**：每个任务的实现者报告要点、评审结论、每一次裁决与延后项。
实现者与评审者只追加，不改写别人的条目。

## 裁决（控制器做出，记入此处）

| # | 裁决 | 理由 | 代价 |
|---|---|---|---|
| 1 | 第 4 章关卡携带参考 CPU（`LevelSpec.board`） | spec §11 风险表第 384 行许可「编程章节允许导入关卡提供的参考 CPU」；第 4 章的教学目标是写程序，不是把 CPU 再搭 7 遍 | 关卡数据里出现一份电路形状，必须与 `ch3-references` 同源（用同一个 builder 消除漂移） |
| 2 | 玩家程序经 `runChecks(graph, registry, spec, player?)` 第四参进入内核 | 玩家文本不属于关卡数据；`source` 与玩家缓冲区必须是两条通路 | `ProgramCheck` 增 `from`/`format`，`source` 变可选；`grade()` 同步增参 |
| 3 | 第 1 关（打孔编程）用「逐行 8 位二进制」格式 | 教学点是手工编码，不能用汇编器；玩家需要可读、可打错、可定位的格式 | 新模块 `src/asm/image.ts` 与一套行号错误契约 |
| 4 | 密码锁与迷宫走 `custom` + `params` 闭环 | `custom` 的设计用途原文就写着 mazes / dance machines；两个谜题各用一次，正是逃生舱的正当用法 | `CustomCheck` 增 `params`；`testcases.test.ts` 的 mismatch 种类断言要扩到 `custom` |
| 5 | IDE 交付编辑/汇编/运行/单步/寄存器-PC-程序 RAM 查看；**断点与反汇编延后** | 两者都不在阶段 3 的验收线上（验收线是参考汇编程序通过） | spec §6.3 的两项留到后续阶段，报告给用户 |
| 6 | 玩家程序随存档保存（`Progress.programs`） | 第 0 阶段验收含「刷新后进度保留」；程序就是玩家在这一关的全部工作 | `migrate()` 契约扩展；`tc.progress.v1` 键不变 |
| 7 | 第 4–7 章阶段划分采用 spec §12 表现有排法 | spec 第 239 行要求「阶段 3 启动时确定」 | 无 |
| 8 | 每任务评审合并为一次两段式评审（规格符合 → 代码质量） | 用户明确要求节省成本 | 评审者要在一次报告里给出两段结论，不得合并判断 |

## 任务状态

| 任务 | 内容 | 状态 | 证据 |
|---|---|---|---|
| T1 | 起始电路 `board` | 未开始 | |
| T2 | 玩家程序通路 + 存档 | 未开始 | |
| T3 | `src/asm/image.ts` 机器码格式 | 未开始 | |
| T4 | `lock` / `maze` 两个闭环检查器 | 未开始 | |
| T5 | `Simulation.readState` + `src/levels/run.ts` | 未开始 | |
| T6 | 汇编 IDE + 调试面板 | 未开始 | |
| T7 | 第 50–52 关 | 未开始 | |
| T8 | 第 53–56 关 | 未开始 | |
| T9 | 章节装配与定点更新 | 未开始 | |
| T10 | 阶段收尾（build/test/smoke + 整分支评审） | 未开始 | |

## 环境事实（本机，2026-10-08）

- `pwsh` 工具实际是 **Windows PowerShell 5.1**（`$PSVersionTable` 未打印，但 `#Requires -Version 7`
  的 `tools/sdd/sdd-workspace.ps1` 拒绝运行）；本阶段的工作区目录因此手工创建，
  `.superpowers/sdd/.gitignore` 手工追加 `!2026-10-08-turing-complete-phase3/` 两行。
- 工具链走 `load_workspace_dependencies` 给的 bundled node + `pnpm.mjs`：
  `NODE_BIN=C:\Users\Administrator\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe`，
  `PNPM_BIN=…\dependencies\pnpm\bin\pnpm.mjs`。PATH 上的 `pnpm` 是 npm 装的 `pnpm.ps1`。
- 基线：`pnpm test` → 37 files / 1227 passed（3.45s）。

## 延后项（本阶段结束时汇总给用户）

- 断点与反汇编视图（spec §6.3）——裁决 5。
- `README.md:115-116` 的 bundled node/pnpm 路径写的是旧机器的 `C:\Users\ME\…`，本机不存在。
