import { expect, test, type Page } from '@playwright/test';
import { LEVEL_ORDER } from '../../src/levels/index';
import { STORAGE_KEY } from '../../src/persist/storage';

/**
 * End-to-end smoke test: the path a player actually walks.
 *
 * Enter a level -> dismiss the briefing -> pick a part from the palette -> drop
 * it on the canvas -> wire it up -> read the grade -> reload and find the
 * progress still there.
 *
 * The drag offsets are deliberately hard-coded against the board's geometry:
 * `pinPosition()` puts an output pin at `x + INSTANCE_WIDTH (72)`, vertically
 * centred, and a part dropped at cursor `(px, py)` lands with its pin row on
 * `py`. If the part size changes, these offsets have to change with it -- that
 * coupling is the point, because pointer feel is part of the UI contract.
 *
 * CHAPTERS 2 AND 3 ARE COVERED BY THE LAST SIX TESTS. Joining a chapter to the
 * level list is not shipping it: a level nobody can open, or one that opens but
 * never grades, is invisible in the earlier tests either way. Those tests seed a
 * save with the levels before their target already passed -- the only practical
 * way to reach level 31, let alone 47, in a browser test -- and then walk the
 * real path: open it, read its palette, build its reference, pass it, and watch
 * the next tile unlock.
 *
 * THE CHAPTER-3 TESTS ARE THE ONES THAT WOULD HAVE CAUGHT ITS ACTUAL DEFECT. All
 * nine of its levels were written, compiled and passed their own batch tests
 * while `content/index.ts` never named the chapter, so no player could reach any
 * of them. A batch test imports its batch by path and passes either way; only a
 * walk that starts from the app's own level list can see the difference, which is
 * what these do.
 */

/**
 * Writes a save with the first `count` levels passed, before the app boots.
 *
 * The app opens on `resumePointOf` -- the first unlocked level that has not been
 * passed -- so passing 1..N opens level N+1. `LEVEL_ORDER` is imported rather
 * than restated: a hard-coded list of ids here would rot silently the day a level
 * is renamed, and the failure would look like a UI bug.
 */
async function seedProgress(page: Page, count: number): Promise<void> {
  const levels: Record<string, { passed: boolean; best: null; stars: number }> = {};
  for (const id of LEVEL_ORDER.slice(0, count)) {
    levels[id] = { passed: true, best: null, stars: 3 };
  }
  await page.addInitScript(
    ([key, json]) => globalThis.localStorage.setItem(key, json),
    [STORAGE_KEY, JSON.stringify({ version: 1, levels })] as const,
  );
}

/** Centre of the board canvas, in page coordinates. */
async function boardCentre(page: Page): Promise<{ cx: number; cy: number }> {
  const box = (await page.locator('canvas.board').boundingBox())!;
  return { cx: box.x + box.width / 2, cy: box.y + box.height / 2 };
}

/** Arms a palette part by its localised name, then drops it at a page point. */
async function place(page: Page, name: string, x: number, y: number): Promise<void> {
  await page.getByRole('button', { name }).click();
  await page.mouse.click(x, y);
}

/** Drags a wire from one page point to another (press on a pin, release on one). */
async function dragWire(
  page: Page,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
): Promise<void> {
  await page.mouse.move(fromX, fromY);
  await page.mouse.down();
  await page.mouse.move(toX, toY, { steps: 12 });
  await page.mouse.up();
}

/** Drops Constant On on the left and Level Output on the right. */
async function placeParts(page: Page): Promise<{ cx: number; cy: number }> {
  const { cx, cy } = await boardCentre(page);
  await place(page, '高电平', cx - 160, cy);
  await place(page, '关卡输出', cx + 160, cy);
  return { cx, cy };
}

/** Drags a wire from the source's output pin to the output part's input pin. */
async function wireParts(page: Page, cx: number, cy: number): Promise<void> {
  await dragWire(page, cx - 160 + 72, cy, cx + 160, cy);
}

/**
 * Runs the level's cases from the test panel: the button a player presses to be
 * judged. Nothing grades a circuit before it is pressed.
 */
async function runTests(page: Page): Promise<void> {
  await page.locator('.case-test').click();
}

