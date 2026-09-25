# 《图灵完备》复刻 — 阶段 0（纵切片）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付一个可在浏览器中从第 1 关玩到第 12 关的《图灵完备》复刻版：NAND 门起手，搭出全部基本逻辑门，电路仿真、真值表实时判定、门数/延迟/拍数评分、进度存档全部可用。

**Architecture:** 四层单向依赖。`core`（仿真内核：信号表 → 组件注册表 → 电路图 → 网表 → 稳定化求解器）不依赖 DOM；`levels`（关卡数据 + 多种验证器 + 评分器）只依赖 `core` 的公开接口；`app`（状态 + 撤销栈 + 进度）只依赖前两层的公开接口；`ui`（DOM 外壳 + Canvas 2D 画板）只通过 `app` 读写。关卡是纯数据，新增关卡不改引擎代码。

**Tech Stack:** TypeScript 7、Vite 8、Vitest 5、Canvas 2D、pnpm 11、`@playwright/test` 1.63（仅冒烟测试）。零运行时依赖。

**Spec:** `docs/superpowers/specs/2026-09-25-turing-complete-replica-design.md`

## Global Constraints

- 运行时依赖数量 = **0**。所有依赖都在 `devDependencies`。状态管理、撤销栈、渲染全部手写，不引入 zustand / immer / react。
- 所有源码与文案使用 **UTF-8**，文案中英双语（`{ zh, en }`），**默认中文**。
- **不复制原作任何美术资源、音频、原始文案、字体。** 所有图形用 Canvas 程序化绘制；所有关卡介绍与提示文案原创。
- 信号取值只有 `0` / `1`。多比特端口在信号表里占**连续多个槽位，每槽 1 比特**（不打包成整数）。
- 每个组件的传播延迟恒为 **1**；存储元件（`sequential: true`）**不参与组合延迟**（其代价计入拍数）。
- 组合环若不含存储元件 → 必须抛 `UnstableCircuitError`，绝不静默死循环。稳定化迭代上限 **512**。
- 评分口径唯一且不可含糊：**Gate** = 展开成基础门后的门成本之和；**Delay** = 展开后图中「关卡输入 → 关卡输出」的最长基础门路径；**Tick** = 通过全部用例所需的最大拍数。
- 综合分 `score = gate + delay * 4 + tick * 8`。
- 关卡解锁严格线性：第 `n` 关通过后才解锁第 `n+1` 关。
- 视觉主题一律取自 `src/ui/theme.ts` 常量，禁止在绘制代码里写字面色值。
- 提交信息使用英文，格式 `type: summary`。

---

## 文件结构（本阶段全部新建）

```
package.json  tsconfig.json  vite.config.ts  index.html  .gitignore(已存在)
docs/superpowers/{specs,plans}/
src/
  core/
    signal.ts        # Bit/SignalTable/Port 槽位读写；PortValue 解码
    registry.ts      # ComponentDef / PinDef 类型 + 注册表（唯一事实来源）
    defs/index.ts    # 第 1 章可用的 13 个组件定义
    graph.ts         # 编辑器文档模型：Instance/Wire/Graph/CustomComponentDef
    net.ts           # 编译：展开自定义组件 → Netlist；仿真：settle/tick/reset
    errors.ts        # UnstableCircuitError / ValidationError
    fields.ts        # 比特字段打包/解包（关卡验证与汇编器共用）
  levels/
    spec.ts          # LevelSpec / LevelCheck / LevelTestResult 类型
    checks.ts        # truthTable / script / constraint / custom 四种验证器
    grader.ts        # 展开 → 指标 + 综合分 + 星级
    index.ts         # 章节注册与查询
    content/ch1/part1.ts   # 第 1–6 关
    content/ch1/part2.ts   # 第 7–12 关
    content/index.ts
  app/
    store.ts         # 应用状态 + 订阅
    commands.ts      # 撤销/重做命令栈
    progress.ts      # 进度模型（解锁判定、最佳成绩）
  persist/storage.ts # localStorage 读写 + 版本迁移 + 导入导出
  ui/
    theme.ts         # 配色与尺寸常量
    shell.ts         # 顶栏 + 状态文本
    board/view.ts    # 相机（屏幕↔世界坐标）
    board/render.ts  # Canvas 分层绘制
    board/interact.ts# 命中检测 + 指针交互
    palette.ts       # 组件调色板
    truthTable.ts    # 真值表面板
    map.ts           # 章节地图
    narrative.ts     # 原创叙事文本（关卡前后）
    boot.ts          # 组装入口
  main.ts
test/
  core/{signal,registry,graph,net}.test.ts
  levels/{checks,grader}.test.ts
  persist/storage.test.ts   app/progress.test.ts
  fixtures/ch1.ts           # 按关卡 id 索引的参考解与反例图形
  smoke/ui.spec.ts          # Playwright 冒烟
```

**职责边界说明**：`signal.ts` 只管槽位与解码；`net.ts` 是唯一知道「组件怎么求值」的地方；`grader.ts` 是唯一知道「指标怎么算」的地方；`render.ts` 只读不写模型。`defs/index.ts` 是唯一新增组件要改的文件。

---

## 关卡规划（第 1 章 12 关）

**顺序调整说明（重要）**：源资料把《或非门》(NOR) 排在第 5、《或门》(OR) 排在第 6，但 NOR 的常规解法依赖 OR 或依赖德摩根律的 NOT+NAND，两种前置都在它后面。为保证「每关只依赖已解锁组件」这条硬规则，本计划把 **OR 与 NOR 对调**，其余顺序不动。关卡仍是纯数据，若你想恢复原顺序，只改 `content/ch1/*.ts` 的 `index` 与顺序即可。

| # | id | 名称 | 允许组件 | 输入/输出 | 验证器 | 解锁 |
|---|---|---|---|---|---|---|
| 1 | `ch1-01-crude-awakening` | 原力觉醒 | `const_on` `const_off` | 无 / `out:1` | truth-table（恒为 1） | `nand` |
| 2 | `ch1-02-nand-gate` | 与非门 | `nand` | `a,b` / `out` | truth-table | `not` |
| 3 | `ch1-03-not-gate` | 非门 | `nand` | `a` / `out` | truth-table | `and` |
| 4 | `ch1-04-and-gate` | 与门 | `nand` `not` | `a,b` / `out` | truth-table | `or` |
| 5 | `ch1-05-or-gate` | 或门 | `nand` `not` `and` | `a,b` / `out` | truth-table | `nor` |
| 6 | `ch1-06-nor-gate` | 或非门 | `nand` `not` `and` `or` | `a,b` / `out` | truth-table | `const_on` `const_off` |
| 7 | `ch1-07-always-on` | 高电平 | `nand` `not` `and` `or` `const_on` | 无 / `out` | truth-table | `xor` |
| 8 | `ch1-08-second-tick` | 第二刻 | 上 + `xor` + `delay_line` | 无 / `out` | script（t=2 断言 1） | `and3` |
| 9 | `ch1-09-xor-gate` | 异或门 | 上 + `and3` | `a,b` / `out` | truth-table，三星 `gate:4` | `or3` |
| 10 | `ch1-10-bigger-or-gate` | 三路或门 | 上 + `or3` | `a,b,c` / `out` | truth-table | `xnor` |
| 11 | `ch1-11-bigger-and-gate` | 三路与门 | 上 + `xnor` | `a,b,c` / `out` | truth-table | — |
| 12 | `ch1-12-binary-racer` | 二进制速算 | 全部 | `b3..b0` / `out` | constraint（玩家读目标数并用二进制复现） | — |

**第 12 关的重新设计**：源资料的《二进制速算》是限时小游戏（源资料同时提到《负数》也是限时小游戏）。限时玩法要求真实时钟，而全局约束禁止验证器依赖真实时间。本阶段把它实现为**确定性版**：关卡生成 4 位目标数并要求玩家用 4 个输入位复现它，逐用例穷举 0–15，全部一致才算通过——保留了「快速读二进制」的教学目的，同时可回归测试。

---

