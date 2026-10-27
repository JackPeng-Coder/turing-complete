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
| 2 | `b2264b7` | 本记录 + `.superpowers/sdd/.gitignore` 的解除忽略 |

## 2026-10-26 复核（在一台装有 Arduino 工具链的机器上）

上一轮在一台**没有** `arduino-cli`、没有 `arduino:avr` 核心、没有板子的机器上收尾：`cli.test.ts`
与 `bridge.test.ts` 的真实 CLI 用例在那里按设计跳过，所以“编译能过、桥能调 CLI”从未真正执行过。
这一轮在同一份提交上重跑——本机有 `arduino-cli 1.5.0` 与 `arduino:avr 1.8.7`——被跳过的部分第一次
真的运行，暴露出几个上一轮看不见的缺陷；用户要求“继续做完未完成的工作（我已在其他电脑上推进，
请重新审查）”，所以这里连同整条链路一起复核。

### 复核发现的缺陷

| # | 缺陷 | 后果 | 修法 |
|---|---|---|---|
| 1 | `cli.test.ts` 的真实编译用例沿用默认 5 s 超时 | 在**有** CLI 的机器上门禁是红的（本机冷缓存首次 5.5 s） | 两条用例各给 120 s 预算，与桥的编译上限一致 |
| 2 | 固件用 `uint8_t` 数输入连接器、源表游标、输出列，`TcNode.state`/`TcEdge.state`/`TcSrc.ext` 也是单字节 | >255 个连接器或源位时 `for (uint8_t k < TC_COUNT)` 回绕成死循环；>255 个存储元件时状态索引混叠 | 循环计数改 `uint16_t`，三个索引字段改 `uint16_t`；结构体 `__attribute__((packed))`（AVR 与 PC 的 `uint16_t` 对齐不同），尺寸由生成的 `static_assert` 钉住 |
| 3 | 成本估计只算节点/边/表/运行时，漏了 `TC_SRC`、`TC_OUT_*`、`TC_IN`、`TC_PENDING` | 估计偏低，可能放过超出 SRAM 的电路 | flash 计入源表与输出表，RAM 计入 `TC_IN` 与每状态两字节；字节常数收进 `flash/image.ts` 一处 |
| 4 | 上传前不关闭 Web Serial 占用的串口 | 连过串口再点烧录，avrdude 打不开端口 | 烧录前走「断开」同一条清理路径关串口，成功提示改为“点「连接串口」读横幅” |
| 5 | 输入值输入框只在构建映像时设置禁用状态 | 连接串口后输入框仍是灰的 | 每次 render 刷新禁用状态 |
| 6 | 面板没有 `boardOptions`（桥本就支持） | Nano 旧 bootloader 只能手工烧 | `boards.ts` 增加 `BOARD_CHOICES`，旧 bootloader 是独立一行；`planSketch` 带 `boardOptions`，面板记住的是行而不是 FQBN |

### 新增测试

- `test/flash/host.test.ts` +2：257 个单比特输入连接器（>255 个连接器与源位）和 300 个 `mem1`
  （>255 个存储元件），逐帧与内核对比；后者在旧固件上状态会混叠。harness 的 `spawnSync` 加了
  20 s 超时，假使回归成死循环，结果是失败而不是挂住。
- `test/flash/cli.test.ts` 拆成 Uno 与 Mega 两条：同一份映像各用真实 `arduino-cli` 编译一次，尺寸
  对照 `boards.ts` 的芯片上限；`static_assert` 让描述符尺寸与估计常数对不上时*编译*失败。
- `test/flash/client.test.ts` +1：`planSketch` 的 `boardOptions` 与“没有就不发”。
- `test/ui/flash-panel.test.ts` +2：旧 bootloader 行真的把 `cpu=atmega328old` 发给桥；烧录前关串口、
  烧录后按钮状态；另在既有串口用例里断言连接后输入框可输入。

### 证据（本机，全部真实执行）

