# 《图灵完备（Turing Complete）》深度调研资料汇编

> **用途**：完全复刻本游戏的开发规格基线资料
> **数据截止时间**：2026-10-03（调研日）
> **调研方法**：Steam 商店页 / Steam API / Steam 评测 API 一手抓取 + 3 路并行网络调研（基本信息、玩法关卡、中文社区），全部事实标注来源
> **可信度说明**：★★★ = 官方一手来源（Steam 页、官网、官方 API）；★★ = 高质量二手（Steam 指南、玩家深度回顾、GitHub）；★ = 一般二手（资讯站、AI 生成 wiki，需复核）

---

## 目录

1. [游戏基本信息](#1-游戏基本信息)
2. [开发背景与开发者](#2-开发背景与开发者)
3. [剧情设定](#3-剧情设定)
4. [核心玩法机制](#4-核心玩法机制)
5. [完整关卡流程（93 关全表）](#5-完整关卡流程93-关全表)
6. [指令集架构（OVERTURE / LEG / Symphony）](#6-指令集架构)
7. [沙盒模式与扩展内容](#7-沙盒模式与扩展内容)
8. [成就系统](#8-成就系统)
9. [教育价值与同类游戏对比](#9-教育价值与同类游戏对比)
10. [中文社区与口碑](#10-中文社区与口碑)
11. [复刻开发参考（技术要点）](#11-复刻开发参考技术要点)
12. [图片与视频资源清单](#12-图片与视频资源清单)
13. [参考链接总表](#13-参考链接总表)

---

## 1. 游戏基本信息

| 项目 | 内容 | 来源 |
|---|---|---|
| 中文名 | 图灵完备（官方简中译名，游戏支持官方简体中文） | ★★★ Steam |
| 英文名 | Turing Complete | ★★★ |
| Steam AppID | 1444480 | ★★★ |
| 开发商 / 发行商 | LevelHead（自研自发，单人独立开发者） | ★★★ |
| 抢先体验日期 | 2021-10-02 | ★★★ |
| 正式版 | 尚未发行；官方称 2026 年退出抢先体验 | ★★★ Steam EA 说明 |
| 大版本更新 | "Turing Complete 2"（2.0，2026-07-15 前后）：自研引擎替换 Godot、模拟提速 100 倍、组件 2~64 位可变位宽、全新汇编器框架、LEG 架构被新架构（Symphony）替换、全部关卡重写、新增游戏内提示系统 | ★★ steamydata 补丁记录 |
| 平台 | Windows / macOS / Linux | ★★★ |
| 引擎 | 1.x：Godot 3.5/3.6 + Nim/GDScript；2.0（2026-07-15）：自研 Nim 引擎 | ★★ SteamDB / 补丁记录 |
| 售价 | 国区 ¥77（折后 ¥53.90）；美区 $19.99（折后 $13.99）；港区 HK$115（折后 HK$80.50）——调研时为 -30% 促销（2026-10-08 截止）。国区历史定价 ¥60→¥68→¥77；官方称随游戏完善将提价 | ★★★ Steam API |
| Steam Deck | 可玩（Playable） | ★★★ |
| DLC | 1 个：Superscalar Symphony 原声带（AppID 5009780，HK$30.06） | ★★★ |
| 支持语言 | 简体中文 ✔ / 英语 ✔ / 法语 ✔（仅界面） | ★★★ |
| 评测（全语言） | 5,827 篇，5,591 好评 / 236 差评，好评率 **95.9%**，评级"好评如潮" | ★★★ Steam 评测 API，2026-10-03 |
| 评测（简中） | 1,764 篇，97% 好评，"好评如潮" | ★★★ |
| 推荐数 | 5,619 条 | ★★★ Steam API |
| Metacritic | 无媒体评分；用户评分 9.4（77 人），AnyDecentMusic 汇总 97/100 | ★★ |
| 在线人数 | steamcharts：当前约 380 在线，24h 峰值 434，历史峰值 769（2025-07）；SteamDB 口径 24h 峰值 64（两源差异较大，以 steamcharts 为准） | ★★ 2026-10-03 |
| 愿望单 | 约 48.3 万（近 3 天新增 1,069） | ★ steamypulse |
| 成就 | 10 个 Steam 成就 | ★★★ |
| 功能 | 单人、Steam 成就、Steam 云、家庭共享（无创意工坊） | ★★★ |
| 销量估算 | 约 25 万份（第三方估算） | ★ isitdoneyet.gg |
| 通关时长 | 主线约 14 小时；主线+支线约 84 小时；全成就约 113 小时（另有统计口径 15~19h/100h+） | ★★ HowLongToBeat |
| 官方渠道 | 官网 turingcomplete.game（含 /player_projects 玩家项目展）；Discord discord.gg/hdrJaMUdrF（成员约 10,874）；邮箱 stefan@turingcomplete.game；社区 wiki turingcomplete.wiki | ★★★ |
| 用户标签 | 硬件、逻辑、自动化、基地建设、模拟、编程、建造、沙盒、教育、黑客、解谜、科幻、低容错、单人、2D、制作、风格化、抢先体验、好评原声音轨、独立 | ★★★ |

### 系统配置要求（极低门槛）

| 平台 | 最低配置 |
|---|---|
| Windows | Win 7/8/10 64 位，i5，2 GB RAM，Intel UHD 630，512 MB 存储 |
| macOS | macOS 11，Apple Silicon，4 GB RAM，1 GB 存储 |
| Linux | 64 位，i5，2 GB RAM，Intel UHD 630，512 MB 存储 |

### Steam 官方描述（中文版，★★★）

> **-= 你能学到什么 =-**
> 计算机里所有的电子元件都可以基于一种叫做"与非门"（NAND gate）的基本元件而实现。在本游戏中，你将会面对一系列挑战，在求解谜题的过程中，走出从基础逻辑门通向算术单元、存储器等复杂元件的道路，并沿着这条道路最终学习如何搭建完整的处理器架构。完成所有主线关卡后，你将对处理器架构、汇编语言和电子元件彼此之间的具体联系产生更加深刻的理解。你也会了解高级编程语言中常见的条件判断、循环、函数等概念是如何在汇编和硬件层面具体实现的。
>
> **-= 你能构建什么 =-**
> 本游戏是基于一个强大的电路模拟器而开发的。这个电路模拟器允许你自由发挥想象力，以不同的解法通过各个关卡，或以自己喜欢的方式搭建属于自己的计算机。你可以随心所欲地在你的计算机上连接显示屏、计时器、声音元件等部件，也可以接收现实生活中的键盘和网络发送的数据。你甚至可以为你自己的计算机设计一套自己专属的汇编语言。

### 抢先体验开发者说明（要点，★★★）

- 为何 EA：解谜游戏需要玩家反馈反复调校每关难度
- 当前状态：70+ 关卡、50+ 小时游戏时长（已具备完整可玩性）
- 正式版目标：更强的汇编器、更真实的战役、**快得多的模拟速度**
- 价格计划：随游戏成熟将提价
- 社区：开发者活跃在官方 Discord 发布正式版进展

---

## 2. 开发背景与开发者

- **LevelHead** 实为单人独立开发者 **Stefan Höglund**（网名 **Stuffe**，Discord: stuffe_），自研自发，联系邮箱 stefan@turingcomplete.game（★★★ 官网/Steam API；★★ vginsights）。
- 游戏灵感谱系与 **nandgame**（免费网页游戏）、**Nand2Tetris**（《计算机系统要素》课程）、**Ben Eater** 的 8 位面包板计算机视频系列一脉相承；TC 的独特定位是"**不指定 ISA**——CPU 架构与汇编语言都由玩家自己设计"（★★ notejo.de 深度回顾、namu.wiki）。
- 1.x 版本使用 **Godot 3.5/3.6 + Nim** 开发（SteamDB 技术信息，★★）；2026-07-15 发布的 2.0 大版本换用**自研 Nim 引擎**，模拟速度提升约 100 倍（补丁记录，★★）。
- **奖项**：未获得主流游戏奖项（TGA、BAFTA、IGF、GDCA 均无提名记录），口碑完全依靠玩家社区与教育者自传播（★★）。
- 开发模式：开发者长期在 Discord 与社区互动收集关卡难度反馈；曾快速迭代解决"意大利面布线"（wire spaghetti）问题，改进布线与自定义元件界面（2021-11 ~ 2022-01，★★）。
- 重要里程碑：
  - 2021-10-02 抢先体验上线（★★★）
  - 2022-07-11 官方电路分享中心 Schematic Hub 上线（★★）
  - 2022-09-09 加入 Verilog 导出功能（★★）
  - 2026-07-15 "Turing Complete 2"（2.0）大版本（★★ steamydata 补丁记录）
  - 官方计划 2026 年内退出抢先体验（★★★）

---

## 3. 剧情设定

玩家扮演被外星人绑架的人类，被关进测试设施。外星人要求你通过一系列工程测试来证明人类智能——从认识 NAND 门开始，一路造出完整的图灵完备计算机，最终证明人类逻辑可以匹配甚至超越外星标准。剧情为轻科幻喜剧风格，作为关卡之间的串联叙事（旧版含飞船任务、隐藏帽子等彩蛋）。2.0 起新增游戏内提示系统（含全部关卡的提示与解法）。

---

## 4. 核心玩法机制

### 4.1 电路编辑器

- 图形化 GUI：左侧元件目录拖放到画布，鼠标连线；支持框选、热键（Shift+数字快速选件）、元件旋转（空格）、标签与导线颜色注释
- 信号以颜色区分高/低电平（红/绿）；顶栏可切换数字显示格式（有符号/无符号/十六进制）
- 操作（据 2.1 指南 ★★）：左键选择/拖动元件；双击选中元件+相连导线；Alt+拖动导通孔；Shift+框选；右键删除/取消；滚轮缩放，WASD 或中键平移
- 硬性规则：① 元件输入不可依赖自身输出（循环依赖报错）——但**延迟线/寄存器例外**（依赖的是上一刻的输出，允许回环，其输入端口显示为橙色）；② 不同输出不可直接相连（短路）——但**开关截止态输出（灰色）例外**

### 4.2 模拟语义（复刻核心！）

- **同步时序模拟**：以"刻"（tick）为单位步进。组合逻辑当刻传播；延迟线/寄存器延迟 1 拍
- 可单步（Next tick）、连续运行（可调速）、倒退一刻、重置
- 关卡验证：2.0 起 16 位以内关卡采用**全输入穷举**自动测试，通过即过关
- RAM 组件：端口系统，同刻可多次 load/store；支持大/小端、Hex 编辑器、打孔卡模式

### 4.3 元件目录（随关卡逐步解锁）

NAND / NOT / AND / OR / NOR / XOR / XNOR、3 输入门、Always On/Off、Switch（位/字节，受控通断）、Splitter/Maker（分线器/集线器，2/4/8 位）、Delay Line（1/8 位延迟线）、MUX、1 位/8 位 Register、1/2/3 位 Decoder、半加器/全加器、字节加法器、Negate、8 位字节运算门、Counter、RAM（4B/256B）、程序 RAM、输入/输出引脚、**屏幕**（4:3~1024:768 任意分辨率）、计时器、声音、键盘、**网络组件**（沙盒）。2.0 后组件普遍支持 2~64 位可变位宽与 Auto size。

### 4.4 自定义组件系统（The Foundry / 元件工坊）

- 第 3 章"元件工坊"关解锁：把任意已搭好的电路封装为自定义元件，可在后续关卡及**其他元件内部**复用，形成任意层级嵌套（NAND→门→加法器→ALU→CPU 的抽象阶梯正靠此实现）——**这是整个游戏设计的支柱机制**
- 元件外形由内部零件摆放决定；可自定义引脚标签；探针（probe）可显示元件内部信号
- 元件带"开销"属性：门数/延迟会被父电路继承统计，刷分需回到底层重做优化
- 2.0 改进：消除"伪依赖"（fake dependencies）、输入引脚防重叠、Auto size 适配任意位宽

### 4.5 评分与排行榜

- 每关三指标：**GATE（门数）、DELAY（总延迟）、TICK/CYCLE（周期数，编程关）**
- **服务器端回放验证**玩家方案防作弊；全球排行榜；turingcomplete.game 公开档案页展示各关成绩（★★★ 官网档案页）
- 部分关卡有硬限制（如 Odd Number of Signals 限 3 元件、Little Box 限定空间、总线关限 4 开关 2 非门）
- 成就 = 官方"最优解挑战"（见第 8 节）

### 4.6 引导方式

不给标准答案：只给关卡目标、真值表/测试用例与文字提示。2.0 新增完整游戏内提示系统（全部关卡提示+解法）。

---

## 5. 完整关卡流程（93 关全表）

> 主来源：Steam 指南《图灵完备2.1指南》（更新至 2.1.344，★★）；旧版（1.x）关卡名来自官方玩家档案页与攻略交叉验证。2.0 重写了全部关卡，部分关卡改名，旧名以括号标注。

### 第 1 章 布尔代数（Boolean Logic）— 13 关
*教学目标：仅用 NAND 门推导出全部基本逻辑门。*

| # | 中文名 | 英文名 | 教学目标/备注 |
|---|---|---|---|
| 1 | 从零开始 | Humble Beginnings（旧 Crude Awakening） | 教学关：认识输入/输出开关 |
| 2 | 与非门 | NAND Gate | 填写真值表，解锁唯一原生元件 NAND |
| 3 | 非门 | NOT Gate | NAND 两输入并接 |
| 4 | 与门 | AND Gate | NAND+NOT |
| 5 | 或非门 | NOR Gate | 德摩根定律入门 |
| 6 | 或门 | OR Gate | |
| 7 | 长明灯 | Always On | 输出恒 1（解锁常量） |
| 8 | 第二周期 | Second Cycle（旧 Second Tick） | 仅第 2 拍输出 1 |
| 9 | 异或门 | XOR Gate | 首个门数优化挑战（成就：仅 4 个 NAND） |
| 10 | 三路或门 | Bigger OR Gate | |
| 11 | 三路与门 | Bigger AND Gate | |
| 12 | 同或门 | XNOR Gate | |
| 13 | 逻辑试炼 | Logic Exam | 综合测验 |

### 第 2 章 算术运算、存储器（Arithmetic, Memory）— 26 关
*教学目标：从门电路构建字节级运算元件与寄存器/RAM。*

| # | 中文名 | 英文名 | 教学目标/备注 |
|---|---|---|---|
| 1 | 二进制速算 | Binary Racer | 心算小游戏（隐藏成就） |
| 2 | 成双成对 | Double Detection（旧 Double Trouble） | ≥2 输入为真 |
| 3 | 奇数计数技术 | Odd Number of Signals | 限 3 元件 |
| 4 | 循环依赖 | Circular Dependency | 认识反馈回路规则 |
| 5 | 信号计数 | Counting Signals | 3 位计数输出 |
| 6 | 半加器 | Half Adder | XOR=SUM, AND=CARRY |
| 7 | 晚点到站 | Delayed Lines | 引入延迟线（时序逻辑起点） |
| 8 | 超级加倍 | Double the Number | 左移；引入分线器/集线器 |
| 9 | 全加器 | Full Adder | 成就：≤5 蓝色元件 |
| 10 | 奇变偶不变 | Odd Cycles（旧 Odd Ticks） | 延迟线回环=振荡器 |
| 11 | 二进制开关 | Bit Switch | 引入 Switch；三态总线基础 |
| 12 | 单字节与非 | Byte NAND | 8 位位运算 |
| 13 | 单字节非门 | Byte NOT | |
| 14 | 单字节加法 | Adding Bytes | 8 全加器串联（成就：延迟≤17） |
| 15 | 可控反相器 | Bit Inverter | |
| 16 | 负数 | Negative Numbers | 补码教学小游戏 |
| 17 | 数据选择器 | Multiplexer | 解锁 MUX |
| 18 | 数值反转 | Signed Negator | 取反+1（补码取负） |
| 19 | 总线 | The Bus | 限 4 开关 2 非门 |
| 20 | 优雅存储 | Saving Gracefully | 延迟线自环+写选通 = 1 位寄存器 |
| 21 | 整存整取 | Saving Bytes | 8 位寄存器 |
| 22 | 二进制译码 | 1 Bit Decoder | |
| 23 | 2-4 译码器 | 2 Bit Decoder | |
| 24 | 3-8 译码器 | 3 Bit Decoder | |
| 25 | 方寸之间 | Little Box | 限定空间造 4B RAM，解锁 256B RAM |
| 26 | 计数器 | Counter | 寄存器+自增（成就：门数≤65） |

### 第 3 章 处理器架构（CPU Architecture，OVERTURE 架构）— 10 关
*教学目标：组装第一台 CPU——OVERTURE（冯·诺依曼架构，1 字节指令）。*

| # | 中文名 | 英文名 | 教学目标/备注 |
|---|---|---|---|
| 1 | 逻辑整合 | Arithmetic Logic Unit (ALU) 1 | NAND/OR/AND/NOR 四运算（成就：不用位级元件） |
| 2 | 川流不息 | Registers | 6 寄存器+IO 映射为第 7 寄存器 |
| 3 | 算术逻辑单元 | Arithmetic Logic Unit (ALU) 2 | 加入 ADD/SUB |
| 4 | 元件工坊 | The Foundry | **解锁自定义元件系统** |
| 5 | 指令译码器 | Instruction Decoder | 最高 2 位区分 4 类指令 |
| 6 | 条件判断 | Conditions | 8 种条件码（成就：≤10 元件） |
| 7 | 计算核心 | ALU | REG1/REG2→REG3 数据通路 |
| 8 | 立即数 | Immediate Values | 立即数写入 REG0 |
| 9 | 程序 | Program | 程序 RAM + 程序计数器 |
| 10 | 图灵完备 | Turing Complete | 条件跳转，CPU 完工（同名成就） |

### 第 4 章 编程（Programming）— 7 关
*教学目标：先手写机器码，再解锁汇编器，用自己的 CPU 解编程谜题。*

| # | 中文名 | 英文名 | 教学目标/备注 |
|---|---|---|---|
| 1 | 打孔编程 | Punchcard Programming（旧 Add 5） | 手工二进制编码 |
| 2 | 汇编程序 | Assembly Programming | 汇编语法 imm/mov/add |
| 3 | 三番两次 | Circumference（旧 Calibrating Laser Cannons） | 计算 6r |
| 4 | 条件跳转 | Conditional Jumps | 循环与跳转 |
| 5 | 道破心机 | Code Breaker（旧 Storage cracker） | 暴力枚举密码锁 |
| 6 | 高速掩码 | Mod 4（旧 Masking Time） | 按位与 3 |
| 7 | 路在脚下 | The Maze | 机器人走迷宫（沿墙算法） |

### 第 5 章 进阶处理器架构（CPU Architecture 2，Symphony 架构；2.0 前为 LEG）— 26 关
*教学目标：设计第二台更先进的 CPU（宽指令、标志位、RAM、栈、函数调用）。*

| # | 中文名 | 英文名 | # | 中文名 | 英文名 |
|---|---|---|---|---|---|
| 1 | 十六进制速算 | Hex Racer | 14 | 更新换代 | Symphony ALU |
| 2 | 整型常量 | Byte Constant | 15 | 千头万绪 | Wire Spaghetti |
| 3 | 整型异或 | Byte XOR | 16 | 读写交互 | IO |
| 4 | 整数判等 | Equality | 17 | 引擎发动 | Integrating ALU |
| 5 | 无符号小于 | Unsigned Less | 18 | 原装直达 | Immediates |
| 6 | 有符号小于 | Signed Less | 19 | 归并判定 | Condition Match |
| 7 | 前导零计数 | Count Leading Zeroes | 20 | 指令折跃 | Jumps |
| 8 | 逻辑右移 | LSR | 21 | 内存 | RAM |
| 9 | 算术右移 | ASR | 22 | 记忆永存 | Persistent Memory |
| 10 | 独热编码 | One Hot Encoding | 23 | 输入输出 | IO Devices |
| 11 | 大步流星 | Symphony Counter | 24 | 如此包装 | Instruction Aliases |
| 12 | 条分缕析 | Instruction Decoder | 25 | 后来居上 | Stack |
| 13 | 举一反三 | Comparison Flags | 26 | 函数调用 | Functions |

### 第 6 章 进阶编程（Programming 2）— 7 关

| # | 中文名 | 英文名 | 教学目标/备注 |
|---|---|---|---|
| 1 | 绝对美感 | Objective Beauty | |
| 2 | 快速乐章 | Fast Symphony | 全链路延迟优化（回底层重做元件） |
| 3 | 尼姆博弈 | Nim | 博弈论（保持余数≡1 mod 4） |
| 4 | 千变万化 | Random Number Generator | xorshift 伪随机数 |
| 5 | 首字大写 | Capitalize | 字符串处理 |
| 6 | 美味排行 | Delicious Order | 排序算法 |
| 7 | 汉诺塔 | Tower of Hanoi | 递归（成就关） |

### 第 7 章 可选元件关（Optional Component Levels）— 4 关

| # | 中文名 | 英文名 | 备注 |
|---|---|---|---|
| 1 | 乘法器 | Multiply（旧 The Product of Nibbles） | 成就：≤7 个 8 位加法器 |
| 2 | 除法器 | Divide | 逐位试商（成就关） |
| 3 | 模余器 | Modulo | |
| 4 | 轻快序曲 | Overture | 无硬性要求，刷分关 |

### 旧版（1.x）有而 2.x 改名/移除的关卡（考据用）

Input Selector、Logic Engine、Arithmetic Engine、Component Factory、Calculations、Wide Instructions、Opcodes、Conditionals、Delay RAM、Shift、PUSH and POP、Robot Racing（机器人竞速）、Tower of Alloy、Spacial Invasion（太空侵略者）、Water World、Unseen Fruit、Planet Names、Dancing Machine、AI Showdown、The Lab 等；另有飞船 4 任务与隐藏帽子等剧情彩蛋。

---

## 6. 指令集架构

> 复刻重点：游戏**不预设完整 ISA**，而是引导玩家逐步设计。以下为社区整理的三套官方引导架构规范。主来源：Steam 指南《Default Instruction Set Architectures for Turing Complete》（★★）。

### 6.1 OVERTURE（第 3~4 章，第一台 CPU）

- 8 位定长指令，最高 2 位分 4 类：

| B7 B6 | 类型 | 说明 |
|---|---|---|
| 00 | Immediate | 低 6 位 = 0~63 立即数 → 写入 REG0 |
| 01 | Calculate | 低 3 位选运算（OR/NAND/NOR/AND/ADD/SUB）；REG1、REG2 运算 → REG3 |
| 10 | Copy | 3 位源 × 3 位目的（REG0~5 + Input/Output 共 7×7） |
| 11 | Condition | 低 3 位条件码测试 REG3，成立则 REG0 → 程序计数器（跳转） |

- 条件码：Never / =0 / <0 / ≤0 / Always / ≠0 / ≥0 / >0
- 6 个 8 位寄存器，约定用途：REG0 存立即数/跳转地址，REG1/2 为 ALU 输入，REG3 为 ALU 结果/条件测试值；冯·诺依曼架构（程序即数据）
- 汇编示例：`imm 5` / `mov r1, r0` / `mov r2, in` / `add` / `mov out, r3`；支持 `const` 常量、`label` 标签、`jmp/jnz` 跳转

### 6.2 LEG（2.0 之前的第二套 ISA，考据用）

- 4 字节定长指令 RISC；**哈佛架构**（程序内存与数据 RAM 分离）
- 6 个通用寄存器；程序计数器可作第 7 寄存器，输入/输出为第 8 寄存器
- 第 1 字节 OPCODE：算术类（ADD/SUB/AND/OR/NOT/XOR，低 3 位）+ 跳转类（IF_EQUAL / IF_NOT_EQUAL / IF_LESS / IF_LESS_OR_EQUAL / IF_GREATER / IF_GREATER_OR_EQUAL）；后 3 字节为左地址/右地址/数据总线操作数
- 社区扩展实现案例：GitHub `sxysxy/LEG_Codes`（13 寄存器、Load/Store、Mul、移位、栈、Call/Ret，CC0 开源，含 Verilog 导出）

### 6.3 Symphony（2.0/2.1 现行第二套架构）

- 2.0 替换 LEG 的更先进架构；指令更宽（示例编码 3 字节：`mov %a(reg), %b:U16(imm) = 00110001 aaaa0000 bbbbbbbb bbbbbbbb`）
- 比较标志位（Comparison Flags）、RAM 端口读写、栈（sp、push/pop、store_16/load_16）、call/ret 函数调用
- 配套开源汇编框架 **isa_spec**（github.com/stuffe/isa_spec/，★★ 开发者本人开源）

### 6.4 汇编器系统（复刻关键设计）

玩家通过"指令别名"（Instruction Aliases）自行定义**助记符→二进制编码映射**，含寄存器/立即数操作数位段声明（如 `%a(register)`、`%b:U16(immediate)`）——即"为自己的 CPU 设计专属汇编语言"。2.0 换了全新汇编器框架，把电路图编译为机器码。

---

## 7. 沙盒模式与扩展内容

- **沙盒模式**：战役之外自由建造；可接入屏幕（任意分辨率）、计时器、声音、键盘输入、**网络组件**（接收现实世界数据）。社区项目：32 位机、浮点运算、在自制 CPU 上跑 Tetris/Pong 等
- **Schematic Hub**：官方在线电路图分享中心（2022-07-11 上线）；无 Steam 创意工坊
- **Verilog 导出**（2022-09-09）：可把电路导出为 Verilog 硬件描述语言——玩家的 CPU 理论上可以流片成真芯片
- **玩家档案页**：turingcomplete.game/profile/<id> 公开显示各关成绩与全球排名
- 无官方关卡编辑器；自定义主要发生在元件（schematic）与 ISA 层面
- 社区 wiki：turingcomplete.wiki（含存档格式文档）

---

## 8. 成就系统

10 个 Steam 成就（★★★ Steam API），本质是官方"最优解挑战"：

| 成就 | 条件 | 全球达成率 |
|---|---|---|
| Turing Complete | 造出图灵完备计算机（通关第 3 章） | ~20.2% |
| 4 NAND = XOR | 仅用 4 个 NAND 过 XOR 关 | — |
| 5 Component Full Adder | 全加器限 5 个蓝色元件 | — |
| Fast Adder | 字节加法器延迟 ≤17 | — |
| Symmetric ALU | ALU1 不用位级元件 | — |
| Condition 10 | Conditions 关 ≤10 个元件 | — |
| 7 Adder Multiply | Multiply 关 ≤7 个 8 位加法器 | — |
| Divide | 过除法关 | — |
| Tower of Hanoi | 过汉诺塔关 | — |
| Binary Racer（隐藏） | 二进制速算通关最后一级 | — |

---

## 9. 教育价值与同类游戏对比

### 9.1 教学路径设计（复刻应完整保留的骨架）

完全自底向上、**每关解法即下一关的元件**：

```
NAND → 基本逻辑门 → 组合逻辑（加法器/MUX/译码器）
→ 时序逻辑（延迟线/寄存器/计数器/RAM）
→ ALU → OVERTURE CPU → 机器码/汇编编程
→ 先进架构（宽指令/标志位/栈/函数调用）
→ 真实程序（排序/递归/随机数/博弈）
```

### 9.2 同类产品对比（复刻差异化参考）

| 产品 | 形态 | 与 TC 的关键差异 |
|---|---|---|
| nandgame | 免费网页 | 覆盖相似前期内容（NAND→CPU），但止步于固定 ISA；TC 更深（自定义 ISA、沙盒、评分） |
| Nand2Tetris（《计算机系统要素》） | 课程+软件 | 理念同源（NAND 到 Tetris）；TC 是其游戏化/图形化版，且不指定 ISA |
| Ben Eater 8 位面包板计算机 | YouTube 视频系列 | TC 被玩家视为其交互式等价物 |
| MHRD | Steam 游戏 | 硬件描述语言文本式，无图形布线 |
| Silicon Zeroes | Steam 游戏 | 固定谜题式，无自由 CPU 设计 |
| TIS-100（Zachtronics） | Steam 游戏 | 纯汇编编程谜题，无电路搭建 |
| 《Code》（Charles Petzold） | 书籍 | 媒体常并称的知识谱系 |

### 9.3 口碑要点

- 被广泛推荐为数字逻辑/计算机组成原理课程的**最佳实践教具**
- 主要批评（2.0 前）：偏"练习场"而非"老师"，概念讲解少，中期起难度指数上升——2.0 新增提示系统即为回应
- 中文玩家好评关键词：寓教于乐、从沙子到 CPU 的成就感、"玩完真的懂了计算机"

---

## 10. 中文社区与口碑

- **官方简体中文支持**；简中评测 1,764 篇 / 97% 好评（★★★）——简中评测占全语言约 30%，中国玩家是核心受众
- **Steam 中文指南**：
  - 《图灵完备2.1指南》（id=3496162641）：全 93 关逐关解法+背景知识讲解（含数字电子技术/计算机组成原理参考书目），本次关卡列表主来源
  - 《全关卡攻略（含背景知识）》（id=3054134872）
  - 《Default Instruction Set Architectures》（id=2782647016）：OVERTURE/LEG ISA 规范
  - 《得分优化方案》（id=3789887881）
- **B 站**：专栏逐关攻略（readlist/rl544745）；多个通关实况/教学视频
- **知乎**："如何评价游戏《Turing Complete》"等问题，普遍盛赞教育价值
- **中文技术博客**：cnblogs QiFande（OVERTURE 汇编别名实例）、tarikvon.github.io（OVERTURE 指令集一览表及汇编器）等
- **中文译名考**：游戏译名"图灵完备"即" Turing complete"术语本身——指能模拟图灵机的计算系统，呼应游戏终极目标

---

## 11. 复刻开发参考（技术要点）

### 11.1 核心系统优先级（建议实现顺序）

1. **同步时序模拟器**：tick 步进 + 组合逻辑当刻传播 + 延迟元件回环（依赖上一刻输出）——这是整个游戏的地基
2. **拖放布线编辑器**：元件放置/旋转、连线、框选、缩放平移、颜色电平可视化
3. **自定义元件嵌套封装（The Foundry）**：任意层级封装、引脚自定义、开销（门数/延迟）继承统计
4. **三指标评分 + 关卡测试**：全输入穷举验证、GATE/DELAY/TICK 统计
5. **ISA/汇编器自定义**：指令别名→二进制映射、操作数位段声明、label/const
6. **编程关 IO 测试床**：机器人/迷宫等小游戏化交互

### 11.2 技术栈参考（原作）

- 1.x：Godot 3.5/3.6 + GDScript（桌面三平台，512MB 体积）
- 2.0：自研引擎（模拟提速 100 倍）
- 汇编框架：isa_spec（开发者开源，github.com/stuffe/isa_spec/）

### 11.3 存档/数据格式（逆向资料，★★ turingcomplete.wiki）

- 存档为 base64+zlib；`schematics.` 前缀存元件、`campaign.` 前缀存战役进度
- 关卡文件为类汇编文本格式；2.0 起蓝图（blueprints）用 lzma 压缩

### 11.4 关键设计决策（复刻时必须想清楚的）

- **为什么从 NAND 开始**：NAND 功能完备（可构造任意逻辑函数），单一起点最优雅；教学上第一关"填真值表"即建立直觉
- **延迟线而非锁存器作为时序起点**：规避 SR 锁存的亚稳态讲解负担，"延迟 1 拍+允许回环"一条规则同时解锁寄存器与振荡器
- **延迟/门数双指标**：让"能过"与"过好"分层，天然形成成就与排行榜
- **不指定 ISA**：与所有同类产品最大的差异点；代价是汇编器必须做成"元汇编器"（玩家自定义指令编码）
- **服务器回放验证**：排行榜防作弊的必要设计
- **位宽系统**：1 位→8 位→可变位宽（2.0 为 2~64 位 Auto size），分线器/集线器做位宽转换

### 11.5 开源/可参考资料

| 资源 | 说明 |
|---|---|
| github.com/stuffe/isa_spec | 开发者本人的 ISA 汇编框架 |
| github.com/sxysxy/LEG_Codes | LEG 架构扩展实现（CC0，含 Verilog） |
| github.com/DoubleCouponDay/turingcompletesolutions | 编程关汇编解法集 |
| turingcomplete.wiki | 社区 wiki（存档格式等逆向文档） |

---

## 12. 图片与视频资源清单

### 12.1 已下载到本地（`imgs/` 目录）

| 文件 | 内容（截图已目视核实） | 原始来源 |
|---|---|---|
| imgs/header.jpg | 官方宣传头图（Logo+主视觉） | Steam CDN |
| imgs/ss0.jpg | 第 6 章"汉诺塔"编程关：左电路右汇编双栏，**简中界面实拍** | Steam CDN |
| imgs/ss1.jpg | "3-8 解码器"关电路解法（3 个解码器树状组合），简中界面 | Steam CDN |
| imgs/ss2.jpg | 编程关"高速掩码"最优解界面（顶部广告横幅彩蛋） | Steam CDN |
| imgs/ss3.jpg | 第 1 章"异或门"关 4-NAND 解法（成就解），带剧情弹窗 | Steam CDN |
| imgs/ss4.jpg | 后期玩家大型计算机：**运行 DOOM 移植版，主频 6.5MHz** | Steam CDN |
| imgs/ss5.jpg | 自定义元件"Router"迷宫寻路电路 | Steam CDN |

### 12.2 Steam CDN 原始直链（1920x1080）

```
header:
https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/1444480/8440c6246573308442238af5801639abef4ec97f/header.jpg

截图① https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/1444480/65ac5660daf8f24bad19c0df28dfa2454a8c7965/ss_65ac5660daf8f24bad19c0df28dfa2454a8c7965.1920x1080.jpg
截图② https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/1444480/10f0987dc0010cd1a95e99674b77bdf5ba91c948/ss_10f0987dc0010cd1a95e99674b77bdf5ba91c948.1920x1080.jpg
截图③ https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/1444480/533d92c18d804b568af50b5b5bc4700cd5a39f93/ss_533d92c18d804b568af50b5b5bc4700cd5a39f93.1920x1080.jpg
截图④ https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/1444480/9f96587b027ecdefbb89b5225c3955f353442c63/ss_9f96587b027ecdefbb89b5225c3955f353442c63.1920x1080.jpg
截图⑤ https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/1444480/f653a2687d410e5b1e9d5fcdfe76d0931672026e/ss_f653a2687d410e5b1e9d5fcdfe76d0931672026e.1920x1080.jpg

胶囊图 https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/1444480/15a0d43f27a244c46ed52781319edd6d399d1f50/capsule_231x87.jpg
商店背景 https://store.akamai.steamstatic.com/images/storepagebackground/app/1444480
```

### 12.3 官方预告片

- 视频 ID 256849680，缩略图：`https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/256849680/0704c6d3b63778cbc845028183e704ac087cf7b6/movie_600x337.jpg`
- 流地址（HLS）：`https://video.akamai.steamstatic.com/store_trailers/1444480/1589646476/ef6d88ea09378698dcba23eb92667828d35d1a0f/1782820173/hls_264_master.m3u8`

### 12.4 玩家实拍（攻略博客，参考价值高）

| URL | 内容 |
|---|---|
| https://notejo.de/media/2024/turingcomplete/turing3.jpg | 编程关界面：在 CPU 背景上写迷宫求解汇编 |
| https://notejo.de/media/2024/turingcomplete/turing4.jpg | 完整 8 位 LEG 处理器电路全景 |
| https://notejo.de/media/2024/turingcomplete/turing5.jpg | 条件判断（COND）元件内部电路 |
| https://notejo.de/media/2024/turingcomplete/turing6.jpg | ALU 元件内部电路 |
| https://notejo.de/media/2024/turingcomplete/turing7.jpg | 栈（Stack）元件电路 |
| https://richeyward.com/posts/digitron/turing-complete/03-memory/08-alu_1_hu_764261fcfdd23754.png | ALU1 关卡解法电路 |

---

## 13. 参考链接总表

### 官方
- 官网：https://turingcomplete.game/
- Steam 商店：https://store.steampowered.com/app/1444480/Turing_Complete/
- 官方 Discord：https://discord.gg/hdrJaMUdrF
- 玩家档案示例：https://turingcomplete.game/profile/7362
- 社区 wiki：https://turingcomplete.wiki

### 数据
- SteamDB：https://steamdb.info/app/1444480/
- 评测 API：https://store.steampowered.com/appreviews/1444480?json=1
- 补丁记录：https://steamydata.com/app/1444480/turing-complete/patch-notes
- 销量估算：https://isitdoneyet.gg/game/turing-complete

### 攻略与指南
- 图灵完备2.1指南（全 93 关解法）：https://steamcommunity.com/sharedfiles/filedetails/?id=3496162641
- 全关卡攻略（含背景知识）：https://steamcommunity.com/sharedfiles/filedetails/?id=3054134872
- OVERTURE/LEG ISA 规范：https://steamcommunity.com/sharedfiles/filedetails/?id=2782647016
- 得分优化方案：https://steamcommunity.com/sharedfiles/filedetails/?id=3789887881
- richeyward 分章攻略（英文）：https://richeyward.com/posts/digitron/turing-complete/01-basic-logic/
- notejo.de 深度回顾（LEG/汇编实例）：https://notejo.de/posts/2024/turingcomplete
- B 站专栏逐关攻略：https://www.bilibili.com/read/readlist/rl544745
- OVERTURE 指令集一览（中文）：https://tarikvon.github.io/2024/05/26/OVERTURE/
- cnblogs OVERTURE 汇编实例：https://www.cnblogs.com/QiFande/p/18693183

### 开源
- isa_spec 汇编框架：https://github.com/stuffe/isa_spec/
- LEG_Codes：https://github.com/sxysxy/LEG_Codes
- 汇编解法集：https://github.com/DoubleCouponDay/turingcompletesolutions

---

*汇编完成于 2026-10-03。如需补充某一部分（如某章逐关详细解法、某架构完整指令表），可在本文件对应章节继续扩展。*
