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
 * CHAPTERS 2, 3 AND 4 ARE COVERED BY THE LATER TESTS. Joining a chapter to the
 * level list is not shipping it: a level nobody can open, or one that opens but
 * never grades, is invisible in the earlier tests either way. Those tests seed a
 * save with the levels before their target already passed -- the only practical
 * way to reach level 31, let alone 49 or 56, in a browser test -- and then walk the
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
 *
 * `programs` is the save's other half: the editor text a player left on each
 * level (`persist/storage.ts` carries it through as `progress.programs`). A test
 * that needs the app to open with a program already in the editor -- and the
 * board's display already built on the machine that program is loaded in -- seeds
 * it here rather than typing it after the boot.
 */
async function seedProgress(
  page: Page,
  count: number,
  programs: Record<string, string> = {},
): Promise<void> {
  const levels: Record<string, { passed: boolean; best: null; stars: number }> = {};
  for (const id of LEVEL_ORDER.slice(0, count)) {
    levels[id] = { passed: true, best: null, stars: 3 };
  }
  await page.addInitScript(
    ([key, json]) => globalThis.localStorage.setItem(key, json),
    [STORAGE_KEY, JSON.stringify({ version: 1, levels, programs })] as const,
  );
}

/** Centre of the board canvas, in page coordinates. */
async function boardCentre(page: Page): Promise<{ cx: number; cy: number }> {
  const box = (await page.locator('canvas.board').boundingBox())!;
  return { cx: box.x + box.width / 2, cy: box.y + box.height / 2 };
}

/** Arms a palette part by its localised name, then drops it at a page point. */
async function place(page: Page, name: string, x: number, y: number): Promise<void> {
  // `exact` because palette labels contain each other: a plain `与门` also
  // matches `三路与门`, and Playwright resolves a role by substring by default.
  await page.getByRole('button', { name, exact: true }).click();
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
  // can be touched at all. Photographed first: it is the screen a level opens
  // on, and nothing else in this suite ever sees it.
  await expect(page.locator('.briefing-tag')).toHaveText('任务简报');
  await page.screenshot({ path: 'test-results/smoke-level1-briefing.png' });
  await page.getByRole('button', { name: '开始' }).click();
  await expect(page.locator('.shell-bar')).toContainText('从零开始');
  // One screen at a time: the empty map screen is not in the way.
  await expect(page.locator('.screen-map')).toBeHidden();

  const { cx, cy } = await placeParts(page);
  await page.screenshot({ path: 'test-results/smoke-level1-parts-placed.png' });

  await wireParts(page, cx, cy);

  // Building is not being judged. Before the test button is pressed the panel is
  // a PLAN -- the level's one case, with its expectation and no verdict -- and
  // the bar reports what the circuit costs and says it has not been tested.
  await expect(page.locator('.truth-table')).toContainText('共 1 个');
  // The unrun output is a neutral dot per bit, never a value and never the word
  // `???` the panel used to print.
  await expect(page.locator('.truth-table .bit-x')).toHaveCount(1);
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
  // The expectation and the value that came out, boxed together: two cells, one
  // rounded frame, and rounded at its two ends.
  await expect(page.locator('.case-bad')).toHaveCount(2);
  await expect(page.locator('.case-bad.bad-cap-top')).toHaveCount(1);
  await expect(page.locator('.case-bad.bad-cap-bottom')).toHaveCount(1);
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
  await expect(page.locator('.shell-bar')).toContainText('从零开始');
  await expect(page.locator('.briefing')).toContainText('金属舱室');
});

/**
 * LEVEL 12 IS THE LEVEL THE COMPLAINT CAME FROM: four inputs, four outputs, a
 * sixteen-row table, and a circuit reading zero everywhere -- fifteen failing
 * cases, which the old panel answered with fifteen lines of `out3: 0 ≠ 1`. It is
 * also the level where the matrix is at its tallest, which is why it is worth a
 * walk of its own.
 */
test('level 14 lays its sixteen cases out as columns, then plays them', async ({ page }) => {
  await seedProgress(page, 13);
  await page.goto('/');
  await page.getByRole('button', { name: '开始' }).click();
  await expect(page.locator('.shell-bar')).toContainText('二进制速算');

  // Nothing built yet: sixteen columns of expectations, no verdict, and not one
  // fabricated output.
  await expect(page.locator('.truth-table h2')).toHaveText('用例');
  await expect(page.locator('.case-count')).toHaveText('共 16 个');
  await expect(page.locator('.case-bad')).toHaveCount(0);
  await page.screenshot({ path: 'test-results/smoke-ch2-level14-plan.png' });

  await runTests(page);
  // The first case is driven before the click returns, so this is not a race.
  await expect(page.locator('.truth-table h2')).toHaveText('正在测试 用例 1 / 16');
  await expect(page.locator('.case-active')).not.toHaveCount(0);
  await page.screenshot({ path: 'test-results/smoke-ch2-level14-running.png' });

  // Sixteen cases at 2x is seven seconds, so the verdict needs a longer wait
  // than the default -- and it arrives as a red matrix, not as a wall of text.
  await expect(page.locator('.truth-table h2')).toHaveText('未通过', { timeout: 20_000 });
  await expect(page.locator('.truth-table')).not.toContainText('≠');
  await expect(page.locator('.truth-table p')).toHaveCount(0);
  await expect(page.locator('.case-bad')).not.toHaveCount(0);
  await page.screenshot({ path: 'test-results/smoke-ch2-level14-failed.png' });
});

