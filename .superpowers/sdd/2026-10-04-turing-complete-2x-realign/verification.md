# 验收证据 — 2.x 重构

跑这些命令的目录是仓库根，用的是本机自带工具链：

```
$NODE = C:\Users\ME\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe
$PNPM = C:\Users\ME\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\pnpm\bin\pnpm.mjs
```

| 门禁 | 命令 | 结果 |
|---|---|---|
| 类型 | `& $NODE node_modules\typescript\bin\tsc --noEmit` | **无输出（0 错误）** |
| 生产包 | `& $NODE $PNPM build` | **exit 0**，`dist/assets/index-*.js` 172.11 kB（gzip 58.97 kB）、CSS 15.17 kB |
| 单测 / 关卡 / 惯例 | `& $NODE $PNPM test` | **Test Files 37 passed (37)，Tests 1227 passed (1227)**，3.03s |
| 浏览器冒烟 | `& $NODE $PNPM smoke` | **20 passed**，22.5s |

## 这次重构新增的、值得单独点名的断言

- `test/levels/campaign-shape.test.ts`（4 项）：把 49 个关卡的 id / 章节 / 全局序号 / 中英文名**逐项**钉在 `src/levels/campaign.ts` 上，并检查序号是 1..49 无缺口、无重复、无越界。这是"战役形状"的唯一守卫。
- `test/persist/storage.test.ts`（16 项，其中 4 项为本次新增）：旧 id → 新 id 的搬迁、退役关卡记录被丢弃、迁移幂等、以及新旧 id 集合不相交。
- `test/smoke/ui.spec.ts` 的 `a save written before the 2.x realignment keeps its stars`：在真实浏览器里放一份**旧 id** 存档，断言星数与解锁点落在新 id 上。它同时钉住了 OR/NOR 对调的**方向**——旧 `ch1-06-nor-gate` 必须落到新的**第 5 关**，所以恢复点是第 6 关（《或门》）而不是第 5 关。
- `test/levels/unlock-chain.test.ts` 的"每关调色板只含它之前已解锁的组件（26 关全部）"与"任何组件都不是死内容"：这两条在重构过程中各抓到过一个真实缺陷（见下）。

## 重构中发现并修掉的缺陷（不是测试改动，是数据/文档缺陷）

1. **`switch` 用在了它解锁之前**：2.x 把《循环依赖》（第 17 关）排到《二进制开关》（第 24 关）与《单字节加法》（第 27 关）之前，而 `switch` 原本在第 27 关发放，于是第 17/23/24 关的调色板都非法。改为在第 17 关发放（该关的提示词本来就用两个开关），`switch8` 留在第 27 关。
2. **`alu2` 是个幽灵组件**：计划初稿把"没有关卡发放 `alu2`"误当成"`alu2` 存在"，并把它写进了奖励、规格章节行、索引与计划四处。`src/core/defs/` 里从来没有这个定义——它只是关卡名。四处全部纠正；`test/core/registry.test.ts` 正是拦这类不存在的 id 的测试。
3. **NOR 的教法与参考解不一致**：换序后第 5 关（或非门）的提示词仍写着"或门后面接非门"，而测试里的参考解已经被改成德摩根式。按资料的「第 5 关 = 德摩根入门」，把数据的 brief / hint / 调色板 / 注释对齐到德摩根（`NOT a AND NOT b`），**实测仍是 4 门 / 2 延迟**，三星目标不变。
4. **两处无人认领的 fixtures 遗留**：已退役关卡的参考电路仍留在 `test/fixtures/ch2-references.ts`，而搬章后的 `ch2-14-binary-racer` 的参考解缺席（它还在第 1 章的测试文件里），导致"每关都有参考解"的遍历取到 `undefined`——`level-buildability` 因此有 9 项失败。补齐与清理后该文件只剩 1 项失败（那一项属于子代理的作用域）。

## 收尾的第二遍（提交 `6e6a014` 之后）

第一遍提交后，子代理交付了它对两个 ch2 批测试文件的最后一遍扫尾（补上 2 位译码器缺失的行覆盖断言、修正批次头与过期注释），我又做了三件事，三件都需要重新过门禁：

1. **逐条重编号两个关卡文件里的旧编号注释**：模块说明已经手工改成新编号，因此不能整体替换——脚本里的每一条替换都**锚定在它谈的那个东西**上（`full_adder`、`splitter`、`neg8`、`decoder1`、`add8`），先干跑逐条审阅再落盘，共 28 处。`ch2/batch3.ts` 的模块说明另外手工改写（"levels 23-27 … logic engine" → "29-37 … two's complement and the decoder family"，"THREE THINGS" → "TWO THINGS"，并把退役指令集那一条改写成"这里曾欠第三条说明"）。
2. **删掉两处死代码**：`test/fixtures/ch2-references.ts` 里的 `byteOrReference`（退役关卡）与 `logicEngine`（其关卡已退役、测试已删）——两者在删除前确认**只出现在自己的定义处**。删除后 `tsc` 立刻抓出它们唯一的内部依赖（`muxNodes`、`EngineOptions`）也已成死代码，一并删除。
3. 复核：`tsc` 干净、`pnpm test` **1227/1227**、`pnpm build` exit 0、`pnpm smoke` **20/20**。

## 已知残留（不影响功能与测试，留给第 4 阶段）

两个关卡文件（`src/levels/content/ch2/batch2.ts`、`batch3.ts`）的**逐关注释里仍有若干处使用 1.x 旧编号**。模块说明与按指称对象可判定的 28 处已改；剩下的那些句子只用数字指代关卡、没有附带名字，机械替换会把新编号改回旧编号（同一文件里两种编号并存），因此按"宁留旧、不写错"处理。第 4 阶段开工时应按 `src/levels/id-map.ts` 的对照表逐句核对。