- `pnpm build` exit 0（98 模块，338.57 kB / gzip 116.70 kB）。
- `pnpm test` **77 文件 / 1848 通过**（`cli.test.ts` 与 `bridge.test.ts` 的真实 CLI 用例**不再跳过**）。
- `pnpm smoke` **35 通过 + 2 跳过**（47.2 s）——与上一轮相同的两条既有跳过。
- 真实 `arduino-cli 1.5.0` + `arduino:avr 1.8.7`，896 门基准（`instances 898 / nodes 912 / slots 2744`）：
  - 估计：RAM 747 B、flash 21,007 B（运行时常量特意留了 8 KiB，估计偏保守）；
  - Uno 实测 **16,864 B flash / 607 B RAM**（52% / 30%）；
  - Mega 实测 **17,144 B flash / 607 B RAM**；
  - 两份 `Sketch uses` / `Global variables use` 都在芯片上限内。
- 真实 `node tools/arduino-bridge.mjs --port 8877`：
  - `/health` → `{ok:true, cli:"1.5.0", core:true}`，列出 5 个 `COM*`；缺 `X-TC-Arduino` → 403；
  - `/compile` → `ok:true`，blink 1,480 B flash / 194 B RAM 并带回日志；
  - `/flash` 到不存在的 `COM250`：编译成功、avrdude 报 `cannot open port`，`ok:false` 且保留完整日志
    ——除“插着板子”之外的每一步都真的跑过了；
  - Nano + `--board-options cpu=atmega328old` 同样先编译成功、再在端口上失败；
  - `boardOptions: "cpu=$(rm)"` → 400：注入被拒。

### 还没做的

- **没有真实硬件**：本机没有板子。串口协议在浏览器侧由 Playwright 的假串口覆盖，固件行为由
  `host.test.ts` 用 g++ 编译同一份 sketch 与内核逐帧对比；`avrdude` 只走到“打不开端口”为止。
- Mega 是编译验证，不是实物验证。
- 桥仍需玩家自己起（浏览器不能起进程），面板只负责告诉玩家命令。
- 页面输入/时钟没有自动镜像到板子（`driveTo` 即写串口）：第一版把串口交给面板手动驱动；
  这是可加的下一步，不是缺陷。

## 2026-10-27 第一次真实硬件验证（CH340 / ATmega328P / COM3）

用户插上板子后报「识别不到」。排查结论与处置如下；这一轮也把整条链路第一次跑到了真实板子上。

### 「识别不到」的三个原因（都不是固件缺陷）

1. **本地桥没起**：8765 无监听，面板点「检查连接」只会说「连不上本地桥」，串口下拉是
   「未发现串口（点「检查连接」）」——看起来就像板子没被识别。起
   `node tools/arduino-bridge.mjs` 后同一面板立刻列出 5 个串口（4 个蓝牙 + COM3）。
2. **CH340 克隆板没有板名**：`arduino-cli board list` 把 COM3 认成 "Serial Port (USB)"，但
   Board Name = Unknown——CH340 不携带 Arduino 的 USB 标识，自动识别不到型号是正常的，需要玩家在
   「开发板」下拉里手动选 Uno/Nano。**不是端口没认到**：Windows 的 USB-SERIAL CH340 (COM3) 状态
   OK，驱动 wch.cn 3.9.2024.9，`arduino-cli 1.5.0` 也看得到它。
3. **端口被游戏自己的标签页占着**：`handle64 -a Serial2` 显示 `\Device\Serial2` 在 msedge.exe
   (pid 6244) 手里——上午那次「连接串口」的 Web Serial 一直开着，于是 PowerShell 以任何波特率打开
   COM3 都报「访问被拒绝」，烧录也会在 avrdude 处失败。Edge 释放后立刻 `OPEN_OK`。

### 三处让原因更容易看出来的改动