/**
 * The strongest `channel` in a band of the board, as that channel against what
 * the same pixel offers instead.
 *
 * GREEN IS MEASURED AGAINST RED ALONE, because a live wire (`#00ff9c`) carries a
 * lot of blue -- 156 of it -- and comparing against the largest of the other two
 * would score the wire's own core at 99, inside its own halo. Against red it
 * scores 255, where bare paper scores 6 and an unlit body 28.
 *
 * BLUE IS MEASURED AGAINST BOTH, because nothing on this board is blue-green: a
 * word part's body (`#1250a8`) reads 88 and the paper reads 11.
 */
async function peakChannel(
  page: Page,
  x: number,
  y: number,
  width: number,
  height: number,
  channel: 'green' | 'blue',
): Promise<number> {
  const index = channel === 'green' ? 1 : 2;
  const against = channel === 'green' ? [0] : [0, 1];
  return page.evaluate(
    ({ x, y, width, height, index, against }) => {
      const canvas = document.querySelector('canvas.board') as HTMLCanvasElement | null;
      const ctx = canvas?.getContext('2d');
      if (!canvas || !ctx) return 0;
      const dpr = globalThis.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      const data = ctx.getImageData(
        Math.round((x - rect.left) * dpr),
        Math.round((y - rect.top) * dpr),
        Math.max(1, Math.round(width * dpr)),
        Math.max(1, Math.round(height * dpr)),
      ).data;
      let peak = -255;
      for (let i = 0; i < data.length; i += 4) {
        const others = against.map((c) => data[i + c]!);
        peak = Math.max(peak, data[i + index]! - Math.max(...others));
      }
      return peak;
    },
    { x, y, width, height, index, against },
  );
}

/** The strongest green in a band: a live wire, and nothing else, scores 255. */
async function peakGreen(page: Page, x: number, y: number, width: number, height = 3) {
  return peakChannel(page, x, y, width, height, 'green');
}

/**
 * The brightest WHITE in a band, as the smallest channel of each pixel.
 *
 * A part's number is drawn in `#d7e6f5` with a dark outline, so it reads about
 * 215; every body colour the board uses is either saturated (one channel near
 * zero) or dark, and the paper reads 7. It is how a test asks "is there a
 * NUMBER here" about text that is painted on a canvas.
 */
async function peakWhite(page: Page, x: number, y: number, width: number, height: number) {
  return page.evaluate(
    ({ x, y, width, height }) => {
      const canvas = document.querySelector('canvas.board') as HTMLCanvasElement | null;
      const ctx = canvas?.getContext('2d');
      if (!canvas || !ctx) return 0;
      const dpr = globalThis.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      const data = ctx.getImageData(
        Math.round((x - rect.left) * dpr),
        Math.round((y - rect.top) * dpr),
        Math.max(1, Math.round(width * dpr)),
        Math.max(1, Math.round(height * dpr)),
      ).data;
      let peak = 0;
      for (let i = 0; i < data.length; i += 4) {
        peak = Math.max(peak, Math.min(data[i]!, data[i + 1]!, data[i + 2]!));
      }
      return peak;
    },
    { x, y, width, height },
  );
}

/**
 * THE WIRE THAT WENT THROUGH A GATE.
 *
 * Reported from a real board: a source sitting to the RIGHT of the gate it feeds
 * took the shortest path -- out past both pins and back left -- and that run went
 * straight through the gate's body. The source here is placed to the right and
 * one row up, which is exactly that shape, and the gate is dropped in the way.
 *
 * The probe is the band of board immediately right of the gate at the target
 * pin's row: it is outside the body, so the painter cannot be hiding anything
 * there, and it is the one place the crossing route always passed through.
 */
