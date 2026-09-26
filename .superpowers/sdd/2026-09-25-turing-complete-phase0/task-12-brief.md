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
  - `playwright.config.ts`：webServer 通过 `NODE_BIN`/`PNPM_BIN` 启动 `build` + `preview`，端口 4173（本机 PATH 上的 `pnpm` 是坏的包装脚本）

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

// The `pnpm` shim on this host's PATH is a broken PowerShell wrapper, so the
// preview server is started through the bundled Node binary instead. NODE and
// PNPM are supplied by the environment; on a normal Linux CI, set both to
// `pnpm` (or leave them unset and drop the quotes) and the command is the
// ordinary `pnpm build && pnpm preview`.
const NODE = process.env.NODE_BIN ?? 'node';
const PNPM = process.env.PNPM_BIN ?? 'pnpm';

export default defineConfig({
  testDir: './test/smoke',
  testMatch: /.*\.spec\.ts/,
  timeout: 30_000,
  use: {
    baseURL: 'http://127.0.0.1:4173',
    viewport: { width: 1280, height: 800 },
  },
  webServer: {
    command: `"${NODE}" "${PNPM}" build && "${NODE}" "${PNPM}" preview --port 4173 --strictPort`,
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
```

> **两处本机实测的坑（Task 11 的修复轮报告的）**：
>
> 1. `pnpm` 在 PATH 上是一个坏掉的 PowerShell 包装脚本，`webServer.command` 里直接写 `pnpm` 会启动失败。用 `NODE_BIN` / `PNPM_BIN` 环境变量传入真实路径，命令里用 `"${NODE}" "${PNPM}"`。
> 2. **浏览器版本必须与 `@playwright/test` 匹配**。本机预装的是 `chromium-1223`，而 1.63.0 需要 `1243`，直接跑会报找不到可执行文件。先装一次（约 115 MB）：
>
> ```
> & "<node>" "node_modules\@playwright\test\cli.js" install chromium
> ```
>
> 装完 `%LOCALAPPDATA%\ms-playwright` 下会同时有 1223 与 1243，属正常。

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
Run: `& "<node>" "node_modules\@playwright\test\cli.js" install chromium` 然后 `NODE_BIN=... PNPM_BIN=... pnpm smoke`
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
5. **`unlockedComponents` 存两份必然漂移**：进度里既存已解锁集合、又有关卡奖励，导入旧档后两者会不一致，表现为「关卡要求 NAND 但进度里没有」。已改为纯派生函数：奖励来自已通过关卡，`level_input` / `level_output` 作为永远可用的 STARTER_COMPONENTS。
6. **第 1 关在初版里根本没法玩**：`emptyProgress([])` 下所有元件都是锁的，玩家放不下任何东西。派生式解锁一并解决了它，并有测试断言 STARTER_COMPONENTS 永远可用。
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