| 改动 | 文件 | 说明 |
|---|---|---|
| 未识别 USB 串口按 `vid:pid` 命名 | `tools/arduino-bridge.mjs` | `parsePorts` 在 CLI 报不出板名时用 `properties.vid/pid` 生成标签（CH340→`WCH CH340 (1a86:7523)`，未知厂商→`USB serial (1234:0001)`）；蓝牙口仍是自己的地址。面板下拉从此能分辨“哪一个是板子”。+1 测试。 |
| 失败时先说是端口被占用还是 bootloader 没应答 | `src/ui/flashPanel.ts` | `failureText` 匹配 avrdude 的 `cannot open port`/`Access is denied`/`not in sync`/`stk500` 等，给出「先断开、关掉占用程序」或「确认型号、Nano 旧 bootloader 换一行」的句子，而不是只留一段日志。+1 测试。 |
| 选串口后「烧录」立刻可用 | `src/ui/flashPanel.ts` | 用真实浏览器驱动面板时发现：串口下拉没有 `change` 监听，选完 COM3 后「烧录」仍是灰的（单测里手工调 `render()` 把这个缺陷藏住了）。现在选择会重绘；测试改成 `dispatchEvent(new Event('change'))`。 |

### 真实硬件证据（这轮新增，全部实测）

- 板型：`avrdude -c arduino -p m328p -P COM3 -b 115200 -U signature:r:-:h` →
  **`0x1e,0x95,0x0f`**，即 ATmega328P、115200 的 bootloader（Uno 或新 bootloader 的 Nano 克隆）。
- 烧录（桥的 HTTP 接口 + 仓库 exporter）：1 位输入 → NAND（两输入并接，即 NOT）→ 输出的最小电路
  （image hash `0xB1E40214`，2 节点 / 6 槽 / 报告 8,232 B flash / 405 B RAM），经 `POST /flash`
  （fqbn `arduino:avr:uno`、port COM3）真实编译并上传：**`ok:true`，Sketch uses 4,052 bytes (12%) /
  Global variables use 265 bytes (12%)**——这是本功能第一次在实物上完成一键编译 + 烧录。
- 串口协议（同一块板，115200）：
  - `B` → `#TC1 B1E40214 2 1 1 1`，横幅 hash 与映像 hash 一致；
  - `S` → `F 0 1 1`（NOT(0)=1）；`I 0 1` → `F 0 1 0`（NOT(1)=0）；`I 0 0` → `F 0 1 1`；
  - `T` → `F 1 1 1`，tick 前进、输出正确。
- **从游戏面板本身烧录**（Playwright 驱动真实页面，dev server + 真桥 + 真板子）：在沙盒画
  「关卡输入 → 关卡输出」的直通电路 → 开发板 → 检查连接（下拉显示 `COM3 · WCH CH340 (1a86:7523)`）
  → 选 COM3 → 烧录 → 面板显示「烧录完成：3992 B flash、265 B RAM」（`Sketch uses 3992 bytes (12%)`）。
  串口读回：`B` → `#TC1 1A718278 1 1 1 1`；`S` → `F 0 1 0`，`I 0 1` → `F 0 1 1`，
  `I 0 0` → `F 0 1 0`，`T` → `F 1 1 0`——直通逻辑与 tick 全部正确。

  即：导出器、面板、桥、`arduino-cli`/avrdude、固件、线协议第一次在真实硬件上串成一条可用的链。

### 仍然没做的

- 玩家自己的电路仍要玩家在自己的会话里点一次「烧录」（自动化已经走过同一条面板路径，见上）。
- Mega 仍是编译验证。
- 页面输入/时钟自动镜像到板子仍未做（第一版手动驱动）。
- 板子现在跑的是面板烧进去的直通固件（hash 1A718278，与玩家的电路不会一致，面板会如实说
  “板子跑的是另一块电路”）；点一次「烧录」即可换成屏幕上的电路。（已被下一节的引脚固件覆盖。）

## 2026-10-27 引脚映射（把沙盒连接器接到物理引脚）