test('level 1 is playable end to end and shows its pass dialog', async ({ page }) => {
  await page.goto('/');
  // The briefing overlay covers the board, so it has to go before the canvas
  // can be touched at all.
  await page.getByRole('button', { name: '开始' }).click();
  await expect(page.locator('.shell-bar')).toContainText('原力觉醒');
  // One screen at a time: the empty map screen is not in the way.
  await expect(page.locator('.screen-map')).toBeHidden();

  const { cx, cy } = await placeParts(page);
  await page.screenshot({ path: 'test-results/smoke-level1-parts-placed.png' });

  await wireParts(page, cx, cy);

  // Building is not being judged. Before the test button is pressed the panel is
  // a PLAN -- the level's one case, with its expectation and no verdict -- and
  // the bar reports what the circuit costs and says it has not been tested.
  await expect(page.locator('.truth-table')).toContainText('共 1 个');
  await expect(page.locator('.truth-table')).toContainText('???');
  await expect(page.locator('.truth-table')).not.toContainText('全部用例通过');
  await expect(page.locator('.shell-metrics')).toContainText('未测试');
  await expect(page.locator('.result')).toHaveCount(0);
  await page.screenshot({ path: 'test-results/smoke-level1-plan.png' });

  await runTests(page);

  // The level is a single truth-table row that must read 1.
  await expect(page.locator('.truth-table')).toContainText('全部用例通过');
  await expect(page.locator('.shell-metrics')).toContainText('总开销');

  // Passing opens the result dialog: the original's contents -- what the level
  // unlocked, what the circuit cost, and a way onward -- plus this project's own
  // epilogue, which never takes part in grading.
  const result = page.locator('.result');
  await expect(result).toContainText('解锁内容');
  await expect(result).toContainText('关卡小结');
  await expect(result).toContainText('关卡完成');
  await expect(result).toContainText('门开了');
  await page.screenshot({ path: 'test-results/smoke-level1-passed.png' });
});

/**
 * The dialog used to be the level's epilogue, re-shown by every `regrade()` that
 * still passed -- which is every edit after the first pass, so it reappeared on
 * the next click and the click after that. This is that bug, pinned, and it is
 * pinned harder than it was: an edit no longer grades AT ALL, so there is no
 * verdict to reopen anything.
 */
test('the pass dialog appears once, and does not come back on the next edit', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '开始' }).click();

  const { cx, cy } = await placeParts(page);
  await wireParts(page, cx, cy);
  await expect(page.locator('.result')).toHaveCount(0);
  await runTests(page);
  await expect(page.locator('.result')).toBeVisible();

  await page.getByRole('button', { name: '继续' }).click();
  await expect(page.locator('.result')).toHaveCount(0);

  // An edit that leaves the circuit passing -- a spare part on the board -- is
  // exactly what used to reopen it. It goes ABOVE the circuit, not below it: the
  // test panel is an overlay along the bottom of the stage and a click that lands
  // on it is a click on the panel, not on the board.
  await place(page, '高电平', cx - 160, cy - 160);
  await expect(page.locator('.shell-metrics')).toContainText('未测试');
  await expect(page.locator('.result')).toHaveCount(0);
});

/**
 * The complaint this whole panel was rebuilt around: a failing level used to
 * answer with one sentence per case -- `用例 3 · out: 0 ≠ 1`, fifteen lines of it
 * on a fifteen-row table. The matrix says which bit is wrong and for which case
 * without a word, so a failing run has to produce a red cell and no prose.
 */
test('a failing run says so with a red cell, not a wall of text', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '开始' }).click();

  const { cx, cy } = await boardCentre(page);
  // Level 1 wants the output held high; Constant Off is the wrong answer.
  await place(page, '低电平', cx - 160, cy);
  await place(page, '关卡输出', cx + 160, cy);
  await dragWire(page, cx - 160 + 72, cy, cx + 160, cy);

  await runTests(page);
  await expect(page.locator('.truth-table h2')).toHaveText('未通过');
  await expect(page.locator('.case-bad')).toHaveCount(1);
  await expect(page.locator('.truth-table')).not.toContainText('≠');
  await expect(page.locator('.truth-table p')).toHaveCount(0);
  await expect(page.locator('.result')).toHaveCount(0);
  await page.screenshot({ path: 'test-results/smoke-level1-failed.png' });
});

test('the pass dialog leads to the next level', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '开始' }).click();

  const { cx, cy } = await placeParts(page);
  await wireParts(page, cx, cy);
  await runTests(page);

  await page.getByRole('button', { name: '下一关' }).click();
  await expect(page.locator('.result')).toHaveCount(0);
  // Level 2, and its own briefing, exactly as opening it from the map would.
  await expect(page.locator('.shell-bar')).toContainText('与非门');
  await expect(page.locator('.briefing')).toBeVisible();
});

