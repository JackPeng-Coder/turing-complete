import { expect, test, type Page } from '@playwright/test';

/**
 * End-to-end smoke test: the path a player actually walks.
 *
 * Enter a level -> dismiss the briefing -> pick a part from the palette -> drop
 * it on the canvas -> wire it up -> read the grade -> reload and find the
 * progress still there.
 *
 * The drag offsets are deliberately hard-coded against the board's geometry:
 * `pinPosition()` puts an output pin at `x + INSTANCE_WIDTH (64)`, vertically
 * centred, and a part dropped at cursor `(px, py)` lands with its pin row on
 * `py`. If the part size changes, these offsets have to change with it -- that
 * coupling is the point, because pointer feel is part of the UI contract.
 */

/** Centre of the board canvas, in page coordinates. */
async function boardCentre(page: Page): Promise<{ cx: number; cy: number }> {
  const box = (await page.locator('canvas.board').boundingBox())!;
  return { cx: box.x + box.width / 2, cy: box.y + box.height / 2 };
}

/** Drops Constant On on the left and Level Output on the right. */
async function placeParts(page: Page): Promise<{ cx: number; cy: number }> {
  const { cx, cy } = await boardCentre(page);
  await page.getByRole('button', { name: '高电平' }).click();
  await page.mouse.click(cx - 160, cy);
  await page.getByRole('button', { name: '关卡输出' }).click();
  await page.mouse.click(cx + 160, cy);
  return { cx, cy };
}

/** Drags a wire from the source's output pin to the output part's input pin. */
async function wireParts(page: Page, cx: number, cy: number): Promise<void> {
  await page.mouse.move(cx - 160 + 64, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 160, cy, { steps: 12 });
  await page.mouse.up();
}

test('level 1 is playable end to end and shows its epilogue', async ({ page }) => {
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

  // The level is a single truth-table row that must read 1.
  await expect(page.locator('.truth-table')).toContainText('全部用例通过');
  await expect(page.locator('.shell-metrics')).toContainText('得分');

  // Passing a level shows its epilogue, which never takes part in grading.
  await expect(page.locator('.briefing')).toContainText('门开了');
  await page.screenshot({ path: 'test-results/smoke-level1-passed.png' });
});

test('progress survives a reload and unlocks the next level', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '开始' }).click();

  const { cx, cy } = await placeParts(page);
  await wireParts(page, cx, cy);
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