用户要求「指定板子上的引脚对应沙盒中的输入和输出元件」。这一轮加上了：1 位连接器可以在
「开发板」面板的「引脚」卡里选一个板子引脚；输出在每次 settle 后用 `digitalWrite` 写出去，
输入每个 loop 用 `digitalRead` 读进来（内部上拉）。宽连接器仍走串口。

### 设计裁决

| # | 裁决 | 理由 / 代价 |
|---|---|---|
| 1 | 引脚映射是**板子的属性**，存在面板的 `tc.flash.v1`，不写进电路 | 同一块电路换板或换引脚不该改变电路价格、撤销栈或 `tc-circuit` 文件；它只改变固件 I/O |
| 2 | 映射**进入映像与 hash** | 固件行为不同，横幅 hash 必须仍能回答“板子跑的是不是屏幕上的电路”；切换板子时 A0 的数字会变（328P=14，Mega=54），所以 image 里存的是**引脚号**而不是名字 |
| 3 | 只有 **1 位连接器**能接引脚 | 宽连接器要一位一脚或总线协议，都是面板不该替玩家猜的契约；第一版继续走串口 |
| 4 | 输入用 `INPUT_PULLUP` | 按钮接 GND 即可、未接线读 1、不会浮空；接外部推挽输出也兼容 |
| 5 | 可选引脚 = 板子的数字/模拟头，排除 D0/D1 与 328P 的 A6/A7 | D0/D1 是 USB 串口本身；A6/A7 在 328P 上只能模拟输入，不能 digitalWrite/上拉 |
| 6 | 面板给别的行已占用的引脚置灰；`buildImage` 再校验一次 | UI 不该产生一个注定被拒绝的状态；但过期存档或其它调用方仍可能传冲突映射，构建器是第二道栅栏 |
| 7 | 引脚读变化时重新 settle 并打印一帧 | 与 `I` 命令同构：硬件输入就是“外部世界下发了一条 I”，面板的帧显示因此能跟随 |

### 证据（本机，含真实硬件）

- 新增 `test/flash/pins.test.ts`（7 条）：引脚表、A0/A15 的数值、宽连接器、未知引脚、重复引脚、
  过期连接器键、报错顺序。
- `test/flash/build.test.ts` +3：引脚进入 image/hash；flash 每输入引脚 2 B、每输出引脚 3 B、
  RAM 每输入引脚 1 B；共享/未知/宽引脚被拒（`pins` refusal）；已删除连接器的旧键被忽略。
- `test/flash/host.test.ts` +1：host shim/harness 增加 GPIO 状态与 `= <pin> <value>` 命令；
  直通电路 IN_1→pin 2、OUT_1→pin 13：上电内部上拉使 OUT=1、引脚 13 被 `digitalWrite` 高；
  把 pin 2 拉低/拉高时帧与 `PIN` 行同步变化，tick 不前进。
- `test/flash/cli.test.ts` +1：真实 `arduino-cli` 编译带引脚表的 sketch（`digitalRead` /
  `digitalWrite` / `INPUT_PULLUP` 与 pin 结构体的 `static_assert` 都通过 AVR 编译器）。
- `test/ui/flash-panel.test.ts` +3：引脚卡列出连接器并可映射、另一行已占用的引脚被置灰、
  下载的 `.ino` 带引脚表；宽连接器显示“只走串口”；映射跨重挂载被记住。
- `test/smoke/ui.spec.ts`：沙盒 → 开发板 → 检查连接 → 给两个连接器选引脚 → 编译；断言发出去的
  request sketch 含 `TC_PIN_IN`/`TC_PIN_OUT`/`INPUT_PULLUP`，面板摘要显示“2 个引脚”。