test('progress survives a reload and unlocks the next level', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '开始' }).click();

  const { cx, cy } = await placeParts(page);
  await wireParts(page, cx, cy);
  await runTests(page);
  await expect(page.locator('.truth-table')).toContainText('全部用例通过');

  await page.reload();
  await page.getByRole('button', { name: '开始' }).click(); // level 2's briefing
  await expect(page.locator('.shell-bar')).toContainText('与非门');
  await expect(page.getByRole('button', { name: '与非门' })).toBeEnabled();

  await page.getByRole('button', { name: '章节地图' }).click();
  // One screen at a time: showing the map must take the board off screen
  // rather than leave it in the column next to the tiles.
  await expect(page.locator('.screen-board')).toBeHidden();
  await expect(page.locator('.screen-map')).toBeVisible();
  await expect(page.locator('.map-tile').nth(0)).toContainText('★');
  await expect(page.locator('.map-tile').nth(1)).toBeEnabled();
  await expect(page.locator('.map-tile').nth(2)).toBeDisabled();
  await page.screenshot({ path: 'test-results/smoke-chapter-map.png' });

  // A tile is real navigation: back to the board, on that level, with that
  // level's briefing.
  await page.locator('.map-tile').nth(0).click();
  await expect(page.locator('.screen-map')).toBeHidden();
  await expect(page.locator('.screen-board')).toBeVisible();
  await expect(page.locator('.shell-bar')).toContainText('原力觉醒');
  await expect(page.locator('.briefing')).toContainText('金属舱室');
});

/**
 * LEVEL 12 IS THE LEVEL THE COMPLAINT CAME FROM: four inputs, four outputs, a
 * sixteen-row table, and a circuit reading zero everywhere -- fifteen failing
 * cases, which the old panel answered with fifteen lines of `out3: 0 ≠ 1`. It is
 * also the level where the matrix is at its tallest, which is why it is worth a
 * walk of its own.
 */
test('level 12 lays its sixteen cases out as columns, then plays them', async ({ page }) => {
  await seedProgress(page, 11);
  await page.goto('/');
  await page.getByRole('button', { name: '开始' }).click();
  await expect(page.locator('.shell-bar')).toContainText('二进制速算');

  // Nothing built yet: sixteen columns of expectations, no verdict, and not one
  // fabricated output.
  await expect(page.locator('.truth-table h2')).toHaveText('用例');
  await expect(page.locator('.case-count')).toHaveText('共 16 个');
  await expect(page.locator('.case-bad')).toHaveCount(0);
  await page.screenshot({ path: 'test-results/smoke-ch1-level12-plan.png' });

  await runTests(page);
  // The first case is driven before the click returns, so this is not a race.
  await expect(page.locator('.truth-table h2')).toHaveText('正在测试 用例 1 / 16');
  await expect(page.locator('.case-active')).not.toHaveCount(0);
  await page.screenshot({ path: 'test-results/smoke-ch1-level12-running.png' });

  // Sixteen cases at 2x is seven seconds, so the verdict needs a longer wait
  // than the default -- and it arrives as a red matrix, not as a wall of text.
  await expect(page.locator('.truth-table h2')).toHaveText('未通过', { timeout: 20_000 });
  await expect(page.locator('.truth-table')).not.toContainText('≠');
  await expect(page.locator('.truth-table p')).toHaveCount(0);
  await expect(page.locator('.case-bad')).not.toHaveCount(0);
  await page.screenshot({ path: 'test-results/smoke-ch1-level12-failed.png' });
});

test('chapter 2 is reachable: level 13 opens once chapter 1 is passed', async ({ page }) => {
  // Every chapter-1 level passed, so the resume point is chapter 2's first
  // level. Seeding is the only practical route: unlocking level 13 by playing is
  // twelve levels of mouse work, and this test is about the join, not about
  // chapter 1's puzzles.
  await seedProgress(page, 12);
  await page.goto('/');
  await page.getByRole('button', { name: '开始' }).click();

  await expect(page.locator('.shell-bar')).toContainText('奇数个信号');
  // A chapter-2 part is in the palette: level 13 rewards the splitter, and the
  // splitter is the only part that can expose bits 1-3 of its 4-bit input, so a
  // palette without it could not build the level at all.
  await expect(page.getByRole('button', { name: '位拆分器' })).toBeEnabled();
  // The level's own checker is mounted and live.
  await expect(page.locator('.truth-table')).toBeVisible();

  await page.getByRole('button', { name: '章节地图' }).click();
  // All 47 tiles -- chapter 2's 26 and chapter 3's nine are on the map, which is
  // the player's only view of them.
  await expect(page.locator('.map-tile')).toHaveCount(47);
  await expect(page.locator('.map-tile').nth(12)).toContainText('13. 奇数个信号');
  await expect(page.locator('.map-tile').nth(12)).toBeEnabled();
  // Unlocking stays strictly linear across the join: level 14 waits for 13.
  await expect(page.locator('.map-tile').nth(13)).toBeDisabled();

  // And a chapter-2 tile is real navigation, exactly as a chapter-1 one is.
  await page.locator('.map-tile').nth(12).click();
  await expect(page.locator('.screen-map')).toBeHidden();
  await expect(page.locator('.screen-board')).toBeVisible();
  await expect(page.locator('.shell-bar')).toContainText('奇数个信号');
  await page.screenshot({ path: 'test-results/smoke-ch2-level13-open.png' });
});