test('a wire is routed around a gate, not through it', async ({ page }) => {
  await seedProgress(page, 13);
  await page.goto('/');
  await page.getByRole('button', { name: '开始' }).click();
  await expect(page.locator('.shell-bar')).toContainText('二进制速算');

  const { cx, cy } = await boardCentre(page);
  // A part dropped at a point is centred on it, so these four numbers are the
  // whole geometry: the source's output pin, and the gate's upper input pin.
  const sourcePin = { x: cx + 200 + 72, y: cy - 140 };
  const gate = { x: cx - 40, y: cy - 100 };
  const inputPin = { x: gate.x, y: gate.y - 12 };

  await place(page, '高电平', cx + 200, cy - 140);
  await place(page, '与门', gate.x, gate.y);
  await dragWire(page, sourcePin.x, sourcePin.y, inputPin.x, inputPin.y);
  await page.screenshot({ path: 'test-results/smoke-routing-around-gate.png' });

  // The wire exists: the box immediately left of the gate holds its elbow and
  // the stub that enters the pin, and nothing else is drawn there.
  const reached = await peakGreen(page, inputPin.x - 40, inputPin.y - 20, 36, 40);
  expect(reached, 'no wire arrives at the gate at all').toBeGreaterThan(150);
  // ...and it is NOT on the far side of the gate at the same row, which is where
  // the shortest path put it. The band clears the body (so the painter cannot be
  // hiding a crossing underneath) and clears the gate's own output pin.
  const beyond = await peakGreen(page, inputPin.x + 78, inputPin.y - 7, 52, 9);
  expect(beyond, 'the wire ran through the gate').toBeLessThan(60);
});

/**
 * Right-click is the board's own delete: the part under the pointer, and the
 * wires that reached it, as one undoable step. Checked through the readout rather
 * than the graph -- level 1's output is driven high by the source, so removing
 * the source has to show up as the value falling back to 0, and Ctrl+Z has to
 * bring both the part and its wire back.
 */
test('right-click removes the part under the pointer, undoably', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '开始' }).click();

  const { cx, cy } = await placeParts(page);
  await wireParts(page, cx, cy);
  const outValue = page.locator('.io-pin .io-value').first();
  await expect(outValue).toHaveText('1');

  // The source's body, clear of its output pin and of the wire leaving it.
  await page.mouse.click(cx - 124, cy, { button: 'right' });
  await expect(outValue).toHaveText('0');
  await page.screenshot({ path: 'test-results/smoke-right-click-delete.png' });

  await page.keyboard.press('Control+z');
  await expect(outValue).toHaveText('1');
});

/**
 * DEVELOPER MODE, END TO END. The unit tests pin what `?dev` means to the two
 * gates; this walks the thing a developer actually does -- land on the URL, open
 * the map, click the last level -- and the thing that keeps it honest: the game
 * says so, loudly, and one click puts it back.
 */
test('?dev=1 opens every level, and says so', async ({ page }) => {
  await page.goto('/?dev=1');
  await page.getByRole('button', { name: '开始' }).click();
  await expect(page.locator('.shell-dev')).toBeVisible();

  await page.getByRole('button', { name: '章节地图' }).click();
  // Every one of the 56, from a save with nothing passed in it. Level 1 alone
  // would be enabled without the flag.
  await expect(page.locator('.map-tile:not([disabled])')).toHaveCount(56);
  await page.screenshot({ path: 'test-results/smoke-dev-map.png' });

  // Level 49 opens -- chapter 3's last level, not the game's last any more, which
  // is why the tile is addressed by index rather than as the final one -- and it
  // offers the parts that level was designed around: the whole reason the flag
  // reaches the palette as well as the map.
  await page.locator('.map-tile').nth(48).click();
  // Opening a level raises its briefing, and the briefing covers the bar.
  await page.getByRole('button', { name: '开始' }).click();
  await expect(page.locator('.shell-bar')).toContainText('图灵完备');
  await expect(page.getByRole('button', { name: '8 位运算器', exact: true })).toBeEnabled();

  // One click leaves the mode, and the URL goes with it: a refresh must not
  // bring back a sandbox nobody asked for again.
  await page.locator('.shell-dev').click();
  await expect(page.locator('.shell-dev')).toBeHidden();
  await page.getByRole('button', { name: '章节地图' }).click();
  await expect(page.locator('.map-tile:not([disabled])')).toHaveCount(1);
  expect(new URL(page.url()).search).toBe('');
});

/**
 * THE TWO PACKERS: blue funnels, and the reason for both words.
 *
 * They were green boxes that painted themselves by `outputs[0]` -- which for a
 * splitter is bit 0, one bit wide -- so the part turned green or red with a bit
 * that happened to be passing through, while the maker beside it turned blue
 * because its first output was the byte. And they were boxes because a body was
 * fixed at 72 pixels tall however many pins hung off the edge of it, so eight
 * outputs trailed a column of loose squares down the paper.
 *
 * `?dev=1` opens level 49, whose palette lists every part in the game.
 */