- 门禁：`pnpm build` exit 0；`pnpm test` **78 文件 / 1865 通过**；`pnpm smoke` **35 通过 + 2 跳过**。
- **真实板子**（CH340 / ATmega328P，COM3）：从游戏面板（Playwright 驱动预览页 + 真桥 + 真板）
  画 关卡输入 → 关卡输出，引脚选 IN_1→2、OUT_1→13，烧录：**4,776 B flash / 266 B RAM**，
  摘要“2 个引脚”；串口读回 `#TC1 A9461310 1 1 1 1`、`S` → `F 0 1 1`（D2 上拉 = 1 → D13 = 1，
  板载 LED 亮起）、`T` → `F 1 1 1`。用一根线把 D2 接 GND，LED 与帧应同时变 0。
- 截图：`test-results/hw-pins-from-panel.png`。

### 没做的

- 宽连接器的多位总线（一条连接器 → 多根引脚）没有做。
- 输入的上/下拉与去抖不可配置：固定 `INPUT_PULLUP`，机械按钮的抖动会表现为几帧输入变化。
- 输出只有高/低；PWM、开漏、模拟量没有做。
- 引脚映射没有做电气保护提示（5 V 逻辑、别把输出对地短路之类只写在 README 的常识里）。
- Mega 的引脚号只做过编译验证，实物仍是 Uno 类板。

## 2026-10-27 预览与放置的形状不一致（渲染缺陷）

用户报「放下的输出元件和手上拿的输入元件样式不一样」。根因不是输入/输出两种元件本身的符号差异
（关卡输入是箭头、关卡输出是圆，这是两种元件各自的符号），而是**同一个元件在“手上”与“放下后”
被画成两个形状**；顺着查还有两处同类的预览/实物漂移：

| # | 缺陷 | 根因 | 后果 |
|---|---|---|---|
| 1 | 手持 关卡输出 是圆角方框，放下是圆 | `drawGhost` 给 `traceBody` 传 `PART_RADIUS`；已放置实例问 `boxRadiusOf`，而 level 类半径 = h/2 | 预览与结果不同形 |
| 2 | 备用 level_input（本关引脚放完后拿到的 `i1`）预览是箭头、放下是方框 | ghost 按 def id 判断箭头，board 按 instance id 前缀判断 | 同一个 def 两种轮廓 |
| 3 | 手持 8 位元件看不出位宽；手持连接器看不到它将得到的引脚名 | ghost 原先“无徽章” | 8 位与 1 位预览一样；连接器放下后才出现名字 |

修法：

- `render.ts` 新增 `silhouetteOf` / `traceSilhouette`：板与 ghost 共用同一条绘制路径，轮廓只由 def
  （和高度）决定；备用 level_input 也按 def 画箭头。
- ghost 用 `levelIoPlacement`（和真正 drop 同一个函数）预演将拿到的 id 与位宽，画名字徽章与位宽
  徽章；普通元件仍画标记。值仍然不画（尚未存在的东西没有读数）。
- `declaredWidthOf` 把“def 的位宽”写在一处。
- `conventions.test.ts` 加结构规则：`traceBody(` / `traceLevelArrow(` 各只允许出现 2 次
  （定义 + `traceSilhouette` 里的唯一调用）；出现第三个调用点即失败。

证据：

- `test/ui/appearance.test.ts` +5：输出圆的半径是 36 而非 6、输入恒为箭头、普通元件是 6；
  `traceSilhouette` 实际画出 `roundRect(…,36)` / `roundRect(…,6)` / 箭头 apex；`declaredWidthOf`
  的 8/32/1。
- `test/conventions.test.ts` +1：单一路径规则。
- 门禁：`pnpm build` exit 0；`pnpm test` **78 文件 / 1871 通过**；`pnpm smoke` **35 通过 + 2 跳过**。
- 真浏览器截图（Playwright 对 dev server）：手持 关卡输出 是圆 + 名字徽章（下一号 2），放下后同形；
  手持 8 位与门 显示 `AND` + `8` 徽章，放下后同形；输入/输出各自的符号不变。

没做的：ghost 仍不画引脚与数值（尚未存在的元件没有信号，这是刻意的）；输入箭头 vs 输出圆是两种
元件的符号，不是不一致。

