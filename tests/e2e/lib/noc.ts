// Helpers shared by the M22 specs.
import { expect, type Page, type TestInfo } from '@playwright/test';
import { findTextOverflow } from './overflow.js';

export const isPhone = (info: TestInfo) => info.project.name.startsWith('phone');

/** Opens a NOC page without the first-visit tour and waits for the layout and the 3D scene. */
export async function openNoc(page: Page, url: string): Promise<void> {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('noc-tour', '1');
    } catch {
      /* storage blocked: the tour shows and the test fails visibly */
    }
  });
  const layout = page.waitForResponse((r) => r.url().endsWith('/api/registry/layout'));
  await page.goto(url);
  expect((await layout).ok(), 'GET /api/registry/layout').toBe(true);
  await expect(page.locator('[data-testid="scene"] canvas')).toBeVisible();
  await page.waitForTimeout(2500); // the camera fly-in settles
}

/** The incidents/history/… panel the user sees: right column on desktop, bottom sheet on phones. */
export const panel = (page: Page, info: TestInfo) =>
  page.locator(isPhone(info) ? '#sheet' : '#right');

/** Screenshot into shots/ (CI artifact) after checking that no text runs past an edge. */
export async function checkScreen(page: Page, info: TestInfo, name: string): Promise<void> {
  const hits = await findTextOverflow(page);
  const file = `shots/${info.project.name}-${name}.png`;
  await page.screenshot({ path: file });
  await info.attach(name, { path: file, contentType: 'image/png' });
  expect(hits, `text past an edge on ${info.project.name} ${name}`).toEqual([]);
}
