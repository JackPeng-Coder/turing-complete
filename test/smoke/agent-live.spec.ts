import { expect, test, type Page } from '@playwright/test';
import { LEVEL_ORDER } from '../../src/levels/index';
import { STORAGE_KEY } from '../../src/persist/storage';

/**
 * The agent against a REAL model.
 *
 * OPT-IN, BECAUSE IT COSTS MONEY AND CANNOT BE DETERMINISTIC. Everything else in
 * `test/smoke/` fakes the endpoint, which is what makes it a test of this program
 * rather than a test of somebody's model; this file is the other half -- proof
 * that the request shape, the stream reader, the tool loop and the panel work
 * against an endpoint that was not written to agree with them.
 *
 * It is skipped unless `DEEPSEEK_API_KEY` is in the environment, so the key is
 * never in the repository and `pnpm smoke` stays free and offline by default:
 *
 * ```powershell
 * $env:DEEPSEEK_API_KEY='sk-…'; pnpm smoke -g "real model"
 * ```
 *
 * The level is 7 (长明灯): one 高电平 wired to the level output. It is the
 * smallest honest task in the campaign, which is the point -- if the agent cannot
 * do this against a live model, nothing about the panel or the tools is worth
 * debugging yet.
 */
const KEY =
  (
    globalThis as {
      process?: { env?: Record<string, string | undefined> };
    }
  ).process?.env?.DEEPSEEK_API_KEY ?? '';

test.skip(KEY === '', 'set DEEPSEEK_API_KEY to run the agent against a real model');

/** Passes the first `count` levels, so the app opens on the next one. */
async function seed(page: Page, count: number): Promise<void> {
  const levels: Record<string, { passed: boolean; best: null; stars: number }> = {};
  for (const id of LEVEL_ORDER.slice(0, count)) {
    levels[id] = { passed: true, best: null, stars: 3 };
  }
  await page.addInitScript(
    ([key, json]) => globalThis.localStorage.setItem(key, json),
    [STORAGE_KEY, JSON.stringify({ version: 1, levels, programs: {} })] as const,
  );
}

test('the agent passes a level by talking to a real model', async ({ page }) => {
  test.setTimeout(300_000);
  await seed(page, 6); // level 7 是「一个高电平接出去」

  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });

  await page.goto('/');
  const setup = page.locator('.agent-setup');
  const fields = setup.locator('.agent-field input');
  await fields.nth(0).fill('https://api.deepseek.com');
  await fields.nth(1).fill(KEY);
  await fields.nth(2).fill('deepseek-chat');
  await setup.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByRole('button', { name: '开始' }).click();

  await page.locator('.agent-toggle').click();
  // The exact sentence a real session was given: no detail beyond "do the task".
  await page.locator('.agent-input').fill('帮我完成任务');
  await page.getByRole('button', { name: '发送' }).click();

  // Wait for the run to settle rather than for a fixed time: the model decides
  // how many steps this takes, and the panel says so in its status line.
  await expect(page.locator('.agent-status')).not.toContainText('正在', { timeout: 240_000 });
  const log = await page.locator('.agent-log').innerText();
  // The evidence is printed as well as asserted: a live run is worth reading.
  console.log(`=== agent log ===\n${log}\n=== end (${errors.length} console errors) ===`);
  await page.screenshot({ path: 'test-results/smoke-agent-live.png' });

  expect(errors).toEqual([]);
  expect(await page.locator('.agent-tool').count()).toBeGreaterThan(0);
  // Level 7 passes exactly when a 高电平 reaches the level output. The result
  // card is the app's own verdict, not the agent's claim about itself.
  await expect(page.locator('.result')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.shell-metrics')).toContainText('★');
});

/**
 * THE `?dev=1` HOLE, WHICH IS WHAT A REAL SESSION HIT.
 *
 * `?dev=1` on a level used to offer the SANDBOX palette, and the sandbox palette
 * has no level plumbing in it by design. So a level with four input pins and four
 * output pins opened on a board where those eight parts could not be placed by
 * anyone -- hand or assistant -- and the session that found this spent its whole
 * budget asking for `level_input` under twenty guessed names.
 *
 * The assertion is deliberately about the FIX rather than about the model's
 * cleverness: a connector the level binds by name (`IN_b0`…, `OUT_out0`…) has to
 * end up on the board. Whether the model then wires the level up is its business.
 */
test('the agent can place a level’s own connectors under ?dev=1', async ({ page }) => {
  test.setTimeout(300_000);
  await seed(page, 13); // 第 14 关：四位原样送出，八个连接器

  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });

  await page.goto('/?dev=1');
  const setup = page.locator('.agent-setup');
  const fields = setup.locator('.agent-field input');
  await fields.nth(0).fill('https://api.deepseek.com');
  await fields.nth(1).fill(KEY);
  await fields.nth(2).fill('deepseek-chat');
  await setup.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByRole('button', { name: '开始' }).click();

  // The tray itself is the first thing that was missing.
  await expect(page.getByRole('button', { name: '关卡输入', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '关卡输出', exact: true })).toBeVisible();

  await page.locator('.agent-toggle').click();
  await page.locator('.agent-input').fill('帮我把这一关的输入原样接到输出上');
  await page.getByRole('button', { name: '发送' }).click();
  await expect(page.locator('.agent-status')).not.toContainText('正在', { timeout: 240_000 });
  const log = await page.locator('.agent-log').innerText();
  console.log(`=== agent log (?dev=1) ===\n${log}\n=== end (${errors.length} console errors) ===`);
  await page.screenshot({ path: 'test-results/smoke-agent-live-dev.png' });

  expect(errors).toEqual([]);
  expect(log).toContain('IN_b');
  expect(log).not.toContain('连着被拒绝了');
  // It must not have burned the budget guessing names: three refusals in a row
  // stops the run, and a run that stops that way never places anything.
  await expect(page.locator('.shell-metrics')).not.toContainText('尚未评测');
});