test('the packers are blue funnels that hold their pins', async ({ page }) => {
  await page.goto('/?dev=1');
  await page.getByRole('button', { name: '开始' }).click();
  await page.getByRole('button', { name: '章节地图' }).click();
  await page.locator('.map-tile').nth(48).click();
  await page.getByRole('button', { name: '开始' }).click();

  const { cx, cy } = await boardCentre(page);
  await place(page, '位拆分器', cx - 160, cy);
  await place(page, '位合并器', cx + 160, cy);
  await page.screenshot({ path: 'test-results/smoke-packers.png' });

  // Blue -- the word colour -- inside both bodies, with nothing wired to them.
  // Green or red here is the defect: it means the part is reporting bit 0.
  // Sampled low in the body, clear of the marking and of the top bevel.
  expect(await peakChannel(page, cx - 140, cy + 40, 24, 20, 'blue')).toBeGreaterThan(60);
  expect(await peakChannel(page, cx + 180, cy + 40, 24, 20, 'blue')).toBeGreaterThan(60);
  // ...and the two colours the old rule would have produced are absent. The bus
  // body's own green-ness is 62 (its blue carries some of the channel), where a
  // lit body reads 184 and a dead one reads negative, so the bar sits between.
  expect(await peakChannel(page, cx - 140, cy + 40, 24, 20, 'green')).toBeLessThan(120);
  expect(await peakChannel(page, cx + 180, cy + 40, 24, 20, 'green')).toBeLessThan(120);
});

/**
 * THE ARMED PART, in both places it shows: the slot in the tray that stays lit,
 * and the translucent copy of the part that follows the pointer at the position
 * the drop would take.
 *
 * Both exist because of the same hole: with a part armed, a click on the board
 * places instead of clearing, so the tray has to say what is in your hand -- and
 * a drag has to be given back, which is what the ✕ is for.
 */
test('the armed part is lit in the tray and carried under the pointer', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '开始' }).click();
  const { cx, cy } = await boardCentre(page);

  const slot = page.getByRole('button', { name: '高电平', exact: true });
  await slot.click();
  await expect(slot).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.palette-item-armed')).toHaveCount(1);

  // The ghost is under the pointer, on the grid, at the size the part will be.
  await page.mouse.move(cx - 120, cy - 40);
  await page.screenshot({ path: 'test-results/smoke-ghost.png' });

  // ...and the ✕ puts it down, which gives the plain drag back to the board.
  await expect(page.locator('.palette-release')).toBeVisible();
  await page.locator('.palette-release').click();
  await expect(slot).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('.palette-item-armed')).toHaveCount(0);
  await expect(page.locator('.palette-release')).toBeHidden();
});

/**
 * Ctrl+drag is the selection band. Checked by what it is FOR: the band sweeps up
 * both parts in one gesture and the bin takes them both away.
 */
test('ctrl+drag bands the parts it sweeps over', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '开始' }).click();
  const { cx, cy } = await placeParts(page);
  // The probe sits in the source's body: painted green while it is there.
  expect(await peakGreen(page, cx - 124, cy, 20, 20)).toBeGreaterThan(120);

  await page.keyboard.down('Control');
  await page.mouse.move(cx - 240, cy - 100);
  await page.mouse.down();
  await page.mouse.move(cx + 260, cy + 100, { steps: 8 });
  // Photographed with the button still down: the band is what is being checked,
  // and it is gone the moment the pointer is released.
  await page.screenshot({ path: 'test-results/smoke-marquee.png' });
  await page.mouse.up();
  await page.keyboard.up('Control');
  // Both parts wear the selection outline -- and then the bin takes them both.
  await page.screenshot({ path: 'test-results/smoke-marquee-selected.png' });
  await page.getByRole('button', { name: '删除选中' }).click();
  expect(await peakGreen(page, cx - 124, cy, 20, 20)).toBeLessThan(60);
  await page.screenshot({ path: 'test-results/smoke-marquee-deleted.png' });
});

/**
 * BOTH ENDS OF A LEVEL SHOW THEIR NUMBER.
 *
 * The output has always drawn what it holds in its disc; the input drew nothing,
 * which made one connector look like two different parts. What the input holds is
 * what it is DRIVING, and it is read the same way -- `level_input` has an output
 * pin, so the display reports it like any other.
 *
 * Level 16 takes a four-bit `a`, so the number is big enough to be worth reading;
 * one bit of it is clicked in the left-hand panel first, or the arrow would be
 * showing `0` and the test would pass on a blank body.
 */
