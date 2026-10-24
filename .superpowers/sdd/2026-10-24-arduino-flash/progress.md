# 账本：沙盒电路写到 Arduino（2026-10-24）

## 起点：被撤回的提交

用户要求在另一台电脑上做到一半的 `fdf72d27`（提交信息「又没钱了」）上继续：

> fdf72d2792c27ae945a7735f57855b3f57896338 撤销这次提交（不用撤销此次的文件更改），检查未完成的任务，并继续完成

按字面执行：`git reset --soft HEAD~1`——提交从历史里拿掉，工作区与索引原样保留（18 个文件、
4672 行新增仍在）。撤回后立刻暴露的未完成项：

1. `tsc --noEmit` 不通过：`test/flash/build.test.ts` 里 `sandbox: false` 与 `LevelSpec.sandbox?: true`
   冲突；`test/flash/host.test.ts` 的两个回调从 `any` 链里继承了隐式 `any`。
2. `pnpm test` 失败一条：README 的目录块没有 `src/flash/`，`test/conventions.test.ts` 的“每个
   `src/` 顶层目录都要在 README 里”断言因此报警。
3. **功能只有一半**：`src/flash/*` 与 `tools/arduino-bridge.mjs` 都写好了，但游戏里没有任何入口
   引用它们——`src/flash` 是死代码，玩家无法构建、下载、编译、烧录或在串口上驱动板子。代码自己
   的注释（`build.ts`「the panel shows both」、`image.ts`「the panel remembers the hash」、
   bridge 的 `/health`「the one endpoint the game calls before offering the flash panel」）都指向
   一个还不存在的面板。
4. 没有记录：这个仓库的每个阶段都有账本，而这次提交没有 `.superpowers/sdd/` 条目，也没有 README
   的功能说明。

## 裁决

| # | 裁决 | 理由 / 代价 |
|---|---|---|
| 1 | **提交用 soft reset 撤回，改动全部保留** | 用户明确要求“不撤销文件更改”。撤回后先修门禁，再补功能，最后按本仓库的提交规范重新分成两条提交。 |
| 2 | **板子预算从 Uno 常量改成 `flash/boards.ts` 的三种板** | 桥的白名单早就有 Uno/Nano/Mega，`buildImage` 的拒绝文案也写着“或换 Mega”，但代码只会用 Uno 的 2 KiB/32 KiB 判定。`buildImage(graph, registry, level, board)` 现在按所选板检查，Mega 有 8 KiB/256 KiB 的预算；镜像字节与板子无关，所以 hash 不含板子。 |
| 3 | **面板做成下方面板的「开发板」标签，只在沙盒出现** | 关卡引脚是题目的契约（`buildImage` 的 `sandbox-only` 拒绝是第二道栅栏）。下方面板是“工具输出”栏，烧录是一段有日志的流程，放这里与用例/程序/调试一致。 |
| 4 | **面板按电路签名缓存映像，只在打开标签或点按钮时构建** | 896 门的 `buildImage` 要跑一次内核 `settle()`；每帧重建会让拖动掉帧。签名是 `circuitSignature(graph)@board`，编辑后显示“电路已改动”，构建按钮变成重新构建。隐藏时面板不订阅渲染。 |
| 5 | **桥的客户端放在 `flash/client.ts`，`fetch` 可注入，可预期的失败都是值** | 桥没启动、CLI 没装、编译失败都是面板要显示的状态，不是异常。超时 150 s（桥自身的编译上限 120 s）。headers 固定 `X-TC-Arduino: 1`，可选 `X-TC-Token`。 |
| 6 | **Web Serial 只做三件事：开 115200、切行、写一行** | 行协议属于 `flash/protocol.ts`，面板负责解释。类型用结构化声明（项目没有也不加 Web Serial 的类型包）；一条 `readLoop` 的 `finally` 是唯一的清理路径，所以拔线、出错、主动关闭走同一条路。 |
| 7 | **下载不依赖桥** | 浏览器不能起进程，但能存文件。`planSketch` 同时供下载和烧录使用，所以下载到的 `.ino` 与发出去的 sketch 逐字节相同；没有桥也有完整退路（放进同名文件夹用 Arduino IDE 打开）。 |
| 8 | **支持集保持第一版的窄口径** | 1 位门、`full_adder`、`delay_line`、`mem1`、两个连接器；宽位/译码器/CPU 元件按名字拒绝。扩大支持集是另一件事，账本不假装它已经发生。 |

