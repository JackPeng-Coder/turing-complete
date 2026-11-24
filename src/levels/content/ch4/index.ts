// 第 4 章的拼装入口：把两个批次文件接成一份关卡表，并登记本章用到的自定义检查器。
// 依赖下层 `spec`、同级的 batch1/batch2，以及 `custom/lock`、`custom/maze` 两个检查器模块；
// 后者以"副作用 import"的方式在模块求值时向注册表登记自己，本文件是它们在游戏里的唯一入口。
// 不变量：本数组的顺序 = 玩家看到的第 50..56 关顺序，且本章不再发放任何新元件。

import type { LevelSpec } from '../../spec';
import { CH4_BATCH1 } from './batch1';
import { CH4_BATCH2 } from './batch2';
// 下面两条是"登记用 import"，故意依赖它们的副作用（顶层注册）。
// 第 54、56 关的闭环检查器（`custom: lock`、`custom: maze`）在模块求值时调用
// `registerCustomCheck` 把自己写入 `levels/custom/index.ts` 的注册表，而 `src/` 里没有别的模块
// import 它们：`levels/checks.ts` 只 import 注册表（按 id 查，不认识具体检查器），
// `custom/index.ts` 也刻意不 import 自己的检查器。在本文件出现之前，
// 全仓库仅有的 `custom/lock.ts` / `custom/maze.ts` 导入者是给这两关评分的测试，
// 于是玩家在浏览器里打开第 54 关会得到 `missing-check`——关卡写了一个没有任何模块登记过的检查器 id。
//
// 为什么放在这里而不是 `custom/index.ts` 里：让 `custom/index.ts` import 自己的两个检查器
// 是另一种合法写法，但本项目拒绝它——那会形成真正的运行时循环。lock 从 `custom/index.ts`
// import `registerCustomCheck`，循环会让检查器顶层的注册调用在 `custom/index.ts` 还在求值、
// 还没执行到 `const checkers = new Map()` 时运行；对尚未初始化的模块级 `const` 调用 `Map.set`，
// 就是 import 阶段的 TDZ `ReferenceError`，会波及所有入口、所有关卡。
// 放在内容路径上，依赖边只朝一个方向：`content/ch4/index.ts` -> `custom/lock.ts` -> `custom/index.ts`，
// 于是注册表先完整构造好，检查器再登记进去。最终"发布哪些检查器"仍由指名它们的关卡集合决定，
// 这正是 `custom/index.ts` 文档所写的规则；这里就是那份"指名"，
// `test/levels/ch4-registration.test.ts` 负责守住它（该测试不 import 任何检查器，只走本内容路径给 54、56 评分）。
import '../../custom/lock';
import '../../custom/maze';

/**
 * 第 4 章全部关卡，由两个批次拼接而成。
 *
 * 写作时本章分两批完成（50-52、53-56），每位作者拥有一个自包含文件；
 * 这里是唯一的汇合点，除批次自己的测试外，其他模块不应直接 import 批次。
 *
 * 下面的顺序就是本章的顺序：`content/index.ts` 把它追加在第 1-3 章之后，
 * 于是两个批次落在全局第 50..56 关，中间没有别的关卡。
 * `test/levels/campaign-shape.test.ts` 把整套战役钉在战役表上（56 关，各章 13/26/10/7），
 * `test/levels/level-buildability.test.ts` 则把本导出钉在游戏的既有顺序上——
 * 正是这一对检查抓到了"第 3 章写好了、测试过了、却哪儿都没追加"的问题，
 * 所以一章的完成标准是 `content/index.ts` 真的点名了它。
 *
 * 本章的数据是两种形状、四个文件，拆分依据是作者：
 * 第 50-55 关是直线式编程关（`program` 检查读"玩家"的缓冲区——`from: 'player'`，
 * 关卡数据里没有 `source`——每关两段步进）；第 54、56 关是闭环 `custom` 关，
 * 谜题数据（秘密字节、迷宫网格）放在关卡自己的 `params` 里。
 * 参考程序完全不在这里：它们属于 `test/fixtures/ch4-references.ts`，每关一条 `{ program, format }`；
 * 如果关卡自带参考文本，空的玩家缓冲区就可能被拿去和它比对而误判通过。
 *
 * 画板用的是第 3 章那台机器（`boards/axis.ts`），而且是共享的构造器而非拷贝：
 * `test/fixtures/ch3-references.ts` 给第 3 章机器评分用的也是同一个构造器，
 * 所以玩家在第 4 章编程的 CPU，正是玩家在第 3 章亲手搭出来的 CPU。
 */
export const CH4_LEVELS: readonly LevelSpec[] = [...CH4_BATCH1, ...CH4_BATCH2];