test('a level input shows the number it drives, like an output', async ({ page }) => {
  await seedProgress(page, 15);
  await page.goto('/');
  await page.getByRole('button', { name: '开始' }).click();
  await expect(page.locator('.shell-bar')).toContainText('奇数计数技术');

  const { cx, cy } = await boardCentre(page);
  await place(page, '关卡输入', cx - 240, cy);
  // Bit 3 of `a`, so the arrow reads 8 rather than 0.
  await page.locator('.io-pin .bit').first().click();
  await expect(page.locator('.io-pin .io-value').first()).toHaveText('8');

  // The arrow's mass, where its number is drawn.
  expect(await peakWhite(page, cx - 210, cy - 12, 40, 24)).toBeGreaterThan(150);
  await page.screenshot({ path: 'test-results/smoke-input-number.png' });
});

test('chapter 2 is reachable: level 14 opens once chapter 1 is passed', async ({ page }) => {
  // Every chapter-1 level passed, so the resume point is chapter 2's first
  // level. Seeding is the only practical route: unlocking level 14 by playing is
  // thirteen levels of mouse work, and this test is about the join, not about
  // chapter 1's puzzles.
  await seedProgress(page, 13);
  await page.goto('/');
  await page.getByRole('button', { name: '开始' }).click();

  await expect(page.locator('.shell-bar')).toContainText('二进制速算');
  // The palette is live across the join: this level's own parts are the chapter-1
  // ones it lists, and the XOR gate is among them. (It is also chapter 2's first
  // level rather than one of its byte puzzles, which is the 2.x order.)
  await expect(page.getByRole('button', { name: '异或门' })).toBeEnabled();
  // The level's own checker is mounted and live.
  await expect(page.locator('.truth-table')).toBeVisible();

  await page.getByRole('button', { name: '章节地图' }).click();
  // All 56 tiles -- chapter 2's 26, chapter 3's ten and chapter 4's seven are on
  // the map, which is the player's only view of them.
  await expect(page.locator('.map-tile')).toHaveCount(56);
  await expect(page.locator('.map-tile').nth(13)).toContainText('二进制速算');
  await expect(page.locator('.map-tile').nth(13)).toBeEnabled();
  // Unlocking stays strictly linear across the join: level 15 waits for 14.
  await expect(page.locator('.map-tile').nth(14)).toBeDisabled();

  // And a chapter-2 tile is real navigation, exactly as a chapter-1 one is.
  await page.locator('.map-tile').nth(13).click();
  await expect(page.locator('.screen-map')).toBeHidden();
  await expect(page.locator('.screen-board')).toBeVisible();
  await expect(page.locator('.shell-bar')).toContainText('二进制速算');
  await page.screenshot({ path: 'test-results/smoke-ch2-level14-open.png' });
});

test('a chapter-2 level opens and grades end to end', async ({ page }) => {
  // Levels 1-27 passed: the resume point is level 28, whose reference is one XOR
  // (`a XOR inv`) -- four parts and three wires, the smallest chapter-2 circuit a
  // mouse can build, and a real chapter-2 level rather than a synthetic one.
  await seedProgress(page, 27);
  await page.goto('/');
  await page.getByRole('button', { name: '开始' }).click();
  await expect(page.locator('.shell-bar')).toContainText('可控反相器');

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
  // merely "displayed": level 28 has its star and level 29 is unlocked.
  await expect(page.locator('.result')).toContainText('电路安静地运转着');
  await page.getByRole('button', { name: '继续' }).click();
  await page.getByRole('button', { name: '章节地图' }).click();
  await expect(page.locator('.map-tile').nth(27)).toContainText('★');
  await expect(page.locator('.map-tile').nth(28)).toBeEnabled();
  await page.screenshot({ path: 'test-results/smoke-ch2-unlocked-next.png' });
});

