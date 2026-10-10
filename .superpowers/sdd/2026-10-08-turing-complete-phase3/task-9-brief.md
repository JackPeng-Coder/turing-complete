# Task 9 brief — 章节装配与既有断言更新

逐字摘自 `docs/superpowers/plans/2026-10-08-turing-complete-phase3.md` 的「Task 9」。
**数字与字符串以本文件为准。**

## Task 9: 章节装配与既有断言更新

**Files:**
- Create: `src/levels/content/ch4/index.ts`
- Modify: `src/levels/content/index.ts`、`src/levels/campaign.ts`
- Modify: `test/levels/campaign-shape.test.ts`、`test/levels/unlock-chain.test.ts`、
  `test/levels/level-buildability.test.ts`、`test/levels/grader.test.ts`、`test/smoke/ui.spec.ts`
- Modify: `README.md`、`AGENTS.md`、`docs/superpowers/specs/2026-09-25-turing-complete-replica-design.md`、
  `RESEARCH.md`

**Steps:**
1. `campaign.ts` 追加 7 行（第 4 章，全局 50–56，zh/en 用 §5 表的名字）。
2. `content/index.ts` 追加 `...CH4_LEVELS`（保持按 `index` 排序）。
3. 更新被钉住的数字：章节形状 `[13,26,10,7]`、关卡总数 49→56、`slice(39)` 的边界、
   grader 的参考解联合加 `CH4_REFERENCES`、smoke 的地图格数。
4. `level-buildability` 的 `REFERENCE_SOLUTIONS` 支持 `{ graph, program }`（第 4 章的参考解
   是「板 + 程序」，板来自关卡自己的 `board`）。
5. 文档：spec §12 阶段表加一行「阶段 3 已完成」；`RESEARCH.md` §3 把「第 4–7 章尚未实现」
   改成「第 4 章 7 关已实现（2.x 基线），剩余第 5–7 章 37 关」；README/AGENTS 的关卡数同步。
6. `pnpm test` 全绿；提交 `docs(levels): register chapter 4 and refresh every pinned count`。

**写范围**：`src/levels/content/**`、`src/levels/campaign.ts`、测试的定点更新、文档

## 七关的 id / 名称 / 索引（T7、T8 已交付数据；campaign 行必须逐字对齐）

| 全局 # | id | zh / en |
|---|---|---|
| 50 | `ch4-50-punchcard-programming` | 打孔编程 / Punchcard Programming |
| 51 | `ch4-51-assembly-programming` | 汇编程序 / Assembly Programming |
| 52 | `ch4-52-circumference` | 三番两次 / Circumference |
| 53 | `ch4-53-conditional-jumps` | 条件跳转 / Conditional Jumps |
| 54 | `ch4-54-code-breaker` | 道破心机 / Code Breaker |
| 55 | `ch4-55-mod-4` | 高速掩码 / Mod 4 |
| 56 | `ch4-56-the-maze` | 路在脚下 / The Maze |

## 接口事实（前序任务已落地）

- T7 交付 `src/levels/content/ch4/batch1.ts`（`CH4_BATCH1`）、
  `test/fixtures/ch4-references.ts`（`CH4_REFERENCES: Record<string, { program: string; format: 'asm' | 'bytes' }>`，
  键=关卡 id，板不进 fixture）、`test/levels/ch4-batch1.test.ts`。
- T8 交付 `src/levels/content/ch4/batch2.ts`（`CH4_BATCH2`）与 `test/levels/ch4-batch2.test.ts`，
  并向 `CH4_REFERENCES` 追加四关。
- 关卡参考 CPU：`level.board`（`BoardInit`）→ `graphFromBoard(level.id, level.board)`；
  玩家程序：`runChecks(graph, registry, spec, player?)` / `grade(..., player?)`。
- `campaign.ts` 是关卡表形状的唯一事实源，`test/levels/campaign-shape.test.ts` 把每关钉在表上
  （AGENTS.md 明文）。

## 控制器裁决

1. **`REFERENCE_SOLUTIONS` 的扩法（R1 续）**：支持第 4 章的「板 + 程序」参考解——图由关卡自己的
   `board` 建（`graphFromBoard`），程序来自 `CH4_REFERENCES`，绝不复制第二份电路或第二份程序。
2. **注册只在本任务发生（R2）**：`content/ch4/index.ts` 导出 `CH4_LEVELS = [...CH4_BATCH1, ...CH4_BATCH2]`，
   `content/index.ts` 按 `index` 排序合并。
3. 文档同步是**定点**的：只改计划点名的数字与句子，不做顺手重写；AGENTS.md 的
   「Chapters 1-3 (49 levels) are built」一段按新事实改写，README 的 layout 块不得增删顶层目录。
4. `test/conventions.test.ts` 是本仓的 lint：两个关卡共用 id、README 缺目录、运行时依赖、
   样式字面色/阴影/圆角都会红——改完必须确认它仍绿。
5. 冒烟（`test/smoke/ui.spec.ts`）只更新被钉住的地图格数；第 50 关的浏览器冒烟是 T10 的活。
6. **多 check 关卡的已知交互（T7/T8 复审转来）**：`test/levels/testcases.test.ts:113-114` 对
   「多于一条 check」的关卡跳过计数断言——ch4 的 `program` 关卡现在每关两条 check，注册后该跳过
   会静默生效。program 关卡本返回 `{kind:'none', reason:'program'}`（`checks.ts:1879-1888`），
   所以**预计无害**；但注册后必须实跑全量确认，若该文件的既有断言对 ch4 的 `custom` 关卡
   （54/56，单 check）或新形状有假设，按 T4 的先例定点更新并在报告里写明理由。
7. `REFERENCE_SOLUTIONS` 的既有条目形状不要改；只**新增**支持 `{ program }`（图由关卡 `board` 建）。
8. **注册通路（T8 复审移交，必须做）**：`src/` 目前没有任何模块 import `levels/custom/lock` / `maze`，
   两个检查器只在 **import 时**自注册（测试文件是唯一的导入者）。ch4 一旦进 `LEVELS`，
   运行时 `custom` 检查就会变成 `missing-check`。T9 必须在**内容通路**上 import 两者
   （放 `src/levels/content/ch4/index.ts` 的副作用导入，或让 `src/levels/custom/index.ts` 自己
   import 二者——任选其一，但要在报告里说明选法与理由，注意 `checks ↔ custom/index` 已有环，
   别引入 TDZ 问题）。并加一条**自身不 import 检查器**的测试：只经 `src/levels/content/index.ts`
   （或 `campaign.ts`）拿到关卡，跑 54/56 的 `custom` 检查必须能通过参考解，而不是 `missing-check`。
9. **T7/T8 已交付的既有事实（注册时会碰到）**：第 4 章 7 关都存在但未注册；
   `program` 关卡每关**两条** check（R9）；54/56 的 `custom` 参数分别是 `{secret:42, budget:1024}` 与
   `{grid, budget:1024}`；参考解在 `test/fixtures/ch4-references.ts`（`Record<id,{program,format}>`）。