test('a chapter-2 level opens and grades end to end', async ({ page }) => {
  // Levels 1-30 passed: the resume point is level 31, whose reference is one XOR
  // (`a XOR inv`) -- four parts and three wires, the smallest chapter-2 circuit a
  // mouse can build, and a real chapter-2 level rather than a synthetic one.
  await seedProgress(page, 30);
  await page.goto('/');
  await page.getByRole('button', { name: '开始' }).click();
  await expect(page.locator('.shell-bar')).toContainText('1 位取反器');

  const { cx, cy } = await boardCentre(page);
  // LAYOUT: the two level inputs on the left, the gate in the middle, the level
  // output on the right. A two-input gate's pins sit 12px either side of its drop
  // row and a one-pin part's pin sits on it, so every wire below is a straight
  // run between the coordinates these four drops produce.
  await place(page, '关卡输入', cx - 260, cy - 20);
  await place(page, '关卡输入', cx - 260, cy + 20);
  await place(page, '异或门', cx, cy);
  await place(page, '关卡输出', cx + 200, cy);
  await page.screenshot({ path: 'test-results/smoke-ch2-level31-parts-placed.png' });

  await dragWire(page, cx - 188, cy - 20, cx, cy - 12); // a -> XOR
  await dragWire(page, cx - 188, cy + 20, cx, cy + 12); // inv -> XOR
  await dragWire(page, cx + 72, cy, cx + 200, cy); // XOR -> out

  // The grade is the level's own: a truth table over a and inv, all four rows.
  // The run plays them one at a time, so the heading counts up -- and it is
  // caught mid-run here, which is what makes this a test of the animation rather
  // than of its result.
  await runTests(page);
  await expect(page.locator('.truth-table h2')).toHaveText('正在测试 用例 1 / 4');
  await expect(page.locator('.truth-table')).toContainText('全部用例通过');
  await expect(page.locator('.shell-metrics')).toContainText('总开销');
  await page.screenshot({ path: 'test-results/smoke-ch2-level31-passed.png' });

  // Passing wrote progress, which is what makes this "graded" rather than
  // merely "displayed": level 31 has its star and level 32 is unlocked.
  await expect(page.locator('.result')).toContainText('电路安静地运转着');
  await page.getByRole('button', { name: '继续' }).click();
  await page.getByRole('button', { name: '章节地图' }).click();
  await expect(page.locator('.map-tile').nth(30)).toContainText('★');
  await expect(page.locator('.map-tile').nth(31)).toBeEnabled();
  await page.screenshot({ path: 'test-results/smoke-ch2-unlocked-next.png' });
});

test('the last chapter-2 level opens: level 38 is reachable', async ({ page }) => {
  // 37 passed: the resume point is the chapter's last level. Reaching it proves
  // the join reaches the end of the chapter, not just its first batch.
  await seedProgress(page, 37);
  await page.goto('/');
  await page.getByRole('button', { name: '开始' }).click();
  await expect(page.locator('.shell-bar')).toContainText('计数器');

  await page.getByRole('button', { name: '章节地图' }).click();
  await expect(page.locator('.map-tile')).toHaveCount(47);
  await expect(page.locator('.map-tile').nth(37)).toContainText('38. 计数器');
  await expect(page.locator('.map-tile').nth(37)).toBeEnabled();

  await page.locator('.map-tile').nth(37).click();
  await expect(page.locator('.screen-board')).toBeVisible();
  await expect(page.locator('.shell-bar')).toContainText('计数器');
  // A real level, not an empty screen: its palette offers the register the level
  // is built from and its checker is mounted.
  await expect(page.getByRole('button', { name: '8 位寄存器' })).toBeEnabled();
  await expect(page.locator('.truth-table')).toBeVisible();
  await page.screenshot({ path: 'test-results/smoke-ch2-level38-open.png' });
});

