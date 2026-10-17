import { chromium } from '@playwright/test';

/**
 * A throwaway visual check: three surfaces, photographed.
 *
 * NOT A TEST -- no assertions, and nothing here fails a build. It exists because
 * "this button is ugly" is a claim about pixels, and pixels have to be looked at:
 * the smoke suite can prove a control works and say nothing about whether it is
 * the right size for the column it sits in.
 *
 * Needs a served build, since it drives the real app:
 *
 *   <pnpm> preview --port 4173 --strictPort   # in another terminal
 *   node tools/visual-check.mjs
 *
 * Writes `test-results/look-*.png`, which is already ignored. It exits non-zero on
 * a selector that does not match, which is how a renamed button is noticed.
 */
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

/** The map, with the sandbox door on it. */
await page.goto('http://localhost:4173/');
await page.getByRole('button', { name: '开始' }).click();
await page.getByRole('button', { name: '章节地图' }).click();
await page.waitForTimeout(300);
await page.screenshot({ path: 'test-results/look-map.png' });
console.log('shot map');

/** The sandbox board: the tool grid and the components panel. */
await page.getByRole('button', { name: '自由建造' }).click();
await page.waitForTimeout(300);
await page.screenshot({ path: 'test-results/look-sandbox.png' });
console.log('shot sandbox');

/** The editor's action strip on its own, so a button's shape is legible. */
await page.locator('.editor-tools').screenshot({
  path: 'test-results/look-tools.png',
  scale: 'css',
  timeout: 8000,
});
console.log('shot tools');

await browser.close();