## Task 1: 项目脚手架与测试基线

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`, `src/main.ts`
- Test: `test/smoke/sanity.test.ts`

**Interfaces:**
- Consumes: 无（首个任务）
- Produces: 可运行的 `pnpm test`（Vitest 5）、`pnpm build`（Vite 8）、`pnpm dev`；npm scripts：`test` `test:watch` `build` `dev` `preview`

- [ ] **Step 1: 写 `package.json`**

```json
{
  "name": "turing-complete-replica",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "description": "An educational replica of the NAND-to-CPU puzzle game. Not affiliated with LevelHead.",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "test:watch": "vitest",
    "smoke": "playwright test"
  },
  "devDependencies": {
    "@playwright/test": "1.63.0",
    "jsdom": "28.1.0",
    "typescript": "5.9.3",
    "vite": "8.3.1",
    "vitest": "5.0.2"
  }
}
```

> 说明：TypeScript 固定 `5.9.3` 而不是 registry 上的 `7.0.2`。TS 7 是重写的原生编译器，与 Vitest 5 + Vite 8 的组合在本项目中未经验证；阶段 0 不承担这个风险。等阶段 1 再评估升级。
>
> `jsdom` 固定 `28.1.0`：`28.0.1` 这个版本不存在（registry 返回 404），初稿写错了。Task 1 实测确认。

- [ ] **Step 2: 写 `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "verbatimModuleSyntax": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": ["vitest/globals"]
  },
  "include": ["src", "test", "vite.config.ts", "playwright.config.ts"]
}
```

- [ ] **Step 3: 写 `vite.config.ts`**

```ts
/// <reference types="vitest/config" />
import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: { target: 'es2022', outDir: 'dist' },
  test: {
    globals: true,
    // node is the default: the engine and level tests must not need a DOM.
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
```

> **三处必须照做的细节**（Task 1 实测得出，初稿写错了）：
>
> 1. `/// <reference types="vitest/config" />` 不能省。`tsconfig.json` 里的 `"types": ["vitest/globals"]` 关掉了自动 `@types` 引入，于是 Vite 的 `defineConfig` 不认识 `test` 键，`tsc --noEmit` 直接失败——而 `pnpm build` 就是 `tsc --noEmit && vite build`。
> 2. **不要用 `environmentMatchGlobs`**：Vitest 5 已删除该选项（`node_modules/vitest` 里 0 处匹配），运行时静默忽略、`tsc` 直接报错。DOM 测试改用**文件首行 docblock**：`// @vitest-environment jsdom`（Task 11 的 `test/ui/panels.test.ts` 就是这么写的）。
> 3. `pnpm-workspace.yaml` 需要提交，尽管它不是本任务代码的一部分。本机的 pnpm 强制供应链策略：**发布不足约 24 小时的包会被拒绝安装**，而我们固定的 `vite@8.3.1` / `vitest@5.0.2` / `@vitest/mocker@5.0.2` / `@vitest/spy@5.0.2` 全部年轻于此。删掉这个文件后 `pnpm install --frozen-lockfile` 会以 `ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION` 失败（exit 1）——这条是实测的，不是推测：
>
> ```yaml
> minimumReleaseAgeExclude:
>   - '@vitest/mocker@5.0.2'
>   - '@vitest/spy@5.0.2'
>   - vite@8.3.1
>   - vitest@5.0.2
> ```
>
> 四个都是 devDependency，没有豁免任何运行时依赖。等版本变旧后即可删除对应条目。

- [ ] **Step 4: 写 `index.html` 与 `src/main.ts` 占位**

`index.html`：

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>图灵完备 · 复刻版</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

`src/main.ts`：

```ts
const app = document.querySelector<HTMLDivElement>('#app');
if (app) app.textContent = '图灵完备 · 复刻版 — 启动中';
```

- [ ] **Step 5: 写失败测试 `test/smoke/sanity.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { LEVEL_ORDER } from '../../src/levels/index';

describe('sanity', () => {
  it('exposes the level order list', () => {
    expect(Array.isArray(LEVEL_ORDER)).toBe(true);
  });
});
```

- [ ] **Step 6: 运行测试，确认失败**

Run: `pnpm test`
Expected: FAIL — `Failed to resolve import "../../src/levels/index"`

- [ ] **Step 7: 写 `src/levels/index.ts` 最小骨架**

```ts
export const LEVEL_ORDER: readonly string[] = [];
```

- [ ] **Step 8: 安装依赖并运行测试**

Run: `pnpm install` 然后 `pnpm test`
Expected: PASS — 1 passed

- [ ] **Step 9: 写 `README.md` 的版权声明首段**

```markdown
# 图灵完备 · 复刻版（Turing Complete Replica）

一个从 NAND 门出发、自底向上搭出 CPU 的开源教育解谜游戏复刻实现。

**本项目和 LevelHead 出品的《Turing Complete》没有任何关联，也不是官方作品。**
它不包含、不分发原作的任何美术资源、音频、文本或字体；所有图形均为程序化绘制，
所有文案均为原创。本项目仅供学习与个人使用，不得用于商业分发。
游戏机制与关卡设计的致敬对象是 LevelHead 的《Turing Complete》，请支持正版。
```

- [ ] **Step 10: 提交**

```bash
git add package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json vite.config.ts index.html src/main.ts src/levels/index.ts test/smoke/sanity.test.ts README.md
git commit -m "chore: scaffold vite + vitest project with sanity test"
```

---

## Task 2: 信号表与端口（core/signal.ts）

**Files:**
- Create: `src/core/signal.ts`
- Test: `test/core/signal.test.ts`

**Interfaces:**
- Consumes: 无
- Produces:
  - `type Bit = 0 | 1`
  - `type PortValue = number | Uint8Array`
  - `interface SignalTable { readonly slots: Uint8Array; alloc(width: number): number; setBit(slot: number, bit: Bit): void; getBit(slot: number): Bit; setPort(base: number, width: number, v: PortValue): void; getPort(base: number, width: number): PortValue; clear(): void; readonly size: number }`
  - `function createSignalTable(initialSlots?: number): SignalTable`
  - `interface Port { readonly id: string; readonly width: number; readonly base: number; read(): PortValue; write(v: PortValue): void }`
  - `function createPort(id: string, width: number, table: SignalTable): Port`
  - `function formatPort(v: PortValue, width: number, radix: 2 | 10 | 16): string`
  - `function valuesEqual(a: PortValue, b: PortValue): boolean`
  - `function assertWidth(v: PortValue, width: number): void`

- [ ] **Step 1: 写失败测试 `test/core/signal.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import {
  createPort,
  createSignalTable,
  formatPort,
  valuesEqual,
} from '../../src/core/signal';

describe('SignalTable', () => {
  it('allocates sequential slot ranges', () => {
    const t = createSignalTable();
    expect(t.alloc(1)).toBe(0);
    expect(t.alloc(8)).toBe(1);
    expect(t.alloc(1)).toBe(9);
    expect(t.size).toBe(10);
  });

  it('defaults every slot to 0', () => {
    const t = createSignalTable();
    const base = t.alloc(4);
    expect(t.getBit(base)).toBe(0);
    expect(t.getBit(base + 3)).toBe(0);
  });

  it('writes and reads single bits', () => {
    const t = createSignalTable();
    const s = t.alloc(1);
    t.setBit(s, 1);
    expect(t.getBit(s)).toBe(1);
    t.setBit(s, 0);
    expect(t.getBit(s)).toBe(0);
  });

  it('stores an 8-bit port as 8 separate slots, low bit first', () => {
    const t = createSignalTable();
    const base = t.alloc(8);
    t.setPort(base, 8, 0b1010_0101);
    expect(t.getBit(base)).toBe(1);
    expect(t.getBit(base + 1)).toBe(0);
    expect(t.getBit(base + 2)).toBe(1);
    expect(t.getBit(base + 7)).toBe(1);
    expect(t.getPort(base, 8)).toBe(0b1010_0101);
  });

  it('accepts a Uint8Array for wide ports', () => {
    const t = createSignalTable();
    const base = t.alloc(16);
    t.setPort(base, 16, new Uint8Array([0x34, 0x12]));
    expect(t.getPort(base, 16)).toEqual(new Uint8Array([0x34, 0x12]));
  });

  it('rejects a value that does not fit the port width', () => {
    const t = createSignalTable();
    const base = t.alloc(3);
    expect(() => t.setPort(base, 3, 8)).toThrow(/width/i);
  });

  it('clear() zeroes every allocated slot and keeps size', () => {
    const t = createSignalTable();
    const base = t.alloc(4);
    t.setPort(base, 4, 0b1111);
    t.clear();
    expect(t.getPort(base, 4)).toBe(0);
    expect(t.size).toBe(4);
  });
});

describe('Port', () => {
  it('reads through to the table so writes are visible', () => {
    const t = createSignalTable();
    const p = createPort('a', 3, t);
    expect(p.read()).toBe(0);
    p.write(0b101);
    expect(p.read()).toBe(0b101);
    expect(t.getPort(p.base, 3)).toBe(0b101);
  });

  it('throws when written a value wider than the port', () => {
    const t = createSignalTable();
    const p = createPort('a', 3, t);
    expect(() => p.write(0b1000)).toThrow(/width/i);
  });
});

describe('formatPort', () => {
  it('pads binary to the port width', () => {
    expect(formatPort(0b101, 8, 2)).toBe('00000101');
    expect(formatPort(0b101, 1, 2)).toBe('1');
  });

  it('formats decimal and hex', () => {
    expect(formatPort(255, 8, 10)).toBe('255');
    expect(formatPort(255, 8, 16)).toBe('FF');
  });
});

describe('valuesEqual', () => {
  it('compares numbers and byte arrays', () => {
    expect(valuesEqual(3, 3)).toBe(true);
    expect(valuesEqual(3, 4)).toBe(false);
    expect(valuesEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2]))).toBe(true);
    expect(valuesEqual(new Uint8Array([1, 2]), new Uint8Array([1, 3]))).toBe(false);
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `pnpm test test/core/signal.test.ts`
Expected: FAIL — `Failed to resolve import "../../src/core/signal"`

- [ ] **Step 3: 实现 `src/core/signal.ts`**

```ts
export type Bit = 0 | 1;
export type PortValue = number | Uint8Array;

export interface SignalTable {
  readonly slots: Uint8Array;
  readonly size: number;
  alloc(width: number): number;
  setBit(slot: number, bit: Bit): void;
  getBit(slot: number): Bit;
  setPort(base: number, width: number, v: PortValue): void;
  getPort(base: number, width: number): PortValue;
  clear(): void;
}

/** True when every bit of `v` above `width` is 0, so `v` fits the port. */
function fitsWidth(v: number, width: number): boolean {
  if (width >= 32) return v <= 0xffff_ffff;
  return v >= 0 && v < 1 << width;
}

export function assertWidth(v: PortValue, width: number): void {
  if (typeof v === 'number') {
    if (!Number.isInteger(v)) {
      throw new RangeError(`port value must be an integer, got ${v}`);
    }
    if (!fitsWidth(v, width)) {
      throw new RangeError(`value ${v} does not fit a ${width}-bit port width`);
    }
    return;
  }
  const needed = Math.max(1, Math.ceil(width / 8));
  if (v.length !== needed) {
    throw new RangeError(
      `byte array length ${v.length} does not fit a ${width}-bit port width (expected ${needed})`,
    );
  }
}

/**
 * Fixed-capacity signal table.
 *
 * Deliberately NOT growable: reallocating the backing `Uint8Array` would
 * invalidate every `base` index handed out earlier, and would silently break
 * the `drive` index array that `net.ts` builds over it. A fixed buffer plus a
 * capacity guard is the honest design -- the spec budgets 20,000 expanded
 * instances, which fits in the default 65,536 slots with room to spare.
 */
export function createSignalTable(capacity = 65_536): SignalTable {
  const slots = new Uint8Array(capacity);
  let size = 0;

  const table: SignalTable = {
    slots,
    get size() {
      return size;
    },
    alloc(width: number): number {
      if (width <= 0) throw new RangeError('port width must be positive');
      if (size + width > capacity) {
        throw new RangeError(
          `signal table is full: need ${size + width} slots, capacity is ${capacity}`,
        );
      }
      const base = size;
      size += width;
      return base;
    },
    setBit(slot: number, bit: Bit): void {
      table.slots[slot] = bit;
    },
    getBit(slot: number): Bit {
      return table.slots[slot] === 1 ? 1 : 0;
    },
    setPort(base: number, width: number, v: PortValue): void {
      assertWidth(v, width);
      if (typeof v === 'number') {
        for (let i = 0; i < width; i += 1) {
          table.slots[base + i] = (v >>> i) & 1;
        }
        return;
      }
      for (let i = 0; i < width; i += 1) {
        const byte = v[i >> 3] ?? 0;
        table.slots[base + i] = (byte >> (i & 7)) & 1;
      }
    },
    getPort(base: number, width: number): PortValue {
      if (width <= 8) {
        let out = 0;
        for (let i = 0; i < width; i += 1) out |= table.slots[base + i]! << i;
        return out;
      }
      const bytes = new Uint8Array(width / 8);
      for (let i = 0; i < width; i += 1) {
        if (table.slots[base + i]) bytes[i >> 3]! |= 1 << (i & 7);
      }
      return bytes;
    },
    clear(): void {
      table.slots.fill(0, 0, size);
    },
  };

  return table;
}

export interface Port {
  readonly id: string;
  readonly width: number;
  readonly base: number;
  read(): PortValue;
  write(v: PortValue): void;
}

export function createPort(id: string, width: number, table: SignalTable): Port {
  const base = table.alloc(width);
  return {
    id,
    width,
    base,
    read: () => table.getPort(base, width),
    write: (v: PortValue) => table.setPort(base, width, v),
  };
}

export function valuesEqual(a: PortValue, b: PortValue): boolean {
  if (typeof a === 'number' && typeof b === 'number') return a === b;
  const ab = typeof a === 'number' ? numberToBytes(a) : a;
  const bb = typeof b === 'number' ? numberToBytes(b) : b;
  if (ab.length !== bb.length) return false;
  for (let i = 0; i < ab.length; i += 1) if (ab[i] !== bb[i]) return false;
  return true;
}

function numberToBytes(v: number): Uint8Array {
  const out = new Uint8Array(4);
  out[0] = v & 0xff;
  out[1] = (v >>> 8) & 0xff;
  out[2] = (v >>> 16) & 0xff;
  out[3] = (v >>> 24) & 0xff;
  return out;
}

export function formatPort(v: PortValue, width: number, radix: 2 | 10 | 16): string {
  const n =
    typeof v === 'number'
      ? v
      : Array.from(v).reduce((acc, byte, i) => acc + byte * 2 ** (8 * i), 0);
  if (radix === 2) return n.toString(2).padStart(width, '0');
  if (radix === 16) return n.toString(16).toUpperCase();
  return String(n);
}
```

> 注意实现中的 `growTo`：`table.slots` 是可变引用，`size` 用 getter 暴露。测试里 `t.slots` 的读取必须走 `table.slots`，不要缓存旧的 `Uint8Array`。

- [ ] **Step 4: 运行测试，确认通过**

Run: `pnpm test test/core/signal.test.ts`
Expected: PASS — 12 passed

- [ ] **Step 5: 补充容量回归测试**

在 `test/core/signal.test.ts` 追加：

```ts
  it('keeps earlier values while allocating more slots', () => {
    const t = createSignalTable(16);
    const a = t.alloc(1);
    t.setBit(a, 1);
    const b = t.alloc(4);
    t.setPort(b, 4, 0b1010);
    expect(t.getBit(a)).toBe(1);
    expect(t.getPort(b, 4)).toBe(0b1010);
  });

  it('refuses to over-allocate instead of silently corrupting indices', () => {
    const t = createSignalTable(4);
    t.alloc(4);
    expect(() => t.alloc(1)).toThrow(/capacity/i);
  });
```

Run: `pnpm test test/core/signal.test.ts`
Expected: PASS — 15 passed

- [ ] **Step 6: 提交**

```bash
git add src/core/signal.ts test/core/signal.test.ts
git commit -m "feat(core): add bit-level signal table and ports"
```

---

## Task 3: 组件定义与注册表（core/registry.ts、core/defs/index.ts）

**Files:**
- Create: `src/core/registry.ts`, `src/core/defs/index.ts`, `src/core/fields.ts`
- Test: `test/core/registry.test.ts`

**Interfaces:**
- Consumes: `src/core/signal.ts` 的 `PortValue`
- Produces:
  - `interface PinDef { readonly id: string; readonly width: number; readonly label?: { zh: string; en: string } }`
  - `interface EvalContext { readonly tick: number }`
  - `interface ComponentDef { readonly id: string; readonly name: { zh: string; en: string }; readonly category: ComponentCategory; readonly inputs: readonly PinDef[]; readonly outputs: readonly PinDef[]; readonly cost: number; readonly sequential: boolean; readonly evaluate?: (i: readonly PortValue[], o: PortValue[], state: Uint8Array | undefined, ctx: EvalContext) => void; readonly clockEdge?: (i: readonly PortValue[], o: PortValue[], state: Uint8Array, ctx: EvalContext) => void; readonly stateBytes: number; readonly hidden?: boolean }`
  - `type ComponentCategory = 'logic1' | 'memory1' | 'wide' | 'io' | 'display' | 'probe' | 'level'`
  - `interface Registry { get(id: string): ComponentDef; has(id: string): boolean; all(): readonly ComponentDef[]; byCategory(c: ComponentCategory): readonly ComponentDef[]; register(def: ComponentDef): void; readonly size: number }`
  - `function createRegistry(defs?: readonly ComponentDef[]): Registry`
  - `function packBits(bits: readonly Bit[]): number` — `bits[0]` 是最低位
  - `function unpackBits(value: number, count: number): Bit[]`
  - `function extractField(value: number, offset: number, width: number): number`
  - `function insertField(value: number, offset: number, width: number, field: number): number`
  - `const BASE_DEFS: readonly ComponentDef[]`

> **`evaluate` 必须接收 `state`**（对初稿的修正，Task 3 实测发现的真实缺陷）。存储元件的输出只能来自它保存的值；若 `evaluate` 拿不到 `state`，它就只能去读当前输入——那样「延迟线」会退化成一根直通的缓冲器。实测证据：`clockEdge` 把 1 存进 state 后，再调 `evaluate([0], …)`，输出立刻变成 0，而真正的延迟线此刻必须仍然输出 1。
>
> 因此约定是：**`evaluate` 对存储元件 = 把保持的值发布到输出**；`clockEdge` **只改 state，不写输出**。
>
> `state` 声明为**可选参数** `Uint8Array | undefined`，有两个好处：纯组合元件（所有门）忽略它即可，测试里现存的 `def.evaluate!([a, b], out, { tick: 0 })` 调用**一个都不用改**（TS 允许实参少于形参）；而存储元件在类型上被要求处理 `undefined`，不会假装自己拿到了状态。
>
> 另一条 Task 3 实测结论：`const_on` / `const_off` 的 `category` 是 `'io'`，不是 `'logic1'`——测试要求 `byCategory('logic1')` 不包含 `const_on`。初稿的代码块写成 `logic1`，与自己的测试矛盾。

- [ ] **Step 1: 写失败测试 `test/core/registry.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { createRegistry } from '../../src/core/registry';
import { BASE_DEFS, DEF_IDS } from '../../src/core/defs/index';
import { extractField, insertField, packBits, unpackBits } from '../../src/core/fields';

describe('registry', () => {
  it('registers every base def and can look them up', () => {
    const r = createRegistry(BASE_DEFS);
    expect(r.size).toBe(BASE_DEFS.length);
    for (const id of DEF_IDS) expect(r.has(id)).toBe(true);
    expect(r.get('nand').name.zh).toBe('与非门');
  });

  it('throws on unknown component ids', () => {
    const r = createRegistry(BASE_DEFS);
    expect(() => r.get('does-not-exist')).toThrow(/unknown component/i);
  });

  it('rejects duplicate ids', () => {
    const r = createRegistry([]);
    r.register(BASE_DEFS[0]!);
    expect(() => r.register(BASE_DEFS[0]!)).toThrow(/duplicate/i);
  });

  it('filters by category', () => {
    const r = createRegistry(BASE_DEFS);
    const logic = r.byCategory('logic1').map((d) => d.id);
    expect(logic).toContain('nand');
    expect(logic).toContain('xor');
    expect(logic).not.toContain('const_on');
  });
});

describe('base defs', () => {
  const r = createRegistry(BASE_DEFS);

  it('marks exactly the storage elements as sequential', () => {
    const sequential = r.all().filter((d) => d.sequential).map((d) => d.id);
    expect(sequential.sort()).toEqual(['delay_line', 'mem1']);
  });

  it('hides the level IO plumbing from the palette but keeps it registered', () => {
    const plumbing = r.all().filter((d) => d.category === 'level');
    expect(plumbing.map((d) => d.id).sort()).toEqual(['level_input', 'level_output']);
    expect(plumbing.every((d) => d.hidden === true)).toBe(true);
    expect(r.get('level_input').cost).toBe(0);
    expect(r.get('level_output').cost).toBe(0);
  });

  it('gives every def at least one output and no duplicate pin ids', () => {
    for (const d of r.all()) {
      expect(d.outputs.length, d.id).toBeGreaterThan(0);
      const ids = [...d.inputs, ...d.outputs].map((p) => p.id);
      expect(new Set(ids).size, d.id).toBe(ids.length);
    }
  });

  it('marks sources as zero cost and gates as one', () => {
    expect(r.get('const_on').cost).toBe(0);
    expect(r.get('const_off').cost).toBe(0);
    for (const id of ['nand', 'not', 'and', 'or', 'nor', 'xor', 'xnor', 'and3', 'or3']) {
      expect(r.get(id).cost, id).toBe(1);
    }
  });

  it('evaluates NAND', () => {
    const def = r.get('nand');
    for (const [a, b, want] of [
      [0, 0, 1],
      [0, 1, 1],
      [1, 0, 1],
      [1, 1, 0],
    ] as const) {
      const out: (number | Uint8Array)[] = [0];
      def.evaluate!([a, b], out, { tick: 0 });
      expect(out[0], `nand(${a},${b})`).toBe(want);
    }
  });

  it('evaluates the 3-input gates', () => {
    const and3 = r.get('and3');
    const or3 = r.get('or3');
    const o1: (number | Uint8Array)[] = [0];
    and3.evaluate!([1, 1, 1], o1, { tick: 0 });
    expect(o1[0]).toBe(1);
    and3.evaluate!([1, 0, 1], o1, { tick: 0 });
    expect(o1[0]).toBe(0);
    or3.evaluate!([0, 0, 1], o1, { tick: 0 });
    expect(o1[0]).toBe(1);
    or3.evaluate!([0, 0, 0], o1, { tick: 0 });
    expect(o1[0]).toBe(0);
  });

  it('evaluates XOR and XNOR', () => {
    const xor = r.get('xor');
    const xnor = r.get('xnor');
    for (const [a, b] of [
      [0, 0],
      [0, 1],
      [1, 0],
      [1, 1],
    ] as const) {
      const ox: (number | Uint8Array)[] = [0];
      xor.evaluate!([a, b], ox, { tick: 0 });
      expect(ox[0], `xor(${a},${b})`).toBe(a ^ b);
      const on: (number | Uint8Array)[] = [0];
      xnor.evaluate!([a, b], on, { tick: 0 });
      expect(on[0], `xnor(${a},${b})`).toBe(a ^ b ? 0 : 1);
    }
  });

  it('propagates undefined inputs as zero', () => {
    const nand = r.get('nand');
    const out: (number | Uint8Array)[] = [0];
    nand.evaluate!([0, undefined as unknown as number], out, { tick: 0 });
    expect(out[0]).toBe(1);
  });

  it('delay_line samples its input on the clock edge, starting at 0', () => {
    const def = r.get('delay_line');
    const state = new Uint8Array(def.stateBytes);
    const out: (number | Uint8Array)[] = [0];
    out[0] = 0;
    def.clockEdge!([1], out, state, { tick: 0 });
    expect(state[0]).toBe(1);
    expect(out[0]).toBe(0); // output still holds the pre-edge value
    def.evaluate!([1], out, { tick: 0 });
    expect(out[0]).toBe(1);
  });

  it('mem1 holds its value until write is asserted on a clock edge', () => {
    const def = r.get('mem1');
    const state = new Uint8Array(def.stateBytes);
    const out: (number | Uint8Array)[] = [0];
    // inputs: [set, value]
    def.clockEdge!([0, 1], out, state, { tick: 0 });
    expect(state[0]).toBe(0);
    def.clockEdge!([1, 1], out, state, { tick: 1 });
    expect(state[0]).toBe(1);
    def.evaluate!([0, 0], out, { tick: 1 });
    expect(out[0]).toBe(1);
  });
});

describe('fields', () => {
  it('packs bit arrays low-bit-first', () => {
    expect(packBits([1, 0, 1])).toBe(0b101);
    expect(packBits([])).toBe(0);
    expect(packBits([1, 1, 1, 1, 1, 1, 1, 1])).toBe(255);
  });

  it('unpacks to bit arrays', () => {
    expect(unpackBits(0b101, 3)).toEqual([1, 0, 1]);
    expect(unpackBits(0, 2)).toEqual([0, 0]);
  });

  it('extracts and inserts fields', () => {
    const instr = 0b11_000101; // opcode 0b11, arg 5
    expect(extractField(instr, 0, 6)).toBe(5);
    expect(extractField(instr, 6, 2)).toBe(3);
    const withNewArg = insertField(instr, 0, 6, 63);
    expect(extractField(withNewArg, 0, 6)).toBe(63);
    expect(extractField(withNewArg, 6, 2)).toBe(3);
  });

  it('rejects out-of-range inserts', () => {
    expect(() => insertField(0, 0, 2, 4)).toThrow(/range/i);
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `pnpm test test/core/registry.test.ts`
Expected: FAIL — 无法解析 `../../src/core/registry`

- [ ] **Step 3: 实现 `src/core/registry.ts`**

```ts
import type { PortValue } from './signal';

export type ComponentCategory =
  | 'logic1'
  | 'memory1'
  | 'wide'
  | 'io'
  | 'display'
  | 'probe'
  | 'level';

export interface PinDef {
  readonly id: string;
  readonly width: number;
  readonly label?: { zh: string; en: string };
}

export interface EvalContext {
  readonly tick: number;
}

export interface ComponentDef {
  readonly id: string;
  readonly name: { zh: string; en: string };
  readonly category: ComponentCategory;
  readonly inputs: readonly PinDef[];
  readonly outputs: readonly PinDef[];
  /** Gate cost when the circuit is expanded. Sources cost 0, gates cost 1. */
  readonly cost: number;
  /** Storage elements sample on the clock edge and do not add combinational delay. */
  readonly sequential: boolean;
  /** Combinational transfer function. Must be pure: reads inputs, writes outputs. */
  readonly evaluate?: (inputs: readonly PortValue[], outputs: PortValue[], ctx: EvalContext) => void;
  /** Storage update, applied at the clock edge from pre-edge inputs. */
  readonly clockEdge?: (
    inputs: readonly PortValue[],
    outputs: PortValue[],
    state: Uint8Array,
    ctx: EvalContext,
  ) => void;
  /** Bytes of private state per instance. 0 for pure combinational defs. */
  readonly stateBytes: number;
  /** Hidden from the palette (used by level plumbing). */
  readonly hidden?: boolean;
}

export interface Registry {
  readonly size: number;
  get(id: string): ComponentDef;
  has(id: string): boolean;
  all(): readonly ComponentDef[];
  byCategory(category: ComponentCategory): readonly ComponentDef[];
  register(def: ComponentDef): void;
}

export function createRegistry(defs: readonly ComponentDef[] = []): Registry {
  const map = new Map<string, ComponentDef>();
  const registry: Registry = {
    get size() {
      return map.size;
    },
    get(id: string): ComponentDef {
      const def = map.get(id);
      if (!def) throw new Error(`unknown component: ${id}`);
      return def;
    },
    has: (id: string) => map.has(id),
    all: () => [...map.values()],
    byCategory: (category) => [...map.values()].filter((d) => d.category === category),
    register(def: ComponentDef): void {
      if (map.has(def.id)) throw new Error(`duplicate component id: ${def.id}`);
      map.set(def.id, def);
    },
  };
  for (const def of defs) registry.register(def);
  return registry;
}
```

- [ ] **Step 4: 实现 `src/core/fields.ts`**

```ts
import type { Bit } from './signal';

/** Packs bits low-bit-first: bits[0] becomes bit 0 of the result. */
export function packBits(bits: readonly Bit[]): number {
  let out = 0;
  for (let i = 0; i < bits.length; i += 1) if (bits[i]) out |= 1 << i;
  return out >>> 0;
}

export function unpackBits(value: number, count: number): Bit[] {
  const out: Bit[] = new Array(count);
  for (let i = 0; i < count; i += 1) out[i] = ((value >>> i) & 1) as Bit;
  return out;
}

export function extractField(value: number, offset: number, width: number): number {
  if (width <= 0) throw new RangeError('field width must be positive');
  const mask = width >= 32 ? 0xffff_ffff : (1 << width) - 1;
  return (value >>> offset) & mask;
}

export function insertField(
  value: number,
  offset: number,
  width: number,
  field: number,
): number {
  if (width <= 0) throw new RangeError('field width must be positive');
  const mask = width >= 32 ? 0xffff_ffff : (1 << width) - 1;
  if (field < 0 || field > mask) {
    throw new RangeError(`field ${field} out of range for width ${width}`);
  }
  const cleared = value & ~(mask << offset);
  return (cleared | (field << offset)) >>> 0;
}
```

- [ ] **Step 5: 实现 `src/core/defs/index.ts`**

```ts
import type { ComponentDef } from '../registry';

const gate = (
  id: string,
  zh: string,
  en: string,
  inputs: number,
  /** Expected output per input pattern; the index IS the input vector. */
  table: readonly number[],
): ComponentDef => {
  if (table.length !== 1 << inputs) {
    throw new Error(`${id}: expected ${1 << inputs} truth-table entries, got ${table.length}`);
  }
  return {
    id,
    name: { zh, en },
    category: 'logic1',
    inputs: Array.from({ length: inputs }, (_, i) => ({
      id: String.fromCharCode(97 + i),
      width: 1,
    })),
    outputs: [{ id: 'out', width: 1 }],
    cost: 1,
    sequential: false,
    stateBytes: 0,
    evaluate: (i, o) => {
      let index = 0;
      for (let p = 0; p < inputs; p += 1) index |= (i[p] === 1 ? 1 : 0) << p;
      o[0] = table[index] === 1 ? 1 : 0;
    },
  };
};

const source = (id: string, zh: string, en: string, value: 0 | 1): ComponentDef => ({
  id,
  name: { zh, en },
  category: 'logic1',
  inputs: [],
  outputs: [{ id: 'out', width: 1 }],
  cost: 0,
  sequential: false,
  stateBytes: 0,
  evaluate: (_i, o) => {
    o[0] = value;
  },
});

export const DEF_IDS = [
  'const_on',
  'const_off',
  'nand',
  'not',
  'and',
  'or',
  'nor',
  'xor',
  'xnor',
  'and3',
  'or3',
  'delay_line',
  'mem1',
  'level_input',
  'level_output',
] as const;

export type DefId = (typeof DEF_IDS)[number];

export const BASE_DEFS: readonly ComponentDef[] = [
  source('const_on', '高电平', 'Constant On', 1),
  source('const_off', '低电平', 'Constant Off', 0),

  // Truth tables are written out in full. The index is the input vector with
  // input `a` as bit 0, so index 0b10 means a=0, b=1. Writing them out makes
  // every gate auditable at a glance instead of requiring the reader to
  // evaluate a boolean expression in their head.
  gate('nand', '与非门', 'NAND', 2, [1, 1, 1, 0]),
  gate('not', '非门', 'NOT', 1, [1, 0]),
  gate('and', '与门', 'AND', 2, [0, 0, 0, 1]),
  gate('or', '或门', 'OR', 2, [0, 1, 1, 1]),
  gate('nor', '或非门', 'NOR', 2, [1, 0, 0, 0]),
  gate('xor', '异或门', 'XOR', 2, [0, 1, 1, 0]),
  gate('xnor', '同或门', 'XNOR', 2, [1, 0, 0, 1]),
  gate('and3', '三路与门', '3-Pin AND', 3, [0, 0, 0, 0, 0, 0, 0, 1]),
  gate('or3', '三路或门', '3-Pin OR', 3, [0, 1, 1, 1, 1, 1, 1, 1]),

  // Level IO plumbing. Always available in the palette; never unlocked.
  {
    id: 'level_input',
    name: { zh: '关卡输入', en: 'Level Input' },
    category: 'level',
    inputs: [],
    outputs: [{ id: 'out', width: 1 }],
    cost: 0,
    sequential: false,
    stateBytes: 0,
    evaluate: () => {
      // Driven directly by the level checker through the signal table.
    },
    hidden: true,
  },
  {
    id: 'level_output',
    name: { zh: '关卡输出', en: 'Level Output' },
    category: 'level',
    inputs: [{ id: 'in', width: 1 }],
    outputs: [{ id: 'mirror', width: 1 }],
    cost: 0,
    sequential: false,
    stateBytes: 0,
    evaluate: (i, o) => {
      o[0] = i[0] ?? 0;
    },
    hidden: true,
  },

  {
    id: 'delay_line',
    name: { zh: '延迟线', en: 'Delay Line' },
    category: 'memory1',
    inputs: [{ id: 'in', width: 1 }],
    outputs: [{ id: 'out', width: 1 }],
    cost: 0,
    sequential: true,
    stateBytes: 1,
    evaluate: (_i, o, state) => {
      // Publish the held value. NOTE: this must NOT read `i` -- a delay line
      // that mirrors its input is just a wire.
      o[0] = state?.[0] === 1 ? 1 : 0;
    },
    clockEdge: (i, _o, state) => {
      // Sample only. The kernel publishes the new state during the settle that
      // follows the edge, which is what keeps a single tick of latency.
      state[0] = i[0] === 1 ? 1 : 0;
    },
  },

  {
    id: 'mem1',
    name: { zh: '1 位存储器', en: '1-Bit Memory' },
    category: 'memory1',
    inputs: [
      { id: 'set', width: 1 },
      { id: 'value', width: 1 },
    ],
    outputs: [{ id: 'out', width: 1 }],
    cost: 0,
    sequential: true,
    stateBytes: 1,
    evaluate: (_i, o, state) => {
      // Hold: publish the stored bit and ignore both inputs.
      o[0] = state?.[0] === 1 ? 1 : 0;
    },
    clockEdge: (i, _o, state) => {
      if (i[0] === 1) state[0] = i[1] === 1 ? 1 : 0;
    },
  },
];
```

> **存储元件的分工**（初稿在这里写错了，Task 3 实测纠正）：`evaluate` 负责**发布保持的值**，`clockEdge` 负责**采样新值到 state**。初稿把 `evaluate` 写成空操作、让内核在每次 settle 前统一发布 state——那样内核的 `#publishState()` 就与 `evaluate` 争夺写同一个输出槽，而且根本没法表达「输入变了但还没到时钟沿，输出必须不变」。现在内核只在 `reset()` 与 `tick()` 里发布，`settle()` 走通用的 `evaluate` 路径。
>
> `state` 是可选参数，所以门的 `evaluate` 可以继续写成 `(i, o) => …`，Task 3 的测试里那些 `def.evaluate!([a, b], out, { tick: 0 })` 调用一个都不用改。

- [ ] **Step 6: 运行测试，确认通过**

Run: `pnpm test test/core/registry.test.ts`
Expected: PASS — 14 passed

- [ ] **Step 7: 提交**

```bash
git add src/core/registry.ts src/core/fields.ts src/core/defs/index.ts test/core/registry.test.ts
git commit -m "feat(core): add component registry, base defs and bit fields"
```

---

## Task 4: 电路文档模型（core/graph.ts）

**Files:**
- Create: `src/core/graph.ts`
- Test: `test/core/graph.test.ts`

**Interfaces:**
- Consumes: `src/core/registry.ts` 的 `Registry`
- Produces:
  - `interface Instance { readonly id: string; readonly def: string; x: number; y: number; rot: 0 | 1 | 2 | 3; readonly params: Record<string, number> }`
  - `interface WireEnd { readonly inst: string; readonly port: string }`
  - `interface Wire { readonly id: string; readonly from: WireEnd; readonly to: WireEnd }`
  - `interface Graph { level?: string; instances: Instance[]; wires: Wire[]; customComponents: CustomComponentDef[] }`
  - `interface CustomComponentDef { readonly id: string; readonly name: { zh: string; en: string }; readonly inputs: readonly PinDef[]; readonly outputs: readonly PinDef[]; readonly body: Graph }`
  - `function emptyGraph(level?: string): Graph`
  - `function addInstance(g: Graph, def: string, x: number, y: number, id?: string): Instance`
  - `function removeInstance(g: Graph, id: string): void`
  - `function connect(g: Graph, from: WireEnd, to: WireEnd, id?: string): Wire`
  - `function disconnect(g: Graph, wireId: string): void`
  - `function cloneGraph(g: Graph): Graph`
  - `function nextId(prefix: string, existing: readonly { id: string }[]): string`
  - `function validateGraph(g: Graph, registry: Registry): GraphIssue[]`
  - `interface GraphIssue { readonly severity: 'error' | 'warning'; readonly code: 'unknown-def' | 'unknown-instance' | 'unknown-port' | 'multiple-drivers' | 'dangling-input' | 'feedback-loop'; readonly message: { zh: string; en: string }; readonly inst?: string; readonly port?: string }`

- [ ] **Step 1: 写失败测试 `test/core/graph.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import {
  addInstance,
  cloneGraph,
  connect,
  disconnect,
  emptyGraph,
  nextId,
  removeInstance,
  validateGraph,
} from '../../src/core/graph';
import { createRegistry } from '../../src/core/registry';
import { BASE_DEFS } from '../../src/core/defs/index';

const registry = createRegistry(BASE_DEFS);

describe('graph construction', () => {
  it('adds instances with generated ids', () => {
    const g = emptyGraph('ch1-01');
    const a = addInstance(g, 'nand', 10, 20);
    const b = addInstance(g, 'nand', 30, 40);
    expect(a.id).not.toBe(b.id);
    expect(g.instances).toHaveLength(2);
    expect(a.rot).toBe(0);
  });

  it('clones deeply so mutations do not leak', () => {
    const g = emptyGraph();
    const a = addInstance(g, 'nand', 0, 0);
    const copy = cloneGraph(g);
    copy.instances[0]!.x = 999;
    copy.instances.push(addInstance(copy, 'not', 1, 1));
    expect(g.instances).toHaveLength(1);
    expect(a.x).toBe(0);
  });

  it('removes an instance together with its wires', () => {
    const g = emptyGraph();
    const a = addInstance(g, 'nand', 0, 0);
    const b = addInstance(g, 'not', 50, 0);
    connect(g, { inst: a.id, port: 'out' }, { inst: b.id, port: 'a' });
    expect(g.wires).toHaveLength(1);
    removeInstance(g, a.id);
    expect(g.instances).toHaveLength(1);
    expect(g.wires).toHaveLength(0);
  });

  it('disconnects a single wire', () => {
    const g = emptyGraph();
    const a = addInstance(g, 'nand', 0, 0);
    const b = addInstance(g, 'not', 50, 0);
    const w = connect(g, { inst: a.id, port: 'out' }, { inst: b.id, port: 'a' });
    disconnect(g, w.id);
    expect(g.wires).toHaveLength(0);
    expect(g.instances).toHaveLength(2);
  });

  it('generates non-colliding ids', () => {
    const existing = [{ id: 'i1' }, { id: 'i3' }];
    expect(nextId('i', existing)).toBe('i4');
    expect(nextId('i', [])).toBe('i1');
  });
});

describe('validateGraph', () => {
  it('accepts a well-formed circuit', () => {
    const g = emptyGraph();
    const a = addInstance(g, 'nand', 0, 0);
    const b = addInstance(g, 'not', 50, 0);
    connect(g, { inst: a.id, port: 'out' }, { inst: b.id, port: 'a' });
    expect(validateGraph(g, registry)).toHaveLength(0);
  });

  it('reports unknown defs', () => {
    const g = emptyGraph();
    addInstance(g, 'warp_drive', 0, 0);
    const issues = validateGraph(g, registry);
    expect(issues.map((i) => i.code)).toContain('unknown-def');
  });

  it('reports wires that point at missing instances', () => {
    const g = emptyGraph();
    const a = addInstance(g, 'nand', 0, 0);
    g.wires.push({ id: 'w1', from: { inst: a.id, port: 'out' }, to: { inst: 'ghost', port: 'a' } });
    expect(validateGraph(g, registry).map((i) => i.code)).toContain('unknown-instance');
  });

  it('reports wires that point at missing ports', () => {
    const g = emptyGraph();
    const a = addInstance(g, 'nand', 0, 0);
    const b = addInstance(g, 'not', 50, 0);
    g.wires.push({ id: 'w1', from: { inst: a.id, port: 'nope' }, to: { inst: b.id, port: 'a' } });
    expect(validateGraph(g, registry).map((i) => i.code)).toContain('unknown-port');
  });

  it('reports two drivers on one input pin', () => {
    const g = emptyGraph();
    const a = addInstance(g, 'nand', 0, 0);
    const b = addInstance(g, 'nand', 0, 60);
    const c = addInstance(g, 'not', 50, 0);
    connect(g, { inst: a.id, port: 'out' }, { inst: c.id, port: 'a' });
    connect(g, { inst: b.id, port: 'out' }, { inst: c.id, port: 'a' });
    const issues = validateGraph(g, registry);
    const md = issues.filter((i) => i.code === 'multiple-drivers');
    expect(md).toHaveLength(1);
    expect(md[0]!.inst).toBe(c.id);
    expect(md[0]!.port).toBe('a');
  });

  it('reports dangling inputs and feedback loops', () => {
    const g = emptyGraph();
    const a = addInstance(g, 'nand', 0, 0);
    const b = addInstance(g, 'nand', 0, 60);
    connect(g, { inst: b.id, port: 'out' }, { inst: a.id, port: 'a' });
    connect(g, { inst: a.id, port: 'out' }, { inst: b.id, port: 'a' });
    const codes = validateGraph(g, registry).map((i) => i.code);
    expect(codes).toContain('feedback-loop');
    expect(codes).toContain('dangling-input');
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `pnpm test test/core/graph.test.ts`
Expected: FAIL — 无法解析 `../../src/core/graph`

- [ ] **Step 3: 实现 `src/core/graph.ts`**

```ts
import type { PinDef, Registry } from './registry';

export interface Instance {
  readonly id: string;
  readonly def: string;
  x: number;
  y: number;
  rot: 0 | 1 | 2 | 3;
  readonly params: Record<string, number>;
}

export interface WireEnd {
  readonly inst: string;
  readonly port: string;
}

export interface Wire {
  readonly id: string;
  readonly from: WireEnd;
  readonly to: WireEnd;
}

export interface CustomComponentDef {
  readonly id: string;
  readonly name: { zh: string; en: string };
  readonly inputs: readonly PinDef[];
  readonly outputs: readonly PinDef[];
  readonly body: Graph;
}

export interface Graph {
  level?: string;
  instances: Instance[];
  wires: Wire[];
  customComponents: CustomComponentDef[];
}

export type IssueCode =
  | 'unknown-def'
  | 'unknown-instance'
  | 'unknown-port'
  | 'multiple-drivers'
  | 'dangling-input'
  | 'feedback-loop';

export interface GraphIssue {
  readonly severity: 'error' | 'warning';
  readonly code: IssueCode;
  readonly message: { zh: string; en: string };
  readonly inst?: string;
  readonly port?: string;
}

export function emptyGraph(level?: string): Graph {
  const g: Graph = { instances: [], wires: [], customComponents: [] };
  if (level !== undefined) g.level = level;
  return g;
}

export function nextId(prefix: string, existing: readonly { id: string }[]): string {
  let max = 0;
  for (const item of existing) {
    const m = /^(\d+)$/.exec(item.id.slice(prefix.length));
    if (item.id.startsWith(prefix) && m) max = Math.max(max, Number(m[1]));
  }
  return `${prefix}${max + 1}`;
}

export function addInstance(g: Graph, def: string, x: number, y: number, id?: string): Instance {
  const inst: Instance = {
    id: id ?? nextId('i', g.instances),
    def,
    x,
    y,
    rot: 0,
    params: {},
  };
  g.instances.push(inst);
  return inst;
}

export function removeInstance(g: Graph, id: string): void {
  g.instances = g.instances.filter((i) => i.id !== id);
  g.wires = g.wires.filter((w) => w.from.inst !== id && w.to.inst !== id);
}

export function connect(g: Graph, from: WireEnd, to: WireEnd, id?: string): Wire {
  const wire: Wire = { id: id ?? nextId('w', g.wires), from, to };
  g.wires.push(wire);
  return wire;
}

export function disconnect(g: Graph, wireId: string): void {
  g.wires = g.wires.filter((w) => w.id !== wireId);
}

export function cloneGraph(g: Graph): Graph {
  const copy: Graph = {
    instances: g.instances.map((i) => ({ ...i, params: { ...i.params } })),
    wires: g.wires.map((w) => ({ ...w, from: { ...w.from }, to: { ...w.to } })),
    customComponents: g.customComponents.map((c) => ({
      id: c.id,
      name: { ...c.name },
      inputs: c.inputs.map((p) => ({ ...p })),
      outputs: c.outputs.map((p) => ({ ...p })),
      body: cloneGraph(c.body),
    })),
  };
  if (g.level !== undefined) copy.level = g.level;
  return copy;
}
```

`validateGraph` 的实现放在同一文件：

```ts
function pinIds(pins: readonly PinDef[]): Set<string> {
  return new Set(pins.map((p) => p.id));
}

export function validateGraph(g: Graph, registry: Registry): GraphIssue[] {
  const issues: GraphIssue[] = [];
  const byId = new Map<string, Instance>();
  for (const inst of g.instances) byId.set(inst.id, inst);

  /** output pins that are driven, per instance */
  const driverCount = new Map<string, number>();

  const defOf = (inst: Instance) => {
    if (registry.has(inst.def)) return registry.get(inst.def);
    issues.push({
      severity: 'error',
      code: 'unknown-def',
      inst: inst.id,
      message: { zh: `未知元件类型：${inst.def}`, en: `Unknown component type: ${inst.def}` },
    });
    return null;
  };

  const defs = new Map<string, ReturnType<Registry['get']> | null>();
  for (const inst of g.instances) defs.set(inst.id, defOf(inst));

  const drivenInputs = new Map<string, string[]>();
  for (const wire of g.wires) {
    const fromInst = byId.get(wire.from.inst);
    const toInst = byId.get(wire.to.inst);
    if (!fromInst || !toInst) {
      issues.push({
        severity: 'error',
        code: 'unknown-instance',
        message: {
          zh: `导线 ${wire.id} 指向不存在的元件`,
          en: `Wire ${wire.id} points at a missing instance`,
        },
      });
      continue;
    }
    const fromDef = defs.get(fromInst.id);
    const toDef = defs.get(toInst.id);
    if (fromDef && !pinIds(fromDef.outputs).has(wire.from.port)) {
      issues.push({
        severity: 'error',
        code: 'unknown-port',
        inst: fromInst.id,
        port: wire.from.port,
        message: {
          zh: `${fromDef.name.zh} 没有输出引脚 ${wire.from.port}`,
          en: `${fromDef.name.en} has no output pin ${wire.from.port}`,
        },
      });
      continue;
    }
    if (toDef && !pinIds(toDef.inputs).has(wire.to.port)) {
      issues.push({
        severity: 'error',
        code: 'unknown-port',
        inst: toInst.id,
        port: wire.to.port,
        message: {
          zh: `${toDef.name.zh} 没有输入引脚 ${wire.to.port}`,
          en: `${toDef.name.en} has no input pin ${wire.to.port}`,
        },
      });
      continue;
    }
    const key = `${toInst.id}.${wire.to.port}`;
    const list = drivenInputs.get(key) ?? [];
    list.push(wire.id);
    drivenInputs.set(key, list);
    const outKey = `${fromInst.id}.${wire.from.port}`;
    driverCount.set(outKey, (driverCount.get(outKey) ?? 0) + 1);
  }

  for (const [key, wires] of drivenInputs) {
    if (wires.length > 1) {
      const [instId, port] = key.split('.') as [string, string];
      issues.push({
        severity: 'error',
        code: 'multiple-drivers',
        inst: instId,
        port,
        message: {
          zh: `输入引脚 ${port} 被 ${wires.length} 根导线同时驱动`,
          en: `Input pin ${port} is driven by ${wires.length} wires`,
        },
      });
    }
  }

  // dangling inputs + feedback loops (iterative DFS over instance graph)
  const adjacency = new Map<string, string[]>();
  for (const inst of g.instances) adjacency.set(inst.id, []);
  for (const wire of g.wires) {
    if (byId.has(wire.from.inst) && byId.has(wire.to.inst)) {
      adjacency.get(wire.from.inst)!.push(wire.to.inst);
    }
  }
  const WHITE = 0;
  const GREY = 1;
  const BLACK = 2;
  const color = new Map<string, number>();
  for (const inst of g.instances) color.set(inst.id, WHITE);
  const loopNodes = new Set<string>();
  for (const root of g.instances) {
    if (color.get(root.id) !== WHITE) continue;
    const stack: Array<{ id: string; next: number }> = [{ id: root.id, next: 0 }];
    color.set(root.id, GREY);
    while (stack.length > 0) {
      const frame = stack[stack.length - 1]!;
      const neighbours = adjacency.get(frame.id)!;
      if (frame.next < neighbours.length) {
        const nb = neighbours[frame.next]!;
        frame.next += 1;
        const c = color.get(nb);
        if (c === WHITE) {
          color.set(nb, GREY);
          stack.push({ id: nb, next: 0 });
        } else if (c === GREY) {
          loopNodes.add(nb);
          loopNodes.add(frame.id);
        }
      } else {
        color.set(frame.id, BLACK);
        stack.pop();
      }
    }
  }
  if (loopNodes.size > 0) {
    issues.push({
      severity: 'warning',
      code: 'feedback-loop',
      message: {
        zh: '电路中存在反馈回路；若其中没有存储元件，仿真将无法稳定',
        en: 'The circuit has a feedback loop; without a storage element in it the simulation cannot settle',
      },
    });
  }

  for (const inst of g.instances) {
    const def = defs.get(inst.id);
    if (!def) continue;
    for (const pin of def.inputs) {
      if (!drivenInputs.has(`${inst.id}.${pin.id}`)) {
        issues.push({
          severity: 'warning',
          code: 'dangling-input',
          inst: inst.id,
          port: pin.id,
          message: {
            zh: `${def.name.zh} 的输入引脚 ${pin.id} 未接线（默认读取 0）`,
            en: `Input pin ${pin.id} of ${def.name.en} is not wired (reads 0)`,
          },
        });
      }
    }
  }

  return issues;
}
```

> `driverCount` 目前只在 `validateGraph` 内累计、未产生 issue（多驱动已由 `drivenInputs` 捕获）。保留它是为了让「一个输出驱动多个输入」这条合法路径有显式记录，后续做扇出限制时直接用它。TS 的 `noUnusedLocals` 未开启，因此不会报错。

- [ ] **Step 4: 运行测试，确认通过**

Run: `pnpm test test/core/graph.test.ts`
Expected: PASS — 10 passed

- [ ] **Step 5: 提交**

```bash
git add src/core/graph.ts test/core/graph.test.ts
git commit -m "feat(core): add editable circuit graph model and validator"
```

---

## Task 5: 展开与仿真内核（core/net.ts、core/errors.ts）

**Files:**
- Create: `src/core/net.ts`, `src/core/errors.ts`
- Test: `test/core/net.test.ts`

**Interfaces:**
- Consumes: `Graph`（Task 4）、`Registry`/`ComponentDef`（Task 3）、`SignalTable`/`PortValue`（Task 2）
- Produces:
  - `class UnstableCircuitError extends Error { readonly iterations: number; readonly blame: readonly string[] }`
  - `class CircuitValidationError extends Error { readonly issues: readonly GraphIssue[] }`
  - `interface Netlist { readonly instanceCount: number; readonly expandedCount: number; readonly slotCount: number; readonly drive: Int32Array; readonly refs: Map<string, string>; instanceDefs(): readonly string[] }`
  - `function compile(graph: Graph, registry: Registry): Netlist`
  - `interface SettleReport { readonly iterations: number; readonly stable: boolean }`
  - `class Simulation { constructor(net: Netlist, registry: Registry); reset(): void; settle(): SettleReport; tick(): SettleReport; read(base: number, width: number): PortValue; write(base: number, width: number, v: PortValue): void; readonly tickCount: number; readonly net: Netlist }`
  - `function delayOf(graph: Graph, registry: Registry): number`

- [ ] **Step 1: 写 `src/core/errors.ts`**

```ts
import type { GraphIssue } from './graph';

export class UnstableCircuitError extends Error {
  readonly iterations: number;
  readonly blame: readonly string[];

  constructor(iterations: number, blame: readonly string[]) {
    super(
      `circuit did not settle after ${iterations} iterations (combinational feedback loop)`,
    );
    this.name = 'UnstableCircuitError';
    this.iterations = iterations;
    this.blame = blame;
  }
}

export class CircuitValidationError extends Error {
  readonly issues: readonly GraphIssue[];

  constructor(issues: readonly GraphIssue[]) {
    super(`circuit is invalid: ${issues.map((i) => i.code).join(', ')}`);
    this.name = 'CircuitValidationError';
    this.issues = issues;
  }
}
```

- [ ] **Step 2: 写失败测试 `test/core/net.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { addInstance, connect, emptyGraph, type Graph } from '../../src/core/graph';
import { BASE_DEFS } from '../../src/core/defs/index';
import { createRegistry } from '../../src/core/registry';
import { UnstableCircuitError } from '../../src/core/errors';
import { Simulation, compile, delayOf } from '../../src/core/net';

const registry = createRegistry(BASE_DEFS);

/** Builds a NAND whose inputs are exposed as level inputs a/b and a level output. */
function nandFixture(): {
  graph: Graph;
  inA: { inst: string; port: string };
  inB: { inst: string; port: string };
  out: { inst: string; port: string };
} {
  const g = emptyGraph();
  const a = addInstance(g, 'nand', 0, 0);
  return {
    graph: g,
    inA: { inst: a.id, port: 'a' },
    inB: { inst: a.id, port: 'b' },
    out: { inst: a.id, port: 'out' },
  };
}

describe('compile', () => {
  it('allocates one slot per bit of every pin', () => {
    const { graph } = nandFixture();
    const net = compile(graph, registry);
    expect(net.instanceCount).toBe(1);
    // 2 inputs + 1 output
    expect(net.slotCount).toBe(3);
  });

  it('records the origin instance of every expanded instance', () => {
    const { graph } = nandFixture();
    const net = compile(graph, registry);
    expect([...net.refs.values()]).toEqual([graph.instances[0]!.id]);
  });

  it('rejects invalid graphs', () => {
    const g = emptyGraph();
    addInstance(g, 'nope', 0, 0);
    expect(() => compile(g, registry)).toThrow(/invalid/i);
  });
});

describe('Simulation', () => {
  it('evaluates a NAND for every input combination', () => {
    const { graph, inA, inB, out } = nandFixture();
    const net = compile(graph, registry);
    const sim = new Simulation(net, registry);
    const slotOf = (end: { inst: string; port: string }): number => {
      for (const [slotKey, instId] of net.refs) {
        if (instId === end.inst) {
          const inst = graph.instances.find((i) => i.id === instId)!;
          if (inst) {
            const def = registry.get(inst.def);
            const inputs = def.inputs.map((p) => p.id);
            const idx = inputs.indexOf(end.port);
            if (idx >= 0) return net.inputBase(slotKey as never) + idx;
          }
        }
      }
      throw new Error('slot not found');
    };
    expect(slotOf).toBeDefined();
    expect(out).toBeDefined();
  });
});
```

> 上面的测试暴露了一个真实的设计缺口：内核需要**按引脚名寻址槽位**的公开方法，否则使用方只能自己去猜槽位编号。补上它，而不是在测试里绕路。

- [ ] **Step 3: 运行测试，确认失败**

Run: `pnpm test test/core/net.test.ts`
Expected: FAIL — 无法解析 `../../src/core/net`

- [ ] **Step 4: 实现 `src/core/net.ts`**

```ts
import { CircuitValidationError, UnstableCircuitError } from './errors';
import { validateGraph, type Graph, type GraphIssue } from './graph';
import { createSignalTable, type PortValue, type SignalTable } from './signal';
import type { ComponentDef, Registry } from './registry';

/** Iteration cap for the settle loop. A combinational loop exhausts it. */
export const SETTLE_LIMIT = 512;

export interface Netlist {
  readonly instanceCount: number;
  readonly slotCount: number;
  readonly drive: Int32Array;
  readonly refs: Map<string, string>;
  /** Slot base of an input pin, addressed by `"<instId>.<pinId>"`. */
  inputBase(key: string): number;
  /** Slot base of an output pin, addressed by `"<instId>.<pinId>"`. */
  outputBase(key: string): number;
  /** Expanded instance ids in evaluation order. */
  instanceIds(): readonly string[];
  /** `"<instId>.<pinId>"` keys that are exposed as level outputs. */
  outputKeys(): readonly string[];
}

interface CompiledInstance {
  readonly key: string;
  readonly origin: string;
  readonly def: ComponentDef;
  readonly inputs: readonly number[];
  readonly outputs: readonly number[];
}

export function compile(graph: Graph, registry: Registry): Netlist {
  const errors: GraphIssue[] = validateGraph(graph, registry).filter(
    (i) => i.severity === 'error',
  );
  if (errors.length > 0) throw new CircuitValidationError(errors);

  const table = createSignalTable();
  const instances: CompiledInstance[] = [];
  const refs = new Map<string, string>();
  const inputBases = new Map<string, number>();
  const outputBases = new Map<string, number>();

  for (const inst of graph.instances) {
    const def = registry.get(inst.def);
    const inputs = def.inputs.map((pin) => {
      const base = table.alloc(pin.width);
      inputBases.set(`${inst.id}.${pin.id}`, base);
      return base;
    });
    const outputs = def.outputs.map((pin) => {
      const base = table.alloc(pin.width);
      outputBases.set(`${inst.id}.${pin.id}`, base);
      return base;
    });
    for (const out of outputs) table.setBit(out, 0);
    const key = inst.id;
    refs.set(key, inst.id);
    instances.push({ key, origin: inst.id, def, inputs, outputs });
  }

  // Wire resolution: every input pin reads from the slot that drives it.
  const drive = new Int32Array(table.size);
  // by default, an input reads from a dedicated zero slot
  const zeroSlot = table.alloc(1);
  table.setBit(zeroSlot, 0);
  drive.fill(zeroSlot);
  for (const wire of graph.wires) {
    const fromBase = outputBases.get(`${wire.from.inst}.${wire.from.port}`);
    const toBase = inputBases.get(`${wire.to.inst}.${wire.to.port}`);
    if (fromBase === undefined || toBase === undefined) continue;
    const fromDef = registry.get(graph.instances.find((i) => i.id === wire.from.inst)!.def);
    const toDef = registry.get(graph.instances.find((i) => i.id === wire.to.inst)!.def);
    const fromPin = fromDef.outputs.find((p) => p.id === wire.from.port)!;
    const toPin = toDef.inputs.find((p) => p.id === wire.to.port)!;
    const width = Math.min(fromPin.width, toPin.width);
    for (let i = 0; i < width; i += 1) drive[toBase + i] = fromBase + i;
  }

  const instanceIds = instances.map((i) => i.key);
  const net: Netlist = {
    instanceCount: instances.length,
    slotCount: table.size,
    drive,
    refs,
    inputBase: (key) => {
      const base = inputBases.get(key);
      if (base === undefined) throw new Error(`no such input pin: ${key}`);
      return base;
    },
    outputBase: (key) => {
      const base = outputBases.get(key);
      if (base === undefined) throw new Error(`no such output pin: ${key}`);
      return base;
    },
    instanceIds: () => instanceIds,
    outputKeys: () => [...outputBases.keys()],
  };

  // stash the compiled data on a non-enumerable field for Simulation
  Object.defineProperty(net, INTERNAL, { value: { table, instances } });
  return net;
}

const INTERNAL = Symbol('tc.net.internal');

interface NetInternals {
  table: SignalTable;
  instances: CompiledInstance[];
}

function internalsOf(net: Netlist): NetInternals {
  const found = (net as unknown as Record<symbol, NetInternals | undefined>)[INTERNAL];
  if (!found) throw new Error('netlist was not produced by compile()');
  return found;
}

export interface SettleReport {
  readonly iterations: number;
  readonly stable: boolean;
}

export class Simulation {
  readonly net: Netlist;
  readonly #registry: Registry;
  readonly #table: SignalTable;
  readonly #instances: readonly CompiledInstance[];
  readonly #state: Uint8Array[];
  #tickCount = 0;

  constructor(net: Netlist, registry: Registry) {
    const { table, instances } = internalsOf(net);
    this.net = net;
    this.#registry = registry;
    this.#table = table;
    this.#instances = instances;
    this.#state = instances.map((i) => new Uint8Array(i.def.stateBytes));
  }

  get tickCount(): number {
    return this.#tickCount;
  }

  reset(): void {
    this.#table.clear();
    for (const s of this.#state) s.fill(0);
    this.#tickCount = 0;
    this.#publishState();
    this.settle();
  }

  /** Publishes storage-element outputs from their private state. */
  #publishState(): void {
    for (let i = 0; i < this.#instances.length; i += 1) {
      const inst = this.#instances[i]!;
      if (!inst.def.sequential) continue;
      const state = this.#state[i]!;
      for (let p = 0; p < inst.outputs.length; p += 1) {
        this.#table.setBit(inst.outputs[p]!, state[p] === 1 ? 1 : 0);
      }
    }
  }

  /** Reads an input pin through its driver, writing into a scratch list. */
  #readInputs(inst: CompiledInstance, scratch: PortValue[]): void {
    for (let p = 0; p < inst.inputs.length; p += 1) {
      const base = inst.inputs[p]!;
      const width = inst.def.inputs[p]!.width;
      const driven = this.net.drive[base]!;
      scratch[p] = this.#table.getPort(driven, width);
    }
  }

  settle(): SettleReport {
    const scratch: PortValue[] = [];
    const out: PortValue[] = [];
    for (let iter = 0; iter < SETTLE_LIMIT; iter += 1) {
      let changed = false;
      // Unlike an earlier draft, this does NOT skip sequential defs. A storage
      // element's evaluate() republishes the value it is holding (and ignores
      // its inputs), so evaluating it is a no-op once the kernel has published
      // its state -- and skipping it would be wrong for any def that publishes
      // from state on its own schedule.
      for (let index = 0; index < this.#instances.length; index += 1) {
        const inst = this.#instances[index]!;
        if (!inst.def.evaluate) continue;
        this.#readInputs(inst, scratch);
        out.length = 0;
        inst.def.evaluate(scratch, out, this.#state[index], { tick: this.#tickCount });
        for (let p = 0; p < inst.outputs.length; p += 1) {
          const base = inst.outputs[p]!;
          const width = inst.def.outputs[p]!.width;
          const next = out[p] ?? 0;
          const prev = this.#table.getPort(base, width);
          if (!portsEqual(prev, next)) {
            this.#table.setPort(base, width, next);
            changed = true;
          }
        }
      }
      if (!changed) return { iterations: iter + 1, stable: true };
    }
    const blame = this.#instances.map((i) => i.origin);
    throw new UnstableCircuitError(SETTLE_LIMIT, blame);
  }

  tick(): SettleReport {
    this.#tickCount += 1;
    // 1. snapshot pre-edge inputs for every storage element
    const pending: Array<{ index: number; inputs: PortValue[] }> = [];
    const scratch: PortValue[] = [];
    for (let i = 0; i < this.#instances.length; i += 1) {
      const inst = this.#instances[i]!;
      if (!inst.def.sequential || !inst.def.clockEdge) continue;
      this.#readInputs(inst, scratch);
      pending.push({ index: i, inputs: [...scratch] });
    }
    // 2. apply the edge using the snapshotted inputs
    for (const { index, inputs } of pending) {
      const inst = this.#instances[index]!;
      const out: PortValue[] = [];
      inst.def.clockEdge!(inputs, out, this.#state[index]!, { tick: this.#tickCount });
    }
    // 3. publish new state, then let combinational logic settle
    this.#publishState();
    return this.settle();
  }

  read(base: number, width: number): PortValue {
    return this.#table.getPort(base, width);
  }

  write(base: number, width: number, v: PortValue): void {
    this.#table.setPort(base, width, v);
  }
}

function portsEqual(a: PortValue, b: PortValue): boolean {
  if (typeof a === 'number' && typeof b === 'number') return a === b;
  const ab = typeof a === 'number' ? [a] : Array.from(a);
  const bb = typeof b === 'number' ? [b] : Array.from(b);
  if (ab.length !== bb.length) return false;
  for (let i = 0; i < ab.length; i += 1) if (ab[i] !== bb[i]) return false;
  return true;
}

/**
 * Longest combinational path, counted in base-gate delays.
 *
 * Linear-time DAG longest path: topological order via Kahn's algorithm, then a
 * single relaxation pass. A path-walk version would be exponential on diamond
 * shaped circuits (2^n paths), which realistic CPU circuits are full of.
 *
 * Sequential elements are sources of their own output and sinks for their
 * input, so they break the combinational path and contribute no delay.
 */
export function delayOf(graph: Graph, registry: Registry): number {
  const index = new Map<string, number>();
  graph.instances.forEach((inst, i) => index.set(inst.id, i));
  const count = graph.instances.length;
  const outgoing: number[][] = Array.from({ length: count }, () => []);
  const inDegree = new Int32Array(count);

  for (const wire of graph.wires) {
    const from = index.get(wire.from.inst);
    const to = index.get(wire.to.inst);
    if (from === undefined || to === undefined) continue;
    outgoing[from]!.push(to);
    inDegree[to] += 1;
  }

  // delay[i] = longest combinational delay arriving at instance i's OUTPUT,
  // treating instance i as a source (0) when it arrives with no contributions.
  const delay = new Int32Array(count);
  const queue: number[] = [];
  for (let i = 0; i < count; i += 1) {
    if (inDegree[i] === 0) {
      delay[i] = graph.instances[i]!.def && registry.get(graph.instances[i]!.def).sequential
        ? 0
        : registry.get(graph.instances[i]!.def).cost;
      queue.push(i);
    }
  }

  const seen = new Int32Array(count);
  let longest = 0;
  let head = 0;
  while (head < queue.length) {
    const i = queue[head]!;
    head += 1;
    if (delay[i]! > longest) longest = delay[i]!;
    const def = registry.get(graph.instances[i]!.def);
    for (const j of outgoing[i]!) {
      seen[j] += 1;
      const jDef = registry.get(graph.instances[j]!.def);
      // If the *source* is sequential its output is a fresh source, so the
      // arriving path counts as 0. Otherwise add this gate's own cost.
      const candidate = def.sequential ? jDef.cost : delay[i]! + jDef.cost;
      if (candidate > delay[j]!) delay[j] = candidate;
      if (seen[j] === inDegree[j]) queue.push(j);
    }
  }

  // Unreachable-from-any-source nodes (pure feedback loops) were already
  // rejected by validateGraph; their delay is simply not counted.
  return longest;
}
```

- [ ] **Step 5: 运行测试，确认通过**

Run: `pnpm test test/core/net.test.ts`
Expected: PASS — 3 passed（其余 NAND 组合断言在 Task 6 的 `checks` 测试里覆盖，那里有完整的关卡驱动路径）

- [ ] **Step 6: 补一条真实求值测试，替换掉探测器式断言**

在 `test/core/net.test.ts` 里把 `describe('Simulation')` 整块替换为：

```ts
describe('Simulation', () => {
  it('evaluates a NAND for every input combination', () => {
    const g = emptyGraph();
    const nand = addInstance(g, 'nand', 0, 0);
    const net = compile(g, registry);
    const sim = new Simulation(net, registry);
    const a = net.inputBase(`${nand.id}.a`);
    const b = net.inputBase(`${nand.id}.b`);
    const out = net.outputBase(`${nand.id}.out`);
    for (const [va, vb, want] of [
      [0, 0, 1],
      [0, 1, 1],
      [1, 0, 1],
      [1, 1, 0],
    ] as const) {
      sim.write(a, 1, va);
      sim.write(b, 1, vb);
      sim.settle();
      expect(sim.read(out, 1), `nand(${va},${vb})`).toBe(want);
    }
  });

  it('propagates through a chain of gates in one settle', () => {
    const g = emptyGraph();
    const n1 = addInstance(g, 'nand', 0, 0);
    const n2 = addInstance(g, 'not', 40, 0);
    connect(g, { inst: n1.id, port: 'out' }, { inst: n2.id, port: 'a' });
    const net = compile(g, registry);
    const sim = new Simulation(net, registry);
    sim.write(net.inputBase(`${n1.id}.a`), 1, 1);
    sim.write(net.inputBase(`${n1.id}.b`), 1, 1);
    sim.settle();
    expect(sim.read(net.outputBase(`${n2.id}.out`), 1)).toBe(0); // nand=0, not=1? no: nand(1,1)=0 -> not=1
  });

  it('treats an unwired input as zero', () => {
    const g = emptyGraph();
    const nand = addInstance(g, 'nand', 0, 0);
    const net = compile(g, registry);
    const sim = new Simulation(net, registry);
    sim.settle();
    // nand(0,0) = 1
    expect(sim.read(net.outputBase(`${nand.id}.out`), 1)).toBe(1);
  });

  it('throws UnstableCircuitError for a combinational feedback loop', () => {
    const g = emptyGraph();
    const n1 = addInstance(g, 'nand', 0, 0);
    const n2 = addInstance(g, 'nand', 0, 40);
    connect(g, { inst: n1.id, port: 'out' }, { inst: n2.id, port: 'a' });
    connect(g, { inst: n2.id, port: 'out' }, { inst: n1.id, port: 'a' });
    const net = compile(g, registry);
    const sim = new Simulation(net, registry);
    expect(() => sim.settle()).toThrow(UnstableCircuitError);
  });

  it('settles a delay_line held loop and publishes state on the edge', () => {
    const g = emptyGraph();
    const src = addInstance(g, 'const_on', 0, 0);
    const delay = addInstance(g, 'delay_line', 40, 0);
    connect(g, { inst: src.id, port: 'out' }, { inst: delay.id, port: 'in' });
    const net = compile(g, registry);
    const sim = new Simulation(net, registry);
    const out = net.outputBase(`${delay.id}.out`);
    sim.reset();
    expect(sim.read(out, 1)).toBe(0); // starts empty
    sim.tick();
    expect(sim.read(out, 1)).toBe(1); // one edge later the input has arrived
  });

  it('a delay line holds its sampled value when its input changes', () => {
    // This is the test that pins the storage semantics. The sim's own
    // level-input slot drives the delay line, so the input can be flipped
    // between settles without a clock edge.
    const g = emptyGraph();
    const feed = addInstance(g, 'level_input', 0, 0);
    const delay = addInstance(g, 'delay_line', 40, 0);
    connect(g, { inst: feed.id, port: 'out' }, { inst: delay.id, port: 'in' });
    const net = compile(g, registry);
    const sim = new Simulation(net, registry);
    const feedSlot = net.outputBase(`${feed.id}.out`);
    const out = net.outputBase(`${delay.id}.out`);

    sim.reset();
    sim.write(feedSlot, 1, 1); // raise the input
    sim.settle();
    expect(sim.read(out, 1)).toBe(0); // still holding the old 0: no edge yet

    sim.tick(); // first edge samples the raised input
    expect(sim.read(out, 1)).toBe(1);

    sim.write(feedSlot, 1, 0); // drop the input again
    sim.settle();
    expect(sim.read(out, 1)).toBe(1); // must STILL read 1 until the next edge

    sim.tick(); // second edge samples the dropped input
    expect(sim.read(out, 1)).toBe(0);
  });

  it('reset clears state and the tick counter', () => {
    const g = emptyGraph();
    const src = addInstance(g, 'const_on', 0, 0);
    const delay = addInstance(g, 'delay_line', 40, 0);
    connect(g, { inst: src.id, port: 'out' }, { inst: delay.id, port: 'in' });
    const net = compile(g, registry);
    const sim = new Simulation(net, registry);
    sim.tick();
    expect(sim.tickCount).toBe(1);
    sim.reset();
    expect(sim.tickCount).toBe(0);
    expect(sim.read(net.outputBase(`${delay.id}.out`), 1)).toBe(0);
  });
});
```

> `a delay line holds its sampled value when its input changes` 是**本计划里最重要的一条时序测试**。初版没有它，`delay_line` 的 `evaluate` 就去读当前输入，于是延迟线退化成了直通缓冲器——而所有测试照样全绿，因为唯一那条 delay 测试只用了恒定的 1 作为输入。这条测试用可翻转的 `level_input` 当作驱动器，把「没有时钟沿就不许改输出」钉死。

> 修掉上面 `propagates through a chain` 里的注释错误：`nand(1,1)=0`，`not(0)=1`，期望值是 **1**。实现前先把断言改成 `1` 并删掉行尾错误注释。

- [ ] **Step 7: 运行测试，确认通过**

Run: `pnpm test test/core/net.test.ts`
Expected: PASS — 8 passed

- [ ] **Step 8: 提交**

```bash
git add src/core/errors.ts src/core/net.ts test/core/net.test.ts
git commit -m "feat(core): add netlist compiler and edge-triggered simulator"
```

---

## Task 6: 关卡规格与验证器（levels/spec.ts、levels/checks.ts）

**Files:**
- Create: `src/levels/spec.ts`, `src/levels/checks.ts`
- Test: `test/levels/checks.test.ts`

**Interfaces:**
- Consumes: `Graph`/`Registry`/`Simulation`/`compile`
- Produces:
  - `interface PinSpec { readonly id: string; readonly width: number; readonly label?: { zh: string; en: string } }`
  - `type LevelCheck = TruthTableCheck | ScriptCheck | ConstraintCheck`
  - `interface TruthTableCheck { readonly kind: 'truth-table'; readonly rows?: readonly TruthRow[] }`
  - `interface TruthRow { readonly inputs: Readonly<Record<string, number>>; readonly outputs: Readonly<Record<string, number>> }`
  - `interface ScriptCheck { readonly kind: 'script'; readonly steps: readonly ScriptStep[] }`
  - `interface ScriptStep { readonly tick: number; readonly inputs?: Readonly<Record<string, number>>; readonly expect?: Readonly<Record<string, number>> }`
  - `interface ConstraintCheck { readonly kind: 'constraint'; readonly rule: ConstraintRule }`
  - `type ConstraintRule = { kind: 'sum-equals'; inputs: readonly string[]; output: string } | { kind: 'at-least'; inputs: readonly string[]; count: number; output: string }`
  - `interface LevelSpec { id, chapter, index, name, brief, hint, allowedComponents, io: { inputs: PinSpec[]; outputs: PinSpec[] }, checks: LevelCheck[], threeStar?: { gate?; delay?; tick? }, rewards?: { components?: string[] } }`
  - `interface CheckOutcome { readonly passed: boolean; readonly failures: readonly CheckFailure[] }`
  - `interface CheckFailure { readonly check: LevelCheck['kind']; readonly inputs: Readonly<Record<string, number>>; readonly expected: Readonly<Record<string, number>>; readonly actual: Readonly<Record<string, number>>; readonly tick: number }`
  - `function runChecks(graph: Graph, registry: Registry, spec: LevelSpec): CheckOutcome`
  - `function bindLevelIo(sim: Simulation, net: Netlist, spec: LevelSpec): { writeInput(name: string, v: number): void; readOutput(name: string): number }`
  - `function countTicksUsed(graph: Graph, registry: Registry, spec: LevelSpec): number`

> **关卡 I/O 的接线约定**：关卡定义 `inputs`/`outputs` 之后，编辑器会给电路里的引脚**按名字**绑定：任何一个实例的输入引脚 `p` 与关卡输入同名即视为被驱动；任何一个实例的输出引脚 `p` 与关卡输出同名即视为关卡输出。这条约定让关卡无需额外的 `level_input` 组件，也保证验签器可以用同一个函数处理所有关卡。**用测试锁死它。**

- [ ] **Step 1: 写失败测试 `test/levels/checks.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { addInstance, connect, emptyGraph } from '../../src/core/graph';
import { BASE_DEFS } from '../../src/core/defs/index';
import { createRegistry } from '../../src/core/registry';
import type { LevelSpec } from '../../src/levels/spec';
import { runChecks } from '../../src/levels/checks';

const registry = createRegistry(BASE_DEFS);

/** The truth table for AND. Level data is explicit; nothing is inferred. */
const AND_ROWS = [
  { inputs: { a: 0, b: 0 }, outputs: { out: 0 } },
  { inputs: { a: 0, b: 1 }, outputs: { out: 0 } },
  { inputs: { a: 1, b: 0 }, outputs: { out: 0 } },
  { inputs: { a: 1, b: 1 }, outputs: { out: 1 } },
] as const;

const andSpec: LevelSpec = {
  id: 'test-and',
  chapter: 1,
  index: 1,
  name: { zh: '测试与门', en: 'Test AND' },
  brief: { zh: '', en: '' },
  hint: { zh: '', en: '' },
  allowedComponents: ['nand', 'not', 'level_input', 'level_output'],
  io: {
    inputs: [
      { id: 'a', width: 1 },
      { id: 'b', width: 1 },
    ],
    outputs: [{ id: 'out', width: 1 }],
  },
  checks: [{ kind: 'truth-table', rows: AND_ROWS }],
};

/** AND built from NAND + NOT, with explicit level input/output connectors. */
function andSolution(): ReturnType<typeof emptyGraph> {
  const g = emptyGraph();
  const inA = addInstance(g, 'level_input', 0, 0, 'IN_A');
  const inB = addInstance(g, 'level_input', 0, 60, 'IN_B');
  const nand = addInstance(g, 'nand', 60, 20);
  const not = addInstance(g, 'not', 120, 20);
  const out = addInstance(g, 'level_output', 180, 20, 'OUT');
  connect(g, { inst: inA.id, port: 'out' }, { inst: nand.id, port: 'a' });
  connect(g, { inst: inB.id, port: 'out' }, { inst: nand.id, port: 'b' });
  connect(g, { inst: nand.id, port: 'out' }, { inst: not.id, port: 'a' });
  connect(g, { inst: not.id, port: 'out' }, { inst: out.id, port: 'in' });
  return g;
}

describe('runChecks / truth-table', () => {
  it('fails an empty circuit without throwing', () => {
    const outcome = runChecks(emptyGraph(), registry, andSpec);
    expect(outcome.passed).toBe(false);
    expect(outcome.failures.length).toBeGreaterThan(0);
  });

  it('fails a circuit with an unstable feedback loop without throwing', () => {
    const g = emptyGraph();
    const n1 = addInstance(g, 'nand', 0, 0);
    const n2 = addInstance(g, 'nand', 0, 40);
    connect(g, { inst: n1.id, port: 'out' }, { inst: n2.id, port: 'a' });
    connect(g, { inst: n2.id, port: 'out' }, { inst: n1.id, port: 'a' });
    expect(() => runChecks(g, registry, andSpec)).not.toThrow();
    const outcome = runChecks(g, registry, andSpec);
    expect(outcome.passed).toBe(false);
    expect(outcome.failures.some((f) => f.reason === 'unstable')).toBe(true);
  });

  it('refuses a truth-table check that declares no rows', () => {
    const outcome = runChecks(andSolution(), registry, {
      ...andSpec,
      checks: [{ kind: 'truth-table' }],
    });
    expect(outcome.passed).toBe(false);
    expect(outcome.failures.some((f) => f.reason === 'missing-rows')).toBe(true);
  });
});
```

> 上面 `andSolution()` 里的「重命名引脚」是错的——引脚名由**组件定义**决定，不能靠改 `def` 字段实现。真正的接线约定需要一层**显式的关卡 I/O 绑定**。把测试改成下面的样子，并让实现支持它：

```ts
/** Level I/O is bound by a dedicated connector instance whose ports are named after the level pins. */
function andSolution(): Graph {
  const g = emptyGraph();
  const inA = addInstance(g, 'level_input', 0, 0, 'IN_A');
  const inB = addInstance(g, 'level_input', 0, 60, 'IN_B');
  const nand = addInstance(g, 'nand', 60, 20);
  const not = addInstance(g, 'not', 120, 20);
  const out = addInstance(g, 'level_output', 180, 20, 'OUT');
  connect(g, { inst: inA.id, port: 'out' }, { inst: nand.id, port: 'a' });
  connect(g, { inst: inB.id, port: 'out' }, { inst: nand.id, port: 'b' });
  connect(g, { inst: nand.id, port: 'out' }, { inst: not.id, port: 'a' });
  connect(g, { inst: not.id, port: 'out' }, { inst: out.id, port: 'in' });
  return g;
}
```

> **关卡绑定的算法**（`level_input` / `level_output` 两个元件已经在 Task 3 的 `BASE_DEFS` 里定义好了，这里只需要用）：**实例 id 形如 `IN_<引脚名>` 的 `level_input` 实例即是该关卡输入；实例 id 为 `OUT` 的 `level_output` 实例即单输出关卡的输出（多输出时 id 为 `OUT_<引脚名>`）。** 这条规则简单、可见、可测，而且在画板上直接显示为引脚名。
>
> 注意 `andSolution()` 里用的 `addInstance(g, 'level_input', 0, 0, 'IN_A')` 第四参数是显式 id——`build()` 夹具（Task 8）会替玩家自动生成这些 id，但测试里手写时必须自己写对。

- [ ] **Step 2: 运行测试，确认失败**

Run: `pnpm test test/levels/checks.test.ts`
Expected: FAIL — 无法解析 `../../src/levels/spec`

- [ ] **Step 3: 实现 `src/levels/spec.ts`**

```ts
export interface LocalizedText {
  readonly zh: string;
  readonly en: string;
}

export interface PinSpec {
  readonly id: string;
  readonly width: number;
  readonly label?: LocalizedText;
}

export interface TruthRow {
  readonly inputs: Readonly<Record<string, number>>;
  readonly outputs: Readonly<Record<string, number>>;
}

export interface TruthTableCheck {
  readonly kind: 'truth-table';
  /** Omitted means "exhaustively enumerate every input combination". */
  readonly rows?: readonly TruthRow[];
}

export interface ScriptStep {
  readonly tick: number;
  readonly inputs?: Readonly<Record<string, number>>;
  readonly expect?: Readonly<Record<string, number>>;
}

export interface ScriptCheck {
  readonly kind: 'script';
  readonly steps: readonly ScriptStep[];
}

export type ConstraintRule =
  | { readonly kind: 'sum-equals'; readonly inputs: readonly string[]; readonly output: string }
  | {
      readonly kind: 'at-least';
      readonly inputs: readonly string[];
      readonly count: number;
      readonly output: string;
    };

export interface ConstraintCheck {
  readonly kind: 'constraint';
  readonly rule: ConstraintRule;
}

export type LevelCheck = TruthTableCheck | ScriptCheck | ConstraintCheck;

export interface LevelSpec {
  readonly id: string;
  readonly chapter: number;
  readonly index: number;
  readonly name: LocalizedText;
  readonly brief: LocalizedText;
  readonly hint: LocalizedText;
  readonly allowedComponents: readonly string[];
  readonly io: {
    readonly inputs: readonly PinSpec[];
    readonly outputs: readonly PinSpec[];
  };
  readonly checks: readonly LevelCheck[];
  readonly threeStar?: {
    readonly gate?: number;
    readonly delay?: number;
    readonly tick?: number;
  };
  readonly rewards?: { readonly components?: readonly string[] };
}

export interface CheckFailure {
  readonly check: LevelCheck['kind'];
  readonly inputs: Readonly<Record<string, number>>;
  readonly expected: Readonly<Record<string, number>>;
  readonly actual: Readonly<Record<string, number>>;
  readonly tick: number;
  readonly reason?:
    | 'mismatch'
    | 'unstable'
    | 'invalid'
    | 'missing-io'
    | 'missing-rows';
}

export interface CheckOutcome {
  readonly passed: boolean;
  readonly failures: readonly CheckFailure[];
  readonly ticksUsed: number;
}
```

- [ ] **Step 4: 实现 `src/levels/checks.ts`**

```ts
import { CircuitValidationError, UnstableCircuitError } from '../core/errors';
import type { Graph } from '../core/graph';
import { Simulation, compile, type Netlist } from '../core/net';
import type { Registry } from '../core/registry';
import { formatPort, type PortValue } from '../core/signal';
import type {
  CheckFailure,
  CheckOutcome,
  ConstraintRule,
  LevelCheck,
  LevelSpec,
} from './spec';

export interface LevelIo {
  reset(): void;
  writeInput(name: string, value: number): void;
  readOutput(name: string): number;
  tick(): void;
  readonly sim: Simulation;
}

/**
 * Binds a compiled circuit to a level's named pins.
 *
 * Convention: a `level_input` instance whose id is `IN_<pinId>` supplies that
 * level input; a `level_output` instance whose id is `OUT` (single output) or
 * `OUT_<pinId>` (multi-output) mirrors that level output.
 *
 * Widths come from the level spec, so multi-bit level pins work without any
 * special-casing in the caller.
 */
export function bindLevelIo(sim: Simulation, net: Netlist, spec: LevelSpec): LevelIo {
  const inputSlots = new Map<string, { base: number; width: number }>();
  const outputSlots = new Map<string, { base: number; width: number }>();

  for (const pin of spec.io.inputs) {
    try {
      inputSlots.set(pin.id, { base: net.outputBase(`IN_${pin.id}.out`), width: pin.width });
    } catch {
      /* pin not present in this circuit: it will read as 0 */
    }
  }

  const outputPins = spec.io.outputs;
  for (const pin of outputPins) {
    const keys = outputPins.length === 1 ? ['OUT.in'] : [`OUT_${pin.id}.in`, 'OUT.in'];
    for (const key of keys) {
      try {
        outputSlots.set(pin.id, { base: net.inputBase(key), width: pin.width });
        break;
      } catch {
        /* try the next candidate */
      }
    }
  }

  const toNumber = (v: PortValue): number => {
    if (typeof v === 'number') return v;
    return Array.from(v).reduce((acc, byte, i) => acc + byte * 2 ** (8 * i), 0);
  };

  return {
    sim,
    reset: () => sim.reset(),
    tick: () => {
      sim.tick();
    },
    writeInput(name: string, value: number): void {
      const slot = inputSlots.get(name);
      if (!slot) return;
      sim.write(slot.base, slot.width, value);
    },
    readOutput(name: string): number {
      const slot = outputSlots.get(name);
      if (!slot) return 0;
      return toNumber(sim.read(slot.base, slot.width));
    },
  };
}

function enumerateInputs(spec: LevelSpec): Array<Record<string, number>> {
  const bits = spec.io.inputs.reduce((acc, p) => acc + p.width, 0);
  const combos: Array<Record<string, number>> = [];
  const total = 2 ** bits;
  for (let n = 0; n < total; n += 1) {
    const row: Record<string, number> = {};
    let offset = 0;
    for (const pin of spec.io.inputs) {
      const mask = (1 << pin.width) - 1;
      row[pin.id] = (n >>> offset) & mask;
      offset += pin.width;
    }
    combos.push(row);
  }
  return combos;
}

/**
 * Builds the full truth table of a purely combinational level by enumerating
 * every input combination and slicing `expected` into the output pins.
 * The bit layout of `expected` must match the order of `alwaysOn.outputs`.
 */
export function generateRows(
  alwaysOn: LevelSpec,
  expected: (inputs: Record<string, number>) => number,
): Array<{ inputs: Record<string, number>; outputs: Record<string, number> }> {
  return enumerateInputs(alwaysOn).map((inputs) => {
    const value = expected(inputs) >>> 0;
    const outputs: Record<string, number> = {};
    let offset = 0;
    for (const pin of alwaysOn.io.outputs) {
      const mask = (1 << pin.width) - 1;
      outputs[pin.id] = (value >>> offset) & mask;
      offset += pin.width;
    }
    return { inputs, outputs };
  });
}

function evaluateRule(rule: ConstraintRule, inputs: Record<string, number>): number {
  if (rule.kind === 'sum-equals') {
    let sum = 0;
    for (const id of rule.inputs) sum += inputs[id] ?? 0;
    return sum;
  }
  let count = 0;
  for (const id of rule.inputs) count += inputs[id] ?? 0;
  return count >= rule.count ? 1 : 0;
}

export function runChecks(graph: Graph, registry: Registry, spec: LevelSpec): CheckOutcome {
  const failures: CheckFailure[] = [];
  let ticksUsed = 0;

  for (const check of spec.checks) {
    // One compilation and one Simulation per check, reused for every row.
    // Compiling per row would re-run validateGraph and reallocate the signal
    // table hundreds of times for a single level.
    const created = createSim(graph, registry, spec);
    if ('error' in created) {
      failures.push(failure(check, {}, {}, {}, 0, created.error));
      continue;
    }
    const io = created.io;

    try {
      if (check.kind === 'truth-table') {
        if (!check.rows || check.rows.length === 0) {
          // A truth-table check with nothing to compare against would pass
          // every circuit ever built. Refuse it loudly instead.
          failures.push(
            failure(
              check,
              {},
              { rows: 1 },
              { rows: 0 },
              0,
              'missing-rows',
            ),
          );
          continue;
        }
        for (const row of check.rows) {
          const attempt = runRow(io, spec, row.inputs, 0);
          ticksUsed = Math.max(ticksUsed, attempt.ticksUsed);
          if (compare(row.outputs, attempt.outputs)) {
            failures.push(failure(check, row.inputs, row.outputs, attempt.outputs, 0, 'mismatch'));
          }
        }
        continue;
      }

      if (check.kind === 'constraint') {
        for (const inputs of enumerateInputs(spec)) {
          const attempt = runRow(io, spec, inputs, 0);
          ticksUsed = Math.max(ticksUsed, attempt.ticksUsed);
          const want = evaluateRule(check.rule, inputs);
          const got = attempt.outputs[check.rule.output] ?? 0;
          if (want !== got) {
            failures.push(
              failure(check, inputs, { [check.rule.output]: want }, attempt.outputs, 0, 'mismatch'),
            );
          }
        }
        continue;
      }

      // script: walk the steps in tick order, driving inputs along the way
      io.reset();
      ticksUsed = Math.max(ticksUsed, io.sim.tickCount);
      const steps = [...check.steps].sort((a, b) => a.tick - b.tick);
      for (const step of steps) {
        for (const pin of spec.io.inputs) {
          io.writeInput(pin.id, step.inputs?.[pin.id] ?? 0);
        }
        io.sim.settle();
        while (io.sim.tickCount < step.tick) io.tick();
        ticksUsed = Math.max(ticksUsed, io.sim.tickCount);
        if (step.expect) {
          const actual: Record<string, number> = {};
          for (const pin of spec.io.outputs) actual[pin.id] = io.readOutput(pin.id);
          if (compare(step.expect, actual)) {
            failures.push(
              failure(check, step.inputs ?? {}, step.expect, actual, step.tick, 'mismatch'),
            );
          }
        }
      }
    } catch (e) {
      if (e instanceof UnstableCircuitError) {
        failures.push(failure(check, {}, {}, {}, io.sim.tickCount, 'unstable'));
      } else if (e instanceof CircuitValidationError) {
        failures.push(failure(check, {}, {}, {}, io.sim.tickCount, 'invalid'));
      } else {
        throw e;
      }
    }
  }

  return { passed: failures.length === 0, failures, ticksUsed };
}

/** Drives one input vector into a fresh reset of an already-compiled circuit. */
function runRow(
  io: LevelIo,
  spec: LevelSpec,
  inputs: Readonly<Record<string, number>>,
  ticks: number,
): AttemptOk {
  io.reset();
  for (const pin of spec.io.inputs) io.writeInput(pin.id, inputs[pin.id] ?? 0);
  io.sim.settle();
  for (let i = 0; i < ticks; i += 1) io.tick();
  const outputs: Record<string, number> = {};
  for (const pin of spec.io.outputs) outputs[pin.id] = io.readOutput(pin.id);
  return { outputs, ticksUsed: io.sim.tickCount };
}

function compare(
  expected: Readonly<Record<string, number>>,
  actual: Readonly<Record<string, number>>,
): boolean {
  for (const [key, want] of Object.entries(expected)) {
    if ((actual[key] ?? 0) !== want) return true;
  }
  return false;
}

function failure(
  check: LevelCheck,
  inputs: Readonly<Record<string, number>>,
  expected: Readonly<Record<string, number>>,
  actual: Readonly<Record<string, number>>,
  tick: number,
  reason: CheckFailure['reason'],
): CheckFailure {
  return { check: check.kind, inputs, expected, actual, tick, reason };
}

interface AttemptFail {
  error: 'unstable' | 'invalid' | 'missing-io';
}

interface AttemptOk {
  outputs: Record<string, number>;
  ticksUsed: number;
}

function createSim(
  graph: Graph,
  registry: Registry,
  spec: LevelSpec,
): { io: LevelIo } | AttemptFail {
  try {
    const net = compile(graph, registry);
    const sim = new Simulation(net, registry);
    const io = bindLevelIo(sim, net, spec);
    return { io };
  } catch (e) {
    if (e instanceof UnstableCircuitError) return { error: 'unstable' };
    if (e instanceof CircuitValidationError) return { error: 'invalid' };
    throw e;
  }
}

export function countTicksUsed(graph: Graph, registry: Registry, spec: LevelSpec): number {
  return runChecks(graph, registry, spec).ticksUsed;
}

export { formatPort };
```

- [ ] **Step 5: 运行测试，确认通过**

Run: `pnpm test test/levels/checks.test.ts`
Expected: PASS — 2 passed

- [ ] **Step 6: 补齐判定力测试（正例必须过、反例必须挂）**

追加到 `test/levels/checks.test.ts`：

```ts
describe('truth-table discrimination', () => {
  it('passes the or-of-nands-with-inverters solution (NOR-as-AND is wrong, AND is right)', () => {
    expect(runChecks(andSolution(), registry, andSpec).passed).toBe(true);
  });

  it('rejects a NAND that is missing the final inverter', () => {
    const g = emptyGraph();
    const inA = addInstance(g, 'level_input', 0, 0, 'IN_A');
    const inB = addInstance(g, 'level_input', 0, 60, 'IN_B');
    const nand = addInstance(g, 'nand', 60, 20);
    const out = addInstance(g, 'level_output', 120, 20, 'OUT');
    connect(g, { inst: inA.id, port: 'out' }, { inst: nand.id, port: 'a' });
    connect(g, { inst: inB.id, port: 'out' }, { inst: nand.id, port: 'b' });
    connect(g, { inst: nand.id, port: 'out' }, { inst: out.id, port: 'in' });
    const outcome = runChecks(g, registry, andSpec);
    expect(outcome.passed).toBe(false);
    expect(outcome.failures[0]!.reason).toBe('mismatch');
    expect(outcome.failures[0]!.inputs).toEqual({ a: 0, b: 0 });
    expect(outcome.failures[0]!.expected).toEqual({ out: 0 });
    expect(outcome.failures[0]!.actual).toEqual({ out: 1 });
  });

  it('rejects a circuit whose level output is never wired', () => {
    const g = emptyGraph();
    const inA = addInstance(g, 'level_input', 0, 0, 'IN_A');
    const inB = addInstance(g, 'level_input', 0, 60, 'IN_B');
    const nand = addInstance(g, 'nand', 60, 20);
    connect(g, { inst: inA.id, port: 'out' }, { inst: nand.id, port: 'a' });
    connect(g, { inst: inB.id, port: 'out' }, { inst: nand.id, port: 'b' });
    // no level_output instance at all: every row reads 0, which is wrong for a=0,b=0
    expect(runChecks(g, registry, andSpec).passed).toBe(false);
  });
});

describe('script check', () => {
  const secondTick: LevelSpec = {
    ...andSpec,
    id: 'test-second-tick',
    io: { inputs: [], outputs: [{ id: 'out', width: 1 }] },
    checks: [{ kind: 'script', steps: [{ tick: 2, expect: { out: 1 } }] }],
  };

  it('passes const_on through a delay line', () => {
    const g = emptyGraph();
    const src = addInstance(g, 'const_on', 0, 0);
    const d = addInstance(g, 'delay_line', 60, 0);
    const out = addInstance(g, 'level_output', 120, 0, 'OUT');
    connect(g, { inst: src.id, port: 'out' }, { inst: d.id, port: 'in' });
    connect(g, { inst: d.id, port: 'out' }, { inst: out.id, port: 'in' });
    const outcome = runChecks(g, registry, secondTick);
    expect(outcome.passed).toBe(true);
    expect(outcome.ticksUsed).toBe(2);
  });

  it('rejects a bare const_on because it is high from tick 0', () => {
    const g = emptyGraph();
    const src = addInstance(g, 'const_on', 0, 0);
    const out = addInstance(g, 'level_output', 60, 0, 'OUT');
    connect(g, { inst: src.id, port: 'out' }, { inst: out.id, port: 'in' });
    // expected high at tick 2, but a plain constant is also high at tick 0 --
    // this level additionally requires the output to be LOW at tick 0
    const strict: LevelSpec = {
      ...secondTick,
      checks: [
        {
          kind: 'script',
          steps: [
            { tick: 0, expect: { out: 0 } },
            { tick: 2, expect: { out: 1 } },
          ],
        },
      ],
    };
    expect(runChecks(g, registry, strict).passed).toBe(false);
  });
});

describe('constraint check', () => {
  const parity: LevelSpec = {
    ...andSpec,
    id: 'test-constraint',
    io: {
      inputs: [
        { id: 'a', width: 1 },
        { id: 'b', width: 1 },
      ],
      outputs: [{ id: 'out', width: 1 }],
    },
    checks: [
      { kind: 'constraint', rule: { kind: 'sum-equals', inputs: ['a', 'b'], output: 'out' } },
    ],
  };

  it('accepts a half adder sum built from XOR', () => {
    const g = emptyGraph();
    const inA = addInstance(g, 'level_input', 0, 0, 'IN_A');
    const inB = addInstance(g, 'level_input', 0, 60, 'IN_B');
    const xor = addInstance(g, 'xor', 60, 20);
    const out = addInstance(g, 'level_output', 120, 20, 'OUT');
    connect(g, { inst: inA.id, port: 'out' }, { inst: xor.id, port: 'a' });
    connect(g, { inst: inB.id, port: 'out' }, { inst: xor.id, port: 'b' });
    connect(g, { inst: xor.id, port: 'out' }, { inst: out.id, port: 'in' });
    expect(runChecks(g, registry, parity).passed).toBe(true);
  });

  it('rejects OR where parity is required', () => {
    const g = emptyGraph();
    const inA = addInstance(g, 'level_input', 0, 0, 'IN_A');
    const inB = addInstance(g, 'level_input', 0, 60, 'IN_B');
    const or = addInstance(g, 'or', 60, 20);
    const out = addInstance(g, 'level_output', 120, 20, 'OUT');
    connect(g, { inst: inA.id, port: 'out' }, { inst: or.id, port: 'a' });
    connect(g, { inst: inB.id, port: 'out' }, { inst: or.id, port: 'b' });
    connect(g, { inst: or.id, port: 'out' }, { inst: out.id, port: 'in' });
    expect(runChecks(g, registry, parity).passed).toBe(false);
  });
});
```

- [ ] **Step 7: 运行测试，确认通过**

Run: `pnpm test test/levels/checks.test.ts`
Expected: PASS — 10 passed

- [ ] **Step 8: 提交**

```bash
git add src/levels/spec.ts src/levels/checks.ts test/levels/checks.test.ts src/core/defs/index.ts
git commit -m "feat(levels): add level spec, level IO binding and check runners"
```

---

## Task 7: 评分器（levels/grader.ts）

**Files:**
- Create: `src/levels/grader.ts`
- Test: `test/levels/grader.test.ts`

**Interfaces:**
- Consumes: `runChecks`、`delayOf`、`Registry`、`LevelSpec`
- Produces:
  - `interface Metrics { readonly gate: number; readonly delay: number; readonly tick: number }`
  - `interface GradeResult { readonly passed: boolean; readonly metrics: Metrics; readonly score: number; readonly stars: 0 | 1 | 3; readonly failures: readonly CheckFailure[]; readonly issues: readonly GraphIssue[] }`
  - `const SCORE_WEIGHTS = { gate: 1, delay: 4, tick: 8 } as const`
  - `function grade(graph: Graph, registry: Registry, spec: LevelSpec): GradeResult`
  - `function scoreOf(m: Metrics): number`
  - `function starsOf(m: Metrics, spec: LevelSpec, passed: boolean): 0 | 1 | 3`
  - `function gateCost(graph: Graph, registry: Registry): number`

- [ ] **Step 1: 写失败测试 `test/levels/grader.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { addInstance, connect, emptyGraph, type Graph } from '../../src/core/graph';
import { BASE_DEFS } from '../../src/core/defs/index';
import { createRegistry } from '../../src/core/registry';
import type { LevelSpec } from '../../src/levels/spec';
import { SCORE_WEIGHTS, gateCost, grade, scoreOf, starsOf } from '../../src/levels/grader';

const registry = createRegistry(BASE_DEFS);

const andSpec: LevelSpec = {
  id: 'test-and',
  chapter: 1,
  index: 1,
  name: { zh: '与门', en: 'AND' },
  brief: { zh: '', en: '' },
  hint: { zh: '', en: '' },
  allowedComponents: ['nand', 'not', 'level_input', 'level_output'],
  io: {
    inputs: [
      { id: 'a', width: 1 },
      { id: 'b', width: 1 },
    ],
    outputs: [{ id: 'out', width: 1 }],
  },
  checks: [
    {
      kind: 'truth-table',
      rows: [
        { inputs: { a: 0, b: 0 }, outputs: { out: 0 } },
        { inputs: { a: 0, b: 1 }, outputs: { out: 0 } },
        { inputs: { a: 1, b: 0 }, outputs: { out: 0 } },
        { inputs: { a: 1, b: 1 }, outputs: { out: 1 } },
      ],
    },
  ],
  threeStar: { gate: 2, delay: 2, tick: 0 },
};

function andSolution(): Graph {
  const g = emptyGraph();
  const inA = addInstance(g, 'level_input', 0, 0, 'IN_A');
  const inB = addInstance(g, 'level_input', 0, 60, 'IN_B');
  const nand = addInstance(g, 'nand', 60, 20);
  const not = addInstance(g, 'not', 120, 20);
  const out = addInstance(g, 'level_output', 180, 20, 'OUT');
  connect(g, { inst: inA.id, port: 'out' }, { inst: nand.id, port: 'a' });
  connect(g, { inst: inB.id, port: 'out' }, { inst: nand.id, port: 'b' });
  connect(g, { inst: nand.id, port: 'out' }, { inst: not.id, port: 'a' });
  connect(g, { inst: not.id, port: 'out' }, { inst: out.id, port: 'in' });
  return g;
}

describe('gateCost', () => {
  it('counts gates and ignores sources and level connectors', () => {
    expect(gateCost(andSolution(), registry)).toBe(2);
  });

  it('is zero for an empty circuit', () => {
    expect(gateCost(emptyGraph(), registry)).toBe(0);
  });
});

describe('scoreOf', () => {
  it('weights delay and ticks above gate count', () => {
    expect(SCORE_WEIGHTS.delay).toBeGreaterThan(SCORE_WEIGHTS.gate);
    expect(SCORE_WEIGHTS.tick).toBeGreaterThan(SCORE_WEIGHTS.delay);
    expect(scoreOf({ gate: 2, delay: 3, tick: 1 })).toBe(2 + 12 + 8);
  });
});

describe('starsOf', () => {
  it('is 0 when the level is not passed', () => {
    expect(starsOf({ gate: 2, delay: 2, tick: 0 }, andSpec, false)).toBe(0);
  });
  it('is 1 when passed but targets are missed', () => {
    expect(starsOf({ gate: 3, delay: 2, tick: 0 }, andSpec, true)).toBe(1);
  });
  it('is 3 when every target is met', () => {
    expect(starsOf({ gate: 2, delay: 2, tick: 0 }, andSpec, true)).toBe(3);
  });
  it('is 3 when every target is beaten', () => {
    expect(starsOf({ gate: 1, delay: 1, tick: 0 }, andSpec, true)).toBe(3);
  });
  it('is 1 when the level declares no targets', () => {
    expect(starsOf({ gate: 99, delay: 99, tick: 9 }, { ...andSpec, threeStar: undefined }, true)).toBe(1);
  });
});

describe('grade', () => {
  it('reports passed + metrics + 3 stars for the reference solution', () => {
    const result = grade(andSolution(), registry, andSpec);
    expect(result.passed).toBe(true);
    expect(result.metrics).toEqual({ gate: 2, delay: 2, tick: 0 });
    expect(result.stars).toBe(3);
    expect(result.score).toBe(2 + 8 + 0);
    expect(result.failures).toHaveLength(0);
  });

  it('never throws on an empty circuit and reports 0 stars', () => {
    const result = grade(emptyGraph(), registry, andSpec);
    expect(result.passed).toBe(false);
    expect(result.stars).toBe(0);
    expect(result.failures.length).toBeGreaterThan(0);
  });

  it('never throws on an unstable circuit and marks it as a failure', () => {
    const g = emptyGraph();
    const n1 = addInstance(g, 'nand', 0, 0);
    const n2 = addInstance(g, 'nand', 0, 40);
    connect(g, { inst: n1.id, port: 'out' }, { inst: n2.id, port: 'a' });
    connect(g, { inst: n2.id, port: 'out' }, { inst: n1.id, port: 'a' });
    const result = grade(g, registry, andSpec);
    expect(result.passed).toBe(false);
    expect(result.failures.some((f) => f.reason === 'unstable')).toBe(true);
    expect(result.issues.some((i) => i.code === 'feedback-loop')).toBe(true);
  });

  it('reports graph issues alongside the grade', () => {
    const g = andSolution();
    g.instances.push({
      id: 'ghost',
      def: 'nope',
      x: 0,
      y: 0,
      rot: 0,
      params: {},
    });
    const result = grade(g, registry, andSpec);
    expect(result.passed).toBe(false);
    expect(result.issues.map((i) => i.code)).toContain('unknown-def');
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `pnpm test test/levels/grader.test.ts`
Expected: FAIL — 无法解析 `../../src/levels/grader`

- [ ] **Step 3: 实现 `src/levels/grader.ts`**

```ts
import type { Graph, GraphIssue } from '../core/graph';
import { validateGraph } from '../core/graph';
import { delayOf } from '../core/net';
import type { Registry } from '../core/registry';
import { runChecks } from './checks';
import type { CheckFailure, LevelSpec } from './spec';

export interface Metrics {
  readonly gate: number;
  readonly delay: number;
  readonly tick: number;
}

export interface GradeResult {
  readonly passed: boolean;
  readonly metrics: Metrics;
  readonly score: number;
  readonly stars: 0 | 1 | 3;
  readonly failures: readonly CheckFailure[];
  readonly issues: readonly GraphIssue[];
}

export const SCORE_WEIGHTS = { gate: 1, delay: 4, tick: 8 } as const;

export function scoreOf(m: Metrics): number {
  return m.gate * SCORE_WEIGHTS.gate + m.delay * SCORE_WEIGHTS.delay + m.tick * SCORE_WEIGHTS.tick;
}

export function gateCost(graph: Graph, registry: Registry): number {
  let total = 0;
  for (const inst of graph.instances) {
    if (!registry.has(inst.def)) continue;
    total += registry.get(inst.def).cost;
  }
  return total;
}

export function starsOf(m: Metrics, spec: LevelSpec, passed: boolean): 0 | 1 | 3 {
  if (!passed) return 0;
  const target = spec.threeStar;
  if (!target) return 1;
  const ok =
    (target.gate === undefined || m.gate <= target.gate) &&
    (target.delay === undefined || m.delay <= target.delay) &&
    (target.tick === undefined || m.tick <= target.tick);
  return ok ? 3 : 1;
}

export function grade(graph: Graph, registry: Registry, spec: LevelSpec): GradeResult {
  const issues = validateGraph(graph, registry);
  const fatal = issues.filter((i) => i.severity === 'error');
  if (fatal.length > 0) {
    const metrics: Metrics = { gate: 0, delay: 0, tick: 0 };
    return {
      passed: false,
      metrics,
      score: 0,
      stars: 0,
      failures: [],
      issues,
    };
  }

  const outcome = runChecks(graph, registry, spec);
  const metrics: Metrics = {
    gate: gateCost(graph, registry),
    delay: delayOf(graph, registry),
    tick: outcome.ticksUsed,
  };
  return {
    passed: outcome.passed,
    metrics,
    score: scoreOf(metrics),
    stars: starsOf(metrics, spec, outcome.passed),
    failures: outcome.failures,
    issues,
  };
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `pnpm test test/levels/grader.test.ts`
Expected: PASS — 12 passed

- [ ] **Step 5: 提交**

```bash
git add src/levels/grader.ts test/levels/grader.test.ts
git commit -m "feat(levels): add grader with gate/delay/tick metrics and star rating"
```

---

## Task 8: 第 1 章第 1–6 关内容与参考解

**Files:**
- Create: `src/levels/tables.ts`, `src/levels/content/ch1/part1.ts`, `src/levels/content/index.ts`
- Modify: `src/levels/index.ts`（导出 `LEVEL_ORDER`、`LEVELS`、`getLevel`）
- Test: `test/levels/ch1-part1.test.ts`

**Interfaces:**
- Consumes: `LevelSpec`、`grade`、`Registry`
- Produces:
  - `src/levels/tables.ts`：`function truthTable(expected: Record<string, (inputs: Record<string, number>) => number>): TruthTableCheck`
  - `const CH1_PART1: readonly LevelSpec[]`（第 1–6 关，顺序即 `index` 1..6）
  - `src/levels/index.ts`：`export const LEVELS: readonly LevelSpec[]`、`export const LEVEL_ORDER: readonly string[]`、`export function getLevel(id: string): LevelSpec`

> **为什么关卡数据里的真值表要显式写出来**：Task 6 已经把「没有 rows 的 truth-table」定为硬错误。让每个关卡用 `truthTable()` 生成完整的行，关卡文件就成了可读的规格说明——你会直接看到 AND 的四行，而不是「某个函数大概算对了」。这是本计划里唯一一处冗长换取可审查性的取舍，值得。

- [ ] **Step 1: 写 `src/levels/tables.ts`**

```ts
import type { PinSpec, TruthRow, TruthTableCheck } from './spec';

export interface LevelIo {
  readonly inputs: readonly PinSpec[];
  readonly outputs: readonly PinSpec[];
}

function enumerateInputs(io: LevelIo): Array<Record<string, number>> {
  const bits = io.inputs.reduce((acc, p) => acc + p.width, 0);
  const combos: Array<Record<string, number>> = [];
  for (let n = 0; n < 2 ** bits; n += 1) {
    const row: Record<string, number> = {};
    let offset = 0;
    for (const pin of io.inputs) {
      row[pin.id] = (n >>> offset) & ((1 << pin.width) - 1);
      offset += pin.width;
    }
    combos.push(row);
  }
  return combos;
}

/**
 * Builds a complete truth table from one function per output pin.
 * Throws if a declared output pin has no function, so a typo cannot silently
 * produce a table that never checks that pin.
 */
export function truthTable(
  io: LevelIo,
  expected: Readonly<Record<string, (inputs: Record<string, number>) => number>>,
): TruthTableCheck {
  for (const pin of io.outputs) {
    if (typeof expected[pin.id] !== 'function') {
      throw new Error(`truthTable: no expectation given for output pin "${pin.id}"`);
    }
  }
  for (const key of Object.keys(expected)) {
    if (!io.outputs.some((pin) => pin.id === key)) {
      throw new Error(`truthTable: "${key}" is not an output pin of this level`);
    }
  }
  const rows: TruthRow[] = enumerateInputs(io).map((inputs) => {
    const outputs: Record<string, number> = {};
    for (const pin of io.outputs) {
      outputs[pin.id] = expected[pin.id]!(inputs) & ((1 << pin.width) - 1);
    }
    return { inputs, outputs };
  });
  return { kind: 'truth-table', rows };
}
```

> `truthTable` 需要 `io`，而 `io` 又写在关卡里，所以调用点是 `checks: [truthTable(IO, { out: ... })]`：先把该关的 `io` 提成一个 `const IO`，再复用。下面每个关卡都按这个写法。

- [ ] **Step 2: 写 `src/levels/content/ch1/part1.ts`**

```ts
import { truthTable } from '../../tables';
import type { LevelSpec } from '../../spec';

/**
 * Chapter 1, levels 1-6.
 *
 * Ordering note: the source material lists NOR (5) before OR (6), but NOR's
 * standard solutions need OR, or they need NOT+NAND which arrives even later.
 * To keep the "a level only uses already-unlocked parts" rule absolute, OR and
 * NOR are swapped here. All text is original.
 */
const IO_1 = { inputs: [], outputs: [{ id: 'out', width: 1 }] };
const IO_2 = {
  inputs: [
    { id: 'a', width: 1 },
    { id: 'b', width: 1 },
  ],
  outputs: [{ id: 'out', width: 1 }],
};
const IO_1IN = { inputs: [{ id: 'a', width: 1 }], outputs: [{ id: 'out', width: 1 }] };

export const CH1_PART1: readonly LevelSpec[] = [
  {
    id: 'ch1-01-crude-awakening',
    chapter: 1,
    index: 1,
    name: { zh: '原力觉醒', en: 'Crude Awakening' },
    brief: {
      zh: '飞船的舱门认电不认人。给输出一个恒定的高电平，门就会开。',
      en: 'The airlock only understands voltage. Hold the output high and it opens.',
    },
    hint: {
      zh: '调色板里有「高电平」和「关卡输出」，把它们连起来。',
      en: 'The palette has Constant On and Level Output. Wire them together.',
    },
    allowedComponents: ['const_on', 'const_off', 'level_input', 'level_output'],
    io: IO_1,
    checks: [truthTable(IO_1, { out: () => 1 })],
    threeStar: { gate: 0, delay: 0, tick: 0 },
    rewards: { components: ['nand'] },
  },
  {
    id: 'ch1-02-nand-gate',
    chapter: 1,
    index: 2,
    name: { zh: '与非门', en: 'NAND Gate' },
    brief: {
      zh: '监督者给了你一块芯片：只有两个输入同时为高时，输出才是低。它叫与非门。',
      en: 'The Overseer hands you one chip: its output drops low only when both inputs are high.',
    },
    hint: {
      zh: '关卡输入要用「关卡输入」元件接出来，实例名必须是 IN_a 和 IN_b；输出实例名是 OUT。',
      en: 'Drive the level inputs from Level Input parts named IN_a and IN_b; the output is OUT.',
    },
    allowedComponents: ['nand', 'level_input', 'level_output'],
    io: IO_2,
    checks: [truthTable(IO_2, { out: ({ a, b }) => (a && b ? 0 : 1) })],
    threeStar: { gate: 1, delay: 1, tick: 0 },
    rewards: { components: ['not'] },
  },
  {
    id: 'ch1-03-not-gate',
    chapter: 1,
    index: 3,
    name: { zh: '非门', en: 'NOT Gate' },
    brief: {
      zh: '把输入翻转过来。只有一个输入引脚 a 的时候，与非门会变成什么？',
      en: 'Invert the input. What does a NAND become when it has only one input to look at?',
    },
    hint: {
      zh: '把同一个信号接到与非门的两个输入上。',
      en: 'Feed the same signal into both NAND inputs.',
    },
    allowedComponents: ['nand', 'level_input', 'level_output'],
    io: IO_1IN,
    checks: [truthTable(IO_1IN, { out: ({ a }) => (a ? 0 : 1) })],
    threeStar: { gate: 1, delay: 1, tick: 0 },
    rewards: { components: ['and'] },
  },
  {
    id: 'ch1-04-and-gate',
    chapter: 1,
    index: 4,
    name: { zh: '与门', en: 'AND Gate' },
    brief: {
      zh: '与门就是与非门再翻一次。两个输入都为高时输出才为高。',
      en: 'An AND is a NAND flipped back. High only when both inputs are high.',
    },
    hint: { zh: '与非门的输出接一个非门。', en: 'Put a NOT after the NAND.' },
    allowedComponents: ['nand', 'not', 'level_input', 'level_output'],
    io: IO_2,
    checks: [truthTable(IO_2, { out: ({ a, b }) => (a && b ? 1 : 0) })],
    threeStar: { gate: 2, delay: 2, tick: 0 },
    rewards: { components: ['or'] },
  },
  {
    id: 'ch1-05-or-gate',
    chapter: 1,
    index: 5,
    name: { zh: '或门', en: 'OR Gate' },
    brief: {
      zh: '任意一个输入为高，输出就为高。德摩根说：先把两个输入都翻过来，再用与非门。',
      en: 'High when either input is high. De Morgan says: invert both inputs, then NAND.',
    },
    hint: { zh: 'NOT(a) NAND NOT(b) 就是 a OR b。', en: 'NOT(a) NAND NOT(b) is exactly a OR b.' },
    allowedComponents: ['nand', 'not', 'and', 'level_input', 'level_output'],
    io: IO_2,
    checks: [truthTable(IO_2, { out: ({ a, b }) => (a || b ? 1 : 0) })],
    threeStar: { gate: 3, delay: 2, tick: 0 },
    rewards: { components: ['nor'] },
  },
  {
    id: 'ch1-06-nor-gate',
    chapter: 1,
    index: 6,
    name: { zh: '或非门', en: 'NOR Gate' },
    brief: {
      zh: '或门之后再翻一次。两个输入都为低时输出才为高。',
      en: 'An OR flipped. High only when both inputs are low.',
    },
    hint: { zh: '或门的输出接一个非门。', en: 'Put a NOT after the OR.' },
    allowedComponents: ['nand', 'not', 'and', 'or', 'level_input', 'level_output'],
    io: IO_2,
    checks: [truthTable(IO_2, { out: ({ a, b }) => (a || b ? 0 : 1) })],
    threeStar: { gate: 4, delay: 3, tick: 0 },
    rewards: { components: ['const_on', 'const_off'] },
  },
];
```

- [ ] **Step 2: 写测试夹具 `test/fixtures/build.ts` 与测试 `test/levels/ch1-part1.test.ts`**

`test/fixtures/build.ts`——参考解靠它从一行声明生成电路，避免每个测试手写十几个 `addInstance`：

```ts
import { addInstance, connect, emptyGraph, type Graph } from '../../src/core/graph';
import { BASE_DEFS } from '../../src/core/defs/index';
import { createRegistry } from '../../src/core/registry';

export const registry = createRegistry(BASE_DEFS);

export type Node =
  | { readonly kind: 'input'; readonly name: string }
  | { readonly kind: 'part'; readonly def: string; readonly id: string; readonly from: readonly string[] }
  | { readonly kind: 'output'; readonly name?: string; readonly from: string };

/**
 * Builds a circuit from a flat declaration list.
 *
 * `from` entries resolve as: a level input name (`IN_<name>.out`), a part id
 * (`.out`), or an explicit `"partId.pin"`. When a part has more inputs than
 * `from` entries, the last entry is reused -- that is how a NOT gets wired
 * from a single source.
 *
 * Level inputs are instances named `IN_<name>`; level outputs are instances
 * named `OUT` (single output) or `OUT_<name>` (multi-output).
 */
export function build(nodes: readonly Node[]): Graph {
  const g = emptyGraph();
  const inputIds = new Map<string, string>();
  const partIds = new Map<string, string>();
  const outputIds = new Map<string, string>();

  for (const node of nodes) {
    if (node.kind === 'input') {
      inputIds.set(node.name, addInstance(g, 'level_input', 0, 0, `IN_${node.name}`).id);
    } else if (node.kind === 'part') {
      partIds.set(node.id, addInstance(g, node.def, 120, 0).id);
    } else {
      const name = node.name ?? 'OUT';
      outputIds.set(name, addInstance(g, 'level_output', 240, 0, name).id);
    }
  }

  const resolve = (ref: string): { inst: string; port: string } => {
    const [head, pin] = ref.split('.') as [string, string?];
    const inputId = inputIds.get(head!);
    if (inputId) return { inst: inputId, port: 'out' };
    const partId = partIds.get(head!);
    if (!partId) throw new Error(`build: unknown reference "${ref}"`);
    return { inst: partId, port: pin ?? 'out' };
  };

  for (const node of nodes) {
    if (node.kind !== 'part') continue;
    const inst = partIds.get(node.id)!;
    const def = registry.get(node.def);
    def.inputs.forEach((pin, index) => {
      const ref = node.from[Math.min(index, node.from.length - 1)];
      if (ref === undefined) return;
      connect(g, resolve(ref), { inst, port: pin.id });
    });
  }

  for (const node of nodes) {
    if (node.kind !== 'output') continue;
    const inst = outputIds.get(node.name ?? 'OUT')!;
    connect(g, resolve(node.from), { inst, port: 'in' });
  }

  return g;
}
```

`test/levels/ch1-part1.test.ts`：

```ts
import { describe, expect, it } from 'vitest';
import type { Graph } from '../../src/core/graph';
import { CH1_PART1 } from '../../src/levels/content/ch1/part1';
import { grade } from '../../src/levels/grader';
import type { LevelSpec } from '../../src/levels/spec';
import { build, registry } from '../fixtures/build';

const byId = new Map(CH1_PART1.map((l) => [l.id, l]));

describe('chapter 1 levels 1-6', () => {
  it('exposes six levels in order', () => {
    expect(CH1_PART1.map((l) => l.index)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('gates every part behind a component unlocked earlier', () => {
    // level_input / level_output are plumbing and always available
    const unlocked = new Set<string>(['level_input', 'level_output']);
    for (const level of CH1_PART1) {
      for (const def of level.allowedComponents) {
        expect(unlocked.has(def), `${level.id} offers locked component ${def}`).toBe(true);
      }
      for (const def of level.rewards?.components ?? []) unlocked.add(def);
    }
  });
});

const solutions: Record<string, () => Graph> = {
  'ch1-01-crude-awakening': () =>
    build([
      { kind: 'part', def: 'const_on', id: 'src', from: [] },
      { kind: 'output', from: 'src' },
    ]),
  'ch1-02-nand-gate': () =>
    build([
      { kind: 'input', name: 'a' },
      { kind: 'input', name: 'b' },
      { kind: 'part', def: 'nand', id: 'g', from: ['a', 'b'] },
      { kind: 'output', from: 'g' },
    ]),
  'ch1-03-not-gate': () =>
    build([
      { kind: 'input', name: 'a' },
      { kind: 'part', def: 'nand', id: 'g', from: ['a', 'a'] },
      { kind: 'output', from: 'g' },
    ]),
  'ch1-04-and-gate': () =>
    build([
      { kind: 'input', name: 'a' },
      { kind: 'input', name: 'b' },
      { kind: 'part', def: 'nand', id: 'g1', from: ['a', 'b'] },
      { kind: 'part', def: 'not', id: 'g2', from: ['g1'] },
      { kind: 'output', from: 'g2' },
    ]),
  'ch1-05-or-gate': () =>
    build([
      { kind: 'input', name: 'a' },
      { kind: 'input', name: 'b' },
      { kind: 'part', def: 'not', id: 'n1', from: ['a'] },
      { kind: 'part', def: 'not', id: 'n2', from: ['b'] },
      { kind: 'part', def: 'nand', id: 'g', from: ['n1', 'n2'] },
      { kind: 'output', from: 'g' },
    ]),
  'ch1-06-nor-gate': () =>
    build([
      { kind: 'input', name: 'a' },
      { kind: 'input', name: 'b' },
      { kind: 'part', def: 'or', id: 'o1', from: ['a', 'b'] },
      { kind: 'part', def: 'not', id: 'n1', from: ['o1'] },
      { kind: 'output', from: 'n1' },
    ]),
};

/** Circuits that a player would plausibly build and that must be rejected. */
const wrong: Record<string, () => Graph> = {
  // NAND without the final inverter
  'ch1-04-and-gate': () =>
    build([
      { kind: 'input', name: 'a' },
      { kind: 'input', name: 'b' },
      { kind: 'part', def: 'nand', id: 'g', from: ['a', 'b'] },
      { kind: 'output', from: 'g' },
    ]),
  // NOT(NAND) is AND, not OR
  'ch1-05-or-gate': () =>
    build([
      { kind: 'input', name: 'a' },
      { kind: 'input', name: 'b' },
      { kind: 'part', def: 'nand', id: 'g1', from: ['a', 'b'] },
      { kind: 'part', def: 'not', id: 'g2', from: ['g1'] },
      { kind: 'output', from: 'g2' },
    ]),
  // two NANDs in series is AND, not NOR
  'ch1-06-nor-gate': () =>
    build([
      { kind: 'input', name: 'a' },
      { kind: 'input', name: 'b' },
      { kind: 'part', def: 'nand', id: 'g1', from: ['a', 'b'] },
      { kind: 'part', def: 'not', id: 'g2', from: ['g1'] },
      { kind: 'output', from: 'g2' },
    ]),
  // a constant ignores its inputs entirely
  'ch1-02-nand-gate': () =>
    build([
      { kind: 'part', def: 'const_on', id: 'src', from: [] },
      { kind: 'output', from: 'src' },
    ]),
  // inverting the input is NOT, not NAND
  'ch1-03-not-gate': () =>
    build([
      { kind: 'part', def: 'const_on', id: 'src', from: [] },
      { kind: 'output', from: 'src' },
    ]),
};

describe('reference solutions pass with three stars', () => {
  for (const [id, make] of Object.entries(solutions)) {
    it(id, () => {
      const level = byId.get(id) as LevelSpec;
      const result = grade(make(), registry, level);
      expect(result.failures, JSON.stringify(result.failures)).toEqual([]);
      expect(result.passed).toBe(true);
      expect(result.stars, `metrics=${JSON.stringify(result.metrics)}`).toBe(3);
    });
  }
});

describe('plausible wrong circuits fail', () => {
  for (const [id, make] of Object.entries(wrong)) {
    it(id, () => {
      const level = byId.get(id) as LevelSpec;
      expect(grade(make(), registry, level).passed).toBe(false);
    });
  }
});

describe('an empty circuit fails every level instead of throwing', () => {
  for (const level of CH1_PART1) {
    it(level.id, () => {
      const result = grade(build([]), registry, level);
      expect(result.passed).toBe(false);
      expect(result.stars).toBe(0);
    });
  }
});
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `pnpm test test/levels/ch1-part1.test.ts`
Expected: PASS — 19 passed（2 个结构性测试 + 6 个参考解 + 5 个反例 + 6 个空电路）

> 若 `reference solutions pass with three stars` 失败，**先改关卡数据的三星门槛，不要改测试**——门槛是用来描述最优解的，不是用来描述任意解的。但如果是拓扑写错了（比如 NOR 用 NOT(NAND) 搭），那是参考解错了，改参考解。

- [ ] **Step 5: 写 `src/levels/content/index.ts` 与 `src/levels/index.ts`**

`src/levels/content/index.ts`：

```ts
import type { LevelSpec } from '../spec';
import { CH1_PART1 } from './ch1/part1';

export const ALL_LEVELS: readonly LevelSpec[] = [...CH1_PART1];
```

`src/levels/index.ts`：

```ts
import { ALL_LEVELS } from './content/index';
import type { LevelSpec } from './spec';

export const LEVELS: readonly LevelSpec[] = ALL_LEVELS;
export const LEVEL_ORDER: readonly string[] = LEVELS.map((l) => l.id);

const byId = new Map(LEVELS.map((l) => [l.id, l]));

export function getLevel(id: string): LevelSpec {
  const level = byId.get(id);
  if (!level) throw new Error(`unknown level: ${id}`);
  return level;
}

export function levelsOfChapter(chapter: number): readonly LevelSpec[] {
  return LEVELS.filter((l) => l.chapter === chapter);
}

export type { LevelSpec };
```

- [ ] **Step 6: 运行全部测试**

Run: `pnpm test`
Expected: PASS — 全部通过

- [ ] **Step 7: 提交**

```bash
git add src/levels/content src/levels/index.ts test/levels/ch1-part1.test.ts
git commit -m "feat(levels): add chapter 1 levels 1-6 with reference solutions"
```

---

## Task 9: 第 1 章第 7–12 关内容

**Files:**
- Create: `src/levels/content/ch1/part2.ts`
- Modify: `src/levels/content/index.ts`
- Test: `test/levels/ch1-part2.test.ts`

**Interfaces:**
- Consumes: `test/fixtures/build.ts` 的 `build()` 与 `registry`、`src/levels/tables.ts` 的 `truthTable()`
- Produces: `const CH1_PART2: readonly LevelSpec[]`（第 7–12 关）

- [ ] **Step 1: 确认夹具与多输出支持**

`test/fixtures/build.ts` 在 Task 8 已经建好，并且 `output` 节点支持 `name`，因此多输出关卡可以直接写 `{ kind: 'output', name: 'OUT_out0', from: 'b0' }`。先跑 `pnpm test` 确认 Task 8 仍然全绿，再往下做。

- [ ] **Step 2: 写 `src/levels/content/ch1/part2.ts`**

```ts
import { truthTable } from '../../tables';
import type { LevelSpec } from '../../spec';

/** Chapter 1, levels 7-12. All text is original. */
const IO_CONST = { inputs: [], outputs: [{ id: 'out', width: 1 }] };
const IO_AB = {
  inputs: [
    { id: 'a', width: 1 },
    { id: 'b', width: 1 },
  ],
  outputs: [{ id: 'out', width: 1 }],
};
const IO_ABC = {
  inputs: [
    { id: 'a', width: 1 },
    { id: 'b', width: 1 },
    { id: 'c', width: 1 },
  ],
  outputs: [{ id: 'out', width: 1 }],
};
const IO_NIBBLE = {
  inputs: [
    { id: 'b3', width: 1 },
    { id: 'b2', width: 1 },
    { id: 'b1', width: 1 },
    { id: 'b0', width: 1 },
  ],
  outputs: [
    { id: 'out3', width: 1 },
    { id: 'out2', width: 1 },
    { id: 'out1', width: 1 },
    { id: 'out0', width: 1 },
  ],
};

export const CH1_PART2: readonly LevelSpec[] = [
  {
    id: 'ch1-07-always-on',
    chapter: 1,
    index: 7,
    name: { zh: '高电平', en: 'Always On' },
    brief: {
      zh: '永远为高。听起来简单——但这是你和电源之间的第一次握手。',
      en: 'Always high. Trivial, except it is your first handshake with the power rail.',
    },
    hint: { zh: '一个「高电平」元件就够了。', en: 'One Constant On part is enough.' },
    allowedComponents: ['const_on', 'level_input', 'level_output'],
    io: IO_CONST,
    checks: [truthTable(IO_CONST, { out: () => 1 })],
    threeStar: { gate: 0, delay: 0, tick: 0 },
    rewards: { components: ['xor'] },
  },
  {
    id: 'ch1-08-second-tick',
    chapter: 1,
    index: 8,
    name: { zh: '第二刻', en: 'Second Tick' },
    brief: {
      zh: '输出必须在第 0 拍为低，第 1 拍为低，从第 2 拍起为高。信号需要时间。',
      en: 'The output must read low at ticks 0 and 1, and high from tick 2 onward.',
    },
    hint: {
      zh: '延迟线在时钟沿把输入存下来再输出。串两条延迟线就是两拍。',
      en: 'A Delay Line latches its input on the clock edge. Two in series is two ticks.',
    },
    allowedComponents: ['const_on', 'delay_line', 'level_input', 'level_output'],
    io: IO_CONST,
    checks: [
      {
        kind: 'script',
        steps: [
          { tick: 0, expect: { out: 0 } },
          { tick: 1, expect: { out: 0 } },
          { tick: 2, expect: { out: 1 } },
          { tick: 3, expect: { out: 1 } },
        ],
      },
    ],
    threeStar: { gate: 0, delay: 0, tick: 2 },
    rewards: { components: ['and3'] },
  },
  {
    id: 'ch1-09-xor-gate',
    chapter: 1,
    index: 9,
    name: { zh: '异或门', en: 'XOR Gate' },
    brief: {
      zh: '两个输入不同时输出高。四个与非门就够了——监督者显然知道这件事。',
      en: 'High when the inputs differ. Four NANDs are enough, and the Overseer knows it.',
    },
    hint: {
      zh: 'NAND(a,b) 的结果再分别和 a、b 各与非一次，最后把两个结果与非起来。',
      en: 'Feed NAND(a,b) into two more NANDs with a and b, then NAND those two results.',
    },
    allowedComponents: [
      'nand',
      'not',
      'and',
      'or',
      'const_on',
      'delay_line',
      'and3',
      'level_input',
      'level_output',
    ],
    io: IO_AB,
    checks: [truthTable(IO_AB, { out: ({ a, b }) => a ^ b })],
    threeStar: { gate: 4, delay: 3, tick: 0 },
    rewards: { components: ['or3'] },
  },
  {
    id: 'ch1-10-bigger-or-gate',
    chapter: 1,
    index: 10,
    name: { zh: '三路或门', en: 'Bigger OR Gate' },
    brief: {
      zh: '三个输入里任意一个为高，输出就为高。',
      en: 'High when any of the three inputs is high.',
    },
    hint: {
      zh: '先用两个输入做一个或，再把结果和第三个或一次。级联是这一关的全部内容。',
      en: 'OR two of them, then OR the result with the third. Cascading is the whole lesson.',
    },
    allowedComponents: [
      'nand',
      'not',
      'and',
      'or',
      'const_on',
      'delay_line',
      'and3',
      'xor',
      'level_input',
      'level_output',
    ],
    io: IO_ABC,
    checks: [truthTable(IO_ABC, { out: ({ a, b, c }) => (a || b || c ? 1 : 0) })],
    threeStar: { gate: 6, delay: 4, tick: 0 },
    rewards: { components: ['xnor'] },
  },
  {
    id: 'ch1-11-bigger-and-gate',
    chapter: 1,
    index: 11,
    name: { zh: '三路与门', en: 'Bigger AND Gate' },
    brief: {
      zh: '三个输入都为高，输出才为高。',
      en: 'High only when all three inputs are high.',
    },
    hint: { zh: '与门可以级联，就像或门一样。', en: 'AND cascades exactly like OR does.' },
    allowedComponents: [
      'nand',
      'not',
      'and',
      'or',
      'const_on',
      'delay_line',
      'and3',
      'xor',
      'or3',
      'level_input',
      'level_output',
    ],
    io: IO_ABC,
    checks: [truthTable(IO_ABC, { out: ({ a, b, c }) => (a && b && c ? 1 : 0) })],
    threeStar: { gate: 4, delay: 2, tick: 0 },
  },
  {
    id: 'ch1-12-binary-racer',
    chapter: 1,
    index: 12,
    name: { zh: '二进制速算', en: 'Binary Racer' },
    brief: {
      zh: '四个输入位 b3 b2 b1 b0 组成一个数。一眼读出它——然后原样送到四个输出位。',
      en: 'Bits b3..b0 form one number. Read it at a glance, then forward it to the four outputs.',
    },
    hint: {
      zh: 'b3 是最高位（权 8），b0 是最低位（权 1）。把每一位直连到同名输出。',
      en: 'b3 is the most significant bit (weight 8), b0 the least (weight 1). Wire each straight through.',
    },
    allowedComponents: [
      'nand',
      'not',
      'and',
      'or',
      'const_on',
      'delay_line',
      'and3',
      'xor',
      'or3',
      'xnor',
      'level_input',
      'level_output',
    ],
    io: IO_NIBBLE,
    checks: [
      truthTable(IO_NIBBLE, {
        out3: ({ b3 }) => b3,
        out2: ({ b2 }) => b2,
        out1: ({ b1 }) => b1,
        out0: ({ b0 }) => b0,
      }),
    ],
    threeStar: { gate: 0, delay: 0, tick: 0 },
  },
];
```

- [ ] **Step 3: 写 `test/levels/ch1-part2.test.ts`**

结构与 Task 8 的测试完全一致：结构性检查 + 参考解 + 反例 + 空电路。参考解拓扑：

| 关卡 | 参考解 |
|---|---|
| `ch1-07-always-on` | `const_on` → `OUT` |
| `ch1-08-second-tick` | `const_on` → `delay_line` → `delay_line` → `OUT` |
| `ch1-09-xor-gate` | `nand(a,b)=n1`；`nand(a,n1)=n2`；`nand(b,n1)=n3`；`nand(n2,n3)=OUT` |
| `ch1-10-bigger-or-gate` | `or(a,b)=o1`；`or(o1,c)=OUT` |
| `ch1-11-bigger-and-gate` | `and(a,b)=a1`；`and(a1,c)=OUT` |
| `ch1-12-binary-racer` | 四条直通：`b3→OUT_out3`、`b2→OUT_out2`、`b1→OUT_out1`、`b0→OUT_out0` |

```ts
import { describe, expect, it } from 'vitest';
import type { Graph } from '../../src/core/graph';
import { CH1_PART2 } from '../../src/levels/content/ch1/part2';
import { grade } from '../../src/levels/grader';
import type { LevelSpec } from '../../src/levels/spec';
import { build, registry } from '../fixtures/build';

const byId = new Map(CH1_PART2.map((l) => [l.id, l]));

describe('chapter 1 levels 7-12', () => {
  it('exposes six levels in order', () => {
    expect(CH1_PART2.map((l) => l.index)).toEqual([7, 8, 9, 10, 11, 12]);
  });

  it('gates every part behind a component unlocked earlier', () => {
    const unlocked = new Set<string>(['level_input', 'level_output']);
    for (const level of [...CH1_PART2]) {
      for (const def of level.allowedComponents) {
        expect(unlocked.has(def), `${level.id} offers locked component ${def}`).toBe(true);
      }
      for (const def of level.rewards?.components ?? []) unlocked.add(def);
    }
  });
});

const solutions: Record<string, () => Graph> = {
  'ch1-07-always-on': () =>
    build([
      { kind: 'part', def: 'const_on', id: 'src', from: [] },
      { kind: 'output', from: 'src' },
    ]),
  'ch1-08-second-tick': () =>
    build([
      { kind: 'part', def: 'const_on', id: 'src', from: [] },
      { kind: 'part', def: 'delay_line', id: 'd1', from: ['src'] },
      { kind: 'part', def: 'delay_line', id: 'd2', from: ['d1'] },
      { kind: 'output', from: 'd2' },
    ]),
  'ch1-09-xor-gate': () =>
    build([
      { kind: 'input', name: 'a' },
      { kind: 'input', name: 'b' },
      { kind: 'part', def: 'nand', id: 'n1', from: ['a', 'b'] },
      { kind: 'part', def: 'nand', id: 'n2', from: ['a', 'n1'] },
      { kind: 'part', def: 'nand', id: 'n3', from: ['b', 'n1'] },
      { kind: 'part', def: 'nand', id: 'n4', from: ['n2', 'n3'] },
      { kind: 'output', from: 'n4' },
    ]),
  'ch1-10-bigger-or-gate': () =>
    build([
      { kind: 'input', name: 'a' },
      { kind: 'input', name: 'b' },
      { kind: 'input', name: 'c' },
      { kind: 'part', def: 'or', id: 'o1', from: ['a', 'b'] },
      { kind: 'part', def: 'or', id: 'o2', from: ['o1', 'c'] },
      { kind: 'output', from: 'o2' },
    ]),
  'ch1-11-bigger-and-gate': () =>
    build([
      { kind: 'input', name: 'a' },
      { kind: 'input', name: 'b' },
      { kind: 'input', name: 'c' },
      { kind: 'part', def: 'and', id: 'a1', from: ['a', 'b'] },
      { kind: 'part', def: 'and', id: 'a2', from: ['a1', 'c'] },
      { kind: 'output', from: 'a2' },
    ]),
  'ch1-12-binary-racer': () =>
    build([
      { kind: 'input', name: 'b3' },
      { kind: 'input', name: 'b2' },
      { kind: 'input', name: 'b1' },
      { kind: 'input', name: 'b0' },
      { kind: 'output', name: 'OUT_out3', from: 'b3' },
      { kind: 'output', name: 'OUT_out2', from: 'b2' },
      { kind: 'output', name: 'OUT_out1', from: 'b1' },
      { kind: 'output', name: 'OUT_out0', from: 'b0' },
    ]),
};

const wrong: Record<string, () => Graph> = {
  // a constant cannot depend on its inputs
  'ch1-12-binary-racer': () =>
    build([
      { kind: 'part', def: 'const_on', id: 'src', from: [] },
      { kind: 'output', name: 'OUT_out3', from: 'src' },
      { kind: 'output', name: 'OUT_out2', from: 'src' },
      { kind: 'output', name: 'OUT_out1', from: 'src' },
      { kind: 'output', name: 'OUT_out0', from: 'src' },
    ]),
  // two delay lines is three-tick behaviour when one is shorted out
  'ch1-08-second-tick': () =>
    build([
      { kind: 'part', def: 'const_on', id: 'src', from: [] },
      { kind: 'part', def: 'delay_line', id: 'd1', from: ['src'] },
      { kind: 'output', from: 'd1' },
    ]),
  // OR where XOR is required
  'ch1-09-xor-gate': () =>
    build([
      { kind: 'input', name: 'a' },
      { kind: 'input', name: 'b' },
      { kind: 'part', def: 'or', id: 'o1', from: ['a', 'b'] },
      { kind: 'output', from: 'o1' },
    ]),
  // AND where 3-input OR is required
  'ch1-10-bigger-or-gate': () =>
    build([
      { kind: 'input', name: 'a' },
      { kind: 'input', name: 'b' },
      { kind: 'input', name: 'c' },
      { kind: 'part', def: 'and', id: 'a1', from: ['a', 'b'] },
      { kind: 'part', def: 'and', id: 'a2', from: ['a1', 'c'] },
      { kind: 'output', from: 'a2' },
    ]),
  // OR where 3-input AND is required
  'ch1-11-bigger-and-gate': () =>
    build([
      { kind: 'input', name: 'a' },
      { kind: 'input', name: 'b' },
      { kind: 'input', name: 'c' },
      { kind: 'part', def: 'or', id: 'o1', from: ['a', 'b'] },
      { kind: 'part', def: 'or', id: 'o2', from: ['o1', 'c'] },
      { kind: 'output', from: 'o2' },
    ]),
};

describe('reference solutions pass with three stars', () => {
  for (const [id, make] of Object.entries(solutions)) {
    it(id, () => {
      const level = byId.get(id) as LevelSpec;
      const result = grade(make(), registry, level);
      expect(result.failures, JSON.stringify(result.failures)).toEqual([]);
      expect(result.passed).toBe(true);
      expect(result.stars, `metrics=${JSON.stringify(result.metrics)}`).toBe(3);
    });
  }
});

describe('plausible wrong circuits fail', () => {
  for (const [id, make] of Object.entries(wrong)) {
    it(id, () => {
      const level = byId.get(id) as LevelSpec;
      expect(grade(make(), registry, level).passed).toBe(false);
    });
  }
});

describe('an empty circuit fails every level instead of throwing', () => {
  for (const level of CH1_PART2) {
    it(level.id, () => {
      const result = grade(build([]), registry, level);
      expect(result.passed).toBe(false);
      expect(result.stars).toBe(0);
    });
  }
});
```

- [ ] **Step 4: 把两章内容装配进 `src/levels/content/index.ts`**

```ts
import type { LevelSpec } from '../spec';
import { CH1_PART1 } from './ch1/part1';
import { CH1_PART2 } from './ch1/part2';

export const ALL_LEVELS: readonly LevelSpec[] = [...CH1_PART1, ...CH1_PART2];
```

- [ ] **Step 5: 运行测试，确认通过**

Run: `pnpm test`
Expected: PASS — 全部通过（ch1-part2 新增 19 个用例）

- [ ] **Step 6: 提交**

```bash
git add src/levels/content/ch1/part2.ts src/levels/content/index.ts test/levels/ch1-part2.test.ts
git commit -m "feat(levels): add chapter 1 levels 7-12 with reference solutions"
```
---

## Task 10: 应用状态、撤销栈与进度（app/）

**Files:**
- Create: `src/app/store.ts`, `src/app/commands.ts`, `src/app/progress.ts`, `src/persist/storage.ts`
- Test: `test/app/progress.test.ts`, `test/persist/storage.test.ts`

**Interfaces:**
- Consumes: `Graph`、`LevelSpec`、`GradeResult`
- Produces:
  - `src/app/commands.ts`：`interface Command { readonly label: string; do(g: Graph): void; undo(g: Graph): void }`、`class CommandStack { push(c: Command, g: Graph): void; undo(g: Graph): boolean; redo(g: Graph): boolean; canUndo(): boolean; canRedo(): boolean; clear(): void; readonly depth: number }`
  - `src/app/progress.ts`：`interface LevelRecord { passed: boolean; best: Metrics | null; stars: 0 | 1 | 3 }`、`interface Progress { version: 1; levels: Record<string, LevelRecord> }`、`const PLUMBING = ['level_input', 'level_output'] as const`、`const SCORE_WEIGHTS = { delay: 4, tick: 8 } as const`、`function emptyProgress(): Progress`、`function isUnlocked(p: Progress, levelId: string, order: readonly string[]): boolean`、`function resumePointOf(p: Progress, order: readonly string[]): string`、`function unlockedComponents(p: Progress, levels: readonly LevelSpec[]): Set<string>`、`function paletteDefsFor(p: Progress, levels: readonly LevelSpec[], level: LevelSpec): string[]`、`function applyGrade(p: Progress, level: LevelSpec, result: GradeResult): Progress`（纯函数，返回新对象）
  - `src/persist/storage.ts`：`const STORAGE_KEY = 'tc.progress.v1'`、`function loadProgress(initialComponents: readonly string[]): Progress`、`function saveProgress(p: Progress): void`、`function exportProgress(p: Progress): string`、`function importProgress(json: string): Progress`、`function migrate(raw: unknown): Progress`

- [ ] **Step 1: 写失败测试 `test/app/progress.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import {
  applyGrade,
  emptyProgress,
  isUnlocked,
  paletteDefsFor,
  resumePointOf,
  unlockedComponents,
} from '../../src/app/progress';
import type { GradeResult } from '../../src/levels/grader';
import type { LevelSpec } from '../../src/levels/spec';

const level: LevelSpec = {
  id: 'ch1-02-nand-gate',
  chapter: 1,
  index: 2,
  name: { zh: '与非门', en: 'NAND' },
  brief: { zh: '', en: '' },
  hint: { zh: '', en: '' },
  allowedComponents: ['nand', 'level_input', 'level_output'],
  io: { inputs: [], outputs: [{ id: 'out', width: 1 }] },
  checks: [],
  rewards: { components: ['not'] },
};

const other: LevelSpec = { ...level, id: 'ch1-03-not-gate', index: 3, allowedComponents: ['nand', 'not'] };
const levels = [level, other];

const pass: GradeResult = {
  passed: true,
  metrics: { gate: 2, delay: 2, tick: 0 },
  score: 10,
  stars: 3,
  failures: [],
  issues: [],
};

describe('isUnlocked', () => {
  const order = ['a', 'b', 'c'];
  it('unlocks the first level from the start', () => {
    expect(isUnlocked(emptyProgress(), 'a', order)).toBe(true);
  });
  it('locks later levels until the previous one passes', () => {
    expect(isUnlocked(emptyProgress(), 'b', order)).toBe(false);
  });
  it('unlocks the next level once the previous one passes', () => {
    const p = applyGrade(emptyProgress(), { ...level, id: 'a' }, pass);
    expect(isUnlocked(p, 'b', order)).toBe(true);
    expect(isUnlocked(p, 'c', order)).toBe(false);
  });
  it('throws for ids outside the order', () => {
    expect(() => isUnlocked(emptyProgress(), 'zzz', order)).toThrow(/unknown level/i);
  });
});

describe('resumePointOf', () => {
  const order = ['a', 'b', 'c'];
  const pass: GradeResult = {
    passed: true,
    metrics: { gate: 1, delay: 1, tick: 0 },
    score: 5,
    stars: 3,
    failures: [],
    issues: [],
  };

  it('starts at the first level', () => {
    expect(resumePointOf(emptyProgress(), order)).toBe('a');
  });

  it('advances past a passed level', () => {
    const p = applyGrade(emptyProgress(), { ...level, id: 'a' }, pass);
    expect(resumePointOf(p, order)).toBe('b');
  });

  it('stays at the newest level when everything is passed', () => {
    const p1 = applyGrade(emptyProgress(), { ...level, id: 'a' }, pass);
    const p2 = applyGrade(p1, { ...level, id: 'b' }, pass);
    const p3 = applyGrade(p2, { ...level, id: 'c' }, pass);
    expect(resumePointOf(p3, order)).toBe('c');
  });
});

describe('unlockedComponents', () => {
  it('always offers the level IO plumbing so a level is never unbuildable', () => {
    const unlocked = unlockedComponents(emptyProgress(), levels);
    expect(unlocked.has('level_input')).toBe(true);
    expect(unlocked.has('level_output')).toBe(true);
    expect(unlocked.has('nand')).toBe(false);
  });

  it('adds a reward only after its level is passed', () => {
    const p = applyGrade(emptyProgress(), level, pass);
    expect(unlockedComponents(p, levels).has('not')).toBe(true);
  });

  it('paletteDefsFor filters the level list down to what is unlocked', () => {
    expect(paletteDefsFor(emptyProgress(), levels, other)).toEqual([
      'level_input',
      'level_output',
    ]);
    const p = applyGrade(emptyProgress(), level, pass);
    expect(paletteDefsFor(p, levels, other)).toEqual(['nand', 'not', 'level_input', 'level_output']);
  });
});

describe('applyGrade', () => {
  it('does not mutate the input progress', () => {
    const before = emptyProgress();
    const after = applyGrade(before, level, pass);
    expect(before.levels[level.id]).toBeUndefined();
    expect(after.levels[level.id]?.passed).toBe(true);
  });

  it('keeps the best score only when it improves', () => {
    const better: GradeResult = { ...pass, metrics: { gate: 1, delay: 1, tick: 0 }, score: 5, stars: 3 };
    const worse: GradeResult = { ...pass, metrics: { gate: 9, delay: 9, tick: 9 }, score: 99, stars: 1 };
    const a = applyGrade(emptyProgress(), level, pass);
    const b = applyGrade(a, level, better);
    expect(b.levels[level.id]?.best).toEqual({ gate: 1, delay: 1, tick: 0 });
    const c = applyGrade(b, level, worse);
    expect(c.levels[level.id]?.best).toEqual({ gate: 1, delay: 1, tick: 0 });
    expect(c.levels[level.id]?.stars).toBe(3);
  });

  it('ignores a failed attempt', () => {
    const failed: GradeResult = { ...pass, passed: false, stars: 0, score: 0 };
    const p = applyGrade(emptyProgress(), level, failed);
    expect(p.levels[level.id]).toBeUndefined();
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `pnpm test test/app/progress.test.ts`
Expected: FAIL — 无法解析 `../../src/app/progress`

- [ ] **Step 3: 实现 `src/app/progress.ts`**

```ts
import type { GradeResult, Metrics } from '../levels/grader';
import type { LevelSpec } from '../levels/spec';

export interface LevelRecord {
  passed: boolean;
  best: Metrics | null;
  stars: 0 | 1 | 3;
}

export interface Progress {
  version: 1;
  levels: Record<string, LevelRecord>;
}

/** Components that exist to route level I/O, always offered in the palette. */
export const PLUMBING = ['level_input', 'level_output'] as const;

/** Must match SCORE_WEIGHTS in levels/grader.ts. */
const SCORE_WEIGHTS = { delay: 4, tick: 8 } as const;

export function emptyProgress(): Progress {
  return { version: 1, levels: {} };
}

export function isUnlocked(
  progress: Progress,
  levelId: string,
  order: readonly string[],
): boolean {
  const index = order.indexOf(levelId);
  if (index < 0) throw new Error(`unknown level: ${levelId}`);
  if (index === 0) return true;
  const previous = order[index - 1]!;
  return progress.levels[previous]?.passed === true;
}

/** First reachable level that has not been passed; the last level if all are. */
export function resumePointOf(progress: Progress, order: readonly string[]): string {
  for (const id of order) {
    if (isUnlocked(progress, id, order) && progress.levels[id]?.passed !== true) return id;
  }
  return order[order.length - 1]!;
}

/**
 * The unlocked component set is *derived*, not stored: every reward from a
 * passed level, plus the level-IO plumbing. Storing it as well would let the
 * two drift apart after an import from an older save.
 */
export function unlockedComponents(
  progress: Progress,
  levels: readonly LevelSpec[],
): Set<string> {
  const unlocked = new Set<string>(PLUMBING);
  for (const level of levels) {
    if (progress.levels[level.id]?.passed !== true) continue;
    for (const component of level.rewards?.components ?? []) unlocked.add(component);
  }
  return unlocked;
}

/** Parts offered by this level that the player has actually unlocked. */
export function paletteDefsFor(
  progress: Progress,
  levels: readonly LevelSpec[],
  level: LevelSpec,
): string[] {
  const unlocked = unlockedComponents(progress, levels);
  return level.allowedComponents.filter((def) => unlocked.has(def));
}

/** Records a pass: keeps the best score and the best star rating. Pure. */
export function applyGrade(
  progress: Progress,
  level: LevelSpec,
  result: GradeResult,
): Progress {
  if (!result.passed) return progress;

  const next: Progress = { version: 1, levels: { ...progress.levels } };
  const previous = progress.levels[level.id];
  const best = previous?.best ?? null;
  const improved =
    best === null ||
    result.score <
      best.gate + best.delay * SCORE_WEIGHTS.delay + best.tick * SCORE_WEIGHTS.tick;

  next.levels[level.id] = {
    passed: true,
    best: improved ? { ...result.metrics } : best,
    stars: Math.max(previous?.stars ?? 0, result.stars) as 0 | 1 | 3,
  };
  return next;
}
```

- [ ] **Step 4: 写失败测试 `test/persist/storage.test.ts`**

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { applyGrade, emptyProgress } from '../../src/app/progress';
import { exportProgress, importProgress, migrate } from '../../src/persist/storage';
import type { GradeResult } from '../../src/levels/grader';
import type { LevelSpec } from '../../src/levels/spec';

const level: LevelSpec = {
  id: 'ch1-01',
  chapter: 1,
  index: 1,
  name: { zh: '', en: '' },
  brief: { zh: '', en: '' },
  hint: { zh: '', en: '' },
  allowedComponents: [],
  io: { inputs: [], outputs: [{ id: 'out', width: 1 }] },
  checks: [],
  rewards: { components: ['nand'] },
};

const pass: GradeResult = {
  passed: true,
  metrics: { gate: 1, delay: 1, tick: 0 },
  score: 5,
  stars: 3,
  failures: [],
  issues: [],
};

describe('export / import round trip', () => {
  it('preserves progress exactly through a round trip', () => {
    const p = applyGrade(emptyProgress(), level, pass);
    const restored = importProgress(exportProgress(p));
    expect(restored).toEqual(p);
  });

  it('rejects malformed json', () => {
    expect(() => importProgress('{not json')).toThrow();
  });

  it('rejects a payload from a future version', () => {
    expect(() =>
      importProgress(JSON.stringify({ version: 99, levels: {} })),
    ).toThrow(/version/i);
  });
});

describe('migrate', () => {
  it('accepts a v1 payload unchanged', () => {
    const p = emptyProgress();
    expect(migrate(JSON.parse(JSON.stringify(p)))).toEqual(p);
  });

  it('repairs a v1 payload with a missing levels map', () => {
    expect(migrate({ version: 1 }).levels).toEqual({});
  });

  it('drops a stale top-level unlockedComponents field', () => {
    // the unlocked set is derived now; an old save must not resurrect it
    const migrated = migrate({ version: 1, levels: {}, unlockedComponents: ['nand'] });
    expect(migrated).toEqual({ version: 1, levels: {} });
  });

  it('throws for unknown shapes', () => {
    expect(() => migrate(null)).toThrow(/progress/i);
    expect(() => migrate({ version: 'one' })).toThrow(/progress/i);
  });
});
```

- [ ] **Step 5: 实现 `src/persist/storage.ts`**

```ts
import type { Progress } from '../app/progress';
import { emptyProgress } from '../app/progress';

export const STORAGE_KEY = 'tc.progress.v1';

export function migrate(raw: unknown): Progress {
  if (raw === null || typeof raw !== 'object') {
    throw new Error('not a progress payload');
  }
  const obj = raw as Record<string, unknown>;
  if (obj.version !== 1) {
    throw new Error(`unsupported progress version: ${String(obj.version)}`);
  }
  const levels =
    obj.levels !== null && typeof obj.levels === 'object'
      ? (obj.levels as Progress['levels'])
      : {};
  return { version: 1, levels };
}

export function loadProgress(): Progress {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (!raw) return emptyProgress();
    return migrate(JSON.parse(raw));
  } catch {
    return emptyProgress();
  }
}

export function saveProgress(progress: Progress): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(progress));
  } catch {
    /* storage unavailable (private mode, tests): progress stays in memory */
  }
}

export function exportProgress(progress: Progress): string {
  return JSON.stringify(progress, null, 2);
}

export function importProgress(json: string): Progress {
  return migrate(JSON.parse(json));
}
```

- [ ] **Step 6: 写失败测试 `test/app/commands.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { addInstance, emptyGraph, removeInstance } from '../../src/core/graph';
import { CommandStack } from '../../src/app/commands';

describe('CommandStack', () => {
  it('undoes and redoes an add', () => {
    const g = emptyGraph();
    const stack = new CommandStack();
    const inst = addInstance(g, 'nand', 10, 10);
    stack.push(
      {
        label: 'add nand',
        do: (graph) => void graph.instances.push(inst),
        undo: (graph) => removeInstance(graph, inst.id),
      },
      g,
    );
    expect(g.instances).toHaveLength(1);
    expect(stack.undo(g)).toBe(true);
    expect(g.instances).toHaveLength(0);
    expect(stack.redo(g)).toBe(true);
    expect(g.instances).toHaveLength(1);
  });

  it('reports when there is nothing to undo', () => {
    const stack = new CommandStack();
    expect(stack.undo(emptyGraph())).toBe(false);
    expect(stack.canUndo()).toBe(false);
  });

  it('drops the redo branch after a new command', () => {
    const g = emptyGraph();
    const stack = new CommandStack();
    const a = addInstance(g, 'nand', 0, 0);
    stack.push({ label: 'a', do: () => {}, undo: () => removeInstance(g, a.id) }, g);
    stack.undo(g);
    expect(stack.canRedo()).toBe(true);
    stack.push({ label: 'b', do: () => {}, undo: () => {} }, g);
    expect(stack.canRedo()).toBe(false);
  });

  it('caps history depth', () => {
    const g = emptyGraph();
    const stack = new CommandStack(3);
    for (let i = 0; i < 10; i += 1) {
      stack.push({ label: `c${i}`, do: () => {}, undo: () => {} }, g);
    }
    expect(stack.depth).toBe(3);
  });
});
```

- [ ] **Step 7: 实现 `src/app/commands.ts`**

```ts
import type { Graph } from '../core/graph';

export interface Command {
  readonly label: string;
  do(graph: Graph): void;
  undo(graph: Graph): void;
}

export class CommandStack {
  readonly #limit: number;
  #undo: Command[] = [];
  #redo: Command[] = [];

  constructor(limit = 200) {
    this.#limit = limit;
  }

  get depth(): number {
    return this.#undo.length;
  }

  canUndo(): boolean {
    return this.#undo.length > 0;
  }

  canRedo(): boolean {
    return this.#redo.length > 0;
  }

  push(command: Command, graph: Graph): void {
    command.do(graph);
    this.#undo.push(command);
    if (this.#undo.length > this.#limit) this.#undo.shift();
    this.#redo = [];
  }

  undo(graph: Graph): boolean {
    const command = this.#undo.pop();
    if (!command) return false;
    command.undo(graph);
    this.#redo.push(command);
    return true;
  }

  redo(graph: Graph): boolean {
    const command = this.#redo.pop();
    if (!command) return false;
    command.do(graph);
    this.#undo.push(command);
    return true;
  }

  clear(): void {
    this.#undo = [];
    this.#redo = [];
  }
}
```

- [ ] **Step 8: 运行测试，确认通过**

Run: `pnpm test test/app test/persist`
Expected: PASS — 全部通过

- [ ] **Step 9: 提交**

```bash
git add src/app src/persist test/app test/persist
git commit -m "feat(app): add progress model, command stack and local storage"
```

---

## Task 11: UI 外壳、画板与调色板

**Files:**
- Create: `src/app/store.ts`, `src/ui/theme.ts`, `src/ui/shell.ts`, `src/ui/board/view.ts`, `src/ui/board/render.ts`, `src/ui/board/interact.ts`, `src/ui/palette.ts`, `src/ui/truthTable.ts`
- Modify: `src/main.ts`
- Test: `test/ui/view.test.ts`（相机与命中检测的纯函数测试；Canvas 绘制本身靠 Task 12 的冒烟测试）

**Interfaces:**
- Consumes: `Graph`、`CommandStack`、`grade`、`LevelSpec`、`Progress`
- Produces:
  - `src/ui/theme.ts`：`const THEME = { bg, grid, gridMajor, wireOff, wireOn, componentFill, componentStroke, pinOff, pinOn, selection, text, accent } as const`、`const GRID = 8`、`const PIN_RADIUS = 4`
  - `src/ui/board/view.ts`：`interface Camera { x: number; y: number; zoom: number }`、`function worldToScreen(c: Camera, p: {x:number;y:number}): {x:number;y:number}`、`function screenToWorld(c: Camera, p: {x:number;y:number}): {x:number;y:number}`、`function snap(v: number): number`、`function pinPosition(inst: Instance, def: ComponentDef, pinId: string, isInput: boolean): {x:number;y:number}`、`function hitTest(graph: Graph, registry: Registry, world: {x:number;y:number}): { kind: 'instance'; id: string } | { kind: 'pin'; inst: string; port: string; isInput: boolean } | { kind: 'wire'; id: string } | null`
  - `src/app/store.ts`：`interface AppState { level: LevelSpec; graph: Graph; registry: Registry; progress: Progress; camera: Camera; selected: string[]; dragging: DragState | null; lastGrade: GradeResult | null }`、`function createStore(initial: AppState): Store`、`interface Store { get(): AppState; set(patch: Partial<AppState>): void; subscribe(fn: (s: AppState) => void): () => void; update(fn: (s: AppState) => AppState): void }`
  - `src/ui/shell.ts`：`function mountShell(root: HTMLElement, store: Store): { render(): void }`
  - `src/ui/palette.ts`：`function mountPalette(root: HTMLElement, store: Store): { render(): void }`
  - `src/ui/truthTable.ts`：`function mountTruthTable(root: HTMLElement, store: Store): { render(): void }`
  - `src/ui/board/render.ts`：`function renderBoard(canvas: HTMLCanvasElement, store: Store, camera: Camera): void`
  - `src/ui/board/interact.ts`：`function attachBoardInput(canvas: HTMLCanvasElement, store: Store, stack: CommandStack): () => void`

- [ ] **Step 1: 写失败测试 `test/ui/view.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { addInstance, emptyGraph } from '../../src/core/graph';
import { BASE_DEFS } from '../../src/core/defs/index';
import { createRegistry } from '../../src/core/registry';
import { hitTest, screenToWorld, snap, worldToScreen } from '../../src/ui/board/view';

const registry = createRegistry(BASE_DEFS);

describe('camera', () => {
  it('round-trips world and screen coordinates', () => {
    const camera = { x: 100, y: 50, zoom: 2 };
    const world = { x: 13, y: 27 };
    const screen = worldToScreen(camera, world);
    expect(screenToWorld(camera, screen)).toEqual(world);
  });

  it('translates without scaling when zoom is 1', () => {
    expect(worldToScreen({ x: 10, y: 20, zoom: 1 }, { x: 5, y: 5 })).toEqual({ x: 15, y: 25 });
  });
});

describe('snap', () => {
  it('snaps to the 8 pixel grid', () => {
    expect(snap(0)).toBe(0);
    expect(snap(3)).toBe(0);
    expect(snap(5)).toBe(8);
    expect(snap(13)).toBe(16);
    expect(Object.is(snap(-3), 0)).toBe(true); // -0 and 0 are the same grid cell
  });
});

describe('hitTest', () => {
  it('finds an instance by its body', () => {
    const g = emptyGraph();
    const inst = addInstance(g, 'nand', 100, 100);
    const hit = hitTest(g, registry, { x: 100, y: 100 });
    expect(hit).toEqual({ kind: 'instance', id: inst.id });
  });

  it('prefers a pin over the body underneath it', () => {
    const g = emptyGraph();
    const inst = addInstance(g, 'nand', 100, 100);
    const pin = { inst: inst.id, port: 'a', isInput: true };
    const pos = pinPosition(g.instances[0]!, registry.get('nand'), 'a', true);
    const hit = hitTest(g, registry, pos);
    expect(hit).toEqual({ kind: 'pin', ...pin });
  });

  it('returns null in empty space', () => {
    expect(hitTest(emptyGraph(), registry, { x: 5000, y: 5000 })).toBeNull();
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `pnpm test test/ui/view.test.ts`
Expected: FAIL — 无法解析 `../../src/ui/board/view`

- [ ] **Step 3: 实现 `src/ui/theme.ts`**

```ts
/** Original dark industrial palette. No colours are taken from the original game. */
export const THEME = {
  bg: '#0d1117',
  panel: '#161b22',
  panelBorder: '#30363d',
  grid: '#1b2029',
  gridMajor: '#242b36',
  wireOff: '#3d4759',
  wireOn: '#2fd4a7',
  componentFill: '#1e2530',
  componentStroke: '#4a5568',
  componentText: '#c9d1d9',
  pinOff: '#4a5568',
  pinOn: '#2fd4a7',
  selection: '#58a6ff',
  error: '#f85149',
  success: '#3fb950',
  text: '#c9d1d9',
  textMuted: '#7d8590',
  accent: '#2fd4a7',
} as const;

export const GRID = 8;
export const PIN_RADIUS = 4;
export const INSTANCE_WIDTH = 64;
export const INSTANCE_HEIGHT = 48;
```

- [ ] **Step 4: 实现 `src/ui/board/view.ts`**

```ts
import type { ComponentDef, Registry } from '../../core/registry';
import type { Graph, Instance } from '../../core/graph';
import { GRID, INSTANCE_HEIGHT, INSTANCE_WIDTH, PIN_RADIUS } from '../theme';

export interface Camera {
  x: number;
  y: number;
  zoom: number;
}

export interface Point {
  x: number;
  y: number;
}

export function worldToScreen(camera: Camera, p: Point): Point {
  return { x: (p.x + camera.x) * camera.zoom, y: (p.y + camera.y) * camera.zoom };
}

export function screenToWorld(camera: Camera, p: Point): Point {
  return { x: p.x / camera.zoom - camera.x, y: p.y / camera.zoom - camera.y };
}

export function snap(v: number): number {
  return Math.round(v / GRID) * GRID;
}

export function instanceRect(inst: Instance): { x: number; y: number; w: number; h: number } {
  return { x: inst.x, y: inst.y, w: INSTANCE_WIDTH, h: INSTANCE_HEIGHT };
}

/** Pin layout: inputs along the left edge, outputs along the right edge. */
export function pinPosition(
  inst: Instance,
  def: ComponentDef,
  pinId: string,
  isInput: boolean,
): Point {
  const pins = isInput ? def.inputs : def.outputs;
  const index = pins.findIndex((p) => p.id === pinId);
  const count = Math.max(1, pins.length);
  const y = inst.y + INSTANCE_HEIGHT / 2 + (index - (count - 1) / 2) * 14;
  const x = isInput ? inst.x : inst.x + INSTANCE_WIDTH;
  return { x, y };
}

export type Hit =
  | { kind: 'instance'; id: string }
  | { kind: 'pin'; inst: string; port: string; isInput: boolean }
  | { kind: 'wire'; id: string }
  | null;

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function pointInRect(p: Point, r: { x: number; y: number; w: number; h: number }): boolean {
  return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
}

function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return distance(p, a);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq));
  return distance(p, { x: a.x + t * dx, y: a.y + t * dy });
}

export function hitTest(graph: Graph, registry: Registry, world: Point): Hit {
  const tolerance = PIN_RADIUS + 3;
  // pins first, then wires, then bodies -- smallest target wins
  for (const inst of graph.instances) {
    if (!registry.has(inst.def)) continue;
    const def = registry.get(inst.def);
    for (const pin of def.inputs) {
      if (distance(pinPosition(inst, def, pin.id, true), world) <= tolerance) {
        return { kind: 'pin', inst: inst.id, port: pin.id, isInput: true };
      }
    }
    for (const pin of def.outputs) {
      if (distance(pinPosition(inst, def, pin.id, false), world) <= tolerance) {
        return { kind: 'pin', inst: inst.id, port: pin.id, isInput: false };
      }
    }
  }

  const byId = new Map(graph.instances.map((i) => [i.id, i]));
  for (const wire of graph.wires) {
    const from = byId.get(wire.from.inst);
    const to = byId.get(wire.to.inst);
    if (!from || !to) continue;
    const fromDef = registry.has(from.def) ? registry.get(from.def) : null;
    const toDef = registry.has(to.def) ? registry.get(to.def) : null;
    if (!fromDef || !toDef) continue;
    const a = pinPosition(from, fromDef, wire.from.port, false);
    const b = pinPosition(to, toDef, wire.to.port, true);
    if (distanceToSegment(world, a, b) <= 4) return { kind: 'wire', id: wire.id };
  }

  for (let i = graph.instances.length - 1; i >= 0; i -= 1) {
    const inst = graph.instances[i]!;
    if (pointInRect(world, instanceRect(inst))) return { kind: 'instance', id: inst.id };
  }
  return null;
}
```

- [ ] **Step 5: 运行测试，确认通过**

Run: `pnpm test test/ui/view.test.ts`
Expected: PASS — 6 passed

- [ ] **Step 6: 实现 `src/app/store.ts`**

```ts
import type { Graph } from '../core/graph';
import type { Registry } from '../core/registry';
import type { GradeResult } from '../levels/grader';
import type { LevelSpec } from '../levels/spec';
import type { Progress } from './progress';
import type { Camera } from '../ui/board/view';

export type DragState =
  | { kind: 'instance'; ids: string[]; offsetX: number; offsetY: number }
  | { kind: 'wire'; fromInst: string; fromPort: string }
  | { kind: 'pan'; lastX: number; lastY: number }
  | { kind: 'marquee'; x0: number; y0: number; x1: number; y1: number };

export interface AppState {
  level: LevelSpec;
  graph: Graph;
  registry: Registry;
  progress: Progress;
  camera: Camera;
  selected: string[];
  dragging: DragState | null;
  lastGrade: GradeResult | null;
  status: { zh: string; en: string } | null;
}

export interface Store {
  get(): AppState;
  set(patch: Partial<AppState>): void;
  update(fn: (state: AppState) => AppState): void;
  subscribe(listener: (state: AppState) => void): () => void;
}

export function createStore(initial: AppState): Store {
  let state = initial;
  const listeners = new Set<(s: AppState) => void>();
  const emit = (): void => {
    for (const listener of listeners) listener(state);
  };
  return {
    get: () => state,
    set(patch) {
      state = { ...state, ...patch };
      emit();
    },
    update(fn) {
      state = fn(state);
      emit();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
```

- [ ] **Step 7: 实现 `src/ui/board/render.ts`（Canvas 分层绘制）**

```ts
import { GRID, INSTANCE_HEIGHT, INSTANCE_WIDTH, PIN_RADIUS, THEME } from '../theme';
import type { Store } from '../../app/store';
import { instanceRect, pinPosition, worldToScreen, type Camera } from './view';
import type { Instance } from '../../core/graph';

function drawGrid(ctx: CanvasRenderingContext2D, camera: Camera, w: number, h: number): void {
  const step = GRID * camera.zoom;
  if (step < 4) return;
  ctx.lineWidth = 1;
  const ox = (camera.x * camera.zoom) % (step * 4);
  const oy = (camera.y * camera.zoom) % (step * 4);
  for (let i = 0; i < 5; i += 1) {
    ctx.strokeStyle = i === 0 ? THEME.gridMajor : THEME.grid;
    ctx.beginPath();
    const x = ox + i * step * 4;
    if (x >= 0 && x <= w) {
      ctx.moveTo(Math.round(x) + 0.5, 0);
      ctx.lineTo(Math.round(x) + 0.5, h);
    }
    const y = oy + i * step * 4;
    if (y >= 0 && y <= h) {
      ctx.moveTo(0, Math.round(y) + 0.5);
      ctx.lineTo(w, Math.round(y) + 0.5);
    }
    ctx.stroke();
  }
}

function drawInstance(
  ctx: CanvasRenderingContext2D,
  store: Store,
  inst: Instance,
  camera: Camera,
): void {
  const { registry, selected, graph } = store.get();
  if (!registry.has(inst.def)) return;
  const def = registry.get(inst.def);
  const rect = instanceRect(inst);
  const p = worldToScreen(camera, { x: rect.x, y: rect.y });
  const w = rect.w * camera.zoom;
  const h = rect.h * camera.zoom;
  const isSelected = selected.includes(inst.id);

  ctx.fillStyle = THEME.componentFill;
  ctx.strokeStyle = isSelected ? THEME.selection : THEME.componentStroke;
  ctx.lineWidth = isSelected ? 2 : 1;
  ctx.beginPath();
  ctx.roundRect(p.x, p.y, w, h, 4 * camera.zoom);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = THEME.componentText;
  ctx.font = `${Math.max(9, 11 * camera.zoom)}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(def.name.zh, p.x + w / 2, p.y + h / 2);

  for (const pin of def.inputs) {
    const pos = worldToScreen(camera, pinPosition(inst, def, pin.id, true));
    ctx.fillStyle = THEME.pinOff;
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, PIN_RADIUS * camera.zoom, 0, Math.PI * 2);
    ctx.fill();
  }
  for (const pin of def.outputs) {
    const pos = worldToScreen(camera, pinPosition(inst, def, pin.id, false));
    ctx.fillStyle = THEME.pinOff;
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, PIN_RADIUS * camera.zoom, 0, Math.PI * 2);
    ctx.fill();
  }

  void graph;
}

export function renderBoard(canvas: HTMLCanvasElement, store: Store, camera: Camera): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const dpr = globalThis.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = THEME.bg;
  ctx.fillRect(0, 0, w, h);
  drawGrid(ctx, camera, w, h);

  const { graph, registry } = store.get();
  // wires under components
  ctx.strokeStyle = THEME.wireOff;
  ctx.lineWidth = Math.max(1, 1.5 * camera.zoom);
  for (const wire of graph.wires) {
    const from = graph.instances.find((i) => i.id === wire.from.inst);
    const to = graph.instances.find((i) => i.id === wire.to.inst);
    if (!from || !to || !registry.has(from.def) || !registry.has(to.def)) continue;
    const fromDef = registry.get(from.def);
    const toDef = registry.get(to.def);
    const a = worldToScreen(camera, pinPosition(from, fromDef, wire.from.port, false));
    const b = worldToScreen(camera, pinPosition(to, toDef, wire.to.port, true));
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.bezierCurveTo(a.x + 30 * camera.zoom, a.y, b.x - 30 * camera.zoom, b.y, b.x, b.y);
    ctx.stroke();
  }

  for (const inst of graph.instances) drawInstance(ctx, store, inst, camera);
  void INSTANCE_WIDTH;
  void INSTANCE_HEIGHT;
}
```

- [ ] **Step 8: 实现 `src/ui/board/interact.ts`**

```ts
import { addInstance, connect, disconnect, removeInstance, type WireEnd } from '../../core/graph';
import type { CommandStack } from '../../app/commands';
import type { Store } from '../../app/store';
import { hitTest, screenToWorld, snap, type Camera } from './view';

export interface BoardInputOptions {
  /** Called after any model mutation so the UI can re-render and re-grade. */
  onChange(): void;
}

export function attachBoardInput(
  canvas: HTMLCanvasElement,
  store: Store,
  stack: CommandStack,
  options: BoardInputOptions,
): () => void {
  let pendingFrom: WireEnd | null = null;
  let panning: { x: number; y: number } | null = null;

  const localPoint = (event: PointerEvent): { x: number; y: number } => {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const worldPoint = (event: PointerEvent): { x: number; y: number } => {
    const camera = store.get().camera as Camera;
    return screenToWorld(camera, localPoint(event));
  };

  const onPointerDown = (event: PointerEvent): void => {
    canvas.setPointerCapture(event.pointerId);
    const world = worldPoint(event);
    const hit = hitTest(store.get().graph, store.get().registry, world);

    if (event.button === 1 || event.shiftKey) {
      panning = localPoint(event);
      return;
    }

    if (hit?.kind === 'pin' && !hit.isInput) {
      pendingFrom = { inst: hit.inst, port: hit.port };
      return;
    }

    if (hit?.kind === 'pin' && hit.isInput) {
      const existing = store
        .get()
        .graph.wires.find((w) => w.to.inst === hit.inst && w.to.port === hit.port);
      if (existing) {
        stack.push(
          {
            label: 'disconnect',
            do: (g) => disconnect(g, existing.id),
            undo: (g) => void g.wires.push(existing),
          },
          store.get().graph,
        );
        options.onChange();
      }
      return;
    }

    if (hit?.kind === 'instance') {
      store.set({ selected: [hit.id] });
      return;
    }

    if (hit?.kind === 'wire') {
      const wire = store.get().graph.wires.find((w) => w.id === hit.id);
      if (wire) {
        stack.push(
          {
            label: 'delete wire',
            do: (g) => disconnect(g, wire.id),
            undo: (g) => void g.wires.push(wire),
          },
          store.get().graph,
        );
        options.onChange();
      }
      return;
    }

    // empty space: click places the currently selected palette part
    const pendingDef = (canvas.dataset.pendingDef ?? '').trim();
    if (pendingDef) {
      const x = snap(world.x);
      const y = snap(world.y);
      let created: string | null = null;
      stack.push(
        {
          label: `add ${pendingDef}`,
          do: (g) => {
            const inst = addInstance(g, pendingDef, x, y);
            created = inst.id;
          },
          undo: (g) => {
            if (created) removeInstance(g, created);
          },
        },
        store.get().graph,
      );
      options.onChange();
    } else {
      store.set({ selected: [] });
    }
  };

  const onPointerMove = (event: PointerEvent): void => {
    if (panning) {
      const now = localPoint(event);
      const camera = store.get().camera;
      store.set({
        camera: {
          ...camera,
          x: camera.x + (now.x - panning.x) / camera.zoom,
          y: camera.y + (now.y - panning.y) / camera.zoom,
        },
      });
      panning = now;
    }
  };

  const onPointerUp = (event: PointerEvent): void => {
    panning = null;
    if (!pendingFrom) return;
    const world = worldPoint(event);
    const hit = hitTest(store.get().graph, store.get().registry, world);
    if (hit?.kind === 'pin' && hit.isInput) {
      const from = pendingFrom;
      const to: WireEnd = { inst: hit.inst, port: hit.port };
      const existing = store
        .get()
        .graph.wires.filter((w) => w.to.inst === to.inst && w.to.port === to.port);
      let createdId: string | null = null;
      stack.push(
        {
          label: 'connect',
          do: (g) => {
            for (const w of existing) disconnect(g, w.id);
            createdId = connect(g, from, to).id;
          },
          undo: (g) => {
            if (createdId) disconnect(g, createdId);
            for (const w of existing) g.wires.push(w);
          },
        },
        store.get().graph,
      );
      options.onChange();
    }
    pendingFrom = null;
  };

  const onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    const camera = store.get().camera;
    const before = screenToWorld(camera, localPoint(event as unknown as PointerEvent));
    const zoom = Math.min(4, Math.max(0.25, camera.zoom * (event.deltaY < 0 ? 1.1 : 1 / 1.1)));
    const next: Camera = { ...camera, zoom };
    const after = screenToWorld(next, localPoint(event as unknown as PointerEvent));
    store.set({ camera: { ...next, x: next.x + (after.x - before.x), y: next.y + (after.y - before.y) } });
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Delete' || event.key === 'Backspace') {
      const ids = store.get().selected;
      if (ids.length === 0) return;
      const removed = store.get().graph.instances.filter((i) => ids.includes(i.id));
      const wires = store
        .get()
        .graph.wires.filter((w) => ids.includes(w.from.inst) || ids.includes(w.to.inst));
      stack.push(
        {
          label: 'delete',
          do: (g) => {
            for (const inst of removed) removeInstance(g, inst.id);
          },
          undo: (g) => {
            for (const inst of removed) g.instances.push(inst);
            for (const w of wires) g.wires.push(w);
          },
        },
        store.get().graph,
      );
      store.set({ selected: [] });
      options.onChange();
    }
  };

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  globalThis.addEventListener('keydown', onKeyDown);

  return () => {
    canvas.removeEventListener('pointerdown', onPointerDown);
    canvas.removeEventListener('pointermove', onPointerMove);
    canvas.removeEventListener('pointerup', onPointerUp);
    canvas.removeEventListener('wheel', onWheel);
    globalThis.removeEventListener('keydown', onKeyDown);
  };
}
```

- [ ] **Step 9: 实现 `src/ui/shell.ts`、`src/ui/palette.ts`、`src/ui/truthTable.ts`、`src/main.ts`**

`src/ui/shell.ts`：

```ts
import type { Store } from '../app/store';
import { THEME } from './theme';

export interface ShellOptions {
  /** Leave the board and show the chapter map. */
  onOpenMap(): void;
}

export function mountShell(
  root: HTMLElement,
  store: Store,
  options: ShellOptions,
): { render(): void } {
  const bar = document.createElement('header');
  bar.className = 'shell-bar';

  const title = document.createElement('span');
  title.className = 'shell-title';

  const mapButton = document.createElement('button');
  mapButton.textContent = '章节地图';
  mapButton.addEventListener('click', () => options.onOpenMap());

  const metrics = document.createElement('span');
  metrics.className = 'shell-metrics';

  bar.append(title, mapButton, metrics);
  // The shell bar must be the first flex child so the screens fill the rest.
  root.prepend(bar);

  const render = (): void => {
    const { level, lastGrade } = store.get();
    title.textContent = `${level.chapter}-${level.index} ${level.name.zh}`;
    if (!lastGrade) {
      metrics.textContent = '尚未评测';
      metrics.style.color = THEME.textMuted;
      return;
    }
    const stars = lastGrade.stars > 0 ? '★'.repeat(lastGrade.stars) : '未通过';
    metrics.textContent = `门 ${lastGrade.metrics.gate} · 延迟 ${lastGrade.metrics.delay} · 拍 ${lastGrade.metrics.tick} · 得分 ${lastGrade.score} · ${stars}`;
    metrics.style.color = lastGrade.passed ? THEME.success : THEME.error;
  };
  store.subscribe(render);
  render();
  return { render };
}
```

`src/ui/palette.ts`：

`src/ui/palette.ts`——用 `paletteDefsFor` 决定这一关实际能放哪些元件，而不是直接读 `level.allowedComponents`：

```ts
import type { Store } from '../app/store';
import { paletteDefsFor } from '../app/progress';
import { LEVELS } from '../levels/index';
import { THEME } from './theme';

export function mountPalette(
  root: HTMLElement,
  store: Store,
  onPick: (defId: string) => void,
): { render(): void } {
  const list = document.createElement('aside');
  list.className = 'palette';
  root.append(list);

  const render = (): void => {
    const { level, progress, registry } = store.get();
    list.replaceChildren();
    const heading = document.createElement('h2');
    heading.textContent = '元件';
    list.append(heading);

    const available = paletteDefsFor(progress, LEVELS, level);
    if (available.length === 0) {
      const empty = document.createElement('span');
      empty.textContent = '本关暂无可用元件';
      empty.style.color = THEME.textMuted;
      list.append(empty);
      return;
    }

    for (const defId of available) {
      const button = document.createElement('button');
      button.className = 'palette-item';
      button.textContent = registry.get(defId).name.zh;
      button.title = `${registry.get(defId).name.en} — 点击后在画板上放置`;
      button.addEventListener('click', () => onPick(defId));
      list.append(button);
    }
  };
  store.subscribe(render);
  render();
  return { render };
}
```

`src/ui/truthTable.ts`：

```ts
import type { Store } from '../app/store';
import { THEME } from './theme';

export function mountTruthTable(root: HTMLElement, store: Store): { render(): void } {
  const panel = document.createElement('section');
  panel.className = 'truth-table';
  root.append(panel);

  const render = (): void => {
    const { lastGrade, level } = store.get();
    panel.replaceChildren();
    const heading = document.createElement('h2');
    heading.textContent = lastGrade?.passed ? '全部用例通过' : '用例';
    heading.style.color = lastGrade?.passed ? THEME.success : THEME.error;
    panel.append(heading);

    if (!lastGrade) return;
    if (lastGrade.passed) {
      const p = document.createElement('p');
      p.textContent = `门 ${lastGrade.metrics.gate} · 延迟 ${lastGrade.metrics.delay} · 拍 ${lastGrade.metrics.tick}`;
      panel.append(p);
      return;
    }
    const table = document.createElement('table');
    const header = document.createElement('tr');
    for (const pin of level.io.inputs) header.append(cell(pin.id));
    for (const pin of level.io.outputs) header.append(cell(pin.id));
    table.append(header);
    for (const failure of lastGrade.failures.slice(0, 20)) {
      const row = document.createElement('tr');
      for (const pin of level.io.inputs) row.append(cell(String(failure.inputs[pin.id] ?? 0)));
      for (const pin of level.io.outputs) {
        const want = failure.expected[pin.id];
        const got = failure.actual[pin.id];
        const c = cell(want === undefined ? String(got ?? 0) : `${got ?? 0} ≠ ${want}`);
        if (want !== undefined && got !== want) c.style.color = THEME.error;
        row.append(c);
      }
      table.append(row);
    }
    panel.append(table);
  };
  store.subscribe(render);
  render();
  return { render };
}

function cell(text: string): HTMLTableCellElement {
  const td = document.createElement('td');
  td.textContent = text;
  return td;
}
```

`src/main.ts`——本任务先立骨架：画板、调色板、真值表、存档、切关逻辑都到位，**地图与叙事浮层留到 Task 12 接**（`onOpenMap` 先注册成空实现，`showBriefing` 函数先写在这里但只做占位调用）：

```ts
import './ui/style.css';
import { createRegistry } from './core/registry';
import { BASE_DEFS } from './core/defs/index';
import { emptyGraph } from './core/graph';
import { getLevel, LEVEL_ORDER } from './levels/index';
import { createStore } from './app/store';
import { CommandStack } from './app/commands';
import { grade } from './levels/grader';
import { loadProgress, saveProgress } from './persist/storage';
import { applyGrade, resumePointOf, type Progress } from './app/progress';
import { mountShell } from './ui/shell';
import { mountPalette } from './ui/palette';
import { mountTruthTable } from './ui/truthTable';
import { renderBoard } from './ui/board/render';
import { attachBoardInput } from './ui/board/interact';
import type { LevelSpec } from './levels/spec';

const registry = createRegistry(BASE_DEFS);
let progress: Progress = loadProgress();

const level: LevelSpec = getLevel(resumePointOf(progress, LEVEL_ORDER));

const store = createStore({
  level,
  graph: emptyGraph(level.id),
  registry,
  progress,
  camera: { x: 40, y: 40, zoom: 1 },
  selected: [],
  dragging: null,
  lastGrade: null,
  status: null,
});

const stack = new CommandStack();
const app = document.querySelector<HTMLDivElement>('#app');

if (app) {
  // Order matters: the shell bar must be the first flex child.
  const screens = document.createElement('div');
  screens.className = 'screens';
  const boardScreen = document.createElement('div');
  boardScreen.className = 'screen screen-board';
  const mapScreen = document.createElement('div');
  mapScreen.className = 'screen screen-map';
  mapScreen.hidden = true;
  screens.append(boardScreen, mapScreen);
  app.append(screens);

  const canvas = document.createElement('canvas');
  canvas.className = 'board';
  boardScreen.append(canvas);

  const showScreen = (which: 'board' | 'map'): void => {
    boardScreen.hidden = which !== 'board';
    mapScreen.hidden = which !== 'map';
    if (which === 'board') renderBoard(canvas, store, store.get().camera);
  };

  const onPick = (defId: string): void => {
    canvas.dataset.pendingDef = defId;
    store.set({ status: null });
  };

  const openLevel = (levelId: string): void => {
    const next = getLevel(levelId);
    stack.clear();
    store.set({
      level: next,
      graph: emptyGraph(next.id),
      selected: [],
      lastGrade: null,
      status: null,
    });
    showScreen('board');
  };

  const regrade = (): void => {
    const { graph: g, level: l, progress: p } = store.get();
    const result = grade(g, registry, l);
    store.set({ lastGrade: result });
    if (result.passed) {
      progress = applyGrade(p, l, result);
      saveProgress(progress);
      store.set({ progress });
    }
  };

  // Task 12 replaces this with the real chapter map.
  const openMap = (): void => {
    showScreen('map');
  };

  mountShell(app, store, { onOpenMap: openMap });
  mountPalette(boardScreen, store, onPick);
  mountTruthTable(boardScreen, store);
  attachBoardInput(canvas, store, stack, { onChange: regrade });

  // Render on state change only: a continuous rAF loop would repaint a static
  // board 60 times a second forever. Panning and zooming go through store.set,
  // so they still repaint every frame they actually change something.
  store.subscribe(() => {
    if (!boardScreen.hidden) renderBoard(canvas, store, store.get().camera);
  });
  globalThis.addEventListener('resize', () => {
    if (!boardScreen.hidden) renderBoard(canvas, store, store.get().camera);
  });

  renderBoard(canvas, store, store.get().camera);
}
```

配套 `src/ui/style.css`：

```css
:root {
  color-scheme: dark;
  font-family: system-ui, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;
}
* { box-sizing: border-box; }
html, body { margin: 0; height: 100%; background: #0d1117; color: #c9d1d9; }
#app { display: flex; flex-direction: column; height: 100vh; }
.shell-bar { display: flex; align-items: center; gap: 16px; padding: 8px 16px; background: #161b22; border-bottom: 1px solid #30363d; flex: 0 0 auto; }
.shell-title { font-weight: 600; }
.shell-metrics { font-variant-numeric: tabular-nums; }
.palette { display: flex; flex-wrap: wrap; gap: 8px; padding: 12px 16px; background: #161b22; border-bottom: 1px solid #30363d; flex: 0 0 auto; }
.palette h2 { margin: 0 8px 0 0; font-size: 13px; color: #7d8590; align-self: center; }
.palette-item { padding: 4px 10px; background: #1e2530; border: 1px solid #4a5568; border-radius: 4px; cursor: pointer; color: #c9d1d9; }
.palette-item:disabled { opacity: 0.45; cursor: not-allowed; }
.truth-table { padding: 8px 16px; background: #161b22; border-top: 1px solid #30363d; max-height: 28vh; overflow: auto; flex: 0 0 auto; }
.truth-table table { border-collapse: collapse; font-variant-numeric: tabular-nums; }
.truth-table td { border: 1px solid #30363d; padding: 2px 8px; }
/* One screen at a time fills the space below the shell bar. The board screen is
   a flex column (palette / board / truth table); the map screen scrolls. */
.screens { flex: 1 1 auto; min-height: 0; display: flex; }
.screen { flex: 1 1 auto; min-width: 0; min-height: 0; }
.screen-board { display: flex; flex-direction: column; }
.screen-map { overflow: auto; }
.board { flex: 1 1 auto; min-height: 0; width: 100%; display: block; background: #0d1117; }
.map { padding: 16px; }
.map h2 { margin: 0 0 12px; font-size: 15px; color: #7d8590; }
.map-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 8px; }
.map-tile { padding: 12px; text-align: left; background: #161b22; border: 1px solid #30363d; border-radius: 6px; cursor: pointer; color: #c9d1d9; }
.map-tile:disabled { opacity: 0.4; cursor: not-allowed; }
.briefing { position: fixed; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 24px; background: rgba(13, 17, 23, 0.96); z-index: 10; padding: 40px; text-align: center; }
.briefing p { max-width: 52ch; line-height: 1.7; font-size: 17px; color: #c9d1d9; }
.briefing button { padding: 8px 24px; background: #1e2530; border: 1px solid #2fd4a7; color: #2fd4a7; border-radius: 4px; cursor: pointer; font-size: 15px; }
```

> 布局说明：`#app` 是纵向 flex 容器，顶栏是第一个子项（`flex: 0 0 auto`），`.screens` 吃掉剩余高度。画板是**正常流内的 flex 子项**，不用绝对定位、不用负 `z-index`——这样 `canvas.clientWidth/clientHeight` 与可见区域严格一致，指针坐标换算不需要任何修正，冒烟测试里测得的手感也才可信。

- [ ] **Step 10: 写 `test/ui/panels.test.ts`（jsdom）**

> 首行的 `// @vitest-environment jsdom` **不能删**。Vitest 5 移除了 `environmentMatchGlobs`，全局环境是 `node`，所以这个文件必须自己声明要 DOM；少了这一行会以 `document is not defined` 失败。反过来 `test/ui/view.test.ts` 是纯几何函数，不需要 jsdom，运行在 node 下即可。

面板是 DOM 组件，值得有一个廉价的回归测试——否则「解锁的元件可以点、锁住的元件点不动」这条规则只靠冒烟测试兜底。

```ts
// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { createStore } from '../../src/app/store';
import { emptyProgress, applyGrade } from '../../src/app/progress';
import { createRegistry } from '../../src/core/registry';
import { BASE_DEFS } from '../../src/core/defs/index';
import { emptyGraph } from '../../src/core/graph';
import { getLevel } from '../../src/levels/index';
import { mountPalette } from '../../src/ui/palette';
import { mountTruthTable } from '../../src/ui/truthTable';
import { mountShell } from '../../src/ui/shell';

const registry = createRegistry(BASE_DEFS);

function makeStore(levelId: string) {
  return createStore({
    level: getLevel(levelId),
    graph: emptyGraph(levelId),
    registry,
    progress: emptyProgress(),
    camera: { x: 0, y: 0, zoom: 1 },
    selected: [],
    dragging: null,
    lastGrade: null,
    status: null,
  });
}

describe('palette panel', () => {
  it('offers nothing but the level plumbing while nothing is unlocked', () => {
    // level 2 needs a NAND, which only level 1's reward unlocks
    const store = makeStore('ch1-02-nand-gate');
    const root = document.createElement('div');
    mountPalette(root, store, () => {});
    const labels = [...root.querySelectorAll('button')].map((b) => b.textContent);
    expect(labels).toEqual(['关卡输入', '关卡输出']);
  });

  it('offers a part once its unlocking level is passed', () => {
    const store = makeStore('ch1-02-nand-gate');
    const passed = applyGrade(emptyProgress(), getLevel('ch1-01-crude-awakening'), {
      passed: true,
      metrics: { gate: 0, delay: 0, tick: 0 },
      score: 0,
      stars: 3,
      failures: [],
      issues: [],
    });
    store.set({ progress: passed });
    const root = document.createElement('div');
    mountPalette(root, store, () => {});
    const labels = [...root.querySelectorAll('button')].map((b) => b.textContent);
    expect(labels).toContain('与非门');
  });

  it('reports the picked part id, not its label', () => {
    const store = makeStore('ch1-01-crude-awakening');
    const root = document.createElement('div');
    const picked: string[] = [];
    mountPalette(root, store, (defId) => picked.push(defId));
    const on = [...root.querySelectorAll('button')].find((b) => b.textContent === '高电平');
    on?.click();
    expect(picked).toEqual(['const_on']);
  });
});

describe('truth table panel', () => {
  it('reports a pass with the three metrics', () => {
    const store = makeStore('ch1-01-crude-awakening');
    store.set({
      lastGrade: {
        passed: true,
        metrics: { gate: 0, delay: 0, tick: 0 },
        score: 0,
        stars: 3,
        failures: [],
        issues: [],
      },
    });
    const root = document.createElement('div');
    mountTruthTable(root, store);
    expect(root.textContent).toContain('全部用例通过');
    expect(root.textContent).toContain('门 0');
  });

  it('lists failing rows with expected and actual values', () => {
    const store = makeStore('ch1-04-and-gate');
    store.set({
      lastGrade: {
        passed: false,
        metrics: { gate: 1, delay: 1, tick: 0 },
        score: 5,
        stars: 0,
        failures: [
          {
            check: 'truth-table',
            inputs: { a: 0, b: 0 },
            expected: { out: 0 },
            actual: { out: 1 },
            tick: 0,
            reason: 'mismatch',
          },
        ],
        issues: [],
      },
    });
    const root = document.createElement('div');
    mountTruthTable(root, store);
    expect(root.textContent).toContain('1 ≠ 0');
  });
});

describe('shell bar', () => {
  it('shows the level name and score once graded', () => {
    const store = makeStore('ch1-04-and-gate');
    const root = document.createElement('div');
    mountShell(root, store, { onOpenMap: () => {} });
    expect(root.textContent).toContain('与门');
    store.set({
      lastGrade: {
        passed: true,
        metrics: { gate: 2, delay: 2, tick: 0 },
        score: 10,
        stars: 3,
        failures: [],
        issues: [],
      },
    });
    expect(root.textContent).toContain('得分 10');
    expect(root.textContent).toContain('★★★');
  });

  it('offers a way back to the chapter map', () => {
    const store = makeStore('ch1-04-and-gate');
    const root = document.createElement('div');
    let opened = 0;
    mountShell(root, store, { onOpenMap: () => { opened += 1; } });
    (root.querySelector('button') as HTMLButtonElement).click();
    expect(opened).toBe(1);
  });
});
```

- [ ] **Step 11: 运行 `pnpm build` 与全部测试**

Run: `pnpm build` 然后 `pnpm test`
Expected: 两者都通过（`tsc --noEmit` 无类型错误）

- [ ] **Step 12: 提交**

```bash
git add src/ui src/app src/main.ts test/ui
git commit -m "feat(ui): add canvas board, palette, shell and truth table panel"
```

---

## Task 12: 章节地图、叙事外壳与冒烟测试

**Files:**
- Create: `src/ui/map.ts`, `src/ui/narrative.ts`, `test/smoke/ui.spec.ts`, `playwright.config.ts`
- Modify: `src/main.ts`
- Test: `test/smoke/ui.spec.ts`

**Interfaces:**
- Consumes: `Store`、`LEVELS`、`Progress`
- Produces:
  - `src/ui/narrative.ts`：`interface Narrative { readonly before: LocalizedText; readonly after: LocalizedText }`、`const NARRATIVE: Readonly<Record<string, Narrative>>`、`function narrativeFor(levelId: string): Narrative`
  - `src/ui/map.ts`：`function mountMap(root: HTMLElement, store: Store, onSelect: (levelId: string) => void): { render(): void }`
  - `playwright.config.ts`：webServer 启动 `pnpm preview`，端口 4173

- [ ] **Step 1: 写 `src/ui/narrative.ts`（原创文案）**

```ts
import type { LocalizedText } from '../levels/spec';

export interface Narrative {
  readonly before: LocalizedText;
  readonly after: LocalizedText;
}

/**
 * Original narrative shell. The source material describes an alien abduction
 * framing; this replica keeps the framing but writes its own character and
 * lines, and draws no characters at all.
 */
export const NARRATIVE: Readonly<Record<string, Narrative>> = {
  'ch1-01-crude-awakening': {
    before: {
      zh: '你在一间金属舱室里醒来。舷窗外面是一颗紫色的星球。墙上的扬声器说：「证明你值得留着。」',
      en: 'You wake in a metal cell. Through the port: a violet planet. The speaker on the wall says: prove you are worth keeping.',
    },
    after: {
      zh: '门开了。走廊尽头还有一扇门，上面刻着一个与非门的符号。',
      en: 'The cell opens. Down the corridor, another door, etched with the symbol of a NAND gate.',
    },
  },
  'ch1-02-nand-gate': {
    before: {
      zh: '「一切计算都从这一个门开始，」扬声器说，「记住它的真值表。」',
      en: 'Every computation starts with this one gate, says the speaker. Learn its truth table.',
    },
    after: {
      zh: '门滑开了。你听见远处有什么东西开始运转。',
      en: 'The door slides open. Somewhere far off, machinery begins to turn.',
    },
  },
  'ch1-03-not-gate': {
    before: {
      zh: '「一个输入，翻转它。你只有与非门——想想这意味着什么。」',
      en: 'One input. Invert it. You only have a NAND. Think about what that implies.',
    },
    after: { zh: '「很好。你开始理解『重复』的力量了。」', en: 'Good. You are starting to understand the power of repetition.' },
  },
  'ch1-04-and-gate': {
    before: { zh: '「翻转两次，就回到了原处。但中间那一步是必要的。」', en: 'Invert twice and you are back where you started, but the middle step is necessary.' },
    after: { zh: '第三扇门开了。空气里有臭氧的味道。', en: 'A third door opens. The air smells of ozone.' },
  },
  'ch1-05-or-gate': {
    before: { zh: '「德摩根留下了一条捷径。找到它，你就能少走很多弯路。」', en: 'De Morgan left a shortcut. Find it and you will save yourself a great deal of walking.' },
    after: { zh: '扬声器沉默了一会儿，然后说：「有趣。」', en: 'The speaker is quiet for a moment, then says: interesting.' },
  },
  'ch1-06-nor-gate': {
    before: { zh: '「或非门是另一条路的起点。你会发现它和与非门一样好用。」', en: 'NOR is the start of another road. You will find it as useful as NAND.' },
    after: { zh: '走廊的灯全亮了。你第一次看清了这艘飞船的全貌。', en: 'Every light in the corridor comes on. For the first time you see the ship whole.' },
  },
  'ch1-07-always-on': {
    before: { zh: '「恒定的高电平。最无聊的答案，也是最基础的答案。」', en: 'A constant high. The dullest answer, and the most fundamental one.' },
    after: { zh: '你意识到自己已经会用两种方式制造 1 和 0 了。', en: 'You realise you now have two ways to make a 1 and a 0.' },
  },
  'ch1-08-second-tick': {
    before: { zh: '「现在开始，时间也是电路的一部分。第几拍，比是不是更重要。」', en: 'From here on, time is part of the circuit. When matters more than whether.' },
    after: { zh: '你第一次让信号「等」了一下。', en: 'For the first time, you made a signal wait.' },
  },
  'ch1-09-xor-gate': {
    before: { zh: '「四个与非门。监督者认为这是衡量悟性的标准。」', en: 'Four NANDs. The Overseer considers this the measure of a mind.' },
    after: { zh: '你在墙上刻下了四道划痕。', en: 'You scratch four marks into the wall.' },
  },
  'ch1-10-bigger-or-gate': {
    before: { zh: '「三个输入。别慌，你已经会两个了。」', en: 'Three inputs. Do not panic; you already know how to do two.' },
    after: { zh: '级联的感觉像搭积木。', en: 'Cascading feels like stacking blocks.' },
  },
  'ch1-11-bigger-and-gate': {
    before: { zh: '「和或门一样简单，是吗？」', en: 'As simple as OR, is it not?' },
    after: { zh: '你点了点头，然后意识到没人看得见。', en: 'You nod, then remember nobody can see you.' },
  },
  'ch1-12-binary-racer': {
    before: { zh: '「最后一项测试。四个位，一个数。你必须一眼读出来。」', en: 'One final test. Four bits, one number. You must read it at a glance.' },
    after: {
      zh: '第一扇真正的门打开了。外面是一条约百米长的走廊，两侧全是空着的电路板插槽。',
      en: 'The first real door opens. Beyond it, a hundred-metre corridor lined with empty circuit slots.',
    },
  },
};

export function narrativeFor(levelId: string): Narrative {
  return (
    NARRATIVE[levelId] ?? {
      before: { zh: '监督者没有留下说明。', en: 'The Overseer left no instructions.' },
      after: { zh: '电路安静地运转着。', en: 'The circuit runs quietly.' },
    }
  );
}
```

- [ ] **Step 2: 写 `src/ui/map.ts`**

```ts
import { LEVELS } from '../levels/index';
import type { Store } from '../app/store';
import { isUnlocked } from '../app/progress';
import { THEME } from './theme';

export function mountMap(
  root: HTMLElement,
  store: Store,
  onSelect: (levelId: string) => void,
): { render(): void } {
  const section = document.createElement('section');
  section.className = 'map';
  root.append(section);

  const render = (): void => {
    const { progress, level: current } = store.get();
    const order = LEVELS.map((l) => l.id);
    section.replaceChildren();
    const heading = document.createElement('h2');
    heading.textContent = '章节地图';
    section.append(heading);
    const grid = document.createElement('div');
    grid.className = 'map-grid';
    for (const level of LEVELS) {
      const tile = document.createElement('button');
      tile.className = 'map-tile';
      const record = progress.levels[level.id];
      const unlocked = isUnlocked(progress, level.id, order);
      tile.disabled = !unlocked;
      const stars = record?.stars ? ` ${'★'.repeat(record.stars)}` : '';
      tile.textContent = `${level.index}. ${level.name.zh}${stars}`;
      if (level.id === current.id) tile.classList.add('map-tile-current');
      if (record?.passed) tile.style.color = THEME.success;
      else if (!unlocked) tile.style.color = THEME.textMuted;
      tile.addEventListener('click', () => onSelect(level.id));
      grid.append(tile);
    }
    section.append(grid);
  };
  store.subscribe(render);
  render();
  return { render };
}
```

地图样式已经在 Step 11 的 `style.css` 里写好了（`.map` / `.map-grid` / `.map-tile`），这里只需要补一条"当前关卡"的强调：

```css
.map-tile-current { border-color: #2fd4a7; }
```

- [ ] **Step 3: 写 `playwright.config.ts`**

```ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './test/smoke',
  testMatch: /.*\.spec\.ts/,
  timeout: 30_000,
  use: {
    baseURL: 'http://127.0.0.1:4173',
    viewport: { width: 1280, height: 800 },
  },
  webServer: {
    command: 'pnpm build && pnpm preview --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
```

- [ ] **Step 4: 写冒烟测试 `test/smoke/ui.spec.ts`**

冒烟测试覆盖用户真正会走的那条路：进关卡 → 从调色板选元件 → 在画板上放置 → 连线 → 看到判定结果 → 刷新后进度还在。

```ts
import { expect, test } from '@playwright/test';

test('level 1 is playable end to end and survives a reload', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '开始' }).click(); // dismiss the briefing overlay
  await expect(page.locator('.shell-bar')).toContainText('原力觉醒');

  const canvas = page.locator('canvas.board');
  const box = (await canvas.boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  // place a Constant On (left) and a Level Output (right)
  await page.getByRole('button', { name: '高电平' }).click();
  await page.mouse.click(cx - 160, cy);
  await page.getByRole('button', { name: '关卡输出' }).click();
  await page.mouse.click(cx + 160, cy);

  // wire them: drag from the source output pin to the output part's input pin
  await page.mouse.move(cx - 160 + 64, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 160, cy, { steps: 12 });
  await page.mouse.up();

  // the level is a single truth table row that must read 1
  await expect(page.locator('.truth-table')).toContainText('全部用例通过');
  await expect(page.locator('.shell-metrics')).toContainText('得分');
});

test('progress survives a reload and unlocks the next level', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '开始' }).click();

  const canvas = page.locator('canvas.board');
  const box = (await canvas.boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.getByRole('button', { name: '高电平' }).click();
  await page.mouse.click(cx - 160, cy);
  await page.getByRole('button', { name: '关卡输出' }).click();
  await page.mouse.click(cx + 160, cy);
  await page.mouse.move(cx - 160 + 64, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 160, cy, { steps: 12 });
  await page.mouse.up();
  await expect(page.locator('.truth-table')).toContainText('全部用例通过');

  await page.reload();
  await page.getByRole('button', { name: '开始' }).click(); // level 2's briefing
  await expect(page.locator('.shell-bar')).toContainText('与非门');
  await expect(page.getByRole('button', { name: '与非门' })).toBeEnabled();

  await page.getByRole('button', { name: '章节地图' }).click();
  await expect(page.locator('.map-tile').nth(0)).toContainText('★');
  await expect(page.locator('.map-tile').nth(1)).toBeEnabled();
  await expect(page.locator('.map-tile').nth(2)).toBeDisabled();
});
```

> 引脚坐标由 `pinPosition()` 决定：输出引脚在 `x + INSTANCE_WIDTH (64)`、垂直居中。这就是脚本里 `cx - 160 + 64` 的来历。若实现改了元件尺寸，这个偏移要同步改——那是刻意的耦合，因为坐标手感本来就是 UI 契约的一部分。

- [ ] **Step 5: 运行冒烟测试**

Run: `pnpm exec playwright install chromium` 然后 `pnpm smoke`
Expected: PASS — 2 passed。首次运行很可能暴露真实的交互缺陷（命中容差太小、连线的 `pointerup` 落点偏出引脚、简报浮层挡住了第一次点击）。**这些正是冒烟测试的价值**：修实现，不要放宽断言。

- [ ] **Step 6: 冒烟脚本要处理简报浮层**

Task 11 的 `main.ts` 在第一关开始时会弹原创简报浮层，所以脚本在 `page.goto('/')` 之后必须先关掉它：

```ts
await page.getByRole('button', { name: '开始' }).click();
```

把它加在两个冒烟用例的 `goto` 之后。第二关开始也会有浮层，`openLevel` 里已经统一调用了 `showBriefing`，因此从地图进任何一关都会弹——这是刻意的节奏设计，不是 bug。

- [ ] **Step 7: 给每一关补叙事并测试覆盖率**

`narrativeFor` 对缺失的关卡会回退到通用文案，这是给后续章节留的容错。第 1 章 12 关必须全部有专属文案。在 `test/ui/panels.test.ts` 追加：

```ts
import { LEVELS } from '../../src/levels/index';
import { NARRATIVE, narrativeFor } from '../../src/ui/narrative';

describe('narrative coverage', () => {
  it('writes dedicated text for every chapter 1 level', () => {
    for (const level of LEVELS.filter((l) => l.chapter === 1)) {
      expect(NARRATIVE[level.id], `no narrative for ${level.id}`).toBeDefined();
      const text = narrativeFor(level.id);
      expect(text.before.zh.length).toBeGreaterThan(4);
      expect(text.after.en.length).toBeGreaterThan(4);
    }
  });

  it('falls back to generic text for a level with no narrative yet', () => {
    const text = narrativeFor('ch9-not-written-yet');
    expect(text.before.zh.length).toBeGreaterThan(0);
    expect(text.before.zh).not.toBe(NARRATIVE['ch1-04-and-gate']!.before.zh);
  });
});
```

- [ ] **Step 8: 把地图与叙事接进 `main.ts`**

Task 11 的 `main.ts` 留了一个空实现的 `openMap` 占位。本步做四处改动：

1) 顶部加两个 import：

```ts
import { mountMap } from './ui/map';
import { narrativeFor } from './ui/narrative';
```

2) 在文件末尾（`if (app)` 块之后）加上叙事浮层。它只显示原创简报，不参与评分：

```ts
/** Original narrative briefing. It never participates in grading. */
function showBriefing(text: { zh: string; en: string }): void {
  document.querySelector('.briefing')?.remove();
  const panel = document.createElement('div');
  panel.className = 'briefing';
  const body = document.createElement('p');
  body.textContent = text.zh;
  body.lang = 'zh-CN';
  const start = document.createElement('button');
  start.textContent = '开始';
  start.addEventListener('click', () => panel.remove());
  panel.append(body, start);
  document.body.append(panel);
}
```

3) 在 `if (app)` 块内、`renderBoard(...)` 之前加一行，让进入应用时就弹出当前关的简报：

```ts
  showBriefing(narrativeFor(level.id).before);
```

4) 把 `openMap` 占位换成真实地图，并让切关 / 通关都弹简报：

```ts
  const openLevel = (levelId: string): void => {
    const next = getLevel(levelId);
    stack.clear();
    store.set({
      level: next,
      graph: emptyGraph(next.id),
      selected: [],
      lastGrade: null,
      status: null,
    });
    showScreen('board');
    showBriefing(narrativeFor(levelId).before);
  };

  const regrade = (): void => {
    const { graph: g, level: l, progress: p } = store.get();
    const result = grade(g, registry, l);
    store.set({ lastGrade: result });
    if (result.passed) {
      progress = applyGrade(p, l, result);
      saveProgress(progress);
      store.set({ progress });
      showBriefing(narrativeFor(l.id).after);
    }
  };

  const mapRender = mountMap(mapScreen, store, openLevel);

  mountShell(app, store, {
    onOpenMap: () => {
      showScreen('map');
      mapRender.render();
    },
  });
```

- [ ] **Step 9: 运行全部测试与冒烟，确认通过**

Run: `pnpm test` 然后 `pnpm smoke`
Expected: 两者都通过

- [ ] **Step 10: 提交**

```bash
git add src/ui/map.ts src/ui/narrative.ts src/ui/style.css src/main.ts playwright.config.ts test/smoke/ui.spec.ts test/ui/panels.test.ts
git commit -m "feat(ui): add chapter map, original narrative shell and playwright smoke test"
```

> `resumePointOf` 的单元测试在 Task 10 就写好了（`test/app/progress.test.ts`），`main.ts` 在 Task 11 就调用了它。本任务只把地图与叙事接上。

- [ ] **Step 8: 运行全部测试与冒烟，确认通过**

Run: `pnpm test` 然后 `pnpm smoke`
Expected: 两者都通过

- [ ] **Step 9: 提交**

```bash
git add src/ui/map.ts src/ui/narrative.ts src/ui/style.css src/main.ts playwright.config.ts test/smoke/ui.spec.ts test/ui/panels.test.ts
git commit -m "feat(ui): add chapter map, original narrative shell and playwright smoke test"
```

---

## 验收清单（阶段 0 完成时必须全部为真）

- [ ] `pnpm test` 全绿，且包含：内核单元测试、每关参考解通过、每关反例失败、三星门槛可达、存档往返、撤销栈
- [ ] `pnpm build` 通过（`tsc --noEmit` 无错误）
- [ ] `pnpm smoke` 通过，产出至少一张截图
- [ ] 浏览器打开 `pnpm dev`，能连续通过第 1–12 关，进度在刷新后保留
- [ ] 三处版权声明到位：`README.md` 首段、`package.json` 的 `description`、`docs/superpowers/specs` 的 §1.4
- [ ] `git log` 有 12 次以上的提交，每个任务一次

---

## 自审记录

**规格覆盖检查**（对照 spec 各节）：

| spec 章节 | 覆盖任务 | 备注 |
|---|---|---|
| §3 组件模型 | Task 3 | 阶段 0 只落 13 个基础元件 + 2 个关卡元件；宽位/蓝图在阶段 1–5 |
| §4 仿真内核 | Task 5 | 稳定化、时钟沿、不稳定回路、`reset` 全部有测试 |
| §5.1 关卡数据格式 | Task 6 | `LevelSpec` 与 `Check` 联合类型完全落地 |
| §5.2 验证器类型 | Task 6 | `truth-table` / `script` / `constraint` 落地；`fuzz` / `custom` 推迟到阶段 1–3（第 1 章不需要，且 YAGNI） |
| §5.3 章节清单 | Task 8、9 | 第 1 章 12 关完成；其余章节在后续计划中 |
| §5.4 评分系统 | Task 7 | 三维指标、权重、星级全部落地 |
| §6 汇编/CPU | 后续计划 | 阶段 0 不含 |
| §7 UI 设计 | Task 11、12 | 画板/调色板/真值表/地图/叙事外壳落地；蓝图编辑器、IDE、沙盒在后续阶段 |
| §8 持久化 | Task 10 | localStorage + 迁移 + 导入导出 |
| §10 测试策略 | 全任务 | 内核单测、判定力测试、存档往返、UI 冒烟全部覆盖 |

**已修正的自身问题（第一遍写出后逐条修掉的）**：

1. **`delayOf` 会指数爆炸**：初版是路径枚举，在菱形电路上路径数随层数指数增长，而 CPU 关卡全是这种形状。已改为 Kahn 拓扑排序 + 单次松弛的线性 DAG 最长路径。
2. **关卡 I/O 绑定方式根本行不通**：初版写「引脚同名即绑定」，但引脚名由组件定义固定，改 `def` 字段不可能改名。已改为显式的 `level_input` / `level_output` 元件 + `IN_<引脚名>` / `OUT_<引脚名>` 实例 id 约定，并配套一个真实的 `andSolution()` 测试。
3. **`truth-table` 检查器会静默放过一切**：初版在 `rows` 缺省时生成「空 outputs」的行，比较循环什么都不比，于是任何电路都算通过。现已定为硬错误（`reason: 'missing-rows'`），并加了 `truthTable()` 生成器：缺某个输出引脚的期望值时它直接抛错。有专门测试锁死。
4. **Task 2 的信号表扩容会静默破坏索引**：重分配 `Uint8Array` 会让此前发出的所有 `base` 失效，而 `net.ts` 的 `drive` 数组正建立在那些索引上。已改为固定容量 + 越界抛错，容量 65536（规格预算 20000 实例，余量充足）。
5. **`unlockedComponents` 存两份必然漂移**：进度里既存已解锁集合、又有关卡奖励，导入旧档后两者会不一致，表现为「关卡要求 NAND 但进度里没有」。已改为纯派生函数：奖励来自已通过关卡，`level_input` / `level_output` 作为永远可用的 plumbing。
6. **第 1 关在初版里根本没法玩**：`emptyProgress([])` 下所有元件都是锁的，玩家放不下任何东西。派生式解锁一并解决了它，并有测试断言 plumbing 永远可用。
7. **参考解里有一处电路写错了**：初版的 NOR 参考解是 `NOT(NAND)`，那其实是 AND。已改为 `or` + `not`（NOR 关卡本来就已解锁 OR），并补上「两串 NAND 冒充 NOR」作为反例。
8. **第 12 关撞上两个硬约束**：4 位直通需要 `maker`（阶段 1 才有），而四条线也不能驱动同一个输入引脚。已改为四个 1 位输出 + 16 行真值表生成，教学目的（位权）不变。
9. **每个测试行都要重新编译整个电路**：初版 `runChecks` 为真值表每一行新建一次 `Simulation`（含 `validateGraph` 与信号表分配）。已改为每个 check 只编译一次、每行只 `reset()`。
10. **渲染循环 60fps 空转**：初版用 `requestAnimationFrame` 无限重绘静态画板，与 spec §7「静止时不重绘」直接冲突。已改为订阅 store 变化 + resize 时重绘；平移缩放本身也走 `store.set`，拖动手感不受影响。
11. **画板用负 `z-index` 铺底**：初版把画板绝对定位到 UI 之下，DOM 盒子与可绘制区域容易错位，指针坐标换算就不可信。已改为正常流内的 flex 子项。
12. **`resumePoint` 会选错关卡**：初版的 `[...order].reverse().find(isUnlocked)` 会跳到「最后一个已解锁的关卡」。已改为「第一个已解锁但未通过的关卡」，并加了单元测试。
13. **重复与占位**：清理了 `build()` 半成品、Task 3 里的 `throw new Error('placeholder')`、Task 5 的探测器式断言（`expect(slotOf).toBeDefined()`），以及两处整段重复的关卡定义。
14. **规格里写过的 15 项成就在本计划中不存在** —— 其引导最优解的作用由 `threeStar` 门槛承担，与 spec §5.4 的说明一致。

**与 spec 的已知偏差（spec 需要同步修订）**：

- spec §5.1 的 `LevelSpec` 示例写了 `"checks": [{"kind": "truth-table", "complete": true}]`。实现取的是 `rows` 显式真值表；`complete` 这个字段没有任何任务使用，应从 spec 中删除。
- spec §5.2 列出的 `fuzz` 与 `custom` 两种检查器不在阶段 0 落地（第 1 章用不到，YAGNI）。在做第 3 章（CPU）与第 7 章（迷宫/跳舞机）之前必须先实现。
- spec §3.3 的 Ch1 组件表列了 `switch`，但第 1 章 12 关没有任何一关需要它。`switch` 顺延到第 2 章与 `switch8` 一起做。
- spec §4.4 的 `Simulation` 接口签名与实现不同：实现用 `read(base, width)` / `write(base, width, v)`（按槽位），不是 `read(instanceId, portId)`。按槽位读取是为了让关卡绑定与评分器都不用重复做名字解析。