/**
 * A `script` LEVEL IS THE OTHER SHAPE OF TEST, and the run has to replay it
 * rather than reset between its cases: its steps are one run, so step 3 reads a
 * register step 2 clocked. Twenty-seven levels passed puts the resume point on
 * level 28, a script level; an empty board then fails every step, which is
 * exactly what makes this a test of the replay -- each step is driven and read,
 * so no column is left unknown.
 */
test('a sequential level replays its steps and reads every one of them', async ({ page }) => {
  await seedProgress(page, 27);
  await page.goto('/');
  await page.getByRole('button', { name: '开始' }).click();
  await expect(page.locator('.shell-bar')).toContainText('循环依赖');

  // Two clicks take the pace from 2× to 8×: nine steps at 450ms each is four
  // seconds of a test suite spent watching nothing happen.
  await page.locator('.case-rate').click();
  await page.locator('.case-rate').click();
  await expect(page.locator('.case-rate')).toHaveText('8×');

  await runTests(page);
  await expect(page.locator('.truth-table h2')).toContainText('正在测试 用例 1 /');
  await expect(page.locator('.truth-table h2')).toHaveText('未通过');
  // Every case was driven and read: an unread step would leave `???` behind.
  await expect(page.locator('.truth-table')).not.toContainText('???');
  await page.screenshot({ path: 'test-results/smoke-ch2-level28-run.png' });
});

test('chapter 3 is reachable: level 39 opens once chapter 2 is passed', async ({ page }) => {
  // 38 passed -- the whole of chapters 1 and 2 -- so the resume point is the
  // first chapter-3 level. Before the chapter was appended to the level list this
  // test failed at the resume point itself, which is the point of it.
  await seedProgress(page, 38);
  await page.goto('/');
  await page.getByRole('button', { name: '开始' }).click();
  await expect(page.locator('.shell-bar')).toContainText('算数引擎');

  await page.getByRole('button', { name: '章节地图' }).click();
  await expect(page.locator('.map-tile')).toHaveCount(47);
  await expect(page.locator('.map-tile').nth(38)).toContainText('39. 算数引擎');
  await expect(page.locator('.map-tile').nth(38)).toBeEnabled();
  // Unlocking stays strictly linear across the second join too: 40 waits for 39.
  await expect(page.locator('.map-tile').nth(39)).toBeDisabled();

  // A real level, not an empty screen: its palette offers the eight-bit wiring
  // the level is built from and its checker is mounted.
  await page.locator('.map-tile').nth(38).click();
  await expect(page.locator('.screen-board')).toBeVisible();
  await expect(page.locator('.shell-bar')).toContainText('算数引擎');
  await expect(page.locator('.truth-table')).toBeVisible();
  await page.screenshot({ path: 'test-results/smoke-ch3-level39-open.png' });
});

test('the last level opens and mounts its program check: level 47', async ({ page }) => {
  // 46 passed: the resume point is the phase's acceptance level -- the one whose
  // check runs a real OVERTURE program against the machine the player built,
  // rather than a truth table. Reaching it proves the join reaches the end of
  // chapter 3, and that the `program` check kind (level data + `checks.ts`) is
  // wired into the app rather than only into the unit tests.
  await seedProgress(page, 46);
  await page.goto('/');
  await page.getByRole('button', { name: '开始' }).click();
  await expect(page.locator('.shell-bar')).toContainText('图灵完备');

  await page.getByRole('button', { name: '章节地图' }).click();
  await expect(page.locator('.map-tile')).toHaveCount(47);
  await expect(page.locator('.map-tile').nth(46)).toContainText('47. 图灵完备');
  await expect(page.locator('.map-tile').nth(46)).toBeEnabled();

  await page.locator('.map-tile').nth(46).click();
  await expect(page.locator('.screen-board')).toBeVisible();
  await expect(page.locator('.shell-bar')).toContainText('图灵完备');
  // The palette is everything earned through level 46, so the six machine parts
  // are all on offer -- the claim `level-buildability.test.ts` walks, checked
  // here against the palette the app actually renders.
  await expect(page.getByRole('button', { name: '8 位运算器' })).toBeEnabled();
  await expect(page.getByRole('button', { name: '程序存储器' })).toBeEnabled();
  // And the program check is mounted: an empty board must grade as a failure
  // rather than as nothing at all, which is what `missing-program` means.
  await expect(page.locator('.truth-table')).toBeVisible();
  await page.screenshot({ path: 'test-results/smoke-ch3-level47-open.png' });
});