test('the last chapter-2 level opens: level 39 is reachable', async ({ page }) => {
  // 37 passed: the resume point is the chapter's last level. Reaching it proves
  // the join reaches the end of the chapter, not just its first batch.
  await seedProgress(page, 38);
  await page.goto('/');
  await page.getByRole('button', { name: '开始' }).click();
  await expect(page.locator('.shell-bar')).toContainText('计数器');

  await page.getByRole('button', { name: '章节地图' }).click();
  await expect(page.locator('.map-tile')).toHaveCount(56);
  await expect(page.locator('.map-tile').nth(38)).toContainText('计数器');
  await expect(page.locator('.map-tile').nth(38)).toBeEnabled();

  await page.locator('.map-tile').nth(38).click();
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
 * register step 2 clocked. Sixteen levels passed puts the resume point on
 * level 17, a script level; an empty board then fails every step, which is
 * exactly what makes this a test of the replay -- each step is driven and read,
 * so no column is left unknown.
 */
test('a sequential level replays its steps and reads every one of them', async ({ page }) => {
  await seedProgress(page, 16);
  await page.goto('/');
  await page.getByRole('button', { name: '开始' }).click();
  await expect(page.locator('.shell-bar')).toContainText('循环依赖');

  // The pace a run starts at is `8×`, so nine steps take a second rather than
  // four: nothing to click, and this is the assertion that it starts there.
  await expect(page.locator('.case-rate')).toHaveText('8×');

  await runTests(page);
  await expect(page.locator('.truth-table h2')).toContainText('正在测试 用例 1 /');
  await expect(page.locator('.truth-table h2')).toHaveText('未通过');
  // Every case was driven and read: a step the run never reached would still be
  // an unknown dot.
  await expect(page.locator('.truth-table .bit-x')).toHaveCount(0);
  await page.screenshot({ path: 'test-results/smoke-ch2-level17-run.png' });
});

test('chapter 3 is reachable: level 40 opens once chapter 2 is passed', async ({ page }) => {
  // 39 passed -- the whole of chapters 1 and 2 -- so the resume point is the
  // first chapter-3 level. Before the chapter was appended to the level list this
  // test failed at the resume point itself, which is the point of it.
  await seedProgress(page, 39);
  await page.goto('/');
  await page.getByRole('button', { name: '开始' }).click();
  await expect(page.locator('.shell-bar')).toContainText('逻辑整合');

  await page.getByRole('button', { name: '章节地图' }).click();
  await expect(page.locator('.map-tile')).toHaveCount(56);
  await expect(page.locator('.map-tile').nth(39)).toContainText('逻辑整合');
  await expect(page.locator('.map-tile').nth(39)).toBeEnabled();
  // Unlocking stays strictly linear across the second join too: 41 waits for 40.
  await expect(page.locator('.map-tile').nth(40)).toBeDisabled();

  // A real level, not an empty screen: its palette offers the eight-bit wiring
  // the level is built from and its checker is mounted.
  await page.locator('.map-tile').nth(39).click();
  await expect(page.locator('.screen-board')).toBeVisible();
  await expect(page.locator('.shell-bar')).toContainText('逻辑整合');
  await expect(page.locator('.truth-table')).toBeVisible();
  await page.screenshot({ path: 'test-results/smoke-ch3-level40-open.png' });
});

test('chapter 3 ends with a level that mounts its program check: level 49', async ({ page }) => {
  // 48 passed: the resume point is the phase's acceptance level -- the one whose
  // check runs a real OVERTURE program against the machine the player built,
  // rather than a truth table. Reaching it proves the join reaches the end of
  // chapter 3 (it is no longer the game's last level -- chapter 4 follows it), and
  // that the `program` check kind (level data + `checks.ts`) is wired into the app
  // rather than only into the unit tests.
  await seedProgress(page, 48);
  await page.goto('/');
  await page.getByRole('button', { name: '开始' }).click();
  await expect(page.locator('.shell-bar')).toContainText('图灵完备');

  await page.getByRole('button', { name: '章节地图' }).click();
  await expect(page.locator('.map-tile')).toHaveCount(56);
  await expect(page.locator('.map-tile').nth(48)).toContainText('图灵完备');
  await expect(page.locator('.map-tile').nth(48)).toBeEnabled();

  await page.locator('.map-tile').nth(48).click();
  await expect(page.locator('.screen-board')).toBeVisible();
  await expect(page.locator('.shell-bar')).toContainText('图灵完备');
  // The palette is everything earned through level 48, so the six machine parts
  // are all on offer -- the claim `level-buildability.test.ts` walks, checked
  // here against the palette the app actually renders.
  await expect(page.getByRole('button', { name: '8 位运算器' })).toBeEnabled();
  await expect(page.getByRole('button', { name: '程序存储器' })).toBeEnabled();
  // And the program check is mounted: an empty board must grade as a failure
  // rather than as nothing at all, which is what `missing-program` means.
  await expect(page.locator('.truth-table')).toBeVisible();
  await page.screenshot({ path: 'test-results/smoke-ch3-level49-open.png' });
});

/**
 * LEVEL 50'S REFERENCE PROGRAM, the text a passing run of it contains.
 *
 * THE FIVE LINES ARE HAND-WRITTEN MACHINE CODE -- level 50 has no mnemonics, so
 * the editor's own label is the byte reader's and each line is eight binary
 * digits. They are `test/fixtures/ch4-references.ts`'s
 * `ch4-50-punchcard-programming` verbatim, inlined rather than imported because
 * this spec is a browser walk: the fixture is the batch tests' own module.
 * `ch4-batch1.test.ts` is what keeps those bytes re-derived from the ISA table.
 */
const LEVEL_50_PROGRAM = [
  '10110001    # move|inp|d1   r1 = in',
  '00000101    # loadi|5       r0 = 5',
  '10000010    # move|s0|d2    r2 = 5',
  '01000000    # add           r3 = in + 5',
  '10011111    # move|s3|out   out = r3',
].join('\n');

/**
 * CHAPTER 4'S OWN CHANNEL, GRADED END TO END: the program the PLAYER writes.
 *
 * Level 49 proved the `program` check kind is mounted in the app; this is the
 * same kind reading the other source. The machine is chapter 3's CPU and the
 * level ships its own board, so nothing is built here -- what is under test is
 * the TEXT in the editor, which is why the walk below types the reference into
 * the byte editor, presses 测试 and reads the verdict. A program check's cases
 * cannot be played one column at a time (`testCases` says why), so that button
 * assembles the text, loads it into the board's RAM and grades in one step.
 */
test('chapter 4 grades a hand-written program: level 50', async ({ page }) => {
  // 49 passed -- every level of chapters 1 to 3 -- so the resume point is
  // chapter 4's first level. Reaching it is what this walk is here to prove.
  await seedProgress(page, 49);
  await page.goto('/');
  await page.getByRole('button', { name: '开始' }).click();
  await expect(page.locator('.shell-bar')).toContainText('打孔编程');

  await page.getByRole('button', { name: '章节地图' }).click();
  await expect(page.locator('.map-tile')).toHaveCount(56);
  await expect(page.locator('.map-tile').nth(49)).toContainText('打孔编程');
  await expect(page.locator('.map-tile').nth(49)).toBeEnabled();

  await page.locator('.map-tile').nth(49).click();
  await expect(page.locator('.screen-board')).toBeVisible();
  await expect(page.locator('.shell-bar')).toContainText('打孔编程');
  // A tile is real navigation, so it raises the level's briefing again -- and the
  // briefing covers the bench, so it has to go before the editor can be clicked.
  await page.getByRole('button', { name: '开始' }).click();

  // The bench is mounted because this level grades a program the player wrote,
  // and its editor names the reader the level asks for: bytes, not assembly.
  const code = page.locator('.ide-code');
  await expect(code).toHaveAttribute('aria-label', '二进制程序编辑器');

  await code.fill(LEVEL_50_PROGRAM);
  await page.screenshot({ path: 'test-results/smoke-ch4-level50-program.png' });

  await page.locator('.ide-test').click();

  await expect(page.locator('.truth-table h2')).toHaveText('全部用例通过');
  await expect(page.locator('.shell-metrics')).toContainText('总开销');
  // The text became an image: the five bytes the reference solution uses.
  await expect(page.locator('.ide-bytes')).toHaveText('B10582409F');

  // Passing opens the dialog, and its summary calls the level what it is.
  const result = page.locator('.result');
  await expect(result).toContainText('关卡完成');
  await expect(result).toContainText('程序关卡');
  await page.screenshot({ path: 'test-results/smoke-ch4-level50-passed.png' });

  // Passing wrote progress -- level 50 keeps its star and level 51 unlocks --
  // which is what makes this "graded" rather than merely "displayed".
  await page.getByRole('button', { name: '继续' }).click();
  await page.getByRole('button', { name: '章节地图' }).click();
  await expect(page.locator('.map-tile').nth(49)).toContainText('★');
  await expect(page.locator('.map-tile').nth(50)).toBeEnabled();
});

/**
 * 停止并复位 MUST CLEAR THE BOARD THE PLAYER IS LOOKING AT, NOT ANOTHER ONE.
 *
 * THE WIRING `test/ui/display-run.test.ts` CANNOT REACH. A display is bound to a
 * run in one place only (`rebuild`), and a keystroke in the editor drops the run
 * without rebuilding -- so after any edit the display keeps painting the previous
 * run's machine while `ensurePlayerRun` hands back a different one. A reset aimed
 * at that other run clears a circuit nobody can see and leaves the board on screen
 * exactly as it was, which is the defect this walk pins: the clock card reads the
 * display's own snapshot (`main.ts`'s io panel), so a board that was not reset
 * says so in the card the player is looking at.
 *
 * THE SAVE SEEDS THE PROGRAM FOR THE SAME REASON. With level 50's text already in
 * `progress.programs`, the app opens with the display built on the run's machine
 * (the state a player is in after pressing 汇编, and the one the bug needs) rather
 * than on its own compilation of the board.
 *
 * WHAT A PLAYER SEES IS THE ASSERTION: the card goes back to 0 ticks, the editor
 * still holds the text, and the assembled image is still in the debugger's RAM --
 * 汇编/单步 reads the same five bytes rather than 256 zeros.
 */
test('chapter 4 resets the board without losing the program: level 50', async ({ page }) => {
  await seedProgress(page, 49, { 'ch4-50-punchcard-programming': LEVEL_50_PROGRAM });
  await page.goto('/');
  await page.getByRole('button', { name: '开始' }).click();
  await expect(page.locator('.shell-bar')).toContainText('打孔编程');

  // The save's text is in the editor, and the debugger was built on the machine
  // it is loaded in: the RAM window shows the five bytes, not a page of zeros.
  const code = page.locator('.ide-code');
  await expect(code).toHaveValue(LEVEL_50_PROGRAM);
  await expect(page.locator('.debug-ram .debug-byte').first()).toHaveText('B1');
  await page.screenshot({ path: 'test-results/smoke-ch4-level50-reset-open.png' });

  // Clock the board twice, through the toolbar's 单步: the edges land on the
  // machine the display paints, so the clock card is the board's own count.
  const boardStep = page.locator('.tools button[aria-label="单步"]');
  await boardStep.click();
  await boardStep.click();
  await expect(page.locator('.io-tick')).toContainText('2 拍');

  // A keystroke -- the ordinary state of the screen -- drops the run the display
  // was built on. The text put back is the same one, so nothing about the
  // program has changed; only the display/run binding has come apart.
  await code.press('Control+End');
  await page.keyboard.type(' ');
  await page.keyboard.press('Backspace');
  await expect(code).toHaveValue(LEVEL_50_PROGRAM);

  await page.locator('.tools button[aria-label="停止并复位"]').click();

  // THE BOARD ON SCREEN IS RESET: the card reads the display's clock, and it is
  // back at zero. (Before the fix this is where the walk failed: the reset went
  // to the fresh run the keystroke had left behind, while the display went on
  // painting the old machine at 2 ticks.)
  await expect(page.locator('.io-tick')).toContainText('0 拍');
  // ...and the program was not silently lost: the text is still in the editor.
  await expect(code).toHaveValue(LEVEL_50_PROGRAM);
  await page.screenshot({ path: 'test-results/smoke-ch4-level50-reset.png' });

  // ...AND THE MACHINE IS STILL THE PROGRAM'S. One 单步 walks the image that was
  // reloaded into the reset board, so the debugger's RAM window still shows the
  // assembled bytes and the bytes are what was assembled.
  await page.locator('.ide-step').click();
  await expect(page.locator('.ide-bytes')).toHaveText('B10582409F');
  const ram = page.locator('.debug-ram .debug-byte');
  await expect(ram.nth(0)).toHaveText('B1');
  await expect(ram.nth(1)).toHaveText('05');
  await expect(ram.nth(2)).toHaveText('82');
  await expect(ram.nth(3)).toHaveText('40');
  await expect(ram.nth(4)).toHaveText('9F');
  await expect(page.locator('.debug-ticks')).toContainText('1 拍');
});

/**
 * A SAVE WRITTEN BEFORE THE 2.x REALIGNMENT KEEPS ITS STARS.
 *
 * The realignment renamed 37 level ids and removed three, and a save is keyed by
 * id -- so without `levels/id-map.ts` inside `migrate` every star would land on a
 * level that no longer exists, silently, because every lookup would simply miss.
 * The unit tests pin the translation table; this walks a real browser through it.
 *
 * The ids below are 1.x's. The fifth one is the interesting one: old
 * `ch1-06-nor-gate` is the CURRENT `ch1-05-nor-gate`, because the realignment
 * swapped OR and NOR back to the source's order -- so a resume point of level 6
 * is the proof that the old id was translated rather than matched by number.
 */
test('a save written before the 2.x realignment keeps its stars', async ({ page }) => {
  const record = { passed: true, best: null, stars: 3 };
  await page.addInitScript(
    ([key, json]) => globalThis.localStorage.setItem(key, json),
    [
      STORAGE_KEY,
      JSON.stringify({
        version: 1,
        levels: {
          'ch1-01-crude-awakening': record,
          'ch1-02-nand-gate': record,
          'ch1-03-not-gate': record,
          'ch1-04-and-gate': record,
          'ch1-06-nor-gate': record,
          // retired by the realignment: it must be dropped, not carried
          'ch2-27-logic-engine': record,
        },
      }),
    ] as const,
  );

  await page.goto('/');
  await page.getByRole('button', { name: '开始' }).click();
  await expect(page.locator('.shell-bar')).toContainText('或门');

  await page.getByRole('button', { name: '章节地图' }).click();
  // Levels 1-5 read as passed and 6 is unlocked: six playable tiles, and the first
  // one carries the star the legacy save earned.
  await expect(page.locator('.map-tile:not([disabled])')).toHaveCount(6);
  await expect(page.locator('.map-tile').nth(0)).toContainText('★');
  await expect(page.locator('.map-tile').nth(4)).toContainText('★');
  await page.screenshot({ path: 'test-results/smoke-migrated-save.png' });
});
