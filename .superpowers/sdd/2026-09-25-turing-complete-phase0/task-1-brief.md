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
    "jsdom": "28.0.1",
    "typescript": "5.9.3",
    "vite": "8.3.1",
    "vitest": "5.0.2"
  }
}
```

> 说明：TypeScript 固定 `5.9.3` 而不是 registry 上的 `7.0.2`。TS 7 是重写的原生编译器，与 Vitest 5 + Vite 8 的组合在本项目中未经验证；阶段 0 不承担这个风险。等阶段 1 再评估升级。

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
  "include": ["src", "test", "vite.config.ts"]
}
```

- [ ] **Step 3: 写 `vite.config.ts`**

```ts
import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: { target: 'es2022', outDir: 'dist' },
  test: {
    globals: true,
    // node is the default: the engine and level tests must not need a DOM.
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // The board-view tests build DOM-free geometry, but anything that touches
    // `document` (palette, shell, truth table) needs a DOM. Opt those in by
    // directory rather than making every test pay for jsdom.
    environmentMatchGlobs: [['test/ui/**', 'jsdom']],
  },
});
```

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
git add package.json pnpm-lock.yaml tsconfig.json vite.config.ts index.html src/main.ts src/levels/index.ts test/smoke/sanity.test.ts README.md
git commit -m "chore: scaffold vite + vitest project with sanity test"
```

---