## 证据

- `test/flash/build.test.ts` +1：同样的 1000 个 `mem1` 在 Uno 被拒、在 Mega 通过（RAM 估计 > 1900
  且 ≤ 7900），证明预算跟着板子而不是常量走。
- `test/flash/client.test.ts`（新增，10 条）：`/health` 正常/连不上/CLI 缺失、`/compile` 的尺寸与
  hex、编译失败保留日志、`/flash` 带端口与令牌、HTTP 400 带桥的 detail、无法识别的响应当失败、
  `planSketch` 的名字与文件名。
- `test/ui/serial.test.ts`（新增，7 条）：115200、跨块切行与 `\r\n`、半行等待、写命令补换行、
  主动关闭/拔线都只清理一次、读错误转成消息、未连接时写入报错、`serialApi` 只认真的 `requestPort`。
- `test/ui/flash-panel.test.ts`（新增，10 条）：打开标签即构建并报告预算、编辑后置脏并可重建、
  不支持的元件显示拒绝、健康检查填串口列表、编译/烧录的请求体与日志、下载文件名、串口横幅 hash
  比对、帧显示、命令与 T 按钮真的写出去、hash 不同说“另一块电路”、没有 Web Serial 时给解释。
- `test/smoke/ui.spec.ts` +1：沙盒里放置连接器并接线 → 打开「开发板」→ 构建 → 健康检查（mock
  桥）→ 编译 →（mock 串口）读横幅、比对 hash、单步读帧；截图 `test-results/smoke-arduino.png`。
- 门禁（最终代码）：`pnpm build` exit 0（98 模块，337.25 kB / gzip 116.34 kB）；`pnpm test`
  **76 文件 / 1840 通过 + 2 跳过**（`cli.test.ts` 与 `bridge.test.ts` 各一条需要真 `arduino-cli`
  的用例，按设计在本机跳过）；`pnpm smoke` **35 通过 + 2 跳过**（53.2 s）。

## 已知限制 / 没做的

- **没有在真实硬件上验证**：这台机器没有 `arduino-cli`、没有 `arduino:avr` 核心、没有板子。固件
  行为由 `test/flash/host.test.ts` 用 g++ 编译同一份 sketch 与内核逐帧对比来证明；桥由
  `test/flash/bridge.test.ts` 的假 CLI 证明；真实 `arduino-cli` 的编译测试仍按设计在没有 CLI 时
  跳过。串口与烧录的端到端只能在有板子的机器上补。
- Mega 的预算来自芯片手册（256 KiB / 8 KiB）减余量，没有在 Mega 上实测过。
- 面板没有 `boardOptions` 字段：Nano 的旧 bootloader 需要 `cpu=old_bootloader` 时只能用
  `arduino-cli` 手工编译/上传，或改桥的调用参数。桥本身接受这个字段。
- 桥要玩家自己起（这是“浏览器不能起进程”的直接后果）；面板只负责告诉玩家命令。
- `cli.test.ts` 的 896 门真实编译仍是本机跳过的测试，不是被删掉的门禁。

## 提交

| # | SHA | 内容 |
|---|---|---|
| 1 | `372723f` | `feat(panel): write a sandbox circuit to an Arduino board`——撤回的那批文件 + 本轮的门禁修复、板子预算、桥客户端、串口、面板、接线、测试与文档 |
| 2 | （本条所在提交） | 本记录 + `.superpowers/sdd/.gitignore` 的解除忽略 |
