// Helpers shared by the M22 specs.
import { expect, type Page, type TestInfo } from '@playwright/test';
import { findTextOverflow } from './overflow.js';

/** Opens a NOC page without the first-visit tour and waits for the layout and the 3D scene. */
export async function openNoc(page: Page, url: string): Promise<void> {
  await page.addInitScript(() => {
    // CSP (M17): remember anything the policy blocked; checkScreen fails on it.
    const w = window as unknown as { cspViolations: string[] };
    w.cspViolations = [];
    document.addEventListener('securitypolicyviolation', (e) => {
      w.cspViolations.push(`${e.effectiveDirective} ${e.blockedURI}`);
    });
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

/** The incidents/history/… panel: right column on wide screens, stacked under the map (tablet) or
 * above it (phone) — the same element on every size. */
export const panel = (page: Page) => page.locator('#right');

/** Screenshot into shots/ (CI artifact) after checking that no text runs past an edge. */
export async function checkScreen(page: Page, info: TestInfo, name: string): Promise<void> {
  const hits = await findTextOverflow(page);
  const file = `shots/${info.project.name}-${name}.png`;
  await page.screenshot({ path: file });
  await info.attach(name, { path: file, contentType: 'image/png' });
  expect(hits, `text past an edge on ${info.project.name} ${name}`).toEqual([]);
  const csp = await page.evaluate(
    () => (window as unknown as { cspViolations?: string[] }).cspViolations ?? [],
  );
  expect(csp, `blocked by Content-Security-Policy on ${name}`).toEqual([]);
}
